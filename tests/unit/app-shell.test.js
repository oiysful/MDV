const test = require('node:test')
const assert = require('node:assert/strict')

const { splitHrefFragment, resolveSearchKeydownAction } = require('../../src/renderer/app-shell.js')

test('splitHrefFragment splits a local link href on its first #', () => {
  assert.deepEqual(
    splitHrefFragment('./README.md#구현-요약-2026-07-20'),
    { path: './README.md', fragment: '구현-요약-2026-07-20' },
  )
})

test('splitHrefFragment returns the whole href as path when there is no #', () => {
  assert.deepEqual(splitHrefFragment('./README.md'), { path: './README.md', fragment: '' })
})

test('splitHrefFragment splits on the first # even for a literal # in the filename', () => {
  // Documented ambiguity (plan doc #5, risk section): a filename containing a literal
  // `#` followed by a real anchor cannot be distinguished from "file with # anchor".
  // This is out of scope for v1 — the first `#` always wins.
  assert.deepEqual(
    splitHrefFragment('../my notes/a#b.md'),
    { path: '../my notes/a', fragment: 'b.md' },
  )
})

test('splitHrefFragment treats a pure in-page anchor as an empty path', () => {
  assert.deepEqual(splitHrefFragment('#section'), { path: '', fragment: 'section' })
})

// resolveSearchKeydownAction: shared by the search-input and source-editor keydown listeners
// in bindSearchEvents (docs/plans/08-search-highlight-and-ime-fixes.md).
test('resolveSearchKeydownAction returns null while an IME composition is in progress', () => {
  // Real repro: confirming a Korean composition with Enter fires a keydown with
  // isComposing: true before compositionend. Acting on it duplicated the trailing syllable.
  assert.equal(resolveSearchKeydownAction({ key: 'Enter', isComposing: true, shiftKey: false }), null)
  assert.equal(resolveSearchKeydownAction({ key: 'Enter', isComposing: true, shiftKey: true }), null)
})

test('resolveSearchKeydownAction ignores non-Enter keys', () => {
  assert.equal(resolveSearchKeydownAction({ key: 'a', isComposing: false, shiftKey: false }), null)
  assert.equal(resolveSearchKeydownAction({ key: 'Escape', isComposing: false, shiftKey: false }), null)
})

test('resolveSearchKeydownAction maps a real Enter to next and Shift+Enter to prev', () => {
  assert.equal(resolveSearchKeydownAction({ key: 'Enter', isComposing: false, shiftKey: false }), 'next')
  assert.equal(resolveSearchKeydownAction({ key: 'Enter', isComposing: false, shiftKey: true }), 'prev')
})
