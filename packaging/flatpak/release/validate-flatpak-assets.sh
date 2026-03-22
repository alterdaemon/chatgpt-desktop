#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
APP_ID="io.github.alterdaemon.chatgpt-desktop"

show_runtime_hint() {
  printf 'Missing required Flatpak runtime or SDK for this build.\n' >&2
  printf 'Run `npm run setup:flatpak` to install the required Flatpak runtimes, then try again.\n' >&2
}

for command_name in desktop-file-validate appstreamcli flatpak-builder; do
  if ! command -v "${command_name}" > /dev/null 2>&1; then
    printf 'Missing required command: %s\n' "${command_name}" >&2
    exit 1
  fi
done

desktop-file-validate "${SCRIPT_DIR}/${APP_ID}.desktop"
appstreamcli validate --no-net "${SCRIPT_DIR}/${APP_ID}.metainfo.xml"

mkdir -p "${ROOT_DIR}/dist"

if ! (cd "${ROOT_DIR}/dist" && flatpak-builder --show-manifest "${SCRIPT_DIR}/${APP_ID}.yml" > /dev/null); then
  show_runtime_hint
  exit 1
fi

printf 'Validated Flatpak assets for %s\n' "${APP_ID}"
