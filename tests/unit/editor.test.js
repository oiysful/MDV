const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildLineNumberText,
  getModeButtonState,
  applySourceModeToRefs,
  computeListContinuation,
  computeInlineMarkerToggle,
  computeSidebarOpenForSplitChange,
  getScrollRatio,
  setScrollRatio,
  createSplitScrollSync,
  computeSplitGridColumns,
} = require('../../src/renderer/editor.js')

function createClassList() {
  const classes = new Set()
  return {
    toggle(name, enabled) {
      if (enabled) classes.add(name)
      else classes.delete(name)
    },
    contains(name) {
      return classes.has(name)
    },
  }
}

function createButtonRef() {
  const attrs = {}
  return {
    style: {},
    title: '',
    classList: createClassList(),
    setAttribute(name, value) {
      attrs[name] = value
    },
    getAttribute(name) {
      return attrs[name]
    },
    querySelector() {
      return { innerHTML: '' }
    },
  }
}

test('buildLineNumberText returns one line number per source line', () => {
  assert.equal(buildLineNumberText('alpha\nbeta\ngamma'), '1\n2\n3')
  assert.equal(buildLineNumberText(''), '1')
})

test('getModeButtonState reflects preview and source mode labels', () => {
  assert.deepEqual(getModeButtonState(false).title, '편집 (⌘U)')
  assert.deepEqual(getModeButtonState(true).title, '미리보기 (⌘U)')
  assert.equal(getModeButtonState(false).isSourceActive, false)
  assert.equal(getModeButtonState(true).isSourceActive, true)
})

test('applySourceModeToRefs toggles preview/editor visibility and syncs source text', () => {
  const refs = {
    content: { style: {} },
    sourceView: { style: {} },
    scrollArea: { classList: createClassList() },
    sourceEditor: { value: '' },
  }

  let lineNumbersUpdated = 0
  let autoResized = 0
  let modeButtonUpdated = 0

  applySourceModeToRefs({
    refs,
    sourceMode: true,
    markdownText: '# Draft',
    updateModeButton: () => { modeButtonUpdated += 1 },
    updateLineNumbers: () => { lineNumbersUpdated += 1 },
    autoResizeEditor: () => { autoResized += 1 },
  })

  assert.equal(refs.content.style.display, 'none')
  assert.equal(refs.sourceView.style.display, 'block')
  assert.equal(refs.sourceEditor.value, '# Draft')
  assert.equal(refs.scrollArea.classList.contains('source-mode'), true)
  assert.equal(lineNumbersUpdated, 1)
  assert.equal(autoResized, 1)
  assert.equal(modeButtonUpdated, 1)

  applySourceModeToRefs({
    refs,
    sourceMode: false,
    markdownText: '# Ignored',
    updateModeButton: () => { modeButtonUpdated += 1 },
    updateLineNumbers: () => { lineNumbersUpdated += 1 },
    autoResizeEditor: () => { autoResized += 1 },
  })

  assert.equal(refs.content.style.display, '')
  assert.equal(refs.sourceView.style.display, 'none')
  assert.equal(refs.scrollArea.classList.contains('source-mode'), false)
  assert.equal(lineNumbersUpdated, 1)
  assert.equal(autoResized, 1)
  assert.equal(modeButtonUpdated, 2)
})

test('applySourceModeToRefs shows preview and editor together in split mode', () => {
  const refs = {
    content: { style: {} },
    sourceView: { style: {} },
    scrollArea: { classList: createClassList() },
    sourceEditor: { value: '' },
    btnMode: createButtonRef(),
    btnSplit: createButtonRef(),
  }

  let lineNumbersUpdated = 0
  let autoResized = 0

  applySourceModeToRefs({
    refs,
    sourceMode: false,
    splitMode: true,
    markdownText: '# Split',
    updateModeButton: () => {
      refs.btnSplit.classList.toggle('split-active', true)
      refs.btnSplit.title = '분할뷰 닫기'
      refs.btnSplit.setAttribute('aria-label', refs.btnSplit.title)
    },
    updateLineNumbers: () => { lineNumbersUpdated += 1 },
    autoResizeEditor: () => { autoResized += 1 },
  })

  assert.equal(refs.content.style.display, '')
  assert.equal(refs.sourceView.style.display, 'block')
  assert.equal(refs.sourceEditor.value, '# Split')
  assert.equal(refs.scrollArea.classList.contains('source-mode'), false)
  assert.equal(refs.scrollArea.classList.contains('split-mode'), true)
  assert.equal(refs.btnSplit.classList.contains('split-active'), true)
  assert.equal(refs.btnSplit.getAttribute('aria-label'), '분할뷰 닫기')
  assert.equal(lineNumbersUpdated, 1)
  assert.equal(autoResized, 1)
})

