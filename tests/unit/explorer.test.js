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
