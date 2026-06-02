const test = require('node:test')
const assert = require('node:assert/strict')

const {
  findTabByPathInTabs,
  getNextActiveTabIdAfterClose,
  reorderTabsById,
} = require('../../src/renderer/workspace.js')

test('findTabByPathInTabs returns the matching tab for a file path', () => {
  const tabs = [
    { id: 1, path: '/tmp/one.md' },
    { id: 2, path: '/tmp/two.md' },
  ]

  assert.deepEqual(findTabByPathInTabs(tabs, '/tmp/two.md'), tabs[1])
  assert.equal(findTabByPathInTabs(tabs, '/tmp/missing.md'), null)
})

test('getNextActiveTabIdAfterClose picks the next valid tab when closing the active tab', () => {
  const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }]

  assert.equal(getNextActiveTabIdAfterClose(tabs, 2, 2), 3)
  assert.equal(getNextActiveTabIdAfterClose(tabs, 3, 3), 2)
  assert.equal(getNextActiveTabIdAfterClose([{ id: 1 }], 1, 1), null)
})

test('reorderTabsById reorders tabs around the drop target', () => {
  const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }]

  assert.deepEqual(reorderTabsById(tabs, 1, 3, true).map(tab => tab.id), [2, 3, 1])
  assert.deepEqual(reorderTabsById(tabs, 3, 1, false).map(tab => tab.id), [3, 1, 2])
  assert.deepEqual(reorderTabsById(tabs, 2, 2, false).map(tab => tab.id), [1, 2, 3])
})