test('computeListContinuation continues a bullet list on Enter', () => {
  assert.deepEqual(computeListContinuation('- item'), { type: 'continue', insertText: '\n- ' })
  assert.deepEqual(computeListContinuation('* item'), { type: 'continue', insertText: '\n* ' })
  assert.deepEqual(computeListContinuation('+ item'), { type: 'continue', insertText: '\n+ ' })
})

test('computeListContinuation preserves nested indentation', () => {
  assert.deepEqual(computeListContinuation('  - nested item'), { type: 'continue', insertText: '\n  - ' })
})

test('computeListContinuation increments ordered list numbers and keeps the delimiter style', () => {
  assert.deepEqual(computeListContinuation('1. first'), { type: 'continue', insertText: '\n2. ' })
  assert.deepEqual(computeListContinuation('3) third'), { type: 'continue', insertText: '\n4) ' })
  assert.deepEqual(computeListContinuation('9. ninth'), { type: 'continue', insertText: '\n10. ' })
})

test('computeListContinuation continues checkboxes unchecked regardless of prior state', () => {
  assert.deepEqual(computeListContinuation('- [ ] todo'), { type: 'continue', insertText: '\n- [ ] ' })
  assert.deepEqual(computeListContinuation('- [x] done'), { type: 'continue', insertText: '\n- [ ] ' })
  assert.deepEqual(computeListContinuation('- [X] done'), { type: 'continue', insertText: '\n- [ ] ' })
})

test('computeListContinuation exits the list on an empty list item', () => {
  assert.deepEqual(computeListContinuation('- '), { type: 'exit', removeLength: 2 })
  assert.deepEqual(computeListContinuation('  - '), { type: 'exit', removeLength: 4 })
  assert.deepEqual(computeListContinuation('1. '), { type: 'exit', removeLength: 3 })
  assert.deepEqual(computeListContinuation('- [ ] '), { type: 'exit', removeLength: 6 })
})

test('computeListContinuation returns null for a non-list line', () => {
  assert.equal(computeListContinuation('plain text'), null)
  assert.equal(computeListContinuation(''), null)
  assert.equal(computeListContinuation('   '), null)
})

test('computeInlineMarkerToggle wraps a plain selection', () => {
  const text = 'hello world'
  const result = computeInlineMarkerToggle(text, 0, 5, '**')
  assert.deepEqual(result, { removeStart: 0, removeEnd: 5, insertText: '**hello**', cursorOffset: null })
})

test('computeInlineMarkerToggle unwraps when markers sit just outside the selection', () => {
  const text = '**hello** world'
  const result = computeInlineMarkerToggle(text, 2, 7, '**')
  assert.deepEqual(result, { removeStart: 0, removeEnd: 9, insertText: 'hello' })
})

test('computeInlineMarkerToggle unwraps when the selection includes the markers themselves', () => {
  const text = 'x **bold** y'
  const result = computeInlineMarkerToggle(text, 2, 10, '**')
  assert.deepEqual(result, { removeStart: 2, removeEnd: 10, insertText: 'bold' })
})

test('computeInlineMarkerToggle inserts empty markers with a middle cursor when there is no selection', () => {
  const text = 'hello '
  const result = computeInlineMarkerToggle(text, 6, 6, '**')
  assert.deepEqual(result, { removeStart: 6, removeEnd: 6, insertText: '****', cursorOffset: 2 })
})

test('computeInlineMarkerToggle works with the single-character italic marker', () => {
  const text = 'a *word* b'
  const result = computeInlineMarkerToggle(text, 3, 7, '*')
  assert.deepEqual(result, { removeStart: 2, removeEnd: 8, insertText: 'word' })
})

test('computeSidebarOpenForSplitChange force-closes the sidebar and remembers it was open', () => {
  const result = computeSidebarOpenForSplitChange({
    enteringSplit: true,
    currentSidebarOpen: true,
    sidebarOpenBeforeSplit: null,
  })
  assert.deepEqual(result, { nextSidebarOpen: false, nextMemo: true })
})

test('computeSidebarOpenForSplitChange force-closes and remembers an already-closed sidebar as closed', () => {
  const result = computeSidebarOpenForSplitChange({
    enteringSplit: true,
    currentSidebarOpen: false,
    sidebarOpenBeforeSplit: null,
  })
  assert.deepEqual(result, { nextSidebarOpen: false, nextMemo: false })
})

test('computeSidebarOpenForSplitChange restores the sidebar to open on exit if it was open before split', () => {
  const result = computeSidebarOpenForSplitChange({
    enteringSplit: false,
    currentSidebarOpen: false,
    sidebarOpenBeforeSplit: true,
  })
  assert.deepEqual(result, { nextSidebarOpen: true, nextMemo: null })
})

