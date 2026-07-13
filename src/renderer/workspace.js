(function (globalScope) {
  function findTabByPathInTabs(tabs, targetPath) {
    if (!targetPath) return null
    return tabs.find(tab => tab.path === targetPath) || null
  }

  function stripMarkdownExtension(name) {
    return String(name ?? '').replace(/\.(md|markdown)$/i, '')
  }

  function computeAggregateDirty(tabs) {
    return tabs.some(tab => tab.dirty)
  }

  function resolveExternalChangeAction({ event, isDirty }) {
    if (event === 'unlink') return 'mark-deleted'
    if (isDirty) return 'confirm'
    return 'reload'
  }

  // A watcher 'change' carrying exactly the content we last wrote is our own save
  // echoing back, not an external edit. A deletion is always real.
  function isSelfWriteEcho({ event, content, savedContent }) {
    if (event === 'unlink') return false
    if (savedContent === null || savedContent === undefined) return false
    return content === savedContent
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
    getSplitMode,
    setSplitMode,
    setMarkdown,
    confirmClose,
    openNewWindow,
    reportDirtyState,
    closeSearch,
  }) {
    let tabs = []
    let activeTabId = null
    let tabIdCounter = 0
    let draggedTabId = null
    let restoreRenderVersion = 0
    let lastReportedDirty = false

    function syncDirtyState() {
      const hasDirty = computeAggregateDirty(tabs)
      if (hasDirty === lastReportedDirty) return
      lastReportedDirty = hasDirty
      reportDirtyState?.(hasDirty)
    }

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
      const sourceMode = getSourceMode()
      const splitMode = getSplitMode()
      tab.sourceMode = sourceMode
      tab.splitMode = splitMode
      tab.scrollTop = splitMode ? 0 : refs.scrollArea.scrollTop
      tab.previewScrollTop = splitMode ? refs.content.scrollTop || 0 : 0
      tab.sourceScrollTop = refs.sourceView.scrollTop || 0
      if (sourceMode || splitMode) {
        const nextContent = refs.sourceEditor.value
        if (splitMode && nextContent !== tab.content) tab.previewDirty = true
        tab.content = refs.sourceEditor.value
        setMarkdown(tab.content)
      }
      if (splitMode && tab.previewDirty) {
        tab.renderedHTML = ''
        tab.tocHTML = ''
      } else {
        tab.renderedHTML = refs.content.innerHTML
        tab.tocHTML = refs.tocList.innerHTML
      }
    }

    function restoreTabState(tab) {
      const refs = getRefs()
      refs.content.classList.remove('is-empty')
      markdownController.hydrateFromDom(tab.renderedHTML || '', tab.tocHTML || '', tab.content)
      document.title = stripMarkdownExtension(tab.filename || 'untitled.md')
      if (refs.btnMode) refs.btnMode.style.display = ''
      setSourceMode(tab.sourceMode || false)
      setSplitMode(tab.splitMode || false)
      applySourceMode()
      if (tab.splitMode && tab.previewDirty) {
        const renderVersion = ++restoreRenderVersion
        void render(tab.content, tab.filename || '', tab.path || null).then(() => {
          if (getActiveTab() !== tab || renderVersion !== restoreRenderVersion) {
            restoreActiveTabState()
            return
          }
          tab.renderedHTML = refs.content.innerHTML
          tab.tocHTML = refs.tocList.innerHTML
          tab.previewDirty = false
          refs.content.scrollTop = tab.previewScrollTop || 0
        })
      }
      requestAnimationFrame(() => {
        if (tab.splitMode) refs.content.scrollTop = tab.previewScrollTop || 0
        else refs.scrollArea.scrollTop = tab.scrollTop || 0
        refs.sourceView.scrollTop = tab.sourceScrollTop || 0
      })
    }

    function restoreActiveTabState() {
      const tab = getActiveTab()
      if (!tab) return
      setMarkdown(tab.content)
      restoreTabState(tab)
      renderTabBar()
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
        const name = document.createElement('span')
        name.className = 'file-tab-name'
        name.textContent = `${tab.dirty ? '● ' : ''}${tab.filename}`
        const closeButton = document.createElement('button')
        closeButton.className = 'file-tab-close'
        closeButton.innerHTML = '&times;'
        closeButton.title = '탭 닫기'
        closeButton.setAttribute('aria-label', '탭 닫기')
        el.title = tab.filename
        el.append(name, closeButton)
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
        closeButton.addEventListener('click', event => {
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
      syncDirtyState()
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
        sourceMode: false,
        splitMode: false,
        previewDirty: false,
        previewScrollTop: 0,
        sourceScrollTop: 0,
      }
      tabs.push(tab)
      if (activeTabId !== null) saveCurrentTabState()
      activeTabId = tab.id
      setMarkdown(tab.content)
      setSourceMode(false)
      setSplitMode(false)
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
      closeSearch?.()
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
      if (tabId === activeTabId) closeSearch?.()
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
      closeSearch?.()
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
      closeSearch?.()
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

    async function handleExternalFileChange({ path, content, event }) {
      const refs = getRefs()
      const tab = findTabByPath(path)
      if (!tab) return

      // Our own save comes back through the watcher a moment later. Treating that
      // echo as an external edit would prompt the user to discard anything they
      // typed since saving, so ignore a change whose content is what we just wrote.
      if (isSelfWriteEcho({ event, content, savedContent: tab.savedContent })) return

      const action = resolveExternalChangeAction({ event, isDirty: tab.dirty })

      if (action === 'mark-deleted') {
        // File was removed on disk. Keep the buffer so the user can re-save it,
        // and force dirty so it survives further keystrokes and save-conflict checks.
        tab.dirty = true
        tab.savedContent = null
        renderTabBar()
        return
      }

      if (action === 'confirm') {
        const reload = confirmClose(`"${tab.filename}"이(가) 외부에서 변경되었습니다. 편집 중인 내용을 버리고 디스크 내용으로 다시 불러오시겠습니까?`)
        if (!reload) {
          renderTabBar()
          return
        }
      }

      tab.content = content
      tab.savedContent = content
      tab.dirty = false
      if (tab.id === activeTabId) {
        setMarkdown(content)
        if (getSourceMode()) {
          refs.sourceEditor.value = content
        }
        await render(content, tab.filename, tab.path)
        tab.renderedHTML = refs.content.innerHTML
        tab.tocHTML = refs.tocList.innerHTML
        tab.previewDirty = false
        if (getSourceMode()) {
          applySourceMode()
        } else if (getSplitMode()) {
          refs.sourceEditor.value = content
          applySourceMode()
        }
      }
      renderTabBar()
    }

    function updateActiveTabDirtyFromEditor(value) {
      const tab = getActiveTab()
      if (!tab) return
      const nextDirty = value !== tab.savedContent
      if (nextDirty === tab.dirty) return
      tab.dirty = nextDirty
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
      restoreActiveTabState,
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
    stripMarkdownExtension,
    computeAggregateDirty,
    resolveExternalChangeAction,
    isSelfWriteEcho,
  }
  globalScope.MDVWorkspace = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
