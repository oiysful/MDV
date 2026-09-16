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
    onDefaultAppGuideDismissed,
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
      const res = await api.revealInFinder(targetPath)
      if (res.error) alert(`Finder 표시 실패: ${res.error}`)
    }

    async function checkMarkdownDefaultAppStatus() {
      if (!api.getMarkdownDefaultAppStatus) return
      const status = await api.getMarkdownDefaultAppStatus()
      onboardingController.updateDefaultAppGuide(status)
    }

    function dismissDefaultAppGuide() {
      onboardingController.dismissDefaultAppGuide()
      // The guide is the only element the update banner defers to (see update-notice.js's
      // isBlockedByModal) -- closing it may reveal a banner that was suppressed underneath.
      onDefaultAppGuideDismissed?.()
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
        // Wrap only affects #source-editor's rendering (editor.js's wrap-mode CSS), so it has
        // no visible effect in plain preview -- show it only where it can do something.
        const editor = getEditorController()
        const inEditor = Boolean(activeTab) && Boolean(editor?.getSourceMode() || editor?.getSplitMode())
        refs.btnWrap.disabled = !inEditor
        refs.btnWrap.style.display = inEditor ? '' : 'none'
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

    // Split view force-closes the sidebar and disables its button (editor.js#setSplitMode),
    // but the command path (menu accelerator, renderer-command IPC) never passed through that
    // block -- without this guard ⌘B reopens the panel split view just closed. It belongs here
    // and not in applySidebarOpen: setSplitMode drives that function (handed in as
    // setSidebarOpen) to do the force-close/restore itself, so guarding there would break
    // split view's own sidebar handling.
    function toggleSidebar() {
      if (getEditorController()?.getSplitMode()) return
      applySidebarOpen(!getSidebarOpen())
    }

    // ⌘B is also the source editor's "bold" shortcut (editor.js), and the menu accelerator
    // fires alongside it regardless of the editor's preventDefault() (fb2284d's ⌘T
    // double-fire). With the editor focused, do nothing -- its own keydown already applied
    // the markers. Only the accelerator routes here; a mouse click on the menu item goes to
    // toggleSidebar and toggles unconditionally.
    function toggleSidebarFromShortcut() {
      if (documentRef.activeElement === getRefs().sourceEditor) return
      toggleSidebar()
    }

    function goTop() {
      getRefs().scrollArea.scrollTo({ top: 0, behavior: 'smooth' })
    }

    const PRINT_RESTORE_TIMEOUT_MS = 5000

    // Both `#content`'s @media print rules (index.html) and mermaid's baked-in SVG palette
    // and hljs's stylesheet swap need to be light for the duration of a print/PDF job, even
    // when the screen is in dark mode -- the @media print CSS variables handle the body, but
    // mermaid bakes its colors into the SVG at draw time and hljs is a stylesheet toggle, so
    // both need to be redrawn/swapped for real, then put back. themeController's stored theme
    // is never touched, so the screen's own state is unaffected once this resolves.
    async function withPrintPalette(run) {
      // Always return a promise -- a function whose whole job is sequencing must not sometimes
      // return a bare value and sometimes a promise, or callers desync.
      if (!themeController.getIsDark()) return await run()
      const refs = getRefs()
      themeController.applyCodeTheme(false)
      await markdownController.applyMermaidTheme(refs.content, false)
      try {
        return await run()
      } finally {
        // Re-read the live theme rather than assuming dark: the renderer isn't blocked while
        // the print/PDF job runs (the save dialog and printToPDF both live in the main
        // process), so a stored theme of 'auto' can flip light mid-job via
        // handleSystemThemeChange. Restoring to a stale "dark" in that case would reintroduce
        // this exact bug in the opposite direction. Swallow a restore failure (e.g. corrupt
        // data-mermaid-src) rather than let it replace the job's own result/error.
        try {
          const stillDark = themeController.getIsDark()
          themeController.applyCodeTheme(stillDark)
          await markdownController.applyMermaidTheme(refs.content, stillDark)
        } catch {}
      }
    }

    // windowRef.print() in Electron doesn't block on a system dialog like stock Chrome --
    // it hands off to the print job and returns immediately. Restoring on that return would
    // flip the palette back to dark before the job has actually captured the page, recreating
    // the same bug this is fixing. Restoration is instead driven by `afterprint`, with a timer
    // as a safety net in case some environment never fires it.
    async function printDoc() {
      if (ensurePreviewRendered) await ensurePreviewRendered()
      await withPrintPalette(() => new Promise(resolve => {
        let done = false
        const finish = () => {
          if (done) return
          done = true
          windowRef.clearTimeout(timer)
          windowRef.removeEventListener('afterprint', finish)
          resolve()
        }
        const timer = windowRef.setTimeout(finish, PRINT_RESTORE_TIMEOUT_MS)
        windowRef.addEventListener('afterprint', finish, { once: true })
        windowRef.print()
      }))
    }

    async function exportPdf() {
      const tab = getWorkspaceController().getActiveTab()
      if (!tab) return
      if (ensurePreviewRendered) await ensurePreviewRendered()
      const suggestedName = `${(tab.filename || 'untitled.md').replace(/\.(md|markdown)$/i, '')}.pdf`
      const res = await withPrintPalette(() => api.exportPdf(suggestedName))
      if (res.error) {
        alert(`PDF 내보내기 실패: ${res.error}`)
        return
      }
      if (!res.cancelled) showToast('PDF 저장됨')
    }

    async function toggleSource() {
      await getEditorController().toggleSource()
      updateToolbarActions()
    }

    async function toggleSplitView() {
      await getEditorController().toggleSplitView()
      updateToolbarActions()
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
      // Sibling of toggleSidebar's split-view guard, and it has to be here rather than in
      // applySidebarOpen for the same reason (setSplitMode drives that function). Without it
      // openFolder's switchToExplorerTab() reopens the sidebar split view force-closed, and
      // nothing can close it again: #btn-sidebar stays disabled (editor.js#setSplitMode is the
      // only thing that sets it) and both sidebar commands hit their own guard, so the only
      // way out is toggling split view twice. ⌘⇧O made that trap a single keystroke away.
      if (!getSidebarOpen() && !getEditorController()?.getSplitMode()) {
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
      updateToolbarActions()
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
      try {
        await navigator.clipboard.writeText(markdown)
      } catch (err) {
        showToast('복사 실패')
        return
      }
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

    function isEditorSearchActive() {
      return searchController.isSearchOpen() && searchController.getCurrentTarget() === 'editor'
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

    const COPY_ICON = '<svg class="icon-copy" aria-hidden="true" width="12" height="12" viewBox="0 0 13 13" fill="none"><rect x="4.5" y="4.5" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 10.5V2.5h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    const CHECK_ICON = '<svg class="icon-check" aria-hidden="true" width="12" height="12" viewBox="0 0 13 13" fill="none"><path d="M2 6.5L5 9.5L11 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'

    async function copyCode(button) {
      const code = button.closest('.code-wrapper').querySelector('code')
      try {
        await navigator.clipboard.writeText(code?.innerText || '')
      } catch (err) {
        showToast('코드 복사 실패')
        return
      }
      button.innerHTML = CHECK_ICON
      button.classList.add('copied')
      showToast('코드 복사됨')
      setTimeout(() => {
        button.innerHTML = COPY_ICON
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

      // hljs (and mermaid) palette for print/PDF is owned entirely by withPrintPalette now --
      // it awaits the actual redraw and restores via this same `afterprint` event, so a second
      // independent beforeprint/afterprint listener pair here would race it (this one used to
      // flip hljs back to dark on `afterprint` with no coordination, which could land before
      // withPrintPalette's own restore, or paper over its results).

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
      toggleSidebarFromShortcut,
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
      isEditorSearchActive,
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
