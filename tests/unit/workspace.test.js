const test = require('node:test')
const assert = require('node:assert/strict')

const {
  findTabByPathInTabs,
  getNextActiveTabIdAfterClose,
  reorderTabsById,
  stripMarkdownExtension,
  computeAggregateDirty,
  resolveExternalChangeAction,
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

test('stripMarkdownExtension removes .md and .markdown case-insensitively', () => {
  assert.equal(stripMarkdownExtension('notes.md'), 'notes')
  assert.equal(stripMarkdownExtension('README.MARKDOWN'), 'README')
  assert.equal(stripMarkdownExtension('report.Markdown'), 'report')
  assert.equal(stripMarkdownExtension('archive.md.txt'), 'archive.md.txt')
  assert.equal(stripMarkdownExtension('plain'), 'plain')
  assert.equal(stripMarkdownExtension(null), '')
})

test('computeAggregateDirty reports whether any tab has unsaved changes', () => {
  assert.equal(computeAggregateDirty([]), false)
  assert.equal(computeAggregateDirty([{ dirty: false }, { dirty: false }]), false)
  assert.equal(computeAggregateDirty([{ dirty: false }, { dirty: true }]), true)
})

test('resolveExternalChangeAction picks a policy from the event and dirty state', () => {
  assert.equal(resolveExternalChangeAction({ event: 'unlink', isDirty: false }), 'mark-deleted')
  assert.equal(resolveExternalChangeAction({ event: 'unlink', isDirty: true }), 'mark-deleted')
  assert.equal(resolveExternalChangeAction({ event: 'change', isDirty: true }), 'confirm')
  assert.equal(resolveExternalChangeAction({ event: 'add', isDirty: true }), 'confirm')
  assert.equal(resolveExternalChangeAction({ event: 'change', isDirty: false }), 'reload')
  // Absent event (older main process) degrades safely to the change path.
  assert.equal(resolveExternalChangeAction({ event: undefined, isDirty: false }), 'reload')
  assert.equal(resolveExternalChangeAction({ event: undefined, isDirty: true }), 'confirm')
})
