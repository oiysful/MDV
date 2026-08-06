const test = require('node:test')
const assert = require('node:assert/strict')

const { launchApp, closeApp, stubCloseDialog, getCloseDialogCalls } = require('./helpers/launch')
const {
  BASIC_MD, ROOT_MD, EXPLORER_DIR,
  stubOpenDialog, stubSaveDialog, createTempMarkdown,
  emitFileOpened, emitRendererCommand, clickApplicationMenuItem,
  stubOpenExternal, getOpenExternalCalls,
} = require('./helpers/smoke-helpers')

test('file-opened event from the main process opens a document tab', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await emitFileOpened(electronApp, {
      content: '# Opened From Main\n\nSent through file-opened.\n',
      filename: 'opened-from-main.md',
      path: '/tmp/opened-from-main.md',
    })

    await page.waitForFunction(() => document.title === 'opened-from-main')
    assert.match(await page.textContent('#tab-list .file-tab.active .file-tab-name'), /opened-from-main\.md/)
    assert.match(await page.textContent('#content'), /Sent through file-opened\./)
  } finally {
    await closeApp(electronApp)
  }
})

test('opening the same file twice reuses the existing tab', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])

    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 1)

    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => {
      const tabs = document.querySelectorAll('#tab-list .file-tab')
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return tabs.length === 1 && active && active.textContent.includes('basic.md')
    })

    assert.equal(await page.locator('#tab-list .file-tab').count(), 1)
    assert.match(await page.textContent('#tab-list .file-tab.active .file-tab-name'), /basic\.md/)
  } finally {
    await closeApp(electronApp)
  }
})

test('add menu creates new untitled files and keeps ⌘T menu behavior', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')

    await page.click('#btn-add')
    await page.click('#add-menu [data-command="newFile"]')
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      const menu = document.getElementById('add-menu')
      return document.title === 'untitled' && active && active.textContent.includes('untitled.md') && menu.style.display === 'none'
    })

    // ⌘T is now owned by the native menu accelerator (src/main.js#buildMenu),
    // not a renderer keydown listener -- exercise it the same way the OS would.
    await clickApplicationMenuItem(electronApp, '파일', '새 파일')
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return document.querySelectorAll('#tab-list .file-tab').length === 2 && active && active.textContent.includes('untitled-2.md')
    })

    const addBeforeSidebar = await page.evaluate(() => {
      const add = document.getElementById('btn-add')
      const sidebar = document.getElementById('btn-sidebar')
      return Boolean(add && sidebar && (add.compareDocumentPosition(sidebar) & Node.DOCUMENT_POSITION_FOLLOWING))
    })
    assert.equal(addBeforeSidebar, true)
  } finally {
    await closeApp(electronApp)
  }
})

test('closing tabs selects the next tab and restores empty state when the last tab closes', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD, ROOT_MD])
    await emitRendererCommand(electronApp, 'openFile')

    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 2)

    await page.locator('#tab-list .file-tab').first().click()
    await page.waitForFunction(() => document.title === 'basic')

    await page.locator('#tab-list .file-tab.active .file-tab-close').click()
    await page.waitForFunction(() => {
      const tabs = document.querySelectorAll('#tab-list .file-tab')
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return document.title === 'root' && tabs.length === 1 && active && active.textContent.includes('root.md')
    })

    await page.locator('#tab-list .file-tab.active .file-tab-close').click()
    await page.waitForSelector('#empty')

    assert.equal(await page.locator('#tab-list .file-tab').count(), 0)
    assert.equal(await page.title(), 'MDV')
  } finally {
    await closeApp(electronApp)
  }
})
