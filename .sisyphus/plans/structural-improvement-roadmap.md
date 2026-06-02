# Structural Improvement Roadmap After Renderer Global Surface Reduction

## Goal

Capture the remaining structural improvement work after the completed renderer refactor follow-up queue and renderer global surface reduction.

This plan does **not** re-open the completed global-surface migration. It focuses on the next architecture hotspots that still make future changes harder than necessary:

- IPC contract drift between `src/main.js`, `src/preload.js`, and renderer consumers
- `src/renderer/app.js` as a controller assembly bottleneck
- `src/renderer/app-runtime.js` mixing command dispatch, runtime shell behavior, generated empty-state HTML, and shared UI helpers
- document/tab state transitions spread across document flow, workspace, editor, and markdown rendering
- `src/renderer/index.html` remaining a large combined CSS/markup shell
- smoke tests carrying broad happy-path coverage but limited contract/error-path coverage

## Current baseline

Already completed and should not be repeated:

- `src/renderer/document-flow.js` owns file open/save/save-as/watch lifecycle behavior.
- `src/renderer/context-menu.js` owns the floating context menu controller.
- `src/renderer/shell-actions.js` owns add-menu and drag/drop behavior.
- Renderer command globals and inline handlers were replaced with `rendererCommands`, `data-command` bindings, generated-copy delegation, and `renderer-command` IPC.
- Existing validation baseline:
  - `npm run test:unit`
  - `npm run test:electron`
  - `npm run build`

## Non-goals

- Do not redesign the UI.
- Do not add new app features.
- Do not loosen Electron security settings (`contextIsolation` stays enabled, `nodeIntegration` stays disabled).
- Do not reintroduce renderer command globals or inline handlers.
- Do not change visible copy or interaction behavior except where explicitly required by a refactor and covered by tests.

## Acceptance criteria for this roadmap

The structural cleanup is complete when:

- IPC channels and JSON payload handling have a single documented contract or codec layer instead of ad hoc parsing scattered through renderer modules.
- `src/renderer/app.js` is reduced to thin bootstrap/assembly code with minimal mutable top-level state.
- `src/renderer/app-runtime.js` no longer acts as a broad catch-all for command, shell, generated HTML, and shared UI behavior.
- document/tab transitions have one clear coordinator for render/save/watch/dirty-state synchronization.
- `src/renderer/index.html` has a smaller, more maintainable shell boundary or a documented staged path toward one.
- Tests cover main/preload/renderer IPC contracts and failure/cancel paths, not only happy-path Electron smoke flows.

## Wave 1 — IPC contract and response envelope cleanup

### Goal

Make the main/preload/renderer IPC surface explicit, consistent, and harder to drift.

### Why this is next

`src/main.js` owns many handlers that return JSON strings, `src/preload.js` mirrors each channel manually, and renderer modules repeatedly call `JSON.parse(await api...)`. Adding or changing IPC currently requires remembering conventions across multiple files.

### Current symptoms

- `src/main.js` mixes app lifecycle, dialogs, file IO, image IO, watcher setup, menu IPC, and shell integrations.
- `src/preload.js` exposes similarly named bridge methods without a shared channel inventory.
- Renderer consumers parse response strings independently in `document-flow.js`, `explorer.js`, `markdown.js`, `app-runtime.js`, and `app-shell.js`.
- Error payload shapes are similar but not consistently named (`error`, `ok`, `cancelled`, `files`, `path`, `data_url`).

### Candidate direction

1. Create a small IPC contract helper or documentation module that lists channel names and response envelopes.
2. Introduce renderer-side parse helpers such as `parseIpcResult(...)` before changing any main-process return shape.
3. Normalize error/cancel handling around the existing JSON-string convention first.
4. Only after tests pass, consider whether returning raw objects is worth a separate migration.

### Tests to add first

- unit tests for IPC result parsing helpers
- Electron smoke or focused integration tests for dialog cancel paths
- save/open error-path coverage using stubbed dialog/file IO failures where practical
- menu-to-renderer command dispatch coverage remains green

### Validation

- grep confirms renderer modules no longer call `JSON.parse(await api...)` directly except through the new helper.
- `npm run test:unit`
- `npm run test:electron`
- manual smoke: open file, open folder, save, save as, reveal in Finder, external link open

