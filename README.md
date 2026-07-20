# MDV

Claude-style desktop Markdown editor built with Electron.

> [!IMPORTANT]
> MDV is distributed as an **unsigned macOS app**. There is no Apple Developer ID signing or notarization for this project.
> The install/update scripts below build or install MDV locally, copy `MDV.app` into `/Applications`, and clear the macOS quarantine attribute with `xattr -dr com.apple.quarantine` to reduce Gatekeeper friction.

## Install / Update

MDV supports two distribution paths: direct local builds from this repository, and GitHub Release installs.

### Direct build from source

Use this when you want to clone the repository and build the app yourself.

```bash
git clone https://github.com/oiysful/MDV.git
cd MDV
npm run install:local
```

For later updates from the same clone:

```bash
cd MDV
npm run update:local
```

`update:local` runs `git pull --ff-only origin main`, reinstalls dependencies, rebuilds unsigned, and replaces `/Applications/MDV.app`.

### Install from GitHub Releases

Use this when a release artifact is available and you do not want to build locally.

```bash
npm run install:release
```

For later release-based updates:

```bash
npm run update:release
```

By default, release scripts install the latest GitHub Release. To install a specific tag:

```bash
MDV_RELEASE_TAG=v1.0.0 npm run install:release
```

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
- DOMPurify

Renderer libraries are bundled locally and loaded from `node_modules/` by `src/renderer/index.html`; the CSP allows no remote script origins. Rendered markdown is sanitized with DOMPurify before it reaches the DOM.

## Renderer Structure

The renderer is no longer a single inline `<script>` block.

Current split:

- `src/renderer/index.html` — shell markup + CSS + script tags
- `src/renderer/app.js` — thin renderer bootstrap that wires controller modules and creates the renderer command registry
- `src/renderer/app-runtime.js` — shared renderer command/runtime orchestration for empty state, shortcuts, and toolbar actions
- `src/renderer/app-shell.js` — DOM ref collection, startup wiring, `data-command` binding, and shared shell event handling
- `src/renderer/document-flow.js` — file open/save/save-as/watch lifecycle
- `src/renderer/explorer.js` — explorer tree plus root/header state ownership
- `src/renderer/context-menu.js` — floating context menu controller
- `src/renderer/shell-actions.js` — add-menu, welcome-guide entry actions, and drag/drop handling
- `src/renderer/path-utils.js` — path/link helper logic
- `src/renderer/theme.js` — theme state + stylesheet switching
- `src/renderer/search.js` — in-document search controller
- `src/renderer/onboarding.js` — first-launch / entry-affordance / toast UI logic
- `src/renderer/markdown.js` — markdown rendering, stats, TOC, image resolution helpers

Renderer command entry points now route through a grouped `rendererCommands` registry, delegated `data-command` listeners, generated-copy delegation, and explicit `renderer-command` IPC from the main menu.

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
- main-process `file-opened` flow
- save / save-as behavior
- file watcher rewiring and external change refresh
- folder open / explorer filtering
- shared context menu behavior
- add-menu and drag/drop shell actions
- renderer command dispatch without window command globals or inline handlers
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
- `dist/MDV-1.0.0-arm64-mac.zip`

## Distribution Notes

- MDV is intentionally distributed without Apple Developer ID signing or notarization.
- Local install/update scripts build with `CSC_IDENTITY_AUTO_DISCOVERY=false` and `--publish=never`.
- All install/update scripts replace `/Applications/MDV.app` and run `xattr -dr com.apple.quarantine` on the installed app bundle.
- If `/Applications` is not writable for your user, rerun the install/update command with appropriate macOS permissions.

## Security / Architecture Notes

- Renderer code must use `window.api` only for privileged actions.
- New privileged filesystem or shell actions must be added in both:
  - `src/main.js`
  - `src/preload.js`
- Finder reveal is implemented through the preload/main bridge, not direct renderer access.

## Known Limitations

- IPC handlers still return JSON-encoded strings, so renderer consumers use parsing helpers/patterns instead of raw objects.
- `src/renderer/app.js` and `src/renderer/app-runtime.js` remain the next structural ownership hotspots.
- Notarization is still pending for friendlier macOS distribution.
