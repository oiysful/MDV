const test = require('node:test')
const assert = require('node:assert/strict')

const { isExternalUrl, resolveLocalImagePath } = require('../../src/renderer/path-utils.js')

test('isExternalUrl detects absolute and protocol-relative URLs', () => {
  assert.equal(isExternalUrl('https://example.com'), true)
  assert.equal(isExternalUrl('mailto:test@example.com'), true)
  assert.equal(isExternalUrl('//cdn.example.com/lib.js'), true)
  assert.equal(isExternalUrl('./local.png'), false)
  assert.equal(isExternalUrl('images/foo.png'), false)
})

test('resolveLocalImagePath resolves relative paths against the document path', () => {
  const resolved = resolveLocalImagePath('../images/foo.png', '/Users/test/docs/notes/basic.md')
  assert.equal(resolved, '/Users/test/docs/images/foo.png')
})

test('resolveLocalImagePath returns null for unsupported cases', () => {
  assert.equal(resolveLocalImagePath('https://example.com/foo.png', '/Users/test/docs/notes/basic.md'), null)
  assert.equal(resolveLocalImagePath('#local-anchor', '/Users/test/docs/notes/basic.md'), null)
  assert.equal(resolveLocalImagePath('images/foo.png', null), null)
})
