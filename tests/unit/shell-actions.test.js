const test = require('node:test')
const assert = require('node:assert/strict')

const { hasDraggedFiles, resolveDroppedFilePath } = require('../../src/renderer/shell-actions.js')

test('hasDraggedFiles detects file drags from dataTransfer types', () => {
  assert.equal(hasDraggedFiles({ types: ['Files', 'text/plain'] }), true)
  assert.equal(hasDraggedFiles({ types: ['text/plain'] }), false)
  assert.equal(hasDraggedFiles(null), false)
})

test('resolveDroppedFilePath prefers the webUtils path resolver', () => {
  const file = { name: 'notes.md', path: '/legacy/notes.md' }
  const api = { getPathForFile: f => (f === file ? '/real/notes.md' : null) }
  assert.equal(resolveDroppedFilePath(file, api), '/real/notes.md')
})

test('resolveDroppedFilePath falls back to File.path when the resolver is missing or empty', () => {
  assert.equal(resolveDroppedFilePath({ path: '/legacy/notes.md' }, undefined), '/legacy/notes.md')
  assert.equal(resolveDroppedFilePath({ path: '/legacy/notes.md' }, { getPathForFile: () => '' }), '/legacy/notes.md')
})

test('resolveDroppedFilePath returns null when no path is available', () => {
  assert.equal(resolveDroppedFilePath({ name: 'notes.md' }, {}), null)
})
