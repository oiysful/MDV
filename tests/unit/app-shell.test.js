const test = require('node:test')
const assert = require('node:assert/strict')

const { splitHrefFragment } = require('../../src/renderer/app-shell.js')

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
