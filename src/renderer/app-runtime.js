(function (globalScope) {
  function getNextUntitledFilename(counter) {
    return counter === 1 ? 'untitled.md' : `untitled-${counter}.md`
  }

  function createEmptyStateHtml() {
    return `<div id="empty">
  <div class="empty-icon">📄</div>
  <div class="empty-title">열린 파일 없음</div>
  <div class="empty-sub">
    좌측 상단의 <strong>열기</strong> 버튼을 누르거나<br>
    아래 버튼 또는 드래그 앤 드롭으로 시작하세요<br><br>
    <kbd>.md</kbd>&nbsp; <kbd>.markdown</kbd>
  </div>
  <div class="empty-actions">
    <button class="empty-cta" type="button" data-command="openFile" title="파일 열기" aria-label="파일 열기">파일 열기</button>
    <button class="empty-cta secondary" type="button" data-command="openFolder" title="폴더 열기" aria-label="폴더 열기">폴더 열기</button>
  </div>
</div>`
  }

  function createAppRuntimeController({
    getRefs,
    documentRef,
    windowRef,
    api,
    sysDark,
    markdownController,
    themeController,
    onboardingController,
    searchController,
    getMarkdown,
    setMarkdown,
    getSidebarOpen,
    setSidebarOpen,
    setActiveTabName,
    getEditorController,
    getExplorerController,
    getWorkspaceController,
    getDocumentFlowController,
    getShellActionsController,
    getContextMenuController,
    ensurePreviewRendered,
  }) {
    let untitledCounter = 0

    async function openFile() {
      await getDocumentFlowController().openFile()
    }

    async function load(data) {
      await getDocumentFlowController().load(data)
    }

    function showEmptyState() {
      const refs = getRefs()
      refs.content.innerHTML = createEmptyStateHtml()
      refs.content.classList.add('is-empty')
      refs.content.style.display = ''
      refs.sourceView.style.display = 'none'
      refs.scrollArea.classList.remove('source-mode', 'split-mode')
      documentRef.title = 'MDV'
      if (refs.btnMode) {
        refs.btnMode.style.display = 'none'
        refs.btnMode.classList.remove('source-active')
      }
      if (refs.btnSplit) {
        refs.btnSplit.disabled = true
        refs.btnSplit.style.display = 'none'
        refs.btnSplit.classList.remove('split-active')
      }
      if (refs.btnWrap) {
        refs.btnWrap.disabled = true
        refs.btnWrap.style.display = 'none'
      }
      markdownController.resetEmptyStats()
      getEditorController()?.setSourceMode(false)
      getEditorController()?.setSplitMode(false)
      setMarkdown('')
    }

    function syncExplorerHeader() {
      return getExplorerController()?.syncExplorerHeader()
    }

    function clearExplorerRoot() {
      return getExplorerController()?.clearExplorerRoot()
    }

    function toggleExplorerPathInfo() {
      return getExplorerController()?.toggleExplorerPathInfo()
    }

    async function revealInFinder(targetPath) {
      if (!targetPath) return
      const res = JSON.parse(await api.revealInFinder(targetPath))
      if (res.error) alert(`Finder 표시 실패: ${res.error}`)
    }

    async function checkMarkdownDefaultAppStatus() {
      if (!api.getMarkdownDefaultAppStatus) return
      const status = JSON.parse(await api.getMarkdownDefaultAppStatus())
      onboardingController.updateDefaultAppGuide(status)
    }

    function dismissDefaultAppGuide() {
      onboardingController.dismissDefaultAppGuide()
    }

    function showShortcuts() {
      getRefs().shortcutsGuide?.classList.add('show')
    }

    function hideShortcuts() {
      getRefs().shortcutsGuide?.classList.remove('show')
    }

    function showToast(message) {
      return onboardingController.showToast(message)
    }

    function updateEntryAffordance() {
      return onboardingController.updateEntryAffordance()
    }

    function dismissWelcomeGuide(persist = true) {
      return onboardingController.dismissWelcomeGuide(persist)
    }

    function maybeShowWelcomeGuide() {
      return onboardingController.maybeShowWelcomeGuide()
    }

    async function openFromGuide(kind) {
      await getShellActionsController().openFromGuide(kind)
    }

    function updateToolbarActions() {
      const refs = getRefs()
      if (!refs) return
      const activeTab = getWorkspaceController()?.getActiveTab() || null
      if (refs.btnSave) refs.btnSave.disabled = !activeTab?.dirty
      if (refs.btnPrint) refs.btnPrint.disabled = !activeTab
      if (refs.btnExportPdf) refs.btnExportPdf.disabled = !activeTab
      if (refs.btnSplit) {
        refs.btnSplit.disabled = !activeTab
        refs.btnSplit.style.display = activeTab ? '' : 'none'
      }
      if (refs.btnWrap) {
        refs.btnWrap.disabled = !activeTab
        refs.btnWrap.style.display = activeTab ? '' : 'none'
      }
    }

    function hideAppContextMenu() {
      getContextMenuController()?.hide()
    }

    function showAppContextMenu(x, y, items) {
      getContextMenuController()?.show(x, y, items)
    }

    function closeCurrentTab() {
      const workspace = getWorkspaceController()
      if (workspace.getTabCount() === 0) {
        windowRef.close()
        return
      }
      workspace.closeCurrentTab()
    }

    function switchToNextTab() {
      getWorkspaceController().switchToNextTab()
    }

    function switchToPrevTab() {
      getWorkspaceController().switchToPrevTab()
    }

    // Combines the state update with the DOM class toggle, so callers outside this
    // controller (e.g. editor.js forcing the sidebar closed on split-view entry) get
    // the same effect toggleSidebar produces, not just a state flag with no visible change.
    function applySidebarOpen(nextOpen) {
      const open = Boolean(nextOpen)
      setSidebarOpen(open)
      getRefs().sidebar.classList.toggle('closed', !open)
    }

    function toggleSidebar() {
      applySidebarOpen(!getSidebarOpen())
    }

    function goTop() {
      getRefs().scrollArea.scrollTo({ top: 0, behavior: 'smooth' })
    }

    async function printDoc() {
      if (ensurePreviewRendered) await ensurePreviewRendered()
      windowRef.print()
    }

    async function exportPdf() {
      const tab = getWorkspaceController().getActiveTab()
      if (!tab) return
      if (ensurePreviewRendered) await ensurePreviewRendered()
      const suggestedName = `${(tab.filename || 'untitled.md').replace(/\.(md|markdown)$/i, '')}.pdf`
      const res = JSON.parse(await api.exportPdf(suggestedName))
      if (res.error) {
        alert(`PDF 내보내기 실패: ${res.error}`)
        return
      }
      if (!res.cancelled) showToast('PDF 저장됨')
    }

    async function toggleSource() {
      await getEditorController().toggleSource()
    }

    async function toggleSplitView() {
      await getEditorController().toggleSplitView()
    }

    function toggleWrap() {
      getEditorController()?.toggleWrap()
    }

    function switchTab(tab) {
      const refs = getRefs()
      setActiveTabName(tab)
      refs.panelToc.style.display = tab === 'toc' ? '' : 'none'
      refs.panelExplorer.style.display = tab === 'explorer' ? 'flex' : 'none'
      refs.sidebarTabs.dataset.active = tab
      documentRef.querySelectorAll('.stab').forEach(button => {
        button.classList.toggle('active', button.dataset.commandArg === tab)
      })
      if (!getSidebarOpen()) {
        setSidebarOpen(true)
        refs.sidebar.classList.remove('closed')
      }
    }

    async function newWindow() {
      await api.newWindow(null)
    }

    async function newFile() {
      untitledCounter += 1
      const name = getNextUntitledFilename(untitledCounter)
      await getWorkspaceController().createTab({ content: '', filename: name, path: null })
      getEditorController().openInSourceMode()
    }

    async function saveFile() {
      await getDocumentFlowController().saveFile()
    }

    async function saveFileAs() {
      await getDocumentFlowController().saveFileAs()
    }

    async function openFolder() {
      await getExplorerController().openFolder()
    }

    function toggleAddMenu(event) {
      getShellActionsController().toggleAddMenu(event)
    }

    function hideAddMenu() {
      getShellActionsController().hideAddMenu()
    }

    async function copyAll() {
      const markdown = getMarkdown()
      if (!markdown) return
      await navigator.clipboard.writeText(markdown)
      const button = documentRef.getElementById('btn-copy-all')
      button.classList.add('copied')
      showToast('복사됨')
      setTimeout(() => button.classList.remove('copied'), 1500)
    }

    function toggleSearch() {
      const editor = getEditorController()
      const inEditor = editor.getSourceMode() || editor.getSplitMode()
      return searchController.toggleSearch({ target: inEditor ? 'editor' : 'preview' })
    }

    function closeSearch() {
      return searchController.closeSearch()
    }

    function clearSearchHighlights() {
      return searchController.clearSearchHighlights()
    }

    function runSearch(query) {
      return searchController.runSearch(query)
    }

    function highlightCurrent() {
      return searchController.highlightCurrent()
    }

    function searchNext() {
      return searchController.searchNext()
    }

    function searchPrev() {
      return searchController.searchPrev()
    }

    async function copyCode(button) {
      const code = button.closest('.code-wrapper').querySelector('code')
      await navigator.clipboard.writeText(code?.innerText || '')
      button.textContent = '✓ 복사됨'
      button.classList.add('copied')
      showToast('코드 복사됨')
      setTimeout(() => {
        button.textContent = '복사'
        button.classList.remove('copied')
      }, 1500)
    }

    function applyTheme() {
      return themeController.applyTheme()
    }

    function toggleTheme() {
      return themeController.toggleTheme()
    }

    function onDragOver(event) {
      getShellActionsController().onDragOver(event)
    }

    function onDragLeave() {
      getShellActionsController().onDragLeave()
    }

    async function onDrop(event) {
      await getShellActionsController().onDrop(event)
    }

    function bindGlobalEvents() {
      sysDark.addEventListener('change', () => {
        themeController.handleSystemThemeChange()
      })

      windowRef.addEventListener('beforeprint', () => {
        documentRef.getElementById('hljs-dark').disabled = true
        documentRef.getElementById('hljs-light').disabled = false
      })

      windowRef.addEventListener('afterprint', () => {
        const isDark = documentRef.documentElement.getAttribute('data-theme') === 'dark'
        documentRef.getElementById('hljs-dark').disabled = !isDark
        documentRef.getElementById('hljs-light').disabled = isDark
      })

      // ⌘O/⌘N/⌘S/⌘⇧S/⌘T/⌘W/⌘U/⌘\/⌘F/⌘P/⌘⇧]/⌘⇧[ are handled by native menu
      // accelerators (src/main.js#buildMenu) so they aren't duplicated here — a
      // key with an accelerator fires the menu's click handler on top of any
      // keydown listener.
      documentRef.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          // Close one layer per press, topmost first: guides, then search, then the context menu.
          if (onboardingController.isDefaultAppGuideOpen()) dismissDefaultAppGuide()
          else if (getRefs().shortcutsGuide?.classList.contains('show')) hideShortcuts()
          else if (onboardingController.isWelcomeGuideOpen()) dismissWelcomeGuide()
          else if (searchController.isSearchOpen()) closeSearch()
          else hideAppContextMenu()
        }
      })

      documentRef.addEventListener('click', () => {
        hideAddMenu()
        hideAppContextMenu()
      })

      // While Cmd is held, flag the body so buttons with a real system accelerator
      // (src/main.js#buildMenu) reveal their shortcut badge immediately (no hover).
      const setCmdHeld = held => {
        documentRef.body.classList.toggle('cmd-held', held)
      }
      documentRef.addEventListener('keydown', event => {
        if (event.metaKey) setCmdHeld(true)
      })
      documentRef.addEventListener('keyup', event => {
        if (!event.metaKey) setCmdHeld(false)
      })
      // Cmd+Tab to another app never delivers keyup to this window, so blur is the
      // only reliable way to keep the badge from getting stuck on.
      windowRef.addEventListener('blur', () => setCmdHeld(false))
    }

    return {
      openFile,
      load,
      showEmptyState,
      syncExplorerHeader,
      clearExplorerRoot,
      toggleExplorerPathInfo,
      revealInFinder,
      checkMarkdownDefaultAppStatus,
      dismissDefaultAppGuide,
      showShortcuts,
      hideShortcuts,
      showToast,
      updateEntryAffordance,
      dismissWelcomeGuide,
      maybeShowWelcomeGuide,
      openFromGuide,
      updateToolbarActions,
      hideAppContextMenu,
      showAppContextMenu,
      closeCurrentTab,
      switchToNextTab,
      switchToPrevTab,
      toggleSidebar,
      setSidebarOpen: applySidebarOpen,
      goTop,
      printDoc,
      exportPdf,
      toggleSource,
      toggleSplitView,
      toggleWrap,
      switchTab,
      newWindow,
      newFile,
      saveFile,
      saveFileAs,
      openFolder,
      toggleAddMenu,
      hideAddMenu,
      copyAll,
      toggleSearch,
      closeSearch,
      clearSearchHighlights,
      runSearch,
      highlightCurrent,
      searchNext,
      searchPrev,
      copyCode,
      applyTheme,
      toggleTheme,
      onDragOver,
      onDragLeave,
      onDrop,
      bindGlobalEvents,
    }
  }

  const api = {
    createAppRuntimeController,
    createEmptyStateHtml,
    getNextUntitledFilename,
  }

  globalScope.MDVAppRuntime = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
