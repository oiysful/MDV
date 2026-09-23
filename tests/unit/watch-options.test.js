const test = require('node:test')
const assert = require('node:assert/strict')

const { DEFAULT_POLL_ROOTS, pollRootsFromEnv, isPolledPath, watchOptionsFor } = require('../../src/watch-options.js')

// What this file guards: which fs-watch backend a path gets. Picking the kqueue backend for a
// path that can lose its volume is not a degraded feature, it is a process abort
// (docs/plans/22-volume-loss-file-watch-abort.md), so the prefix test is worth pinning
// precisely -- including the boundary cases a naive startsWith would get wrong.

test('isPolledPath routes /Volumes paths to the poll backend and leaves the boot volume alone', () => {
  assert.equal(isPolledPath('/Volumes/Cerulean/notes.md'), true)
  assert.equal(isPolledPath('/Volumes/Backup SSD/a/b/c.md'), true)
  assert.equal(isPolledPath('/Users/ian/projects/MDV/README.md'), false)
  assert.equal(isPolledPath('/tmp/scratch.md'), false)
})

test('isPolledPath tests a directory prefix, not a string prefix', () => {
  // The trailing separator is the whole point: '/Volumes' alone would swallow these.
  assert.equal(isPolledPath('/VolumesBackup/notes.md'), false)
  assert.equal(isPolledPath('/Volumes'), false)
  assert.equal(isPolledPath('/home/Volumes/notes.md'), false)
})

test('isPolledPath treats a missing or non-string path as local rather than throwing', () => {
  assert.equal(isPolledPath(''), false)
  assert.equal(isPolledPath(undefined), false)
  assert.equal(isPolledPath(null), false)
  assert.equal(isPolledPath(42), false)
})

test('pollRootsFromEnv defaults to /Volumes/ and normalizes an override', () => {
  assert.deepEqual(pollRootsFromEnv({}), DEFAULT_POLL_ROOTS)
  assert.deepEqual(pollRootsFromEnv({ MDV_TEST_WATCH_POLL_ROOTS: '/tmp/mdv-x' }), ['/tmp/mdv-x/'])
  assert.deepEqual(
    pollRootsFromEnv({ MDV_TEST_WATCH_POLL_ROOTS: '/tmp/a/, /tmp/b' }),
    ['/tmp/a/', '/tmp/b/'],
  )
  // An empty or whitespace-only entry must not become a root that matches everything.
  assert.deepEqual(pollRootsFromEnv({ MDV_TEST_WATCH_POLL_ROOTS: '/tmp/a,, ' }), ['/tmp/a/'])
})

test('an overridden root replaces the default instead of extending it', () => {
  const roots = pollRootsFromEnv({ MDV_TEST_WATCH_POLL_ROOTS: '/tmp/mdv-x' })
  assert.equal(isPolledPath('/tmp/mdv-x/notes.md', roots), true)
  assert.equal(isPolledPath('/Volumes/Cerulean/notes.md', roots), false)
})

test('watchOptionsFor adds only usePolling, and leaves the caller\'s base untouched', () => {
  const base = { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 200 } }
  const local = watchOptionsFor('/Users/ian/a.md', DEFAULT_POLL_ROOTS, base)
  const polled = watchOptionsFor('/Volumes/Cerulean/a.md', DEFAULT_POLL_ROOTS, base)

  assert.deepEqual(local, base)
  assert.equal(polled.usePolling, true)
  assert.equal(polled.ignoreInitial, true)
  assert.deepEqual(polled.awaitWriteFinish, { stabilityThreshold: 200 })

  // No `interval`: chokidar's defaults (100ms, 300ms for binary paths) stay in force. Setting
  // only `interval` would move markdown off the default cadence while the embedded images
  // watch-file also handles kept binaryInterval, silently splitting the two.
  assert.equal('interval' in polled, false)
  assert.equal('binaryInterval' in polled, false)

  // The base object is the caller's; a second call must not see a mutated one.
  assert.equal('usePolling' in base, false)
})

test('watchOptionsFor works with no base at all', () => {
  assert.deepEqual(watchOptionsFor('/Volumes/x/a.md', DEFAULT_POLL_ROOTS), { usePolling: true })
  assert.deepEqual(watchOptionsFor('/Users/ian/a.md', DEFAULT_POLL_ROOTS), {})
})
