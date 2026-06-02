const test = require('node:test')
const assert = require('node:assert/strict')

const { hasDraggedFiles } = require('../../src/renderer/shell-actions.js')

test('hasDraggedFiles detects file drags from dataTransfer types', () => {
  assert.equal(hasDraggedFiles({ types: ['Files', 'text/plain'] }), true)
  assert.equal(hasDraggedFiles({ types: ['text/plain'] }), false)
  assert.equal(hasDraggedFiles(null), false)
})
