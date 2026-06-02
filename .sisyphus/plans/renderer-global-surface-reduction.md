# Renderer Global Surface Reduction Plan

> Status: Completed on 2026-06-02. Implemented the planned migration through the static shell, drag/drop, menu IPC, runtime empty-state CTAs, generated copy buttons, smoke-test boot contract, and removal of the old renderer command window aliases. Verified with `npm run test:unit`, `npm run test:electron`, and `npm run build`.

## Goal

Shrink the renderer's broad `Object.assign(window, ...)` surface in controlled waves without breaking Electron menu hooks, inline HTML handlers, generated markdown callbacks, or smoke-tested boot behavior.

This is a migration plan only. It does **not** remove globals yet.

## Current renderer-global inventory

Current `Object.assign(window, ...)` exports in `src/renderer/app.js`:

- `openFile`
- `openFolder`
- `saveFile`
- `saveFileAs`
- `toggleSidebar`
- `toggleSource`
- `toggleSearch`
- `copyAll`
- `printDoc`
- `toggleTheme`
- `toggleAddMenu`
- `hideAddMenu`
- `dismissWelcomeGuide`
- `openFromGuide`
- `searchPrev`
- `searchNext`
- `closeSearch`
- `switchTab`
- `toggleExplorerPathInfo`
- `clearExplorerRoot`
- `goTop`
- `copyCode`

Additional live renderer-global entry points that are **not** currently in `Object.assign(window, ...)` but are still used by inline markup:

- `onDragOver`
- `onDragLeave`
- `onDrop`

## Known callers by category

### 1. Electron main-menu string hooks

`src/main.js` currently uses `executeJavaScript(...)` for:

- `openFile()`
- `openFolder()`
- `saveFile()`
- `saveFileAs()`

These are the most fragile global dependencies because they rely on string evaluation in the focused window.

### 2. Inline handlers in `src/renderer/index.html`

Current inline markup depends on:

- `toggleSidebar()`
- `toggleSource()`
- `toggleSearch()`
- `copyAll()`
- `saveFile()`
- `printDoc()`
- `toggleTheme()`
- `toggleAddMenu(event)`
- `hideAddMenu()`
- `openFolder()`
- `openFile()`
- `dismissWelcomeGuide()`
- `openFromGuide('file' | 'folder')`
- `searchPrev()`
- `searchNext()`
- `closeSearch()`
- `switchTab('toc' | 'explorer')`
- `toggleExplorerPathInfo()`
- `clearExplorerRoot()`
- `onDragOver(event)`
- `onDragLeave()`
- `onDrop(event)`
- `goTop()`

### 2b. Inline handlers recreated by runtime empty-state HTML

`src/renderer/app.js` rebuilds empty-state markup through `EMPTY_HTML`, which also depends on globals:

- `openFile()`
- `openFolder()`

These callers are easy to miss because they are not authored in `index.html`, but they are still part of the live global contract.

### 3. Generated HTML callbacks

`src/renderer/markdown.js` emits rendered code-block HTML that depends on:

- `copyCode(this)`

This is separate from static inline markup because the callback is injected into preview HTML at render time.

### 4. Internal non-global callers already exist

Many behaviors already have controller-local entry points and do not require globals internally anymore:

- document lifecycle → `document-flow.js`
- explorer root/header → `explorer.js`
- floating menu → `context-menu.js`
- shell interactions → `shell-actions.js`
- search/theme/editor/workspace controllers

That means most remaining globals are now compatibility shims rather than true ownership points.

## Risk areas

### Menu integration risk

`executeJavaScript('openFile()')` style hooks in `src/main.js` assume global function names remain stable. Removing those globals first would silently break the app menu.

### Inline HTML risk

The renderer shell still contains many `onclick` and drag/drop attributes. Removing globals before converting those nodes to bound listeners would break visible UI affordances immediately.

### Generated markdown risk

`copyCode(this)` is embedded in rendered preview HTML from `markdown.js`. This is not discoverable by searching `index.html` alone, so it must be migrated separately.

### Smoke-test timing risk

Electron smoke tests currently wait for key globals during boot. Any migration must preserve equivalent callable entry points until the tests and boot contract are updated together.

## Recommended migration order

### Wave 1 — Inventory-preserving alias pass

Goal: keep behavior identical while making the global surface explicit and traceable.

Steps:

1. Replace the raw `Object.assign(window, ...)` block with a named registry object, for example `const rendererCommands = { ... }`.
2. Export that registry onto `window` unchanged for compatibility.
3. Add comments grouping commands by caller type: menu, inline shell, generated preview, legacy convenience.

Why first:

