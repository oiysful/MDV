# Renderer Refactor Follow-up Priorities

> Status: Completed on 2026-06-02. This file is retained as the original execution plan and historical checklist for the renderer follow-up queue. The implemented outcomes now live in the current renderer module structure and the separate global-surface reduction plan.

## Goal

Capture the next refactoring queue after completing renderer Phases A/B/C so future work can resume immediately without re-discovery.

This plan covers the six highest-priority follow-up areas that still remain concentrated in `src/renderer/app.js` or span awkward boundaries between existing renderer modules.

## Current baseline

Completed extractions:

- `src/renderer/workspace.js` — tab/workspace state and tab lifecycle
- `src/renderer/editor.js` — source mode / editor interaction
- `src/renderer/explorer.js` — explorer tree rendering / folder navigation
- `src/renderer/theme.js`
- `src/renderer/search.js`
- `src/renderer/onboarding.js`
- `src/renderer/markdown.js`
- `src/renderer/path-utils.js`

Current validation baseline:

- `npm run test:unit`
- `npm run test:electron`

## Rules of engagement

- Keep using test-first sequencing for behavior-sensitive extractions.
- Preserve the current global `window` command surface until a later, explicitly scoped cleanup pass.
- Do not remove inline `onclick` handlers unless a dedicated migration step is planned.
- Do not change IPC contracts casually; preload/main changes must stay mirrored and intentional.
- Prefer moving logic first, cleanup second.
- Keep Electron smoke tests green after every extraction wave.

## Priority 1 — File open / save / watch lifecycle

### Goal

Extract document lifecycle behavior from `app.js` into a dedicated module, likely something like `src/renderer/document-flow.js` or `src/renderer/file-session.js`.

### Why this is next

This area is the highest remaining coupling hotspot because it coordinates:

- open-file dialog results
- markdown document loading
- save/save-as flows
- active watcher rewiring
- external file-change refresh behavior
- editor/workspace synchronization through `md`, active tab content, and save state

Any future work around document behavior will keep re-entering `app.js` until this is extracted.

### Behavior currently in scope

- `openFile`
- `load`
- `saveFile`
- `saveFileAs`
- `watchFile`
- `window.api.onFileOpened(...)`
- `window.api.onFileChanged(...)`
- active document persistence between editor/workspace state and rendered preview

### Tests to add first

- opening multiple markdown files creates or reuses tabs correctly
- saving in preview/source mode updates the active tab and clears dirty state
- save-as rewires the active file path and tab title
- file watcher switches when the active tab changes
- external file changes refresh the active document without breaking source mode

### Likely file changes

- `tests/electron/smoke.test.js`
- optional new focused unit test file if a pure helper seam appears
- `src/renderer/app.js`
- new lifecycle module file
- possibly `src/renderer/workspace.js`
- possibly `src/renderer/editor.js`

### Extraction strategy

1. extend smoke coverage around open/save/watch behavior
2. define a controller boundary that receives `workspaceController`, `editorController`, `render`, and `window.api`
3. move file lifecycle behavior without changing the current globals
4. leave `app.js` with orchestration-only glue

### Verify after completion

- `npm run test:unit`
- `npm run test:electron`
- manual smoke:
  - open file
  - edit in source mode
  - save
  - save as
  - switch tabs
  - trigger external file update

Expected results:

- opening a file still creates or reuses the correct tab
- saving in source mode writes the current editor content to disk and clears the dirty dot
- save-as updates the tab filename/path and rewires future saves to the new location
- switching tabs rewires the active watcher to the selected file only
- external file updates refresh the active document without breaking preview/source synchronization

## Priority 2 — App shell / bootstrap / shared state assembly

### Goal

Reduce `src/renderer/app.js` from a broad “everything orchestrator” into a thinner app-shell bootstrap layer.

### Why this is next

After extracting workspace, editor, and explorer, the biggest remaining structural problem is not a single feature cluster but the assembly layer itself:

