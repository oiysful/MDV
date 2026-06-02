const test = require('node:test')
const assert = require('node:assert/strict')

const { computeContextMenuPosition } = require('../../src/renderer/context-menu.js')

test('computeContextMenuPosition clamps the floating menu within the viewport', () => {
  assert.deepEqual(computeContextMenuPosition(20, 30, 100, 80, 400, 300), { left: 20, top: 30 })
  assert.deepEqual(computeContextMenuPosition(390, 290, 120, 90, 400, 300), { left: 272, top: 202 })
  assert.deepEqual(computeContextMenuPosition(0, 0, 120, 90, 400, 300), { left: 8, top: 8 })
})
