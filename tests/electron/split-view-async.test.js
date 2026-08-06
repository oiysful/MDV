const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { launchApp, closeApp, stubCloseDialog, getCloseDialogCalls } = require('./helpers/launch')
const {
  BASIC_MD, ROOT_MD, EXPLORER_DIR,
  stubOpenDialog, stubSaveDialog, createTempMarkdown,
  emitFileOpened, emitRendererCommand, clickApplicationMenuItem,
  stubOpenExternal, getOpenExternalCalls,
  armSidebarTransitionWatch, waitForSidebarTransition,
} = require('./helpers/smoke-helpers')

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
    await armSidebarTransitionWatch(page)
    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => document.getElementById('scroll-area').classList.contains('split-mode'))
    await waitForSidebarTransition(page)

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
