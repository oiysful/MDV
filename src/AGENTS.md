# SRC KNOWLEDGE BASE

## OVERVIEW
`src/` contains the full app runtime split across Electron main process, preload bridge, and renderer UI.

## STRUCTURE
```text
src/
├── main.js            # Electron entry, window lifecycle, IPC handlers, menu
├── preload.js         # `window.api` bridge
└── renderer/
    └── index.html     # full renderer app
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add native capability | `main.js` + `preload.js` | Add IPC handler first, then expose it |
| Change file watching | `main.js` watcher map, `renderer/index.html` `watchFile(...)` | Main owns chokidar; renderer swaps active watch |
| Menu / shortcuts | `main.js#buildMenu` | Uses `executeJavaScript(...)` hooks into renderer globals |
| Open/save flows | `main.js` dialog handlers + renderer save/open functions | IPC payloads are JSON strings |
| Finder / external shell actions | `main.js` shell handlers + `preload.js` bridge | Keep renderer unprivileged |
| Theme sync | `main.js` native theme events + renderer `applyTheme` | Auto mode reacts to system theme |

## CONVENTIONS
- Process boundary matters here more than folder count.
- `main.js` owns filesystem, dialogs, and watcher lifecycle.
- `preload.js` is a thin mirror; keep names aligned with `ipcMain.handle(...)` channels.
- Renderer-facing events use `file-opened`, `file-changed`, and `theme-changed`.
- BrowserWindow uses `preload.js` via `webPreferences.preload`; keep that path valid.
- Shell integrations like browser-open or Finder-reveal belong in main via `shell`, never direct renderer access.

## ANTI-PATTERNS
- Do not put business logic into `preload.js`; it is a bridge, not a second main process.
- Do not rename IPC channel strings in one file only.
- Do not bypass `createWindow()` when adding new windows; window defaults live there.
- Do not add renderer globals triggered by menu actions without checking `buildMenu()` callers.

## NOTES
- Existing lint diagnostics include `forEach` callback return issues in `main.js`.
- `main.js` mixes lifecycle, IPC, and menu code in one file; keep edits targeted.
- `renderer/` is the only place with substantial UI complexity; read its local AGENTS file before large frontend edits.
- Current IPC surface includes external URL open and Finder reveal helpers in addition to markdown/file operations.
