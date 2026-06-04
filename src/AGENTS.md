# SRC KNOWLEDGE BASE

## OVERVIEW
`src/` contains the full app runtime split across Electron main process, preload bridge, and renderer UI.

## STRUCTURE
```text
src/
├── main.js            # Electron entry, window lifecycle, IPC handlers, menu
├── preload.js         # `window.api` bridge
└── renderer/
    ├── index.html     # shell markup + CSS
    ├── app.js         # bootstrap/orchestration
    └── *.js           # split renderer controllers/helpers
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add native capability | `main.js` + `preload.js` | Add IPC handler first, then expose it |
| Change file watching | `main.js` watcher map, `renderer/document-flow.js`, `renderer/workspace.js` | Main owns chokidar; renderer swaps the active watch when tabs/documents change |
| Menu / shortcuts | `main.js#buildMenu`, `renderer/app.js#createRendererCommands` | Main sends `renderer-command` IPC events to named renderer commands |
| Open/save flows | `main.js` dialog handlers + renderer save/open functions | IPC payloads are JSON strings |
| Finder / external shell actions | `main.js` shell handlers + `preload.js` bridge | Keep renderer unprivileged |
| First-launch experience | `renderer/index.html` onboarding helpers + toolbar open entry | Renderer-only visual guidance; no native default-app mutation |
| Renderer refactor entry | `renderer/app.js` + sibling helper/controller files | Prefer extracting low-risk logic here before touching HTML shell |
| Theme sync | `main.js` native theme events + renderer `applyTheme` | Auto mode reacts to system theme |

## CONVENTIONS
- Process boundary matters here more than folder count.
- `main.js` owns filesystem, dialogs, and watcher lifecycle.
- `preload.js` is a thin mirror; keep names aligned with `ipcMain.handle(...)` channels.
- Renderer-facing events use `file-opened`, `file-changed`, `theme-changed`, and `renderer-command`.
- BrowserWindow uses `preload.js` via `webPreferences.preload`; keep that path valid.
- Shell integrations like browser-open or Finder-reveal belong in main via `shell`, never direct renderer access.
- Renderer helper/controller files are plain browser scripts loaded by `index.html`; avoid Node-only assumptions there.

## ANTI-PATTERNS
- Do not put business logic into `preload.js`; it is a bridge, not a second main process.
- Do not rename IPC channel strings in one file only.
- Do not bypass `createWindow()` when adding new windows; window defaults live there.
- Do not add renderer globals triggered by menu actions; extend the renderer command registry and `renderer-command` flow instead.

## NOTES
- Recent renderer command refactor has clean error-level diagnostics; remaining diagnostics are mostly style/accessibility warnings.
- `main.js` mixes lifecycle, IPC, and menu code in one file; keep edits targeted.
- `renderer/` is the only place with substantial UI complexity; read its local AGENTS file before large frontend edits.
- Current IPC surface includes external URL open and Finder reveal helpers in addition to markdown/file operations.
- Default-app guidance is manual UX only; this codebase does not programmatically force markdown default-app assignment.
- Test harness now exists at `tests/electron/` and `tests/unit/`; keep it green before each additional renderer extraction.
- Structural follow-up work should start from the renderer hotspots documented in the project README and local renderer notes.
