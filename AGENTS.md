# PROJECT KNOWLEDGE BASE

**Generated:** 2026-06-02

## OVERVIEW
Small Electron desktop app for editing and previewing Markdown with a Claude-inspired UI.
Main stack: Electron main/preload + split renderer HTML/CSS/JS modules.

## STRUCTURE
```text
./
├── src/              # app code: Electron main, preload bridge, renderer
├── docs/             # plans (`docs/plans/`) and rendered diagrams (`docs/diagrams/`)
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
| Visual overview of a flow | `docs/diagrams/` | 5 standalone HTML views (architecture, release workflow, open+watch sequence, render data flow, tab lifecycle); generated from the sibling `*.json` specs, never hand-edited |

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
| `update-checker.js` | `src/update-checker.js` | Pure semver-ish comparison for the notify-only update banner (`app.getVersion()` vs. GitHub's latest release tag) |
| `update-notice.js` | `src/renderer/update-notice.js` | Update-available banner controller: show/dismiss, release-notes link, `brew upgrade` command copy |

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
- Do not hand a link target to `shell.openPath` without the `OPENABLE_EXTENSIONS` allowlist in `main.js#open-local-path`: the path comes from an untrusted `.md`, so an unrestricted open is a one-click local code execution primitive (`[Setup](./setup.command)`). Non-allowlisted extensions, directories (macOS `.app` bundles are directories), and symlinks whose realpath falls outside the list get `shell.showItemInFolder` only. Both the link name and its realpath must be checked — a name-only check is bypassed by `notes.pdf → setup.command`. `.svg` is deliberately excluded from the list (it can carry a `<script>`; local SVGs already render inertly in-app via `read-image-data-url`'s `data:` URI, so nothing needing `shell.openPath` is lost). The same realpath check applies to the markdown-read branch, not just the openable-extension branch — a `.md`-named symlink must resolve to a real `.md`/`.markdown` target too, or its content must not be read (`notes.md → ~/.ssh/id_rsa` bypassed a name-only check the same way).
- Do not build a renderer hint out of `innerHTML` when any part of it is dynamic — `explorer.js#loadDir`'s `list-directory` error carries OS text plus the directory name and must go in via `textContent`. The static `.tree-hint` literals are the only `innerHTML` hints allowed; CSP is the second line of defence, not the first.
- Do not add a new `splitMode` mutation site outside `editor.js#setSplitMode` — it is the sole chokepoint that also force-closes/restores the sidebar; a second mutation path would bypass that.
- Do not give a menu `accelerator` a key that a renderer keydown handler already owns without guarding it — a menu accelerator fires even when the renderer calls `preventDefault()` on that key, so both actions run on one press. `fb2284d` removed an old renderer `⌘T` handler that did call `preventDefault()`, and the menu still fired alongside it: one press, two tabs (`tests/electron/menu-and-guides.test.js` keeps the note). The colliding menu item must dispatch a shortcut-specific command (`click: (_, win, event) => sendRendererCommand(event?.triggeredByAccelerator ? 'toggleSidebarFromShortcut' : 'toggleSidebar', win)`) whose renderer handler bows out when the focused element owns the key — `app-runtime.js#toggleSidebarFromShortcut` is the reference (`⌘B` is bold inside `#source-editor`, sidebar toggle everywhere else). Both halves matter: dispatching the plain command always means bold *and* the panel toggle on one press, while dropping the `triggeredByAccelerator` branch means a deliberate mouse click on the menu item silently does nothing while the editor has focus. Any path that force-opens the sidebar needs the same guard, not just the toggle — `app-runtime.js#switchTab`'s force-open is the sibling (`openFolder` → `switchToExplorerTab`), and without its guard ⌘⇧O reopens the sidebar split view had force-closed into a state nothing can close. What automation can and cannot reach here was measured on 2026-09-16, so do not re-derive it: a **synthesized keypress never reaches macOS's menu key matching** — neither `webContents.sendInputEvent` nor Playwright's `page.keyboard.press('Meta+b')` (the latter applied bold and left the sidebar untouched), so whether a real ⌘B actually sets `triggeredByAccelerator` is hand-verified only. The **handler's branching is testable**, because `MenuItem#click` is a wrapper invoked as `click(event, focusedWindow, focusedWebContents)` that re-calls the item's own handler as `click(menuItem, focusedWindow, event)` — argument 1 lands in the handler's third parameter. That is why `clickApplicationMenuItem`'s `target.click(target, win, {})` reads as no-flag (the handler gets the MenuItem, which has no `triggeredByAccelerator`) and takes the mouse branch, and why `target.click({ triggeredByAccelerator: true }, win, {})` does reach the accelerator branch. Both branches are pinned in `menu-and-guides.test.js`.

