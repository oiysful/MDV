const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const { launchApp, closeApp } = require('./helpers/launch')
const {
  BASIC_MD, EXPLORER_DIR,
  stubOpenDialog, stubSaveDialog, waitForDialogDefaultPath, createTempMarkdown,
  emitFileOpened, emitRendererCommand, clickApplicationMenuItem,
} = require('./helpers/smoke-helpers')

// Electron 43+ opens dialogs in Downloads instead of the last used folder, so main.js passes
// defaultPath itself. These tests read the options it handed to the (stubbed) dialogs.
// Each assertion waits for the one dialog its own trigger raised (waitForDialogDefaultPath),
// never for UI state an earlier step already satisfied.

// Opens a document WITHOUT going through a dialog, so the remembered folder stays untouched
// and a save-as that lands next to the document can only have come from the docPath argument.
async function openWithoutDialog(electronApp, page, docPath, title) {
  await emitFileOpened(electronApp, { content: await fs.readFile(docPath, 'utf8'), filename: path.basename(docPath), path: docPath })
  await page.waitForFunction(expected => document.title === expected, title)
}

test('open dialogs start in Documents first, then in the folder of the last selection', async () => {
  const first = await createTempMarkdown(BASIC_MD, 'dialog-dir-first.md')
  const second = await createTempMarkdown(BASIC_MD, 'dialog-dir-second.md')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    const documents = await electronApp.evaluate(({ app }) => app.getPath('documents'))

    await stubOpenDialog(electronApp, [first.path])
    assert.equal(
      await waitForDialogDefaultPath(electronApp, 'open', () => emitRendererCommand(electronApp, 'openFile')),
      documents, 'nothing remembered yet -> Documents')
    await page.waitForFunction(() => document.title === 'dialog-dir-first')

    await stubOpenDialog(electronApp, [second.path])
    assert.equal(
      await waitForDialogDefaultPath(electronApp, 'open', () => emitRendererCommand(electronApp, 'openFile')),
      path.dirname(first.path), 'file picker remembers the folder of the last selection')
    await page.waitForFunction(() => document.title === 'dialog-dir-second')

    // The folder picker shares the remembered directory and records the picked folder itself.
    await stubOpenDialog(electronApp, [EXPLORER_DIR])
    assert.equal(
      await waitForDialogDefaultPath(electronApp, 'open', () => emitRendererCommand(electronApp, 'openFolder')),
      path.dirname(second.path), 'folder picker starts in the remembered folder')
    await page.waitForFunction(() => document.getElementById('explorer-tree')?.children.length > 0)

    await stubOpenDialog(electronApp, [first.path])
    assert.equal(
      await waitForDialogDefaultPath(electronApp, 'open', () => emitRendererCommand(electronApp, 'openFile')),
      EXPLORER_DIR, 'the picked folder itself is remembered')
  } finally {
    await closeApp(electronApp)
    await first.cleanup()
    await second.cleanup()
  }
})

test('save-as opens next to the document even when another folder is remembered; untitled tabs use the remembered one', async () => {
  const { path: tempMarkdown, cleanup } = await createTempMarkdown(BASIC_MD, 'dialog-dir-save.md')
  const otherDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-dialog-'))
  const savedPath = path.join(otherDir, 'saved-elsewhere.md')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await openWithoutDialog(electronApp, page, tempMarkdown, 'dialog-dir-save')
    // Remember a folder that is NOT the document's, so the fallback cannot satisfy the assertion.
    await stubOpenDialog(electronApp, [EXPLORER_DIR])
    await waitForDialogDefaultPath(electronApp, 'open', () => emitRendererCommand(electronApp, 'openFolder'))
    await page.waitForFunction(() => document.getElementById('explorer-tree')?.children.length > 0)

    await stubSaveDialog(electronApp, savedPath)
    assert.equal(
      await waitForDialogDefaultPath(electronApp, 'save', () => clickApplicationMenuItem(electronApp, '파일', '다른 이름으로 저장…')),
      path.join(path.dirname(tempMarkdown), 'dialog-dir-save.md'),
      'save-as starts in the document folder, not the remembered one')
    await page.waitForFunction(() => document.title === 'saved-elsewhere')

    // The save just made moved the remembered folder; an untitled tab (no path) starts there.
    assert.equal(
      await waitForDialogDefaultPath(electronApp, 'save', async () => {
        await clickApplicationMenuItem(electronApp, '파일', '새 파일')
        await clickApplicationMenuItem(electronApp, '파일', '다른 이름으로 저장…')
      }),
      path.join(otherDir, 'untitled.md'), 'untitled save-as starts in the remembered folder')
  } finally {
    await closeApp(electronApp)
    await cleanup()
    await fs.rm(otherDir, { recursive: true, force: true })
  }
})

test('PDF export opens next to the document even when another folder is remembered', async () => {
  const { path: tempMarkdown, cleanup } = await createTempMarkdown(BASIC_MD, 'dialog-dir-pdf.md')
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-dialog-'))
  const pdfPath = path.join(outDir, 'out.pdf')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await openWithoutDialog(electronApp, page, tempMarkdown, 'dialog-dir-pdf')
    await stubOpenDialog(electronApp, [EXPLORER_DIR])
    await waitForDialogDefaultPath(electronApp, 'open', () => emitRendererCommand(electronApp, 'openFolder'))
    await page.waitForFunction(() => document.getElementById('explorer-tree')?.children.length > 0)

    await stubSaveDialog(electronApp, pdfPath)
    assert.equal(
      await waitForDialogDefaultPath(electronApp, 'save', () => emitRendererCommand(electronApp, 'exportPdf')),
      path.join(path.dirname(tempMarkdown), 'dialog-dir-pdf.pdf'),
      'PDF export starts in the document folder with the .pdf name')
    // Let the export finish writing before teardown removes the folder.
    const deadline = Date.now() + 15000
    while (Date.now() < deadline && !(await fs.stat(pdfPath).catch(() => null))) {
      await page.waitForTimeout(50)
    }
  } finally {
    await closeApp(electronApp)
    await cleanup()
    await fs.rm(outDir, { recursive: true, force: true })
  }
})
