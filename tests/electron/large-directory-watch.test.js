const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { launchApp, closeApp } = require('./helpers/launch')
const { stubOpenDialog, emitRendererCommand } = require('./helpers/smoke-helpers')

// Reads back exactly which paths chokidar decided to watch for a given root, straight from
// the main process's dirWatchers map (exposed to globalThis only under MDV_USER_DATA_DIR --
// see main.js). This asserts DIR_WATCH_DEPTH/DIR_WATCH_IGNORED's real effect on chokidar's
// watch set directly, rather than waiting for a live add/change event to reach the renderer:
// that delivery path was found to be unreliable under this Electron test harness even
// though the same depth/ignore config is 100% reliable against chokidar directly outside
// Electron (verified separately) -- a pre-existing characteristic of directory-level watch
// events here, not something this test should have to work around to be meaningful.
async function getWatchedOnceReady(electronApp, dirPath, { attempts = 30, intervalMs = 100 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const result = await electronApp.evaluate((_electron, dp) => {
      const entry = globalThis.__mdvDirWatchers?.get(dp)
      return entry?.ready ? entry.watcher.getWatched() : null
    }, dirPath)
    if (result) return result
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  return null
}

test('watch-directory only watches shallow, non-ignored paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-depth-'))
  try {
    await fs.mkdir(path.join(root, 'level1', 'level2'), { recursive: true })
    await fs.mkdir(path.join(root, 'dist'), { recursive: true })
    await fs.writeFile(path.join(root, 'level1', 'shallow.md'), '# shallow\n')
    await fs.writeFile(path.join(root, 'dist', 'built.md'), '# built\n')

    const { electronApp, page } = await launchApp()
    try {
      await page.waitForSelector('#empty')
      await stubOpenDialog(electronApp, [root])
      await emitRendererCommand(electronApp, 'openFolder')
      await page.waitForFunction(() => document.getElementById('explorer-root-path')?.textContent)

      // The watcher's initial scan finishes asynchronously after the IPC call returns
      // (main.js never awaits chokidar's 'ready') -- poll until entry.ready instead of
      // reading getWatched() mid-scan, which returns a partial, non-deterministic snapshot.
      const watched = await getWatchedOnceReady(electronApp, root)
      assert.ok(watched, 'watch-directory never became ready for the opened root')

      const rootChildren = watched[root] || []
      assert.ok(rootChildren.includes('level1'), 'level1 should be watched (depth 1, not ignored)')
      assert.ok(!rootChildren.includes('dist'), 'dist should be excluded by DIR_WATCH_IGNORED')

      const level1Children = watched[path.join(root, 'level1')] || []
      assert.ok(level1Children.includes('shallow.md'), 'files directly inside level1 should be watched (depth 1)')

      // level2 is two levels below root -- chokidar's depth cutoff means its own contents are
      // never traversed. It can still appear as a recognized entry (an empty array), just
      // never with children.
      const level2Children = watched[path.join(root, 'level1', 'level2')] || []
      assert.deepEqual(level2Children, [], 'level2 (depth 2) should not have its contents watched')
    } finally {
      await closeApp(electronApp)
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('a pathologically large directory trips the path-count guard instead of hanging the app', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-guard-'))
  const prevGuard = process.env.MDV_TEST_DIR_WATCH_MAX_PATHS
  process.env.MDV_TEST_DIR_WATCH_MAX_PATHS = '3'
  try {
    // 5 flat entries trips a guard threshold of 3 without needing tens of thousands of files.
    for (let i = 0; i < 5; i++) {
      await fs.writeFile(path.join(root, `file-${i}.md`), `# file ${i}\n`)
    }

    const { electronApp, page } = await launchApp()
    try {
      await page.waitForSelector('#empty')
      await stubOpenDialog(electronApp, [root])
      await emitRendererCommand(electronApp, 'openFolder')

      // The tree itself must still load normally (list-directory is unaffected by the watch guard).
      await page.waitForFunction(() => document.getElementById('explorer-tree').textContent.includes('file-0.md'))

      // The watch guard should fire and surface a toast, not hang.
      await page.waitForFunction(() => document.getElementById('toast')?.classList.contains('show'))
      const toastText = await page.textContent('#toast')
      assert.match(toastText, /너무 커서/)

      // The app must stay responsive after the guard trips -- a real IPC round trip proves it.
      await emitRendererCommand(electronApp, 'toggleTheme')
      await page.waitForFunction(() => document.documentElement.dataset.theme)
    } finally {
      await closeApp(electronApp)
    }
  } finally {
    if (prevGuard === undefined) delete process.env.MDV_TEST_DIR_WATCH_MAX_PATHS
    else process.env.MDV_TEST_DIR_WATCH_MAX_PATHS = prevGuard
    await fs.rm(root, { recursive: true, force: true })
  }
})