### QA scenarios

#### QA 1 — IPC parse helper coverage

- Tool: `npm run test:unit`
- Steps:
  1. Add unit tests for valid result, cancelled result, error result, and malformed JSON result.
  2. Run `npm run test:unit`.
- Expected result:
  - all IPC helper tests pass
  - malformed JSON and error payloads produce deterministic error handling
  - no renderer module bypasses the helper with direct `JSON.parse(await api...)`

#### QA 2 — Dialog cancel behavior

- Tool: `npm run test:electron`
- Steps:
  1. Stub `dialog.showOpenDialog` to return `{ canceled: true }`.
  2. Trigger file open through the renderer command path.
  3. Stub `dialog.showSaveDialog` to return `{ canceled: true }`.
  4. Trigger save-as from a dirty source-mode tab.
- Expected result:
  - cancelled file open creates no tab and keeps the current UI state
  - cancelled save-as keeps the tab dirty and does not change the tab path/title
  - no page errors are emitted

#### QA 3 — Main/preload channel contract

- Tool: focused unit/contract test or `npm run test:unit`
- Steps:
  1. Assert every documented IPC channel has a matching preload method.
  2. Assert every preload method references an existing main-process channel name.
  3. Assert `renderer-command` is receive-only in preload and not exposed as a generic sender.
- Expected result:
  - channel names are synchronized
  - no generic raw `ipcRenderer` bridge exists

## Wave 2 — Thin bootstrap and controller assembly cleanup

### Goal

Reduce `src/renderer/app.js` to a thin, auditable bootstrap layer.

### Why this matters

`app.js` is much smaller than before, but it still owns controller creation order, shared state closures, command registry creation, DOM readiness, renderer-ready signaling, and cross-controller dependency wiring. Future controller changes still require editing this single high-coupling file.

### Current symptoms

- Top-level mutable controller variables exist so controller factories can reference each other later.
- Shared state (`md`, sidebar open state, active tab) is held directly in `app.js` closures.
- The command registry depends on `runtimeController`, while IPC registration depends on `runRendererCommand`.
- Bootstrap readiness is represented by `document.documentElement.dataset.rendererReady` for tests.

### Candidate direction

1. Extract a `createRendererApp(...)` or `createControllerGraph(...)` helper that constructs controllers and returns `{ refs, commands, start }`.
2. Keep script loading and global `window.MDV*` module access unchanged during the first pass.
3. Move shared mutable app state into a small app-state object with named getters/setters.
4. Keep `app.js` responsible only for `DOMContentLoaded`, dependency collection, startup call, and ready marker.

### Tests to add first

- smoke test remains page-error-free on cold launch
- unit test for app-state helper if one is extracted
- smoke test confirms `documentElement.dataset.rendererReady === 'true'`
- smoke test confirms renderer command dispatch still opens a file

### Validation

- `app.js` has no behavior beyond dependency assembly and startup.
- Existing command names remain unchanged.
- `npm run test:unit`
- `npm run test:electron`

### QA scenarios

#### QA 1 — Cold boot and ready marker

- Tool: `npm run test:electron`
- Steps:
  1. Launch the app with no file path.
  2. Wait for `document.documentElement.dataset.rendererReady === 'true'`.
  3. Check `#empty` is visible and the page title is `MDV`.
  4. Collect page errors during boot.
- Expected result:
  - ready marker is set once controllers are wired
  - empty state is visible
  - no page errors occur

#### QA 2 — Command registry survives bootstrap extraction

- Tool: `npm run test:electron`
- Steps:
  1. Stub file-open dialog with a markdown fixture.
  2. Send `renderer-command` with `openFile`.
  3. Wait for the fixture title and active tab.
- Expected result:
  - file opens through the same command name
  - no `window.openFile` compatibility alias is required
  - active tab and rendered content match the fixture

#### QA 3 — Source and explorer controllers still initialize

- Tool: `npm run test:electron`
- Steps:
  1. Open a markdown file.
  2. Trigger `toggleSource` through renderer command.
  3. Open a folder fixture through `openFolder`.
  4. Switch to the explorer tab.
