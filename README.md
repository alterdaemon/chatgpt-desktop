# ChatGPT Desktop for Linux (Unofficial)

A lightweight Electron desktop wrapper that opens ChatGPT in a standalone window with system tray support and optional customizations.

This is a small, minimal wrapper built to stay understandable and easy to audit. It was created to fill the gap for a simple ChatGPT desktop wrapper on Linux, and it is intended to be actively maintained and improved. If you do not trust prebuilt binaries, inspect the code and build it yourself.

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

An example stylesheet is available at `resources/examples/styles/custom.css`.

## Custom Scripts

To run custom JavaScript in the ChatGPT window, place `.js` files here:

`~/.config/chatgpt-desktop/scripts/`

All `.js` files in that directory are executed in alphabetical order.

Scripts run after page load and again on in-page navigation, so they should be safe to execute more than once.

This is an advanced power-user feature intended for altering app behavior. Any `.js` file in `~/.config/chatgpt-desktop/scripts/` runs inside the ChatGPT page and can break typing, sending, navigation, copy/paste, or other UI behavior. Only run scripts you understand and trust.

Script references are listed in `resources/examples/README.md`.

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

Pushing a version tag (for example `v1.2.0`) triggers the GitHub Actions release workflow, builds Linux artifacts, and publishes a GitHub Release with attached files.

The workflow runs on GitHub-hosted Ubuntu and produces:

- `.AppImage` for most modern Linux distributions
- `.deb` for Debian stable / Ubuntu `amd64`

```bash
git add .
git commit -m "feat: release chatgpt-desktop v1.2.0 with custom JavaScript support"
git tag v1.2.0
git push origin main
git push origin v1.2.0
```

The tag push is what triggers the release workflow.

## Issues

Bug reports and practical feature requests are welcome through GitHub Issues.

Before opening a new issue, please check whether it already exists and include enough detail to reproduce the problem.

This project is small and Linux-focused, so support and feature work will stay scoped accordingly.
