#!/usr/bin/env bash
# One-job, commit-guarded runners. RUNNER_EXEC supplies the prepared build environment.
set +x
set -Eeuo pipefail
unset GH_DEBUG

RUNNER_VERSION=2.338.2
RUNNER_SHA256=baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40
RUNNER_LABEL=chatgpt-trusted-linux
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
STATE_DIR="$(dirname -- "$ROOT")/internal/release-runner"

die() { printf 'release-runner: %s\n' "$*" >&2; exit 1; }
remote() { "${executor[@]}" $'set +x\n'"$1" release-runner "${@:2}"; }

write_hook() {
  local destination=$1 repository=$2 approved_ref=$3 commit=$4
  {
    printf '#!/usr/bin/env bash\nset -eu\n'
    printf 'readonly repository=%q approved_ref=%q commit=%q\n' "$repository" "$approved_ref" "$commit"
    cat <<'HOOK'
if [[ ${GITHUB_REPOSITORY-} != "$repository" || ${GITHUB_EVENT_NAME-} != push ||
      ${GITHUB_REF-} != "$approved_ref" || ${GITHUB_SHA-} != "$commit" ]]; then
  echo "Release runner rejected an unapproved repository, event, ref or commit." >&2
  exit 1
fi
HOOK
  } > "$destination"
  chmod 700 "$destination"
}

owned_rows() {
  gh api "repos/$repository/actions/runners?per_page=100" --paginate \
    --jq ".runners[] | select(.name | startswith(\"$prefix\")) | [.id, .busy, .status] | @tsv"
}

routing_value() {
  gh variable list --repo "$repository" --json name,value \
    --jq '.[] | select(.name == "CHATGPT_TRUSTED_RUNNER") | .value'
}

down() {
  local rows attempt id busy status routing policy staging
  routing=$(routing_value) || return 1
  rows=$(owned_rows) || return 1
  staging=$(remote 'if [[ -d $1 ]]; then echo present; else echo absent; fi' "$STATE_DIR") || return 1
  if [[ $staging == absent ]]; then
    if [[ -z $routing && -z $rows ]]; then echo "No owned runner resources to remove."; return; fi
    echo "Runner resources exist without this environment's staging directory; refusing to assume ownership." >&2
    return 1
  fi
  [[ -z $routing || $routing == '["chatgpt-trusted-linux"]' ]] || {
    echo "Routing was changed outside this harness; refusing to overwrite it." >&2; return 1;
  }
  policy=$(gh api "repos/$repository/actions/permissions/fork-pr-contributor-approval" --jq .approval_policy) || return 1
  [[ $policy == all_external_contributors || $policy == first_time_contributors ]] || {
    echo "The approval policy changed outside this harness; refusing to overwrite it." >&2; return 1;
  }
  for ((attempt=0; attempt<30; attempt++)); do
    rows=$(owned_rows) || return 1
    if ! grep -q $'\ttrue\t' <<< "$rows"; then break; fi
    sleep 2
  done
  if grep -q $'\ttrue\t' <<< "$rows"; then
    echo "An owned runner is still busy; leave approval restrictions in place." >&2; return 1
  fi
  remote '
    set -eu
    state=$1
    [[ -d $state ]] || exit 0
    for process in /proc/[0-9]*; do
      [[ -r $process/comm ]] || continue
      read -r name < "$process/comm" || continue
      [[ $name == Runner.Listener ]] || continue
      cwd=$(readlink "$process/cwd" 2>/dev/null) || continue
      if [[ $cwd == "$state"/runner-* ]]; then kill -TERM "${process##*/}" 2>/dev/null || true; fi
    done
    for ((attempt=0; attempt<50; attempt++)); do
      alive=false
      for process in /proc/[0-9]*; do
        [[ -r $process/comm ]] || continue
        read -r name < "$process/comm" || continue
        [[ $name == Runner.Listener ]] || continue
        cwd=$(readlink "$process/cwd" 2>/dev/null) || continue
        if [[ $cwd == "$state"/runner-* ]]; then alive=true; fi
      done
      if ! $alive; then exit 0; fi
      sleep 0.2
    done
    echo "An owned listener did not stop; preserving its directory." >&2
    exit 1
  ' "$STATE_DIR" || return 1
  while IFS=$'\t' read -r id busy status; do
    [[ -n $id ]] || continue
    gh api -X DELETE "repos/$repository/actions/runners/$id" >/dev/null || return 1
  done <<< "$rows"
  if [[ -n $routing ]]; then gh variable delete CHATGPT_TRUSTED_RUNNER --repo "$repository" || return 1; fi
  gh api -X PUT "repos/$repository/actions/permissions/fork-pr-contributor-approval" \
    -f approval_policy=first_time_contributors >/dev/null || return 1
  remote '
    set -eu
    state=$1
    [[ -d $state ]] || exit 0
    shopt -s nullglob dotglob
    for entry in "$state"/*; do
      name=${entry##*/}
      [[ $name == actions-runner.tar.gz || $name == tool-cache || $name =~ ^runner-[0-9]+$ ]] || {
        echo "Unexpected files in runner staging; refusing cleanup." >&2; exit 1;
      }
    done
    rm -r -- "$state"
  ' "$STATE_DIR" || return 1
  echo "Release runners removed; routing cleared and normal approval policy restored."
}