- Expected result:
  - source editor appears and contains the active markdown
  - explorer root label updates to the folder
  - sidebar tab switching still works

## Wave 3 — Runtime command and shell behavior split

### Goal

Split `src/renderer/app-runtime.js` into narrower ownership areas.

### Why this matters

`app-runtime.js` currently provides file commands, shell commands, generated empty-state HTML, toolbar state, sidebar/tab switching, search wrappers, theme wrappers, code copy, print helpers, drag/drop wrappers, and global keyboard/print/click listeners. It is the current renderer catch-all.

### Proposed boundaries

- `renderer-commands.js` or equivalent: command registry construction and command names
- `runtime-shell.js`: toolbar/sidebar/go-top/print/copy-all behavior
- `empty-state.js`: `createEmptyStateHtml` and empty-state restoration details
- `global-events.js`: keyboard shortcuts, system theme listener, print stylesheet listeners, document click cleanup

Do not create all files at once unless the extraction is mechanical and tests stay green. Prefer one boundary per wave.

### Tests to add first

- unit tests for empty-state HTML and command attributes
- smoke tests for keyboard shortcuts: open, save, save-as, source toggle, search, tab switching
- smoke test for generated code-copy button copied state
- smoke test for add-menu close on outside click remains green

### Validation

- `app-runtime.js` no longer exposes unrelated wrappers as a single broad controller.
- `rendererCommands` still contains the same external command names.
- no `onclick`, drag/drop attributes, `Object.assign(window, ...)`, or `executeJavaScript(...)` regressions
- `npm run test:unit`
- `npm run test:electron`

### QA scenarios

#### QA 1 — Command attribute contract

- Tool: `npm run test:unit`
- Steps:
  1. Test generated empty-state HTML for `data-command="openFile"` and `data-command="openFolder"`.
  2. Test generated code-copy HTML for `data-command="copyCode"` and `data-command-element="true"`.
  3. Run `npm run test:unit`.
- Expected result:
  - generated HTML uses command attributes only
  - no generated HTML contains `onclick=`

#### QA 2 — Keyboard shortcut behavior

- Tool: `npm run test:electron`
- Steps:
  1. Open a markdown fixture.
  2. Press `CmdOrCtrl+U` to enter source mode.
  3. Edit content and press `CmdOrCtrl+S`.
  4. Press `CmdOrCtrl+F` in preview mode.
- Expected result:
  - source mode toggles correctly
  - save clears the dirty marker
  - search bar opens only in preview mode

#### QA 3 — Shell cleanup behavior

- Tool: `npm run test:electron`
- Steps:
  1. Click the add button.
  2. Verify the add menu is visible and button is active.
  3. Click outside the menu.
  4. Trigger drag/drop of a markdown file on `#scroll-area`.
- Expected result:
  - add menu closes on outside click
  - drag/drop opens a markdown tab
  - no inline drag/drop attributes are required

## Wave 4 — Document/tab transition coordinator

### Goal

Make document state transitions explicit and single-owner across open, render, edit, save, save-as, external change, tab switch, close, and watcher rewiring.

### Why this matters

The app now has focused modules, but document state still crosses:

- `document-flow.js` for load/save/watch lifecycle
- `workspace.js` for tab snapshots, dirty state, active tab selection, and watcher calls
- `editor.js` for source-mode text and dirty updates
- `markdown.js` for rendered HTML/TOC snapshots and hydration
- `app-runtime.js` for empty-state restoration and toolbar state updates

### Candidate direction

1. Inventory every path that mutates active tab content, source editor content, rendered HTML, TOC HTML, dirty state, watch target, or document title.
2. Extract pure transition helpers first: e.g. “prepare active tab for save”, “snapshot preview tab”, “hydrate active tab”, “apply external change”.
3. Introduce a small coordinator only after helpers are tested.
4. Keep existing tab shape stable unless a dedicated migration is planned.

### Tests to add first

- unit tests for transition helpers
- smoke: open two files, edit source, switch tabs, save, save-as, close active tab
- smoke: external file change while source mode is active and while preview mode is active
- smoke: closing the final tab restores empty state and clears toolbar actions

### Validation

