#!/usr/bin/env bash
set -euo pipefail

FLATHUB_REMOTE_URL="https://flathub.org/repo/flathub.flatpakrepo"
RUNTIME_VERSION="24.08"
INSTALL_SCOPE="${FLATPAK_INSTALL_SCOPE:-user}"

show_install_hint() {
  local ref="$1"

  printf 'Failed to install %s.\n' "${ref}" >&2
  printf 'Manual retry: flatpak install %s flathub %s\n' "${INSTALL_FLAG}" "${ref}" >&2
}

install_ref() {
  local ref="$1"

  if ! flatpak install "${INSTALL_FLAG}" --noninteractive flathub "${ref}"; then
    show_install_hint "${ref}"
    exit 1
  fi
}

if ! command -v flatpak > /dev/null 2>&1; then
  printf 'Missing required command: flatpak\n' >&2
  printf 'Install Flatpak and Flatpak Builder first, then rerun this command.\n' >&2
  exit 1
fi

case "${INSTALL_SCOPE}" in
  user)
    INSTALL_FLAG="--user"
    REMOTE_FLAG="--user"
    ;;
  system)
    INSTALL_FLAG="--system"
    REMOTE_FLAG="--system"
    ;;
  *)
    printf 'Unsupported FLATPAK_INSTALL_SCOPE: %s\n' "${INSTALL_SCOPE}" >&2
    printf 'Use either user or system.\n' >&2
    exit 1
    ;;
esac

flatpak remote-add "${REMOTE_FLAG}" --if-not-exists flathub "${FLATHUB_REMOTE_URL}"

install_ref "org.freedesktop.Platform//${RUNTIME_VERSION}"
install_ref "org.freedesktop.Sdk//${RUNTIME_VERSION}"
install_ref "org.electronjs.Electron2.BaseApp//${RUNTIME_VERSION}"

printf 'Installed Flatpak runtimes for %s scope\n' "${INSTALL_SCOPE}"
