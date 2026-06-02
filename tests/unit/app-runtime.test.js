const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createEmptyStateHtml,
  getNextUntitledFilename,
} = require('../../src/renderer/app-runtime.js')

test('getNextUntitledFilename increments untitled names predictably', () => {
  assert.equal(getNextUntitledFilename(1), 'untitled.md')
  assert.equal(getNextUntitledFilename(2), 'untitled-2.md')
  assert.equal(getNextUntitledFilename(5), 'untitled-5.md')
})

test('createEmptyStateHtml keeps file and folder open actions in the empty state', () => {
  const html = createEmptyStateHtml()
  assert.match(html, /data-command="openFile"/)
  assert.match(html, /data-command="openFolder"/)
  assert.doesNotMatch(html, /onclick=/)
  assert.match(html, /열린 파일 없음/)
})
