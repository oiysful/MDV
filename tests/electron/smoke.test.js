const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { ROOT, launchApp } = require('./helpers/launch')

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
  'toggleSearch',
  'copyAll',
  'printDoc',
  'toggleTheme',
  'toggleAddMenu',
  'hideAddMenu',
  'dismissWelcomeGuide',
  'openFromGuide',
  'searchPrev',
  'searchNext',
  'closeSearch',
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

async function stubSaveDialog(electronApp, filePath) {
  await electronApp.evaluate(({ dialog }, result) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: result.filePath,
    })
  }, { filePath })
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

    const globals = await page.evaluate(names => {
      return Object.fromEntries(names.map(name => {
        return [name, typeof window[name] === 'function']
      }))
    }, REMOVED_GLOBALS)

    for (const name of REMOVED_GLOBALS) {
      assert.equal(globals[name], false, `${name} should not be exposed on window`)
    }

    assert.equal(await page.locator('[onclick], [ondragover], [ondragleave], [ondrop], [data-action]').count(), 0)

    const depsReady = await page.evaluate(() => ({
      marked: Boolean(window.marked),
      hljs: Boolean(window.hljs),
    }))

    assert.equal(depsReady.marked, true)
    assert.equal(depsReady.hljs, true)
    assert.deepEqual(pageErrors, [])
  } finally {
    await electronApp.close()
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
    await copyButton.click()
    await page.waitForFunction(() => document.querySelector('#content .copy-btn')?.classList.contains('copied'))
  } finally {
    await electronApp.close()
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
    await electronApp.close()
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
    await electronApp.close()
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
    await electronApp.close()
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
    await electronApp.close()
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
    await electronApp.close()
    await cleanup()
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
    await electronApp.close()
  }
})

test('external file changes update the active source editor and clear dirty state', async () => {
  const { path: tempMarkdown, cleanup } = await createTempMarkdown(BASIC_MD, 'watched-source.md')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [tempMarkdown])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'watched-source')

    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => document.getElementById('source-view').style.display === 'block')

    await page.locator('#source-editor').fill('# Local edit\n')
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return Boolean(active && active.textContent.includes('●'))
    })

    const changedContent = '# External update\n\nWatcher payload replaced the source.\n'
    await fs.writeFile(tempMarkdown, changedContent, 'utf8')
    await emitFileChanged(electronApp, { path: tempMarkdown, content: changedContent })

    await page.waitForFunction(expected => {
      const editor = document.getElementById('source-editor')
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      const saveButton = document.getElementById('btn-save')
      return editor.value === expected && active && !active.textContent.includes('●') && saveButton.disabled
    }, changedContent)

    assert.equal(await page.locator('#source-editor').inputValue(), changedContent)
  } finally {
    await electronApp.close()
    await cleanup()
  }
})

test('switching tabs rewires the watched file to the active tab path', async () => {
  const { path: firstPath, cleanup: cleanupFirst } = await createTempMarkdown(BASIC_MD, 'watch-one.md')
  const { path: secondPath, cleanup: cleanupSecond } = await createTempMarkdown(ROOT_MD, 'watch-two.md')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [firstPath, secondPath])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 2)
    await page.waitForFunction(() => document.title === 'watch-two')

    const secondContent = '# Watch Two Updated\n\nActive watcher should refresh this tab.\n'
    await fs.writeFile(secondPath, secondContent, 'utf8')
    await page.waitForFunction(expected => document.getElementById('content').textContent.includes(expected), 'Active watcher should refresh this tab.')

    await page.locator('#tab-list .file-tab').filter({ hasText: 'watch-one.md' }).click()
    await page.waitForFunction(() => document.title === 'watch-one')

    const firstContent = '# Watch One Updated\n\nWatcher switched with the active tab.\n'
    await fs.writeFile(firstPath, firstContent, 'utf8')
    await page.waitForFunction(expected => document.getElementById('content').textContent.includes(expected), 'Watcher switched with the active tab.')
  } finally {
    await electronApp.close()
    await cleanupFirst()
    await cleanupSecond()
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
    await electronApp.close()
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
    await electronApp.close()
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
    await electronApp.close()
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
    await electronApp.close()
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
    await electronApp.close()
  }
})