test('computeSidebarOpenForSplitChange leaves the sidebar closed on exit if it was already closed before split', () => {
  const result = computeSidebarOpenForSplitChange({
    enteringSplit: false,
    currentSidebarOpen: false,
    sidebarOpenBeforeSplit: false,
  })
  assert.deepEqual(result, { nextSidebarOpen: false, nextMemo: null })
})

// Split-view scroll sync (docs/plans/04-split-view-scroll-boundary-latch.md). scrollHeight and
// clientHeight are rounded integers while scrollTop is fractional, so at the very bottom the
// raw ratio can exceed 1 — the target pane then clamps it and the source snaps back ~0.5px.
// Both directions clamp to [0, 1]. Plain object stubs are enough: these are pure functions.
const scrollStub = ({ scrollTop = 0, scrollHeight = 1000, clientHeight = 500 } = {}) =>
  ({ scrollTop, scrollHeight, clientHeight })

test('getScrollRatio maps scroll position onto 0..1', () => {
  assert.equal(getScrollRatio(scrollStub({ scrollTop: 0 })), 0)
  assert.equal(getScrollRatio(scrollStub({ scrollTop: 250 })), 0.5)
  assert.equal(getScrollRatio(scrollStub({ scrollTop: 500 })), 1)
})

test('getScrollRatio clamps a fractional overshoot at the bottom instead of returning > 1', () => {
  // Real Chromium case: scrollTop can read fractionally past the integer-rounded maxScroll.
  assert.equal(getScrollRatio(scrollStub({ scrollTop: 500.4 })), 1)
  assert.equal(getScrollRatio(scrollStub({ scrollTop: -3 })), 0)
})

test('getScrollRatio returns 0 for an unscrollable element instead of dividing by zero', () => {
  assert.equal(getScrollRatio(scrollStub({ scrollHeight: 500, clientHeight: 500, scrollTop: 0 })), 0)
  assert.equal(getScrollRatio(scrollStub({ scrollHeight: 400, clientHeight: 500, scrollTop: 10 })), 0)
})

test('setScrollRatio clamps the incoming ratio to the scrollable range', () => {
  const middle = scrollStub()
  setScrollRatio(middle, 0.5)
  assert.equal(middle.scrollTop, 250)

  const over = scrollStub()
  setScrollRatio(over, 1.004)
  assert.equal(over.scrollTop, 500, 'a ratio above 1 must not push scrollTop past maxScroll')

  const under = scrollStub()
  setScrollRatio(under, -0.2)
  assert.equal(under.scrollTop, 0, 'a negative ratio must not produce a negative scrollTop')
})

test('setScrollRatio parks an unscrollable element at 0', () => {
  const flat = scrollStub({ scrollTop: 40, scrollHeight: 500, clientHeight: 500 })
  setScrollRatio(flat, 0.8)
  assert.equal(flat.scrollTop, 0)
})

test('a ratio round-trip is stable at both boundaries', () => {
  // The pair is only correct if syncing a pane already at a boundary is a no-op — that is what
  // keeps the two panes from nudging each other back and forth at the top or bottom.
  for (const scrollTop of [0, 500]) {
    const source = scrollStub({ scrollTop })
    const target = scrollStub({ scrollTop })
    setScrollRatio(target, getScrollRatio(source))
    assert.equal(target.scrollTop, scrollTop)
  }
})

// createSplitScrollSync (docs/plans/04-split-view-scroll-boundary-latch.md, reopened after
// Ian reproduced it directly: scrolling one pane then immediately reversing direction did
// nothing). The prior implementation armed a single arm/disarm flag on write and cleared it on
// the first matching echo event; a wheel gesture fires a *burst* of scroll events per pane, and
// a second echo arriving before the next write re-armed could be misread as a real scroll,
// sync back onto the source pane, and arm it too — eating the user's very next genuine scroll
// there. Comparing against the exact scrollTop last written is immune to how many echo events
// a write produces.
test('sync treats a scroll event as real when the pane has no recorded programmatic write', () => {
  const sync = createSplitScrollSync()
  const content = scrollStub({ scrollTop: 100 })
  const sourceView = scrollStub({ scrollTop: 0 })

  sync.sync(content, sourceView)
  assert.equal(sourceView.scrollTop, 100, 'a real scroll on content must sync onto sourceView')
})

test('sync drops an echo event whose scrollTop matches what was just written', () => {
  const sync = createSplitScrollSync()
  const content = scrollStub({ scrollTop: 100 })
  const sourceView = scrollStub({ scrollTop: 0 })

  sync.sync(content, sourceView) // writes sourceView
  const before = content.scrollTop

  // sourceView's own scroll event fires next, echoing the write we just made into it.
  sync.sync(sourceView, content)
  assert.equal(content.scrollTop, before, 'an echo of our own write must not move content back')
})

