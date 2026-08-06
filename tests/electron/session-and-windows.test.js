const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { launchApp, closeApp, stubCloseDialog, getCloseDialogCalls } = require('./helpers/launch')
const {
  BASIC_MD, ROOT_MD, EXPLORER_DIR,
  stubOpenDialog, stubSaveDialog, createTempMarkdown,
  emitFileOpened, emitRendererCommand, clickApplicationMenuItem,
  stubOpenExternal, getOpenExternalCalls,
} = require('./helpers/smoke-helpers')

// ── Session restore / recent documents ──────────────────────────
// The renderer debounces its session-state push (SESSION_SAVE_DEBOUNCE_MS in app.js, 350ms);
// main only writes at close. So a test must wait past that window before quitting, or main's
// per-window mirror is still stale and persistSession writes nothing.
const SESSION_DEBOUNCE_WAIT = 700

async function openRealFiles(electronApp, page, filePaths, expectedCount) {
  await stubOpenDialog(electronApp, filePaths)
  await emitRendererCommand(electronApp, 'openFile')
  await page.waitForFunction(n => document.querySelectorAll('#tab-list .file-tab').length === n, expectedCount)
}

async function stubAddRecentDocument(electronApp) {
  await electronApp.evaluate(({ app }) => {
    globalThis.__recentDocs = []
    app.addRecentDocument = (p) => { globalThis.__recentDocs.push(p) }
  })
}

async function getRecentDocs(electronApp) {
  return electronApp.evaluate(() => globalThis.__recentDocs ?? [])
}

test('session restore reopens saved tabs and the explorer root after relaunch', async () => {
  const first = await createTempMarkdown(BASIC_MD, 'restore-one.md')
  const second = await createTempMarkdown(ROOT_MD, 'restore-two.md')
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-session-'))

  try {
    let { electronApp, page } = await launchApp({ userDataDir })
    await page.waitForSelector('#empty')
    await openRealFiles(electronApp, page, [first.path, second.path], 2)
    await stubOpenDialog(electronApp, [EXPLORER_DIR])
    await emitRendererCommand(electronApp, 'openFolder')
    await page.waitForFunction(() => document.getElementById('explorer-tree').textContent.includes('root.md'))
    await page.waitForTimeout(SESSION_DEBOUNCE_WAIT)
    await closeApp(electronApp)

    ;({ electronApp, page } = await launchApp({ userDataDir }))
    try {
      await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 2)
      const tabNames = await page.$$eval('#tab-list .file-tab .file-tab-name', els => els.map(el => el.textContent))
      assert.ok(tabNames.some(name => name.includes('restore-one.md')), `expected restore-one.md, got ${JSON.stringify(tabNames)}`)
      assert.ok(tabNames.some(name => name.includes('restore-two.md')), `expected restore-two.md, got ${JSON.stringify(tabNames)}`)
      await page.waitForFunction(() => document.getElementById('explorer-root-path').textContent === 'explorer')
      assert.match(await page.textContent('#explorer-tree'), /root\.md/)
    } finally {
      await closeApp(electronApp)
    }
  } finally {
    await first.cleanup()
    await second.cleanup()
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})

test('session restore skips a deleted file without an alert and restores the survivor', async () => {
  const survivor = await createTempMarkdown(BASIC_MD, 'survivor.md')
  const doomed = await createTempMarkdown(ROOT_MD, 'doomed.md')
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-session-'))

  try {
    let { electronApp, page } = await launchApp({ userDataDir })
    await page.waitForSelector('#empty')
    await openRealFiles(electronApp, page, [survivor.path, doomed.path], 2)
    await page.waitForTimeout(SESSION_DEBOUNCE_WAIT)
    await closeApp(electronApp)

    // Remove one saved file before relaunch — restore must read-fail and skip it silently.
    await doomed.cleanup()

    ;({ electronApp, page } = await launchApp({ userDataDir }))
    const dialogs = []
    page.on('dialog', dialog => { dialogs.push(dialog.message()); dialog.dismiss().catch(() => {}) })
    try {
      await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 1)
      const tabNames = await page.$$eval('#tab-list .file-tab .file-tab-name', els => els.map(el => el.textContent))
      assert.ok(tabNames.some(name => name.includes('survivor.md')), `expected survivor.md, got ${JSON.stringify(tabNames)}`)
      assert.ok(!tabNames.some(name => name.includes('doomed.md')), 'deleted file must not restore')
      // Give any stray alert a chance to surface, then assert none fired.
      await page.waitForTimeout(300)
      assert.deepEqual(dialogs, [], `restore must not raise a dialog, got ${JSON.stringify(dialogs)}`)
    } finally {
      await closeApp(electronApp)
    }
  } finally {
    await survivor.cleanup()
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})