- one module owns watcher rewiring decisions for active tab changes
- dirty-state update paths are not duplicated between editor/workspace/document-flow
- `npm run test:unit`
- `npm run test:electron`
- manual smoke with two files and an external file update

### QA scenarios

#### QA 1 — Source edit/save transition

- Tool: `npm run test:electron`
- Steps:
  1. Open a temporary markdown file.
  2. Toggle source mode.
  3. Edit the source text.
  4. Save the file.
  5. Read the file from disk.
- Expected result:
  - active tab shows dirty before save
  - save writes the edited content
  - dirty marker and save button state clear after save

#### QA 2 — Save-as path transition

- Tool: `npm run test:electron`
- Steps:
  1. Open a temporary markdown file.
  2. Stub save dialog to a new path.
  3. Trigger save-as.
  4. Edit again and trigger normal save.
- Expected result:
  - tab title and document title change to the new filename
  - future saves write to the new path
  - original file remains unchanged after save-as

#### QA 3 — Watcher transition across tabs

- Tool: `npm run test:electron`
- Steps:
  1. Open two temporary markdown files.
  2. Modify the active file externally.
  3. Verify active content updates.
  4. Switch to the other tab.
  5. Modify the second file externally.
- Expected result:
  - only the active watched file refreshes the active tab
  - switching tabs rewires the watcher
  - source/preview state remains consistent

#### QA 4 — Final-tab close transition

- Tool: `npm run test:electron`
- Steps:
  1. Open one markdown file.
  2. Close the active tab.
  3. Wait for empty state.
- Expected result:
  - tab list is empty
  - `#empty` is visible
  - save and print toolbar buttons are disabled

## Wave 5 — Renderer shell markup/CSS boundary

### Goal

Reduce the maintenance risk of the large `src/renderer/index.html` shell without changing the UI.

### Why this matters

`index.html` still combines CSS, markup, script loading order, command attributes, static empty state markup, toolbar, sidebar, search bar, print CSS, and content shell. This makes structural edits noisy and increases the chance of accidental visual regressions.

### Candidate direction

1. Start with non-invasive organization: document sections, ensure all static command attributes are covered by tests, and keep CSP unchanged.
2. Consider extracting CSS to a local stylesheet only if packaging/build and CSP remain simple.
3. Consider extracting repeated SVG/icon markup only if it reduces risk and does not require a bundler.
4. Keep script tag order explicit unless a separate module-loading plan exists.

### Tests to add first

- smoke boot/page-error test remains strict
- smoke test checks key command-bearing controls exist with expected `data-command` names
- no visual redesign acceptance criteria; this wave is structural only

### Validation

- `npm run test:electron`
- `npm run build`
- manual smoke: cold launch, theme toggle, source toggle, search open/close, print dialog trigger if practical

### QA scenarios

#### QA 1 — Shell command controls remain discoverable

- Tool: `npm run test:electron`
- Steps:
  1. Launch the app.
  2. Query key controls: `#btn-add`, `#btn-theme`, `#btn-search`, `#btn-mode`, `#btn-save`, `#go-top`, sidebar tab buttons, empty-state CTAs.
  3. Assert each interactive control has the expected `data-command` value where applicable.
- Expected result:
  - all key controls exist
  - command names match the renderer command registry
  - no `[onclick]`, `[ondragover]`, `[ondragleave]`, or `[ondrop]` nodes exist

#### QA 2 — Visual shell smoke

- Tool: `npm run test:electron`
- Steps:
  1. Cold launch into empty state.
  2. Toggle theme three times.
  3. Open a markdown file.
  4. Toggle source mode.
  5. Open and close search.
- Expected result:
  - theme cycles auto/light/dark without stylesheet mismatch
  - preview/source layout still switches correctly
  - search bar opens and closes without page errors

#### QA 3 — Packaging/CSP check

- Tool: `npm run build`
- Steps:
  1. Run `npm run build` after any CSS/markup extraction.
  2. Launch or smoke-test the built app if practical.
- Expected result:
  - build exits 0
  - macOS app/DMG artifacts are generated
  - no CSP-related renderer load errors occur in smoke tests

## Wave 6 — Test contract expansion and suite decomposition

### Goal

