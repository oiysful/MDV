let editorController
let explorerController
let documentFlowController
let appShellController
let contextMenuController
let shellActionsController
let runtimeController
let rendererCommands
let splitRenderTimer = null
let splitRenderVersion = 0
let sessionSaveTimer = null

// Tab switches/closes fire fast; debouncing keeps rapid activity from hammering the IPC
// bridge. Main only writes to disk at close/quit, so this just keeps its mirror fresh.
const SESSION_SAVE_DEBOUNCE_MS = 350

const state = {
  md: '',
  sidebarOpen: true,
  activeTab: 'toc',
}

let $
let workspaceController

const sysDark = window.matchMedia('(prefers-color-scheme: dark)')
const WELCOME_GUIDE_DISMISSED_KEY = 'mdv-welcome-guide-dismissed'
const DEFAULT_APP_GUIDE_DISMISSED_KEY = 'mdv-default-app-guide-dismissed-v2'

const markdownController = window.MDVMarkdown.createMarkdownController({
  getRefs: () => $,
  markedLib: marked,
  hljsLib: hljs,
  pathUtils: window.MDVPathUtils,
  api: window.api,
  onShowModeButton: () => {
    if ($.btnMode) {
      $.btnMode.style.display = ''
      if (editorController) editorController.updateModeButton()
    }
  },
  // mermaid is lazy-loaded (see markdown.js's ensureMermaidLoaded) instead of being present
  // from boot, so themeController's own startup call below -- historically mermaid's one
  // guaranteed init point -- runs before mermaid exists and silently no-ops (it already
  // guards on `typeof mermaid !== 'undefined'`). This is the actual init point once mermaid's
  // script has finished loading, using whatever theme is current at that moment; referencing
  // themeController here is safe even though it's declared further down this file -- this
  // callback only ever runs later, well after both controllers exist.
  onMermaidLoaded: () => markdownController.initMermaidTheme(themeController.getIsDark()),
})

const themeController = window.MDVTheme.createThemeController({
  matchMedia: sysDark,
  storage: localStorage,
  documentRef: document,
  getRefs: () => $,
  onThemeApplied: isDark => {
    if ($ && $.content) void markdownController.applyMermaidTheme($.content, isDark)
  },
})

const onboardingController = window.MDVOnboarding.createOnboardingController({
  getRefs: () => $,
  storage: localStorage,
  dismissedKey: WELCOME_GUIDE_DISMISSED_KEY,
  defaultAppDismissedKey: DEFAULT_APP_GUIDE_DISMISSED_KEY,
  getTabCount: () => (workspaceController ? workspaceController.getTabCount() : 0),
})

const searchController = window.MDVSearch.createSearchController({
  getRefs: () => $,
})

const updateNoticeController = window.MDVUpdateNotice.createUpdateNoticeController({
  getRefs: () => $,
  api: window.api,
  showToast: message => onboardingController.showToast(message),
  isBlockedByModal: () => onboardingController.isDefaultAppGuideOpen(),
})

