const test = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')

// explorer.js reads roving-tabindex math off globalThis.MDVRoving instead of importing it,
// mirroring index.html's script order (see tests/controller/helpers/harness.js).
require('../../src/renderer/roving.js')

const {
  getTreeRowPadding,
  getFolderArrow,
  getExplorerRootLabel,
  createExplorerController,
} = require('../../src/renderer/explorer.js')

test('getTreeRowPadding increases indentation per depth level', () => {
  assert.equal(getTreeRowPadding(0), '12px')
  assert.equal(getTreeRowPadding(1), '26px')
  assert.equal(getTreeRowPadding(3), '54px')
})

test('getFolderArrow reflects collapsed and expanded state', () => {
  assert.equal(getFolderArrow(false), '▶')
  assert.equal(getFolderArrow(true), '▼')
})

test('getExplorerRootLabel switches between placeholder, basename, and full path', () => {
  assert.equal(getExplorerRootLabel(null, false), '폴더를 선택하세요')
  assert.equal(getExplorerRootLabel('/tmp/docs/project', false), 'project')
  assert.equal(getExplorerRootLabel('/tmp/docs/project', true), '/tmp/docs/project')
})

// list-directory's error carries the OS message and the directory name — untrusted input.
// It was the only unsanitized innerHTML sink left in the renderer (MEDIUM-2 in
// docs/plans/done/2026-07-30/06-security-hardening-audit-2026-07-22.md); it must render as text.
function makeExplorerErrorHarness(error) {
  const dom = new JSDOM('<div id="explorer-tree"></div>')
  global.document = dom.window.document
  const tree = dom.window.document.getElementById('explorer-tree')
  const controller = createExplorerController({
    getRefs: () => ({ explorerTree: tree }),
    api: { listDirectory: async () => ({ error }) },
    load: () => {},
    switchToExplorerTab: () => {},
    showAppContextMenu: () => {},
    revealInFinder: () => {},
    onExplorerRootChanged: () => {},
  })
  return { controller, tree }
}

test('directory listing errors render as text, never as markup', async () => {
  const hostile = '<img src=x onerror="alert(1)">폴더를 읽을 수 없습니다'
  const { controller, tree } = makeExplorerErrorHarness(hostile)

  await controller.loadDir('/tmp/hostile<dir>', tree, 0)

  const hint = tree.querySelector('.tree-hint')
  assert.ok(hint, 'the error still renders inside a .tree-hint element')
  assert.equal(hint.textContent, hostile)
  assert.equal(tree.querySelector('img'), null, 'the error must not become a live element')
  assert.ok(hint.innerHTML.includes('&lt;img'), 'the markup is escaped, not parsed')
})

// setActiveFilePath is the tab -> explorer sync direction (docs/plans/done/2026-07-30/01-explorer-active-tab-sync.md).
// setActiveTreeItem's own #layout lookup (explorer.js:27-30) needs a real #layout ancestor.
function makeActiveFilePathHarness(entries) {
  const dom = new JSDOM('<div id="layout"><div id="explorer-tree"></div></div>')
  global.document = dom.window.document
  const tree = dom.window.document.getElementById('explorer-tree')
  const controller = createExplorerController({
    getRefs: () => ({ explorerTree: tree }),
    api: { listDirectory: async () => ({ entries }) },
    load: () => {},
    switchToExplorerTab: () => {},
    showAppContextMenu: () => {},
    revealInFinder: () => {},
    onExplorerRootChanged: () => {},
  })
  return { controller, tree }
}

test('setActiveFilePath activates the matching row and clears any previous active row', async () => {
  const entries = [
    { type: 'file', name: 'a.md', path: '/docs/a.md' },
    { type: 'file', name: 'b.md', path: '/docs/b.md' },
  ]
  const { controller, tree } = makeActiveFilePathHarness(entries)
  await controller.loadDir('/docs', tree, 0)

  controller.setActiveFilePath('/docs/a.md')
  let active = tree.querySelectorAll('.tree-item.active')
  assert.equal(active.length, 1)
  assert.equal(active[0].querySelector('.tree-row').dataset.path, '/docs/a.md')

  controller.setActiveFilePath('/docs/b.md')
  active = tree.querySelectorAll('.tree-item.active')
  assert.equal(active.length, 1, 'switching path moves the highlight instead of stacking it')
  assert.equal(active[0].querySelector('.tree-row').dataset.path, '/docs/b.md')
})

