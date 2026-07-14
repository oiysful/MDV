const test = require('node:test')
const assert = require('node:assert/strict')

const { findMatches } = require('../../src/renderer/search.js')

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
