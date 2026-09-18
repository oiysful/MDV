const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { ROOT } = require('./launch')

const BASIC_MD = path.join(ROOT, 'tests/fixtures/basic.md')
const EXPLORER_DIR = path.join(ROOT, 'tests/fixtures/explorer')
const ROOT_MD = path.join(ROOT, 'tests/fixtures/explorer/root.md')

async function stubOpenDialog(electronApp, filePaths) {
  await electronApp.evaluate(({ dialog }, result) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: result.filePaths,
    })
  }, { filePaths })
}

async function stubSaveDialog(electronApp, filePath) {
  await electronApp.evaluate(({ dialog }, result) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: result.filePath,
    })
  }, { filePath })
}

// Replaces shell.openExternal in the main process (same object main.js destructured)
// so a link-click test can assert the URL was handed off without launching a real
// browser. Records every URL in a main-process global the test can read back.
async function stubOpenExternal(electronApp) {
  await electronApp.evaluate(({ shell }) => {
    globalThis.__openExternalCalls = []
    shell.openExternal = async (url) => { globalThis.__openExternalCalls.push(url) }
  })
}

async function getOpenExternalCalls(electronApp) {
  return electronApp.evaluate(() => globalThis.__openExternalCalls ?? [])
}

async function createTempMarkdown(sourcePath, name) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-'))
  const targetPath = path.join(tempDir, name)
  await fs.copyFile(sourcePath, targetPath)
  return {
    path: targetPath,
    cleanup: () => fs.rm(tempDir, { recursive: true, force: true }),
  }
}

async function emitFileOpened(electronApp, payload) {
  await electronApp.evaluate(async ({ BrowserWindow }, nextPayload) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.webContents.send('file-opened', nextPayload)
  }, payload)
}

async function emitUpdateAvailable(electronApp, payload) {
  await electronApp.evaluate(async ({ BrowserWindow }, nextPayload) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.webContents.send('update-available', nextPayload)
  }, payload)
}

// Drives the main→renderer fullscreen channel directly instead of win.setFullScreen(true):
// a real fullscreen toggle moves the window to its own macOS Space and takes ~0.6s of
// animation, which is flaky on CI macOS runners. This sends exactly what main.js's
// enter/leave-full-screen handlers send, so the renderer side stays deterministic.
async function emitFullScreenChanged(electronApp, fullScreen) {
  await electronApp.evaluate(async ({ BrowserWindow }, nextFullScreen) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.webContents.send('fullscreen-changed', nextFullScreen)
  }, fullScreen)
}

async function emitRendererCommand(electronApp, command) {
  await electronApp.evaluate(async ({ BrowserWindow }, nextCommand) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.webContents.send('renderer-command', nextCommand)
  }, command)
}

async function clickApplicationMenuItem(electronApp, menuLabel, itemLabel) {
  await electronApp.evaluate(({ BrowserWindow, Menu }, labels) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.focus()
    const menu = Menu.getApplicationMenu()
    const topLevel = menu.items.find(item => item.label === labels.menuLabel)
    const target = topLevel?.submenu?.items.find(item => item.label === labels.itemLabel)
    if (!target) throw new Error(`Menu item not found: ${labels.menuLabel} > ${labels.itemLabel}`)
    target.click(target, win, {})
  }, { menuLabel, itemLabel })
}

// Entering (and, on restore, leaving) split view force-closes/reopens #sidebar, whose width
// transition (index.html, .25s) keeps reflowing #scroll-area's available width for the whole
// span -- arm a transitionend watch before the toggle and wait for it before reading any
// geometry or touching scroll state, so those assertions aren't racing a still-animating
// sidebar. Used by both split-view-core.test.js and split-view-async.test.js.
async function armSidebarTransitionWatch(page) {
  await page.evaluate(() => {
    window.__mdvSidebarTransitionDone = false
    const sidebar = document.getElementById('sidebar')
    const onEnd = event => {
      if (event.propertyName !== 'width') return
      sidebar.removeEventListener('transitionend', onEnd)
      window.__mdvSidebarTransitionDone = true
    }
    sidebar.addEventListener('transitionend', onEnd)
  })
}

async function waitForSidebarTransition(page) {
  await page.waitForFunction(() => window.__mdvSidebarTransitionDone === true)
}

// #toast (onboarding.js's showToast) removes its own 'show' class 1.6s after it's added, so
// polling classList.contains('show') after some other wait races that timeout: if the other
// wait is slow enough, the toast has already faded before the poll even starts, and the poll
// then waits out its own timeout for a class that will never return again. Arm this before
// the action that triggers the toast and record every appearance instead of polling for one
// live -- mirrors armSidebarTransitionWatch above.
async function armToastWatch(page) {
  await page.evaluate(() => {
    const toast = document.getElementById('toast')
    // Leave __mdvToasts unset when there is nothing to watch, so waitForToast can tell
    // "armed, no toast fired" apart from "armed before #toast existed" -- an empty
    // recording reads like the first and would misdirect whoever hits the second.
    if (!toast) return
    window.__mdvToasts = []
    const record = () => {
      if (toast.classList.contains('show')) window.__mdvToasts.push(toast.textContent)
    }
    record() // catches a toast that's already showing by the time this arms
    window.__mdvToastObserver?.disconnect() // re-arming replaces the watch, never stacks one
    window.__mdvToastObserver = new MutationObserver(record)
    window.__mdvToastObserver.observe(toast, { attributes: true, attributeFilter: ['class'] })
  })
}

// Waits for a recorded toast matching `pattern` (armToastWatch must have been called first).
// The final check is an assert in Node rather than the wait itself, so a failure reports the
// toast text(s) that were actually recorded instead of a bare TimeoutError. `timeout` defaults
// well under Playwright's own 30s: a toast that was going to fire at all does so right after
// the action that triggers it, so a long default would only slow down the real failure case.
async function waitForToast(page, pattern, { timeout = 5000 } = {}) {
  try {
    // Wait for a *matching* toast, not merely the first one: a caller whose action also
    // raises an unrelated toast would otherwise wake on that one and fail before the toast
    // it asked for arrived. A RegExp can't cross the page boundary, so rebuild it there.
    await page.waitForFunction(
      ({ source, flags }) => (window.__mdvToasts || []).some(text => new RegExp(source, flags).test(text)),
      { source: pattern.source, flags: pattern.flags },
      { timeout },
    )
  } catch (error) {
    // Swallow the timeout on purpose: the assert below then fails with the toasts actually
    // recorded rather than a bare TimeoutError that names none of them. Only the timeout,
    // though -- a destroyed execution context or a closed target reaching that assert would
    // be reported as "no toast matched", which is a different and misleading story.
    if (error.name !== 'TimeoutError') throw error
  }
  const toasts = await page.evaluate(() => window.__mdvToasts ?? null)
  assert.ok(toasts, 'armToastWatch was never armed on this page -- call it before the action that raises the toast')
  assert.ok(
    toasts.some(text => pattern.test(text)),
    `no recorded toast matched ${pattern}, got ${JSON.stringify(toasts)}`,
  )
}

module.exports = {
  BASIC_MD,
  EXPLORER_DIR,
  ROOT_MD,
  stubOpenDialog,
  stubSaveDialog,
  stubOpenExternal,
  getOpenExternalCalls,
  createTempMarkdown,
  emitFileOpened,
  emitUpdateAvailable,
  emitFullScreenChanged,
  emitRendererCommand,
  clickApplicationMenuItem,
  armSidebarTransitionWatch,
  waitForSidebarTransition,
  armToastWatch,
  waitForToast,
}