// The empty-state hint tells the user which button opens a folder. It must name the
// actual button label ("열기"), not a stale "+" that no longer appears in the UI
// (src/renderer/index.html's #btn-add renders an icon plus a "열기" text label).
test('clearExplorerRoot renders an empty-state hint that names the actual 열기 button', () => {
  const dom = new JSDOM('<div id="explorer-tree"></div><span id="explorer-path"></span><button id="btn-explorer-reveal"></button><button id="btn-explorer-close"></button>')
  global.document = dom.window.document
  const tree = dom.window.document.getElementById('explorer-tree')
  const controller = createExplorerController({
    getRefs: () => ({
      explorerTree: tree,
      explorerPath: dom.window.document.getElementById('explorer-path'),
      btnExplorerReveal: dom.window.document.getElementById('btn-explorer-reveal'),
      btnExplorerClose: dom.window.document.getElementById('btn-explorer-close'),
    }),
    api: { listDirectory: async () => ({ entries: [] }) },
    load: () => {},
    switchToExplorerTab: () => {},
    showAppContextMenu: () => {},
    revealInFinder: () => {},
    onExplorerRootChanged: () => {},
  })

  controller.clearExplorerRoot()

  const hint = tree.querySelector('.tree-hint')
  assert.ok(hint, 'the empty state still renders inside a .tree-hint element')
  assert.ok(hint.innerHTML.includes('<strong>열기</strong>'), 'hint names the actual 열기 button')
  assert.ok(!hint.innerHTML.includes('<strong>+</strong>'), 'hint no longer points at a bare + that is not on screen')
})

test('setActiveFilePath clears the highlight for a null path or a path not in the visible tree', async () => {
  const entries = [{ type: 'file', name: 'a.md', path: '/docs/a.md' }]
  const { controller, tree } = makeActiveFilePathHarness(entries)
  await controller.loadDir('/docs', tree, 0)

  controller.setActiveFilePath('/docs/a.md')
  assert.equal(tree.querySelectorAll('.tree-item.active').length, 1)

  controller.setActiveFilePath(null)
  assert.equal(tree.querySelectorAll('.tree-item.active').length, 0)

  controller.setActiveFilePath('/docs/a.md')
  controller.setActiveFilePath('/docs/not-in-tree.md')
  assert.equal(tree.querySelectorAll('.tree-item.active').length, 0, 'an unmatched path clears rather than leaving a stale highlight')
})

// Code-review follow-up on docs/plans/done/2026-07-30/01-explorer-active-tab-sync.md: the active path is
// remembered even while its row is hidden inside a collapsed folder (v1 scope: no auto-expand,
// see the plan's own risk note), but expanding that folder later should light the row up
// immediately rather than waiting for an unrelated root re-render.
test('expanding a folder that reveals the active tab highlights it without a root re-render', async () => {
  const dom = new JSDOM('<div id="layout"><div id="explorer-tree"></div></div>')
  global.document = dom.window.document
  const tree = dom.window.document.getElementById('explorer-tree')
  const listDirectory = async targetPath => {
    if (targetPath === '/docs') {
      return { entries: [{ type: 'dir', name: 'sub', path: '/docs/sub' }] }
    }
    if (targetPath === '/docs/sub') {
      return { entries: [{ type: 'file', name: 'nested.md', path: '/docs/sub/nested.md' }] }
    }
    throw new Error(`unexpected listDirectory(${targetPath})`)
  }
  const controller = createExplorerController({
    getRefs: () => ({ explorerTree: tree }),
    api: { listDirectory },
    load: () => {},
    switchToExplorerTab: () => {},
    showAppContextMenu: () => {},
    revealInFinder: () => {},
    onExplorerRootChanged: () => {},
  })

  await controller.loadDir('/docs', tree, 0)
  controller.setActiveFilePath('/docs/sub/nested.md')
  assert.equal(tree.querySelectorAll('.tree-item.active').length, 0, 'not visible yet: collapsed, v1 does not auto-expand')

  const folderRow = tree.querySelector('.tree-row[data-path="/docs/sub"]')
  folderRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise(resolve => setImmediate(resolve))

  const active = tree.querySelectorAll('.tree-item.active')
  assert.equal(active.length, 1, 'the newly-revealed row lights up without a separate setActiveFilePath call')
  assert.equal(active[0].querySelector('.tree-row').dataset.path, '/docs/sub/nested.md')
})

