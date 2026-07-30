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
// docs/plans/06-security-hardening-audit-2026-07-22.md); it must render as text.
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

// setActiveFilePath is the tab -> explorer sync direction (docs/plans/01-explorer-active-tab-sync.md).
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
