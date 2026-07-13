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

    function toggleSidebar() {
      const nextOpen = !getSidebarOpen()
      setSidebarOpen(nextOpen)
      getRefs().sidebar.classList.toggle('closed', !nextOpen)
    }

    function goTop() {
      getRefs().scrollArea.scrollTo({ top: 0, behavior: 'smooth' })
    }

    function printDoc() {
      windowRef.print()
    }

    async function exportPdf() {
      const tab = getWorkspaceController().getActiveTab()
      if (!tab) return
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

    function switchTab(tab) {
      const refs = getRefs()
      setActiveTabName(tab)
      refs.panelToc.style.display = tab === 'toc' ? '' : 'none'
      refs.panelExplorer.style.display = tab === 'explorer' ? 'flex' : 'none'
      refs.sidebarTabs.dataset.active = tab
      documentRef.querySelectorAll('.stab').forEach(button => {
        button.classList.toggle('active', button.dataset.tab === tab)
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
      if (editor.getSourceMode() || editor.getSplitMode()) return
      return searchController.toggleSearch()
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

      documentRef.addEventListener('keydown', event => {
        const modifier = event.metaKey || event.ctrlKey
        if (modifier && event.key === 'p') { event.preventDefault(); if (getMarkdown()) printDoc() }
        if (modifier && event.key === 'o') { event.preventDefault(); void openFile() }
        if (modifier && event.key === 't') { event.preventDefault(); void newFile() }
        if (modifier && event.key === 'n') { event.preventDefault(); void newWindow() }
        if (modifier && event.key === 'w') { event.preventDefault(); closeCurrentTab() }
        if (modifier && event.key === 'u') { event.preventDefault(); void toggleSource() }
        if (modifier && event.key === '\\') { event.preventDefault(); void toggleSplitView() }
        if (modifier && event.key === 'f') { event.preventDefault(); toggleSearch() }
        if (modifier && event.key.toLowerCase() === 's' && event.shiftKey) { event.preventDefault(); void saveFileAs() }
        if (modifier && event.key.toLowerCase() === 's' && !event.shiftKey) { event.preventDefault(); void saveFile() }
        if (modifier && event.shiftKey && (event.key === '}' || event.code === 'BracketRight')) { event.preventDefault(); switchToNextTab() }
        if (modifier && event.shiftKey && (event.key === '{' || event.code === 'BracketLeft')) { event.preventDefault(); switchToPrevTab() }
        if (event.key === 'Escape') closeSearch()
        if (event.key === 'Escape') hideAppContextMenu()
      })

      documentRef.addEventListener('click', () => {
        hideAddMenu()
        hideAppContextMenu()
      })
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
      goTop,
      printDoc,
      exportPdf,
      toggleSource,
      toggleSplitView,
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