// Directory-watch wiring (docs/plans/10 2-1): openFolder/restoreRoot start a watch,
// switching or closing the root must not leak the previous one.
function makeWatchHarness(listDirectoryImpl) {
  const dom = new JSDOM('<div id="layout"><div id="explorer-tree"></div></div><span id="explorer-path"></span><button id="btn-explorer-reveal"></button><button id="btn-explorer-close"></button>')
  global.document = dom.window.document
  const tree = dom.window.document.getElementById('explorer-tree')
  const watchCalls = []
  const unwatchCalls = []
  let directoryChangedHandler = null
  const controller = createExplorerController({
    getRefs: () => ({
      explorerTree: tree,
      explorerPath: dom.window.document.getElementById('explorer-path'),
      btnExplorerReveal: dom.window.document.getElementById('btn-explorer-reveal'),
      btnExplorerClose: dom.window.document.getElementById('btn-explorer-close'),
    }),
    api: {
      listDirectory: listDirectoryImpl,
      openFolderDialog: async () => ({ path: '/docs' }),
      watchDirectory: async p => { watchCalls.push(p) },
      unwatchDirectory: async p => { unwatchCalls.push(p) },
      onDirectoryChanged: cb => { directoryChangedHandler = cb },
    },
    load: () => {},
    switchToExplorerTab: () => {},
    showAppContextMenu: () => {},
    revealInFinder: () => {},
    onExplorerRootChanged: () => {},
  })
  return { controller, tree, watchCalls, unwatchCalls, emitDirectoryChanged: payload => directoryChangedHandler(payload) }
}

test('openFolder watches the newly opened root', async () => {
  const { controller, watchCalls } = makeWatchHarness(async () => ({ entries: [] }))
  await controller.openFolder()
  assert.deepEqual(watchCalls, ['/docs'])
})

test('clearExplorerRoot unwatches the root it is closing', async () => {
  const { controller, watchCalls, unwatchCalls } = makeWatchHarness(async () => ({ entries: [] }))
  await controller.openFolder()
  assert.deepEqual(watchCalls, ['/docs'])
  controller.clearExplorerRoot()
  assert.deepEqual(unwatchCalls, ['/docs'])
})

test('refreshTree reloads the root and restores folders that were expanded before the rebuild', async () => {
  const listDirectory = async targetPath => {
    if (targetPath === '/docs') return { entries: [{ type: 'dir', name: 'sub', path: '/docs/sub' }] }
    if (targetPath === '/docs/sub') return { entries: [{ type: 'file', name: 'nested.md', path: '/docs/sub/nested.md' }] }
    throw new Error(`unexpected listDirectory(${targetPath})`)
  }
  const { controller, tree } = makeWatchHarness(listDirectory)
  await controller.openFolder()

  const folderRow = tree.querySelector('.tree-row[data-path="/docs/sub"]')
  const EventCtor = folderRow.ownerDocument.defaultView.Event
  folderRow.dispatchEvent(new EventCtor('click'))
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(tree.querySelector('.tree-row[data-path="/docs/sub/nested.md"]'), 'sub is expanded before the refresh')

  await controller.refreshTree()

  const reopenedRow = tree.querySelector('.tree-row[data-path="/docs/sub"]')
  assert.equal(reopenedRow.getAttribute('aria-expanded'), 'true', 'refreshTree re-opens a folder that was expanded before the rebuild')
  assert.ok(tree.querySelector('.tree-row[data-path="/docs/sub/nested.md"]'), 'the previously-expanded folder is lazily reloaded, not just marked open')
})
