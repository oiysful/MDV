(function (globalScope) {
  function buildLineNumberText(text) {
    const count = String(text ?? '').split('\n').length
    return Array.from({ length: count }, (_, index) => index + 1).join('\n')
  }

  function getModeButtonState(sourceMode) {
    if (sourceMode) {
      return {
        title: '미리보기 (⌘U)',
        isSourceActive: true,
        svgMarkup: '<circle cx="6.5" cy="6.5" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M1 6.5C2.5 3.5 4.3 2 6.5 2s4 1.5 5.5 4.5C10.5 9.5 8.7 11 6.5 11S2.5 9.5 1 6.5z" stroke="currentColor" stroke-width="1.3"/>',
      }
    }

    return {
      title: '편집 (⌘U)',
      isSourceActive: false,
      svgMarkup: '<path d="M3 3.25 1 6.5 3 9.75" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 3.25 12 6.5 10 9.75" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.75 2.5 6.25 10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    }
  }

  function applySourceModeToRefs({ refs, sourceMode, markdownText, updateModeButton, updateLineNumbers, autoResizeEditor }) {
    refs.content.style.display = sourceMode ? 'none' : ''
    refs.sourceView.style.display = sourceMode ? 'block' : 'none'
    refs.scrollArea.classList.toggle('source-mode', sourceMode)

    if (sourceMode) {
      refs.sourceEditor.value = markdownText
      updateLineNumbers()
      autoResizeEditor()
    }

    if (updateModeButton) updateModeButton()
  }

  function createEditorController({ getRefs, getMarkdown, setMarkdown, getActiveTab, rerenderTabBar, onSourceInput, render, closeSearch }) {
    let sourceMode = false

    function getSourceMode() {
      return sourceMode
    }

    function setSourceMode(nextValue) {
      sourceMode = Boolean(nextValue)
    }

    function getEditorValue() {
      return getRefs().sourceEditor.value
    }

    function updateModeButton() {
      const refs = getRefs()
      if (!refs?.btnMode || refs.btnMode.style.display === 'none') return

      const state = getModeButtonState(sourceMode)
      refs.btnMode.title = state.title
      refs.btnMode.classList.toggle('source-active', state.isSourceActive)
      refs.btnMode.querySelector('svg').innerHTML = state.svgMarkup
    }

    function updateLineNumbers() {
      const refs = getRefs()
      refs.sourceLines.textContent = buildLineNumberText(refs.sourceEditor.value)
    }

    function autoResizeEditor() {
      const refs = getRefs()
      refs.sourceEditor.style.height = 'auto'
      refs.sourceEditor.style.height = refs.sourceEditor.scrollHeight + 'px'
    }

    function updateLineHighlight() {
      const refs = getRefs()
      const editor = refs.sourceEditor
      const hl = document.getElementById('line-highlight')
      if (!hl) return
      const lineIndex = editor.value.substring(0, editor.selectionStart).split('\n').length - 1
      const lineHeight = parseFloat(getComputedStyle(editor).lineHeight)
      const paddingTop = parseFloat(getComputedStyle(editor).paddingTop)
      hl.style.top = (paddingTop + lineIndex * lineHeight) + 'px'
      hl.style.height = lineHeight + 'px'
      hl.style.display = 'block'
    }

    function applySourceMode() {
      const refs = getRefs()
      applySourceModeToRefs({
        refs,
        sourceMode,
        markdownText: getMarkdown(),
        updateModeButton,
        updateLineNumbers,
        autoResizeEditor,
      })
    }

    async function toggleSource() {
      const tab = getActiveTab()
      if (!tab) return

      closeSearch()

      if (sourceMode) {
        const edited = getEditorValue()
        if (edited !== getMarkdown()) {
          setMarkdown(edited)
          tab.content = edited
          tab.dirty = edited !== tab.savedContent
          rerenderTabBar()
          await render(edited, tab.filename || '', tab.path || null)
        }
      }

      sourceMode = !sourceMode
      applySourceMode()
    }

    function focusEditor() {
      getRefs().sourceEditor.focus()
    }

    function openInSourceMode() {
      sourceMode = true
      applySourceMode()
      focusEditor()
    }

    function refreshSourceEditor(content) {
      const refs = getRefs()
      refs.sourceEditor.value = content
      updateLineNumbers()
      autoResizeEditor()
      updateLineHighlight()
    }

    function handleSourceInput(value) {
      updateLineNumbers()
      autoResizeEditor()
      updateLineHighlight()
      onSourceInput(value)
    }

    function bindEditorEvents() {
      const refs = getRefs()
      const editor = refs.sourceEditor

      editor.addEventListener('input', () => {
        handleSourceInput(editor.value)
      })

      editor.addEventListener('keydown', event => {
        if (event.key === 'Tab') {
          event.preventDefault()
          const start = editor.selectionStart
          const end = editor.selectionEnd
          editor.value = editor.value.substring(0, start) + '\t' + editor.value.substring(end)
          editor.selectionStart = editor.selectionEnd = start + 1
          handleSourceInput(editor.value)
        }
      })

      editor.addEventListener('focus', updateLineHighlight)
      editor.addEventListener('click', updateLineHighlight)
      editor.addEventListener('keyup', updateLineHighlight)
      editor.addEventListener('mouseup', updateLineHighlight)
      editor.addEventListener('blur', () => {
        document.getElementById('line-highlight').style.display = 'none'
      })
    }

    return {
      getSourceMode,
      setSourceMode,
      getEditorValue,
      updateModeButton,
      updateLineNumbers,
      autoResizeEditor,
      updateLineHighlight,
      applySourceMode,
      toggleSource,
      focusEditor,
      openInSourceMode,
      refreshSourceEditor,
      bindEditorEvents,
    }
  }

  const api = {
    createEditorController,
    buildLineNumberText,
    getModeButtonState,
    applySourceModeToRefs,
  }

  globalScope.MDVEditor = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
