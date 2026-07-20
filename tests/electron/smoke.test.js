const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { ROOT, launchApp, closeApp, stubCloseDialog, getCloseDialogCalls } = require('./helpers/launch')

const BASIC_MD = path.join(ROOT, 'tests/fixtures/basic.md')
const EXPLORER_DIR = path.join(ROOT, 'tests/fixtures/explorer')
const ROOT_MD = path.join(ROOT, 'tests/fixtures/explorer/root.md')

const REMOVED_GLOBALS = [
  'openFile',
  'openFolder',
  'saveFile',
  'saveFileAs',
  'toggleSidebar',
  'toggleSource',
  'toggleSplitView',
  'toggleSearch',
  'copyAll',
  'printDoc',
  'exportPdf',
  'toggleTheme',
  'newFile',
  'toggleAddMenu',
  'hideAddMenu',
  'dismissWelcomeGuide',
  'dismissDefaultAppGuide',
  'openFromGuide',
  'searchPrev',
  'searchNext',
  'closeSearch',
  'closeCurrentTab',
  'switchToNextTab',
  'switchToPrevTab',
  'showShortcuts',
  'hideShortcuts',
  'switchTab',
  'toggleExplorerPathInfo',
  'clearExplorerRoot',
  'goTop',
  'copyCode',
  'onDragOver',
  'onDragLeave',
  'onDrop',
]

async function stubOpenDialog(electronApp, filePaths) {
  await electronApp.evaluate(({ dialog }, result) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: result.filePaths,
    })
  }, { filePaths })
}

// Overrides the real (OS-dependent) default-app-status IPC handler with a fixed, delayed
// response, so a test can focus something before the guide claims focus during page load.
async function stubDefaultAppStatusDelay(electronApp, delayMs) {
  await electronApp.evaluate(async ({ ipcMain }, ms) => {
    ipcMain.removeHandler('get-markdown-default-app-status')
    ipcMain.handle('get-markdown-default-app-status', async () => {
      await new Promise(resolve => setTimeout(resolve, ms))
      return JSON.stringify({ ok: true, registered: false, needsAction: true, appPath: '/Applications/MDV.app', defaultHandlers: [] })
    })
  }, delayMs)
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

async function waitForFile(filePath, timeoutMs = 5000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const stat = await fs.stat(filePath)
      if (stat.size > 0) return stat
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for file: ${filePath}`)
}

async function emitFileChanged(electronApp, payload) {
  await electronApp.evaluate(async ({ BrowserWindow }, nextPayload) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.webContents.send('file-changed', nextPayload)
  }, payload)
}

async function emitFileOpened(electronApp, payload) {
  await electronApp.evaluate(async ({ BrowserWindow }, nextPayload) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.webContents.send('file-opened', JSON.stringify(nextPayload))
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

test('app boots into empty state without renderer command globals', async () => {
  const { electronApp, page } = await launchApp()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(String(error)))

  try {
    await page.waitForSelector('#empty')
    assert.equal(await page.title(), 'MDV')

    const emptyTitle = await page.textContent('#empty .empty-title')
    assert.match(emptyTitle, /열린 파일 없음/)
    assert.match(await page.textContent('#empty .empty-sub'), /좌측 상단의 열기 버튼/)

    const globals = await page.evaluate(names => {
      return Object.fromEntries(names.map(name => {
        return [name, typeof window[name] === 'function']
      }))
    }, REMOVED_GLOBALS)

    for (const name of REMOVED_GLOBALS) {
      assert.equal(globals[name], false, `${name} should not be exposed on window`)
    }

    assert.equal(await page.locator('[onclick], [ondragover], [ondragleave], [ondrop], [data-action]').count(), 0)

    const labelledControls = await page.evaluate(() => {
      const selectors = ['#btn-add', '#btn-sidebar', '#btn-split', '#btn-search', '#btn-copy-all', '#btn-print', '#btn-export-pdf', '#btn-theme', '#go-top']
      return Object.fromEntries(selectors.map(selector => {
        const el = document.querySelector(selector)
        return [selector, Boolean(el?.getAttribute('title') && el?.getAttribute('aria-label'))]
      }))
    })
    assert.deepEqual(labelledControls, {
      '#btn-add': true,
      '#btn-sidebar': true,
      '#btn-split': true,
      '#btn-search': true,
      '#btn-copy-all': true,
      '#btn-print': true,
      '#btn-export-pdf': true,
      '#btn-theme': true,
      '#go-top': true,
    })

    assert.equal(await page.locator('#btn-split').evaluate(button => getComputedStyle(button).display), 'none')

    const depsReady = await page.evaluate(() => ({
      marked: Boolean(window.marked),
      hljs: Boolean(window.hljs),
    }))

    assert.equal(depsReady.marked, true)
    assert.equal(depsReady.hljs, true)
    await page.waitForFunction(() => document.getElementById('default-app-guide')?.classList.contains('show'))
    await page.evaluate(() => {
      localStorage.setItem('mdv-default-app-guide-dismissed', '1')
      localStorage.setItem('mdv-default-app-guide-dismissed-v2', '1')
    })
    await page.reload()
    await page.waitForFunction(() => document.documentElement.dataset.rendererReady === 'true')
    await page.waitForFunction(() => document.getElementById('default-app-guide')?.classList.contains('show'))
    await page.evaluate(() => {
      localStorage.removeItem('mdv-default-app-guide-dismissed-v2')
    })
    await page.reload()
    await page.waitForFunction(() => document.documentElement.dataset.rendererReady === 'true')
    await page.waitForFunction(() => document.getElementById('default-app-guide')?.classList.contains('show'))
    const defaultAppGuide = await page.evaluate(() => ({
      title: document.querySelector('#default-app-guide .guide-title strong')?.textContent || '',
      body: document.querySelector('#default-app-guide .guide-body')?.textContent.replace(/\s+/g, ' ').trim() || '',
      checkboxLabel: document.querySelector('#default-app-guide .guide-check')?.textContent.trim() || '',
      confirmCommand: document.querySelector('#default-app-guide .guide-actions button')?.textContent.trim() || '',
      codeTexts: Array.from(document.querySelectorAll('#default-app-guide .guide-body code')).map(code => code.textContent.trim()),
      actionCount: document.querySelectorAll('#default-app-guide .guide-actions button').length,
      closeButtonCount: document.querySelectorAll('#default-app-guide .guide-close').length,
      checkboxRightAligned: (() => {
        const guide = document.getElementById('default-app-guide')
        const check = document.querySelector('#default-app-guide .guide-check')
        if (!guide || !check) return false
        const guideRect = guide.getBoundingClientRect()
        const checkRect = check.getBoundingClientRect()
        return Math.abs(guideRect.right - 20 - checkRect.right) < 2
      })(),
      confirmFullWidth: (() => {
        const actions = document.querySelector('#default-app-guide .guide-actions')
        const button = document.querySelector('#default-app-guide .guide-actions button')
        if (!actions || !button) return false
        return Math.abs(actions.getBoundingClientRect().width - button.getBoundingClientRect().width) < 2
      })(),
      centered: (() => {
        const rect = document.getElementById('default-app-guide').getBoundingClientRect()
        return Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2) < 2 && Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2) < 2
      })(),
    }))
    assert.equal(defaultAppGuide.title, 'Markdown 기본 앱 등록')
    assert.match(defaultAppGuide.body, /마크다운 문서\(\.md, \.markdown 확장자\)를 편리하게 보기 위해서 아래의 단계를 진행해주세요\./)
    assert.match(defaultAppGuide.body, /Finder에서 마크다운 문서\(\.md, \.markdown\) 우클릭/)
    assert.match(defaultAppGuide.body, /정보 가져오기/)
    assert.match(defaultAppGuide.body, /다음으로 열기 드롭다운 > MDV 선택/)
    assert.match(defaultAppGuide.body, /모두 변경\.\.\. 버튼 클릭/)
    assert.equal(defaultAppGuide.checkboxLabel, '다시 보지 않기')
    assert.equal(defaultAppGuide.confirmCommand, '확인했습니다.')
    assert.deepEqual(defaultAppGuide.codeTexts, ['.md', '.markdown', '.md', '.markdown', '모두 변경...'])
    assert.equal(defaultAppGuide.actionCount, 1)
    assert.equal(defaultAppGuide.closeButtonCount, 0)
    assert.equal(defaultAppGuide.checkboxRightAligned, true)
    assert.equal(defaultAppGuide.confirmFullWidth, true)
    assert.equal(defaultAppGuide.centered, true)

    await page.check('#default-app-do-not-show')
    await page.click('#default-app-guide .guide-actions button')
    await page.waitForFunction(() => !document.getElementById('default-app-guide')?.classList.contains('show'))
    const storedDismissal = await page.evaluate(() => JSON.parse(localStorage.getItem('mdv-default-app-guide-dismissed-v2')))
    assert.equal(typeof storedDismissal.signature, 'string')
    assert.match(storedDismissal.signature, /::/)
    await page.reload()
    await page.waitForFunction(() => document.documentElement.dataset.rendererReady === 'true')
    await page.waitForTimeout(400)
    assert.equal(await page.locator('#default-app-guide').evaluate(guide => guide.classList.contains('show')), false)

    await page.evaluate(() => {
      localStorage.setItem('mdv-default-app-guide-dismissed-v2', JSON.stringify({ signature: '/Applications/Old-MDV.app::.md:/Applications/TextEdit.app|.markdown:/Applications/TextEdit.app' }))
    })
    await page.reload()
    await page.waitForFunction(() => document.documentElement.dataset.rendererReady === 'true')
    await page.waitForFunction(() => document.getElementById('default-app-guide')?.classList.contains('show'))
    assert.deepEqual(pageErrors, [])
  } finally {
    await closeApp(electronApp)
  }
})

test('openFile loads markdown, updates title, and renders code highlighting', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await clickApplicationMenuItem(electronApp, '파일', '파일 열기…')

    await page.waitForFunction(() => document.title === 'basic')
    assert.equal(await page.title(), 'basic')

    const heading = await page.textContent('#content h1')
    assert.match(heading, /Smoke Fixture/)

    const tabText = await page.textContent('#tab-list .file-tab.active .file-tab-name')
    assert.match(tabText, /basic\.md/)

    const codeBlockCount = await page.locator('#content code.hljs').count()
    assert.ok(codeBlockCount > 0)

    const copyButton = page.locator('#content .copy-btn').first()
    assert.equal(await copyButton.getAttribute('onclick'), null)
    assert.equal(await copyButton.getAttribute('data-command'), 'copyCode')
    assert.equal(await copyButton.getAttribute('aria-label'), '코드 복사')
    await copyButton.click()
    await page.waitForFunction(() => document.querySelector('#content .copy-btn')?.classList.contains('copied'))
    await page.waitForFunction(() => document.getElementById('toast')?.textContent === '코드 복사됨' && document.getElementById('toast')?.classList.contains('show'))

    await page.click('#btn-copy-all')
    await page.waitForFunction(() => document.getElementById('toast')?.textContent === '복사됨' && document.getElementById('toast')?.classList.contains('show'))
  } finally {
    await closeApp(electronApp)
  }
})

test('PDF export button sits right of print and saves a PDF', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-'))
  const pdfPath = path.join(tempDir, 'basic.pdf')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await stubSaveDialog(electronApp, pdfPath)
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    const toolbarState = await page.evaluate(() => {
      const print = document.getElementById('btn-print')
      const exportPdf = document.getElementById('btn-export-pdf')
      return {
        printEnabled: Boolean(print && !print.disabled),
        exportEnabled: Boolean(exportPdf && !exportPdf.disabled),
        exportRightOfPrint: Boolean(print && exportPdf && (print.compareDocumentPosition(exportPdf) & Node.DOCUMENT_POSITION_FOLLOWING)),
        command: exportPdf?.dataset.command || '',
        title: exportPdf?.getAttribute('title') || '',
        ariaLabel: exportPdf?.getAttribute('aria-label') || '',
      }
    })
    assert.deepEqual(toolbarState, {
      printEnabled: true,
      exportEnabled: true,
      exportRightOfPrint: true,
      command: 'exportPdf',
      title: 'PDF 내보내기',
      ariaLabel: 'PDF 내보내기',
    })

    await page.click('#btn-export-pdf')
    await waitForFile(pdfPath)
    await page.waitForFunction(() => document.getElementById('toast')?.textContent === 'PDF 저장됨' && document.getElementById('toast')?.classList.contains('show'))

    const pdf = await fs.readFile(pdfPath)
    assert.equal(pdf.subarray(0, 4).toString('utf8'), '%PDF')
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

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

test('editing in source mode marks the tab dirty and save clears it', async () => {
  const { path: tempMarkdown, cleanup } = await createTempMarkdown(BASIC_MD, 'dirty-save.md')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [tempMarkdown])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'dirty-save')

    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => document.getElementById('source-view').style.display === 'block')

    const editor = page.locator('#source-editor')
    await editor.fill('# Smoke Fixture\n\nThis file verifies markdown rendering and tab creation.\n\n```js\nconsole.log(\'smoke\')\n```\n\nExtra line for save coverage.\n')

    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      const saveButton = document.getElementById('btn-save')
      return active && active.textContent.trim().startsWith('●') && saveButton && !saveButton.disabled
    })

    await emitRendererCommand(electronApp, 'saveFile')
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      const saveButton = document.getElementById('btn-save')
      return active && !active.textContent.includes('●') && saveButton && saveButton.disabled
    })

    const savedContent = await fs.readFile(tempMarkdown, 'utf8')
    assert.match(savedContent, /Extra line for save coverage\./)
  } finally {
    await closeApp(electronApp)
    await cleanup()
  }
})

