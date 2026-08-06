const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')

const { launchApp, closeApp, stubCloseDialog, getCloseDialogCalls } = require('./helpers/launch')
const {
  BASIC_MD, ROOT_MD, EXPLORER_DIR,
  stubOpenDialog, stubSaveDialog, createTempMarkdown,
  emitFileOpened, emitRendererCommand, clickApplicationMenuItem,
  stubOpenExternal, getOpenExternalCalls,
} = require('./helpers/smoke-helpers')

// Entering (and, on restore, leaving) split view force-closes/reopens #sidebar, whose width
// transition (index.html, .25s) keeps reflowing #scroll-area's available width for the whole
// span -- arm a transitionend watch before the toggle and wait for it before reading any
// geometry, the same way tests/electron/smoke.test.js's TOC-scrollspy test does, so pane-width
// assertions aren't racing a still-animating sidebar.
async function armSidebarTransitionWatch(page) {
  await page.evaluate(() => {
    window.__mdvSidebarTransitionDone = false
    const sidebar = document.getElementById('sidebar')
    const onEnd = event => {
      if (event.propertyName !== 'width') return
      sidebar.removeEventListener('transitionend', onEnd)
      window.__mdvSidebarTransitionDone = true
    }
    sidebar.addEventListener('transitionend', onEnd)
  })
}

async function waitForSidebarTransition(page) {
  await page.waitForFunction(() => window.__mdvSidebarTransitionDone === true)
}

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