document.addEventListener('DOMContentLoaded', () => {
  $ = window.MDVAppShell.collectAppShellRefs(document)

  contextMenuController = window.MDVContextMenu.createAppContextMenuController({
    getRefs: () => $,
    documentRef: document,
    windowRef: window,
  })

  runtimeController = window.MDVAppRuntime.createAppRuntimeController({
    getRefs: () => $,
    documentRef: document,
    windowRef: window,
    api: window.api,
    sysDark,
    markdownController,
    themeController,
    onboardingController,
    searchController,
    getMarkdown: () => state.md,
    setMarkdown: value => { state.md = value },
    getSidebarOpen: () => state.sidebarOpen,
    setSidebarOpen: value => { state.sidebarOpen = value },
    setActiveTabName: value => { state.activeTab = value },
    getEditorController: () => editorController,
    getExplorerController: () => explorerController,
    getWorkspaceController: () => workspaceController,
    getDocumentFlowController: () => documentFlowController,
    getShellActionsController: () => shellActionsController,
    getContextMenuController: () => contextMenuController,
    ensurePreviewRendered,
    onDefaultAppGuideDismissed: () => updateNoticeController.recheckVisibility(),
  })

  documentFlowController = window.MDVDocumentFlow.createDocumentFlowController({
    api: window.api,
    getWorkspaceController: () => workspaceController,
    getEditorController: () => editorController,
    setMarkdown: value => { state.md = value },
    showToast: message => runtimeController.showToast(message),
    alertError: message => alert(message),
    confirmOverwrite: message => confirm(message),
    clearImageCache: () => markdownController.clearImageCache(),
  })

  shellActionsController = window.MDVShellActions.createShellActionsController({
    getRefs: () => $,
    load: data => runtimeController.load(data),
    openFile: () => runtimeController.openFile(),
    openFolder: () => runtimeController.openFolder(),
    dismissWelcomeGuide: persist => runtimeController.dismissWelcomeGuide(persist),
  })

  editorController = window.MDVEditor.createEditorController({
    getRefs: () => $,
    getMarkdown: () => state.md,
    setMarkdown: value => { state.md = value },
    getActiveTab: () => (workspaceController ? workspaceController.getActiveTab() : null),
    rerenderTabBar: () => { if (workspaceController) workspaceController.renderTabBar() },
    syncTabImageWatches: (tab, imagePaths) => { if (workspaceController) workspaceController.syncTabImageWatches(tab, imagePaths) },
    onSourceInput: value => handleSourceInput(value),
    render,
    closeSearch: () => runtimeController.closeSearch(),
    storage: localStorage,
    getSidebarOpen: () => state.sidebarOpen,
    setSidebarOpen: value => runtimeController.setSidebarOpen(value),
    markdownController,
  })

  appShellController = window.MDVAppShell.createAppShellController({
    documentRef: document,
    windowRef: window,
    api: window.api,
    getRefs: () => $,
    pathUtils: window.MDVPathUtils,
    themeController,
    markdownController,
    getActiveTab: () => (workspaceController ? workspaceController.getActiveTab() : null),
    openLocalFile: data => documentFlowController.load(data),
    getExplorerRoot: () => (explorerController ? explorerController.getCurrentExplorerRoot() : null),
    revealInFinder: path => runtimeController.revealInFinder(path),
    clearExplorerRoot: () => runtimeController.clearExplorerRoot(),
    showAppContextMenu: (x, y, items) => runtimeController.showAppContextMenu(x, y, items),
    hideAppContextMenu: () => runtimeController.hideAppContextMenu(),
    runSearch: query => runtimeController.runSearch(query),
    searchNext: () => runtimeController.searchNext(),
    searchPrev: () => runtimeController.searchPrev(),
    isEditorSearchActive: () => runtimeController.isEditorSearchActive(),
    handleFileOpened: jsonStr => documentFlowController.handleFileOpened(jsonStr),
    handleFileChanged: payload => documentFlowController.handleFileChanged(payload),
    handleRendererCommand: commandName => runRendererCommand(commandName),
  })

  workspaceController = window.MDVWorkspace.createWorkspaceController({
    getRefs: () => $,
    markdownController,
    render,
    applySourceMode: () => editorController.applySourceMode(),
    showEmptyState: () => runtimeController.showEmptyState(),
    watchPath: path => documentFlowController.watchPath(path),
    unwatchPath: path => documentFlowController.unwatchPath(path),
    updateToolbarActions: () => runtimeController.updateToolbarActions(),
    updateEntryAffordance: () => runtimeController.updateEntryAffordance(),
    maybeShowWelcomeGuide: () => runtimeController.maybeShowWelcomeGuide(),
    showAppContextMenu: (x, y, items) => runtimeController.showAppContextMenu(x, y, items),
    getSourceMode: () => editorController.getSourceMode(),
    setSourceMode: value => { editorController.setSourceMode(value) },
    getSplitMode: () => editorController.getSplitMode(),
    setSplitMode: value => { editorController.setSplitMode(value) },
    setMarkdown: value => { state.md = value },
    confirmClose: message => confirm(message),
    openNewWindow: path => window.api.newWindow(path),
    reportDirtyState: hasDirty => window.api.setDirtyState?.(hasDirty),
    closeSearch: () => runtimeController.closeSearch(),
    addRecentDocument: path => window.api.addRecentDocument?.(path),
    onTabsChanged: () => {
      notifySessionState()
      explorerController?.setActiveFilePath(workspaceController.getActiveTab()?.path ?? null)
    },
  })

  explorerController = window.MDVExplorer.createExplorerController({
    getRefs: () => $,
    api: window.api,
    load: data => runtimeController.load(data),
    switchToExplorerTab: () => runtimeController.switchTab('explorer'),
    showAppContextMenu: (x, y, items) => runtimeController.showAppContextMenu(x, y, items),
    revealInFinder: path => runtimeController.revealInFinder(path),
    onExplorerRootChanged: () => notifySessionState(),
    showToast: message => runtimeController.showToast(message),
  })

  rendererCommands = createRendererCommands()

  appShellController.initializeUi({
    applyTheme: () => runtimeController.applyTheme(),
    sidebarOpen: state.sidebarOpen,
    activeTab: state.activeTab,
    syncExplorerHeader: () => runtimeController.syncExplorerHeader(),
    updateToolbarActions: () => runtimeController.updateToolbarActions(),
    updateEntryAffordance: () => runtimeController.updateEntryAffordance(),
    maybeShowWelcomeGuide: () => runtimeController.maybeShowWelcomeGuide(),
    applyWrapMode: () => editorController.applyWrapMode(),
  })
  appShellController.registerIpcHandlers()
  appShellController.bindUiEvents(rendererCommands)
  // Must run after bindUiEvents: bindSearchEvents (app-shell.js) registers a keydown listener
  // on #source-editor that needs to fire before editor.js's own Enter handling so it can
  // stopImmediatePropagation() while search is open in editor mode. Registration order is
  // what decides precedence for two listeners on the same element.
  editorController.bindEditorEvents()
  runtimeController.bindGlobalEvents()
  window.api.onRestoreSession?.(payload => { void restoreSession(payload) })
  window.api.onUpdateAvailable?.(data => updateNoticeController.handleUpdateAvailable(data))
  void runtimeController.checkMarkdownDefaultAppStatus()
  document.documentElement.dataset.rendererReady = 'true'
})

