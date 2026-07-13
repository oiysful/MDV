const test = require('node:test')
const assert = require('node:assert/strict')

const { isExternalUrl, resolveLocalImageCandidates, pathToFileUrl } = require('../../src/renderer/path-utils.js')

// Convenience for the single-reading cases: most srcs resolve to exactly one path.
const resolveOne = (src, docPath) => resolveLocalImageCandidates(src, docPath)[0] ?? null

test('isExternalUrl detects absolute and protocol-relative URLs', () => {
  assert.equal(isExternalUrl('https://example.com'), true)
  assert.equal(isExternalUrl('mailto:test@example.com'), true)
  assert.equal(isExternalUrl('//cdn.example.com/lib.js'), true)
  assert.equal(isExternalUrl('./local.png'), false)
  assert.equal(isExternalUrl('images/foo.png'), false)
})

test('resolves relative paths against the document path', () => {
  assert.equal(resolveOne('../images/foo.png', '/Users/test/docs/notes/basic.md'), '/Users/test/docs/images/foo.png')
})

test('yields no candidates for unsupported cases', () => {
  const doc = '/Users/test/docs/notes/basic.md'
  assert.deepEqual(resolveLocalImageCandidates('https://example.com/foo.png', doc), [])
  assert.deepEqual(resolveLocalImageCandidates('#local-anchor', doc), [])
  assert.deepEqual(resolveLocalImageCandidates('images/foo.png', null), [])
})

test('a leading slash yields both the absolute and the document-relative reading', () => {
  const doc = '/Users/test/docs/notes/basic.md'

  // A genuine absolute path is tried first. Resolving it document-relative only
  // (the previous behavior) produced /Users/test/docs/notes/Users/test/pics/shot.png,
  // so absolute image paths never loaded.
  assert.deepEqual(
    resolveLocalImageCandidates('/Users/test/pics/shot.png', doc),
    ['/Users/test/pics/shot.png', '/Users/test/docs/notes/Users/test/pics/shot.png'],
  )

  // A document-root-relative src must still resolve under the document directory
  // rather than the OS root, so that reading stays available as a fallback.
  assert.deepEqual(
    resolveLocalImageCandidates('/foo.png', doc),
    ['/foo.png', '/Users/test/docs/notes/foo.png'],
  )
  assert.deepEqual(
    resolveLocalImageCandidates('/assets/foo.png', doc),
    ['/assets/foo.png', '/Users/test/docs/notes/assets/foo.png'],
  )

  // Ordinary relative paths have exactly one reading.
  assert.deepEqual(
    resolveLocalImageCandidates('img/foo.png', doc),
    ['/Users/test/docs/notes/img/foo.png'],
  )
})

test('handles spaces and reserved characters in the document path', () => {
  // The old `file://${baseDir}` concat broke here: `#notes/` became a URL fragment.
  assert.equal(
    resolveOne('foo.png', '/Users/test/my docs/#notes/basic.md'),
    '/Users/test/my docs/#notes/foo.png',
  )
  assert.equal(
    resolveOne('../pics/a b.png', '/Users/test/a#b/notes/basic.md'),
    '/Users/test/a#b/pics/a b.png',
  )
})

test('keeps reserved characters in the image name itself', () => {
  assert.equal(resolveOne('foo#1.png', '/Users/test/docs/basic.md'), '/Users/test/docs/foo#1.png')
})

test('handles filenames containing a bare percent', () => {
  // decodeURIComponent threw on the lone %, so these images were silently dropped.
  assert.equal(resolveOne('50%.png', '/Users/test/docs/basic.md'), '/Users/test/docs/50%.png')
  assert.equal(resolveOne('a b%c.png', '/Users/test/docs/basic.md'), '/Users/test/docs/a b%c.png')
})

test('pathToFileUrl encodes each path segment', () => {
  assert.equal(pathToFileUrl('/Users/test/my docs/'), 'file:///Users/test/my%20docs/')
  assert.equal(pathToFileUrl('/Users/test/a#b/'), 'file:///Users/test/a%23b/')
})