test('save as rewires the active tab path and future saves to the new file', async () => {
  const { path: initialPath, cleanup } = await createTempMarkdown(BASIC_MD, 'save-as-source.md')
  const tempDir = path.dirname(initialPath)
  const savedPath = path.join(tempDir, 'saved-as.md')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [initialPath])
    await stubSaveDialog(electronApp, savedPath)

    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'save-as-source')

    await emitRendererCommand(electronApp, 'toggleSource')

    await page.waitForFunction(() => document.getElementById('source-view').style.display === 'block')
    await page.locator('#source-editor').fill('# Save As Draft\n\nSaved to a chosen path.\n')

    await clickApplicationMenuItem(electronApp, '파일', '다른 이름으로 저장…')
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      const saveButton = document.getElementById('btn-save')
      return document.title === 'saved-as' && active && active.textContent.includes('saved-as.md') && saveButton.disabled
    })

    assert.equal(await fs.readFile(savedPath, 'utf8'), '# Save As Draft\n\nSaved to a chosen path.\n')

    await page.locator('#source-editor').fill('# Save As Draft\n\nSaved again to same path.\n')
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return Boolean(active && active.textContent.includes('●'))
    })

    await emitRendererCommand(electronApp, 'saveFile')
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return Boolean(active && !active.textContent.includes('●'))
    })

    assert.equal(await fs.readFile(savedPath, 'utf8'), '# Save As Draft\n\nSaved again to same path.\n')
    const originalContent = await fs.readFile(initialPath, 'utf8')
    assert.doesNotMatch(originalContent, /Saved to a chosen path\.|Saved again to same path\./)
  } finally {
    await closeApp(electronApp)
    await cleanup()
  }
})

test('Enter continues a bullet list item and exits an empty one, each undoable in one step', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => document.getElementById('source-view').style.display === 'block')

    const editor = page.locator('#source-editor')
    await editor.click()
    await page.keyboard.press('Meta+a')
    await page.keyboard.type('- item')
    await page.keyboard.press('Enter')

    await page.waitForFunction(() => document.getElementById('source-editor').value === '- item\n- ')
    assert.equal(await editor.inputValue(), '- item\n- ')

    // The list item is now empty ("- " with nothing after it) — Enter here must exit the
    // list (remove the prefix) rather than add another bullet, or there'd be no way out.
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.getElementById('source-editor').value === '- item\n')
    assert.equal(await editor.inputValue(), '- item\n')

    // Both edits went through execCommand, so each Cmd+Z must revert exactly one of them —
    // this is the whole reason execCommand is mandated over direct .value assignment.
    await page.keyboard.press('Meta+z')
    await page.waitForFunction(() => document.getElementById('source-editor').value === '- item\n- ')
    assert.equal(await editor.inputValue(), '- item\n- ')

    await page.keyboard.press('Meta+z')
    await page.waitForFunction(() => document.getElementById('source-editor').value === '- item')
    assert.equal(await editor.inputValue(), '- item')
  } finally {
    await closeApp(electronApp)
  }
})

// Repro for the reported "duplicate list items" bug: repeatedly pressing Enter with the
// caret reset to the same earlier list line each time (e.g. a user clicking back into item 1)
// inserts one new empty item per press, at that spot — this is correct list-splitting applied
// N times, not a runaway/compounding bug. The caret naturally advances onto the new item after
// each Enter (proven by the test above, where a second Enter hits the "exit empty item" branch),
// so accumulation only occurs when something external forces the caret back. The real-world
// cause reported alongside this (Korean IME composition potentially double-firing the Enter
// keydown) is covered by the `event.isComposing` guard in editor.js, which can't be exercised
// here since Playwright's synthetic KeyboardEvents always report isComposing: false.
test('repeated Enter at a manually reset cursor position adds one item per press (expected, not a runaway bug)', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => document.getElementById('source-view').style.display === 'block')

    const editor = page.locator('#source-editor')
    await editor.click()
    // .fill() sets the value directly rather than sending real keydowns, so embedded
    // newlines don't get intercepted by the Enter list-continuation handler under test.
    await editor.fill('- a\n- b\n- c')

    const resetCursorToEndOfLineOne = () =>
      page.evaluate(() => document.getElementById('source-editor').setSelectionRange(3, 3))

    for (let i = 1; i <= 3; i += 1) {
      await resetCursorToEndOfLineOne()
      await page.keyboard.press('Enter')
      const expected = `- a\n${'- \n'.repeat(i)}- b\n- c`
      await page.waitForFunction(
        value => document.getElementById('source-editor').value === value,
        expected,
      )
      assert.equal(await editor.inputValue(), expected)
    }
  } finally {
    await closeApp(electronApp)
  }
})

test('Cmd+B toggles bold markers on the selection and undo reverts each step', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => document.getElementById('source-view').style.display === 'block')

    const editor = page.locator('#source-editor')
    await editor.click()
    await page.keyboard.press('Meta+a')
    await page.keyboard.type('hello world')
    await page.evaluate(() => document.getElementById('source-editor').setSelectionRange(0, 5))

    await page.keyboard.press('Meta+b')
    await page.waitForFunction(() => document.getElementById('source-editor').value === '**hello** world')
    assert.equal(await editor.inputValue(), '**hello** world')

    // Re-select the wrapped word (inside the markers) and toggle again: must unwrap, not
    // wrap a second time.
    await page.evaluate(() => document.getElementById('source-editor').setSelectionRange(2, 7))
    await page.keyboard.press('Meta+b')
    await page.waitForFunction(() => document.getElementById('source-editor').value === 'hello world')
    assert.equal(await editor.inputValue(), 'hello world')

    // Each toggle is a single execCommand call, so each Cmd+Z must revert exactly one step.
    await page.keyboard.press('Meta+z')
    await page.waitForFunction(() => document.getElementById('source-editor').value === '**hello** world')
    assert.equal(await editor.inputValue(), '**hello** world')

    await page.keyboard.press('Meta+z')
    await page.waitForFunction(() => document.getElementById('source-editor').value === 'hello world')
    assert.equal(await editor.inputValue(), 'hello world')
  } finally {
    await closeApp(electronApp)
  }
})

