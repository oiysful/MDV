const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildLineNumberText,
  getModeButtonState,
  applySourceModeToRefs,
  computeListContinuation,
  computeInlineMarkerToggle,
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