test('a burst of two real scrolls on one pane does not cause the other pane\'s later real scroll to be swallowed', () => {
  const sync = createSplitScrollSync()
  const content = scrollStub({ scrollTop: 0 })
  const sourceView = scrollStub({ scrollTop: 0 })

  // Two real scrolls on content land back-to-back (a wheel burst) before sourceView's own
  // echo event for the first write has been processed — normal under momentum scrolling.
  content.scrollTop = 100
  sync.sync(content, sourceView)
  content.scrollTop = 150
  sync.sync(content, sourceView)
  const syncedAfterBurst = sourceView.scrollTop

  // sourceView's native scroll event now fires for our own write and must be dropped.
  sync.sync(sourceView, content)
  assert.equal(content.scrollTop, 150, 'the echo must not have moved content off where the user actually scrolled to')

  // Ian's exact repro: the user immediately reverses direction on content. This must still
  // reach sourceView — a stale echo-guard swallowing it is the bug being fixed here.
  content.scrollTop = 60
  sync.sync(content, sourceView)
  assert.notEqual(sourceView.scrollTop, syncedAfterBurst, 'a real reversal on content must propagate to sourceView')
})

test('a duplicate echo for an already-processed write cannot permanently block a later real scroll', () => {
  // Guards the residual edge case in the value-based design: if sourceView fires two scroll
  // events for one write (browsers can, depending on timing) the first is correctly dropped as
  // an echo, and the second -- now that the record was consumed -- can get misread as real and
  // write content again. That write reproduces the *same* ratio-equivalent value, so nothing
  // visibly moves, but it does arm a record for content. The property that actually matters:
  // that record must not swallow a later real scroll on content, because a real scroll changes
  // the value and this design only ever drops an event whose value exactly matches what was
  // last written -- unlike the old single-slot flag, which dropped by identity regardless of
  // how far the pane had actually moved.
  const sync = createSplitScrollSync()
  const content = scrollStub({ scrollTop: 100 })
  const sourceView = scrollStub({ scrollTop: 0 })

  sync.sync(content, sourceView) // sourceView -> 100
  sync.sync(sourceView, content) // echo #1: correctly dropped
  sync.sync(sourceView, content) // echo #2 (duplicate): may be misread as real; reproduces 100
  assert.equal(content.scrollTop, 100)

  content.scrollTop = 40 // a real, larger reversal scroll
  sync.sync(content, sourceView)
  assert.equal(sourceView.scrollTop, 40, 'a real scroll with a different value must never be dropped, regardless of prior echo handling')
})

test('reset forgets prior writes so a stale record cannot swallow the first scroll of a new split session', () => {
  const sync = createSplitScrollSync()
  const content = scrollStub({ scrollTop: 100 })
  const sourceView = scrollStub({ scrollTop: 0 })

  sync.sync(content, sourceView) // records lastWritten[sourceView] at content's ratio-equivalent position
  sync.reset() // e.g. leaving split mode

  // Perturb content so an incorrect "this is just an echo, do nothing" classification is
  // observable: if sourceView's scrollTop (unchanged since the pre-reset write) still matches
  // the forgotten record, it would wrongly count as an echo and content would stay at 999.
  content.scrollTop = 999
  sync.sync(sourceView, content)

  assert.notEqual(content.scrollTop, 999, 'post-reset, sourceView\'s scroll must be treated as real and overwrite content, not dropped as a phantom echo of the pre-reset write')
})

// Split-view divider drag (grid-template-columns clamp). Mirrors the minmax(300px, 1fr) /
// minmax(320px, 1fr) minimums that used to be hardcoded and static in index.html's
// #scroll-area.split-mode rule -- dragging must never be able to push either pane below them.
test('computeSplitGridColumns passes an in-range left width straight through', () => {
  assert.equal(computeSplitGridColumns(500, 1000), '500px 7px minmax(320px, 1fr)')
})

test('computeSplitGridColumns clamps the left pane at its minimum width', () => {
  assert.equal(computeSplitGridColumns(50, 1000), '300px 7px minmax(320px, 1fr)')
  assert.equal(computeSplitGridColumns(-40, 1000), '300px 7px minmax(320px, 1fr)')
})

test('computeSplitGridColumns clamps the left pane so the right pane keeps its minimum width', () => {
  // containerWidth 1000, divider 7px, minRight 320 -> left maxes out at 673px.
  assert.equal(computeSplitGridColumns(950, 1000), '673px 7px minmax(320px, 1fr)')
})

test('computeSplitGridColumns degrades gracefully when the container is narrower than both minimums combined', () => {
  // 300 + 7 + 320 = 627 > containerWidth (600), so the max-left clamp itself floors at minLeft.
  assert.equal(computeSplitGridColumns(400, 600), '300px 7px minmax(320px, 1fr)')
})
