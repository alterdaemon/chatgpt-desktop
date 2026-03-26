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

MANIFEST_JSON_PATH="$(mktemp)"
trap 'rm -f "${MANIFEST_JSON_PATH}"' EXIT

if ! flatpak-builder --show-manifest "${MANIFEST_PATH}" > "${MANIFEST_JSON_PATH}"; then
  show_runtime_hint
  exit 1
fi

python3 - <<'PY' "${MANIFEST_JSON_PATH}" "${ROOT_DIR}/package.json" "${SCRIPT_DIR}/${APP_ID}.metainfo.xml"
import json
import sys
import urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text())
package = json.loads(Path(sys.argv[2]).read_text())
metainfo_root = ET.fromstring(Path(sys.argv[3]).read_text())

version = package["version"]
expected_url = f"https://github.com/alterdaemon/chatgpt-desktop/archive/refs/tags/v{version}.tar.gz"

modules = manifest.get("modules") or []
if not modules:
    raise SystemExit("Manifest does not define any modules.")

sources = modules[0].get("sources") or []
archive_sources = [source for source in sources if source.get("type") == "archive"]
if len(archive_sources) != 1:
    raise SystemExit("Manifest must define exactly one archive source for the app payload.")

archive_source = archive_sources[0]
if archive_source.get("url") != expected_url:
    raise SystemExit(
        f"Manifest archive source does not match package.json version {version}: {expected_url}"
    )

sha256 = archive_source.get("sha256", "")
if len(sha256) != 64 or any(ch not in "0123456789abcdef" for ch in sha256.lower()):
    raise SystemExit("Manifest archive source is missing a valid sha256 checksum.")

release_versions = [release.get("version") for release in metainfo_root.findall("./releases/release")]
if version not in release_versions:
    raise SystemExit(f"Metainfo releases do not include package.json version {version}.")

screenshot_images = []
for screenshot in metainfo_root.findall("./screenshots/screenshot"):
    image = screenshot.find("image")
    if image is not None and image.text and image.text.strip():
        screenshot_images.append(image.text.strip())

if not screenshot_images:
    raise SystemExit("Metainfo must define at least one screenshot image.")

for screenshot_url in screenshot_images:
    parsed = urllib.parse.urlparse(screenshot_url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise SystemExit(f"Screenshot URL must be an absolute HTTPS URL: {screenshot_url}")
PY

printf 'Validated Flathub Flatpak assets for %s\n' "${APP_ID}"
