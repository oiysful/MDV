(function (globalScope) {
  // Splits a link href on its first `#` into a file-path part and a fragment part.
  // Used to strip URL fragments (`#heading`) off local link hrefs before they reach
  // resolveLocalPath, which otherwise treats the whole href — fragment included — as
  // part of the file path. Always deterministic: the first `#` wins, so a filename
  // that itself contains a literal `#` (e.g. `a#b.md`) with no trailing anchor is
  // unaffected (fragment comes back empty only when there's no `#` at all).
  function splitHrefFragment(href) {
    const hashIndex = href.indexOf('#')
    if (hashIndex === -1) return { path: href, fragment: '' }
    return { path: href.slice(0, hashIndex), fragment: href.slice(hashIndex + 1) }
  }

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
      btnSidebar: documentRef.getElementById('btn-sidebar'),
      tabStrip: documentRef.getElementById('tab-strip'),
      tabList: documentRef.getElementById('tab-list'),
      appContextMenu: documentRef.getElementById('app-context-menu'),
      btnAdd: documentRef.getElementById('btn-add'),
      openEntryHint: documentRef.getElementById('open-entry-hint'),
      btnSave: documentRef.getElementById('btn-save'),
      btnPrint: documentRef.getElementById('btn-print'),
      btnExportPdf: documentRef.getElementById('btn-export-pdf'),
      btnSplit: documentRef.getElementById('btn-split'),
      btnWrap: documentRef.getElementById('btn-wrap'),
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
      shortcutsGuide: documentRef.getElementById('shortcuts-guide'),
      defaultAppDoNotShow: documentRef.getElementById('default-app-do-not-show'),
    }
  }

  function createAppShellController({ documentRef, windowRef, api, getRefs, pathUtils, themeController, markdownController, getExplorerRoot, revealInFinder, clearExplorerRoot, showAppContextMenu, hideAppContextMenu, runSearch, searchNext, searchPrev, getActiveTab, openLocalFile, handleFileOpened, handleFileChanged, handleRendererCommand }) {
    function initializeUi({ applyTheme, sidebarOpen, activeTab, syncExplorerHeader, updateToolbarActions, updateEntryAffordance, maybeShowWelcomeGuide, applyWrapMode }) {
      const refs = getRefs()
      applyTheme()
      refs.sidebar.classList.toggle('closed', !sidebarOpen)
      refs.sidebarTabs.dataset.active = activeTab
      refs.stats.classList.add('empty')
      syncExplorerHeader()
      updateToolbarActions()
      updateEntryAffordance()
      maybeShowWelcomeGuide()
      applyWrapMode()
    }

    function registerIpcHandlers() {
      api.onThemeChanged(dark => {
        if (themeController.getTheme() === 'auto') {
          documentRef.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
        }
      })

      api.onFileOpened(async payload => {
        await handleFileOpened(payload)
      })

      api.onFileChanged(async ({ path, content, event }) => {
        await handleFileChanged({ path, content, event })
      })

      if (api.onRendererCommand && handleRendererCommand) {
        api.onRendererCommand(commandName => {
          Promise.resolve(handleRendererCommand(commandName)).catch(error => {
            console.error('렌더러 명령 처리 실패:', error)
          })
        })
      }
    }

    async function openLocalLink(href) {
      // Strip a trailing URL fragment (`#heading`) before resolving — resolveLocalPath
      // treats the whole string as a file path, so a real anchor would otherwise be
      // read as part of the filename and fail to resolve. v1 drops the fragment; using
      // it to scroll to a heading after opening is a follow-up (see plan doc #5).
      const { path: targetPath } = splitHrefFragment(href)
      // Resolve relative hrefs against the active tab's directory. A relative link in
      // an unsaved (path-less) document has no base to resolve against.
      const docPath = getActiveTab ? getActiveTab()?.path || null : null
      const resolved = pathUtils.resolveLocalPath(targetPath, docPath)
      if (!resolved) {
        alert('링크 열기 실패: 문서를 저장한 뒤에 상대 경로 링크를 열 수 있습니다.')
        return
      }
      const res = await api.openLocalPath(resolved)
      if (res.error) {
        alert(`링크 열기 실패: ${res.error}`)
        return
      }
      // Markdown targets come back as file content (main can't open a tab itself); the
      // renderer opens them as a new tab. Non-markdown files were handed to the OS.
      if (res.kind === 'markdown' && openLocalFile) {
        await openLocalFile({ content: res.content, filename: res.filename, path: res.path })
      }
    }

    function bindContentLinkHandler() {
      getRefs().content.addEventListener('click', async event => {
        const link = event.target.closest('a[href]')
        if (!link) return
        const href = link.getAttribute('href')
        if (!href || href.startsWith('#')) return
        event.preventDefault()
        // A scheme (http(s), mailto:, //protocol-relative, ...) stays on the external-URL
        // path, which only allows http(s) and rejects the rest. A schemeless href is a
        // local file path and takes the new local-open path instead.
        if (pathUtils.isExternalUrl(href)) {
          const res = await api.openExternalUrl(href)
          if (res.error) alert(`링크 열기 실패: ${res.error}`)
          return
        }
        await openLocalLink(href)
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

      // Reads container.scrollTop inside the rAF callback (not at call time), so a burst
      // of scroll events collapses to the *freshest* position by the time it fires.
      const scheduleTocRefresh = (container, extra) => {
        if (scrollTicking) return
        scrollTicking = true
        windowRef.requestAnimationFrame(() => {
          scrollTicking = false
          if (extra) extra()
          markdownController.refreshTocActive(container.scrollTop)
        })
      }

      scrollArea.addEventListener('scroll', () => {
        scheduleTocRefresh(scrollArea, () => {
          refs.goTop.classList.toggle('on', scrollArea.scrollTop > 300)
        })
      })

      // In split view #scroll-area itself stops scrolling (index.html gives it
      // overflow: hidden there) -- #content becomes its own independent scroll
      // container instead (#scroll-area.split-mode #content). Without this,
      // scrolling the preview pane in split view never refreshed the TOC
      // highlight. In normal (non-split) mode #content has no overflow of its
      // own, so this listener simply never fires.
      refs.content.addEventListener('scroll', () => {
        scheduleTocRefresh(refs.content)
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
        }
        // Escape is deliberately not handled here: it bubbles to the document-level
        // handler (app-runtime.js), which closes the topmost layer first (guides,
        // then search, then the context menu) instead of always closing search.
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
    splitHrefFragment,
  }

  globalScope.MDVAppShell = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
