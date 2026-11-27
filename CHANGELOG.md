# Changelog

All notable changes to this project will be documented in this file.

## [1.8.0] - 2026-11-27

### Fixed
- Vimium-style link hints now cover the whole application window after ChatGPT's front-end redesign: the sidebar (chat list, navigation and account controls), the conversation header, the conversation and the composer controls. Previously only the main conversation was reachable.
- `j`, `k`, `d`, `u`, `gg` and `G` now scroll the region you are working in: the scrollable area around the focused element, then the one under the mouse pointer, then the main conversation. The sidebar chat list can now be scrolled from the keyboard by hovering it or focusing one of its entries.
- `gi` now prefers the message composer over other editable fields.
- The example stylesheet (`resources/examples/styles/custom.css`) was rewritten for the current ChatGPT site and removes rounded corners again. It zeroes the site's own corner-radius design tokens and adds a small fallback for literal radii; avatars stay circular. It also removes the fade overlays at the top and bottom of the conversation, the edge fades on the composer and the sidebar chat list, and the shadow on the floating scroll button. In the dark theme the solid cover below the composer now matches the chat surface instead of showing as a black band.
- The example stylesheet hides the "ChatGPT can make mistakes" disclaimer and its reserved space again. The fixed title bar has a solid, theme-matched background only on conversation layouts so scrolled messages do not show through after removing the top fade; Settings keeps its transparent title bar so section headings are not covered.

### Changed
- Link hints are collected fresh each time hint mode is entered instead of being cached, so a changed sidebar or menu is never labelled with stale targets.
- The example stylesheet selects the active theme through `html[data-theme]` instead of `html.light` / `html.dark`. If you copied the old example to `~/.config/chatgpt-desktop/styles/custom.css`, copy the new one over it. Rules whose targets no longer exist in the site were removed: the message width limit, the composer grid layout and the tighter message spacing.

### Added
- A live check that audits the signed-in ChatGPT page and fails with the name of the selector that stopped matching when the site changes again.
- Fixture tests for hints across the sidebar, header, conversation and composer, for scroll-region selection, and for the example stylesheet in both themes.

## [1.7.0] - 2026-11-27

### Security
- Updated Electron from 37 (end of life) to 45, and updated electron-builder and Playwright. All high and critical `npm audit` findings are resolved.
- The main window now navigates only to HTTPS pages on ChatGPT, OpenAI sign-in, Google, Microsoft and Apple sign-in hosts, and hosts listed in the new `trustedNavigationHosts` setting. Any other destination, including server redirects, opens in the system browser instead.
- Web permissions are now denied by default. Only the ChatGPT page can use microphone and camera, notifications, clipboard writes and fullscreen. USB, HID, serial and Bluetooth device access is always denied.
- Custom CSS, custom scripts, Vimium-style navigation and spellcheck adjustments now run only on ChatGPT pages, never on sign-in or other pages.
- Packaged builds disable run-as-Node mode, `NODE_OPTIONS`, Node.js inspector flags and loading app code outside the packaged archive, and encrypt the cookie store.

### Added
- `trustedNavigationHosts` setting for extra HTTPS sign-in hosts, such as a company single sign-on provider.
- Weekly automated dependency update proposals.

### Changed
- The GitHub-release Flatpak now uses the Freedesktop 26.08 runtime and Electron BaseApp. Run `npm run setup:flatpak` to install them.
- On Wayland sessions the app now runs natively on Wayland, and on X11 sessions it runs on X11. Window placement on reveal is chosen by the compositor on Wayland. Use `--ozone-platform=x11` to force X11.
- `Ctrl+Q` now quits only while the app window is focused. It no longer works as a system-wide shortcut.
- Release builds are produced by a least-privilege pipeline: tests, packaging and publishing run as separate jobs and only publishing can write to the repository.
- The Flathub packaging track is paused and no longer updated.

### Notes
- Cookie encryption is a one-way change. Going back to an older packaged version after upgrading may require signing in again.

## [1.6.0] - 2026-11-27

### Added
- A Flathub-oriented Flatpak source-build track with pinned sources, constrained permissions, AppStream metadata, validation, and local bundle generation.
- Automated unit tests and fixture-based Playwright Electron integration tests, run on pull requests, branch pushes, and release builds.
- Integration coverage for custom CSS and user-script injection, menu actions, zoom limits, spellcheck, settings persistence and recovery from a damaged settings file, Vimium-style navigation and link hint modes, and the renderer security boundaries.
- An authenticated smoke test that signs in to ChatGPT and verifies a real assistant reply, reusing a stored session between runs so repeat runs skip the sign-in.

### Changed
- Resumed project maintenance and removed the archived-project notice.
- Updated the supported development and CI runtime to Node 24.
- Documented the Linux build and test workflows.
- Kept application settings, custom CSS, custom scripts, URL policy, and zoom behavior unchanged while moving their pure logic into a testable runtime module.
- Split the test suites so the offline fixture tests and the account-backed ChatGPT check can be run independently.

