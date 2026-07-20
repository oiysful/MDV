# PROJECT KNOWLEDGE BASE

**Generated:** 2026-06-02

## OVERVIEW
Small Electron desktop app for editing and previewing Markdown with a Claude-inspired UI.
Main stack: Electron main/preload + split renderer HTML/CSS/JS modules.

## STRUCTURE
```text
./
├── src/              # app code: Electron main, preload bridge, renderer
├── assets/           # packaged desktop assets (icon only right now)
├── scripts/          # build/install/update shell scripts (see scripts/AGENTS.md)
├── package.json      # app entry, npm scripts, electron-builder config
└── package-lock.json # large generated lockfile
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| App bootstrap / window lifecycle | `src/main.js` | Electron entry from `package.json#main` |
| IPC contract | `src/main.js`, `src/preload.js` | Main handlers must stay mirrored in preload bridge |
| Renderer UI / styling / state | `src/renderer/index.html`, `src/renderer/*.js` | HTML/CSS shell plus split renderer modules |
| Packaging | `package.json#build` | `electron-builder` config lives inline |
| Distribution artifact | `dist/` | `MDV.app` + macOS `.zip` output after build (switched from `.dmg` 2026-07-20) |
| App icon | `assets/icon.icns` | macOS build asset |

## CODE MAP
| Symbol / Area | Location | Role |
|---------------|----------|------|
| `createWindow` | `src/main.js` | Creates BrowserWindow and loads renderer |
| `sendFile` | `src/main.js` | Reads markdown file and emits `file-opened` |
| `ipcMain.handle(...)` block | `src/main.js` | File IO, directory listing, save, watch, image loading |
| `contextBridge.exposeInMainWorld('api', ...)` | `src/preload.js` | Only renderer bridge to privileged APIs |
| `app.js` | `src/renderer/app.js` | Renderer bootstrap, controller wiring, and command registry creation |
| `app-shell.js` | `src/renderer/app-shell.js` | DOM ref collection, startup wiring, `data-command` binding, IPC event registration |
| `app-runtime.js` | `src/renderer/app-runtime.js` | Runtime command behavior, empty state, shortcuts, toolbar helpers |
| `document-flow.js` | `src/renderer/document-flow.js` | Open/save/save-as/watch document lifecycle |
| `context-menu.js` | `src/renderer/context-menu.js` | Renderer-managed floating context menu |
| `shell-actions.js` | `src/renderer/shell-actions.js` | Add-menu, welcome-guide entry actions, drag/drop handling |
| `theme.js` | `src/renderer/theme.js` | Theme controller and stylesheet switching |
| `path-utils.js` | `src/renderer/path-utils.js` | Pure path/link helpers |
| `markdown.js` | `src/renderer/markdown.js` | Markdown render pipeline, stats, TOC, snapshot capture/rehydration |
| `search.js` | `src/renderer/search.js` | In-document search controller |
| `onboarding.js` | `src/renderer/onboarding.js` | First-launch guidance and entry affordance logic |
| `workspace.js` | `src/renderer/workspace.js` | Tab state, dirty tracking, tab bar rendering, session-tab reporting |
| `editor.js` | `src/renderer/editor.js` | Source/split mode toggling, split-view sidebar force-hide |
| `explorer.js` | `src/renderer/explorer.js` | Explorer tree, keyboard nav, session-root restore |
| `roving.js` | `src/renderer/roving.js` | Shared roving-tabindex index math (tab bar + explorer tree) |
| `session-state.js` | `src/renderer/session-state.js` | Pure session-shape builder + empty-session guard |

## CONVENTIONS
- CommonJS everywhere; no TypeScript, bundler, or framework layer.
- Electron security posture is explicit: `contextIsolation: true`, `nodeIntegration: false`.
- Renderer must access privileged functionality through `window.api` only.
- IPC payloads are plain objects/arrays passed via contextBridge's structured clone — no `JSON.stringify`/`JSON.parse` wrapping (cleaned up 2026-07-20; `file-changed` was always the reference pattern, the rest now match it).
- UI copy is mixed Korean + English; menu labels and visible controls are Korean-heavy.
- Packaging config is kept inside `package.json`, not a separate builder file.
- Electron runtime belongs in `devDependencies` for distributable builds with `electron-builder`.

## ANTI-PATTERNS (THIS PROJECT)
- Do not call Node/Electron APIs directly from renderer code; extend `preload.js` instead.
- Do not add new file operations in renderer without matching IPC handler + preload bridge entry.
- Do not assume this app handles arbitrary file types: directory explorer and dialogs are markdown-focused.
- Do not scatter renderer logic into multiple assumptions without checking duplicated state paths (`EMPTY_HTML`, tab restore, watcher flow).
- Do not relax `read-image-data-url` back to serving any extension: the image path comes from untrusted markdown, and an unrestricted read is an arbitrary-file-read primitive (`![](../../.ssh/id_rsa)`).
- Do not drop the `will-navigate` / `setWindowOpenHandler` guards in `createWindow`: the renderer holds `window.api`, so any remote page loaded into that frame would inherit the bridge.
- Do not treat a watcher `change` event as external without checking it against `savedContent` — the app's own save echoes back through `chokidar` and prompting on it discards the user's in-flight typing.
- Do not capture `tab.renderedHTML` via `refs.content.innerHTML` directly; use `markdownController.captureSnapshotHTML()` — the raw `innerHTML` bakes every embedded image's full base64 payload into the tab's own copy, on top of the already-shared `imageDataUrlCache`.
- Do not persist an empty session (0 tabs and no explorer root) — `session-state.js#isEmptySession` guards every write in `main.js`; a blank `Cmd+N` window closing must never silently wipe a real saved session.
- Do not add a new `splitMode` mutation site outside `editor.js#setSplitMode` — it is the sole chokepoint that also force-closes/restores the sidebar; a second mutation path would bypass that.

