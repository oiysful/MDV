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
