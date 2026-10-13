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
  writeTocDoc, waitFrames,
} = require('./helpers/smoke-helpers')

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

// What this test pins, stated first because the background below used to bury it: after six
// toggles fired inside #sidebar's .25s width transition (index.html), the app lands in the
// state the toggle count implies -- even count, so back to normal mode with the sidebar
// restored, not left forced-closed -- and no renderer error surfaces along the way. Rapid
// adversarial toggling is where overlapping async work corrupts state, and nothing else in
// the suite drives that.
//
// Historical background, so nobody re-derives it: this test was written alongside the
// transitioncancel fix in editor.js's setSplitMode. Toggling twice mid-transition supersedes
// the running one, so Chromium fires transitioncancel rather than transitionend, and the
// TOC-offset listener has to detach on both. **This test does not pin that fix** -- a stale
// listener there is redundant rather than unbounded (it still matches the next completed
// transition and removes itself), and editor.js's own comment calls the consequence
// "harmless-but-wasteful" no-ops. Pinning it would take a recompute-count assertion, which
// means instrumenting a controller app.js never exposes to the page (it is a module-scope
// const) -- a fragile coupling to buy coverage of a performance triviality. Counting
// addEventListener/removeEventListener calls instead does not work either: setSplitMode's
// cancelPendingSidebarTransitionListener removes both event types unconditionally, so
// suppressing the transitioncancel registration yields *more* removes than adds, which is an
// artifact of the instrumentation and not a leak signature. The fix stays pinned by code
// review, which is where editor.js says it is pinned.
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

// Reading position across split view, the way Cmd+U already keeps it (plan 28 step 3). The
// position is read off the layout, not the TOC highlight: which section sits at the top of a
// scroll container, by the TOC's own rule (heading top - 24 <= scrollTop, tops measured from
// #scroll-area's offsetTop, which is also #content's own scroll frame in split view).
async function sectionAtTop(page, containerId) {
  return page.evaluate(id => {
    const scrollArea = document.getElementById('scroll-area')
    const container = document.getElementById(id)
    let section = null
    for (const heading of document.querySelectorAll('#content h1,#content h2,#content h3')) {
      if (heading.offsetTop - scrollArea.offsetTop - 24 <= container.scrollTop) section = `#${heading.id}`
    }
    return { section, scrollTop: container.scrollTop }
  }, containerId)
}

// Parks a scroll container halfway between heading `index` and the next one, far from both
// boundaries -- #scroll-area in preview, #content for split view's preview pane.
async function parkPane(page, containerId, index) {
  await page.evaluate(({ id, i }) => {
    const scrollArea = document.getElementById('scroll-area')
    const headings = document.querySelectorAll('#content h1,#content h2,#content h3')
    const top = heading => heading.offsetTop - scrollArea.offsetTop
    document.getElementById(id).scrollTop = (top(headings[i]) + top(headings[i + 1])) / 2
  }, { id: containerId, i: index })
  await waitFrames(page)
}

async function openSectionDoc(electronApp, page, tempDir, name) {
  const { docPath } = await writeTocDoc(tempDir, name, 'Split Position Doc')
  await page.waitForSelector('#empty')
  await stubOpenDialog(electronApp, [docPath])
  await emitRendererCommand(electronApp, 'openFile')
  await page.waitForFunction(expected => document.title === expected, name)
}

async function enterSplitView(electronApp, page, { sidebarMoves = true } = {}) {
  if (sidebarMoves) await armSidebarTransitionWatch(page)
  await emitRendererCommand(electronApp, 'toggleSplitView')
  await page.waitForFunction(() => document.getElementById('scroll-area').classList.contains('split-mode'))
  if (sidebarMoves) await waitForSidebarTransition(page)
  await waitFrames(page)
}

