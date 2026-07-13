const test = require('node:test')
const assert = require('node:assert/strict')

const {
  getLoadTargetsFromOpenResult,
  syncTabContentForSave,
  detectSaveConflict,
} = require('../../src/renderer/document-flow.js')

test('getLoadTargetsFromOpenResult returns file targets from dialog payloads', () => {
  assert.deepEqual(getLoadTargetsFromOpenResult({ cancelled: true }), [])
  assert.deepEqual(getLoadTargetsFromOpenResult({ files: [{ path: '/tmp/a.md' }, { path: '/tmp/b.md' }] }), [{ path: '/tmp/a.md' }, { path: '/tmp/b.md' }])
  assert.deepEqual(getLoadTargetsFromOpenResult({ content: '# Draft', filename: 'draft.md' }), [{ content: '# Draft', filename: 'draft.md' }])
  assert.deepEqual(getLoadTargetsFromOpenResult({}), [])
})

test('syncTabContentForSave copies editor content into the active tab in source or split mode', () => {
  const tab = { content: '# Before' }
  let markdownValue = null

  syncTabContentForSave({
    tab,
    getSourceMode: () => true,
    getEditorValue: () => '# After',
    setMarkdown: value => { markdownValue = value },
  })

  assert.equal(tab.content, '# After')
  assert.equal(markdownValue, '# After')

  syncTabContentForSave({
    tab,
    getSourceMode: () => false,
    getSplitMode: () => true,
    getEditorValue: () => '# Split After',
    setMarkdown: value => { markdownValue = value },
  })

  assert.equal(tab.content, '# Split After')
  assert.equal(markdownValue, '# Split After')

  syncTabContentForSave({
    tab,
    getSourceMode: () => false,
    getSplitMode: () => false,
    getEditorValue: () => '# Ignored',
    setMarkdown: value => { markdownValue = value },
  })

  assert.equal(tab.content, '# Split After')
  assert.equal(markdownValue, '# Split After')
})

test('detectSaveConflict distinguishes a clean save, an external edit, a deletion, and an unreadable file', () => {
  // Disk matches what we last saved: nothing to warn about.
  assert.equal(detectSaveConflict({ content: '# Same' }, '# Same'), null)
  // Disk changed under us since the last save.
  assert.equal(detectSaveConflict({ content: '# External edit' }, '# Same'), 'changed')
  // File was deleted: saving just recreates it, so no prompt.
  assert.equal(detectSaveConflict({ error: 'no such file', code: 'ENOENT' }, '# Same'), 'deleted')
  // We could not read the file, so we cannot know whether we are clobbering someone.
  // This used to be treated as "no conflict" and overwrote silently.
  assert.equal(detectSaveConflict({ error: 'permission denied', code: 'EACCES' }, '# Same'), 'unreadable')
  assert.equal(detectSaveConflict({ error: 'io error' }, '# Same'), 'unreadable')
  assert.equal(detectSaveConflict(null, '# Same'), 'unreadable')
})