async function render(text, filename, docPath) {
  $.content.classList.remove('is-empty')
  return markdownController.render(text, filename, docPath)
}

function createRendererCommands() {
  return {
    // Menu-backed commands: main process dispatches these through preload IPC.
    openFile: () => runtimeController.openFile(),
    openFolder: () => runtimeController.openFolder(),
    saveFile: () => runtimeController.saveFile(),
    saveFileAs: () => runtimeController.saveFileAs(),

    // Static shell commands: toolbar, search bar, guide, sidebar, and explorer controls.
    toggleSidebar: () => runtimeController.toggleSidebar(),
    toggleSidebarFromShortcut: () => runtimeController.toggleSidebarFromShortcut(),
    toggleSource: () => runtimeController.toggleSource(),
    toggleSplitView: () => runtimeController.toggleSplitView(),
    toggleWrap: () => runtimeController.toggleWrap(),
    toggleSearch: () => runtimeController.toggleSearch(),
    copyAll: () => runtimeController.copyAll(),
    printDoc: () => runtimeController.printDoc(),
    exportPdf: () => runtimeController.exportPdf(),
    toggleTheme: () => runtimeController.toggleTheme(),
    newFile: () => runtimeController.newFile(),
    closeCurrentTab: () => runtimeController.closeCurrentTab(),
    switchToNextTab: () => runtimeController.switchToNextTab(),
    switchToPrevTab: () => runtimeController.switchToPrevTab(),
    showShortcuts: () => runtimeController.showShortcuts(),
    hideShortcuts: () => runtimeController.hideShortcuts(),
    toggleAddMenu: event => runtimeController.toggleAddMenu(event),
    hideAddMenu: () => runtimeController.hideAddMenu(),
    dismissWelcomeGuide: () => runtimeController.dismissWelcomeGuide(),
    dismissDefaultAppGuide: () => runtimeController.dismissDefaultAppGuide(),
    dismissUpdateBanner: () => updateNoticeController.dismiss(),
    openUpdateReleaseNotes: () => updateNoticeController.openReleaseNotes(),
    copyUpdateCommand: () => updateNoticeController.copyUpgradeCommand(),
    openFromGuide: kind => runtimeController.openFromGuide(kind),
    searchPrev: () => runtimeController.searchPrev(),
    searchNext: () => runtimeController.searchNext(),
    closeSearch: () => runtimeController.closeSearch(),
    switchTab: tab => runtimeController.switchTab(tab),
    toggleExplorerPathInfo: () => runtimeController.toggleExplorerPathInfo(),
    clearExplorerRoot: () => runtimeController.clearExplorerRoot(),
    goTop: () => runtimeController.goTop(),

    // Generated preview commands: rendered markdown buttons use delegated content events.
    copyCode: button => runtimeController.copyCode(button),

    // Drag/drop commands: shell listeners bind these to the scroll area.
    onDragOver: event => runtimeController.onDragOver(event),
    onDragLeave: () => runtimeController.onDragLeave(),
    onDrop: event => runtimeController.onDrop(event),
  }
}

function handleSourceInput(value) {
  if (!workspaceController) return
  workspaceController.updateActiveTabDirtyFromEditor(value)
  if (!editorController?.getSplitMode()) return

  const tab = workspaceController.getActiveTab()
  if (!tab) return
  tab.content = value
  tab.previewDirty = true
  state.md = value
  splitRenderVersion += 1
  const renderVersion = splitRenderVersion
  window.clearTimeout(splitRenderTimer)
  splitRenderTimer = window.setTimeout(() => {
    void renderSplitPreview(tab, value, renderVersion)
  }, 120)
}

