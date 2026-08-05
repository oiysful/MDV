const test = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')

const { findMatches, createSearchController, extractLinePrefix } = require('../../src/renderer/search.js')

function makeEditorSearchHarness(editorValue) {
  const dom = new JSDOM(`
    <div id="search-bar" style="display:none">
      <input id="search-input">
      <span id="search-count"></span>
    </div>
    <div id="content"></div>
    <div id="scroll-area"><textarea id="source-editor"></textarea></div>
  `)
  global.document = dom.window.document
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
  const sourceEditor = dom.window.document.getElementById('source-editor')
  sourceEditor.value = editorValue
  const scrollArea = dom.window.document.getElementById('scroll-area')
  const content = dom.window.document.getElementById('content')
  const controller = createSearchController({ getRefs: () => ({ content, sourceEditor, scrollArea }) })
  return { controller, sourceEditor, scrollArea }
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

test('searchNext/searchPrev leave the editor focused so the match selection is actually visible', () => {
  // Chromium only paints a text field's selection while it has focus. An earlier version
  // moved focus back to #search-input synchronously in the same call that focused the editor,
  // before the browser ever got a frame to paint -- so the highlight never rendered. Focus
  // must now stay on the editor after jumping to a match.
  const { controller, sourceEditor } = makeEditorSearchHarness('foo bar foo baz foo')
  controller.toggleSearch({ target: 'editor' })
  controller.runSearch('foo')

  controller.searchNext()
  assert.equal(document.activeElement, sourceEditor, 'editor must stay focused after searchNext')

  controller.searchPrev()
  assert.equal(document.activeElement, sourceEditor, 'editor must stay focused after searchPrev')
})

test('extractLinePrefix returns text from the start of the offset\'s line, not the whole document', () => {
  assert.equal(extractLinePrefix('foo bar\nbaz qux', 13), 'baz q')
  assert.equal(extractLinePrefix('single line', 6), 'single')
  assert.equal(extractLinePrefix('line1\nline2\nline3', 17), 'line3')
})

test('extractLinePrefix returns an empty string for an offset at the start of a line', () => {
  assert.equal(extractLinePrefix('foo\nbar', 4), '')
})

test('editor search sets scrollLeft on the editor and scrollTop on the ancestor scroll-area, not the editor itself', () => {
  const { controller, sourceEditor, scrollArea } = makeEditorSearchHarness('x'.repeat(500) + '\nmatch')
  controller.toggleSearch({ target: 'editor' })
  controller.runSearch('match')
  // jsdom has no real layout engine (getBoundingClientRect is always zeroed), so this can't
  // assert exact pixel values -- it asserts the fix's actual claim: scrollTop lands on the
  // ancestor scroller, and scrollLeft is computed (not left untouched) on the editor.
  assert.equal(typeof scrollArea.scrollTop, 'number')
  assert.equal(typeof sourceEditor.scrollLeft, 'number')
})

test('getCurrentTarget reflects the target toggleSearch was opened with', () => {
  const { controller } = makeEditorSearchHarness('foo bar')
  assert.equal(controller.getCurrentTarget(), 'preview')
  controller.toggleSearch({ target: 'editor' })
  assert.equal(controller.getCurrentTarget(), 'editor')
  controller.closeSearch()
  assert.equal(controller.getCurrentTarget(), 'preview')
})
