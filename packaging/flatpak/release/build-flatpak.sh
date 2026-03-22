#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
APP_ID="io.github.alterdaemon.chatgpt-desktop"
MANIFEST_PATH="${SCRIPT_DIR}/${APP_ID}.yml"
BUILD_DIR="${ROOT_DIR}/dist/flatpak-build"
REPO_DIR="${ROOT_DIR}/dist/flatpak-repo"
LINUX_UNPACKED_DIR="${ROOT_DIR}/dist/linux-unpacked"
APP_BINARY_PATH="${LINUX_UNPACKED_DIR}/chatgpt-desktop"
VERSION="$(node -p "require(process.argv[1]).version" "${ROOT_DIR}/package.json")"
ARCH="$(flatpak --default-arch)"
BUNDLE_PATH="${ROOT_DIR}/dist/chatgpt-desktop_${VERSION}_${ARCH}.flatpak"

npm run validate:flatpak-assets

if [ ! -x "${APP_BINARY_PATH}" ]; then
  npm run build:linux:dir
fi

rm -rf "${BUILD_DIR}" "${REPO_DIR}"
mkdir -p "${REPO_DIR}"

(
  cd "${ROOT_DIR}/dist"
  flatpak-builder \
    --force-clean \
    --repo="${REPO_DIR}" \
    "${BUILD_DIR}" \
    "${MANIFEST_PATH}"
)

flatpak build-bundle "${REPO_DIR}" "${BUNDLE_PATH}" "${APP_ID}" stable

printf 'Built %s\n' "${BUNDLE_PATH}"
