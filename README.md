# ChatGPT Desktop for Linux (Unofficial)

A Linux desktop app for ChatGPT built to make the web app feel faster, cleaner, and far more usable as a real daily tool.

What started as a simple Electron wrapper has evolved into a focused desktop shell for ChatGPT: better windowing behavior, tray integration, persistent settings, keyboard-driven navigation, zoom controls, and power-user customization that smooth out rough edges in the browser experience.

The project stays intentionally transparent, Linux-focused, and easy to inspect. If you do not trust prebuilt binaries, review the code and build it yourself.

Supported platforms: Linux (`.AppImage`), Debian stable and Ubuntu (`.deb`), and Flatpak (`.flatpak`).

For the best cross-distro compatibility, use the `.AppImage`, which should run on most modern Linux distributions. The `.deb` package is distro-specific and intended for Debian stable and Ubuntu systems on `amd64`.

## Why Use It

- Runs ChatGPT in a dedicated desktop window with tray support and practical app-style behavior
- Improves day-to-day usability with performance tweaks, persistent zoom, saved settings, and a configurable global shortcut
- Adds built-in Vimium-style keyboard navigation for faster movement through the ChatGPT UI
- Supports custom CSS and custom scripts for users who want to tailor the experience further
- Ships as Linux-friendly `.AppImage`, `.deb`, and `.flatpak` packages

## Developer

- alter.daemon `<alter.daemon.ivytq@passmail.com>`

### Origins
- Inspired by the original 1.0.0 wrapper by Stephan Coertzen

## Prerequisites (Debian stable / Ubuntu)

```bash
sudo apt update
sudo apt install -y libnss3 libatk-bridge2.0-0 libgtk-3-0 libxss1 libasound2
```

## Install

```bash
npm install
```

## Flatpak runtime prerequisites

To build either Flatpak track locally, or install the official release bundle, make sure Flatpak, Flatpak Builder, desktop file validation, and AppStream validation tools are available:

```bash
sudo apt update
sudo apt install -y flatpak flatpak-builder desktop-file-utils appstream
flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install --user flathub org.freedesktop.Platform//26.08 org.freedesktop.Sdk//26.08 org.electronjs.Electron2.BaseApp//26.08
```

After the system packages are installed, you can bootstrap the Flatpak remote and runtimes with:

```bash
npm run setup:flatpak
```

By default this installs runtimes for the current user. If you prefer a system-wide install, run `FLATPAK_INSTALL_SCOPE=system npm run setup:flatpak`.

The release bundle flow uses these runtimes. The Flathub packaging track is paused and still pins its own older runtime and Electron version.

## Run the app

```bash
npm start
```

## Install the Flatpak release artifact

Official tagged releases also attach a `.flatpak` bundle alongside the `.AppImage` and `.deb` files.

This release bundle flow is separate from the Flathub packaging track in `packaging/flatpak/flathub/`, which builds from a pinned source archive for review and submission work.

```bash
flatpak install --user ./dist/chatgpt-desktop_<version>_<arch>.flatpak
flatpak run io.github.alterdaemon.chatgpt-desktop
```

## Custom CSS

To override the bundled styling, create a file named `custom.css` here:

`~/.config/chatgpt-desktop/styles/custom.css`

The app looks specifically for the filename `custom.css`.

An example stylesheet is available at `resources/examples/styles/custom.css`.

## Power-User Scripts

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

Application settings are stored under:

`~/.config/chatgpt-desktop/settings.json`

Inside the Flatpak sandbox, these same app-owned locations resolve under `~/.var/app/io.github.alterdaemon.chatgpt-desktop/` through the sandbox-managed XDG config, data, and cache directories.

Current settings include:

- `spellCheckEnabled`
- `showShortcut`
- `zoomFactor`
- `vimiumNavigationEnabled`

## App Menu and Tray Menu

The application menu and tray menu include:

- `Show`
- `Hide`
- `Refresh`
- `Zoom` submenu with `Actual`, `Zoom In`, `Zoom Out`, and `Full Screen`
- `Spellcheck`
- `Vimium-Style Navigation`
- `Save Settings`
- `About`
- `Help`
- `Quit`

Spellcheck is disabled by default and its state is saved across restarts.

`Save Settings` currently persists app-owned settings such as spellcheck, the global shortcut, and the current zoom factor.