- shared state variables (`md`, sidebar state, explorer root state)
- controller creation order
- DOM ref initialization
- startup wiring
- keyboard/global orchestration

That makes `app.js` the next architectural bottleneck.

### Behavior currently in scope

- top-level shared state initialization
- `$` DOM ref collection
- controller instantiation order
- startup UI initialization
- common bootstrap event listeners

### Tests to add first

- app boot still enters empty state correctly
- all required globals remain exposed on `window`
- controller-dependent UI still initializes without page errors

### Likely file changes

- `tests/electron/smoke.test.js`
- `src/renderer/app.js`
- possible new shell/bootstrap module

### Extraction strategy

1. identify which state is truly shared versus module-local
2. move bootstrap-only logic into a small shell module if it materially shrinks `app.js`
3. keep the final `app.js` focused on wiring and exported entry points only

### Verify after completion

- `npm run test:unit`
- `npm run test:electron`
- manual smoke:
  - cold launch
  - open file
  - open folder
  - toggle source mode

Expected results:

- cold launch still reaches the empty state without console/page errors
- opening a file/folder still initializes all required controllers correctly
- toggling source mode still works after bootstrap changes
- all required global entry points remain available on `window`

## Priority 3 — Explorer root/header state boundary cleanup

### Goal

Clarify ownership of explorer root state and header behavior across `app.js`, `explorer.js`, and `onboarding.js`.

### Why this matters

Explorer tree behavior now lives in `explorer.js`, but root/header state still spans:

- `currentExplorerRoot`
- `explorerShowFullPath`
- onboarding-controlled header helpers
- root-close integration
- Finder reveal affordances

The behavior works, but the ownership boundary is still awkward.

### Behavior currently in scope

- `currentExplorerRoot`
- `explorerShowFullPath`
- `syncExplorerHeader`
- `clearExplorerRoot`
- `toggleExplorerPathInfo`
- Finder reveal interactions tied to the explorer header/root

### Tests to add first

- toggling root path display swaps basename/full path correctly
- clearing root resets both tree and header state
- Finder reveal controls remain visible only when a root is active

### Likely file changes

- `tests/electron/smoke.test.js`
- `src/renderer/app.js`
- `src/renderer/explorer.js`
- `src/renderer/onboarding.js`

### Extraction strategy

1. decide whether header/root ownership belongs in onboarding or explorer
2. move state and helpers to a single clear owner
3. keep visible behavior unchanged while simplifying the boundary

### Verify after completion

- `npm run test:electron`
- manual smoke:
  - open folder
  - toggle path view
  - reveal in Finder
  - close root

Expected results:

- toggling path view switches correctly between basename and full path
- Finder reveal remains available only when a root is active
- closing root clears both the tree contents and the header state
- no stale explorer-root state remains after reopening another folder

## Priority 4 — Shared app context menu infrastructure

### Goal

Extract the renderer-managed floating context menu into a shared utility/controller.

### Why this matters

The same menu implementation is reused by multiple surfaces:

- tabs
- explorer root label
- explorer blank area
- explorer folder rows

Right now the behavior is simple but still centralized in `app.js`, which makes future menu behavior changes more error-prone.

### Behavior currently in scope

- `showAppContextMenu`
- `hideAppContextMenu`
- menu positioning and close behavior
- shared menu item rendering and click execution

### Tests to add first

- context menu opens for tab actions
- context menu closes after item click
- explorer root context menu still works

### Likely file changes

- `tests/electron/smoke.test.js`
- `src/renderer/app.js`
- possible new context-menu module
- possibly `src/renderer/explorer.js`
- possibly `src/renderer/workspace.js`

### Extraction strategy

1. isolate menu rendering and positioning first
2. keep callers unchanged except for delegating through the new utility/controller
3. preserve DOM IDs and current visual behavior

### Verify after completion

- `npm run test:electron`
- manual smoke:
  - open tab context menu
  - open explorer root context menu
  - execute close/reveal actions

Expected results:

- the floating context menu renders at the correct location for each caller
- menu actions execute once and close the menu afterward
- tab and explorer callers still invoke the same visible actions as before extraction

## Priority 5 — Drag/drop and open-entry shell actions

### Goal

Separate generic shell interaction behavior from the remaining app bootstrap code.

### Why this matters

These are not the biggest logic hotspots, but they still contribute to `app.js` noise and cross-wire startup behavior:

- drag/drop markdown open flow
- add-menu toggle/hide behavior
- empty-state entry affordances

They are good cleanup candidates once the bigger lifecycle and shell concerns are handled.

### Behavior currently in scope

- `hasFiles`
- `onDragOver`
- `onDragLeave`
- `onDrop`
- `toggleAddMenu`
- `hideAddMenu`
- shared startup/open-entry affordance interactions

### Tests to add first

- drag/drop of markdown file opens content
- add menu shows/hides correctly
- empty-state CTA behaviors remain intact

### Likely file changes

- `tests/electron/smoke.test.js`
- `src/renderer/app.js`
- possible new shell-actions module

### Extraction strategy

1. keep the current global inline entry points intact
2. move shell interaction utilities into a focused module
3. preserve onboarding/open-entry behavior while reducing app-level clutter

### Verify after completion

- `npm run test:electron`
- manual smoke:
  - drag markdown file in
  - open add menu
  - close add menu
  - use empty-state buttons

Expected results:

- dragging a markdown file still opens it into the app
- add menu open/close behavior remains unchanged
- empty-state CTA buttons still trigger the correct open flows
- startup/open-entry affordance UI does not regress

## Priority 6 — Global window surface reduction planning

### Goal

Prepare a future migration plan for reducing the broad `Object.assign(window, ...)` surface without breaking menu integration or inline handlers.

### Why this is last

This is the most invasive cleanup because it touches:

- menu `executeJavaScript(...)` hooks
- inline handler contracts in `index.html`
- generated HTML callbacks such as code copy buttons

It should not happen until the remaining behavioral clusters are already cleanly separated.

### Behavior currently in scope

- `Object.assign(window, ...)` exported actions
- menu-triggered renderer globals
- inline `onclick` dependencies

### Work style for this phase

This should start as an assessment/migration plan, not immediate implementation.

### Deliverable

Produce a dedicated migration plan file, likely:

- `.sisyphus/plans/renderer-global-surface-reduction.md`

### Questions to answer first

- which globals are only needed for inline markup?
- which globals are only needed for Electron menu hooks?
- which can be replaced with event listeners first?
- whether menu integration should move away from string-based `executeJavaScript(...)`

### Likely file changes

- initially planning/docs only
- later: `src/main.js`, `src/renderer/index.html`, `src/renderer/app.js`, and affected modules

### Verify after completion

When eventually implemented:

- globals expected by menu actions still work
- inline handlers are replaced or preserved intentionally
- no renderer boot regressions

For the planning-only phase itself, verification should be:

- tool: read + plan review
- steps:
  - confirm the migration-plan file exists
  - confirm it inventories current globals, callers, risk areas, and migration order
  - confirm each migration wave includes expected validation steps
- expected result:
  - the plan is specific enough that a future session can start the global-surface reduction without re-discovery

## Suggested execution order

1. Priority 1 — file open / save / watch lifecycle
2. Priority 2 — app shell / bootstrap / shared state assembly
3. Priority 3 — explorer root/header state boundary cleanup
4. Priority 4 — shared app context menu infrastructure
5. Priority 5 — drag/drop and open-entry shell actions
6. Priority 6 — global window surface reduction planning

## Definition of done for this follow-up queue

This queue is considered meaningfully complete when:

- `app.js` is reduced to a thin bootstrap/orchestration layer
- file lifecycle behavior no longer forms the next major coupling hotspot
- explorer root/header ownership is unambiguous
- shared UI shell behaviors are modularized
- a safe migration plan exists for shrinking the global `window` surface