## UNIQUE STYLES
- `src/renderer/index.html` remains the shell, but renderer logic is now progressively split into plain browser scripts under `src/renderer/`.
- Renderer command controls use `data-command` attributes bound by `app-shell.js`; do not reintroduce inline handlers or `window.openFile`-style command globals.
- Main menu actions dispatch explicit `renderer-command` IPC events rather than evaluating renderer-global function names.
- Markdown rendering uses locally bundled `marked`, `highlight.js`, `DOMPurify`, and `js-yaml` loaded eagerly from `node_modules/` at boot (js-yaml powers frontmatter parsing, which runs unconditionally at the top of every `render()`); `mermaid` (3.4MB) and `katex` are loaded lazily instead — `markdown.js#render()` regex-scans the raw text for a ` ```mermaid `/` ```latex `/` ```math ` fence before parsing and, only if one is present, dynamically injects the `<script>` and awaits it (`ensureMermaidLoaded`/`ensureKatexLoaded`, cached per load so a second document reuses the same promise). A document with neither fence never pays either library's parse/execute cost. The CSP allows no remote script origins, no remote images (`img-src 'self' data:` — local images arrive as `data:` URIs from `read-image-data-url`), and pins `form-action`/`base-uri`/`object-src` to `'none'`; the dynamic `<script src>` stays same-origin (a local `node_modules/` path) so this doesn't touch `script-src 'self'`. `tests/unit/csp.test.js` parses the meta tag directive-by-directive so any CSP relaxation has to be a deliberate edit. ` ```mermaid `/` ```latex `/` ```math ` fences own their block entirely (`renderer.code` in `markdown.js`) instead of going through hljs — see the DOMPurify anti-pattern below for why mermaid's source is base64-encoded into a `data-*` attribute; katex needs no such workaround since it's synchronous and escapes its own output. mermaid's `mermaid.initialize({...theme})` call used to happen once at boot inside `themeController`'s `onThemeApplied`; since mermaid may not exist yet at boot now, `createMarkdownController`'s `onMermaidLoaded` callback (wired in `app.js`) re-runs that same initialize once the lazy load actually completes, reading the current theme via `themeController.getIsDark()` (a pure accessor, no side effects) — skipping this is a silent bug where the first diagram in a session always renders in the light theme regardless of the app's actual theme.
- Frontmatter (`markdown.js#extractFrontmatter`) parses the `---`-delimited block with `js-yaml.load()` (real YAML, not a regex line-scanner), resolved via `globalScope.jsyaml || require('js-yaml')` so the same code path works from the browser's `<script>`-tag global and from Node unit tests' `require()`. Malformed YAML or a non-mapping top level (e.g. a bare array) falls back to `frontmatter: null` with the original text untouched — same "when ambiguous, don't touch it" policy as the no-closing-`---` case, rather than partially eating content. Values keep their parsed YAML type (string/number/boolean/null/Date/array/object); `renderFrontmatterValue`/`renderFrontmatterObject` in the same file render them recursively, so arbitrarily nested structures (arrays of objects, objects containing arrays, ...) share one code path instead of per-shape special cases — simple arrays become `<ul class="frontmatter-list">`, objects and object-array items become nested `<table class="frontmatter-nested">`, and multiline block-scalar strings (`|`/`>`/chomping variants — js-yaml already folds/chomps per spec) get wrapped in `.frontmatter-multiline` (`white-space: pre-wrap`) so embedded `\n` survives visually.
- File watching is per-path via `chokidar`, with a `path → { watcher, subscribers: Set<WebContents> }` map so several windows can watch one file; the watcher closes only when the last subscriber leaves. Active tab changes rewire the watch target, so only the active tab is watched per window.
- Directory watching (`main.js#watch-directory`, a separate `dirWatchers` map) only goes 1 level deep (`DIR_WATCH_DEPTH`) and skips common build-output directories (`dist`/`build`/`out`/`coverage`/`target`/`vendor`, alongside `node_modules`/dot-directories) via `DIR_WATCH_IGNORED` — chokidar has no fsevents fast path on macOS (confirmed against its source: it's a plain `fs.watch()` per directory, tracked in its own `FsWatchInstances` map), so an unfiltered deep watch on a large container folder (e.g. one holding several repos) enumerates and natively watches tens of thousands of paths, stalling the single-threaded main process badly enough to look like a hang and to delay unrelated main-process work queued behind it (including quit). A `makeGuardedIgnore` count guard (`DIR_WATCH_MAX_PATHS`, overridable via `MDV_TEST_DIR_WATCH_MAX_PATHS` for tests) is a second line of defense: once a root's watch has looked at more paths than that, the watcher closes itself and the renderer gets a `directory-watch-unavailable` toast instead of an unbounded scan. The explorer tree itself is unaffected by any of this — `list-directory` is already a single non-recursive `readdir` per expand, so folder Browse stays correct at any depth; only *live auto-refresh* on an external change outside the watched depth is lost (collapsing/re-expanding that folder re-reads it and picks up the change anyway).
- Session restore (`app.js#restoreSession`) only fully renders the tab that was active when the session was saved; every other restored tab goes through `workspace.js#createBackgroundTab` (a `createTab` sibling, never modifies it) instead — same tab object, but skips `render()`/scroll-reset/snapshot-capture and is marked `previewDirty: true`. It renders lazily the first time `switchToTab` actually activates it, reusing `restoreTabState`'s existing stale-preview-on-switch path (originally built for a background tab picking up an external change while inactive) rather than new lazy-render machinery. `createTab` itself must stay untouched by any future change here — controller/unit tests call it expecting an immediately-rendered tab.
- `webPreferences` sets `sandbox: true` alongside `contextIsolation`; the preload only uses `contextBridge`/`ipcRenderer`/`webUtils`, all of which are sandbox-safe.
- Directory explorer hides dot-directories and only surfaces `.md` / `.markdown` files.
- Explorer root has header actions for exact-path viewing, closing the opened root, and Finder reveal via context menu.
- Toolbar now includes save/print actions with dirty-state save enablement and transient save toast feedback.
- First launch emphasizes the top-right open entry point and shows a dismissible onboarding guide for opening files/folders and setting default app behavior manually.
- Test-first refactoring now uses Electron smoke tests plus small unit tests to guard renderer extractions.
- Tab bar (`role="tablist"`) and explorer tree (`role="tree"`) use roving tabindex with manual activation (arrows move focus only; Enter/Space performs the action) — shared index math lives in `roving.js`, not duplicated per widget.
- Session state (open tab paths, active index, explorer root) persists to `userData/session.json` via the main process, not `localStorage` — every window loads the same `file://index.html`, so `localStorage` is shared across windows and can't be used for per-window session data.
- `app.addRecentDocument` is called from exactly two renderer points: `workspace.js#createTab` (path-bearing tabs) and `document-flow.js#updateTabAfterSave` (save/save-as assigning a path) — not from the pre-save conflict-check `readFile` call.
- The app is unsigned/un-notarized (see `RELEASING.md`), so Electron's `autoUpdater` (Squirrel.Mac) cannot apply an update on macOS even if one were fetched — a **notify-only** update checker (`src/update-checker.js` + `main.js`'s `maybeCheckForUpdate`/`fetchLatestReleaseTag`, `src/renderer/update-notice.js`) polls `GET /repos/{owner}/{repo}/releases/latest` (owner/repo overridable via `MDV_REPO_OWNER`/`MDV_REPO_NAME`, mainly for tests) once per app launch via `net.request`, throttled to real network calls once per 24h (`update-check.json` in `userData`, same read/write-with-try/catch pattern as `session.json`) but re-broadcasting the last known result on every relaunch inside that window so the banner isn't silently lost to the throttle. A newer, non-dismissed release pushes `update-available` (`{ version, tagName, releaseUrl }` or `null` to hide) to every window; the renderer shows a dismissible bottom-right banner pointing at `brew upgrade --cask oiysful/tap/mdv` plus a release-notes link (reusing `open-external-url`, not a new IPC channel). Dismissing a version persists to the same state file via `dismiss-update-notice` (`ipcMain.on`) so it doesn't reappear until a newer release ships. Runs 5s after `createWindow()` (not inside `did-finish-load`, which fires per-window/per-reload and would otherwise fan out into duplicate fetches) and is skipped entirely under `MDV_TEST_SKIP_UPDATE_CHECK` (set by default in `tests/electron/helpers/launch.js`). See `docs/plans/15-in-app-update-notification.md` for why this is notify-only rather than a real auto-updater.
- TOC scrollspy has two independent position sources depending on mode: preview/split track `#content`'s rendered DOM (`markdown.js#buildToc`/`refreshHeadingOffsets`, offsets via `offsetTop`), but pure source mode can't — `#content` is `display:none` there and never re-rendered while typing, so `offsetTop` on anything inside it reads 0. Pure source mode instead tracks the raw source text's own line positions (`markdown.js#extractHeadingsFromSource`/`rebuildSourceModeToc`, `editor.js#computeSourceModeGeometry`/`refreshSourceModeToc`, debounced on input via `scheduleSourceModeTocRebuild`). Do not call `refreshHeadingOffsets()` while `#content` is hidden — `editor.js#applySourceMode` is the one chokepoint that already branches on `isPureSourceMode()` to pick the right one.
- Cmd+Enter in the source editor ("insert line below", VSCode-style) and plain Enter's list-continuation both resolve "end of the current line" via the shared `editor.js#getLineEnd(text, cursor)` helper — don't reintroduce a second inline computation of the same thing.

