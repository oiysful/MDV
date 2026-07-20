const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { _electron: electron } = require('playwright')

const electronBinary = require('electron')

const ROOT = path.resolve(__dirname, '../../..')

// Every launch gets an isolated userData dir (via MDV_USER_DATA_DIR, which main.js honours)
// so the suite never reads stale state from — or writes session.json into — the real user's
// profile. Pass an explicit `userDataDir` to share one across a quit+relaunch session test;
// launchApp then leaves cleanup to the caller (closeApp only removes dirs it created).
async function launchApp(options = {}) {
  const ownsUserDataDir = !options.userDataDir
  const userDataDir = options.userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'mdv-userdata-'))

  const electronApp = await electron.launch({
    executablePath: electronBinary,
    args: ['.'],
    cwd: ROOT,
    env: { ...process.env, MDV_USER_DATA_DIR: userDataDir },
  })
  electronApp.__userDataDir = userDataDir
  electronApp.__ownsUserDataDir = ownsUserDataDir

  const page = await electronApp.firstWindow()
  page.setDefaultTimeout(15000)
  await page.waitForFunction(() => {
    return Boolean(window.api && document.documentElement.dataset.rendererReady === 'true')
  })

  return { electronApp, page, userDataDir }
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
  // Only remove a userData dir this helper created — a caller-owned dir is being reused
  // across a relaunch and must survive until that test tears it down itself.
  if (electronApp.__ownsUserDataDir && electronApp.__userDataDir) {
    fs.rmSync(electronApp.__userDataDir, { recursive: true, force: true })
  }
}

module.exports = {
  ROOT,
  launchApp,
  closeApp,
  stubCloseDialog,
  getCloseDialogCalls,
}