test('an empty session on quit does not overwrite a previously saved session', async () => {
  const first = await createTempMarkdown(BASIC_MD, 'keep-one.md')
  const second = await createTempMarkdown(ROOT_MD, 'keep-two.md')
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-session-'))

  try {
    // Establish a good two-tab session on disk.
    let { electronApp, page } = await launchApp({ userDataDir })
    await page.waitForSelector('#empty')
    await openRealFiles(electronApp, page, [first.path, second.path], 2)
    await page.waitForTimeout(SESSION_DEBOUNCE_WAIT)
    await closeApp(electronApp)

    // Relaunch, close every tab (empty session), quit. The empty-session guard must keep
    // the on-disk session intact rather than wiping it.
    ;({ electronApp, page } = await launchApp({ userDataDir }))
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 2)
    await page.locator('#tab-list .file-tab.active .file-tab-close').click()
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 1)
    await page.locator('#tab-list .file-tab.active .file-tab-close').click()
    await page.waitForSelector('#empty')
    await page.waitForTimeout(SESSION_DEBOUNCE_WAIT)
    await closeApp(electronApp)

    // The saved session must still be there.
    ;({ electronApp, page } = await launchApp({ userDataDir }))
    try {
      await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 2)
      const tabNames = await page.$$eval('#tab-list .file-tab .file-tab-name', els => els.map(el => el.textContent))
      assert.ok(tabNames.some(name => name.includes('keep-one.md')), `expected keep-one.md, got ${JSON.stringify(tabNames)}`)
      assert.ok(tabNames.some(name => name.includes('keep-two.md')), `expected keep-two.md, got ${JSON.stringify(tabNames)}`)
    } finally {
      await closeApp(electronApp)
    }
  } finally {
    await first.cleanup()
    await second.cleanup()
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})

test('opening and closing a blank second window does not clobber the first window session', async () => {
  const first = await createTempMarkdown(BASIC_MD, 'win-one.md')
  const second = await createTempMarkdown(ROOT_MD, 'win-two.md')
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-session-'))

  try {
    // Establish a good two-tab session on disk.
    let { electronApp, page } = await launchApp({ userDataDir })
    await page.waitForSelector('#empty')
    await openRealFiles(electronApp, page, [first.path, second.path], 2)
    await page.waitForTimeout(SESSION_DEBOUNCE_WAIT)
    await closeApp(electronApp)

    // Relaunch (restores the two tabs), open a blank second window via ⌘N, close it.
    ;({ electronApp, page } = await launchApp({ userDataDir }))
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 2)

    await clickApplicationMenuItem(electronApp, '파일', '새 창')
    await page.waitForFunction(async () => true)
    await electronApp.evaluate(async ({ BrowserWindow }) => {
      await new Promise(resolve => setTimeout(resolve, 100))
    })
    const windowCount = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    assert.equal(windowCount, 2, 'a second window should have opened')

    // Let the blank window push its (empty) state, then close it.
    await page.waitForTimeout(SESSION_DEBOUNCE_WAIT)
    await electronApp.evaluate(async ({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows()
      const blank = wins[wins.length - 1]
      blank.close()
      await new Promise(resolve => setTimeout(resolve, 200))
    })
    await closeApp(electronApp)

    // The first window's session must be intact.
    ;({ electronApp, page } = await launchApp({ userDataDir }))
    try {
      await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 2)
      const tabNames = await page.$$eval('#tab-list .file-tab .file-tab-name', els => els.map(el => el.textContent))
      assert.ok(tabNames.some(name => name.includes('win-one.md')), `expected win-one.md, got ${JSON.stringify(tabNames)}`)
      assert.ok(tabNames.some(name => name.includes('win-two.md')), `expected win-two.md, got ${JSON.stringify(tabNames)}`)
    } finally {
      await closeApp(electronApp)
    }
  } finally {
    await first.cleanup()
    await second.cleanup()
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})

test('opening a file and saving-as both register the path as a recent document', async () => {
  const { path: initial, cleanup } = await createTempMarkdown(BASIC_MD, 'recent-open.md')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubAddRecentDocument(electronApp)

    await stubOpenDialog(electronApp, [initial])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'recent-open')
    await page.waitForTimeout(150)
    let recents = await getRecentDocs(electronApp)
    assert.ok(recents.includes(initial), `open should register ${initial}, got ${JSON.stringify(recents)}`)

    // A save-as that assigns a new path is the second registration site.
    const savedPath = path.join(path.dirname(initial), 'recent-saved.md')
    await stubSaveDialog(electronApp, savedPath)
    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => document.getElementById('source-view').style.display === 'block')
    await page.locator('#source-editor').fill('# Recent Saved\n')
    await clickApplicationMenuItem(electronApp, '파일', '다른 이름으로 저장…')
    await page.waitForFunction(() => document.title === 'recent-saved')
    await page.waitForTimeout(150)
    recents = await getRecentDocs(electronApp)
    assert.ok(recents.includes(savedPath), `save-as should register ${savedPath}, got ${JSON.stringify(recents)}`)
  } finally {
    await closeApp(electronApp)
    await cleanup()
  }
})
