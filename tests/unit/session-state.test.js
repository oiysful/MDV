const test = require('node:test')
const assert = require('node:assert/strict')

const { buildSessionState, isEmptySession } = require('../../src/renderer/session-state.js')

test('buildSessionState keeps only path-bearing tabs and maps the active index onto them', () => {
  const tabs = [
    { id: 1, path: '/docs/a.md' },
    { id: 2, path: null }, // unsaved tab — dropped, nothing to reopen from
    { id: 3, path: '/docs/c.md' },
  ]

  assert.deepEqual(buildSessionState(tabs, 3, '/docs'), {
    tabs: ['/docs/a.md', '/docs/c.md'],
    activeIndex: 1,
    explorerRoot: '/docs',
  })
})

test('buildSessionState falls back to index 0 when the active tab has no path, and -1 when empty', () => {
  const tabs = [
    { id: 1, path: '/docs/a.md' },
    { id: 2, path: null },
  ]
  // Active tab is the path-less one, so it isn't in the persisted list — default to first.
  assert.deepEqual(buildSessionState(tabs, 2, null), { tabs: ['/docs/a.md'], activeIndex: 0, explorerRoot: null })

  assert.deepEqual(buildSessionState([], null, null), { tabs: [], activeIndex: -1, explorerRoot: null })
  assert.deepEqual(buildSessionState([{ id: 1, path: null }], 1, null), { tabs: [], activeIndex: -1, explorerRoot: null })
})

test('buildSessionState normalizes a falsy explorer root to null and tolerates missing tabs', () => {
  assert.deepEqual(buildSessionState(undefined, null, ''), { tabs: [], activeIndex: -1, explorerRoot: null })
  assert.deepEqual(buildSessionState([{ id: 1, path: '/x.md' }], 1, undefined), { tabs: ['/x.md'], activeIndex: 0, explorerRoot: null })
})

test('isEmptySession is true only when there are no tabs AND no explorer root', () => {
  // The safety invariant: this exact case must never be written to disk, or a blank
  // Cmd+N window closing would wipe the real saved session.
  assert.equal(isEmptySession({ tabs: [], activeIndex: -1, explorerRoot: null }), true)
  assert.equal(isEmptySession(null), true)
  assert.equal(isEmptySession(undefined), true)
  assert.equal(isEmptySession({}), true)

  // A folder-only session (no tabs) is still worth keeping.
  assert.equal(isEmptySession({ tabs: [], activeIndex: -1, explorerRoot: '/docs' }), false)
  // Tabs present, no folder — worth keeping.
  assert.equal(isEmptySession({ tabs: ['/a.md'], activeIndex: 0, explorerRoot: null }), false)
})
