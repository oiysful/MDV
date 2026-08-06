const test = require('node:test')
const assert = require('node:assert/strict')

const { launchApp, closeApp, stubCloseDialog, getCloseDialogCalls } = require('./helpers/launch')
const {
  BASIC_MD, ROOT_MD, EXPLORER_DIR,
  stubOpenDialog, stubSaveDialog, createTempMarkdown,
  emitFileOpened, emitRendererCommand, clickApplicationMenuItem,
  stubOpenExternal, getOpenExternalCalls,
} = require('./helpers/smoke-helpers')

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

// Code-review follow-up on docs/plans/done/2026-07-30/02-toc-scrollspy-offset-bias.md: #content became its
// own independent scroll container in split view, so hideAppContextMenu -- previously wired
// to #scroll-area's scroll event only -- needs the same binding on #content, or an open
// context menu stays put while the preview pane scrolls underneath it.
test('scrolling the split-view preview pane dismisses an open context menu', async () => {
  const { electronApp, page } = await launchApp()
  const longBody = Array.from({ length: 80 }, (_, i) => `## Section ${i + 1}\n\nParagraph text for scroll height.`).join('\n\n')

  try {
    await page.waitForSelector('#empty')
    await emitFileOpened(electronApp, { content: `# Doc\n\n${longBody}\n`, filename: 'ctx-split.md', path: '/tmp/mdv-ctx-split.md' })
    await page.waitForFunction(() => document.title === 'ctx-split')

    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => document.getElementById('scroll-area').classList.contains('split-mode'))

    await page.locator('#tab-list .file-tab.active').click({ button: 'right' })
    await page.waitForFunction(() => {
      const menu = document.getElementById('app-context-menu')
      return menu && menu.style.display === 'block'
    })

    await page.evaluate(() => { document.getElementById('content').scrollTop = 400 })
    await page.waitForFunction(() => document.getElementById('app-context-menu').style.display !== 'block')
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
