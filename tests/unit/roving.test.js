const test = require('node:test')
const assert = require('node:assert/strict')

const { getRovingIndex } = require('../../src/renderer/roving.js')

test('getRovingIndex steps forward and backward within range', () => {
  assert.equal(getRovingIndex(0, 1, 3), 1)
  assert.equal(getRovingIndex(2, -1, 3), 1)
})

test('getRovingIndex clamps at boundaries by default (no wrap)', () => {
  assert.equal(getRovingIndex(2, 1, 3), 2)
  assert.equal(getRovingIndex(0, -1, 3), 0)
})

test('getRovingIndex wraps around when wrap is enabled', () => {
  assert.equal(getRovingIndex(2, 1, 3, { wrap: true }), 0)
  assert.equal(getRovingIndex(0, -1, 3, { wrap: true }), 2)
})

test('getRovingIndex collapses empty or invalid input to 0', () => {
  assert.equal(getRovingIndex(0, 1, 0), 0)
  assert.equal(getRovingIndex(5, -1, 0), 0)
  assert.equal(getRovingIndex(NaN, 1, 4), 1)
})
