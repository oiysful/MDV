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
- Clicking a local file link (relative or absolute) opens it directly — markdown as a new tab, other files via the OS default app
- Session restore: open tabs and the explorer root reopen automatically on next launch; recently opened/saved files appear in the macOS Dock's "최근 항목" menu
- Split view always keeps the sidebar closed while active, restoring it to its prior state on exit
- Keyboard-accessible tab bar and explorer tree (roving tabindex, arrow-key navigation)
- Holding ⌘ reveals shortcut badges on buttons that have a real system accelerator
- macOS distributable build via `electron-builder`, with a CI workflow that attaches build artifacts to tagged GitHub Releases

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
- `src/renderer/workspace.js` — tab state, tab bar rendering/keyboard nav, dirty tracking, session-tab reporting
- `src/renderer/editor.js` — source/split mode toggling, split-view sidebar force-hide
- `src/renderer/explorer.js` — explorer tree plus root/header state ownership, keyboard nav, session-root restore
- `src/renderer/roving.js` — shared roving-tabindex index math for the tab bar and explorer tree
- `src/renderer/context-menu.js` — floating context menu controller
- `src/renderer/shell-actions.js` — add-menu, welcome-guide entry actions, and drag/drop handling
- `src/renderer/path-utils.js` — path/link helper logic
- `src/renderer/theme.js` — theme state + stylesheet switching
- `src/renderer/search.js` — in-document search controller
- `src/renderer/onboarding.js` — first-launch / entry-affordance / toast UI logic
- `src/renderer/markdown.js` — markdown rendering, stats, TOC, image resolution, snapshot capture/rehydration
- `src/renderer/session-state.js` — pure session-shape builder + empty-session guard

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
- roving-tabindex index math
- session-state shape building and the empty-session guard

### Controller tests

```bash
npm run test:controller
```

Sits between the unit and Electron tiers: drives 2-3 real controller factories (not stubs)
together over jsdom to catch cross-controller wiring regressions — e.g. a callback that
stops reaching another controller — without booting Electron.

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
- local file link opening (markdown as new tab, other files via OS default app, missing-file error)
- Cmd-hold shortcut badges
- split-view sidebar force-hide/restore
- tab scroll-into-view and keyboard-accessible tab bar / explorer tree
- session restore, empty-session guard, and recent-document registration across relaunch

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
- `dist/MDV-1.0.2-arm64-mac.zip`

## Distribution Notes

- MDV is intentionally distributed without Apple Developer ID signing or notarization.
- Local install/update scripts build with `CSC_IDENTITY_AUTO_DISCOVERY=false` and `--publish=never`.
- All install/update scripts replace `/Applications/MDV.app` and run `xattr -dr com.apple.quarantine` on the installed app bundle.
- If `/Applications` is not writable for your user, rerun the install/update command with appropriate macOS permissions.
- Pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds the same unsigned `.zip` on a macOS runner and attaches it plus a `SHA256SUMS` file to that tag's GitHub Release. `npm run install:release` / `update:release` depend on these assets being present — a tag without a completed release run will not have a downloadable build. If a release run fails or a tag was pushed before this workflow existed, build locally and attach the artifacts manually: `npm run build -- --publish=never`, then `shasum -a 256 dist/MDV-*.zip > dist/SHA256SUMS` and `gh release upload <tag> dist/MDV-*.zip dist/SHA256SUMS`.
- The workflow's `GITHUB_TOKEN` (`env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`) is **not** a repo secret you need to create — it's the automatic per-run token GitHub Actions injects into every workflow, scoped to that run only. The only thing to verify is that the repo's **Settings → Actions → General → Workflow permissions** is set to "Read and write permissions" (or at least "read" plus the `contents: write` the workflow already declares at the top) — a repo defaulted to read-only Actions permissions would make `softprops/action-gh-release`'s upload step fail with a 403 even though the token itself needs no setup.

## Security / Architecture Notes

- Renderer code must use `window.api` only for privileged actions.
- New privileged filesystem or shell actions must be added in both:
  - `src/main.js`
  - `src/preload.js`
- Finder reveal is implemented through the preload/main bridge, not direct renderer access.

## Known Limitations

- `src/renderer/app.js` and `src/renderer/app-runtime.js` remain the next structural ownership hotspots.
- Notarization is still pending for friendlier macOS distribution.
- Session restore persists only the last-focused window's state (file paths + active tab index + explorer root); multi-window session merging is out of scope for v1.
