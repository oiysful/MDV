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
  emitRendererCommand,
  clickApplicationMenuItem,
}