up() {
  local digest policy routing token index online attempt setup
  digest=$(gh api "repos/actions/runner/releases/tags/v$RUNNER_VERSION" \
    --jq ".assets[] | select(.name == \"actions-runner-linux-x64-$RUNNER_VERSION.tar.gz\") | .digest")
  [[ $digest == "sha256:$RUNNER_SHA256" ]] || die "GitHub's published runner digest does not match the pin."
  [[ -z $(owned_rows) ]] || die "Owned runners already exist; run down before provisioning again."
  routing=$(routing_value)
  [[ -z $routing ]] || die "CHATGPT_TRUSTED_RUNNER already exists; refusing to overwrite it."
  policy=$(gh api "repos/$repository/actions/permissions/fork-pr-contributor-approval" --jq .approval_policy)
  [[ $policy == first_time_contributors ]] || die "The approval policy is not the expected normal policy."
  remote '
    set -eu
    state=$1
    [[ ! -e $state ]] || { echo "Runner staging already exists; refusing to overwrite it." >&2; exit 1; }
    . /etc/os-release
    [[ $ID == debian && $(uname -m) == x86_64 && $(node --version) == v24.* ]] || {
      echo "Expected the prepared Debian x86_64 / Node 24 build environment." >&2; exit 1;
    }
    for tool in curl tar sha256sum xvfb-run; do command -v "$tool" >/dev/null; done
    mkdir -p "$(dirname "$state")"
  ' "$STATE_DIR"
  # Only install destructive rollback after this operation owns a new directory.
  remote 'set -eu; mkdir -m 700 -- "$1"' "$STATE_DIR"
  trap 'trap - ERR INT TERM HUP; echo "Provisioning interrupted; removing owned resources." >&2; down || echo "Cleanup is incomplete; rerun down." >&2; exit 1' ERR INT TERM HUP
  gh api -X PUT "repos/$repository/actions/permissions/fork-pr-contributor-approval" \
    -f approval_policy=all_external_contributors >/dev/null
  remote '
    set -eu
    state=$1 version=$2 digest=$3
    mkdir -m 700 "$state/tool-cache"
    curl --fail --location --silent --show-error \
      "https://github.com/actions/runner/releases/download/v$version/actions-runner-linux-x64-$version.tar.gz" \
      --output "$state/actions-runner.tar.gz"
    printf "%s  %s\n" "$digest" "$state/actions-runner.tar.gz" | sha256sum --check --status
  ' "$STATE_DIR" "$RUNNER_VERSION" "$RUNNER_SHA256"
  setup="$(declare -f write_hook)"$'\n'$(cat <<'SETUP'
set -eu
state=$1 repository=$2 ref=$3 sha=$4 index=$5 name=$6 label=$7
read -r token
directory="$state/runner-$index"
mkdir -m 700 "$directory"
tar --extract --gzip --file "$state/actions-runner.tar.gz" --directory "$directory" --no-same-owner
write_hook "$directory/job-started.sh" "$repository" "$ref" "$sha"
cd "$directory"
if ! ./config.sh --unattended --ephemeral --disableupdate --url "https://github.com/$repository" \
  --token "$token" --name "$name" --labels "$label" --work _work >/dev/null 2>&1; then
  unset token
  echo "Runner registration failed; no token was recorded by the harness." >&2
  exit 1
fi
unset token
SETUP
)
  for ((index=1; index<=jobs; index++)); do
    token=$(gh api -X POST "repos/$repository/actions/runners/registration-token" --jq .token)
    printf '%s\n' "$token" | remote "$setup" "$STATE_DIR" "$repository" "$approved_ref" "$commit" \
      "$index" "$prefix${commit:0:12}-$index" "$RUNNER_LABEL"
    unset token
  done
  gh variable set CHATGPT_TRUSTED_RUNNER --repo "$repository" --body '["chatgpt-trusted-linux"]'
  remote '
    set -eu
    state=$1 jobs=$2
    for ((index=1; index<=jobs; index++)); do
      directory="$state/runner-$index"
      mkdir -m 700 "$directory/npm-cache" "$directory/tmp"
      nohup bash -c '\''
        set -eu
        directory=$1 state=$2
        cd "$directory"
        exec 9< "$directory/tmp"
        export TMPDIR="/proc/$$/fd/9"
        export NPM_CONFIG_CACHE="$directory/npm-cache"
        export RUNNER_TOOL_CACHE="$state/tool-cache"
        export AGENT_TOOLSDIRECTORY="$state/tool-cache"
        export ACTIONS_RUNNER_HOOK_JOB_STARTED="$directory/job-started.sh"
        export PLAYWRIGHT_NO_COPY_PROMPT=1
        status=0
        ./run.sh || status=$?
        exit "$status"
      '\'' release-runner "$directory" "$state" >"$directory/listener.log" 2>&1 </dev/null &
    done
  ' "$STATE_DIR" "$jobs"
  for ((attempt=0; attempt<45; attempt++)); do
    online=$(owned_rows | awk '$3 == "online" { count++ } END { print count+0 }')
    if [[ $online -eq $jobs ]]; then
      trap - ERR INT TERM HUP
      printf '%s guarded one-job runner(s) online. Run down after the approved jobs finish.\n' "$jobs"
      return
    fi
    sleep 2
  done
  echo "Listeners did not become ready; removing the guarded resources." >&2
  return 1
}