Keep refactors safe by moving from one broad smoke file plus helper-only unit tests toward explicit contracts for IPC, shell commands, and error paths.

### Current symptoms

- `tests/electron/smoke.test.js` is the main behavior safety net and covers many unrelated flows.
- Unit tests mostly cover pure helpers, not controller contracts.
- Main/preload IPC behavior is indirectly covered through smoke tests rather than explicit channel contract tests.

### Candidate direction

1. Split smoke coverage by behavior area only when it improves maintainability: boot/open-save, explorer, shell commands, document watch, theme/search.
2. Add unit tests for command payload extraction and command dispatch in `app-shell.js` if a DOM-light seam is practical.
3. Add contract tests for IPC channel names and response envelopes.
4. Add failure/cancel tests before refactoring IPC or document transitions.

### Validation

- total smoke coverage remains at least as strong as current coverage
- tests are easier to map to refactor waves
- `npm run test:unit`
- `npm run test:electron`

### QA scenarios

#### QA 1 — Smoke suite split parity

- Tool: `npm run test:electron`
- Steps:
  1. Split one behavior group at a time, such as explorer or shell actions.
  2. Run the full Electron test command after each split.
  3. Compare test names against the previous smoke coverage list.
- Expected result:
  - no existing behavior scenario disappears
  - all split files pass through the same npm script
  - failures identify the behavior group clearly

#### QA 2 — IPC contract test coverage

- Tool: `npm run test:unit`
- Steps:
  1. Add contract tests for channel names, response envelopes, and renderer-command receive-only behavior.
  2. Run `npm run test:unit`.
- Expected result:
  - channel mismatch fails fast in unit tests
  - response envelope changes require explicit test updates

#### QA 3 — Error/cancel coverage gate

- Tool: `npm run test:electron`
- Steps:
  1. Add at least one cancel-path test before IPC refactors.
  2. Add at least one save/open failure-path test before document transition refactors.
  3. Run `npm run test:electron`.
- Expected result:
  - cancel paths leave UI state unchanged
  - failure paths report errors without corrupting active tab state
  - no page errors are emitted

## Suggested execution order

1. Wave 1 — IPC contract and response envelope cleanup
2. Wave 6 — Add missing contract/error-path tests needed for later waves
3. Wave 2 — Thin bootstrap and controller assembly cleanup
4. Wave 3 — Runtime command and shell behavior split
5. Wave 4 — Document/tab transition coordinator
6. Wave 5 — Renderer shell markup/CSS boundary

## Risk areas

### IPC behavior risk

Changing JSON-string return conventions too early could break multiple renderer consumers. Normalize parsing first; change payload shape only in a separate verified migration.

### Bootstrap order risk

Renderer controllers depend on each other through closures. Extract assembly carefully and keep smoke boot tests strict.

### Document state risk

Open/save/watch/source-mode flows are coupled through tab state, editor state, rendered HTML, and watcher lifecycle. Add transition tests before moving ownership.

### Markup/CSS risk

`index.html` is large but stable. Extracting CSS or icons can create packaging/CSP regressions, so this should come after command and state boundaries are safer.

## Verification checklist for each wave

1. Confirm the targeted boundary and caller set before editing.
2. Add or update focused tests before moving behavior.
3. Preserve command names, DOM IDs, IPC channels, and tab shape unless the wave explicitly changes them.
4. Run error-level `lsp_diagnostics` on modified files.
5. Run `npm run test:unit` when helper/controller logic changes.
6. Run `npm run test:electron` for any renderer/main/preload behavior change.
7. Run `npm run build` for shell markup, preload/main, packaging, or CSP-adjacent changes.
8. Perform manual smoke for the affected surface and record the observed result.

## Definition of done

This roadmap is complete when the app still behaves the same, but future changes can be made through explicit contracts and smaller ownership boundaries:

- main/preload/renderer IPC is documented and centrally parsed
- renderer bootstrap has minimal mutable state and minimal direct behavior
- runtime commands are split by ownership area
- document/tab transitions have a tested coordinator or tested transition helpers
- the renderer shell is easier to maintain without adding a bundler or changing CSP unnecessarily
- tests clearly protect contracts, happy paths, cancel paths, and failure paths