// Toggling split view twice within #sidebar's .25s width transition (index.html) supersedes
// the running transition -- Chromium fires transitioncancel for it, not transitionend. The
// listener setSplitMode (editor.js) attaches to recompute TOC offsets once the transition
// settles must detach on transitioncancel too. Note on what this test can and can't catch: a
// stale listener here is redundant, not unbounded -- every pending listener still matches the
// *next* completed transition's transitionend and removes itself there, so this test (which
// checks final state and absence of thrown errors, not an exact recompute count) cannot
// distinguish the fixed code from the pre-fix one. It's kept as a basic stability check under
// rapid, adversarial input; the leak fix itself is pinned by code review, not by this test.
test('rapid split-view toggling settles into a consistent state without throwing', async () => {
  const { electronApp, page } = await launchApp()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(String(error)))

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    for (let i = 0; i < 6; i++) {
      await emitRendererCommand(electronApp, 'toggleSplitView')
      await page.waitForTimeout(30) // well inside the .25s sidebar transition
    }

    // Let whichever transition is still running settle, then confirm the app landed in a
    // consistent final state rather than something corrupted by overlapping listeners.
    await page.waitForTimeout(400)
    const finalState = await page.evaluate(() => ({
      splitMode: document.getElementById('scroll-area').classList.contains('split-mode'),
      sidebarClosed: document.getElementById('sidebar').classList.contains('closed'),
    }))
    assert.equal(finalState.splitMode, false, '6 toggles (even count) should land back in normal mode')
    assert.equal(finalState.sidebarClosed, false, 'the sidebar should be restored, not left forced-closed')
    assert.deepEqual(pageErrors, [], 'no renderer error should surface from a leaked/stale listener')
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

test('dragging the split-view divider resizes both panes and clamps at their minimum widths', async () => {
  const { path: tempMarkdown, cleanup } = await createTempMarkdown(BASIC_MD, 'split-divider.md')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [tempMarkdown])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'split-divider')

    // The default-app guide is a full-viewport overlay above #scroll-area; left open, it
    // eats the real OS-level mouse events this test sends to the divider (elementFromPoint
    // resolves inside the guide, not the divider), while the app never sees a mousedown at
    // all -- so the drag silently does nothing. Same pattern as the search test above.
    await page.evaluate(() => document.getElementById('default-app-guide')?.classList.remove('show'))

    await armSidebarTransitionWatch(page)
    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => document.getElementById('scroll-area').classList.contains('split-mode'))
    await waitForSidebarTransition(page)

    const scrollAreaBox = await page.locator('#scroll-area').boundingBox()
    const initialWidths = await page.evaluate(() => ({
      sourceView: document.getElementById('source-view').getBoundingClientRect().width,
      content: document.getElementById('content').getBoundingClientRect().width,
    }))

    // Drag the divider well to the right of its starting (roughly centered) position.
    const dividerBox = await page.locator('#split-divider').boundingBox()
    const dividerY = dividerBox.y + dividerBox.height / 2
    await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerY)
    await page.mouse.down()
    await page.mouse.move(scrollAreaBox.x + scrollAreaBox.width * 0.7, dividerY)
    await page.mouse.up()

    const widthsAfterDrag = await page.evaluate(() => ({
      sourceView: document.getElementById('source-view').getBoundingClientRect().width,
      content: document.getElementById('content').getBoundingClientRect().width,
    }))
    assert.ok(widthsAfterDrag.sourceView > initialWidths.sourceView + 100, `left pane should have grown, got ${widthsAfterDrag.sourceView} vs initial ${initialWidths.sourceView}`)
    assert.ok(widthsAfterDrag.content < initialWidths.content - 100, `right pane should have shrunk, got ${widthsAfterDrag.content} vs initial ${initialWidths.content}`)
    assert.ok(widthsAfterDrag.content >= 320, `right pane must never go below its 320px minimum, got ${widthsAfterDrag.content}`)

    // Drag far past the left edge -- the left pane must clamp at 300px, not collapse further.
    const dividerBoxAfterDrag = await page.locator('#split-divider').boundingBox()
    const dividerYAfterDrag = dividerBoxAfterDrag.y + dividerBoxAfterDrag.height / 2
    await page.mouse.move(dividerBoxAfterDrag.x + dividerBoxAfterDrag.width / 2, dividerYAfterDrag)
    await page.mouse.down()
    await page.mouse.move(scrollAreaBox.x - 500, dividerYAfterDrag)
    await page.mouse.up()

    const widthAtMin = await page.evaluate(() => document.getElementById('source-view').getBoundingClientRect().width)
    assert.ok(widthAtMin >= 299 && widthAtMin <= 301, `left pane must clamp at its 300px minimum instead of collapsing, got ${widthAtMin}`)

    // Leaving and re-entering split mode must reset the drag-set width back to the
    // roughly-even CSS default rather than remembering the last drag.
    //
    // The exit toggle also reopens the sidebar (it was forced closed on entry), which is its
    // own .25s width transition -- without waiting for it here, the immediate re-entry below
    // interrupts it mid-flight (a 'transitioncancel', not 'transitionend', for that transition)
    // and the re-arm+re-entry race the still-settling layout, so the second wait's
    // 'transitionend' listener can end up registered after the one legitimate event already
    // fired. Same guard the entry above already needed, just missing here.
    await armSidebarTransitionWatch(page)
    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => !document.getElementById('scroll-area').classList.contains('split-mode'))
    await waitForSidebarTransition(page)

    // Direct check of the setSplitMode(false) reset mechanism (editor.js), not just its
    // visual effect below -- exercises the exact requirement (clear the drag-set inline style).
    const inlineColumnsAfterExit = await page.evaluate(() => document.getElementById('scroll-area').style.gridTemplateColumns)
    assert.equal(inlineColumnsAfterExit, '', 'leaving split mode must clear the drag-set inline grid-template-columns')

    await armSidebarTransitionWatch(page)
    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => document.getElementById('scroll-area').classList.contains('split-mode'))
    await waitForSidebarTransition(page)

    const widthsAfterReopen = await page.evaluate(() => ({
      sourceView: document.getElementById('source-view').getBoundingClientRect().width,
      content: document.getElementById('content').getBoundingClientRect().width,
    }))
    assert.ok(Math.abs(widthsAfterReopen.sourceView - widthsAfterReopen.content) < 20, `reopening split view should reset to a roughly even split, got ${JSON.stringify(widthsAfterReopen)}`)
  } finally {
    await closeApp(electronApp)
    await cleanup()
  }
})
