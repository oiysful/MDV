(function (globalScope) {
  function buildLineNumberText(text) {
    const count = String(text ?? '').split('\n').length
    return Array.from({ length: count }, (_, index) => index + 1).join('\n')
  }

  const LIST_PREFIX_RE = /^(\s*)([-*+]|\d+[.)])(\s+\[[ xX]\])?\s+/

  // lineText is the full current line (both sides of the cursor), so a cursor placed
  // mid-line still continues the list (split into two items) rather than exiting it.
  function computeListContinuation(lineText) {
    const match = lineText.match(LIST_PREFIX_RE)
    if (!match) return null

    const prefix = match[0]
    const rest = lineText.slice(prefix.length)
    if (rest.trim() === '') {
      return { type: 'exit', removeLength: prefix.length }
    }

    const [, indent, marker, checkbox] = match
    const numberMatch = marker.match(/^(\d+)([.)])$/)
    const nextMarker = numberMatch ? `${Number(numberMatch[1]) + 1}${numberMatch[2]}` : marker
    const nextPrefix = `${indent}${nextMarker}${checkbox ? ' [ ]' : ''} `
    return { type: 'continue', insertText: `\n${nextPrefix}` }
  }

  // Toggles an inline marker (`**`/`*`) around the selection. Prefers unwrapping markers
  // that sit just outside the selection (the common case: you select the inner text of
  // "**bold**", not the markers themselves) before falling back to wrap-inside or wrap-around.
  function computeInlineMarkerToggle(text, start, end, marker) {
    const before = text.slice(Math.max(0, start - marker.length), start)
    const after = text.slice(end, end + marker.length)
    if (before === marker && after === marker) {
      return {
        removeStart: start - marker.length,
        removeEnd: end + marker.length,
        insertText: text.slice(start, end),
      }
    }

    const selected = text.slice(start, end)
    if (selected.length >= marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
      return {
        removeStart: start,
        removeEnd: end,
        insertText: selected.slice(marker.length, selected.length - marker.length),
      }
    }

    return {
      removeStart: start,
      removeEnd: end,
      insertText: `${marker}${selected}${marker}`,
      cursorOffset: selected.length === 0 ? marker.length : null,
    }
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

  function applySourceModeToRefs({ refs, sourceMode, splitMode = false, markdownText, updateModeButton, updateLineNumbers, autoResizeEditor }) {
    refs.content.style.display = sourceMode ? 'none' : ''
    refs.sourceView.style.display = sourceMode || splitMode ? 'block' : 'none'
    refs.scrollArea.classList.toggle('source-mode', sourceMode)
    refs.scrollArea.classList.toggle('split-mode', splitMode)

    if (sourceMode || splitMode) {
      refs.sourceEditor.value = markdownText
      updateLineNumbers()
      autoResizeEditor()
    }

    if (updateModeButton) updateModeButton()
  }

  const WRAP_STORAGE_KEY = 'mdv-editor-wrap'

  function createEditorController({ getRefs, getMarkdown, setMarkdown, getActiveTab, rerenderTabBar, onSourceInput, render, closeSearch, storage }) {
    let sourceMode = false
    let splitMode = false
    let syncingSplitScroll = false
    let wrapMode = storage.getItem(WRAP_STORAGE_KEY) === '1'

    function getSourceMode() {
      return sourceMode
    }

    function setSourceMode(nextValue) {
      sourceMode = Boolean(nextValue)
    }

    function getSplitMode() {
      return splitMode
    }

    function setSplitMode(nextValue) {
      splitMode = Boolean(nextValue)
    }

    function getEditorValue() {
      return getRefs().sourceEditor.value
    }

    function updateModeButton() {
      const refs = getRefs()
      if (!refs?.btnMode || refs.btnMode.style.display === 'none') return

      const state = getModeButtonState(sourceMode)
      refs.btnMode.title = state.title
      refs.btnMode.setAttribute('aria-label', state.title)
      refs.btnMode.classList.toggle('source-active', state.isSourceActive)
      refs.btnMode.querySelector('svg').innerHTML = state.svgMarkup

      if (refs.btnSplit) {
        refs.btnSplit.classList.toggle('split-active', splitMode)
        refs.btnSplit.title = splitMode ? '분할뷰 닫기' : '분할뷰'
        refs.btnSplit.setAttribute('aria-label', refs.btnSplit.title)
      }
    }

    function getWrapMode() {
      return wrapMode
    }

    function updateWrapButton() {
      const refs = getRefs()
      if (!refs?.btnWrap) return
      refs.btnWrap.classList.toggle('active', wrapMode)
      const title = wrapMode ? '줄바꿈 끄기' : '줄바꿈'
      refs.btnWrap.title = title
      refs.btnWrap.setAttribute('aria-label', title)
    }

    // Wrap mode hides the line-number gutter (see applySourceModeToRefs's CSS counterpart in
    // index.html) because the gutter is built from raw '\n' counts and drifts out of sync with
    // wrapped visual rows. Re-measuring height is required: switching pre -> pre-wrap changes
    // scrollHeight, and the editor's height is JS-driven (autoResizeEditor), not automatic.
    function applyWrapMode() {
      const refs = getRefs()
      if (!refs?.scrollArea) return
      refs.scrollArea.classList.toggle('wrap-mode', wrapMode)
      updateWrapButton()
      autoResizeEditor()
    }

    function toggleWrap() {
      wrapMode = !wrapMode
      storage.setItem(WRAP_STORAGE_KEY, wrapMode ? '1' : '0')
      applyWrapMode()
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
      // The offset math below assumes one visual row per logical line, which only holds
      // with wrapping off; wrap mode hides the highlight for the same reason it hides the gutter.
      if (wrapMode) {
        hl.style.display = 'none'
        return
      }
      const lineIndex = editor.value.substring(0, editor.selectionStart).split('\n').length - 1
      const lineHeight = parseFloat(getComputedStyle(editor).lineHeight)
      const paddingTop = parseFloat(getComputedStyle(editor).paddingTop)
      hl.style.top = (paddingTop + lineIndex * lineHeight) + 'px'
      hl.style.height = lineHeight + 'px'
      hl.style.display = 'block'
    }

    function getScrollRatio(element) {
      const maxScroll = element.scrollHeight - element.clientHeight
      if (maxScroll <= 0) return 0
      return element.scrollTop / maxScroll
    }

    function setScrollRatio(element, ratio) {
      const maxScroll = element.scrollHeight - element.clientHeight
      element.scrollTop = maxScroll > 0 ? maxScroll * ratio : 0
    }

    function syncSplitScroll(sourceElement, targetElement) {
      if (!splitMode || syncingSplitScroll) return
      syncingSplitScroll = true
      setScrollRatio(targetElement, getScrollRatio(sourceElement))
      requestAnimationFrame(() => { syncingSplitScroll = false })
    }

    function applySourceMode() {
      const refs = getRefs()
      applySourceModeToRefs({
        refs,
        sourceMode,
        splitMode,
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

      if (splitMode) {
        const edited = getEditorValue()
        splitMode = false
        sourceMode = true
        setMarkdown(edited)
        tab.content = edited
        tab.dirty = edited !== tab.savedContent
        rerenderTabBar()
        applySourceMode()
        return
      }

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
      if (sourceMode) requestAnimationFrame(focusEditor)
    }

    async function toggleSplitView() {
      const tab = getActiveTab()
      if (!tab) return

      closeSearch()

      if (splitMode) {
        const edited = getEditorValue()
        setMarkdown(edited)
        tab.content = edited
        tab.dirty = edited !== tab.savedContent
        rerenderTabBar()
        await render(edited, tab.filename || '', tab.path || null)
        splitMode = false
        sourceMode = false
        applySourceMode()
        return
      }

      if (sourceMode) {
        const edited = getEditorValue()
        setMarkdown(edited)
        tab.content = edited
        tab.dirty = edited !== tab.savedContent
        rerenderTabBar()
        await render(edited, tab.filename || '', tab.path || null)
      }

      splitMode = true
      sourceMode = false
      applySourceMode()
    }

    function focusEditor() {
      getRefs().sourceEditor.focus()
    }

    function openInSourceMode() {
      sourceMode = true
      splitMode = false
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

      // execCommand keeps the native undo stack intact (so the menu's native Undo/Redo
      // items keep working) and fires its own 'input' event, which already routes
      // through handleSourceInput; only drive it manually on the setRangeText fallback,
      // which does not fire 'input'. Deleting uses the 'delete' command rather than
      // inserting an empty string, since an empty insertText can be a no-op in Chromium.
      function replaceSelection(text) {
        const start = editor.selectionStart
        const end = editor.selectionEnd
        const applied = text === '' ? document.execCommand('delete') : document.execCommand('insertText', false, text)
        if (!applied) {
          editor.setRangeText(text, start, end, 'end')
          handleSourceInput(editor.value)
        }
      }

      editor.addEventListener('keydown', event => {
        const modifier = event.metaKey || event.ctrlKey

        if (event.key === 'Tab') {
          event.preventDefault()
          replaceSelection('\t')
          return
        }

        if (event.key === 'Enter' && !modifier && !event.shiftKey && !event.altKey && editor.selectionStart === editor.selectionEnd) {
          const cursor = editor.selectionStart
          const lineStart = editor.value.lastIndexOf('\n', cursor - 1) + 1
          const lineEndIndex = editor.value.indexOf('\n', cursor)
          const lineEnd = lineEndIndex === -1 ? editor.value.length : lineEndIndex
          const continuation = computeListContinuation(editor.value.slice(lineStart, lineEnd))
          if (continuation) {
            event.preventDefault()
            if (continuation.type === 'exit') {
              editor.setSelectionRange(lineStart, lineStart + continuation.removeLength)
              replaceSelection('')
            } else {
              replaceSelection(continuation.insertText)
            }
          }
          return
        }

        if (modifier && (event.key.toLowerCase() === 'b' || event.key.toLowerCase() === 'i')) {
          event.preventDefault()
          const marker = event.key.toLowerCase() === 'b' ? '**' : '*'
          const toggle = computeInlineMarkerToggle(editor.value, editor.selectionStart, editor.selectionEnd, marker)
          editor.setSelectionRange(toggle.removeStart, toggle.removeEnd)
          replaceSelection(toggle.insertText)
          if (toggle.cursorOffset != null) {
            const pos = toggle.removeStart + toggle.cursorOffset
            editor.setSelectionRange(pos, pos)
          }
        }
      })

      editor.addEventListener('focus', updateLineHighlight)
      editor.addEventListener('click', updateLineHighlight)
      editor.addEventListener('keyup', updateLineHighlight)
      editor.addEventListener('mouseup', updateLineHighlight)
      editor.addEventListener('blur', () => {
        document.getElementById('line-highlight').style.display = 'none'
      })

      refs.content.addEventListener('scroll', () => syncSplitScroll(refs.content, refs.sourceView))
      refs.sourceView.addEventListener('scroll', () => syncSplitScroll(refs.sourceView, refs.content))
    }

    return {
      getSourceMode,
      setSourceMode,
      getSplitMode,
      setSplitMode,
      getEditorValue,
      updateModeButton,
      updateLineNumbers,
      autoResizeEditor,
      updateLineHighlight,
      applySourceMode,
      toggleSource,
      toggleSplitView,
      focusEditor,
      openInSourceMode,
      refreshSourceEditor,
      bindEditorEvents,
      getWrapMode,
      toggleWrap,
      applyWrapMode,
    }
  }

  const api = {
    createEditorController,
    buildLineNumberText,
    getModeButtonState,
    applySourceModeToRefs,
    computeListContinuation,
    computeInlineMarkerToggle,
  }

  globalScope.MDVEditor = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
