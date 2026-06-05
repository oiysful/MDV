const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildLineNumberText,
  getModeButtonState,
  applySourceModeToRefs,
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
