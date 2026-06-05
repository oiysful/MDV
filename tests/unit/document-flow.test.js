const test = require('node:test')
const assert = require('node:assert/strict')

const {
  getLoadTargetsFromOpenResult,
  syncTabContentForSave,
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