- no behavior change
- creates a single inventory source of truth
- makes later deletions auditable

Validation:

- `npm run test:electron`
- confirm required globals still exist from the boot smoke test

### Wave 2 — Migrate static inline markup to bound listeners

Goal: remove dependency on globals from `src/renderer/index.html` without touching main-menu hooks yet.

Candidate targets first:

- toolbar buttons (`toggleSidebar`, `toggleSource`, `toggleSearch`, `copyAll`, `saveFile`, `printDoc`, `toggleTheme`)
- add-menu actions (`openFolder`, `openFile`, `hideAddMenu`)
- welcome-guide buttons (`dismissWelcomeGuide`, `openFromGuide`)
- sidebar tabs (`switchTab`)
- explorer-header buttons (`toggleExplorerPathInfo`, `clearExplorerRoot`)
- go-top button (`goTop`)

Keep for a later wave:

- drag/drop attributes if converting them becomes noisy
- generated preview callbacks
- runtime-generated empty-state CTA markup if it is easier to migrate alongside its rendering helper

Validation:

- `npm run test:electron`
- manual smoke: cold launch, open file, open folder, add-menu open/close, source toggle, search open/close, go-top, welcome-guide buttons

### Wave 3 — Move drag/drop handlers off inline attributes

Goal: replace `ondragover`, `ondragleave`, and `ondrop` markup hooks with event listeners bound during shell/bootstrap setup.

Why separate:

- drag/drop is behaviorally distinct
- easier to verify in isolation
- already has a dedicated shell-actions controller
- these handlers currently remain implicit globals even though they are not part of `Object.assign(window, ...)`

Validation:

- `npm run test:electron`
- manual smoke: drag `.md` file into the app and verify it opens as a tab

### Wave 4 — Replace main-menu `executeJavaScript(...)` string hooks

Goal: stop relying on global names for app-menu actions.

Preferred direction:

1. add a focused renderer command bridge in preload/main, or
2. send explicit IPC events from main to renderer and dispatch them in bootstrap

Targets:

- file open
- folder open
- save
- save as

Why after inline migration:

- it isolates menu-only dependencies
- reduces the remaining required global set to a much smaller compatibility surface

Validation:

- `npm run test:electron`
- manual smoke: trigger the same actions from the app menu, not only toolbar shortcuts

### Wave 5 — Migrate generated preview callbacks

Goal: remove `copyCode(this)` from rendered markdown HTML.

Preferred direction:

- render semantic buttons with data attributes
- handle copy clicks through delegated preview event listeners

Why last:

- it changes generated markdown HTML
- it affects content rendered from user documents rather than static shell markup

Validation:

- `npm run test:electron`
- manual smoke: open markdown with fenced code block, click copy button, verify copied state still appears and clipboard text matches code content

### Wave 6 — Delete no-longer-needed window aliases

Goal: remove compatibility exports only after every caller category above is migrated.

Deletion rule:

- remove a global only when it has zero remaining callers in `main.js`, `index.html`, generated markdown HTML, and smoke tests
- include runtime-generated HTML such as `EMPTY_HTML` and implicit top-level drag/drop globals in that caller check

Validation:

- grep confirms no remaining caller sites
- `npm run test:electron`
- related manual smoke for the migrated area

## Suggested final command grouping for the transition period

When Wave 1 begins, group commands like this:

- **menu-backed**: `openFile`, `openFolder`, `saveFile`, `saveFileAs`
- **inline-shell**: `toggleSidebar`, `toggleSource`, `toggleSearch`, `copyAll`, `printDoc`, `toggleTheme`, `toggleAddMenu`, `hideAddMenu`, `dismissWelcomeGuide`, `openFromGuide`, `searchPrev`, `searchNext`, `closeSearch`, `switchTab`, `toggleExplorerPathInfo`, `clearExplorerRoot`, `goTop`
- **generated-preview**: `copyCode`

This grouping makes it obvious which globals can disappear together.

## Verification checklist for the eventual implementation

For each migration wave:

1. confirm the targeted caller category is fully inventoried before edits
2. migrate one caller class at a time
3. grep for the old invocation style after edits
4. run `npm run test:electron`
5. run focused manual smoke for the affected interaction surface

## Definition of done for the future implementation

The global-surface reduction is complete when:

- `src/main.js` no longer uses `executeJavaScript('...')` for renderer actions
- `src/renderer/index.html` no longer depends on inline global action handlers
- generated markdown preview no longer emits `copyCode(this)`
- `Object.assign(window, ...)` is either gone or reduced to a consciously minimal compatibility surface
- smoke coverage and manual verification both pass after the reduction
