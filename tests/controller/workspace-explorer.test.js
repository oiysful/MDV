// Controller-level test: tab -> explorer active-file sync.
//
// docs/plans/01-explorer-active-tab-sync.md — switching tabs via the tab bar didn't move the
// explorer tree's active highlight (only explorer -> tab worked, via openFileRow's direct
// setActiveTreeItem call). Fixed by explorer.js's setActiveFilePath plus app.js:175's
// onTabsChanged callback forwarding the active tab's path into it. Driving workspace +
// explorer together here is the only way to catch a regression in that callback wiring —
// each controller's own unit tests pass even if the boundary between them breaks.

const test = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')

const { createWorkspaceController } = require('../../src/renderer/workspace.js')
const { createExplorerController } = require('../../src/renderer/explorer.js')
const {
  createRefs,
  createSpy,
  createWatchSpies,
  createRenderStub,
  createModeState,
  createMarkdownStub,
} = require('./helpers/harness.js')

// Same element set as helpers/harness.js's DOM_TEMPLATE, plus the explorer elements
// (app-shell.js:48-52) nested under #layout, since setActiveTreeItem/setActiveFilePath
// (explorer.js:27-30, 36-45) reach up via container.closest('#layout').
const DOM_TEMPLATE = `
  <div id="layout">
    <div id="explorer-tree" role="tree"></div>
    <span id="explorer-root-path"></span>
    <button id="btn-explorer-reveal"></button>
    <button id="btn-explorer-close"></button>
    <div id="search-bar" style="display:none">
      <input id="search-input">
      <span id="search-count"></span>
    </div>
    <div id="tab-strip"><div id="tab-list"></div></div>
    <div id="scroll-area">
      <div id="content"></div>
      <div id="source-view">
        <div id="line-highlight"></div>
        <pre id="source-lines"></pre>
        <textarea id="source-editor"></textarea>
      </div>
    </div>
    <ul id="toc-list"></ul>
    <button id="btn-mode"><svg></svg></button>
    <button id="btn-split"></button>
  </div>
`

function createDom() {
  const dom = new JSDOM(`<!DOCTYPE html><body>${DOM_TEMPLATE}</body>`)
  global.document = dom.window.document
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
  global.NodeFilter = dom.window.NodeFilter
  global.requestAnimationFrame = () => {}
  if (!dom.window.Element.prototype.scrollIntoView) {
    dom.window.Element.prototype.scrollIntoView = () => {}
  }
  return dom
}

// Wires a real workspace + explorer controller together the way app.js does (app.js:153-186),
// including app.js:175's onTabsChanged -> explorerController.setActiveFilePath forwarding.
function makeHarness(entries) {
  const dom = createDom()
  const workspaceRefs = createRefs(dom)
  const refs = {
    ...workspaceRefs,
    explorerTree: dom.window.document.getElementById('explorer-tree'),
    explorerPath: dom.window.document.getElementById('explorer-root-path'),
    btnExplorerReveal: dom.window.document.getElementById('btn-explorer-reveal'),
    btnExplorerClose: dom.window.document.getElementById('btn-explorer-close'),
  }
  const getRefs = () => refs
  const markdownController = createMarkdownStub(refs)
  const { watchPath, unwatchPath } = createWatchSpies()
  const render = createRenderStub(refs)
  const modeState = createModeState()

  let workspaceController
  let explorerController

  workspaceController = createWorkspaceController({
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
    getSourceMode: modeState.getSourceMode,
    setSourceMode: modeState.setSourceMode,
    getSplitMode: modeState.getSplitMode,
    setSplitMode: modeState.setSplitMode,
    setMarkdown: () => {},
    confirmClose: () => true,
    openNewWindow: () => {},
    reportDirtyState: () => {},
    closeSearch: () => {},
    // app.js:175
    onTabsChanged: () => {
      explorerController?.setActiveFilePath(workspaceController.getActiveTab()?.path ?? null)
    },
  })

  explorerController = createExplorerController({
    getRefs,
    // document-flow.js:66 forwards a loaded file straight into workspaceController.createTab.
    api: { listDirectory: async () => ({ entries }) },
    load: data => workspaceController.createTab(data),
    switchToExplorerTab: () => {},
    showAppContextMenu: () => {},
    revealInFinder: () => {},
    onExplorerRootChanged: () => {},
  })

  return { refs, workspaceController, explorerController, createSpy }
}

test('switching tabs via the tab bar moves the explorer active highlight to match', async () => {
  const entries = [
    { type: 'file', name: 'a.md', path: '/docs/a.md' },
    { type: 'file', name: 'b.md', path: '/docs/b.md' },
  ]
  const { refs, workspaceController, explorerController } = makeHarness(entries)

  await explorerController.loadDir('/docs', refs.explorerTree, 0)

  // Open A, then B, from the explorer (openFileRow's real path: readFile -> load -> createTab).
  await workspaceController.createTab({ filename: 'a.md', path: '/docs/a.md', content: '# A' })
  const tabA = workspaceController.getActiveTab()
  await workspaceController.createTab({ filename: 'b.md', path: '/docs/b.md', content: '# B' })

  // B is active now; the explorer highlight should already have followed via onTabsChanged.
  let activeRow = refs.explorerTree.querySelector('.tree-item.active .tree-row')
  assert.equal(activeRow?.dataset.path, '/docs/b.md')

  // Switch back to A through the tab bar (not the explorer) — this is the direction that
  // previously did nothing to the explorer tree.
  const tabAElement = refs.tabList.querySelector(`.file-tab[data-tab-id="${tabA.id}"]`)
  assert.ok(tabAElement, 'tab A should be rendered in the tab bar')
  tabAElement.click()

  assert.equal(workspaceController.getActiveTab()?.path, '/docs/a.md')
  activeRow = refs.explorerTree.querySelector('.tree-item.active .tree-row')
  assert.equal(activeRow?.dataset.path, '/docs/a.md', 'explorer highlight follows the tab bar switch')
})
