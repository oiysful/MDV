(function (globalScope) {
  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function findMatches(text, query) {
    if (!query) return []
    const re = new RegExp(escapeRegExp(query), 'gi')
    const matches = []
    let match = re.exec(text)
    while (match !== null) {
      matches.push({ start: match.index, end: match.index + match[0].length })
      match = re.exec(text)
    }
    return matches
  }

  // The textarea itself never scrolls vertically (overflow-y: hidden -- it grows to fit its
  // content instead), so the real vertical scroller is the ancestor #scroll-area. The target
  // must be computed in #scroll-area's coordinate space, not the textarea's.
  function computeScrollTopForOffset(editor, scrollArea, offset) {
    const lineIndex = editor.value.slice(0, offset).split('\n').length - 1
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 0
    const editorPaddingTop = parseFloat(getComputedStyle(editor).paddingTop) || 0
    const editorRect = editor.getBoundingClientRect()
    const scrollAreaRect = scrollArea.getBoundingClientRect()
    const lineTop = (editorRect.top - scrollAreaRect.top) + scrollArea.scrollTop + editorPaddingTop + lineIndex * lineHeight
    const target = lineTop - scrollArea.clientHeight / 2 + lineHeight / 2
    return Math.max(0, target)
  }

  function extractLinePrefix(text, offset) {
    const lineStart = text.lastIndexOf('\n', offset - 1) + 1
    return text.slice(lineStart, offset)
  }

  // Measures how far `prefix` renders horizontally inside `editor` using a hidden mirror
  // element that copies the editor's font/padding/white-space/tab-size. A naive
  // column * charWidth estimate breaks down for this app's Korean-heavy markdown: Hangul
  // syllables render double-wide relative to Latin characters in monospace fonts, and tabs
  // aren't fixed-width either. Measuring real layout sidesteps all of that.
  function measureTextWidth(editor, prefix) {
    const doc = editor.ownerDocument
    const style = doc.defaultView.getComputedStyle(editor)
    const mirror = doc.createElement('div')
    const propsToCopy = [
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'wordSpacing',
      'textTransform', 'tabSize', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
      'borderLeftWidth', 'borderRightWidth', 'boxSizing',
    ]
    propsToCopy.forEach(prop => { mirror.style[prop] = style[prop] })
    mirror.style.position = 'absolute'
    mirror.style.visibility = 'hidden'
    mirror.style.whiteSpace = 'pre'
    mirror.style.left = '-9999px'
    mirror.style.top = '0'
    mirror.textContent = prefix
    const marker = doc.createElement('span')
    marker.textContent = '​'
    mirror.appendChild(marker)
    doc.body.appendChild(mirror)
    const mirrorRect = mirror.getBoundingClientRect()
    const markerRect = marker.getBoundingClientRect()
    doc.body.removeChild(mirror)
    return markerRect.left - mirrorRect.left
  }

  function computeScrollLeftForOffset(editor, offset) {
    const prefix = extractLinePrefix(editor.value, offset)
    const textOffset = measureTextWidth(editor, prefix)
    const target = textOffset - editor.clientWidth / 2
    return Math.max(0, Math.min(target, editor.scrollWidth - editor.clientWidth))
  }

  function createSearchController({ getRefs }) {
    let searchMatches = []
    let searchIndex = 0
    let currentTarget = 'preview'

    function clearSearchHighlights() {
      const refs = getRefs()
      if (!refs) return
      refs.content.querySelectorAll('mark.search-hl').forEach(mark => {
        mark.replaceWith(document.createTextNode(mark.textContent))
      })
      refs.content.normalize()
    }

    function closeSearch() {
      clearSearchHighlights()
      document.getElementById('search-bar').style.display = 'none'
      searchMatches = []
      searchIndex = 0
      currentTarget = 'preview'
    }

    function isSearchOpen() {
      return document.getElementById('search-bar').style.display !== 'none'
    }

    function getCurrentTarget() {
      return currentTarget
    }

    function selectEditorMatch(focusEditor) {
      const refs = getRefs()
      const editor = refs.sourceEditor
      const match = searchMatches[searchIndex]
      if (!match) return
      if (focusEditor) editor.focus()
      editor.setSelectionRange(match.start, match.end)
      if (refs.scrollArea) refs.scrollArea.scrollTop = computeScrollTopForOffset(editor, refs.scrollArea, match.start)
      editor.scrollLeft = computeScrollLeftForOffset(editor, match.start)
    }

    function updateEditorCount() {
      document.getElementById('search-count').textContent = searchMatches.length
        ? `${searchIndex + 1}/${searchMatches.length}`
        : ''
    }

    // The textarea only paints a selection while it has focus (Chromium hides an unfocused
    // field's selection outright, regardless of the custom ::selection color), so the editor
    // must stay focused for the current match to be visible at all. Focus deliberately does
    // NOT return to the search input here anymore -- an earlier version did that synchronously
    // in the same call, before the browser ever got a frame to paint the selection, so the
    // highlight this comment promised never actually rendered. Enter/Shift+Enter keep working
    // from the editor itself via the source-editor keydown forwarding in app-shell.js; typing a
    // new query requires clicking back into the search box.
    function advanceEditorMatch(direction) {
      searchIndex = (searchIndex + direction + searchMatches.length) % searchMatches.length
      selectEditorMatch(true)
      updateEditorCount()
    }

    function highlightCurrent() {
      if (currentTarget === 'editor') {
        selectEditorMatch(false)
        updateEditorCount()
        return
      }
      searchMatches.forEach((match, index) => {
        match.classList.toggle('current', index === searchIndex)
      })
      searchMatches[searchIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      document.getElementById('search-count').textContent = `${searchIndex + 1}/${searchMatches.length}`
    }

    function runEditorSearch(query) {
      const countNode = document.getElementById('search-count')
      searchMatches = []
      searchIndex = 0
      if (!query.trim()) {
        countNode.textContent = ''
        return
      }
      searchMatches = findMatches(getRefs().sourceEditor.value, query)
      if (searchMatches.length) {
        countNode.textContent = `1/${searchMatches.length}`
        selectEditorMatch(false)
      } else {
        countNode.textContent = '없음'
      }
    }

    function runPreviewSearch(query) {
      const refs = getRefs()
      clearSearchHighlights()
      searchMatches = []
      const countNode = document.getElementById('search-count')
      if (!query.trim()) {
        countNode.textContent = ''
        return
      }

      const re = new RegExp(escapeRegExp(query), 'gi')
      const walker = document.createTreeWalker(refs.content, NodeFilter.SHOW_TEXT)
      const nodes = []
      while (walker.nextNode()) {
        if (!walker.currentNode.parentElement.closest('mark,script,style')) nodes.push(walker.currentNode)
      }

      nodes.forEach(node => {
        const text = node.textContent
        let match
        let last = 0
        const fragments = []
        match = re.exec(text)
        while (match !== null) {
          if (match.index > last) fragments.push(document.createTextNode(text.slice(last, match.index)))
          const mark = document.createElement('mark')
          mark.className = 'search-hl'
          mark.textContent = match[0]
          fragments.push(mark)
          searchMatches.push(mark)
          last = match.index + match[0].length
          match = re.exec(text)
        }
        if (fragments.length) {
          if (last < text.length) fragments.push(document.createTextNode(text.slice(last)))
          node.replaceWith(...fragments)
        }
      })

      if (searchMatches.length) {
        countNode.textContent = `1/${searchMatches.length}`
        searchIndex = 0
        highlightCurrent()
      } else {
        countNode.textContent = '없음'
      }
    }

    function runSearch(query) {
      if (currentTarget === 'editor') {
        runEditorSearch(query)
        return
      }
      runPreviewSearch(query)
    }

    function toggleSearch({ target = 'preview' } = {}) {
      const bar = document.getElementById('search-bar')
      if (bar.style.display === 'none') {
        currentTarget = target
        bar.style.display = 'flex'
        const input = document.getElementById('search-input')
        input.value = ''
        input.focus()
        searchMatches = []
        searchIndex = 0
        document.getElementById('search-count').textContent = ''
      } else {
        closeSearch()
      }
    }

    function searchNext() {
      if (!searchMatches.length) return
      if (currentTarget === 'editor') {
        advanceEditorMatch(1)
        return
      }
      searchIndex = (searchIndex + 1) % searchMatches.length
      highlightCurrent()
    }

    function searchPrev() {
      if (!searchMatches.length) return
      if (currentTarget === 'editor') {
        advanceEditorMatch(-1)
        return
      }
      searchIndex = (searchIndex - 1 + searchMatches.length) % searchMatches.length
      highlightCurrent()
    }

    return {
      toggleSearch,
      closeSearch,
      isSearchOpen,
      getCurrentTarget,
      clearSearchHighlights,
      runSearch,
      highlightCurrent,
      searchNext,
      searchPrev,
    }
  }

  const api = { createSearchController, findMatches, extractLinePrefix }
  globalScope.MDVSearch = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