test('wrap toggle hides the line-number gutter and un-hides it when toggled off', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => document.getElementById('source-view').style.display === 'block')

    // Read the starting state instead of assuming it, since wrap mode persists across
    // launches via localStorage and a prior test in this run may have left it on.
    const wasWrapped = await page.evaluate(() => document.getElementById('scroll-area').classList.contains('wrap-mode'))

    await emitRendererCommand(electronApp, 'toggleWrap')
    await page.waitForFunction(
      previous => document.getElementById('scroll-area').classList.contains('wrap-mode') !== previous,
      wasWrapped,
    )
    const nowWrapped = await page.evaluate(() => document.getElementById('scroll-area').classList.contains('wrap-mode'))
    assert.notEqual(nowWrapped, wasWrapped)
    // The gutter is built from raw '\n' counts, so it hides exactly when wrap is on —
    // otherwise it drifts out of sync with wrapped visual rows.
    const gutterDisplay = await page.locator('#source-lines').evaluate(el => getComputedStyle(el).display)
    assert.equal(gutterDisplay === 'none', nowWrapped)

    await emitRendererCommand(electronApp, 'toggleWrap')
    await page.waitForFunction(
      original => document.getElementById('scroll-area').classList.contains('wrap-mode') === original,
      wasWrapped,
    )
    const gutterRestored = await page.locator('#source-lines').evaluate(el => getComputedStyle(el).display)
    assert.equal(gutterRestored === 'none', wasWrapped)
  } finally {
    await closeApp(electronApp)
  }
})

test('toggleSource switches between preview and editor and re-renders preview on return', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => {
      const content = document.getElementById('content')
      const sourceView = document.getElementById('source-view')
      const scrollArea = document.getElementById('scroll-area')
      return content.style.display === 'none' && sourceView.style.display === 'block' && scrollArea.classList.contains('source-mode')
    })

    await page.locator('#source-editor').fill('# Updated From Source\n\nChanged in editor mode.\n')

    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => {
      const content = document.getElementById('content')
      const sourceView = document.getElementById('source-view')
      const heading = document.querySelector('#content h1')
      return content.style.display === '' && sourceView.style.display === 'none' && heading && heading.textContent.includes('Updated From Source')
    })

    const previewText = await page.textContent('#content')
    assert.match(previewText, /Changed in editor mode\./)
  } finally {
    await closeApp(electronApp)
  }
})

test('entering split view force-closes the sidebar, disables its toggle, and restores it on exit', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    const sidebarState = () => page.evaluate(() => ({
      closed: document.getElementById('sidebar').classList.contains('closed'),
      toggleDisabled: document.getElementById('btn-sidebar').disabled,
    }))

    assert.deepEqual(await sidebarState(), { closed: false, toggleDisabled: false })

    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => document.getElementById('scroll-area').classList.contains('split-mode'))
    assert.deepEqual(await sidebarState(), { closed: true, toggleDisabled: true })

    // The disabled toggle button must actually refuse clicks, not just look disabled.
    await page.locator('#btn-sidebar').click({ force: true })
    assert.deepEqual(await sidebarState(), { closed: true, toggleDisabled: true })

    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => !document.getElementById('scroll-area').classList.contains('split-mode'))
    assert.deepEqual(await sidebarState(), { closed: false, toggleDisabled: false })
  } finally {
    await closeApp(electronApp)
  }
})

test('split view leaves an already-closed sidebar closed on exit instead of force-opening it', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    await emitRendererCommand(electronApp, 'toggleSidebar')
    await page.waitForFunction(() => document.getElementById('sidebar').classList.contains('closed'))

    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => document.getElementById('scroll-area').classList.contains('split-mode'))
    assert.equal(await page.evaluate(() => document.getElementById('sidebar').classList.contains('closed')), true)

    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => !document.getElementById('scroll-area').classList.contains('split-mode'))
    assert.equal(await page.evaluate(() => document.getElementById('sidebar').classList.contains('closed')), true)
  } finally {
    await closeApp(electronApp)
  }
})

test('switching to a tab restored in split mode force-closes the sidebar; switching back restores it', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD, ROOT_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 2)
    await page.waitForFunction(() => document.title === 'root')

    // The active (second) tab enters split mode with the sidebar open beforehand.
    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => document.getElementById('scroll-area').classList.contains('split-mode'))
    assert.equal(await page.evaluate(() => document.getElementById('sidebar').classList.contains('closed')), true)

    // Switching to the first (non-split) tab is a tab-restore exit from split mode --
    // not a toggleSplitView call -- and must still restore the sidebar.
    await page.locator('#tab-list .file-tab').first().click()
    await page.waitForFunction(() => document.title === 'basic')
    assert.equal(await page.evaluate(() => document.getElementById('sidebar').classList.contains('closed')), false)

    // Switching back to the split tab is a tab-restore entry into split mode and must
    // force the sidebar closed again, exactly like the interactive toggle does.
    await page.locator('#tab-list .file-tab').nth(1).click()
    await page.waitForFunction(() => document.title === 'root')
    assert.equal(await page.evaluate(() => document.getElementById('sidebar').classList.contains('closed')), true)
    assert.equal(await page.evaluate(() => document.getElementById('btn-sidebar').disabled), true)
  } finally {
    await closeApp(electronApp)
  }
})

test('split view shows editor and preview together, live-renders edits, and saves editor content', async () => {
  const { path: tempMarkdown, cleanup } = await createTempMarkdown(BASIC_MD, 'split-save.md')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [tempMarkdown])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'split-save')

    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => {
      const content = document.getElementById('content')
      const sourceView = document.getElementById('source-view')
      const scrollArea = document.getElementById('scroll-area')
      const splitButton = document.getElementById('btn-split')
      return content.style.display === '' && sourceView.style.display === 'block' && scrollArea.classList.contains('split-mode') && splitButton.classList.contains('split-active')
    })

    const splitButtonState = await page.evaluate(() => {
      const splitButton = document.getElementById('btn-split')
      return {
        display: getComputedStyle(splitButton).display,
        className: splitButton.className,
        text: splitButton.textContent.trim(),
        title: splitButton.title,
      }
    })
    assert.deepEqual(splitButtonState, {
      display: 'flex',
      className: 'btn btn-icon split-active',
      text: '',
      title: '분할뷰 닫기',
    })

    await page.locator('#source-editor').fill('# Split Edited\n\nPreview updates while editing.\n')
    await page.waitForFunction(() => {
      const heading = document.querySelector('#content h1')
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return heading && heading.textContent.includes('Split Edited') && active && active.textContent.includes('●')
    })

    await emitRendererCommand(electronApp, 'saveFile')
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return Boolean(active && !active.textContent.includes('●'))
    })

    assert.equal(await fs.readFile(tempMarkdown, 'utf8'), '# Split Edited\n\nPreview updates while editing.\n')
  } finally {
    await closeApp(electronApp)
    await cleanup()
  }
})

test('split view restores fresh preview and pane scroll after immediate tab switch', async () => {
  const { electronApp, page } = await launchApp()
  const longBody = Array.from({ length: 80 }, (_, index) => `## Section ${index + 1}\n\nParagraph ${index + 1}.`).join('\n\n')

  try {
    await page.waitForSelector('#empty')
    await emitFileOpened(electronApp, {
      content: `# A\n\n${longBody}\n`,
      filename: 'a.md',
      path: '/tmp/mdv-a.md',
    })
    await page.waitForFunction(() => document.title === 'a')
    await emitFileOpened(electronApp, {
      content: '# B\n\nSecond tab.\n',
      filename: 'b.md',
      path: '/tmp/mdv-b.md',
    })
    await page.waitForFunction(() => document.title === 'b')

    await page.locator('#tab-list .file-tab').first().click()
    await page.waitForFunction(() => document.title === 'a')
    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => document.getElementById('scroll-area').classList.contains('split-mode'))

    await page.evaluate(() => {
      document.getElementById('content').scrollTop = 420
    })
    await page.waitForFunction(() => document.getElementById('source-view').scrollTop > 0)

    const syncedFromPreview = await page.evaluate(() => ({
      preview: document.getElementById('content').scrollTop,
      source: document.getElementById('source-view').scrollTop,
    }))
    assert.ok(syncedFromPreview.source > 0, `source scroll should sync from preview, got ${syncedFromPreview.source}`)

    await page.evaluate(() => {
      document.getElementById('source-view').scrollTop = 120
    })
    await page.waitForFunction(() => {
      const content = document.getElementById('content')
      return content.scrollTop > 0 && content.scrollTop !== 420
    })
    const syncedFromSource = await page.evaluate(() => ({
      preview: document.getElementById('content').scrollTop,
      source: document.getElementById('source-view').scrollTop,
    }))
    assert.ok(syncedFromSource.preview > 0, `preview scroll should sync from source, got ${syncedFromSource.preview}`)

    await page.evaluate(() => {
      document.getElementById('content').scrollTop = 360
      document.getElementById('source-view').scrollTop = 220
    })

    await page.locator('#source-editor').fill(`# A edited\n\n${Array.from({ length: 80 }, (_, index) => `## Edited ${index + 1}\n\nChanged ${index + 1}.`).join('\n\n')}\n`)
    await page.locator('#tab-list .file-tab').nth(1).click()
    await page.waitForFunction(() => document.title === 'b')

    await page.locator('#tab-list .file-tab').first().click()
    await page.waitForFunction(() => {
      const heading = document.querySelector('#content h1')
      const editor = document.getElementById('source-editor')
      return document.title === 'a' && heading && heading.textContent.includes('A edited') && editor.value.startsWith('# A edited')
    })

    const restoredScroll = await page.evaluate(() => ({
      preview: document.getElementById('content').scrollTop,
      source: document.getElementById('source-view').scrollTop,
    }))
    assert.ok(restoredScroll.preview > 0, `preview scroll should restore, got ${restoredScroll.preview}`)
    assert.ok(restoredScroll.source > 0, `source scroll should restore, got ${restoredScroll.source}`)
  } finally {
    await closeApp(electronApp)
  }
})

