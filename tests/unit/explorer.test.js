const test = require('node:test')
const assert = require('node:assert/strict')

const { getTreeRowPadding, getFolderArrow, getExplorerRootLabel } = require('../../src/renderer/explorer.js')

test('getTreeRowPadding increases indentation per depth level', () => {
  assert.equal(getTreeRowPadding(0), '12px')
  assert.equal(getTreeRowPadding(1), '26px')
  assert.equal(getTreeRowPadding(3), '54px')
})

test('getFolderArrow reflects collapsed and expanded state', () => {
  assert.equal(getFolderArrow(false), '▶')
  assert.equal(getFolderArrow(true), '▼')
})

test('getExplorerRootLabel switches between placeholder, basename, and full path', () => {
  assert.equal(getExplorerRootLabel(null, false), '폴더를 선택하세요')
  assert.equal(getExplorerRootLabel('/tmp/docs/project', false), 'project')
  assert.equal(getExplorerRootLabel('/tmp/docs/project', true), '/tmp/docs/project')
})
