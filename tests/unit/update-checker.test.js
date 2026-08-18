const test = require('node:test')
const assert = require('node:assert/strict')

const { parseVersion, normalizeTag, compareVersions, isNewerRelease, shouldNotify } = require('../../src/update-checker.js')

test('parseVersion accepts a bare or v-prefixed X.Y.Z', () => {
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3 })
  assert.deepEqual(parseVersion('v1.2.3'), { major: 1, minor: 2, patch: 3 })
})

test('parseVersion rejects prerelease tags, garbage, and empty input', () => {
  assert.equal(parseVersion('v1.3.0-beta.1'), null)
  assert.equal(parseVersion('latest'), null)
  assert.equal(parseVersion(''), null)
  assert.equal(parseVersion(null), null)
  assert.equal(parseVersion(undefined), null)
})

test('normalizeTag strips a v prefix and rejects anything unparseable', () => {
  assert.equal(normalizeTag('v1.2.3'), '1.2.3')
  assert.equal(normalizeTag('1.2.3'), '1.2.3')
  assert.equal(normalizeTag('not-a-version'), null)
})

test('compareVersions ranks numerically, not lexicographically (1.10.0 > 1.9.0)', () => {
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1)
  assert.equal(compareVersions('1.9.0', '1.10.0'), -1)
})

test('compareVersions compares major/minor/patch in order and detects equality', () => {
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1)
  assert.equal(compareVersions('1.2.0', '1.10.0'), -1)
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0)
})

test('compareVersions returns null when either side fails to parse', () => {
  assert.equal(compareVersions('latest', '1.2.3'), null)
  assert.equal(compareVersions('1.2.3', 'latest'), null)
})

test('isNewerRelease is true only when the remote tag outranks the current version', () => {
  assert.equal(isNewerRelease('v1.3.0', '1.2.0'), true)
  assert.equal(isNewerRelease('v1.2.0', '1.2.0'), false)
  assert.equal(isNewerRelease('v1.1.0', '1.2.0'), false)
})

test('isNewerRelease is false when either side is unparseable, never throws', () => {
  assert.equal(isNewerRelease('latest', '1.2.0'), false)
  assert.equal(isNewerRelease('v1.3.0', 'not-a-version'), false)
})

test('shouldNotify is true for a newer, non-dismissed release', () => {
  assert.equal(shouldNotify({ latestVersion: '1.3.0', currentVersion: '1.2.0', dismissedVersion: null }), true)
})

test('shouldNotify is false once that exact version has been dismissed', () => {
  assert.equal(shouldNotify({ latestVersion: '1.3.0', currentVersion: '1.2.0', dismissedVersion: '1.3.0' }), false)
})

test('shouldNotify is true again once a newer release supersedes the dismissed one', () => {
  assert.equal(shouldNotify({ latestVersion: '1.4.0', currentVersion: '1.2.0', dismissedVersion: '1.3.0' }), true)
})

test('shouldNotify is false when the remote is not actually newer', () => {
  assert.equal(shouldNotify({ latestVersion: '1.2.0', currentVersion: '1.2.0', dismissedVersion: null }), false)
  assert.equal(shouldNotify({ latestVersion: '1.1.0', currentVersion: '1.2.0', dismissedVersion: null }), false)
})