test('split view ignores stale async preview renders after newer edits', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-'))
  const tempMarkdown = path.join(tempDir, 'async-split.md')
  await fs.writeFile(tempMarkdown, '# Async Split\n\nInitial.\n', 'utf8')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [tempMarkdown])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'async-split')
    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => document.getElementById('scroll-area').classList.contains('split-mode'))

    await page.evaluate(() => {
      const originalReadImageDataUrl = window.api.readImageDataUrl
      let delayed = false
      window.api.readImageDataUrl = async path => {
        if (!delayed) {
          delayed = true
          await new Promise(resolve => setTimeout(resolve, 350))
        }
        return originalReadImageDataUrl(path)
      }
    })

    await page.locator('#source-editor').fill('# Stale Render\n\n![missing](missing.png)\n')
    await page.waitForTimeout(180)
    await page.locator('#source-editor').fill('# Latest Render\n\nThis must remain visible.\n')
    await page.waitForFunction(() => document.querySelector('#content h1')?.textContent.includes('Latest Render'))
    await page.waitForTimeout(450)

    const heading = await page.textContent('#content h1')
    const body = await page.textContent('#content')
    assert.equal(heading, 'Latest Render')
    assert.match(body, /This must remain visible\./)
    assert.doesNotMatch(body, /Stale Render/)
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test('split view restores active tab when async preview finishes after tab switch', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await emitFileOpened(electronApp, {
      content: '# Async A\n\nInitial.\n',
      filename: 'async-a.md',
      path: '/tmp/mdv-async-a.md',
    })
    await page.waitForFunction(() => document.title === 'async-a')
    await emitFileOpened(electronApp, {
      content: '# Async B\n\nStay visible.\n',
      filename: 'async-b.md',
      path: '/tmp/mdv-async-b.md',
    })
    await page.waitForFunction(() => document.title === 'async-b')

    await page.locator('#tab-list .file-tab').filter({ hasText: 'async-a.md' }).click()
    await page.waitForFunction(() => document.title === 'async-a')
    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => document.getElementById('scroll-area').classList.contains('split-mode'))

    await page.evaluate(() => {
      const originalReadImageDataUrl = window.api.readImageDataUrl
      window.api.readImageDataUrl = async path => {
        await new Promise(resolve => setTimeout(resolve, 350))
        return originalReadImageDataUrl(path)
      }
    })

    await page.locator('#source-editor').fill('# Async A Edited\n\n![missing](missing.png)\n')
    await page.waitForTimeout(180)
    await page.locator('#tab-list .file-tab').filter({ hasText: 'async-b.md' }).click()
    await page.waitForFunction(() => document.title === 'async-b')
    await page.waitForTimeout(450)

    const active = await page.evaluate(() => ({
      title: document.title,
      heading: document.querySelector('#content h1')?.textContent || '',
      activeTab: document.querySelector('#tab-list .file-tab.active .file-tab-name')?.textContent || '',
    }))
    assert.deepEqual(active, {
      title: 'async-b',
      heading: 'Async B',
      activeTab: 'async-b.md',
    })
  } finally {
    await closeApp(electronApp)
  }
})

test('split view keeps active tab when dirty restore render finishes after tab switch', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await emitFileOpened(electronApp, {
      content: '# Restore A\n\nInitial.\n',
      filename: 'restore-a.md',
      path: '/tmp/mdv-restore-a.md',
    })
    await page.waitForFunction(() => document.title === 'restore-a')
    await emitFileOpened(electronApp, {
      content: '# Restore B\n\nStay visible.\n',
      filename: 'restore-b.md',
      path: '/tmp/mdv-restore-b.md',
    })
    await page.waitForFunction(() => document.title === 'restore-b')

    await page.locator('#tab-list .file-tab').filter({ hasText: 'restore-a.md' }).click()
    await page.waitForFunction(() => document.title === 'restore-a')
    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => document.getElementById('scroll-area').classList.contains('split-mode'))

    await page.evaluate(() => {
      const originalReadImageDataUrl = window.api.readImageDataUrl
      window.api.readImageDataUrl = async path => {
        await new Promise(resolve => setTimeout(resolve, 350))
        return originalReadImageDataUrl(path)
      }
    })

    await page.locator('#source-editor').fill('# Restore A Edited\n\n![missing](missing.png)\n')
    await page.locator('#tab-list .file-tab').filter({ hasText: 'restore-b.md' }).click()
    await page.waitForFunction(() => document.title === 'restore-b')
    await page.locator('#tab-list .file-tab').filter({ hasText: 'restore-a.md' }).click()
    await page.waitForFunction(() => document.title === 'restore-a')
    await page.waitForTimeout(100)
    await page.locator('#tab-list .file-tab').filter({ hasText: 'restore-b.md' }).click()
    await page.waitForFunction(() => document.title === 'restore-b')
    await page.waitForTimeout(450)

    const active = await page.evaluate(() => ({
      title: document.title,
      heading: document.querySelector('#content h1')?.textContent || '',
      activeTab: document.querySelector('#tab-list .file-tab.active .file-tab-name')?.textContent || '',
    }))
    assert.deepEqual(active, {
      title: 'restore-b',
      heading: 'Restore B',
      activeTab: 'restore-b.md',
    })
  } finally {
    await closeApp(electronApp)
  }
})

test('external file changes reload clean tabs and prompt before clobbering dirty edits', async () => {
  const { path: tempMarkdown, cleanup } = await createTempMarkdown(BASIC_MD, 'watched-source.md')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [tempMarkdown])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'watched-source')

    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => document.getElementById('source-view').style.display === 'block')

    // Clean tab: external change reloads the editor silently.
    const changedContent = '# External update\n\nWatcher payload replaced the source.\n'
    await fs.writeFile(tempMarkdown, changedContent, 'utf8')
    await emitFileChanged(electronApp, { path: tempMarkdown, content: changedContent, event: 'change' })

    await page.waitForFunction(expected => {
      const editor = document.getElementById('source-editor')
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      const saveButton = document.getElementById('btn-save')
      return editor.value === expected && active && !active.textContent.includes('●') && saveButton.disabled
    }, changedContent)

    // Dirty tab: external change asks first; a dismissed confirm keeps the local edit.
    const localEdit = '# Local edit\n'
    await page.locator('#source-editor').fill(localEdit)
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return Boolean(active && active.textContent.includes('●'))
    })

    const secondExternal = '# Second external update\n'
    await fs.writeFile(tempMarkdown, secondExternal, 'utf8')
    await emitFileChanged(electronApp, { path: tempMarkdown, content: secondExternal, event: 'change' })

    // Playwright auto-dismisses native dialogs, so confirm() returns false → keep edits.
    await page.waitForFunction(expected => {
      const editor = document.getElementById('source-editor')
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return editor.value === expected && active && active.textContent.includes('●')
    }, localEdit)

    assert.equal(await page.locator('#source-editor').inputValue(), localEdit)
  } finally {
    await closeApp(electronApp)
    await cleanup()
  }
})

test('background tabs stay watched and pick up clean external edits without rewiring on switch', async () => {
  const { path: firstPath, cleanup: cleanupFirst } = await createTempMarkdown(BASIC_MD, 'watch-one.md')
  const { path: secondPath, cleanup: cleanupSecond } = await createTempMarkdown(ROOT_MD, 'watch-two.md')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [firstPath, secondPath])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 2)
    await page.waitForFunction(() => document.title === 'watch-two')

    // watch-one is the inactive background tab. Editing its file on disk must still
    // reach the renderer — both tabs are watched at once now, not just the active one.
    const firstContent = '# Watch One Updated\n\nBackground tab should pick this up while inactive.\n'
    await fs.writeFile(firstPath, firstContent, 'utf8')
    await page.waitForTimeout(400)

    // The active tab (watch-two) is untouched by the background tab's change.
    assert.doesNotMatch(await page.textContent('#content'), /Background tab should pick this up/)

    // Switching to watch-one shows the update immediately — it was already applied
    // while backgrounded, and no reload prompt was needed since it was clean.
    await page.locator('#tab-list .file-tab').filter({ hasText: 'watch-one.md' }).click()
    await page.waitForFunction(() => document.title === 'watch-one')
    await page.waitForFunction(expected => document.getElementById('content').textContent.includes(expected), 'Background tab should pick this up while inactive.')
    const activeLabel = await page.textContent('#tab-list .file-tab.active .file-tab-name')
    assert.doesNotMatch(activeLabel, /[●⚠]/)
  } finally {
    await closeApp(electronApp)
    await cleanupFirst()
    await cleanupSecond()
  }
})

