const test = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')

const { findMatches, createSearchController } = require('../../src/renderer/search.js')

function makeEditorSearchHarness(editorValue) {
  const dom = new JSDOM(`
    <div id="search-bar" style="display:none">
      <input id="search-input">
      <span id="search-count"></span>
    </div>
    <div id="content"></div>
    <textarea id="source-editor"></textarea>
  `)
  global.document = dom.window.document
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
  const sourceEditor = dom.window.document.getElementById('source-editor')
  sourceEditor.value = editorValue
  const content = dom.window.document.getElementById('content')
  const controller = createSearchController({ getRefs: () => ({ content, sourceEditor }) })
  return { controller, sourceEditor }
}

test('findMatches returns no matches for an empty query', () => {
  assert.deepEqual(findMatches('hello world', ''), [])
  assert.deepEqual(findMatches('hello world', '   '), [])
})

test('findMatches is case-insensitive', () => {
  assert.deepEqual(findMatches('Hello hello HELLO', 'hello'), [
    { start: 0, end: 5 },
    { start: 6, end: 11 },
    { start: 12, end: 17 },
  ])
})

test('findMatches finds adjacent (non-overlapping) matches', () => {
  assert.deepEqual(findMatches('aaaa', 'aa'), [
    { start: 0, end: 2 },
    { start: 2, end: 4 },
  ])
})

test('findMatches escapes regex special characters in the query', () => {
  assert.deepEqual(findMatches('a.b (c) [d]', '.'), [{ start: 1, end: 2 }])
  assert.deepEqual(findMatches('a.b (c) [d]', '(c)'), [{ start: 4, end: 7 }])
  assert.deepEqual(findMatches('a.b (c) [d]', '[d]'), [{ start: 8, end: 11 }])
})

test('findMatches returns an empty array when there are no hits', () => {
  assert.deepEqual(findMatches('hello world', 'xyz'), [])
})

test('editor search selects the first match while typing, before Enter is pressed', () => {
  const { controller, sourceEditor } = makeEditorSearchHarness('foo bar foo baz foo')
  controller.toggleSearch({ target: 'editor' })
  controller.runSearch('foo')
  assert.equal(sourceEditor.selectionStart, 0)
  assert.equal(sourceEditor.selectionEnd, 3)
})

test('editor search advances the selection on searchNext/searchPrev', () => {
  const { controller, sourceEditor } = makeEditorSearchHarness('foo bar foo baz foo')
  controller.toggleSearch({ target: 'editor' })
  controller.runSearch('foo')

  controller.searchNext()
  assert.equal(sourceEditor.selectionStart, 8)
  assert.equal(sourceEditor.selectionEnd, 11)

  controller.searchNext()
  assert.equal(sourceEditor.selectionStart, 16)
  assert.equal(sourceEditor.selectionEnd, 19)

  controller.searchPrev()
  assert.equal(sourceEditor.selectionStart, 8)
  assert.equal(sourceEditor.selectionEnd, 11)
})
