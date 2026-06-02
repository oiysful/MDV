const test = require('node:test')
const assert = require('node:assert/strict')

const { getTreeRowPadding, getFolderArrow } = require('../../src/renderer/explorer.js')

test('getTreeRowPadding increases indentation per depth level', () => {
  assert.equal(getTreeRowPadding(0), '12px')
  assert.equal(getTreeRowPadding(1), '26px')
  assert.equal(getTreeRowPadding(3), '54px')
})

test('getFolderArrow reflects collapsed and expanded state', () => {
  assert.equal(getFolderArrow(false), '▶')
  assert.equal(getFolderArrow(true), '▼')
})
