const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { ROOT, launchApp, closeApp, stubCloseDialog, getCloseDialogCalls } = require('./helpers/launch')
const {
  BASIC_MD, ROOT_MD, EXPLORER_DIR,
  stubOpenDialog, stubSaveDialog, createTempMarkdown,
  emitFileOpened, emitRendererCommand, clickApplicationMenuItem,
  stubOpenExternal, getOpenExternalCalls,
} = require('./helpers/smoke-helpers')

const SEARCH_LIST_MD = path.join(ROOT, 'tests/fixtures/search-list.md')

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
    // docs/plans/08-search-highlight-and-ime-fixes.md: a textarea only paints its selection
    // while focused, so the match highlight was invisible when focus bounced back to the
    // search input. Focus must now stay on the editor after stepping to a match.
    assert.equal(second.activeId, 'source-editor', 'focus must stay on the editor so the match selection is actually visible')

    // Focus is now on the editor itself. Pressing Enter again must keep cycling search
    // matches, not fall through to editor.js's own Enter handling (list continuation) and
    // insert a newline into the document -- a data-corrupting regression, not just a UX one.
    const contentBeforeSecondEnter = await page.evaluate(() => document.getElementById('source-editor').value)
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.getElementById('search-count').textContent === '1/2')

    const third = await page.evaluate(() => {
      const editor = document.getElementById('source-editor')
      return { start: editor.selectionStart, end: editor.selectionEnd, value: editor.value, activeId: document.activeElement?.id }
    })
    assert.deepEqual({ start: third.start, end: third.end }, firstSelection, 'Enter from the editor must wrap back to the first match')
    assert.equal(third.value, contentBeforeSecondEnter, 'Enter must navigate search, not insert a newline into the document')
    assert.equal(third.activeId, 'source-editor')
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

// docs/plans/done/2026-08-04/08-search-highlight-and-ime-fixes.md: app.js registers the
// search-forwarding Enter listener on #source-editor (bound in app-shell.js's bindSearchEvents)
// BEFORE editor.js's own Enter handler, so it can stopImmediatePropagation() and keep editor.js
// from also treating Enter as list-continuation while search is active. A landed search match
// always leaves a *non-empty* selection (selectEditorMatch uses setSelectionRange), and editor.js
// guards its own Enter handling on an empty selection -- so immediately after a match jump,
// editor.js's handler is a no-op in either registration order and a naive "press Enter twice"
// test cannot observe the regression. The reachable corruption path needs the selection
// collapsed first (e.g. the user nudges the cursor with an arrow key) while search is still
// open and the cursor sits on a list line: if listener order regresses, editor.js's Enter
// handler runs first, sees the collapsed cursor, and inserts a list-continuation into the
// document; the forwarding listener still runs afterward and advances the search count anyway,
// so the corruption would otherwise go unnoticed by count-only assertions. Uses search-list.md
// (both matches on list lines) rather than basic.md, since non-list lines never trigger
// editor.js's list-continuation mutation regardless of listener order. Verified against a
// deliberately swapped bindEditorEvents()/bindUiEvents() call order in app.js: this exact
// sequence fails (document mutated) under the swap and passes against the real registration
// order.
test('a second Enter with a collapsed cursor after a search match jump navigates search instead of corrupting the document', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [SEARCH_LIST_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'search-list')

    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => document.getElementById('scroll-area').classList.contains('split-mode'))

    await emitRendererCommand(electronApp, 'toggleSearch')
    await page.waitForSelector('#search-bar', { state: 'visible' })
    await page.fill('#search-input', 'smoke')
    await page.waitForFunction(() => document.getElementById('search-count').textContent === '1/2')

    await page.locator('#search-input').press('Enter')
    await page.waitForFunction(() => document.getElementById('search-count').textContent === '2/2')

    const afterFirstEnter = await page.evaluate(() => ({ activeId: document.activeElement?.id }))
    assert.equal(afterFirstEnter.activeId, 'source-editor', 'focus must stay on the editor after the match jump')

    // Collapse the selection (still on the same list line, search still open) so editor.js's
    // Enter handler is no longer guarded off by a non-empty selection -- this is the state
    // where listener registration order actually decides the outcome.
    await page.keyboard.press('ArrowRight')
    const beforeSecondEnter = await page.evaluate(() => {
      const editor = document.getElementById('source-editor')
      return { value: editor.value, collapsed: editor.selectionStart === editor.selectionEnd }
    })
    assert.equal(beforeSecondEnter.collapsed, true, 'cursor must be collapsed for this to exercise editor.js\'s own Enter handling')

    // The dedicated forwarding listener added in the 08 fix must catch this Enter -- not
    // editor.js's own Enter handler, which (since the cursor sits on a list line) would
    // otherwise insert a list-continuation.
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.getElementById('search-count').textContent === '1/2')

    const afterSecondEnter = await page.evaluate(() => document.getElementById('source-editor').value)
    assert.equal(afterSecondEnter, beforeSecondEnter.value, 'Enter must navigate search, not insert a list-continuation into the document')
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
