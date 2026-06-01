(function (globalScope) {
  function createSearchController({ getRefs }) {
    let searchMatches = []
    let searchIndex = 0

    function clearSearchHighlights() {
      const refs = getRefs()
      if (!refs) return
      refs.content.querySelectorAll('mark.search-hl').forEach(mark =>
        mark.replaceWith(document.createTextNode(mark.textContent))
      )
      refs.content.normalize()
    }

    function closeSearch() {
      clearSearchHighlights()
      document.getElementById('search-bar').style.display = 'none'
      searchMatches = []
      searchIndex = 0
    }

    function highlightCurrent() {
      searchMatches.forEach((match, index) => match.classList.toggle('current', index === searchIndex))
      searchMatches[searchIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      document.getElementById('search-count').textContent = `${searchIndex + 1}/${searchMatches.length}`
    }

    function runSearch(query) {
      const refs = getRefs()
      clearSearchHighlights()
      searchMatches = []
      const countNode = document.getElementById('search-count')
      if (!query.trim()) {
        countNode.textContent = ''
        return
      }

      const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
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
        while ((match = re.exec(text)) !== null) {
          if (match.index > last) fragments.push(document.createTextNode(text.slice(last, match.index)))
          const mark = document.createElement('mark')
          mark.className = 'search-hl'
          mark.textContent = match[0]
          fragments.push(mark)
          searchMatches.push(mark)
          last = match.index + match[0].length
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

    function toggleSearch() {
      const bar = document.getElementById('search-bar')
      if (bar.style.display === 'none') {
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
      searchIndex = (searchIndex + 1) % searchMatches.length
      highlightCurrent()
    }

    function searchPrev() {
      if (!searchMatches.length) return
      searchIndex = (searchIndex - 1 + searchMatches.length) % searchMatches.length
      highlightCurrent()
    }

    return {
      toggleSearch,
      closeSearch,
      clearSearchHighlights,
      runSearch,
      highlightCurrent,
      searchNext,
      searchPrev,
    }
  }

  const api = { createSearchController }
  globalScope.MDVSearch = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
