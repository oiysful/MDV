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

  function computeScrollTopForOffset(editor, offset) {
    const lineIndex = editor.value.slice(0, offset).split('\n').length - 1
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 0
    const target = lineIndex * lineHeight - editor.clientHeight / 2 + lineHeight / 2
    return Math.max(0, target)
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

    function selectEditorMatch(focusEditor) {
      const editor = getRefs().sourceEditor
      const match = searchMatches[searchIndex]
      if (!match) return
      if (focusEditor) editor.focus()
      editor.setSelectionRange(match.start, match.end)
      editor.scrollTop = computeScrollTopForOffset(editor, match.start)
    }

    function updateEditorCount() {
      document.getElementById('search-count').textContent = searchMatches.length
        ? `${searchIndex + 1}/${searchMatches.length}`
        : ''
    }

    // Enter/Shift+Enter is the only moment the editor is focused, so the selection
    // becomes visible; focus returns to the search input right after so typing
    // and Escape keep working without the user re-clicking the search box.
    function advanceEditorMatch(direction) {
      searchIndex = (searchIndex + direction + searchMatches.length) % searchMatches.length
      selectEditorMatch(true)
      updateEditorCount()
      document.getElementById('search-input').focus()
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
      clearSearchHighlights,
      runSearch,
      highlightCurrent,
      searchNext,
      searchPrev,
    }
  }

  const api = { createSearchController, findMatches }
  globalScope.MDVSearch = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
