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
- First-launch empty-state guidance and stronger open-entry onboarding
- Explorer root header actions for path toggle and close
- Finder reveal support from explorer context menus
- macOS distributable build via `electron-builder`

## Tech Stack

- Electron
- chokidar
- marked
- highlight.js

Renderer libraries are loaded by CDN from `src/renderer/index.html` under the app CSP allowlist.

## Renderer Structure

The renderer is no longer a single inline `<script>` block.

Current split:

- `src/renderer/index.html` — shell markup + CSS + script tags
- `src/renderer/app.js` — renderer bootstrap/orchestration and high-coupling workspace flows
- `src/renderer/path-utils.js` — path/link helper logic
- `src/renderer/theme.js` — theme state + stylesheet switching
- `src/renderer/search.js` — in-document search controller
- `src/renderer/onboarding.js` — first-launch / entry-affordance / explorer-header UI logic
- `src/renderer/markdown.js` — markdown rendering, stats, TOC, image resolution helpers

This is an intermediate refactor state: the renderer still uses global entry points for inline handlers and menu integration, but the largest low-risk logic slices have already been separated.

## Testing

The project now includes a lightweight test layer intended to protect renderer refactors before touching more coupled workspace state.

### Unit tests

```bash
npm run test:unit
```

Covers pure helpers such as:
- path resolution
- external URL detection
- markdown reading-stat calculation

### Electron smoke tests

```bash
npm run test:electron
```

Covers real Electron behavior without a full end-to-end suite:
- app boot / empty state
- file open flow
- folder open / explorer filtering
- theme toggle behavior

Fixture content lives under `tests/fixtures/`.

## First Launch UX

- On an empty launch, MDV emphasizes the top-right **열기** entry point.
- The empty state includes direct **파일 열기** / **폴더 열기** actions.
- A first-launch guidance card explains how to:
  - open a single markdown file
  - open a folder into the explorer
  - drag and drop `.md` / `.markdown`
  - set MDV as the default app manually in Finder

The guidance popup is dismissible and remembered locally.

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
- Finder reveal is implemented through the preload/main bridge, not direct renderer access.

## Known Limitations

- The renderer still keeps some high-coupling workspace logic in `src/renderer/app.js`.
- The app still uses inline handler/global function contracts for toolbar/menu/generated HTML actions.
- `src/renderer/index.html` still carries existing Biome accessibility/style warnings.
- Notarization is still pending for friendlier macOS distribution.
