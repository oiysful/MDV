const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

const { launchApp, closeApp, stubCloseDialog, getCloseDialogCalls } = require('./helpers/launch')
const {
  BASIC_MD, ROOT_MD, EXPLORER_DIR,
  stubOpenDialog, stubSaveDialog, createTempMarkdown,
  emitFileOpened, emitRendererCommand, clickApplicationMenuItem,
  stubOpenExternal, getOpenExternalCalls,
} = require('./helpers/smoke-helpers')

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

// Regression: document-flow.js's syncTabContentForSave calls setMarkdown() on every save while
// in source mode, to keep the save-conflict check accurate. toggleSource() used to skip its own
// render when `editorValue === getMarkdown()` -- a save immediately before leaving source mode
// already made those equal, so the preview kept showing pre-save content until the tab was
// closed and reopened. toggleSource now always renders on that transition (matching
// toggleSplitView's already-unconditional equivalent).
test('saving in source mode and returning to preview shows the saved content immediately', async () => {
  const { path: tempMarkdown, cleanup } = await createTempMarkdown(BASIC_MD, 'save-then-preview.md')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [tempMarkdown])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'save-then-preview')

    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => document.getElementById('source-view').style.display === 'block')

    await page.locator('#source-editor').fill('# Smoke Fixture\n\nSaved then previewed without reopening.\n')
    await page.waitForFunction(() => {
      const saveButton = document.getElementById('btn-save')
      return saveButton && !saveButton.disabled
    })

    await emitRendererCommand(electronApp, 'saveFile')
    await page.waitForFunction(() => document.getElementById('btn-save')?.disabled === true)

    // Leaving source mode right after the save -- the exact sequence that used to skip the
    // render because saveFile()'s setMarkdown() already made editorValue === getMarkdown().
    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => document.getElementById('content').style.display === '')

    const previewText = await page.textContent('#content')
    assert.match(previewText, /Saved then previewed without reopening\./)
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

// Wrap only affects #source-editor's CSS (editor.js's wrap-mode class), so it has no visible
// effect in plain preview -- the toolbar button used to stay enabled there anyway, which let
// a click silently toggle a mode with nothing to show for it until the user switched to
// source/split view themselves.
test('wrap button is only available in source/split mode, not in plain preview', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    const inPreview = await page.evaluate(() => {
      const btn = document.getElementById('btn-wrap')
      return { display: btn.style.display, disabled: btn.disabled }
    })
    assert.equal(inPreview.display, 'none')
    assert.equal(inPreview.disabled, true)

    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => document.getElementById('source-view').style.display === 'block')
    const inSource = await page.evaluate(() => {
      const btn = document.getElementById('btn-wrap')
      return { display: btn.style.display, disabled: btn.disabled }
    })
    assert.notEqual(inSource.display, 'none')
    assert.equal(inSource.disabled, false)

    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => document.getElementById('source-view').style.display === 'none')
    const backInPreview = await page.evaluate(() => document.getElementById('btn-wrap').style.display)
    assert.equal(backInPreview, 'none')
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
