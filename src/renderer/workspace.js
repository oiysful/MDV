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

  // Any edit made while looking at the raw text (source or split view) must invalidate the
  // cached preview HTML, not just split-view edits — otherwise a pure-source-mode edit (e.g.
  // deleting an image line) gets snapshotted as stale HTML and served again on tab switch.
  function shouldMarkPreviewDirty({ sourceMode, splitMode, contentChanged }) {
    return (sourceMode || splitMode) && contentChanged
  }

  function resolveExternalChangeAction({ event, isDirty, isActive }) {
    if (event === 'unlink') return 'mark-deleted'
    if (isDirty) return isActive ? 'confirm' : 'mark-conflict'
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
    watchPath,
    unwatchPath,
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
    let tabKeyboardBound = false
    const { getRovingIndex } = globalScope.MDVRoving

    function syncDirtyState() {
      const hasDirty = computeAggregateDirty(tabs)
      if (hasDirty === lastReportedDirty) return
      lastReportedDirty = hasDirty
      reportDirtyState?.(hasDirty)
    }

    function findTabByPath(targetPath) {
      return findTabByPathInTabs(tabs, targetPath)
    }

    function findTabsByImagePath(imagePath) {
      return tabs.filter(tab => tab.watchedImagePaths && tab.watchedImagePaths.has(imagePath))
    }

    // Keeps the watcher subscriptions for a tab's embedded images in sync with what
    // its last render actually resolved, so a changed image is caught even when the
    // document itself never changes (main.js already supports per-path multi-subscriber
    // watching; this is what actually points it at rendered image paths).
    function syncTabImageWatches(tab, imagePaths) {
      const next = imagePaths instanceof Set ? imagePaths : new Set(imagePaths || [])
      const prev = tab.watchedImagePaths || new Set()
      for (const path of prev) {
        if (!next.has(path)) unwatchPath(path)
      }
      for (const path of next) {
        if (!prev.has(path)) watchPath(path)
      }
      tab.watchedImagePaths = next
    }

    function releaseTabWatches(tab) {
      if (tab.path) unwatchPath(tab.path)
      if (tab.watchedImagePaths) {
        for (const path of tab.watchedImagePaths) unwatchPath(path)
        tab.watchedImagePaths = null
      }
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
        if (shouldMarkPreviewDirty({ sourceMode, splitMode, contentChanged: nextContent !== tab.content })) tab.previewDirty = true
        tab.content = nextContent
        setMarkdown(tab.content)
      }
      if (splitMode && tab.previewDirty) {
        tab.renderedHTML = ''
        tab.tocHTML = ''
      } else {
        tab.renderedHTML = markdownController.captureSnapshotHTML()
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
      // previewDirty also gets set on a background tab that picked up an external
      // change while inactive (see applyExternalContent) — its cached renderedHTML
      // is stale relative to tab.content, regardless of split mode, so re-render here.
      if (tab.previewDirty) {
        const renderVersion = ++restoreRenderVersion
        void render(tab.content, tab.filename || '', tab.path || null).then(imagePaths => {
          if (getActiveTab() !== tab || renderVersion !== restoreRenderVersion) {
            restoreActiveTabState()
            return
          }
          tab.renderedHTML = markdownController.captureSnapshotHTML()
          tab.tocHTML = refs.tocList.innerHTML
          tab.previewDirty = false
          syncTabImageWatches(tab, imagePaths)
          if (tab.splitMode) refs.content.scrollTop = tab.previewScrollTop || 0
          else refs.scrollArea.scrollTop = tab.scrollTop || 0
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

    // Roving-tabindex focus move within the tablist: only one tab is Tab-reachable
    // (tabindex="0"); the rest are -1 and reached with arrow keys. Focus follows the 0.
    function focusTabElement(el) {
      const list = getRefs().tabList
      list.querySelectorAll('.file-tab').forEach(tabEl => { tabEl.tabIndex = -1 })
      el.tabIndex = 0
      el.focus()
    }

    // Manual activation (ARIA APG): arrows move focus only, never switch tabs — switching
    // reloads/restores tab state (see switchToTab), too costly to fire on every arrow press.
    // Enter/Space perform the real switch. One delegated listener on the persistent #tab-list
    // container survives every renderTabBar() innerHTML rebuild.
    function bindTabKeyboard(list) {
      if (tabKeyboardBound) return
      tabKeyboardBound = true
      list.addEventListener('keydown', event => {
        // Let the real close <button> keep its native Enter/Space and stay Tab-reachable.
        if (event.target.closest('.file-tab-close')) return
        const current = event.target.closest('.file-tab')
        if (!current) return
        const tabEls = Array.from(list.querySelectorAll('.file-tab'))
        const index = tabEls.indexOf(current)
        if (index === -1) return
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault()
          const step = event.key === 'ArrowRight' ? 1 : -1
          focusTabElement(tabEls[getRovingIndex(index, step, tabEls.length)])
        } else if (event.key === 'Home') {
          event.preventDefault()
          focusTabElement(tabEls[0])
        } else if (event.key === 'End') {
          event.preventDefault()
          focusTabElement(tabEls[tabEls.length - 1])
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          switchToTab(Number(current.dataset.tabId))
        }
      })
    }

    function renderTabBar() {
      const refs = getRefs()
      const list = refs.tabList
      bindTabKeyboard(list)
      // Preserve keyboard focus across the full innerHTML rebuild, but only if a tab was the
      // focused element — never yank focus out of the editor during dirty-state re-renders.
      const focusedTabId = document.activeElement?.classList?.contains('file-tab')
        ? Number(document.activeElement.dataset.tabId)
        : null
      refs.tabStrip.classList.toggle('hidden', tabs.length === 0)
      list.innerHTML = ''
      let activeEl = null
      tabs.forEach(tab => {
        const el = document.createElement('div')
        el.className = 'file-tab' + (tab.id === activeTabId ? ' active' : '') + (tab.conflictPending ? ' has-conflict' : '')
        el.dataset.tabId = tab.id
        el.draggable = true
        el.setAttribute('role', 'tab')
        el.setAttribute('aria-selected', tab.id === activeTabId ? 'true' : 'false')
        el.setAttribute('aria-label', tab.filename)
        el.tabIndex = tab.id === activeTabId ? 0 : -1
        const name = document.createElement('span')
        name.className = 'file-tab-name'
        const marker = tab.conflictPending ? '⚠ ' : (tab.dirty ? '● ' : '')
        name.textContent = `${marker}${tab.filename}`
        if (tab.conflictPending) name.title = '이 파일이 외부에서 변경되었습니다. 탭을 열면 확인합니다.'
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
        if (tab.id === activeTabId) activeEl = el
      })
      // Sole chokepoint for tab-active DOM state (see docs/plans/07-tab-scroll-into-view.md) —
      // scrolling here covers keyboard shortcuts, clicks, close/reorder, and restore alike.
      activeEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      if (focusedTabId !== null) {
        const restore = list.querySelector(`.file-tab[data-tab-id="${focusedTabId}"]`)
        if (restore) focusTabElement(restore)
      }
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
      const imagePaths = await render(tab.content, tab.filename, tab.path)
      tab.renderedHTML = markdownController.captureSnapshotHTML()
      tab.tocHTML = refs.tocList.innerHTML
      syncTabImageWatches(tab, imagePaths)
      renderTabBar()
      if (tab.path) watchPath(tab.path)
      return tab
    }

    async function switchToTab(tabId) {
      if (tabId === activeTabId) return
      const target = tabs.find(tab => tab.id === tabId)
      if (!target) return
      closeSearch?.()
      saveCurrentTabState()
      activeTabId = tabId
      setMarkdown(target.content)
      restoreTabState(target)
      renderTabBar()
      await resolvePendingConflict(target)
    }

    function closeTab(tabId) {
      const idx = tabs.findIndex(tab => tab.id === tabId)
      if (idx === -1) return
      if (tabs[idx].dirty && !confirmClose('저장하지 않은 변경 사항이 있습니다. 닫으시겠습니까?')) return
      if (tabId === activeTabId) closeSearch?.()
      const nextActiveTabId = getNextActiveTabIdAfterClose(tabs, tabId, activeTabId)
      const [closedTab] = tabs.splice(idx, 1)
      releaseTabWatches(closedTab)
      if (tabs.length === 0) {
        activeTabId = null
        showEmptyState()
        renderTabBar()
        return
      }
      if (activeTabId === tabId) {
        activeTabId = nextActiveTabId
        const nextTab = getActiveTab()
        setMarkdown(nextTab.content)
        restoreTabState(nextTab)
      }
      renderTabBar()
    }

    function closeOtherTabs(tabId) {
      const target = tabs.find(tab => tab.id === tabId)
      if (!target) return
      const dirtyOthers = tabs.some(tab => tab.id !== tabId && tab.dirty)
      if (dirtyOthers && !confirmClose('저장하지 않은 변경 사항이 있는 다른 탭이 있습니다. 닫으시겠습니까?')) return
      closeSearch?.()
      for (const tab of tabs) {
        if (tab.id !== tabId) releaseTabWatches(tab)
      }
      tabs = tabs.filter(tab => tab.id === tabId)
      activeTabId = tabId
      setMarkdown(target.content)
      restoreTabState(target)
      renderTabBar()
    }

    function closeAllTabs() {
      const hasDirty = tabs.some(tab => tab.dirty)
      if (hasDirty && !confirmClose('저장하지 않은 변경 사항이 있는 탭이 있습니다. 모두 닫으시겠습니까?')) return
      closeSearch?.()
      for (const tab of tabs) releaseTabWatches(tab)
      tabs = []
      activeTabId = null
      showEmptyState()
      renderTabBar()
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

    async function applyExternalContent(tab, content) {
      tab.content = content
      tab.savedContent = content
      tab.dirty = false
      if (tab.id !== activeTabId) {
        // Cached renderedHTML is now stale; restoreTabState re-renders once this
        // tab is actually activated instead of paying for it while backgrounded.
        tab.previewDirty = true
        return
      }
      const refs = getRefs()
      setMarkdown(content)
      if (getSourceMode()) {
        refs.sourceEditor.value = content
      }
      // The doc changed externally; any of its images could have changed with it,
      // and the self-write echo on our own saves means this is the only place that
      // reliably fires for an externally-edited document.
      markdownController.clearImageCache()
      const imagePaths = await render(content, tab.filename, tab.path)
      tab.renderedHTML = markdownController.captureSnapshotHTML()
      tab.tocHTML = refs.tocList.innerHTML
      tab.previewDirty = false
      syncTabImageWatches(tab, imagePaths)
      if (getSourceMode()) {
        applySourceMode()
      } else if (getSplitMode()) {
        refs.sourceEditor.value = content
        applySourceMode()
      }
    }

    // A background tab that's dirty when an external change lands can't be resolved
    // right away without popping a modal for a tab the user isn't even looking at.
    // Stash the disk content and ask when they actually switch to it.
    async function resolvePendingConflict(tab) {
      const pending = tab.conflictPending
      if (!pending) return
      tab.conflictPending = null
      const reload = confirmClose(`"${tab.filename}"이(가) 외부에서 변경되었습니다. 편집 중인 내용을 버리고 디스크 내용으로 다시 불러오시겠습니까?`)
      if (!reload) {
        renderTabBar()
        return
      }
      await applyExternalContent(tab, pending.content)
      renderTabBar()
    }

    // A changed path that isn't any tab's document is one of the rendered image
    // paths we asked main.js to watch (see syncTabImageWatches). Evict just that
    // cache entry and refresh every tab that embeds it.
    async function handleExternalImageChange(imagePath) {
      const affectedTabs = findTabsByImagePath(imagePath)
      if (!affectedTabs.length) return
      markdownController.clearImageCacheEntry(imagePath)
      for (const tab of affectedTabs) {
        if (tab.id !== activeTabId) {
          tab.previewDirty = true
          continue
        }
        const refs = getRefs()
        const imagePaths = await render(tab.content, tab.filename, tab.path)
        tab.renderedHTML = markdownController.captureSnapshotHTML()
        tab.tocHTML = refs.tocList.innerHTML
        tab.previewDirty = false
        syncTabImageWatches(tab, imagePaths)
      }
      renderTabBar()
    }

    async function handleExternalFileChange({ path, content, event }) {
      const tab = findTabByPath(path)
      if (!tab) {
        await handleExternalImageChange(path)
        return
      }

      // Our own save comes back through the watcher a moment later. Treating that
      // echo as an external edit would prompt the user to discard anything they
      // typed since saving, so ignore a change whose content is what we just wrote.
      if (isSelfWriteEcho({ event, content, savedContent: tab.savedContent })) return

      const action = resolveExternalChangeAction({ event, isDirty: tab.dirty, isActive: tab.id === activeTabId })

      if (action === 'mark-deleted') {
        // File was removed on disk. Keep the buffer so the user can re-save it,
        // and force dirty so it survives further keystrokes and save-conflict checks.
        tab.dirty = true
        tab.savedContent = null
        renderTabBar()
        return
      }

      if (action === 'mark-conflict') {
        tab.conflictPending = { content, event }
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

      await applyExternalContent(tab, content)
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
      syncTabImageWatches,
    }
  }

  const api = {
    createWorkspaceController,
    findTabByPathInTabs,
    getNextActiveTabIdAfterClose,
    reorderTabsById,
    stripMarkdownExtension,
    computeAggregateDirty,
    shouldMarkPreviewDirty,
    resolveExternalChangeAction,
    isSelfWriteEcho,
  }
  globalScope.MDVWorkspace = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
