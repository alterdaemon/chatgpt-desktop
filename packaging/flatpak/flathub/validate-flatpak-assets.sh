#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
APP_ID="io.github.alterdaemon.chatgpt-desktop"
MANIFEST_PATH="${SCRIPT_DIR}/${APP_ID}.yml"

show_runtime_hint() {
  printf 'Missing required Flatpak runtime or SDK for this build.\n' >&2
  printf 'Run `npm run setup:flatpak` to install the required Flatpak runtimes, then try again.\n' >&2
}

for command_name in desktop-file-validate appstreamcli flatpak-builder python3; do
  if ! command -v "${command_name}" > /dev/null 2>&1; then
    printf 'Missing required command: %s\n' "${command_name}" >&2
    exit 1
  fi
done

desktop-file-validate "${SCRIPT_DIR}/${APP_ID}.desktop"
appstreamcli validate --no-net "${SCRIPT_DIR}/${APP_ID}.metainfo.xml"

python3 - <<'PY' "${MANIFEST_PATH}" "${ROOT_DIR}/package.json" "${SCRIPT_DIR}/${APP_ID}.metainfo.xml"
import json
import sys
from pathlib import Path

manifest_path = Path(sys.argv[1])
package_path = Path(sys.argv[2])
metainfo_path = Path(sys.argv[3])

version = json.loads(package_path.read_text())["version"]
expected_url = f"https://github.com/alterdaemon/chatgpt-desktop/archive/refs/tags/v{version}.tar.gz"
manifest_text = manifest_path.read_text()
metainfo_text = metainfo_path.read_text()

if expected_url not in manifest_text:
    raise SystemExit(
        f"Manifest source archive does not match package.json version {version}: {expected_url}"
    )

if "sha256:" not in manifest_text:
    raise SystemExit("Manifest is missing a checksum-pinned source archive.")

if f'<release version="{version}"' not in metainfo_text:
    raise SystemExit(
        f"Metainfo releases do not include package.json version {version}."
    )
PY

if ! flatpak-builder --show-manifest "${MANIFEST_PATH}" > /dev/null; then
  show_runtime_hint
  exit 1
fi

printf 'Validated Flathub Flatpak assets for %s\n' "${APP_ID}"