## UNIQUE STYLES
- `src/renderer/index.html` remains the shell, but renderer logic is now progressively split into plain browser scripts under `src/renderer/`.
- Renderer command controls use `data-command` attributes bound by `app-shell.js`; do not reintroduce inline handlers or `window.openFile`-style command globals.
- Main menu actions dispatch explicit `renderer-command` IPC events rather than evaluating renderer-global function names.
- Markdown rendering uses locally bundled `marked`, `highlight.js`, and `DOMPurify` loaded from `node_modules/`; the CSP allows no remote script origins.
- Rendered markdown is sanitized with DOMPurify before it reaches `innerHTML`; untrusted `.md` files are treated as hostile input.
- File watching is per-path via `chokidar`, with a `path → { watcher, subscribers: Set<WebContents> }` map so several windows can watch one file; the watcher closes only when the last subscriber leaves. Active tab changes rewire the watch target, so only the active tab is watched per window.
- `webPreferences` sets `sandbox: true` alongside `contextIsolation`; the preload only uses `contextBridge`/`ipcRenderer`/`webUtils`, all of which are sandbox-safe.
- Directory explorer hides dot-directories and only surfaces `.md` / `.markdown` files.
- Explorer root has header actions for exact-path viewing, closing the opened root, and Finder reveal via context menu.
- Toolbar now includes save/print actions with dirty-state save enablement and transient save toast feedback.
- First launch emphasizes the top-right open entry point and shows a dismissible onboarding guide for opening files/folders and setting default app behavior manually.
- Test-first refactoring now uses Electron smoke tests plus small unit tests to guard renderer extractions.
- Tab bar (`role="tablist"`) and explorer tree (`role="tree"`) use roving tabindex with manual activation (arrows move focus only; Enter/Space performs the action) — shared index math lives in `roving.js`, not duplicated per widget.
- Session state (open tab paths, active index, explorer root) persists to `userData/session.json` via the main process, not `localStorage` — every window loads the same `file://index.html`, so `localStorage` is shared across windows and can't be used for per-window session data.
- `app.addRecentDocument` is called from exactly two renderer points: `workspace.js#createTab` (path-bearing tabs) and `document-flow.js#updateTabAfterSave` (save/save-as assigning a path) — not from the pre-save conflict-check `readFile` call.

## COMMANDS
```bash
npm start
npm run build
```

### Test tiers — run the cheap tiers constantly, the expensive tier once
```bash
npm run test:unit                   # 0.9s  — after every edit. Always run it whole.
npm run test:controller             # ~0.5s — after every edit that touches controller wiring (workspace/editor/search/explorer)
E2E="split view" npm run test:e2e   # ~2-18s — while iterating on one Electron-covered behavior
npm run test:electron               # ~60-90s — once, before declaring done or committing
```
`test:e2e` filters `smoke.test.js` by test name (`--test-name-pattern`). With `E2E` unset it
falls back to the full suite, so it is never silently a no-op. `test:controller`
(`tests/controller/*.test.js`) sits between unit and Electron: it drives 2-3 real controller
factories together over jsdom to catch cross-controller wiring regressions (e.g. a callback
that stops being called) that pure-helper unit tests can't see and that would otherwise only
surface in the much slower Electron suite.

## NOTES
- `tests/electron/smoke.test.js` covers real Electron boot/open/save/watch/explorer/shell/theme/session-restore/keyboard-nav flows and asserts removed renderer command globals/inline handlers.
- `tests/controller/*.test.js` drive real controller factories (not stubs) together over jsdom, wired via `tests/controller/helpers/harness.js`, to catch cross-controller callback wiring regressions.
- `tests/unit/*.test.js` cover extracted pure helpers and generated command markup.
- The Electron suite boots a fresh app per test via `tests/electron/helpers/launch.js` (each launch now gets an isolated `MDV_USER_DATA_DIR` so the suite never touches a real user profile / session.json). Do not run it after every edit — use `test:e2e` with a name pattern while iterating, and the full suite once before finishing.
- Do NOT build a changed-file-to-test mapper for the unit suite: unit tests run in under a second, so subsetting saves nothing and the mapping would rot on every rename. The cost is entirely Electron boots.
- `.github/workflows/release.yml` builds and attaches release artifacts on `v*` tag push (macOS runner, unsigned `.zip` + `SHA256SUMS`) — see README's Distribution Notes for the `GITHUB_TOKEN` requirement (none; it's the default Actions token, no repo secret to configure).
- Current error-level diagnostics are clean for the recent renderer command refactor; remaining warnings are mostly style-oriented.
- Repo is tiny by file count, but renderer complexity is concentrated in `src/renderer/index.html`.
- Local macOS packaging emits `dist/MDV-1.0.0-arm64-mac.zip` (switched from `.dmg` 2026-07-20); notarization is still not configured.
- Local Sisyphus planning files are intentionally ignored and should not be treated as tracked project documentation.
