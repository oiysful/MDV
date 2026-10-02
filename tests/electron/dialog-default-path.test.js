const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const { launchApp, closeApp } = require('./helpers/launch')
const {
  BASIC_MD, EXPLORER_DIR,
  stubOpenDialog, stubSaveDialog, getDialogCalls, createTempMarkdown,
  emitRendererCommand, clickApplicationMenuItem,
} = require('./helpers/smoke-helpers')

// Electron 43+ opens dialogs in Downloads instead of the last used folder, so main.js passes
// defaultPath itself. These tests read the options it handed to the (stubbed) dialogs.
const lastCall = async (electronApp, kind) =>
  (await getDialogCalls(electronApp)).filter(call => call.kind === kind).at(-1).options.defaultPath

test('open dialogs start in Documents first, then in the folder of the last selection', async () => {
  const { path: tempMarkdown, cleanup } = await createTempMarkdown(BASIC_MD, 'dialog-dir-source.md')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    const documents = await electronApp.evaluate(({ app }) => app.getPath('documents'))

    await stubOpenDialog(electronApp, [tempMarkdown])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'dialog-dir-source')
    assert.equal(await lastCall(electronApp, 'open'), documents, 'nothing remembered yet -> Documents')

    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'dialog-dir-source')
    assert.equal(await lastCall(electronApp, 'open'), path.dirname(tempMarkdown), 'file picker remembers the file folder')

    // The folder picker shares the remembered directory and records the picked folder itself.
    await stubOpenDialog(electronApp, [EXPLORER_DIR])
    await emitRendererCommand(electronApp, 'openFolder')
    await page.waitForFunction(() => document.getElementById('explorer-tree')?.children.length > 0)
    assert.equal(await lastCall(electronApp, 'open'), path.dirname(tempMarkdown), 'folder picker reads the same remembered dir')

    await stubOpenDialog(electronApp, [tempMarkdown])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'dialog-dir-source')
    assert.equal(await lastCall(electronApp, 'open'), EXPLORER_DIR, 'the picked folder is remembered as is')
  } finally {
    await closeApp(electronApp)
    await cleanup()
  }
})

test('save dialogs open next to the document, and untitled tabs use the remembered folder', async () => {
  const { path: tempMarkdown, cleanup } = await createTempMarkdown(BASIC_MD, 'dialog-dir-save.md')
  const tempDir = path.dirname(tempMarkdown)
  const otherDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-dialog-'))
  const savedPath = path.join(otherDir, 'saved-elsewhere.md')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [tempMarkdown])
    await stubSaveDialog(electronApp, savedPath)
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'dialog-dir-save')

    await clickApplicationMenuItem(electronApp, '파일', '다른 이름으로 저장…')
    await page.waitForFunction(() => document.title === 'saved-elsewhere')
    assert.equal(await lastCall(electronApp, 'save'), path.join(tempDir, 'dialog-dir-save.md'),
      'save-as starts in the document folder with its file name')

    // The save just made moved the remembered folder; an untitled tab (no path) starts there.
    await clickApplicationMenuItem(electronApp, '파일', '새 파일')
    await clickApplicationMenuItem(electronApp, '파일', '다른 이름으로 저장…')
    while ((await getDialogCalls(electronApp)).filter(call => call.kind === 'save').length < 2) {
      await page.waitForTimeout(50)
    }
    assert.equal(await lastCall(electronApp, 'save'), path.join(otherDir, 'untitled.md'),
      'untitled save-as starts in the remembered folder')
  } finally {
    await closeApp(electronApp)
    await cleanup()
    await fs.rm(otherDir, { recursive: true, force: true })
  }
})
