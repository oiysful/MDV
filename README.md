# MDV

Claude-style desktop Markdown editor built with Electron.

## Features

- Markdown preview + source editing modes
- Multi-tab workflow with drag reorder
- Directory explorer for `.md` / `.markdown` files
- TOC / explorer sidebar with custom context menus
- Auto theme, light theme, dark theme
- Save / Save As / Print / Copy controls
- File change watching for opened files
- macOS distributable build via `electron-builder`

## Tech Stack

- Electron
- chokidar
- marked
- highlight.js

Renderer libraries are loaded by CDN from `src/renderer/index.html` under the app CSP allowlist.

## Project Structure

```text
./
├── src/
│   ├── main.js
│   ├── preload.js
│   └── renderer/index.html
├── assets/
│   └── icon.icns
├── package.json
└── AGENTS.md
```

## Development

Install dependencies:

```bash
npm install
```

Run the desktop app locally:

```bash
npm start
```

## Build a distributable app

Create a packaged macOS build:

```bash
npm run build
```

Current build outputs:

- `dist/mac-arm64/MDV.app`
- `dist/MDV-1.0.0-arm64.dmg`

## Distribution Notes

- The app is currently code signed during local build if a usable macOS identity is available.
- Notarization is not configured yet, so sharing the DMG may still trigger macOS security friction on another machine.
- For polished external distribution, add Apple notarization credentials to the electron-builder config/workflow.

## Security / Architecture Notes

- Renderer code must use `window.api` only for privileged actions.
- New privileged filesystem or shell actions must be added in both:
  - `src/main.js`
  - `src/preload.js`

## Known Limitations

- No automated test suite yet.
- `src/renderer/index.html` is intentionally monolithic and carries existing Biome accessibility/style warnings.
- Notarization is still pending for friendlier macOS distribution.
