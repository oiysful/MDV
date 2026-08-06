const test = require('node:test')
const assert = require('node:assert/strict')

const { launchApp, closeApp, stubCloseDialog, getCloseDialogCalls } = require('./helpers/launch')
const {
  BASIC_MD, ROOT_MD, EXPLORER_DIR,
  stubOpenDialog, stubSaveDialog, createTempMarkdown,
  emitFileOpened, emitRendererCommand, clickApplicationMenuItem,
  stubOpenExternal, getOpenExternalCalls,
} = require('./helpers/smoke-helpers')

// Overrides the real (OS-dependent) default-app-status IPC handler with a fixed, delayed
// response, so a test can focus something before the guide claims focus during page load.
async function stubDefaultAppStatusDelay(electronApp, delayMs) {
  await electronApp.evaluate(async ({ ipcMain }, ms) => {
    ipcMain.removeHandler('get-markdown-default-app-status')
    ipcMain.handle('get-markdown-default-app-status', async () => {
      await new Promise(resolve => setTimeout(resolve, ms))
      return { ok: true, registered: false, needsAction: true, appPath: '/Applications/MDV.app', defaultHandlers: [] }
    })
  }, delayMs)
}

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
