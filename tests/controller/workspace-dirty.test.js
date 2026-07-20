// Controller-level test: source-mode edits invalidate the cached preview.
//
// Regression (docs/plans/README.md "2026-07-16 재검토 결과" #4, cause 2):
// workspace.js#saveCurrentTabState only set tab.previewDirty when splitMode was on, so a
// pure source-mode edit (e.g. deleting an image line) was snapshotted as stale renderedHTML
// and served again on tab switch. The shouldMarkPreviewDirty helper is unit-tested in
// isolation, but only driving the controller proves the helper is actually wired into
// saveCurrentTabState (workspace.js:146) and that restoreTabState re-renders instead of
// reusing the stale snapshot.

const test = require('node:test')
const assert = require('node:assert/strict')

const { createWorkspaceController } = require('../../src/renderer/workspace.js')
const {
  createDom,
  createRefs,
  createRenderStub,
  createModeState,
  createWatchSpies,
  createMarkdownStub,
} = require('./helpers/harness.js')

// Real workspace controller driven with a stubbed mode state (source/split flags) instead
// of a full editor — the regression lives entirely in workspace.js. Mirrors app.js:143-164.
function makeHarness() {
  const dom = createDom()
  const refs = createRefs(dom)
  const getRefs = () => refs
  const markdownController = createMarkdownStub(refs)
  const { watchPath, unwatchPath } = createWatchSpies()
  const render = createRenderStub(refs)
  const mode = createModeState()
  let markdown = ''

  const workspaceController = createWorkspaceController({
    getRefs,
    markdownController,
    render,
    applySourceMode: () => {}, // editor handles this in the real app (app.js:147)
    showEmptyState: () => {},
    watchPath,
    unwatchPath,
    updateToolbarActions: () => {},
    updateEntryAffordance: () => {},
    maybeShowWelcomeGuide: () => {},
    showAppContextMenu: () => {},
    getSourceMode: mode.getSourceMode, // app.js:155
    setSourceMode: mode.setSourceMode, // app.js:156
    getSplitMode: mode.getSplitMode, // app.js:157
    setSplitMode: mode.setSplitMode, // app.js:158
    setMarkdown: value => { markdown = value },
    confirmClose: () => true,
    openNewWindow: () => {},
    reportDirtyState: () => {},
    closeSearch: () => {},
  })

  return { refs, workspaceController, render, mode }
}

test('a source-mode-only edit sets previewDirty and forces a fresh render on tab switch-back', async () => {
  const { refs, workspaceController, render, mode } = makeHarness()

  const tabA = await workspaceController.createTab({ filename: 'a.md', path: '/docs/a.md', content: '# A with image' })
  await workspaceController.createTab({ filename: 'b.md', path: '/docs/b.md', content: '# B' })

  // Re-activate A, then edit it in pure source mode (no split).
  await workspaceController.switchToTab(tabA.id)
  assert.equal(workspaceController.getActiveTab(), tabA)

  mode.setSourceMode(true)
  mode.setSplitMode(false)
  const edited = '# A with image removed'
  refs.sourceEditor.value = edited

  // Switch away from A. This triggers saveCurrentTabState, whose shouldMarkPreviewDirty
  // wiring (workspace.js:146) must flag A's stale preview even though split mode is off.
  const tabB = workspaceController.findTabByPath('/docs/b.md')
  await workspaceController.switchToTab(tabB.id)

  assert.equal(tabA.previewDirty, true, 'source-mode edit must mark the cached preview dirty')
  assert.equal(tabA.content, edited, 'edited source text is captured into the tab')

  // Leaving source mode as the editor would when switching tabs.
  mode.setSourceMode(false)

  // Switch back to A: restoreTabState must re-render from the edited content instead of
  // reusing the stale renderedHTML snapshot (workspace.js:171-185).
  render.reset()
  await workspaceController.switchToTab(tabA.id)

  const renderedEdited = render.calls.some(args => args[0] === edited)
  assert.ok(renderedEdited, 'restore must re-render the edited content, not reuse stale HTML')
})
