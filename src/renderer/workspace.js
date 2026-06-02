(function (globalScope) {
  function findTabByPathInTabs(tabs, targetPath) {
    if (!targetPath) return null
    return tabs.find(tab => tab.path === targetPath) || null
  }

  function getNextActiveTabIdAfterClose(tabs, closingTabId, currentActiveTabId) {
    const idx = tabs.findIndex(tab => tab.id === closingTabId)
    if (idx === -1) return currentActiveTabId
    const remaining = tabs.filter(tab => tab.id !== closingTabId)
    if (!remaining.length) return null
    if (currentActiveTabId !== closingTabId) return currentActiveTabId
    return remaining[Math.min(idx, remaining.length - 1)].id
  }

  function reorderTabsById(tabs, draggedId, targetId, after) {
    const src = tabs.findIndex(tab => tab.id === draggedId)
    const tgt = tabs.findIndex(tab => tab.id === targetId)
    if (src === -1 || tgt === -1 || src === tgt) return tabs.slice()
    const nextTabs = tabs.slice()
    let insert = after ? tgt + 1 : tgt
    const [moved] = nextTabs.splice(src, 1)
    if (src < insert) insert -= 1
    nextTabs.splice(insert, 0, moved)
    return nextTabs
  }

  function createWorkspaceController({
    getRefs,
    markdownController,
    render,
    applySourceMode,
    showEmptyState,
    watchFile,
    updateToolbarActions,
    updateEntryAffordance,
    maybeShowWelcomeGuide,
    showAppContextMenu,
    getSourceMode,
    setSourceMode,
    setMarkdown,
    confirmClose,
    openNewWindow,
  }) {
    let tabs = []
    let activeTabId = null
    let tabIdCounter = 0
    let draggedTabId = null

    function findTabByPath(targetPath) {
      return findTabByPathInTabs(tabs, targetPath)
    }

    function getActiveTab() {
      return tabs.find(tab => tab.id === activeTabId) || null
    }

    function getTabCount() {
      return tabs.length
    }

    function saveCurrentTabState() {
      const refs = getRefs()
      const tab = getActiveTab()
      if (!tab || !refs) return
      tab.scrollTop = refs.scrollArea.scrollTop
      tab.renderedHTML = refs.content.innerHTML
      tab.tocHTML = refs.tocList.innerHTML
      tab.sourceMode = getSourceMode()
      if (getSourceMode()) {
        tab.content = refs.sourceEditor.value
        setMarkdown(tab.content)
      }
    }

    function restoreTabState(tab) {
      const refs = getRefs()
      refs.content.classList.remove('is-empty')
      markdownController.hydrateFromDom(tab.renderedHTML || '', tab.tocHTML || '', tab.content)
      document.title = (tab.filename || 'untitled.md').replace(/\.md$/i, '')
      if (refs.btnMode) refs.btnMode.style.display = ''
      setSourceMode(tab.sourceMode || false)
      applySourceMode()
      requestAnimationFrame(() => {
        refs.scrollArea.scrollTop = tab.scrollTop || 0
      })
    }

    function renderTabBar() {
      const refs = getRefs()
      const list = refs.tabList
      refs.tabStrip.classList.toggle('hidden', tabs.length === 0)
      list.innerHTML = ''
      tabs.forEach(tab => {
        const el = document.createElement('div')
        el.className = 'file-tab' + (tab.id === activeTabId ? ' active' : '')
        el.dataset.tabId = tab.id
        el.draggable = true
        el.innerHTML = `<span class="file-tab-name">${tab.dirty ? '● ' : ''}${tab.filename}</span><button class="file-tab-close">&times;</button>`
        el.addEventListener('click', () => switchToTab(tab.id))
        el.addEventListener('auxclick', event => {
          if (event.button === 1) {
            event.preventDefault()
            closeTab(tab.id)
          }
        })
        el.addEventListener('contextmenu', event => {
          event.preventDefault()
          showAppContextMenu(event.clientX, event.clientY, [
            { label: '새 창으로 열기', action: () => openTabInNewWindow(tab.id) },
            { label: '다른 탭 닫기', action: () => closeOtherTabs(tab.id) },
            { label: '모든 탭 닫기', action: () => closeAllTabs() },
          ])
        })
        el.querySelector('.file-tab-close').addEventListener('click', event => {
          event.stopPropagation()
          closeTab(tab.id)
        })
        el.addEventListener('dragstart', onTabDragStart)
        el.addEventListener('dragover', onTabDragOver)
        el.addEventListener('dragleave', onTabDragLeave)
        el.addEventListener('drop', onTabDrop)
        el.addEventListener('dragend', onTabDragEnd)
        list.appendChild(el)
      })
      updateToolbarActions()
      updateEntryAffordance()
      maybeShowWelcomeGuide()
    }

    function onTabDragStart(event) {
      draggedTabId = Number(event.currentTarget.dataset.tabId)
      event.dataTransfer.effectAllowed = 'move'
    }

    function onTabDragOver(event) {
      const refs = getRefs()
      if (draggedTabId === null) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      const el = event.currentTarget
      const rect = el.getBoundingClientRect()
      const after = event.clientX > rect.left + rect.width / 2
      refs.tabList.querySelectorAll('.file-tab').forEach(tabEl => {
        if (tabEl !== el) tabEl.classList.remove('drag-before', 'drag-after')
      })
      el.classList.toggle('drag-before', !after)
      el.classList.toggle('drag-after', after)
    }

    function onTabDragLeave(event) {
      event.currentTarget.classList.remove('drag-before', 'drag-after')
    }

    function onTabDrop(event) {
      if (draggedTabId === null) return
      event.preventDefault()
      const el = event.currentTarget
      const targetId = Number(el.dataset.tabId)
      const nextTabs = reorderTabsById(tabs, draggedTabId, targetId, event.clientX > el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2)
      if (nextTabs.length === tabs.length && nextTabs.every((tab, index) => tab === tabs[index])) {
        onTabDragEnd()
        return
      }
      tabs = nextTabs
      onTabDragEnd()
      renderTabBar()
    }

    function onTabDragEnd() {
      const refs = getRefs()
      refs.tabList.querySelectorAll('.file-tab').forEach(tabEl => { tabEl.classList.remove('drag-before', 'drag-after') })
      draggedTabId = null
    }

    async function createTab(data) {
      if (data.path) {
        const existing = findTabByPath(data.path)
        if (existing) {
          switchToTab(existing.id)
          return existing
        }
      }
      const refs = getRefs()
      const tab = {
        id: ++tabIdCounter,
        filename: data.filename || 'untitled.md',
        path: data.path || null,
        content: data.content,
        savedContent: data.content,
        dirty: false,
        scrollTop: 0,
        renderedHTML: null,
        tocHTML: null,
      }
      tabs.push(tab)
      if (activeTabId !== null) saveCurrentTabState()
      activeTabId = tab.id
      setMarkdown(tab.content)
      setSourceMode(false)
      applySourceMode()
      await render(tab.content, tab.filename, tab.path)
      tab.renderedHTML = refs.content.innerHTML
      tab.tocHTML = refs.tocList.innerHTML
      renderTabBar()
      if (tab.path) watchFile(tab.path)
      return tab
    }

    function switchToTab(tabId) {
      if (tabId === activeTabId) return
      const target = tabs.find(tab => tab.id === tabId)
      if (!target) return
      saveCurrentTabState()
      activeTabId = tabId
      setMarkdown(target.content)
      restoreTabState(target)
      renderTabBar()
      if (target.path) watchFile(target.path)
    }

    function closeTab(tabId) {
      const idx = tabs.findIndex(tab => tab.id === tabId)
      if (idx === -1) return
      if (tabs[idx].dirty && !confirmClose('저장하지 않은 변경 사항이 있습니다. 닫으시겠습니까?')) return
      const nextActiveTabId = getNextActiveTabIdAfterClose(tabs, tabId, activeTabId)
      tabs.splice(idx, 1)
      if (tabs.length === 0) {
        activeTabId = null
        showEmptyState()
        renderTabBar()
        watchFile(null)
        return
      }
      if (activeTabId === tabId) {
        activeTabId = nextActiveTabId
        const nextTab = getActiveTab()
        setMarkdown(nextTab.content)
        restoreTabState(nextTab)
        if (nextTab.path) watchFile(nextTab.path)
      }
      renderTabBar()
    }

    function closeOtherTabs(tabId) {
      const target = tabs.find(tab => tab.id === tabId)
      if (!target) return
      const dirtyOthers = tabs.some(tab => tab.id !== tabId && tab.dirty)
      if (dirtyOthers && !confirmClose('저장하지 않은 변경 사항이 있는 다른 탭이 있습니다. 닫으시겠습니까?')) return
      tabs = tabs.filter(tab => tab.id === tabId)
      activeTabId = tabId
      setMarkdown(target.content)
      restoreTabState(target)
      renderTabBar()
      if (target.path) watchFile(target.path)
    }

    function closeAllTabs() {
      const hasDirty = tabs.some(tab => tab.dirty)
      if (hasDirty && !confirmClose('저장하지 않은 변경 사항이 있는 탭이 있습니다. 모두 닫으시겠습니까?')) return
      tabs = []
      activeTabId = null
      showEmptyState()
      renderTabBar()
      watchFile(null)
    }

    async function openTabInNewWindow(tabId) {
      const tab = tabs.find(item => item.id === tabId)
      if (!tab) return
      await openNewWindow(tab.path || null)
    }

    function closeCurrentTab() {
      if (activeTabId !== null) closeTab(activeTabId)
    }

    function switchToNextTab() {
      const idx = tabs.findIndex(tab => tab.id === activeTabId)
      if (idx < tabs.length - 1) switchToTab(tabs[idx + 1].id)
    }

    function switchToPrevTab() {
      const idx = tabs.findIndex(tab => tab.id === activeTabId)
      if (idx > 0) switchToTab(tabs[idx - 1].id)
    }

    async function handleExternalFileChange({ path, content }) {
      const refs = getRefs()
      const tab = findTabByPath(path)
      if (!tab) return
      tab.content = content
      tab.savedContent = content
      tab.dirty = false
      if (tab.id === activeTabId) {
        setMarkdown(content)
        await render(content, tab.filename, tab.path)
        tab.renderedHTML = refs.content.innerHTML
        tab.tocHTML = refs.tocList.innerHTML
      }
      renderTabBar()
    }

    function updateActiveTabDirtyFromEditor(value) {
      const tab = getActiveTab()
      if (!tab) return
      tab.dirty = value !== tab.savedContent
      renderTabBar()
    }

    return {
      createTab,
      switchToTab,
      closeTab,
      closeOtherTabs,
      closeAllTabs,
      closeCurrentTab,
      switchToNextTab,
      switchToPrevTab,
      findTabByPath,
      getActiveTab,
      getTabCount,
      handleExternalFileChange,
      updateActiveTabDirtyFromEditor,
      renderTabBar,
    }
  }

  const api = {
    createWorkspaceController,
    findTabByPathInTabs,
    getNextActiveTabIdAfterClose,
    reorderTabsById,
  }
  globalScope.MDVWorkspace = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
