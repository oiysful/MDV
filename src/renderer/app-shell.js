(function (globalScope) {
  // Splits a link href on its first `#` into a file-path part and a fragment part.
  // Used to strip URL fragments (`#heading`) off local link hrefs before they reach
  // resolveLocalPath, which otherwise treats the whole href — fragment included — as
  // part of the file path. First-`#` is a deterministic policy, not a lossless one: a
  // filename that itself contains a literal `#` with no anchor (`a#b.md`) still splits at
  // that `#` (path: `a`, fragment: `b.md`), which breaks opening it as a local link. This
  // is a known, accepted limitation (see the "리스크" section of
  // docs/plans/done/2026-07-30/05-local-link-anchor-fragment.md) — v1 scopes the fix to ordinary anchor
  // links and leaves literal-`#` filenames unresolved rather than trying to disambiguate.
  function splitHrefFragment(href) {
    const hashIndex = href.indexOf('#')
    if (hashIndex === -1) return { path: href, fragment: '' }
    return { path: href.slice(0, hashIndex), fragment: href.slice(hashIndex + 1) }
  }

  // Shared by the search-input and source-editor keydown listeners in bindSearchEvents below.
  // Returns 'next'/'prev' for a navigation keystroke, or null when the key isn't one.
  //
  // The isComposing guard matters specifically for Korean (and other IME) input: confirming a
  // composition sends a keydown with key === 'Enter' *before* compositionend fires. Treating
  // that keystroke as a navigation Enter and calling preventDefault() on it interferes with the
  // composition finishing, which is what produced a duplicated trailing syllable in the search
  // box. The next, real Enter keydown (isComposing: false) is the one to act on.
  // editor.js:452 applies the same guard for its own Enter handling.
  function resolveSearchKeydownAction(event) {
    if (event.isComposing) return null
    if (event.key !== 'Enter') return null
    return event.shiftKey ? 'prev' : 'next'
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
      splitDivider: documentRef.getElementById('split-divider'),
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

  function createAppShellController({ documentRef, windowRef, api, getRefs, pathUtils, themeController, markdownController, getExplorerRoot, revealInFinder, clearExplorerRoot, showAppContextMenu, hideAppContextMenu, runSearch, searchNext, searchPrev, isEditorSearchActive, getActiveTab, openLocalFile, handleFileOpened, handleFileChanged, handleRendererCommand }) {
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

    // Scrolls to the heading a link fragment names. markdown.js's buildToc assigns every
    // heading an id via slugifyHeading, and a link author writes that same slug, so the
    // fragment text *is* the id — no re-slugification needed.
    //
    // The lookup is scoped *inside* #content rather than done with getElementById,
    // because heading slugs share an id namespace with the app chrome (`sidebar`,
    // `stats`, `toast`, and `content` itself): a heading titled "Sidebar" or "Content"
    // would otherwise win the document-wide lookup and scroll a chrome element.
    // Matching on the id property instead of a `#id` selector also sidesteps escaping
    // — a slug is arbitrary heading text and need not be a valid CSS identifier.
    //
    // A fragment with no matching heading is ignored silently — unlike a missing file,
    // a stale anchor isn't worth interrupting the user with an alert.
    function scrollToContentFragment(fragment) {
      if (!fragment) return
      // marked percent-encodes non-ASCII characters in hrefs (`#헤더` is stored as
      // `#%ED%97%A4...`) while heading ids stay raw, so decode before matching. A
      // malformed `%` sequence throws; match against the literal fragment then.
      let id = fragment
      try {
        id = decodeURIComponent(fragment)
      } catch (e) {
        id = fragment
      }
      const target = Array.from(getRefs().content.querySelectorAll('[id]')).find(el => el.id === id)
      if (!target) return
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    async function openLocalLink(href) {
      // Strip a trailing URL fragment (`#heading`) before resolving — resolveLocalPath
      // treats the whole string as a file path, so a real anchor would otherwise be
      // read as part of the filename and fail to resolve. The fragment itself is kept
      // and used to scroll to the target heading once the document is open.
      const { path: targetPath, fragment } = splitHrefFragment(href)
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
        // This await already covers rendering: createTab awaits render() (which runs
        // buildToc, so heading ids exist), and the already-open-tab branch populates
        // #content synchronously via restoreTabState. What it does *not* cover is
        // restoreTabState's own requestAnimationFrame, which writes the target tab's
        // remembered scrollTop and would immediately undo a synchronous scroll here.
        // Registering our rAF after that one puts this callback second in the same
        // frame's queue, so the anchor scroll wins.
        if (fragment) windowRef.requestAnimationFrame(() => scrollToContentFragment(fragment))
      }
    }

    function bindContentLinkHandler() {
      getRefs().content.addEventListener('click', async event => {
        const link = event.target.closest('a[href]')
        if (!link) return
        const href = link.getAttribute('href')
        if (!href) return
        if (href.startsWith('#')) {
          // Same-document anchor. The browser's native fragment jump would land on the
          // right heading now that ids are real slugs, but it teleports; intercept so
          // in-page anchors animate like TOC clicks and search navigation do.
          event.preventDefault()
          scrollToContentFragment(href.slice(1))
          return
        }
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
      // One ticking flag per container: below the 700px split-mode breakpoint (index.html)
      // #scroll-area and #content can both be scrollable at once, and a single shared flag
      // would let one container's rAF-pending scroll swallow the other's.
      const tickingByContainer = new WeakMap()

      // Reads container.scrollTop inside the rAF callback (not at call time), so a burst
      // of scroll events collapses to the *freshest* position by the time it fires.
      const scheduleTocRefresh = (container, extra) => {
        if (tickingByContainer.get(container)) return
        tickingByContainer.set(container, true)
        windowRef.requestAnimationFrame(() => {
          tickingByContainer.set(container, false)
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
      // #content is its own scroll container in split view (see above); an open context
      // menu should dismiss on either pane scrolling, not just #scroll-area's.
      refs.content.addEventListener('scroll', hideAppContextMenu)
    }

    function bindSearchEvents() {
      const searchInput = documentRef.getElementById('search-input')
      searchInput.addEventListener('input', () => runSearch(searchInput.value))
      searchInput.addEventListener('keydown', event => {
        const action = resolveSearchKeydownAction(event)
        if (!action) return
        event.preventDefault()
        if (action === 'prev') searchPrev()
        else searchNext()
        // Escape is deliberately not handled here: it bubbles to the document-level
        // handler (app-runtime.js), which closes the topmost layer first (guides,
        // then search, then the context menu) instead of always closing search.
      })

      // The textarea only paints its selection while focused (see search.js's
      // advanceEditorMatch), so jumping to a match in source/split mode leaves focus on the
      // editor instead of returning it to the search input. Enter/Shift+Enter must keep
      // navigating matches from there. This listener is registered before editor.js's own
      // Enter handling (app.js binds editor events after appShellController.bindUiEvents) so
      // it can stopImmediatePropagation() and prevent that handler from also treating the key
      // as a newline/list-continuation while search is active.
      const sourceEditor = getRefs().sourceEditor
      sourceEditor.addEventListener('keydown', event => {
        if (!isEditorSearchActive()) return
        const action = resolveSearchKeydownAction(event)
        if (!action) return
        event.preventDefault()
        event.stopImmediatePropagation()
        if (action === 'prev') searchPrev()
        else searchNext()
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
    resolveSearchKeydownAction,
  }

  globalScope.MDVAppShell = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
