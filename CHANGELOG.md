# Changelog

All notable changes to this project will be documented in this file.

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
