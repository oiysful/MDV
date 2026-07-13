const path = require('node:path')
const { _electron: electron } = require('playwright')

const electronBinary = require('electron')

const ROOT = path.resolve(__dirname, '../../..')

async function launchApp() {
  const electronApp = await electron.launch({
    executablePath: electronBinary,
    args: ['.'],
    cwd: ROOT,
  })

  const page = await electronApp.firstWindow()
  page.setDefaultTimeout(15000)
  await page.waitForFunction(() => {
    return Boolean(window.api && document.documentElement.dataset.rendererReady === 'true')
  })

  return { electronApp, page }
}

// Answers the unsaved-changes dialog that main.js raises on window close.
// `dialog.showMessageBoxSync` blocks the main process until a human clicks, so a
// test that leaves a tab dirty would hang at teardown. Stub it in the main process
// instead of teaching production code about tests. 0 = 닫기, 1 = 취소.
async function stubCloseDialog(electronApp, choice = 0) {
  await electronApp.evaluate(({ dialog }, answer) => {
    globalThis.__closeDialogCalls = []
    dialog.showMessageBoxSync = (_win, options) => {
      globalThis.__closeDialogCalls.push(options)
      return answer
    }
  }, choice)
}

// What the stubbed dialog was asked, so a test can assert the guard actually fired.
async function getCloseDialogCalls(electronApp) {
  return electronApp.evaluate(() => globalThis.__closeDialogCalls ?? [])
}

// Always use this instead of electronApp.close() — a dirty tab otherwise blocks
// teardown on a native dialog.
async function closeApp(electronApp) {
  await stubCloseDialog(electronApp, 0)
  await electronApp.close()
}

module.exports = {
  ROOT,
  launchApp,
  closeApp,
  stubCloseDialog,
  getCloseDialogCalls,
}
