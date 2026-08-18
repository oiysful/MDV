const fs = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const { launchApp, closeApp } = require('./helpers/launch')
const { emitUpdateAvailable, stubOpenExternal, getOpenExternalCalls } = require('./helpers/smoke-helpers')

// launchApp() sets MDV_TEST_SKIP_UPDATE_CHECK by default (see helpers/launch.js), so the
// real 5s-delayed GitHub Releases check never fires during these tests -- everything here
// exercises the renderer's reaction to a synthetic `update-available` push instead.
const INFO = { version: '9.9.9', tagName: 'v9.9.9', releaseUrl: 'https://github.com/oiysful/MDV/releases/tag/v9.9.9' }

test('update banner is hidden by default and shows once update-available fires', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    assert.equal(await page.locator('#update-banner').evaluate(el => el.classList.contains('show')), false)

    await emitUpdateAvailable(electronApp, INFO)
    await page.waitForFunction(() => document.getElementById('update-banner')?.classList.contains('show'))

    const text = await page.locator('#update-banner-text').textContent()
    assert.match(text, /9\.9\.9/)
  } finally {
    await closeApp(electronApp)
  }
})

test('dismissing the banner hides it and persists the dismissed version to disk', async () => {
  const { electronApp, page, userDataDir } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await emitUpdateAvailable(electronApp, INFO)
    await page.waitForFunction(() => document.getElementById('update-banner')?.classList.contains('show'))

    await page.locator('#update-banner .guide-close').click()
    await page.waitForFunction(() => !document.getElementById('update-banner')?.classList.contains('show'))

    // dismiss-update-notice (ipcMain.on, fire-and-forget) has no response to await on the
    // renderer side, so poll the state file main.js actually wrote instead of a fixed sleep.
    const statePath = path.join(userDataDir, 'update-check.json')
    await assert.doesNotReject(async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          const state = JSON.parse(await fs.readFile(statePath, 'utf-8'))
          if (state.dismissedVersion === '9.9.9') return
        } catch {
          // file not written yet
        }
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error('update-check.json never recorded the dismissed version')
    })
  } finally {
    await closeApp(electronApp)
  }
})

test('the release-notes link hands the exact release URL to the OS browser', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenExternal(electronApp)
    await emitUpdateAvailable(electronApp, INFO)
    await page.waitForFunction(() => document.getElementById('update-banner')?.classList.contains('show'))

    await page.locator('#update-banner [data-command="openUpdateReleaseNotes"]').click()

    assert.deepEqual(await getOpenExternalCalls(electronApp), [INFO.releaseUrl])
  } finally {
    await closeApp(electronApp)
  }
})

test('a null update-available payload hides the banner (the shape dismiss-update-notice broadcasts)', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await emitUpdateAvailable(electronApp, INFO)
    await page.waitForFunction(() => document.getElementById('update-banner')?.classList.contains('show'))

    // A null payload (what dismiss-update-notice's broadcast sends) hides it.
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('update-available', null)
    })
    await page.waitForFunction(() => !document.getElementById('update-banner')?.classList.contains('show'))
  } finally {
    await closeApp(electronApp)
  }
})

test('the banner is hidden under print media, so it never lands in a printed page or PDF export', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await emitUpdateAvailable(electronApp, INFO)
    await page.waitForFunction(() => document.getElementById('update-banner')?.classList.contains('show'))

    await page.emulateMedia({ media: 'print' })
    assert.equal(
      await page.locator('#update-banner').evaluate(el => getComputedStyle(el).display),
      'none'
    )
  } finally {
    await closeApp(electronApp)
  }
})