## Global Show/Hide Shortcut

The app supports a configurable global shortcut stored in:

`~/.config/chatgpt-desktop/settings.json`

Default value:

```json
{
  "showShortcut": "CommandOrControl+Shift+Space"
}
```

Behavior:

- If the ChatGPT window is focused, the shortcut hides it.
- If the ChatGPT window is not focused, the shortcut hides it first if needed, then reopens it on the current display and workspace.
- Launching the app again while it is already running reuses the same reveal behavior.

The shortcut value uses Electron accelerator syntax.

On Flatpak desktops, global shortcut registration depends on desktop portal support. If the session does not expose the needed portal APIs, the app still launches normally and keeps the configured `showShortcut` value for later sessions.

## Built-in Keyboard Navigation

The app includes Vimium-style navigation keys when focus is not inside an input, textarea, select, or contenteditable editor.

- `j` / `k`: scroll down or up by a small step
- `h` / `l`: scroll left or right by a small step
- `d` / `u`: scroll down or up by about half a page
- `gg` / `G`: jump to the top or bottom of the current scrollable view
- `gi`: focus the main visible input/editor
- `f`: show link hints for visible clickable elements across the current ChatGPT conversation UI, including the main thread, sidebar controls, and header actions, and follow the selected target in place
- `F`: show link hints across the current ChatGPT conversation UI and try to open anchor targets with alternate follow behavior (`window.open`) when available
- `Esc`: cancel hint mode or leave the active input/editor

These bindings are ignored while you are typing in the ChatGPT prompt or another editable control, so normal text entry is preserved.

You can disable or re-enable this feature from the application menu, the tray menu, or by editing `vimiumNavigationEnabled` in `~/.config/chatgpt-desktop/settings.json`.

## Navigation And Permissions

The app window only navigates to HTTPS pages on `chatgpt.com`, `auth.openai.com`, and the Google, Microsoft and Apple sign-in hosts. Every other link, redirect or new-window request opens in your default browser instead.

If your account signs in through another provider, such as a company single sign-on service, add its host name to `~/.config/chatgpt-desktop/settings.json`:

```json
{
  "trustedNavigationHosts": ["sso.example.com"]
}
```

Entries must be plain host names (no scheme, port, path, wildcard or IP address) and also cover their subdomains.

Only the ChatGPT page can use the microphone, camera, notifications, clipboard writes and fullscreen. All other web permissions are denied, and USB, HID, serial and Bluetooth device access is always denied. Custom CSS, custom scripts and Vimium-style navigation run only on ChatGPT pages, not on sign-in pages.

`Ctrl+Q` quits the app while its window is focused. It is not a system-wide shortcut.

## Display Backend

The app runs on X11 on X11 sessions and natively on Wayland on Wayland sessions, with no options needed. To force X11 on a Wayland session, start the app with `--ozone-platform=x11`. On Wayland, window placement when the window is revealed is decided by the compositor, and the global show/hide shortcut needs a desktop that provides the GlobalShortcuts portal.

Packaged builds store cookies encrypted through the system keyring when one is available. If your desktop asks to unlock a keyring at start, that is the reason.

## Zoom

The app supports manual zoom controls from the app menu and tray menu.

Use `Save Settings` if you want the current zoom level to persist across restarts.

## Tests

Run tests on Linux using Node 24. Install the virtual display server once, then run the full suite:

```bash
sudo apt install -y xvfb
npm ci
npm test
```

`npm test` runs all three suites in order:

- `npm run test:unit` covers settings normalization, zoom clamping, the external URL policy, and user-script manifests. No display or network access is required.
- `npm run test:integration` launches the sandboxed Electron app against a local fixture page and needs no account. It covers custom CSS and user-script injection, application menu actions, zoom limits, spellcheck, settings persistence and recovery from a damaged settings file, the Vimium-style navigation keys and link hint modes, and the renderer security boundaries.
- `npm run test:live` signs in to ChatGPT and checks a real assistant reply. It needs an account and network access.

Playwright's test runner and CLI are installed through `@playwright/test`; use `npx playwright test --debug` for interactive diagnosis rather than a separate `playwright-cli` package.