### Fixed
- Vimium hint activation now dispatches a single click to the selected control.
- Wait for fixture scroll resets to finish before testing Vimium hints, preventing a test-order timing failure.
- Recognize both the current role-based ChatGPT composer and its legacy ID in live smoke tests and login warm-up.
- Recognize current assistant responses without mistaking the smoke prompt for a reply.
- Configure the Electron sandbox helper in Linux CI so live login warm-up can run with sandboxing enabled.
- Allow CI to bootstrap a first-party authenticated test session from an encrypted secret while retaining the mandatory real ChatGPT prompt-and-reply check.
- Support trusted Linux runners for network-dependent CI and release builds without skipping the live checks; pull requests retain hosted runners.
- Include the pinned Electron executable in the Flathub source-build track instead of assuming BaseApp supplies it.

## [1.5.0] - 2026-03-22

### Added
- Official Flatpak packaging assets, metadata, and build scripts under `packaging/flatpak/release/` for producing a sandboxed `.flatpak` bundle.

### Changed
- The release workflow now validates and publishes Flatpak artifacts alongside the existing `.AppImage` and `.deb` packages.
- Tray startup and global show or hide shortcut registration now degrade cleanly when sandboxed desktops or portal integrations do not expose those capabilities.

## [1.4.1] - 2026-03-21

### Changed
- Simplified Vimium-style hint generation around explicit ChatGPT DOM targets for faster, more reliable link hinting across the main conversation area, sidebar controls, and header actions.
- Fixed hint discovery after scrolling or sidebar layout changes so `f` and `F` rebuild targets for the current visible UI instead of using stale positions.
- Improved hint marker placement for cramped header controls and tightened activation handling for custom menu buttons such as the profile/settings menu.

## [1.4.0] - 2026-03-21

### Added
- Built-in Vimium-style keyboard navigation for the ChatGPT view, including `h`, `j`, `k`, `l`, `u`, `d`, `gg`, `G`, and `gi`.
- Link hint mode with `f` and `F` for keyboard-driven activation across the visible ChatGPT UI, including sidebar and chrome controls.

### Changed
- `Esc` now exits the active input/editor so navigation commands can resume immediately.
- Improved built-in keyboard navigation behavior to target the active scrollable view and focus the main prompt only when explicitly requested.
- Moved built-in Vimium-style navigation into a dedicated bundled page module and added a persisted on/off toggle in the app and tray menus.

## [1.3.1] - 2026-03-20

### Added
- `Hide`, `Refresh`, `Zoom`, `Save Settings`, `About`, and `Help` actions to the application menu and tray menu.
- A persisted `zoomFactor` setting in `~/.config/chatgpt-desktop/settings.json`.
- A simple About dialog that shows app, Node, V8, Chrome, and Electron versions.

### Changed
- Reuse the same lightweight menu action set in both the hidden app menu bar and the tray menu.
- Allow the current zoom level to be saved and restored across restarts.

## [1.3.0] - 2026-03-19

### Added
- A spellcheck toggle in the application menu.
- Persisted application settings under `~/.config/chatgpt-desktop/settings.json`, currently used for the spellcheck preference.
- A configurable global `showShortcut` setting for showing or hiding the app from anywhere.

### Changed
- Disable spellcheck by default and allow enabling it from the app menu.
- Apply the spellcheck setting immediately to the active ChatGPT input UI and keep it across restarts.
- Reuse the running instance on second launch and bring the window back through the same fast reveal path.
- Make the global shortcut behave as a focused-window hide toggle and otherwise reopen the app on the current display and workspace.

## [1.2.0] - 2026-03-19

### Added
- Refine the README description and add a short trust-oriented project preamble for users who prefer to inspect and build from source.
- Optional custom JavaScript support from `~/.config/chatgpt-desktop/scripts/`.
- Example customization files and script references under `resources/examples/`.

### Changed
- Limit external custom CSS loading to `~/.config/chatgpt-desktop/styles/custom.css`.
- Execute all user scripts in alphabetical order after page load and in-page navigation.
- Continue loading the app when a user script fails, while logging the script error to the console.

## [1.1.0] - 2026-03-18

### Added
- System tray integration with quick actions to show the app or quit.
- Global `Ctrl+Q` / `Cmd+Q` shortcut for explicit application exit.
- Optional CSS loading support for external or bundled UI customization.
- Automatic creation of config, style, and cache directories on first launch.

### Changed
- Updated the desktop wrapper to open ChatGPT with tray behavior instead of a window-only workflow.
- Improved window lifecycle handling so closing the window hides the app and keeps it available from the tray.
- Disabled Electron DevTools in the packaged app and applied startup flags for smoother runtime behavior.
- Renamed the package to `chatgpt-desktop` and bumped the application version to `1.1.0`.
- Refreshed project metadata in `README.md` and `LICENSE` to reflect current maintainer and credits.
- Moved the preferred user stylesheet location to `~/.config/chatgpt-desktop/styles/custom.css`.
- Stored persistent Electron profile data under `~/.local/share/chatgpt-desktop/` and crash dump data under `~/.cache/chatgpt-desktop/crashpad`.
- Prevented duplicate app launches by revealing the existing window instead of creating a second instance and tray icon.

## [1.0.0] - Initial release

### Added
- Initial Electron desktop wrapper for ChatGPT on Ubuntu/Linux.
- Basic application window with preload support and external link handling.
- Packaging setup with Electron and Electron Builder.
