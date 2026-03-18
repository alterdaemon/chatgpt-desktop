# ChatGPT Desktop (Unofficial) - minimal web wrapper for Linux

A lightweight Electron desktop wrapper that opens ChatGPT in a standalone window with system tray support.
Supported platforms: Linux (`.AppImage`), Debian stable and Ubuntu (`.deb`).

For the best cross-distro compatibility, use the `.AppImage`, which should run on most modern Linux distributions. The `.deb` package is distro-specific and intended for Debian stable and Ubuntu systems on `amd64`.

## Developer

- alter.daemon `<alter.daemon.ivytq@passmail.com>`

### Credits
- Stephan Coertzen (initial version 1.0.0)

## Prerequisites (Debian stable / Ubuntu)

```bash
sudo apt update
sudo apt install -y libnss3 libatk-bridge2.0-0 libgtk-3-0 libxss1 libasound2
```

## Install

```bash
npm install
```

## Run the app

```bash
npm start
```

## Custom CSS

To override the bundled styling, create a file named `custom.css` here:

`~/.config/chatgpt-desktop/styles/custom.css`

The app looks specifically for the filename `custom.css`.

For backward compatibility, the app also checks for `custom.css` next to the `.AppImage` file, but the config path above is the recommended location.

## Data Directories

Persistent Electron profile data is stored under:

`~/.local/share/chatgpt-desktop/`

Crash dump data is stored under:

`~/.cache/chatgpt-desktop/crashpad`

## Build Linux packages

```bash
npm run build:linux
```

Build outputs are generated in `dist/`:
- `.AppImage`
- `.deb`

## GitHub Release Flow

Pushing a version tag (for example `v1.1.0`) triggers the GitHub Actions release workflow, builds Linux artifacts, and publishes a GitHub Release with attached files.

The workflow runs on GitHub-hosted Ubuntu and produces:

- `.AppImage` for most modern Linux distributions
- `.deb` for Debian stable / Ubuntu `amd64`

```bash
git add .
git commit -m "feat: release chatgpt-desktop v1.1.0 with tray mode, single-instance launch, custom CSS support, XDG data paths, and updated maintainer and project metadata"
git tag v1.1.0
git push origin main
git push origin v1.1.0
```

The tag push is what triggers the release workflow.