test('a dirty background tab is marked as a conflict instead of prompting, and confirms on switch', async () => {
  const { path: firstPath, cleanup: cleanupFirst } = await createTempMarkdown(BASIC_MD, 'watch-conflict-one.md')
  const { path: secondPath, cleanup: cleanupSecond } = await createTempMarkdown(ROOT_MD, 'watch-conflict-two.md')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [firstPath, secondPath])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 2)
    await page.waitForFunction(() => document.title === 'watch-conflict-two')

    // Dirty the first tab, then switch away so it becomes an inactive, dirty tab.
    await page.locator('#tab-list .file-tab').filter({ hasText: 'watch-conflict-one.md' }).click()
    await page.waitForFunction(() => document.title === 'watch-conflict-one')
    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => document.getElementById('source-view').style.display === 'block')
    const localEdit = '# Local Edit\n\nUnsaved change on the background tab.\n'
    await page.locator('#source-editor').fill(localEdit)
    await page.waitForFunction(() => {
      const tab = [...document.querySelectorAll('#tab-list .file-tab')].find(el => el.textContent.includes('watch-conflict-one.md'))
      return Boolean(tab && tab.textContent.includes('●'))
    })

    await page.locator('#tab-list .file-tab').filter({ hasText: 'watch-conflict-two.md' }).click()
    await page.waitForFunction(() => document.title === 'watch-conflict-two')

    // External edit on the now-inactive, dirty tab must not pop a modal for a tab
    // the user isn't looking at — it gets marked with a conflict indicator instead.
    const externalContent = '# External Update\n\nChanged on disk while the tab was in the background.\n'
    await fs.writeFile(firstPath, externalContent, 'utf8')
    await page.waitForFunction(() => {
      const tab = [...document.querySelectorAll('#tab-list .file-tab')].find(el => el.textContent.includes('watch-conflict-one.md'))
      return Boolean(tab && tab.classList.contains('has-conflict') && tab.textContent.includes('⚠'))
    })

    // The active tab is unaffected.
    assert.doesNotMatch(await page.textContent('#content'), /Changed on disk while the tab was in the background/)

    // Switching to the conflicted tab asks; Playwright auto-dismisses confirm() → keep local edits.
    await page.locator('#tab-list .file-tab').filter({ hasText: 'watch-conflict-one.md' }).click()
    await page.waitForFunction(() => document.title === 'watch-conflict-one')
    await page.waitForFunction(() => {
      const tab = [...document.querySelectorAll('#tab-list .file-tab')].find(el => el.textContent.includes('watch-conflict-one.md'))
      return Boolean(tab && !tab.classList.contains('has-conflict') && tab.textContent.includes('●'))
    })
    assert.equal(await page.locator('#source-editor').inputValue(), localEdit)
  } finally {
    await closeApp(electronApp)
    await cleanupFirst()
    await cleanupSecond()
  }
})

test('save as unwatches the old path and watches the new one', async () => {
  const { path: initialPath, cleanup } = await createTempMarkdown(BASIC_MD, 'rewatch-source.md')
  const tempDir = path.dirname(initialPath)
  const savedPath = path.join(tempDir, 'rewatch-saved-as.md')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [initialPath])
    await stubSaveDialog(electronApp, savedPath)
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'rewatch-source')

    await clickApplicationMenuItem(electronApp, '파일', '다른 이름으로 저장…')
    await page.waitForFunction(() => document.title === 'rewatch-saved-as')

    // The old path is no longer watched: writing to it must not affect the tab.
    await fs.writeFile(initialPath, '# Stale Path Edit\n\nMust be ignored.\n', 'utf8')
    await page.waitForTimeout(400)
    assert.doesNotMatch(await page.textContent('#content'), /Must be ignored/)

    // The new path is watched: writing to it must reach the renderer.
    const updatedContent = '# New Path Edit\n\nThe new path is watched after save as.\n'
    await fs.writeFile(savedPath, updatedContent, 'utf8')
    await page.waitForFunction(expected => document.getElementById('content').textContent.includes(expected), 'The new path is watched after save as.')
  } finally {
    await closeApp(electronApp)
    await cleanup()
  }
})

test('changing an embedded image on disk refreshes it without editing the document', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-image-'))
  const imagePath = path.join(tempDir, 'pic.svg')
  const docPath = path.join(tempDir, 'image-doc.md')
  await fs.writeFile(imagePath, '<svg xmlns="http://www.w3.org/2000/svg" width="10"><rect fill="red"/></svg>', 'utf8')
  await fs.writeFile(docPath, '# Image Doc\n\n![pic](pic.svg)\n', 'utf8')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [docPath])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'image-doc')
    await page.waitForFunction(() => {
      const img = document.querySelector('#content img')
      return Boolean(img && img.src.startsWith('data:image/svg+xml;base64,'))
    })
    const beforeSrc = await page.getAttribute('#content img', 'src')

    // Only the image file changes on disk. The document itself is untouched.
    await fs.writeFile(imagePath, '<svg xmlns="http://www.w3.org/2000/svg" width="10"><rect fill="blue"/></svg>', 'utf8')
    await page.waitForFunction(expected => {
      const img = document.querySelector('#content img')
      return Boolean(img && img.src.startsWith('data:image/svg+xml;base64,') && img.src !== expected)
    }, beforeSrc)
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test('a background tab\'s embedded image change is picked up silently and shown fresh on switch', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-image-bg-'))
  const imagePath = path.join(tempDir, 'pic.svg')
  const firstDocPath = path.join(tempDir, 'image-doc-one.md')
  const secondDocPath = path.join(tempDir, 'image-doc-two.md')
  await fs.writeFile(imagePath, '<svg xmlns="http://www.w3.org/2000/svg" width="10"><rect fill="red"/></svg>', 'utf8')
  await fs.writeFile(firstDocPath, '# Image Doc One\n\n![pic](pic.svg)\n', 'utf8')
  await fs.writeFile(secondDocPath, '# Image Doc Two\n\nNo image here.\n', 'utf8')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [firstDocPath, secondDocPath])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 2)
    await page.waitForFunction(() => document.title === 'image-doc-two')

    // image-doc-one is inactive; grab its (cached) rendered src before the change by
    // switching to it once, then back, so we have a known-good baseline to diff against.
    await page.locator('#tab-list .file-tab').filter({ hasText: 'image-doc-one.md' }).click()
    await page.waitForFunction(() => {
      const img = document.querySelector('#content img')
      return Boolean(img && img.src.startsWith('data:image/svg+xml;base64,'))
    })
    const beforeSrc = await page.getAttribute('#content img', 'src')
    await page.locator('#tab-list .file-tab').filter({ hasText: 'image-doc-two.md' }).click()
    await page.waitForFunction(() => document.title === 'image-doc-two')

    await fs.writeFile(imagePath, '<svg xmlns="http://www.w3.org/2000/svg" width="10"><rect fill="blue"/></svg>', 'utf8')
    await page.waitForTimeout(400)

    // Active tab (no image) is unaffected; no confirm dialog was needed since it's clean.
    assert.equal(await page.locator('#tab-list .file-tab.active .file-tab-name').textContent(), 'image-doc-two.md')

    await page.locator('#tab-list .file-tab').filter({ hasText: 'image-doc-one.md' }).click()
    await page.waitForFunction(() => document.title === 'image-doc-one')
    await page.waitForFunction(expected => {
      const img = document.querySelector('#content img')
      return Boolean(img && img.src.startsWith('data:image/svg+xml;base64,') && img.src !== expected)
    }, beforeSrc)
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test('tab labels render filenames as text instead of HTML', async () => {
  const maliciousName = '<img src=x onerror="window.__mdvInjected=true">.md'
  const { path: tempMarkdown, cleanup } = await createTempMarkdown(BASIC_MD, maliciousName)
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [tempMarkdown])
    await emitRendererCommand(electronApp, 'openFile')

    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 1)

    const tabState = await page.evaluate(() => ({
      labelText: document.querySelector('#tab-list .file-tab.active .file-tab-name')?.textContent,
      injectedImageCount: document.querySelectorAll('#tab-list .file-tab img').length,
      injectedFlag: Boolean(window.__mdvInjected),
    }))

    assert.match(tabState.labelText, /<img src=x onerror="window.__mdvInjected=true">\.md/)
    assert.equal(tabState.injectedImageCount, 0)
    assert.equal(tabState.injectedFlag, false)
  } finally {
    await closeApp(electronApp)
    await cleanup()
  }
})

test('openFolder loads explorer entries, expands nested folders, opens files, and clears root state', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [EXPLORER_DIR])
    await emitRendererCommand(electronApp, 'openFolder')

    await page.waitForFunction(() => {
      const label = document.getElementById('explorer-root-path')
      return Boolean(label && label.textContent && label.textContent.includes('explorer'))
    })

    await page.waitForFunction(() => {
      const reveal = document.getElementById('btn-explorer-reveal')
      const close = document.getElementById('btn-explorer-close')
      return reveal && close && !reveal.classList.contains('hidden') && !close.classList.contains('hidden')
    })

    await emitRendererCommand(electronApp, 'toggleExplorerPathInfo')
    await page.waitForFunction(expected => {
      const label = document.getElementById('explorer-root-path')
      return label && label.textContent === expected
    }, EXPLORER_DIR)

    const treeText = await page.textContent('#explorer-tree')
    assert.match(treeText, /nested/)
    assert.match(treeText, /root\.md/)
    assert.doesNotMatch(treeText, /ignore\.txt/)
    assert.doesNotMatch(treeText, /secret\.md/)

    await page.locator('#explorer-tree .tree-row').filter({ hasText: 'nested' }).click()
    await page.waitForFunction(() => document.getElementById('explorer-tree').textContent.includes('child.md'))

    await page.locator('#explorer-tree .tree-row').filter({ hasText: 'child.md' }).click()
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return document.title === 'child' && active && active.textContent.includes('child.md')
    })

    await emitRendererCommand(electronApp, 'clearExplorerRoot')
    await page.waitForFunction(() => {
      const tree = document.getElementById('explorer-tree')
      const label = document.getElementById('explorer-root-path')
      const reveal = document.getElementById('btn-explorer-reveal')
      const close = document.getElementById('btn-explorer-close')
      return tree.textContent.includes('폴더를 열어 탐색하세요')
        && label.textContent.includes('폴더를 선택하세요')
        && reveal.classList.contains('hidden')
        && close.classList.contains('hidden')
    })
  } finally {
    await closeApp(electronApp)
  }
})

