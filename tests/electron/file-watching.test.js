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
} = require('./helpers/smoke-helpers')

async function emitFileChanged(electronApp, payload) {
  await electronApp.evaluate(async ({ BrowserWindow }, nextPayload) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.webContents.send('file-changed', nextPayload)
  }, payload)
}

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

test('switching between tabs that each embed a different image keeps every src a live data URL', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-image-multi-'))
  const colors = ['red', 'green', 'blue']
  const docPaths = []
  for (let i = 0; i < colors.length; i += 1) {
    const imgPath = path.join(tempDir, `pic-${i}.svg`)
    const docPath = path.join(tempDir, `multi-doc-${i}.md`)
    await fs.writeFile(imgPath, `<svg xmlns="http://www.w3.org/2000/svg" width="10"><rect fill="${colors[i]}"/></svg>`, 'utf8')
    await fs.writeFile(docPath, `# Multi Doc ${i}\n\n![pic](pic-${i}.svg)\n`, 'utf8')
    docPaths.push(docPath)
  }
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, docPaths)
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 3)

    // Sweep across every tab twice: the first pass renders each; the second pass
    // exercises the snapshot rehydration path (renderedHTML now stores no base64).
    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i < colors.length; i += 1) {
        await page.locator('#tab-list .file-tab').filter({ hasText: `multi-doc-${i}.md` }).click()
        await page.waitForFunction(expected => document.title === expected, `multi-doc-${i}`)
        // The embedded image must resolve to a non-empty data URL every time —
        // no broken-image frame after a tab switch restores from the snapshot.
        await page.waitForFunction(() => {
          const img = document.querySelector('#content img')
          return Boolean(img && /^data:image\/svg\+xml;base64,.+/.test(img.src))
        })
      }
    }
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})
