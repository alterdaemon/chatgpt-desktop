#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
APP_ID="io.github.alterdaemon.chatgpt-desktop"
MANIFEST_PATH="${SCRIPT_DIR}/${APP_ID}.yml"
BUILD_DIR="${ROOT_DIR}/dist/flathub-flatpak-build"
REPO_DIR="${ROOT_DIR}/dist/flathub-flatpak-repo"
OUTPUT_DIR="${ROOT_DIR}/dist/flathub"
VERSION="$(node -p "require(process.argv[1]).version" "${ROOT_DIR}/package.json")"
ARCH="$(flatpak --default-arch)"
BUNDLE_PATH="${OUTPUT_DIR}/chatgpt-desktop_flathub_${VERSION}_${ARCH}.flatpak"

"${SCRIPT_DIR}/validate-flatpak-assets.sh"

rm -rf "${BUILD_DIR}" "${REPO_DIR}"
mkdir -p "${REPO_DIR}" "${OUTPUT_DIR}"

flatpak-builder \
  --force-clean \
  --repo="${REPO_DIR}" \
  "${BUILD_DIR}" \
  "${MANIFEST_PATH}"

flatpak build-bundle "${REPO_DIR}" "${BUNDLE_PATH}" "${APP_ID}" stable

printf 'Built %s\n' "${BUNDLE_PATH}"
