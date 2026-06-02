const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { ROOT, launchApp } = require('./helpers/launch')

const BASIC_MD = path.join(ROOT, 'tests/fixtures/basic.md')
const EXPLORER_DIR = path.join(ROOT, 'tests/fixtures/explorer')
const ROOT_MD = path.join(ROOT, 'tests/fixtures/explorer/root.md')

const REQUIRED_GLOBALS = [
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
]

async function stubOpenDialog(electronApp, filePaths) {
  await electronApp.evaluate(({ dialog }, result) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: result.filePaths,
    })
  }, { filePaths })
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

test('app boots into empty state with expected globals', async () => {
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
    }, REQUIRED_GLOBALS)

    for (const name of REQUIRED_GLOBALS) {
      assert.equal(globals[name], true, `${name} should be exposed on window`)
    }

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
    await page.evaluate(() => openFile())

    await page.waitForFunction(() => document.title === 'basic')
    assert.equal(await page.title(), 'basic')

    const heading = await page.textContent('#content h1')
    assert.match(heading, /Smoke Fixture/)

    const tabText = await page.textContent('#tab-list .file-tab.active .file-tab-name')
    assert.match(tabText, /basic\.md/)

    const codeBlockCount = await page.locator('#content code.hljs').count()
    assert.ok(codeBlockCount > 0)
  } finally {
    await electronApp.close()
  }
})

test('opening the same file twice reuses the existing tab', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])

    await page.evaluate(() => openFile())
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 1)

    await page.evaluate(() => openFile())
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
    await page.evaluate(() => openFile())

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
    await page.evaluate(() => openFile())
    await page.waitForFunction(() => document.title === 'dirty-save')

    await page.evaluate(() => toggleSource())
    await page.waitForFunction(() => document.getElementById('source-view').style.display === 'block')

    const editor = page.locator('#source-editor')
    await editor.fill('# Smoke Fixture\n\nThis file verifies markdown rendering and tab creation.\n\n```js\nconsole.log(\'smoke\')\n```\n\nExtra line for save coverage.\n')

    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      const saveButton = document.getElementById('btn-save')
      return active && active.textContent.trim().startsWith('●') && saveButton && !saveButton.disabled
    })

    await page.evaluate(() => saveFile())
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

test('toggleSource switches between preview and editor and re-renders preview on return', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await page.evaluate(() => openFile())
    await page.waitForFunction(() => document.title === 'basic')

    await page.evaluate(() => toggleSource())
    await page.waitForFunction(() => {
      const content = document.getElementById('content')
      const sourceView = document.getElementById('source-view')
      const scrollArea = document.getElementById('scroll-area')
      return content.style.display === 'none' && sourceView.style.display === 'block' && scrollArea.classList.contains('source-mode')
    })

    await page.locator('#source-editor').fill('# Updated From Source\n\nChanged in editor mode.\n')

    await page.evaluate(() => toggleSource())
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
    await page.evaluate(() => openFile())
    await page.waitForFunction(() => document.title === 'watched-source')

    await page.evaluate(() => toggleSource())
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

test('tab labels render filenames as text instead of HTML', async () => {
  const maliciousName = '<img src=x onerror="window.__mdvInjected=true">.md'
  const { path: tempMarkdown, cleanup } = await createTempMarkdown(BASIC_MD, maliciousName)
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [tempMarkdown])
    await page.evaluate(() => openFile())

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
    await page.evaluate(() => openFolder())

    await page.waitForFunction(() => {
      const label = document.getElementById('explorer-root-path')
      return Boolean(label && label.textContent && label.textContent.includes('explorer'))
    })

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

    await page.evaluate(() => clearExplorerRoot())
    await page.waitForFunction(() => {
      const tree = document.getElementById('explorer-tree')
      const label = document.getElementById('explorer-root-path')
      return tree.textContent.includes('폴더를 열어 탐색하세요') && label.textContent.includes('폴더를 선택하세요')
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
      toggleTheme()
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
      toggleTheme()
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
      toggleTheme()
      return {
        theme: localStorage.getItem('theme'),
      }
    })
    assert.equal(afterAuto.theme, 'auto')
  } finally {
    await electronApp.close()
  }
})
