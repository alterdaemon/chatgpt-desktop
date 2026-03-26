# Flathub Track

This directory contains the Flathub-oriented Flatpak packaging for ChatGPT Desktop.

Unlike the release bundle flow in `packaging/flatpak/release/`, this track:

- builds from a checksum-pinned source archive inside `flatpak-builder`
- uses the `org.electronjs.Electron2.BaseApp` runtime instead of copying a bundled Electron executable from `dist/linux-unpacked`
- keeps permissions limited to rendering, GPU, audio, networking, and the portal-backed integrations the app currently uses

## Files

- `io.github.alterdaemon.chatgpt-desktop.yml` - Flathub-oriented manifest
- `chatgpt-desktop` - launcher that runs the app sources with the BaseApp Electron runtime
- `io.github.alterdaemon.chatgpt-desktop.desktop` - desktop entry for the Flathub track
- `io.github.alterdaemon.chatgpt-desktop.metainfo.xml` - AppStream metadata for review and submission
- `validate-flatpak-assets.sh` - validates desktop metadata, metainfo, version pins, and manifest syntax
- `build-flatpak.sh` - builds a local reviewer-style Flatpak bundle in `dist/flathub/`

## Why There Is No `generated-sources.json`

The app currently ships no production `dependencies` in `package.json`; Electron itself is provided by the BaseApp runtime. Because of that, this packaging track only needs to pin the upstream release source archive checksum rather than vendor a separate npm dependency tree.

If the app later gains runtime npm dependencies, add a generated source manifest before submitting updates to Flathub.

## Maintainer Workflow

1. Make sure the app version in `package.json` has a matching upstream Git tag and GitHub release archive.
2. Update the source archive URL and `sha256` in `io.github.alterdaemon.chatgpt-desktop.yml` for that tagged release.
3. Update the release entry in `io.github.alterdaemon.chatgpt-desktop.metainfo.xml` and replace the placeholder screenshot URL with the reviewer-facing screenshot you want to ship.
4. Validate the Flathub assets:

   ```bash
   npm run validate:flatpak:flathub
   ```

5. Build a local test bundle:

   ```bash
   npm run build:flatpak:flathub
   ```

6. Smoke-test the resulting bundle, then copy the manifest and helper files into the Flathub submission workflow as needed.

The repository currently includes a placeholder screenshot asset at `.github/assets/flathub-placeholder-screenshot.png` so AppStream metadata stays complete during development. Replace it with an immutable release or submission screenshot URL before opening the actual Flathub review.

To compute a fresh source checksum for a tagged release archive:

```bash
python3 -c 'import hashlib, urllib.request; url="https://github.com/alterdaemon/chatgpt-desktop/archive/refs/tags/v1.5.0.tar.gz"; data=urllib.request.urlopen(url, timeout=30).read(); print(hashlib.sha256(data).hexdigest())'
```