## COMMANDS
```bash
npm start
npm run build
```

### Test tiers — run the cheap tiers constantly, the expensive tier once
```bash
npm run test:unit                   # 0.9s  — after every edit. Always run it whole.
npm run test:controller             # ~0.5s — after every edit that touches controller wiring (workspace/editor/search/explorer)
E2E="split view" npm run test:e2e   # ~2-10s — while iterating on one Electron-covered behavior
npm run test:electron               # ~30s  — once, before declaring done or committing
```
`test:e2e` filters the split Electron test files (`tests/electron/*.test.js`, 13 files) by
test name (`--test-name-pattern`). With `E2E` unset it falls back to the full suite, so it
is never silently a no-op. `test:controller`
(`tests/controller/*.test.js`) sits between unit and Electron: it drives 2-3 real controller
factories together over jsdom to catch cross-controller wiring regressions (e.g. a callback
that stops being called) that pure-helper unit tests can't see and that would otherwise only
surface in the much slower Electron suite.

## NOTES
- `tests/electron/*.test.js` (13 files, split by topic from the former single `smoke.test.js` so Node's test runner parallelizes across files — see filenames for grouping: boot-and-render, tabs, editor-source-mode, split-view-core/async, file-watching, explorer-and-shell, search, menu-and-guides, links-and-toc, keyboard-and-a11y, session-and-windows, security-and-scroll) covers real Electron boot/open/save/watch/explorer/shell/theme/session-restore/keyboard-nav flows and asserts removed renderer command globals/inline handlers. Shared fixtures/helpers used by 2+ files live in `tests/electron/helpers/smoke-helpers.js`; helpers used by only one file are defined locally in it.
- `tests/controller/*.test.js` drive real controller factories (not stubs) together over jsdom, wired via `tests/controller/helpers/harness.js`, to catch cross-controller callback wiring regressions.
- `tests/unit/*.test.js` cover extracted pure helpers and generated command markup.
- The Electron suite boots a fresh app per test via `tests/electron/helpers/launch.js` (each launch now gets an isolated `MDV_USER_DATA_DIR` so the suite never touches a real user profile / session.json). Do not run it after every edit — use `test:e2e` with a name pattern while iterating. CI runs the full suite on every PR/push (see `.github/workflows/ci.yml`'s `test-electron` job), but it's still worth running locally once before pushing to get faster first signal than waiting on CI.
- Do NOT build a changed-file-to-test mapper for the unit suite: unit tests run in under a second, so subsetting saves nothing and the mapping would rot on every rename. The cost is entirely Electron boots.
- `.github/workflows/release.yml` builds and attaches release artifacts on `v*` tag push (macOS runner, unsigned `.zip` + `SHA256SUMS`) — see RELEASING.md's Required secrets section for the `GITHUB_TOKEN` requirement (none; it's the default Actions token, no repo secret to configure).
- The same workflow then runs `scripts/update-homebrew-tap.sh` to bump `oiysful/homebrew-tap`'s `Casks/mdv.rb` (`version`/`sha256`), so `brew install --cask oiysful/tap/mdv` / `brew upgrade` track releases automatically. This step needs the `HOMEBREW_TAP_TOKEN` repo secret (a PAT with write access to the tap repo — already configured); without it the step no-ops instead of failing the release. `oiysful/homebrew-tap` is a general multi-project tap (not MDV-specific) — other casks/formulae may live alongside `Casks/mdv.rb` there. Also note: Homebrew Core already ships an unrelated formula literally named `mdv` (a terminal markdown viewer), so `brew install mdv` without `--cask` installs the wrong tool — always use the full `--cask oiysful/tap/mdv` form in docs/scripts.
- Current error-level diagnostics are clean for the recent renderer command refactor; remaining warnings are mostly style-oriented.
- Repo is tiny by file count, but renderer complexity is concentrated in `src/renderer/index.html`.
- Local macOS packaging emits `dist/MDV-<version>-arm64-mac.zip` (filename follows `package.json#version`; switched from `.dmg` 2026-07-20); notarization is still not configured.
- Local Sisyphus planning files are intentionally ignored and should not be treated as tracked project documentation.
- `README.md`, `CONTRIBUTING.md`, and `RELEASING.md` each have a Korean translation (`README.ko.md`, `CONTRIBUTING.ko.md`, `RELEASING.ko.md`) added 2026-08-06, cross-linked to each other via a language-switcher line at the top of each file. The `.ko.md` files link to each other (not back to the English originals) so a Korean reader stays in Korean docs end to end. When editing content in one of the English files, update its `.ko.md` counterpart in the same change — they're expected to stay in sync, not just exist once. `AGENTS.md` itself is intentionally excluded (project/agent-facing, not public-facing).
- `docs/diagrams/` holds five standalone HTML diagram views, each generated from the `*.json` spec beside it: architecture, release workflow, open+watch sequence, render data flow, and tab lifecycle. Their content is derived from this file plus `src/AGENTS.md`, `src/renderer/AGENTS.md`, `README.md`, and `RELEASING.md` — so a structural change in any of those (a new IPC channel, a changed release step, a new render stage, a new tab state) should update the matching spec and regenerate in the same change, the same way `.ko.md` counterparts are kept in sync. Never hand-edit the HTML: it is fully regenerated from the spec and manual edits are silently lost on the next render. `docs/diagrams/README.md` carries the per-type regeneration commands, and the `*.visual-check.*` receipts/captures the render tooling emits are gitignored as regenerable evidence. The diagrams are authored in Korean; the viewer's own chrome and legend stay English because the renderer's locale support does not include Korean.


## 🔐 Security Skill Active

This project uses security-skill for automated security engineering.

**At the start of every session:**
1. Read `.skills/security/skill.md` — security engineering instructions (25 categories)
2. Read `memory-security.md` — project security state and history
3. Be ready for: `/security-scan`, `/security-audit`, `/security-fix`, `/security-status`, `/security-incident`

You are acting as both a developer assistant AND a security engineer.
Proactively flag security issues in all code you write or review.