test('shared context menu works for tab and explorer-root surfaces', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 1)

    await page.locator('#tab-list .file-tab.active').click({ button: 'right' })
    await page.waitForFunction(() => {
      const menu = document.getElementById('app-context-menu')
      return menu && menu.style.display === 'block' && menu.textContent.includes('모든 탭 닫기')
    })

    await page.locator('#app-context-menu .ctx-item').filter({ hasText: '모든 탭 닫기' }).click()
    await page.waitForSelector('#empty')

    await stubOpenDialog(electronApp, [EXPLORER_DIR])
    await emitRendererCommand(electronApp, 'openFolder')
    await page.waitForFunction(() => !document.getElementById('btn-explorer-close').classList.contains('hidden'))

    await page.locator('#explorer-root-label').click({ button: 'right' })
    await page.waitForFunction(() => {
      const menu = document.getElementById('app-context-menu')
      return menu && menu.style.display === 'block' && menu.textContent.includes('폴더 닫기')
    })

    await page.locator('#app-context-menu .ctx-item').filter({ hasText: '폴더 닫기' }).click()
    await page.waitForFunction(() => document.getElementById('btn-explorer-close').classList.contains('hidden'))
  } finally {
    await closeApp(electronApp)
  }
})

test('shell actions keep add-menu and drag-drop behavior working', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')

    await page.click('#btn-add')
    await page.waitForFunction(() => {
      const menu = document.getElementById('add-menu')
      const button = document.getElementById('btn-add')
      return menu && menu.style.display !== 'none' && button.classList.contains('active')
    })

    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.waitForFunction(() => {
      const menu = document.getElementById('add-menu')
      const button = document.getElementById('btn-add')
      return menu && menu.style.display === 'none' && !button.classList.contains('active')
    })

    await page.evaluate(async () => {
      const host = document.querySelector('#scroll-area')
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(new File(['# Dropped File\n\nOpened from shell action.\n'], 'dropped.md', { type: 'text/markdown' }))
      host.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
      host.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
    })

    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return document.title === 'dropped' && active && active.textContent.includes('dropped.md')
    })
  } finally {
    await closeApp(electronApp)
  }
})

test('toggleTheme cycles theme state and highlight stylesheets', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')

    const initial = await page.evaluate(() => ({
      theme: localStorage.getItem('theme') || 'auto',
      attr: document.documentElement.getAttribute('data-theme'),
      hlDarkDisabled: document.getElementById('hljs-dark').disabled,
      hlLightDisabled: document.getElementById('hljs-light').disabled,
    }))
    assert.equal(initial.theme, 'auto')

    const afterLight = await page.evaluate(() => {
      document.querySelector('[data-command="toggleTheme"]').click()
      return {
        theme: localStorage.getItem('theme'),
        attr: document.documentElement.getAttribute('data-theme'),
        hlDarkDisabled: document.getElementById('hljs-dark').disabled,
        hlLightDisabled: document.getElementById('hljs-light').disabled,
      }
    })
    assert.equal(afterLight.theme, 'light')
    assert.equal(afterLight.attr, 'light')
    assert.equal(afterLight.hlDarkDisabled, true)
    assert.equal(afterLight.hlLightDisabled, false)

    const afterDark = await page.evaluate(() => {
      document.querySelector('[data-command="toggleTheme"]').click()
      return {
        theme: localStorage.getItem('theme'),
        attr: document.documentElement.getAttribute('data-theme'),
        hlDarkDisabled: document.getElementById('hljs-dark').disabled,
        hlLightDisabled: document.getElementById('hljs-light').disabled,
      }
    })
    assert.equal(afterDark.theme, 'dark')
    assert.equal(afterDark.attr, 'dark')
    assert.equal(afterDark.hlDarkDisabled, false)
    assert.equal(afterDark.hlLightDisabled, true)

    const afterAuto = await page.evaluate(() => {
      document.querySelector('[data-command="toggleTheme"]').click()
      return {
        theme: localStorage.getItem('theme'),
      }
    })
    assert.equal(afterAuto.theme, 'auto')
  } finally {
    await closeApp(electronApp)
  }
})

test('closing a window with unsaved changes prompts, and cancelling keeps the window open', async () => {
  const { path: tempMarkdown, cleanup } = await createTempMarkdown(BASIC_MD, 'close-guard.md')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [tempMarkdown])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'close-guard')

    // Dirty the tab.
    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => document.getElementById('source-view').style.display === 'block')
    await page.locator('#source-editor').fill('# Smoke Fixture\n\nunsaved edit\n')
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return active && active.textContent.trim().startsWith('●')
    })

    // Answer 취소 (1) to a REAL close: Electron must honour preventDefault and the
    // window must survive. Driving win.close() rather than emitting the event keeps
    // this from passing for the wrong reason.
    await stubCloseDialog(electronApp, 1)
    const openAfterCancel = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.close()
      await new Promise(resolve => setTimeout(resolve, 300))
      return BrowserWindow.getAllWindows().length
    })
    assert.equal(openAfterCancel, 1, 'cancelling must keep the window open')

    const calls = await getCloseDialogCalls(electronApp)
    assert.equal(calls.length, 1, 'a dirty close must prompt exactly once')
    assert.match(calls[0].message, /저장하지 않은 변경/)

    // Answer 닫기 (0): the same close now goes through.
    await stubCloseDialog(electronApp, 0)
    const openAfterConfirm = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.close()
      await new Promise(resolve => setTimeout(resolve, 500))
      return BrowserWindow.getAllWindows().length
    })
    assert.equal(openAfterConfirm, 0, 'confirming must actually close the window')
  } finally {
    await closeApp(electronApp)
    await cleanup()
  }
})

test('search finds matches in preview mode and steps through them', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    // The default-app guide takes ESC priority over search; force it out of the way so this
    // test can isolate search's own Escape-closes-the-bar behavior (covered separately by the
    // guide-priority e2e tests).
    await page.evaluate(() => document.getElementById('default-app-guide')?.classList.remove('show'))

    await emitRendererCommand(electronApp, 'toggleSearch')
    await page.waitForSelector('#search-bar', { state: 'visible' })
    await page.fill('#search-input', 'smoke')
    await page.waitForFunction(() => document.getElementById('search-count').textContent === '1/2')

    const currentMarks = await page.evaluate(() => document.querySelectorAll('mark.search-hl.current').length)
    assert.equal(currentMarks, 1)

    await page.locator('#search-input').press('Enter')
    await page.waitForFunction(() => document.getElementById('search-count').textContent === '2/2')

    await page.locator('#search-input').press('Escape')
    await page.waitForFunction(() => document.getElementById('search-bar').style.display === 'none')
  } finally {
    await closeApp(electronApp)
  }
})

test('search steps through matches in source mode using the editor selection', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => document.getElementById('source-view').style.display === 'block')

    await emitRendererCommand(electronApp, 'toggleSearch')
    await page.waitForSelector('#search-bar', { state: 'visible' })
    await page.fill('#search-input', 'smoke')
    await page.waitForFunction(() => document.getElementById('search-count').textContent === '1/2')

    const firstSelection = await page.evaluate(() => {
      const editor = document.getElementById('source-editor')
      return { start: editor.selectionStart, end: editor.selectionEnd }
    })
    assert.deepEqual(firstSelection, { start: 2, end: 7 })

    await page.locator('#search-input').press('Enter')
    await page.waitForFunction(() => document.getElementById('search-count').textContent === '2/2')

    const second = await page.evaluate(() => {
      const editor = document.getElementById('source-editor')
      const expectedStart = editor.value.toLowerCase().lastIndexOf('smoke')
      return { start: editor.selectionStart, end: editor.selectionEnd, expectedStart, activeId: document.activeElement?.id }
    })
    assert.equal(second.start, second.expectedStart)
    assert.equal(second.end, second.expectedStart + 5)
    assert.equal(second.activeId, 'search-input', 'focus must return to the search input after stepping to the next match')
  } finally {
    await closeApp(electronApp)
  }
})

test('search in split mode selects editor matches without marking the preview pane', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => document.getElementById('scroll-area').classList.contains('split-mode'))

    await emitRendererCommand(electronApp, 'toggleSearch')
    await page.waitForSelector('#search-bar', { state: 'visible' })
    await page.fill('#search-input', 'smoke')
    await page.waitForFunction(() => document.getElementById('search-count').textContent === '1/2')

    const state = await page.evaluate(() => {
      const editor = document.getElementById('source-editor')
      return {
        selectionStart: editor.selectionStart,
        selectionEnd: editor.selectionEnd,
        previewMarks: document.querySelectorAll('#content mark.search-hl').length,
      }
    })
    assert.deepEqual({ selectionStart: state.selectionStart, selectionEnd: state.selectionEnd }, { selectionStart: 2, selectionEnd: 7 })
    assert.equal(state.previewMarks, 0, 'split-mode search must not touch the debounced preview pane')
  } finally {
    await closeApp(electronApp)
  }
})

test('search closes automatically when leaving source mode', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => document.getElementById('source-view').style.display === 'block')

    await emitRendererCommand(electronApp, 'toggleSearch')
    await page.waitForSelector('#search-bar', { state: 'visible' })

    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => document.getElementById('content').style.display === '')

    const barDisplay = await page.evaluate(() => document.getElementById('search-bar').style.display)
    assert.equal(barDisplay, 'none')
  } finally {
    await closeApp(electronApp)
  }
})

