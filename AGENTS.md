# PROJECT KNOWLEDGE BASE

**Generated:** 2026-06-01

## OVERVIEW
Small Electron desktop app for editing and previewing Markdown with a Claude-inspired UI.
Main stack: Electron main/preload + single-file renderer HTML/CSS/JS.

## STRUCTURE
```text
./
├── src/              # app code: Electron main, preload bridge, renderer
├── assets/           # packaged desktop assets (icon only right now)
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
| Distribution artifact | `dist/` | `MDV.app` + macOS `.dmg` output after build |
| App icon | `assets/icon.icns` | macOS build asset |

## CODE MAP
| Symbol / Area | Location | Role |
|---------------|----------|------|
| `createWindow` | `src/main.js` | Creates BrowserWindow and loads renderer |
| `sendFile` | `src/main.js` | Reads markdown file and emits `file-opened` |
| `ipcMain.handle(...)` block | `src/main.js` | File IO, directory listing, save, watch, image loading |
| `contextBridge.exposeInMainWorld('api', ...)` | `src/preload.js` | Only renderer bridge to privileged APIs |
| `app.js` | `src/renderer/app.js` | Renderer bootstrap, shared state, workspace orchestration |
| `theme.js` | `src/renderer/theme.js` | Theme controller and stylesheet switching |
| `path-utils.js` | `src/renderer/path-utils.js` | Pure path/link helpers |
| `markdown.js` | `src/renderer/markdown.js` | Markdown render pipeline, stats, TOC |
| `search.js` | `src/renderer/search.js` | In-document search controller |
| `onboarding.js` | `src/renderer/onboarding.js` | First-launch guidance and entry affordance logic |

## CONVENTIONS
- CommonJS everywhere; no TypeScript, bundler, or framework layer.
- Electron security posture is explicit: `contextIsolation: true`, `nodeIntegration: false`.
- Renderer must access privileged functionality through `window.api` only.
- Main process returns JSON-encoded payloads from IPC handlers instead of raw objects.
- UI copy is mixed Korean + English; menu labels and visible controls are Korean-heavy.
- Packaging config is kept inside `package.json`, not a separate builder file.
- Electron runtime belongs in `devDependencies` for distributable builds with `electron-builder`.

## ANTI-PATTERNS (THIS PROJECT)
- Do not call Node/Electron APIs directly from renderer code; extend `preload.js` instead.
- Do not add new file operations in renderer without matching IPC handler + preload bridge entry.
- Do not assume this app handles arbitrary file types: directory explorer and dialogs are markdown-focused.
- Do not scatter renderer logic into multiple assumptions without checking duplicated state paths (`EMPTY_HTML`, tab restore, watcher flow).

## UNIQUE STYLES
- `src/renderer/index.html` remains the shell, but renderer logic is now progressively split into plain browser scripts under `src/renderer/`.
- Markdown rendering uses CDN-loaded `marked` and `highlight.js` under an explicit CSP allowlist.
- File watching is per-path via `chokidar`; active tab changes rewire the watch target.
- Directory explorer hides dot-directories and only surfaces `.md` / `.markdown` files.
- Explorer root has header actions for exact-path viewing, closing the opened root, and Finder reveal via context menu.
- Toolbar now includes save/print actions with dirty-state save enablement and transient save toast feedback.
- First launch emphasizes the top-right open entry point and shows a dismissible onboarding guide for opening files/folders and setting default app behavior manually.
- Test-first refactoring now uses Electron smoke tests plus small unit tests to guard renderer extractions.

## COMMANDS
```bash
npm start
npm run build
```

## NOTES
- `tests/electron/smoke.test.js` covers real Electron boot/open/theme flows; `tests/unit/*.test.js` cover extracted pure helpers.
- No repo-local CI workflow found.
- Current editor/LSP diagnostics flag existing Biome issues in `src/main.js` and renderer markup/scripts; they are still mostly accessibility/style warnings, not this app's core runtime flow.
- Repo is tiny by file count, but renderer complexity is concentrated in `src/renderer/index.html`.
- Local macOS packaging currently works and emits `dist/MDV-1.0.0-arm64.dmg`, but notarization is still not configured.
