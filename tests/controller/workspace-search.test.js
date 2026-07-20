// Controller-level test: switching/closing/opening tabs closes an open search.
//
// Regression (docs/plans/README.md "2026-07-16 재검토 결과" #3 / plan §근거 3):
// workspace.js calls closeSearch?.() on tab switch (workspace.js:345), tab close
// (workspace.js:358) and file open (workspace.js:382, 396). In the real app that callback
// is wired app.js:163 -> app-runtime.js:283 -> searchController.closeSearch(). If any of
// those call sites is dropped, no pure unit test catches it — only driving the real
// workspace + search controllers together does.

const test = require('node:test')
const assert = require('node:assert/strict')

const { createWorkspaceController } = require('../../src/renderer/workspace.js')
const { createSearchController } = require('../../src/renderer/search.js')
const {
  createDom,
  createRefs,
  createRenderStub,
  createModeState,
  createWatchSpies,
  createMarkdownStub,
} = require('./helpers/harness.js')

// Real workspace + real search controller sharing one refs/DOM, wired the way app.js does.
function makeHarness() {
  const dom = createDom()
  const refs = createRefs(dom)
  const getRefs = () => refs
  const markdownController = createMarkdownStub()
  const { watchPath, unwatchPath } = createWatchSpies()
  const render = createRenderStub(refs)
  const mode = createModeState()
  let markdown = ''

  const searchController = createSearchController({ getRefs }) // app.js:54-56

  const workspaceController = createWorkspaceController({
    getRefs,
    markdownController,
    render,
    applySourceMode: () => {},
    showEmptyState: () => {},
    watchPath,
    unwatchPath,
    updateToolbarActions: () => {},
    updateEntryAffordance: () => {},
    maybeShowWelcomeGuide: () => {},
    showAppContextMenu: () => {},
    getSourceMode: mode.getSourceMode,
    setSourceMode: mode.setSourceMode,
    getSplitMode: mode.getSplitMode,
    setSplitMode: mode.setSplitMode,
    setMarkdown: value => { markdown = value },
    confirmClose: () => true,
    openNewWindow: () => {},
    reportDirtyState: () => {},
    // mirrors app.js:163 -> app-runtime.js:283 (runtimeController.closeSearch() ->
    // searchController.closeSearch()); collapsed to the terminal call for this harness.
    closeSearch: () => searchController.closeSearch(),
  })

  return { refs, workspaceController, searchController }
}

test('switching tabs closes an open search', async () => {
  const { workspaceController, searchController } = makeHarness()

  const tabA = await workspaceController.createTab({ filename: 'a.md', path: '/docs/a.md', content: '# A' })
  const tabB = await workspaceController.createTab({ filename: 'b.md', path: '/docs/b.md', content: '# B' })

  searchController.toggleSearch({ target: 'preview' })
  assert.equal(searchController.isSearchOpen(), true, 'search should be open before switching')

  await workspaceController.switchToTab(tabA.id)
  assert.equal(searchController.isSearchOpen(), false, 'tab switch (workspace.js:345) must close search')

  // And again on the reverse switch, to be sure it wasn't a one-off.
  searchController.toggleSearch({ target: 'preview' })
  assert.equal(searchController.isSearchOpen(), true)
  await workspaceController.switchToTab(tabB.id)
  assert.equal(searchController.isSearchOpen(), false)
})

test('closing the active tab closes an open search', async () => {
  const { workspaceController, searchController } = makeHarness()

  await workspaceController.createTab({ filename: 'a.md', path: '/docs/a.md', content: '# A' })
  const tabB = await workspaceController.createTab({ filename: 'b.md', path: '/docs/b.md', content: '# B' })

  searchController.toggleSearch({ target: 'preview' })
  assert.equal(searchController.isSearchOpen(), true)

  workspaceController.closeTab(tabB.id)
  assert.equal(searchController.isSearchOpen(), false, 'closing the active tab (workspace.js:358) must close search')
})

test('closing all tabs closes an open search', async () => {
  const { workspaceController, searchController } = makeHarness()

  await workspaceController.createTab({ filename: 'a.md', path: '/docs/a.md', content: '# A' })
  await workspaceController.createTab({ filename: 'b.md', path: '/docs/b.md', content: '# B' })

  searchController.toggleSearch({ target: 'preview' })
  assert.equal(searchController.isSearchOpen(), true)

  workspaceController.closeAllTabs()
  assert.equal(searchController.isSearchOpen(), false, 'closing all tabs (workspace.js:396) must close search')
})
