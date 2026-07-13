const test = require('node:test')
const assert = require('node:assert/strict')

const { isExternalUrl, resolveLocalImagePath, pathToFileUrl } = require('../../src/renderer/path-utils.js')

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

test('resolveLocalImagePath treats a document-root absolute path as document-relative', () => {
  // A leading `/` must not resolve to the OS filesystem root.
  assert.equal(
    resolveLocalImagePath('/foo.png', '/Users/test/docs/notes/basic.md'),
    '/Users/test/docs/notes/foo.png',
  )
  assert.equal(
    resolveLocalImagePath('/assets/foo.png', '/Users/test/docs/notes/basic.md'),
    '/Users/test/docs/notes/assets/foo.png',
  )
})

test('resolveLocalImagePath handles spaces and reserved characters in the document path', () => {
  // The old `file://${baseDir}` concat broke here: `#notes/` became a URL fragment.
  assert.equal(
    resolveLocalImagePath('foo.png', '/Users/test/my docs/#notes/basic.md'),
    '/Users/test/my docs/#notes/foo.png',
  )
  assert.equal(
    resolveLocalImagePath('../pics/a b.png', '/Users/test/a#b/notes/basic.md'),
    '/Users/test/a#b/pics/a b.png',
  )
})

test('resolveLocalImagePath keeps reserved characters in the image name itself', () => {
  assert.equal(
    resolveLocalImagePath('foo#1.png', '/Users/test/docs/basic.md'),
    '/Users/test/docs/foo#1.png',
  )
})

test('pathToFileUrl encodes each path segment', () => {
  assert.equal(pathToFileUrl('/Users/test/my docs/'), 'file:///Users/test/my%20docs/')
  assert.equal(pathToFileUrl('/Users/test/a#b/'), 'file:///Users/test/a%23b/')
})
