// Pure version-comparison helpers for the notify-only update checker (see
// docs/plans/15-in-app-update-notification.md). No Electron dependency, so this loads
// identically from src/main.js (require) and from tests (require) without stubbing.

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)$/

function parseVersion(str) {
  const m = VERSION_RE.exec(String(str || '').trim())
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

// "vX.Y.Z" or "X.Y.Z" -> bare "X.Y.Z". Anything that doesn't match VERSION_RE (a
// prerelease tag like "v1.3.0-beta.1", "latest", empty string) is rejected outright
// rather than partially parsed, so a rejected tag never reaches the renderer.
function normalizeTag(tag) {
  const v = parseVersion(tag)
  return v ? `${v.major}.${v.minor}.${v.patch}` : null
}

// Numeric major/minor/patch comparison -- NOT string comparison, which would rank
// "1.10.0" below "1.9.0". Returns -1/0/1, or null if either input fails to parse.
function compareVersions(a, b) {
  const va = parseVersion(a)
  const vb = parseVersion(b)
  if (!va || !vb) return null
  if (va.major !== vb.major) return va.major > vb.major ? 1 : -1
  if (va.minor !== vb.minor) return va.minor > vb.minor ? 1 : -1
  if (va.patch !== vb.patch) return va.patch > vb.patch ? 1 : -1
  return 0
}

function isNewerRelease(remoteTag, currentVersion) {
  const remote = normalizeTag(remoteTag)
  const current = normalizeTag(currentVersion)
  if (!remote || !current) return false
  return compareVersions(remote, current) === 1
}

function shouldNotify({ latestVersion, currentVersion, dismissedVersion }) {
  if (!isNewerRelease(latestVersion, currentVersion)) return false
  return normalizeTag(latestVersion) !== normalizeTag(dismissedVersion)
}

module.exports = { parseVersion, normalizeTag, compareVersions, isNewerRelease, shouldNotify }