async function renderSplitPreview(tab, value, renderVersion) {
  if (workspaceController.getActiveTab() !== tab) return
  const previewMaxScroll = $.content.scrollHeight - $.content.clientHeight
  const sourceMaxScroll = $.sourceView.scrollHeight - $.sourceView.clientHeight
  const previewRatio = previewMaxScroll > 0 ? $.content.scrollTop / previewMaxScroll : 0
  const sourceRatio = sourceMaxScroll > 0 ? $.sourceView.scrollTop / sourceMaxScroll : 0
  const imagePaths = await render(value, tab.filename || '', tab.path || null)
  if (workspaceController.getActiveTab() !== tab) {
    workspaceController.restoreActiveTabState()
    return
  }
  if (tab.content !== value || renderVersion !== splitRenderVersion) {
    tab.previewDirty = true
    await renderSplitPreview(tab, tab.content, splitRenderVersion)
    return
  }
  tab.renderedHTML = markdownController.captureSnapshotHTML()
  tab.tocHTML = $.tocList.innerHTML
  tab.previewDirty = false
  workspaceController.syncTabImageWatches(tab, imagePaths)
  const nextPreviewMaxScroll = $.content.scrollHeight - $.content.clientHeight
  if (nextPreviewMaxScroll > 0) $.content.scrollTop = nextPreviewMaxScroll * Math.max(previewRatio, sourceRatio)
}

// Print and PDF export capture the preview DOM. In source mode that pane is never
// re-rendered as you type, and in split mode a render may still be debounced, so
// both would otherwise output stale content. Bring it up to date first.
async function ensurePreviewRendered() {
  if (!workspaceController || !editorController) return
  const tab = workspaceController.getActiveTab()
  if (!tab) return

  const inEditor = editorController.getSourceMode() || editorController.getSplitMode()
  if (!inEditor && !tab.previewDirty) return

  const value = inEditor ? editorController.getEditorValue() : tab.content
  window.clearTimeout(splitRenderTimer)
  const imagePaths = await render(value, tab.filename || '', tab.path || null)
  tab.renderedHTML = markdownController.captureSnapshotHTML()
  tab.tocHTML = $.tocList.innerHTML
  tab.previewDirty = false
  workspaceController.syncTabImageWatches(tab, imagePaths)
}

async function runRendererCommand(commandName) {
  const command = rendererCommands?.[commandName]
  if (!command) return
  await command()
}

// Gathers the persistable session across controllers (tab paths + active index + explorer
// root) into the minimal on-disk shape. Main guards against ever writing an empty one.
function collectSessionState() {
  const tabs = workspaceController ? workspaceController.getSessionTabs() : []
  const activeTabId = workspaceController ? (workspaceController.getActiveTab()?.id ?? null) : null
  const explorerRoot = explorerController ? explorerController.getCurrentExplorerRoot() : null
  return window.MDVSessionState.buildSessionState(tabs, activeTabId, explorerRoot)
}

function notifySessionState() {
  window.clearTimeout(sessionSaveTimer)
  sessionSaveTimer = window.setTimeout(() => {
    window.api.saveSessionState?.(collectSessionState())
  }, SESSION_SAVE_DEBOUNCE_MS)
}

// Startup-only restore, driven by main's `restore-session` push. Reopens each saved path
// exactly like a normal file-open; files that fail to read (moved/deleted) are skipped
// silently — no alert per missing file. A single toast summarizes the skipped count.
async function restoreSession(payload) {
  if (!payload) return
  const savedPaths = Array.isArray(payload.tabs) ? payload.tabs : []
  const created = []
  for (const filePath of savedPaths) {
    try {
      const data = await window.api.readFile(filePath)
      if (data.error) continue
      // createBackgroundTab (not documentFlowController.load/createTab) -- restoring N tabs
      // shouldn't fully render N documents just to immediately bury N-1 of them behind the
      // active one. Each background tab renders lazily via its previewDirty flag the first
      // time it's actually switched to (see restoreTabState).
      const tab = await workspaceController.createBackgroundTab(data)
      if (tab) created.push(tab)
    } catch {
      // Unreadable/moved file — skip it, don't interrupt the rest of the restore.
    }
  }

  if (created.length) {
    // activeIndex points into the saved paths; if that exact tab survived, activate it,
    // otherwise fall back to the last restored tab (createTab used to leave that one active
    // as a side effect of the old per-tab render loop; now it needs an explicit switch since
    // createBackgroundTab never touches activeTabId).
    const activePath = savedPaths[payload.activeIndex]
    const target = created.find(tab => tab.path === activePath) || created[created.length - 1]
    await workspaceController.switchToTab(target.id)
  }

  const skipped = savedPaths.length - created.length
  if (skipped > 0) runtimeController.showToast(`${skipped}개 파일을 열 수 없어 건너뛰었습니다`)

  if (payload.explorerRoot) {
    await explorerController.restoreRoot(payload.explorerRoot)
  }
}