test('native menu exposes previously hidden file, edit, view, and help commands', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    await clickApplicationMenuItem(electronApp, '파일', '새 파일')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 2)

    await clickApplicationMenuItem(electronApp, '파일', '탭 닫기')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 1)

    await clickApplicationMenuItem(electronApp, '편집', '찾기…')
    await page.waitForSelector('#search-bar', { state: 'visible' })
    await clickApplicationMenuItem(electronApp, '편집', '찾기…')
    await page.waitForFunction(() => document.getElementById('search-bar').style.display === 'none')

    await clickApplicationMenuItem(electronApp, '보기', '소스 보기')
    await page.waitForFunction(() => document.getElementById('source-view').style.display === 'block')
    await clickApplicationMenuItem(electronApp, '보기', '소스 보기')
    await page.waitForFunction(() => document.getElementById('content').style.display === '')

    await clickApplicationMenuItem(electronApp, '보기', '분할뷰')
    await page.waitForFunction(() => document.getElementById('scroll-area').classList.contains('split-mode'))
    await clickApplicationMenuItem(electronApp, '보기', '분할뷰')
    await page.waitForFunction(() => !document.getElementById('scroll-area').classList.contains('split-mode'))

    // data-theme can stay the same string across a toggle when 'auto' already
    // resolves to the system's current appearance, so assert on the theme label
    // (which always cycles auto → light → dark) instead of the resolved value.
    const themeLabelBefore = await page.evaluate(() => document.getElementById('btn-theme').title)
    await clickApplicationMenuItem(electronApp, '보기', '테마 전환')
    await page.waitForFunction(before => document.getElementById('btn-theme').title !== before, themeLabelBefore)

    await clickApplicationMenuItem(electronApp, '도움말', '단축키')
    await page.waitForFunction(() => document.getElementById('shortcuts-guide')?.classList.contains('show'))
    await page.locator('#shortcuts-guide .guide-close').click()
    await page.waitForFunction(() => !document.getElementById('shortcuts-guide')?.classList.contains('show'))
  } finally {
    await closeApp(electronApp)
  }
})

test('native menu switches tabs via next/prev commands', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await emitFileOpened(electronApp, { content: '# A\n', filename: 'a.md', path: '/tmp/mdv-menu-a.md' })
    await page.waitForFunction(() => document.title === 'a')
    await emitFileOpened(electronApp, { content: '# B\n', filename: 'b.md', path: '/tmp/mdv-menu-b.md' })
    await page.waitForFunction(() => document.title === 'b')

    await clickApplicationMenuItem(electronApp, '보기', '이전 탭')
    await page.waitForFunction(() => document.title === 'a')

    await clickApplicationMenuItem(electronApp, '보기', '다음 탭')
    await page.waitForFunction(() => document.title === 'b')
  } finally {
    await closeApp(electronApp)
  }
})

test('newFile is owned exclusively by the menu accelerator, not a leftover renderer keydown handler', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')

    // The main-process menu accelerator (⌘T) reaches the renderer only through
    // this IPC command, never through the page's own keydown listener.
    await emitRendererCommand(electronApp, 'newFile')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 1)

    // A raw Cmd+T keydown must be a no-op now that the menu (src/main.js#buildMenu)
    // owns this accelerator -- if the renderer still had its own 't' handler, this
    // would create a second tab and the original bug (double-fire) would be back.
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', metaKey: true, bubbles: true, cancelable: true }))
    })
    await page.waitForTimeout(200)
    assert.equal(await page.locator('#tab-list .file-tab').count(), 1)
  } finally {
    await closeApp(electronApp)
  }
})

test('default app guide has dialog semantics, traps Tab focus, and restores focus on ESC', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    // A prior run (or a real OS default-handler check) may have already opened and dismissed
    // this guide in the shared profile; force it back to "eligible to show" before asserting.
    await page.evaluate(() => {
      localStorage.removeItem('mdv-default-app-guide-dismissed')
      localStorage.removeItem('mdv-default-app-guide-dismissed-v2')
    })

    assert.deepEqual(
      await page.locator('#default-app-guide').evaluate(el => ({
        role: el.getAttribute('role'),
        ariaModal: el.getAttribute('aria-modal'),
        labelledBy: el.getAttribute('aria-labelledby'),
        labelText: document.getElementById(el.getAttribute('aria-labelledby'))?.textContent,
      })),
      { role: 'dialog', ariaModal: 'true', labelledBy: 'default-app-guide-title', labelText: 'Markdown 기본 앱 등록' }
    )

    // The real status IPC round trip resolves before a test script can race it, so there's no
    // window to plant a "previously focused" element. Delay the response to open one deliberately.
    await stubDefaultAppStatusDelay(electronApp, 400)
    await page.reload()
    await page.waitForFunction(() => document.documentElement.dataset.rendererReady === 'true')
    await page.evaluate(() => document.getElementById('btn-theme').focus())
    await page.waitForFunction(() => document.getElementById('default-app-guide')?.classList.contains('show'))

    await page.waitForFunction(() => document.activeElement?.id === 'default-app-do-not-show')

    // Shift+Tab from the first focusable element must wrap to the last one, not escape the dialog.
    await page.keyboard.press('Shift+Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.closest('.guide-actions') !== null), true)

    // Tab from the last focusable element must wrap back to the first one.
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'default-app-do-not-show')

    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.getElementById('default-app-guide')?.classList.contains('show'))
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-theme', 'focus must return to the element focused before the modal opened')
  } finally {
    await closeApp(electronApp)
  }
})

test('welcome guide is a non-blocking dialog: no focus trap, and ESC closes it before the search bar', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    // A prior run may have already dismissed the welcome guide in this shared profile;
    // force it back to "eligible to show" and reload so this test is deterministic.
    await page.evaluate(() => {
      localStorage.removeItem('mdv-welcome-guide-dismissed')
      localStorage.removeItem('mdv-default-app-guide-dismissed')
      localStorage.removeItem('mdv-default-app-guide-dismissed-v2')
    })
    await page.reload()
    await page.waitForFunction(() => document.documentElement.dataset.rendererReady === 'true')

    assert.deepEqual(
      await page.locator('#welcome-guide').evaluate(el => ({
        role: el.getAttribute('role'),
        ariaModal: el.getAttribute('aria-modal'),
        labelledBy: el.getAttribute('aria-labelledby'),
      })),
      { role: 'dialog', ariaModal: null, labelledBy: 'welcome-guide-title' }
    )

    // The default app guide takes ESC priority; dismiss it first so welcome-guide is the top layer.
    await page.waitForFunction(() => document.getElementById('default-app-guide')?.classList.contains('show'))
    await page.click('#default-app-guide .guide-actions button')
    await page.waitForFunction(() => !document.getElementById('default-app-guide')?.classList.contains('show'))

    await page.waitForFunction(() => document.getElementById('welcome-guide')?.classList.contains('show'))

    // No focus trap: Shift+Tab from the first focusable element inside the card must escape it,
    // proving the card never intercepts Tab the way the blocking default-app-guide does.
    await page.evaluate(() => document.querySelector('#welcome-guide .guide-close').focus())
    await page.keyboard.press('Shift+Tab')
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('#welcome-guide'))), false)

    // ESC priority: guide closes before the search bar.
    await emitRendererCommand(electronApp, 'toggleSearch')
    await page.waitForSelector('#search-bar', { state: 'visible' })
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.getElementById('welcome-guide')?.classList.contains('show'))
    assert.equal(await page.locator('#search-bar').evaluate(el => el.style.display), 'flex', 'the guide should close first, leaving search open')

    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.getElementById('search-bar').style.display === 'none')
  } finally {
    await closeApp(electronApp)
  }
})

test('clicking a local markdown link opens the target as a new tab', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-links-'))
  const sourcePath = path.join(tempDir, 'source.md')
  const relTargetPath = path.join(tempDir, 'target-rel.md')
  const absTargetPath = path.join(tempDir, 'target-abs.md')
  await fs.writeFile(relTargetPath, '# Relative Target\n\nOpened via relative link.\n', 'utf-8')
  await fs.writeFile(absTargetPath, '# Absolute Target\n\nOpened via absolute link.\n', 'utf-8')
  await fs.writeFile(
    sourcePath,
    `# Source Doc\n\n[open relative](./target-rel.md)\n\n[open absolute](${absTargetPath})\n`,
    'utf-8',
  )

  const { electronApp, page } = await launchApp()
  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [sourcePath])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'source')

    // Relative link resolves against the active tab's directory and opens a new tab.
    await page.locator('#content a', { hasText: 'open relative' }).click()
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return document.querySelectorAll('#tab-list .file-tab').length === 2 && active && active.textContent.includes('target-rel.md')
    })
    assert.match(await page.textContent('#content'), /Opened via relative link\./)

    // Back on the source tab, an absolute-path link opens its target too.
    await page.locator('#tab-list .file-tab', { hasText: 'source.md' }).click()
    await page.waitForFunction(() => document.title === 'source')
    await page.locator('#content a', { hasText: 'open absolute' }).click()
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return document.querySelectorAll('#tab-list .file-tab').length === 3 && active && active.textContent.includes('target-abs.md')
    })
    assert.match(await page.textContent('#content'), /Opened via absolute link\./)
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test('clicking a link to a missing local file shows a not-found error, not "not allowed"', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-links-'))
  const sourcePath = path.join(tempDir, 'source.md')
  await fs.writeFile(sourcePath, '# Source Doc\n\n[open missing](./does-not-exist.md)\n', 'utf-8')

  const { electronApp, page } = await launchApp()
  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [sourcePath])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'source')

    let dialogMessage = null
    page.on('dialog', async dialog => {
      dialogMessage = dialog.message()
      await dialog.dismiss()
    })

    await page.locator('#content a', { hasText: 'open missing' }).click()
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 1)

    assert.ok(dialogMessage, 'a link-failure alert should have been shown')
    assert.match(dialogMessage, /파일을 찾을 수 없습니다/)
    assert.doesNotMatch(dialogMessage, /허용되지 않은 링크입니다/)
    // No tab was opened for the missing target.
    assert.equal(await page.locator('#tab-list .file-tab').count(), 1)
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test('clicking an https link still opens externally without opening a tab', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-links-'))
  const sourcePath = path.join(tempDir, 'source.md')
  await fs.writeFile(sourcePath, '# Source Doc\n\n[visit web](https://example.com/page)\n', 'utf-8')

  const { electronApp, page } = await launchApp()
  try {
    await page.waitForSelector('#empty')
    await stubOpenExternal(electronApp)
    await stubOpenDialog(electronApp, [sourcePath])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'source')

    await page.locator('#content a', { hasText: 'visit web' }).click()

    let calls = []
    const startedAt = Date.now()
    while (Date.now() - startedAt < 5000) {
      calls = await getOpenExternalCalls(electronApp)
      if (calls.length > 0) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.deepEqual(calls, ['https://example.com/page'])
    // The external link must not have spawned a document tab.
    assert.equal(await page.locator('#tab-list .file-tab').count(), 1)
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test('toast announces status changes to assistive tech', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    assert.deepEqual(
      await page.locator('#toast').evaluate(el => ({ role: el.getAttribute('role'), ariaLive: el.getAttribute('aria-live') })),
      { role: 'status', ariaLive: 'polite' }
    )
  } finally {
    await closeApp(electronApp)
  }
})

