// Which fs-watch backend a path gets. Pure path logic -- no Electron, no fs -- so it loads
// identically from src/main.js (require) and from tests (require), same as update-checker.js.
//
// Why this exists: libuv watches a *file* with a one-shot kqueue EVFILT_VNODE registration
// (FSEvents is directory-only -- see the `/* FSEvents works only with directories */` branch
// in uv_fs_event_start), and uv__fs_event ends in abort(), not an error return, when
// re-arming that registration fails. So a watched file whose volume disappears takes the
// whole process down: MDV 1.3.0 died that way on 2026-09-21, 24 seconds after a wake, with a
// file open on a /Volumes mount. chokidar's polling backend uses fs.watchFile (uv_fs_poll,
// stat-based) and never registers a vnode filter, so paths that can lose their volume are
// polled instead. Full diagnosis: docs/plans/22-volume-loss-file-watch-abort.md.

// macOS mounts every non-boot volume -- external disks, disk images, SMB/AFP shares -- under
// /Volumes, so one prefix covers the whole risk class. The boot volume's own symlink
// (/Volumes/Macintosh HD) matches too and gets polled for nothing; that costs one stat per
// poll interval and is not worth a special case.
const DEFAULT_POLL_ROOTS = ['/Volumes/']

// Trailing separator is what makes this a directory-prefix test rather than a string test:
// without it, '/Volumes' would also match '/VolumesBackup/notes.md'.
function normalizePollRoot(root) {
  const trimmed = String(root || '').trim()
  if (!trimmed) return null
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

// Overridable so a test can put a temp directory under the polled branch without mounting a
// real volume -- same reasoning as MDV_TEST_DIR_WATCH_MAX_PATHS in main.js. Comma-separated.
function pollRootsFromEnv(env = {}) {
  const raw = env.MDV_TEST_WATCH_POLL_ROOTS
  const roots = raw ? String(raw).split(',') : DEFAULT_POLL_ROOTS
  return roots.map(normalizePollRoot).filter(Boolean)
}

function isPolledPath(targetPath, roots = DEFAULT_POLL_ROOTS) {
  if (typeof targetPath !== 'string' || !targetPath) return false
  return roots.some(root => {
    const prefix = normalizePollRoot(root)
    return Boolean(prefix) && targetPath.startsWith(prefix)
  })
}

// Returns the options object to hand chokidar.watch(): `base` unchanged for a local path,
// `base` plus the poll backend for a path that can lose its volume. `interval` is left
// alone on purpose -- chokidar's own defaults (100ms, 300ms for binary paths via
// binaryInterval) apply, and setting only `interval` would silently change the cadence for
// the embedded images watch-file also handles.
function watchOptionsFor(targetPath, roots, base = {}) {
  return isPolledPath(targetPath, roots) ? { ...base, usePolling: true } : { ...base }
}

module.exports = { DEFAULT_POLL_ROOTS, normalizePollRoot, pollRootsFromEnv, isPolledPath, watchOptionsFor }