test('entering split view keeps the reading position in the preview pane', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-split-enter-'))
  const { electronApp, page } = await launchApp()
  try {
    await openSectionDoc(electronApp, page, tempDir, 'split-enter')
    await parkPane(page, 'scroll-area', 6) // Section 6
    await enterSplitView(electronApp, page)

    const pane = await sectionAtTop(page, 'content')
    assert.equal(pane.section, '#section-6', JSON.stringify(pane))
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

// Parked in Section 6 before entering and moved to Section 9 inside split view, so restoring
// the pre-split scrollTop on exit would fail this: the position to keep is the preview pane's.
test('leaving split view keeps the preview pane\'s reading position', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-split-exit-'))
  const { electronApp, page } = await launchApp()
  try {
    await openSectionDoc(electronApp, page, tempDir, 'split-exit')
    await parkPane(page, 'scroll-area', 6) // Section 6
    await enterSplitView(electronApp, page)
    await parkPane(page, 'content', 9) // Section 9

    await armSidebarTransitionWatch(page)
    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => !document.getElementById('scroll-area').classList.contains('split-mode'))
    await waitForSidebarTransition(page)
    await waitFrames(page)

    const view = await sectionAtTop(page, 'scroll-area')
    assert.equal(view.section, '#section-9', JSON.stringify(view))
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

// No sidebar transition on either side here, so the position has to land on the first apply.
test('leaving split view with the sidebar already closed keeps the preview pane\'s reading position', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-split-exit-closed-'))
  const { electronApp, page } = await launchApp()
  try {
    await openSectionDoc(electronApp, page, tempDir, 'split-exit-closed')
    await armSidebarTransitionWatch(page)
    await emitRendererCommand(electronApp, 'toggleSidebar')
    await page.waitForFunction(() => document.getElementById('sidebar').classList.contains('closed'))
    await waitForSidebarTransition(page)
    await parkPane(page, 'scroll-area', 6) // Section 6
    await enterSplitView(electronApp, page, { sidebarMoves: false })
    await parkPane(page, 'content', 9) // Section 9

    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => !document.getElementById('scroll-area').classList.contains('split-mode'))
    await waitFrames(page)

    const view = await sectionAtTop(page, 'scroll-area')
    assert.equal(view.section, '#section-9', JSON.stringify(view))
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

// Cmd+U from split view goes to pure source mode, where #content is hidden -- the TOC highlight
// is then the source-line position (rebuildSourceModeToc), so that is what this reads. Not
// writeTocDoc's document: each of its paragraphs is one long source line, so unwrapped source is
// short and its maximum scroll stops with Section 6 at the top (CI, 2026-10-13, scrollTop 484).
// Short lines keep the source tall enough to bring Section 9 to the top.
test('leaving split view with Cmd+U keeps the preview pane\'s reading position in source mode', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-split-exit-source-'))
  const { electronApp, page } = await launchApp()
  try {
    const sections = Array.from({ length: 12 }, (_, i) => {
      const body = Array.from({ length: 20 }, (_, j) => `Line ${j + 1} of section ${i + 1}.`).join('\n\n')
      return `## Section ${i + 1}\n\n${body}`
    }).join('\n\n')
    const docPath = path.join(tempDir, 'split-exit-source.md')
    await fs.writeFile(docPath, `# Split Position Doc\n\n${sections}\n`, 'utf-8')
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [docPath])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'split-exit-source')
    await enterSplitView(electronApp, page)
    await parkPane(page, 'content', 9) // Section 9

    await armSidebarTransitionWatch(page)
    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => {
      const scrollArea = document.getElementById('scroll-area')
      return scrollArea.classList.contains('source-mode') && !scrollArea.classList.contains('split-mode')
    })
    await waitForSidebarTransition(page)
    await waitFrames(page)

    const state = await page.evaluate(() => {
      const scrollArea = document.getElementById('scroll-area')
      return {
        active: document.querySelector('#toc-list a.active')?.getAttribute('href') ?? null,
        scrollTop: scrollArea.scrollTop,
        maxScroll: scrollArea.scrollHeight - scrollArea.clientHeight,
      }
    })
    assert.equal(state.active, '#section-9', JSON.stringify(state))
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

// The position re-applied when the sidebar transition settles belongs to the tab and mode that
// started it. The path that can carry it elsewhere is a switch to a tab that is also in split
// view: setSplitMode(true) is then a no-op, so the settle listener from tab A's entry stays
// attached and fires on tab B. A switch to a preview tab can't: reopening the sidebar supersedes
// the closing transition, and its transitioncancel reaches the newly attached listener first,
// which detaches it (observed on CI 2026-10-13 -- three versions of that variant passed on
// unguarded code). The transition is stretched to 2s so the switch lands inside it.
test('switching to another split-view tab while the sidebar transition runs does not carry the old tab\'s reading position', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-split-tab-switch-'))
  const { electronApp, page } = await launchApp()
  const sidebarSettled = () => page.waitForFunction(() => document.getElementById('sidebar').getAnimations().length === 0)
  try {
    const first = await writeTocDoc(tempDir, 'split-tab-a', 'Split Tab A')
    const second = await writeTocDoc(tempDir, 'split-tab-b', 'Split Tab B')
    await page.waitForSelector('#empty')

    // Tab B: in split view, its preview pane at the top.
    await stubOpenDialog(electronApp, [second.docPath])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'split-tab-b')
    await enterSplitView(electronApp, page)

    // Tab A: a new tab opens in preview (the sidebar reopens), parked in Section 9.
    await stubOpenDialog(electronApp, [first.docPath])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'split-tab-a' && !document.getElementById('scroll-area').classList.contains('split-mode'))
    await sidebarSettled()
    await parkPane(page, 'scroll-area', 9)

    await page.addStyleTag({ content: '#sidebar { transition-duration: 2s !important; }' })
    const openWidth = await page.evaluate(() => document.getElementById('sidebar').getBoundingClientRect().width)
    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => document.getElementById('scroll-area').classList.contains('split-mode'))
    await page.waitForFunction(open => {
      const width = document.getElementById('sidebar').getBoundingClientRect().width
      return width < open - 20 && width > 20
    }, openWidth)

    // A DOM click, not locator.click(): the tab strip slides with the sidebar, and Playwright
    // waits for its target to hold still -- for the transition to end, which is too late.
    const widthAtSwitch = await page.evaluate(() => {
      const name = Array.from(document.querySelectorAll('#tab-list .file-tab-name')).find(node => node.textContent.includes('split-tab-b'))
      const width = document.getElementById('sidebar').getBoundingClientRect().width
      name.click()
      return width
    })
    await page.waitForFunction(() => document.title === 'split-tab-b')
    await sidebarSettled()
    await waitFrames(page)

    const pane = await sectionAtTop(page, 'content')
    assert.equal(pane.section, '#split-tab-b', JSON.stringify({ pane, openWidth, widthAtSwitch }))
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})