main() {
  local action=${1:-} ref= repository= commit= jobs=3 flag auth
  [[ $action == up || $action == down ]] || die 'Usage: release-runner.sh up --repo owner/name --ref branch-or-tag --sha commit [--jobs 3] | down [--repo owner/name]'
  shift
  [[ -n ${RUNNER_EXEC:-} ]] || die 'RUNNER_EXEC is required: an argument prefix ending in bash -c for the prepared build environment.'
  read -r -a executor <<< "$RUNNER_EXEC"
  ((${#executor[@]} >= 2)) || die 'RUNNER_EXEC must end in bash -c.'
  [[ ${executor[-2]##*/} == bash && ${executor[-1]} == -c ]] || die 'RUNNER_EXEC must end in bash -c.'
  while (($#)); do
    flag=$1; shift
    (($#)) || die "Missing value for $flag."
    case $flag in
      --repo) repository=$1;; --ref) ref=$1;; --sha) commit=${1,,};; --jobs) jobs=$1;;
      *) die "Unknown option: $flag";;
    esac
    shift
  done
  [[ -z ${GH_TOKEN:-} && -z ${GITHUB_TOKEN:-} ]] || die 'Use keyring-backed gh authorization, not token environment variables.'
  auth=$(gh auth status 2>&1) || die 'gh authorization is unavailable.'
  [[ $auth == *'(keyring)'* ]] || die 'gh must use the Secret Service keyring.'
  repository=${repository:-$(cd "$ROOT" && gh repo view --json nameWithOwner --jq .nameWithOwner)}
  [[ $repository =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die 'Invalid repository.'
  local prefix="chatgpt-release-${repository//\//-}-" approved_ref=
  if [[ $action == down ]]; then down; return; fi
  [[ $commit =~ ^[0-9a-f]{40}$ && $jobs =~ ^([1-9]|1[0-9]|20)$ && -n $ref ]] || die 'up requires a full commit SHA, ref and 1-20 jobs.'
  case $ref in
    refs/heads/*|refs/tags/*) approved_ref=$ref;;
    v[0-9]*.[0-9]*.[0-9]*) approved_ref="refs/tags/$ref";;
    *) approved_ref="refs/heads/$ref";;
  esac
  [[ $approved_ref != *$'\n'* && $approved_ref != *$'\r'* ]] || die 'Invalid ref.'
  up
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; fi
