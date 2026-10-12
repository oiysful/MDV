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
// Logs what a stalled Playwright wait needs to be diagnosed. Each probe has its own deadline
// and always prints, so the line tells apart "frames stopped" (renderer answers, rAF dead,
// renderer CPU near 0), "renderer busy" (renderer does not answer, renderer CPU high) and a
// crash. The main-process probe goes through electronApp, which stays responsive either way.
const electronAppByPage = new WeakMap()

function withDeadline(promise, ms) {
  let timer
  const deadline = new Promise(resolve => { timer = setTimeout(() => resolve(`no answer within ${ms}ms`), ms) })
  return Promise.race([promise, deadline])
    .catch(e => `error: ${e.message}`)
    .finally(() => clearTimeout(timer))
}

async function dumpDiagnostics(page) {
  const electronApp = electronAppByPage.get(page)
  const [renderer, raf, main] = await Promise.all([
    withDeadline(page.evaluate(() => ({
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus(),
      title: document.title,
      splitMode: document.getElementById('scroll-area')?.classList.contains('split-mode'),
      tabs: [...document.querySelectorAll('#tab-list .file-tab')].map(tab => {
        const rect = tab.getBoundingClientRect()
        return { text: tab.textContent.trim(), cls: tab.className, selected: tab.getAttribute('aria-selected'), x: rect.x, w: rect.width }
      }),
    })), 2000),
    withDeadline(page.evaluate(() => new Promise(resolve => {
      let n = 0
      const end = performance.now() + 500
      const tick = () => { n += 1; if (performance.now() < end) requestAnimationFrame(tick); else resolve(n) }
      requestAnimationFrame(tick)
    })), 2000),
    electronApp
      ? withDeadline(electronApp.evaluate(({ app, BrowserWindow }) => ({
        windows: BrowserWindow.getAllWindows().map(win => ({
          visible: win.isVisible(),
          focused: win.isFocused(),
          minimized: win.isMinimized(),
          crashed: win.webContents.isCrashed(),
          backgroundThrottling: win.webContents.getBackgroundThrottling(),
          rendererPid: win.webContents.getOSProcessId(),
        })),
        metrics: app.getAppMetrics().map(m => ({
          pid: m.pid,
          type: m.type,
          cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10,
          idleWakeups: m.cpu.idleWakeupsPerSecond,
        })),
      })), 2000)
      : 'no electronApp registered for this page',
  ])
  console.error('[mdv-diagnostics]', JSON.stringify({ renderer, rafTicksIn500ms: raf, main }))
}

// Every Locator.click and Page.waitForFunction that times out dumps diagnostics before
// rethrowing, so a CI-only stall leaves its state in the log. Patched once per prototype.
function instrumentTimeouts(page) {
  const wrap = (proto, name, pageOf) => {
    const flag = `__mdvInstrumented_${name}`
    if (proto[flag]) return
    const original = proto[name]
    proto[name] = async function instrumented(...args) {
      try {
        return await original.apply(this, args)
      } catch (e) {
        if (e?.name === 'TimeoutError') await dumpDiagnostics(pageOf(this))
        throw e
      }
    }
    proto[flag] = true
  }
  wrap(Object.getPrototypeOf(page.locator('body')), 'click', locator => locator.page())
  wrap(Object.getPrototypeOf(page), 'waitForFunction', p => p)
}

// Extra Chromium/Electron switches for every launch, space-separated (plan 28: the CI-only
// Electron 44 stall experiment passes `--disable-gpu` here). Test plumbing only -- src/ is
// untouched, so the shipped app never sees these.
const extraArgs = (process.env.MDV_ELECTRON_EXTRA_ARGS || '').split(/\s+/).filter(Boolean)
let gpuStatusLogged = false

async function launchApp(options = {}) {
  const ownsUserDataDir = !options.userDataDir
  const userDataDir = options.userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'mdv-userdata-'))

  const electronApp = await electron.launch({
    executablePath: electronBinary,
    args: [...extraArgs, '.'],
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
  electronAppByPage.set(page, electronApp)
  instrumentTimeouts(page)
  await page.waitForFunction(() => {
    return Boolean(window.api && document.documentElement.dataset.rendererReady === 'true')
  })

  // Proves the switches actually took effect on this machine, once per test file: a run that
  // claims `--disable-gpu` but still reports hardware compositing is invalid, not "no effect".
  if (extraArgs.length && !gpuStatusLogged) {
    gpuStatusLogged = true
    const status = await electronApp.evaluate(({ app }) => app.getGPUFeatureStatus())
    console.error('[mdv-gpu-status]', JSON.stringify({ extraArgs, status }))
  }

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