test('holding Cmd flags the body and reveals shortcut badges, clearing on keyup and window blur', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')

    // btn-search is visible + enabled in the empty state, so its ::after box renders.
    const badgeContent = () => page.evaluate(() => {
      const search = document.getElementById('btn-search')
      return getComputedStyle(search, '::after').content
    })
    const bodyHeld = () => page.evaluate(() => document.body.classList.contains('cmd-held'))

    // No badge before Cmd is held.
    assert.equal(await bodyHeld(), false)
    assert.equal(await badgeContent(), 'none')

    // keydown with metaKey true adds the class and surfaces the badge string.
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, bubbles: true }))
    })
    assert.equal(await bodyHeld(), true)
    assert.equal(await badgeContent(), '"⌘F"')

    // keyup once Cmd is no longer held removes the class.
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', metaKey: false, bubbles: true }))
    })
    assert.equal(await bodyHeld(), false)
    assert.equal(await badgeContent(), 'none')

    // Re-hold, then blur the window (Cmd+Tab away never delivers keyup) — must still clear.
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, bubbles: true }))
    })
    assert.equal(await bodyHeld(), true)
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    assert.equal(await bodyHeld(), false)
    assert.equal(await badgeContent(), 'none')
  } finally {
    await closeApp(electronApp)
  }
})

test('active tab scrolls into view when switched to a tab off-screen in #tab-list', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')

    // Enough untitled tabs to overflow #tab-list's fixed-width scroll container.
    const TAB_COUNT = 15
    for (let i = 0; i < TAB_COUNT; i++) {
      await clickApplicationMenuItem(electronApp, '파일', '새 파일')
    }
    await page.waitForFunction(count => document.querySelectorAll('#tab-list .file-tab').length === count, TAB_COUNT)

    const isFirstTabOutOfView = () => page.evaluate(() => {
      const list = document.getElementById('tab-list')
      const first = list.querySelector('.file-tab')
      const listRect = list.getBoundingClientRect()
      const tabRect = first.getBoundingClientRect()
      return tabRect.left < listRect.left || tabRect.right > listRect.right
    })
    assert.equal(await isFirstTabOutOfView(), true, 'expected tabs to overflow #tab-list for this test to be meaningful')

    // Walk back to the first (now off-screen) tab via the same command path the
    // ⌘⇧[ accelerator drives (src/main.js#buildMenu -> switchToPrevTab).
    for (let i = 0; i < TAB_COUNT - 1; i++) {
      await emitRendererCommand(electronApp, 'switchToPrevTab')
    }
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return active && active.textContent.includes('untitled.md') && !active.textContent.includes('untitled-')
    })

    const isActiveTabVisible = await page.evaluate(() => {
      const list = document.getElementById('tab-list')
      const active = list.querySelector('.file-tab.active')
      const listRect = list.getBoundingClientRect()
      const tabRect = active.getBoundingClientRect()
      return tabRect.left >= listRect.left - 1 && tabRect.right <= listRect.right + 1
    })
    assert.equal(isActiveTabVisible, true)
  } finally {
    await closeApp(electronApp)
  }
})

test('clicking an already-visible tab does not scroll #tab-list', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await clickApplicationMenuItem(electronApp, '파일', '새 파일')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 1)
    await clickApplicationMenuItem(electronApp, '파일', '새 파일')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 2)

    const scrollLeftBefore = await page.evaluate(() => document.getElementById('tab-list').scrollLeft)
    await page.locator('#tab-list .file-tab').first().click()
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return active && active.textContent.includes('untitled.md') && !active.textContent.includes('untitled-')
    })
    const scrollLeftAfter = await page.evaluate(() => document.getElementById('tab-list').scrollLeft)
    assert.equal(scrollLeftAfter, scrollLeftBefore)
  } finally {
    await closeApp(electronApp)
  }
})

// Presses Tab (up to `max` times) until the focused element matches `selector`,
// proving the widget is reachable by keyboard without assuming toolbar tab order.
async function tabUntilFocused(page, selector, max = 60) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur())
  for (let i = 0; i < max; i++) {
    if (await page.evaluate(sel => Boolean(document.activeElement?.matches(sel)), selector)) return true
    await page.keyboard.press('Tab')
  }
  return page.evaluate(sel => Boolean(document.activeElement?.matches(sel)), selector)
}

test('keyboard: Tab reaches the tab bar, arrows move focus only, Enter switches (manual activation)', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 1)

    await stubOpenDialog(electronApp, [ROOT_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return document.querySelectorAll('#tab-list .file-tab').length === 2 && active && active.textContent.includes('root.md')
    })

    // Keep the blocking default-app guide from trapping focus during the Tab walk.
    await emitRendererCommand(electronApp, 'dismissDefaultAppGuide')

    const reached = await tabUntilFocused(page, '#tab-list .file-tab')
    assert.equal(reached, true, 'Tab should land inside the tablist')

    // Tab lands on the roving (active) tab. Record the pre-arrow state.
    const before = await page.evaluate(() => ({
      title: document.title,
      active: document.querySelector('#tab-list .file-tab.active')?.getAttribute('aria-label'),
      focused: document.activeElement?.getAttribute('aria-label'),
    }))
    assert.equal(before.focused, 'root.md')

    // ArrowLeft: focus moves to the other tab, but nothing is activated.
    await page.keyboard.press('ArrowLeft')
    const afterArrow = await page.evaluate(() => ({
      title: document.title,
      active: document.querySelector('#tab-list .file-tab.active')?.getAttribute('aria-label'),
      selectedTrue: document.querySelector('#tab-list [aria-selected="true"]')?.getAttribute('aria-label'),
      focused: document.activeElement?.getAttribute('aria-label'),
    }))
    assert.equal(afterArrow.title, before.title, 'arrow move must not switch the active document')
    assert.equal(afterArrow.active, before.active, 'active tab must be unchanged by arrow move')
    assert.equal(afterArrow.selectedTrue, before.active, 'aria-selected must not follow focus')
    assert.equal(afterArrow.focused, 'basic.md', 'focus should have moved to the other tab')

    // Enter activates the focused tab.
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return document.title === 'basic' && active && active.textContent.includes('basic.md')
    })
  } finally {
    await closeApp(electronApp)
  }
})

test('keyboard: explorer tree is navigable and opens files without a mouse', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [EXPLORER_DIR])
    await emitRendererCommand(electronApp, 'openFolder')
    await page.waitForFunction(() => document.getElementById('explorer-tree').textContent.includes('root.md'))
    await emitRendererCommand(electronApp, 'dismissDefaultAppGuide')

    // Roving tabindex: exactly one visible row is Tab-reachable.
    assert.equal(await page.locator('#explorer-tree .tree-row[tabindex="0"]').count(), 1)

    const reached = await tabUntilFocused(page, '#explorer-tree .tree-row')
    assert.equal(reached, true, 'Tab should land inside the tree')

    // ArrowDown moves focus to another visible row.
    const firstText = await page.evaluate(() => document.activeElement?.textContent)
    await page.keyboard.press('ArrowDown')
    const secondText = await page.evaluate(() => document.activeElement?.textContent)
    assert.notEqual(secondText, firstText, 'ArrowDown should move focus to a different row')
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.matches('.tree-row'))), true)

    // ArrowRight on the nested folder expands it and moves focus into the first child.
    await page.locator('#explorer-tree .tree-row').filter({ hasText: 'nested' }).evaluate(el => el.focus())
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(() => {
      const focused = document.activeElement
      return document.getElementById('explorer-tree').textContent.includes('child.md')
        && focused && focused.matches('.tree-row') && focused.textContent.includes('child.md')
    })

    // Enter on the focused file row opens it.
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return document.title === 'child' && active && active.textContent.includes('child.md')
    })
  } finally {
    await closeApp(electronApp)
  }
})

test('mouse: tab and explorer click paths still work after the keyboard refactor', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')

    // Tabs: clicking a background tab still switches to it.
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 1)
    await stubOpenDialog(electronApp, [ROOT_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 2)

    await page.locator('#tab-list .file-tab').filter({ hasText: 'basic.md' }).click()
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return document.title === 'basic' && active && active.textContent.includes('basic.md')
    })

    // Explorer: clicking a folder expands it and clicking a file opens it.
    await stubOpenDialog(electronApp, [EXPLORER_DIR])
    await emitRendererCommand(electronApp, 'openFolder')
    await page.waitForFunction(() => document.getElementById('explorer-tree').textContent.includes('root.md'))

    await page.locator('#explorer-tree .tree-row').filter({ hasText: 'nested' }).click()
    await page.waitForFunction(() => document.getElementById('explorer-tree').textContent.includes('child.md'))

    await page.locator('#explorer-tree .tree-row').filter({ hasText: 'child.md' }).click()
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return document.title === 'child' && active && active.textContent.includes('child.md')
    })
  } finally {
    await closeApp(electronApp)
  }
})
