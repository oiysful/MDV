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
//
// The default-app-status IPC round trip is real (spawns temp files, queries the OS) and
// unawaited by the renderer's own init, so a test that doesn't care about the first-launch
// guide can still race it under load. launchApp skips that real check by default (see
// MDV_TEST_SKIP_DEFAULT_APP_CHECK in main.js) so ordinary tests get a deterministic
// "already registered" response instead of an environment/timing-dependent one. A test that
// specifically exercises the guide's real behavior passes `{ realDefaultAppStatus: true }`.
//
// Same reasoning for MDV_TEST_SKIP_UPDATE_CHECK: without it, every launchApp() call would
// fire a real GitHub Releases request from main.js after its 5s startup delay. A test that
// exercises the real check passes `{ realUpdateCheck: true }` and should point
// MDV_REPO_OWNER/MDV_REPO_NAME (also read by main.js) at a repo/tag it controls rather than
// hitting the real oiysful/MDV repo.
// Logs what a stalled Playwright action needs to be diagnosed: page visibility/focus, whether
// rAF is ticking (Playwright's click "stable" check waits on it), and the tab/split state.
// The synchronous part is read first so it survives a renderer whose rAF never fires.
async function dumpDiagnostics(page) {
  try {
    const snapshot = await page.evaluate(() => ({
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus(),
      title: document.title,
      splitMode: document.getElementById('scroll-area')?.classList.contains('split-mode'),
      tabs: [...document.querySelectorAll('#tab-list .file-tab')].map(tab => {
        const rect = tab.getBoundingClientRect()
        return { text: tab.textContent.trim(), cls: tab.className, selected: tab.getAttribute('aria-selected'), x: rect.x, w: rect.width }
      }),
    }))
    const ticks = await Promise.race([
      page.evaluate(() => new Promise(resolve => {
        let n = 0
        const end = performance.now() + 500
        const tick = () => { n += 1; if (performance.now() < end) requestAnimationFrame(tick); else resolve(n) }
        requestAnimationFrame(tick)
      })),
      new Promise(resolve => setTimeout(() => resolve('no rAF within 3s'), 3000)),
    ])
    console.error('[mdv-diagnostics]', JSON.stringify({ ...snapshot, rafTicksIn500ms: ticks }))
  } catch (e) {
    console.error('[mdv-diagnostics] unavailable:', e.message)
  }
}

// Every Locator.click that times out dumps diagnostics before rethrowing, so a CI-only stall
// leaves its renderer state in the log. Patched once, on the first page's Locator class.
function instrumentLocatorClick(page) {
  const proto = Object.getPrototypeOf(page.locator('body'))
  if (proto.__mdvInstrumented) return
  const click = proto.click
  proto.click = async function instrumentedClick(...args) {
    try {
      return await click.apply(this, args)
    } catch (e) {
      if (e?.name === 'TimeoutError') await dumpDiagnostics(this.page())
      throw e
    }
  }
  proto.__mdvInstrumented = true
}

async function launchApp(options = {}) {
  const ownsUserDataDir = !options.userDataDir
  const userDataDir = options.userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'mdv-userdata-'))

  const electronApp = await electron.launch({
    executablePath: electronBinary,
    args: ['.'],
    cwd: ROOT,
    env: {
      ...process.env,
      MDV_USER_DATA_DIR: userDataDir,
      ...(options.realDefaultAppStatus ? {} : { MDV_TEST_SKIP_DEFAULT_APP_CHECK: '1' }),
      ...(options.realUpdateCheck ? {} : { MDV_TEST_SKIP_UPDATE_CHECK: '1' }),
    },
  })
  electronApp.__userDataDir = userDataDir
  electronApp.__ownsUserDataDir = ownsUserDataDir

  const page = await electronApp.firstWindow()
  page.setDefaultTimeout(15000)
  instrumentLocatorClick(page)
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
  dumpDiagnostics,
  stubCloseDialog,
  getCloseDialogCalls,
}
