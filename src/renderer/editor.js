(function (globalScope) {
  function buildLineNumberText(text) {
    const count = String(text ?? '').split('\n').length
    return Array.from({ length: count }, (_, index) => index + 1).join('\n')
  }

  // Index of the end of the line containing `cursor` (i.e. the next '\n', or the end of the
  // string on the last line) -- shared by the plain-Enter list-continuation branch and
  // Cmd+Enter's "insert line below" branch in bindEditorEvents' keydown listener.
  function getLineEnd(text, cursor) {
    const lineEndIndex = text.indexOf('\n', cursor)
    return lineEndIndex === -1 ? text.length : lineEndIndex
  }

  const LIST_PREFIX_RE = /^(\s*)([-*+]|\d+[.)])(\s+\[[ xX]\])?\s+/

  // Blockquote markers at the head of a line, nesting ('>>', '> >') and typed spacing
  // included. The inner \s* stops at the first non-'>' character, so '> - item' splits into
  // the quote prefix '> ' and the list line '- item' and both continue; the ^ anchor keeps a
  // '>' used mid-sentence ('- a > b') out of it.
  const QUOTE_PREFIX_RE = /^\s*(?:>\s*)+/

  // lineText is the full current line (both sides of the cursor), so a cursor placed
  // mid-line still continues the list (split into two items) rather than exiting it.
  // Blockquote lines continue the same way, including a list nested inside one.
  function computeListContinuation(lineText) {
    const quotePrefix = lineText.match(QUOTE_PREFIX_RE)?.[0] ?? ''
    const quoted = lineText.slice(quotePrefix.length)
    const match = quoted.match(LIST_PREFIX_RE)

    if (!match) {
      if (!quotePrefix) return null
      // A quote line with no list in it continues on its own, and an empty one exits the
      // way an empty list item does.
      if (quoted.trim() === '') return { type: 'exit', removeLength: quotePrefix.length }
      return { type: 'continue', insertText: `\n${quotePrefix}` }
    }

    const prefix = match[0]
    const rest = quoted.slice(prefix.length)
    if (rest.trim() === '') {
      // An empty item inside a quote drops only the list marker and leaves the quote behind;
      // a second Enter then exits that too. One keystroke never discards both contexts.
      if (quotePrefix) {
        return { type: 'exit', removeLength: quotePrefix.length + prefix.length, insertText: quotePrefix }
      }
      return { type: 'exit', removeLength: prefix.length }
    }

    const [, indent, marker, checkbox] = match
    const numberMatch = marker.match(/^(\d+)([.)])$/)
    const nextMarker = numberMatch ? `${Number(numberMatch[1]) + 1}${numberMatch[2]}` : marker
    const nextPrefix = `${indent}${nextMarker}${checkbox ? ' [ ]' : ''} `
    return { type: 'continue', insertText: `\n${quotePrefix}${nextPrefix}` }
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

  // Pure decision for docs/plans/done/2026-07-20/05-force-hide-sidebar-in-split-view.md: split view always
  // forces the sidebar closed, and restores it to whatever it was right before forcing --
  // not unconditionally reopened, so a sidebar that was already closed stays closed on exit.
  function computeSidebarOpenForSplitChange({ enteringSplit, currentSidebarOpen, sidebarOpenBeforeSplit }) {
    if (enteringSplit) {
      return { nextSidebarOpen: false, nextMemo: currentSidebarOpen }
    }
    return { nextSidebarOpen: sidebarOpenBeforeSplit === true, nextMemo: null }
  }

  // Split-view scroll sync works in absolute ratios, never deltas — nothing accumulates.
  // Both ratios are clamped because scrollHeight/clientHeight are rounded integers while
  // scrollTop is fractional, so at the very bottom scrollTop/maxScroll can exceed 1 and the
  // other pane would snap back by ~0.5px once the target clamps it (see
  // docs/plans/04-split-view-scroll-boundary-latch.md). Module scope, so the clamp is unit
  // testable with plain {scrollHeight, clientHeight, scrollTop} stubs.
  function clampRatio(ratio) {
    return Math.min(1, Math.max(0, ratio))
  }

  // Split-view divider drag: converts a raw mouse-x-derived left-pane pixel width into a
  // clamped `grid-template-columns` string. Kept as a pure function (mouse position and
  // container width in, CSS string out) so the clamp math is unit testable with plain
  // numbers, following the getScrollRatio/setScrollRatio pattern above. The minimums (300/320)
  // mirror the original static minmax() values in index.html's #scroll-area.split-mode rule;
  // the right column keeps its own minmax(SPLIT_MIN_RIGHT, 1fr) as a second guard so a window
  // resize after a drag can't shrink the right pane below its minimum either.
  const SPLIT_DIVIDER_WIDTH = 7
  const SPLIT_MIN_LEFT = 300
  const SPLIT_MIN_RIGHT = 320

  function computeSplitGridColumns(leftWidthPx, containerWidthPx, dividerWidthPx = SPLIT_DIVIDER_WIDTH, minLeft = SPLIT_MIN_LEFT, minRight = SPLIT_MIN_RIGHT) {
    const maxLeft = Math.max(minLeft, containerWidthPx - dividerWidthPx - minRight)
    const clampedLeft = Math.min(maxLeft, Math.max(minLeft, leftWidthPx))
    return `${clampedLeft}px ${dividerWidthPx}px minmax(${minRight}px, 1fr)`
  }

  function getScrollRatio(element) {
    const maxScroll = element.scrollHeight - element.clientHeight
    if (maxScroll <= 0) return 0
    return clampRatio(element.scrollTop / maxScroll)
  }

  function setScrollRatio(element, ratio) {
    const maxScroll = element.scrollHeight - element.clientHeight
    element.scrollTop = maxScroll > 0 ? maxScroll * clampRatio(ratio) : 0
  }

  // Echo suppression by value, not by a single-slot arm/disarm flag: a wheel gesture fires a
  // burst of scroll events per pane, not one. With a flag armed on write and cleared on the
  // first matching event, a second echo arriving before the next write re-arms could slip
  // through as a "real" scroll, sync back to the source pane, and eat the user's next genuine
  // scroll there -- surfacing as the pane going dead right as the user reverses direction.
  // Comparing against the exact scrollTop we last wrote is idempotent under any number of echo
  // events: every echo still matches the recorded value and is dropped, and a real scroll
  // (which changes scrollTop) always gets through.
  function createSplitScrollSync() {
    let lastWrittenScrollTop = new WeakMap()

    function sync(sourceElement, targetElement) {
      const lastWritten = lastWrittenScrollTop.get(sourceElement)
      if (lastWritten !== undefined && Math.abs(sourceElement.scrollTop - lastWritten) < 1) {
        lastWrittenScrollTop.delete(sourceElement)
        return
      }
      setScrollRatio(targetElement, getScrollRatio(sourceElement))
      lastWrittenScrollTop.set(targetElement, targetElement.scrollTop)
    }

    // A pending echo record belongs to the split session that just ended; carrying it over
    // would make the first scroll after re-entering split view get dropped as a phantom echo.
    function reset() {
      lastWrittenScrollTop = new WeakMap()
    }

    return { sync, reset }
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

  function createEditorController({ getRefs, getMarkdown, setMarkdown, getActiveTab, rerenderTabBar, syncTabImageWatches, onSourceInput, render, closeSearch, storage, getSidebarOpen, setSidebarOpen, markdownController }) {
    let sourceMode = false
    let splitMode = false
    const splitScrollSync = createSplitScrollSync()
    let wrapMode = storage.getItem(WRAP_STORAGE_KEY) === '1'
    // Sidebar visibility to restore when leaving split mode -- null means "wasn't forced
    // closed by us" (either not in split mode, or it was already closed on entry).
    let sidebarOpenBeforeSplit = null
    // Detaches the in-flight sidebar-width transition listener from setSplitMode below, if
    // one is still pending. Toggling split mode twice within the .25s transition window
    // (index.html) replaces the running transition with a new one -- the browser fires
    // transitioncancel for the superseded transition, not transitionend, so a stale listener
    // from the first toggle would otherwise linger until the *next* completed transition and
    // fire an extra, redundant refreshHeadingOffsets() alongside the live one. Detaching it
    // up front keeps each transition to exactly one recompute instead of a growing pile of
    // harmless-but-wasteful no-ops.
    let cancelPendingSidebarTransitionListener = null

    function getSourceMode() {
      return sourceMode
    }

    function setSourceMode(nextValue) {
      sourceMode = Boolean(nextValue)
    }

    function getSplitMode() {
      return splitMode
    }

    // Sole chokepoint for splitMode changes (interactive toggle and tab-restore both funnel
    // here) so the sidebar force-close/restore in docs/plans/done/2026-07-20/05-force-hide-sidebar-in-split-view.md
    // can't be missed at one call site the way a past regression missed a render() call site.
    function setSplitMode(nextValue) {
      const next = Boolean(nextValue)
      if (next === splitMode) return
      splitMode = next
      splitScrollSync.reset()
      const refs = getRefs()
      if (refs?.btnSidebar) refs.btnSidebar.disabled = splitMode
      // Drop the drag-set inline width so the next time split mode opens it starts back at
      // the CSS default (50/50-ish minmax split) instead of remembering the last drag.
      if (!splitMode && refs?.scrollArea) refs.scrollArea.style.gridTemplateColumns = ''
      if (!getSidebarOpen || !setSidebarOpen) return
      const wasSidebarOpen = getSidebarOpen()
      const { nextSidebarOpen, nextMemo } = computeSidebarOpenForSplitChange({
        enteringSplit: splitMode,
        currentSidebarOpen: wasSidebarOpen,
        sidebarOpenBeforeSplit,
      })
      setSidebarOpen(nextSidebarOpen)
      sidebarOpenBeforeSplit = nextMemo
      // A transition from a previous call is still pending (split toggled twice within
      // .25s) -- detach it before starting a new one, rather than letting it accumulate.
      cancelPendingSidebarTransitionListener?.()
      cancelPendingSidebarTransitionListener = null
      // #sidebar's width transition (index.html, .25s) reflows #content's available width
      // over that whole span, not instantly -- refreshHeadingOffsets() in applySourceMode
      // (called right after this returns) runs before the transition starts moving, so its
      // read is stale until the transition actually finishes. Recompute once more then.
      if (nextSidebarOpen !== wasSidebarOpen && refs?.sidebar) {
        const sidebarEl = refs.sidebar
        const onSidebarTransitionSettled = event => {
          if (event.target !== sidebarEl || event.propertyName !== 'width') return
          sidebarEl.removeEventListener('transitionend', onSidebarTransitionSettled)
          sidebarEl.removeEventListener('transitioncancel', onSidebarTransitionSettled)
          cancelPendingSidebarTransitionListener = null
          // transitioncancel means this transition got superseded (toggled again mid-flight)
          // -- the newer call's own listener will do the recompute once it settles.
          if (event.type === 'transitionend') markdownController?.refreshHeadingOffsets()
        }
        sidebarEl.addEventListener('transitionend', onSidebarTransitionSettled)
        sidebarEl.addEventListener('transitioncancel', onSidebarTransitionSettled)
        cancelPendingSidebarTransitionListener = () => {
          sidebarEl.removeEventListener('transitionend', onSidebarTransitionSettled)
          sidebarEl.removeEventListener('transitioncancel', onSidebarTransitionSettled)
        }
      }
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
      // geometry.trackActive flips with wrapMode -- rebuild now rather than leaving the TOC
      // scrollspy highlight stale (shown-but-wrong, or hidden-but-should-show) until the next keystroke.
      refreshSourceModeToc()
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

    function syncSplitScroll(sourceElement, targetElement) {
      if (!splitMode) return
      splitScrollSync.sync(sourceElement, targetElement)
    }

    // True only in pure source mode (not split) -- the state where #content is hidden and
    // stale, so TOC tracking must be driven from the source text's own line positions
    // instead of the rendered DOM. Split mode keeps #content visible and live-updated via
    // the existing renderSplitPreview/buildToc() pipeline and is untouched by any of this.
    function isPureSourceMode() {
      return sourceMode && !splitMode
    }

    // getBoundingClientRect() deltas, not an offsetTop chain: the preview path's
    // `heading.offsetTop - scrollArea.offsetTop` trick only works because both are
    // unpositioned (static). #source-view is `position: relative` (index.html), so
    // sourceEditor.offsetTop is relative to #source-view, not #scroll-area -- subtracting
    // scrollArea.offsetTop from it would silently mix coordinate frames. getBoundingClientRect
    // deltas are frame-independent. (#scroll-area.source-mode's `padding: 0` is what makes
    // this basis line up with the preview path's offsetTop-based one -- a real, if
    // easy-to-miss, dependency between that CSS rule and this math.)
    function computeSourceModeGeometry(refs) {
      const editor = refs.sourceEditor
      const editorRect = editor.getBoundingClientRect()
      const scrollRect = refs.scrollArea.getBoundingClientRect()
      return {
        baseTop: (editorRect.top - scrollRect.top) + refs.scrollArea.scrollTop,
        lineHeight: parseFloat(getComputedStyle(editor).lineHeight),
        paddingTop: parseFloat(getComputedStyle(editor).paddingTop),
        // Multi-row-per-line breaks the lineIndex * lineHeight math -- same precedent as
        // updateLineHighlight() hiding itself in wrap mode rather than showing a wrong position.
        trackActive: !wrapMode,
      }
    }

    // refs.sourceEditor.value, not getMarkdown()/state.md: app.js's handleSourceInput only
    // updates state.md while split mode is active, so during pure-source typing that value
    // is stale -- the textarea itself is always current.
    function refreshSourceModeToc() {
      if (!isPureSourceMode()) return
      const refs = getRefs()
      markdownController?.rebuildSourceModeToc(refs.sourceEditor.value, computeSourceModeGeometry(refs))
    }

    let sourceTocTimer = null
    // Debounced like app.js's splitRenderTimer, but simpler: rebuildSourceModeToc is fully
    // synchronous (no fetch/render pipeline to race), so no version counter is needed.
    function scheduleSourceModeTocRebuild() {
      if (!isPureSourceMode()) return
      window.clearTimeout(sourceTocTimer)
      sourceTocTimer = window.setTimeout(refreshSourceModeToc, 120)
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
      // Heading offsets are cached relative to #scroll-area's layout, but split mode
      // reflows #content to a different width (and source mode hides it, collapsing
      // offsetTop to 0) — every caller of applySourceMode (toggleSource, toggleSplitView,
      // restoreTabState) changes that layout, so recompute here once the mode classes
      // applySourceModeToRefs just applied have taken effect. Pure source mode can't use
      // #content-based offsets at all (it's hidden), so it gets its own source-text-based
      // rebuild instead -- this is what fixes the TOC highlight being stuck on the last
      // heading the instant source mode is entered.
      if (isPureSourceMode()) refreshSourceModeToc()
      else markdownController?.refreshHeadingOffsets()
    }

    async function toggleSource() {
      const tab = getActiveTab()
      if (!tab) return

      closeSearch()

      if (splitMode) {
        const edited = getEditorValue()
        setSplitMode(false)
        sourceMode = true
        setMarkdown(edited)
        tab.content = edited
        tab.dirty = edited !== tab.savedContent
        rerenderTabBar()
        applySourceMode()
        return
      }

      if (sourceMode) {
        // Always render here, even if `edited` reads back equal to getMarkdown() -- saveFile()
        // (document-flow.js's syncTabContentForSave) also calls setMarkdown() to keep the save
        // path's conflict check accurate, which by itself doesn't touch #content. A save
        // immediately followed by leaving source mode used to skip this render because the
        // text-equality check saw no diff, leaving the preview showing pre-save content until
        // the tab was closed and reopened. toggleSplitView's equivalent transition (below)
        // already renders unconditionally; this matches it.
        const edited = getEditorValue()
        setMarkdown(edited)
        tab.content = edited
        tab.dirty = edited !== tab.savedContent
        rerenderTabBar()
        const imagePaths = await render(edited, tab.filename || '', tab.path || null)
        syncTabImageWatches(tab, imagePaths)
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
        const imagePaths = await render(edited, tab.filename || '', tab.path || null)
        syncTabImageWatches(tab, imagePaths)
        setSplitMode(false)
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
        const imagePaths = await render(edited, tab.filename || '', tab.path || null)
        syncTabImageWatches(tab, imagePaths)
      }

      setSplitMode(true)
      sourceMode = false
      applySourceMode()
    }

    function focusEditor() {
      getRefs().sourceEditor.focus()
    }

    function openInSourceMode() {
      sourceMode = true
      setSplitMode(false)
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
      scheduleSourceModeTocRebuild()
      onSourceInput(value)
    }

    function bindEditorEvents() {
      const refs = getRefs()
      const editor = refs.sourceEditor

      editor.addEventListener('input', () => {
        handleSourceInput(editor.value)
      })

      // Runs alongside app-shell.js's own resize listener (which recomputes #content-based
      // offsets for preview/split); each is a no-op in the mode it doesn't apply to.
      window.addEventListener('resize', () => { refreshSourceModeToc() })

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

        // VSCode-style "insert line below": regardless of where the cursor sits within the
        // line, jump to the end of it and open a new blank line there, rather than splitting
        // the line at the cursor the way plain Enter does. selectionEnd (not selectionStart)
        // is used so a held selection inserts after the line its far edge is on. Cmd+Shift+Enter
        // ("insert above") is deliberately out of scope -- the !event.shiftKey guard leaves
        // room for it later without this branch swallowing it silently.
        if (event.key === 'Enter' && !event.isComposing && modifier && !event.shiftKey && !event.altKey) {
          event.preventDefault()
          const lineEnd = getLineEnd(editor.value, editor.selectionEnd)
          editor.setSelectionRange(lineEnd, lineEnd)
          replaceSelection('\n')
          return
        }

        if (event.key === 'Enter' && !event.isComposing && !modifier && !event.shiftKey && !event.altKey && editor.selectionStart === editor.selectionEnd) {
          const cursor = editor.selectionStart
          const lineStart = editor.value.lastIndexOf('\n', cursor - 1) + 1
          const lineEnd = getLineEnd(editor.value, cursor)
          const continuation = computeListContinuation(editor.value.slice(lineStart, lineEnd))
          if (continuation) {
            event.preventDefault()
            if (continuation.type === 'exit') {
              // insertText is whatever survives the exit: nothing for a plain list, the
              // enclosing quote prefix when the emptied item sat inside a blockquote.
              editor.setSelectionRange(lineStart, lineStart + continuation.removeLength)
              replaceSelection(continuation.insertText ?? '')
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

      if (refs.splitDivider) {
        let dragging = false

        function onDividerMouseMove(event) {
          if (!dragging) return
          // splitMode can flip to false mid-drag (keyboard shortcut/menu while the button is
          // still held) -- setSplitMode already cleared the inline width then, so writing it
          // back here would both fight that reset and leave the next split-view entry
          // remembering this drag, which requirement 4 forbids.
          if (!splitMode) {
            onDividerMouseUp()
            return
          }
          // The button can be released outside the BrowserWindow, where our document
          // mouseup listener never fires -- event.buttons catches that case on the next
          // move so the drag doesn't get stuck "on" with the cursor still following.
          if (event.buttons === 0) {
            onDividerMouseUp()
            return
          }
          const containerRect = refs.scrollArea.getBoundingClientRect()
          const leftWidthPx = event.clientX - containerRect.left
          refs.scrollArea.style.gridTemplateColumns = computeSplitGridColumns(leftWidthPx, containerRect.width)
        }

        function onDividerMouseUp() {
          if (!dragging) return
          dragging = false
          refs.splitDivider.classList.remove('dragging')
          document.body.style.cursor = ''
          document.removeEventListener('mousemove', onDividerMouseMove)
          document.removeEventListener('mouseup', onDividerMouseUp)
          // Dragging changes #content's width by hundreds of px but isn't a window resize,
          // so the window 'resize' listener (app-shell.js) that normally recomputes cached
          // heading offsets never fires -- recompute once here, at drag end, matching the
          // "exactly one recompute per layout change" pattern setSplitMode above already uses.
          markdownController?.refreshHeadingOffsets()
        }

        refs.splitDivider.addEventListener('mousedown', event => {
          if (!splitMode) return
          event.preventDefault()
          dragging = true
          refs.splitDivider.classList.add('dragging')
          document.body.style.cursor = 'col-resize'
          document.addEventListener('mousemove', onDividerMouseMove)
          document.addEventListener('mouseup', onDividerMouseUp)
        })
      }
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
    getScrollRatio,
    setScrollRatio,
    createSplitScrollSync,
    buildLineNumberText,
    getLineEnd,
    getModeButtonState,
    applySourceModeToRefs,
    computeListContinuation,
    computeInlineMarkerToggle,
    computeSidebarOpenForSplitChange,
    computeSplitGridColumns,
  }

  globalScope.MDVEditor = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