The live check reads `CHATGPT_TEST_EMAIL` and `CHATGPT_TEST_PASSWORD` from the environment. It signs in once in a separate Electron run and stores the session in an ignored profile directory, so later runs reuse that session and skip the sign-in. Each passing run sends one short prompt to the configured account, which leaves a conversation in that account's history. Skip this suite with `npm run test:unit && npm run test:integration` if you would rather not use a real account.

CI can bootstrap an existing authenticated session with the encrypted `CHATGPT_TEST_SESSION_COOKIES` repository secret. It contains a JSON array of unexpired first-party ChatGPT authentication and device-context cookies, allowing the runner to reuse a trusted login when its network is challenged at the sign-in screen. Cloudflare challenge and analytics cookies are not imported. The full real prompt-and-reply check still runs. Treat this secret like a password: never commit or log it, and refresh it when the session expires.

## Build Linux packages

```bash
npm run build:linux
```

Build outputs are generated in `dist/`:
- `.AppImage`
- `.deb`

## Build the GitHub-release Flatpak bundle

```bash
npm run build:flatpak:release
```

This command:

- validates the Flatpak desktop metadata
- reads release Flatpak packaging sources from `packaging/flatpak/release/`
- reuses `dist/linux-unpacked/` when it already exists, otherwise builds the unpacked Electron app there
- stores Flatpak builder cache and checksums in `dist/.flatpak-builder/`
- writes temporary Flatpak build state into `dist/flatpak-build/`
- packages the Flatpak repo into `dist/flatpak-repo/`
- exports a `.flatpak` bundle into `dist/`

`npm run build:flatpak` remains available as an alias for this release-oriented flow.

If you only want to validate the Flatpak metadata and manifest before building, run:

```bash
npm run validate:flatpak:release
```

`npm run validate:flatpak-assets` remains available as an alias for this release-oriented validation step.

Project Flatpak tracks:

- `packaging/flatpak/release/` contains the GitHub-release-oriented Flatpak bundle flow that repackages `dist/linux-unpacked/`.
- `packaging/flatpak/flathub/` contains the Flathub-oriented manifest that installs pinned release sources and an explicit Electron runtime with BaseApp's sandbox integration.

## Build the Flathub Flatpak track

```bash
npm run validate:flatpak:flathub
npm run build:flatpak:flathub
```

This track:

- reads Flathub packaging assets from `packaging/flatpak/flathub/`
- downloads the checksum-pinned GitHub release source archive instead of using `dist/linux-unpacked/`
- stages the app's source files under `/app/lib/io.github.alterdaemon.chatgpt-desktop/` and runs them with a checksum-pinned official Electron runtime matching `package-lock.json`
- writes temporary builder state to `dist/flathub-flatpak-build/`
- writes the Flatpak repo to `dist/flathub-flatpak-repo/`
- exports a local test bundle to `dist/flathub/`

Flatpak-specific behavior notes:

- Tray support is best-effort. If the desktop session or sandbox does not allow tray integration, closing the main window quits the app instead of hiding it in the background.
- Global show/hide shortcuts can be unavailable when the desktop portal stack does not expose global shortcut registration.
- App settings, custom CSS, and custom scripts stay inside the Flatpak sandbox's XDG-managed directories rather than using broad home-directory access.

## GitHub Release Flow

Pushing a version tag (for example `v1.7.0`) triggers the GitHub Actions release workflow, runs the test suites, builds Linux artifacts, and publishes a GitHub Release with attached files.

That workflow currently publishes the release-oriented `.flatpak` bundle; the Flathub packaging track is maintained separately in-repo for source-build validation and submission work.

The workflow runs tests, builds packages and publishes the release as three separate jobs, so only the final publishing job can write to the repository. It produces:

- `.AppImage` for most modern Linux distributions
- `.deb` for Debian stable / Ubuntu `amd64`
- `.flatpak` bundle for Flatpak-capable Linux desktops

```bash
git add .
git commit -m "release: publish chatgpt-desktop v1.7.0"
git tag v1.7.0
git push origin main
git push origin v1.7.0
```

The tag push is what triggers the release workflow.

## Issues

Bug reports and practical feature requests are welcome through GitHub Issues.

Before opening a new issue, please check whether it already exists and include enough detail to reproduce the problem.

This project is Linux-focused, and support and feature work will stay practical and aligned with that scope.
