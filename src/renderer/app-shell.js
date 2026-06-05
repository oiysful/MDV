(function (globalScope) {
  function collectAppShellRefs(documentRef) {
    return {
      scrollArea: documentRef.getElementById('scroll-area'),
      content: documentRef.getElementById('content'),
      tocList: documentRef.getElementById('toc-list'),
      sWords: documentRef.getElementById('s-words'),
      sTime: documentRef.getElementById('s-time'),
      stats: documentRef.getElementById('stats'),
      sidebar: documentRef.getElementById('sidebar'),
      sidebarTabs: documentRef.getElementById('sidebar-tabs'),
      tabStrip: documentRef.getElementById('tab-strip'),
      tabList: documentRef.getElementById('tab-list'),
      appContextMenu: documentRef.getElementById('app-context-menu'),
      btnAdd: documentRef.getElementById('btn-add'),
      openEntryHint: documentRef.getElementById('open-entry-hint'),
      btnSave: documentRef.getElementById('btn-save'),
      btnPrint: documentRef.getElementById('btn-print'),
      btnExportPdf: documentRef.getElementById('btn-export-pdf'),
      btnSplit: documentRef.getElementById('btn-split'),
      goTop: documentRef.getElementById('go-top'),
      btnMode: documentRef.getElementById('btn-mode'),
      modeLabel: documentRef.getElementById('mode-label'),
      sourceView: documentRef.getElementById('source-view'),
      sourceEditor: documentRef.getElementById('source-editor'),
      sourceLines: documentRef.getElementById('source-lines'),
      dropOverlay: documentRef.getElementById('drop-overlay'),
      btnTheme: documentRef.getElementById('btn-theme'),
      icAuto: documentRef.getElementById('ic-auto'),
      icMoon: documentRef.getElementById('ic-moon'),
      icSun: documentRef.getElementById('ic-sun'),
      panelToc: documentRef.getElementById('panel-toc'),
      panelExplorer: documentRef.getElementById('panel-explorer'),
      explorerTree: documentRef.getElementById('explorer-tree'),
      explorerLabel: documentRef.getElementById('explorer-root-label'),
      explorerPath: documentRef.getElementById('explorer-root-path'),
      btnExplorerReveal: documentRef.getElementById('btn-explorer-reveal'),
      btnExplorerClose: documentRef.getElementById('btn-explorer-close'),
      toast: documentRef.getElementById('toast'),
      welcomeGuide: documentRef.getElementById('welcome-guide'),
      defaultAppGuide: documentRef.getElementById('default-app-guide'),
      defaultAppDoNotShow: documentRef.getElementById('default-app-do-not-show'),
    }
  }

  function createAppShellController({ documentRef, windowRef, api, getRefs, themeController, markdownController, getExplorerRoot, revealInFinder, clearExplorerRoot, showAppContextMenu, hideAppContextMenu, runSearch, searchNext, searchPrev, closeSearch, handleFileOpened, handleFileChanged, handleRendererCommand }) {
    function initializeUi({ applyTheme, sidebarOpen, activeTab, syncExplorerHeader, updateToolbarActions, updateEntryAffordance, maybeShowWelcomeGuide }) {
      const refs = getRefs()
      applyTheme()
      refs.sidebar.classList.toggle('closed', !sidebarOpen)
      refs.sidebarTabs.dataset.active = activeTab
      refs.stats.classList.add('empty')
      syncExplorerHeader()
      updateToolbarActions()
      updateEntryAffordance()
      maybeShowWelcomeGuide()
    }

    function registerIpcHandlers() {
      api.onThemeChanged(dark => {
        if (themeController.getTheme() === 'auto') {
          documentRef.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
        }
      })

      api.onFileOpened(async jsonStr => {
        await handleFileOpened(jsonStr)
      })

      api.onFileChanged(async ({ path, content }) => {
        await handleFileChanged({ path, content })
      })

      if (api.onRendererCommand && handleRendererCommand) {
        api.onRendererCommand(commandName => {
          Promise.resolve(handleRendererCommand(commandName)).catch(error => {
            console.error('렌더러 명령 처리 실패:', error)
          })
        })
      }
    }

    function bindContentLinkHandler() {
      getRefs().content.addEventListener('click', async event => {
        const link = event.target.closest('a[href]')
        if (!link) return
        const href = link.getAttribute('href')
        if (!href || href.startsWith('#')) return
        event.preventDefault()
        const res = JSON.parse(await api.openExternalUrl(href))
        if (res.error) alert(`링크 열기 실패: ${res.error}`)
      })
    }

    function bindExplorerContextMenus() {
      const refs = getRefs()

      refs.explorerLabel.addEventListener('contextmenu', event => {
        const root = getExplorerRoot()
        if (!root) return
        event.preventDefault()
        showAppContextMenu(event.clientX, event.clientY, [
          { label: 'Finder에 표시', action: () => revealInFinder(root) },
          { label: '폴더 닫기', action: () => clearExplorerRoot() },
        ])
      })

      refs.explorerTree.addEventListener('contextmenu', event => {
        const root = getExplorerRoot()
        if (!root) return
        const row = event.target.closest('.tree-row')
        if (row) return
        event.preventDefault()
        showAppContextMenu(event.clientX, event.clientY, [
          { label: 'Finder에 표시', action: () => revealInFinder(root) },
          { label: '폴더 닫기', action: () => clearExplorerRoot() },
        ])
      })
    }

    function bindScrollAndResizeHandlers() {
      const refs = getRefs()
      const scrollArea = refs.scrollArea
      let scrollTicking = false

      scrollArea.addEventListener('scroll', () => {
        if (scrollTicking) return
        scrollTicking = true
        windowRef.requestAnimationFrame(() => {
          scrollTicking = false
          refs.goTop.classList.toggle('on', scrollArea.scrollTop > 300)
          markdownController.refreshTocActive(scrollArea.scrollTop)
        })
      })

      windowRef.addEventListener('resize', () => {
        markdownController.refreshHeadingOffsets()
      })

      scrollArea.addEventListener('scroll', hideAppContextMenu)
    }

    function bindSearchEvents() {
      const searchInput = documentRef.getElementById('search-input')
      searchInput.addEventListener('input', () => runSearch(searchInput.value))
      searchInput.addEventListener('keydown', event => {
        if (event.key === 'Enter' && event.shiftKey) {
          event.preventDefault()
          searchPrev()
        } else if (event.key === 'Enter') {
          event.preventDefault()
          searchNext()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          closeSearch()
        }
      })
    }

    function getCommandPayload(trigger, event) {
      if (trigger.dataset.commandUsesEvent === 'true') return event
      if (trigger.dataset.commandElement === 'true') return trigger
      if ('commandArg' in trigger.dataset) return trigger.dataset.commandArg
      return undefined
    }

    async function runShellCommand(commands, trigger, event) {
      if (trigger.disabled) return
      const commandName = trigger.dataset.command
      const command = commands[commandName]
      if (!command) return
      event.preventDefault()
      if (trigger.dataset.hideAddMenu === 'true') commands.hideAddMenu?.()
      const payload = getCommandPayload(trigger, event)
      if (payload === undefined) await command()
      else await command(payload)
    }

    function bindCommandTrigger(trigger, commands) {
      trigger.addEventListener('click', event => {
        Promise.resolve(runShellCommand(commands, trigger, event)).catch(error => {
          console.error('셸 명령 실행 실패:', error)
        })
      })
    }

    function bindStaticCommandTriggers(commands) {
      const refs = getRefs()
      documentRef.querySelectorAll('[data-command]').forEach(trigger => {
        if (refs.content.contains(trigger)) return
        bindCommandTrigger(trigger, commands)
      })
    }

    function bindContentCommandHandler(commands) {
      const refs = getRefs()
      refs.content.addEventListener('click', event => {
        const trigger = event.target.closest('[data-command]')
        if (!trigger || !refs.content.contains(trigger)) return
        Promise.resolve(runShellCommand(commands, trigger, event)).catch(error => {
          console.error('콘텐츠 명령 실행 실패:', error)
        })
      })
    }

    function bindDragDropHandlers(commands) {
      const refs = getRefs()
      refs.scrollArea.addEventListener('dragover', event => commands.onDragOver?.(event))
      refs.scrollArea.addEventListener('dragleave', () => commands.onDragLeave?.())
      refs.scrollArea.addEventListener('drop', event => {
        Promise.resolve(commands.onDrop?.(event)).catch(error => {
          console.error('드롭 처리 실패:', error)
        })
      })
    }

    function bindUiEvents(commands = {}) {
      bindStaticCommandTriggers(commands)
      bindContentCommandHandler(commands)
      bindDragDropHandlers(commands)
      bindContentLinkHandler()
      bindExplorerContextMenus()
      bindScrollAndResizeHandlers()
      bindSearchEvents()
    }

    return {
      initializeUi,
      registerIpcHandlers,
      bindUiEvents,
    }
  }

  const api = {
    collectAppShellRefs,
    createAppShellController,
  }

  globalScope.MDVAppShell = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
