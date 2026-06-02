let editorController
let explorerController
let documentFlowController
let appShellController
let contextMenuController
let shellActionsController
let runtimeController
let rendererCommands

const state = {
  md: '',
  sidebarOpen: true,
  activeTab: 'toc',
}

let $
let workspaceController

const sysDark = window.matchMedia('(prefers-color-scheme: dark)')
const WELCOME_GUIDE_DISMISSED_KEY = 'mdv-welcome-guide-dismissed'

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
})

const themeController = window.MDVTheme.createThemeController({
  matchMedia: sysDark,
  storage: localStorage,
  documentRef: document,
  getRefs: () => $,
})

const onboardingController = window.MDVOnboarding.createOnboardingController({
  getRefs: () => $,
  storage: localStorage,
  dismissedKey: WELCOME_GUIDE_DISMISSED_KEY,
  getTabCount: () => (workspaceController ? workspaceController.getTabCount() : 0),
})

const searchController = window.MDVSearch.createSearchController({
  getRefs: () => $,
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
  })

  documentFlowController = window.MDVDocumentFlow.createDocumentFlowController({
    api: window.api,
    getWorkspaceController: () => workspaceController,
    getEditorController: () => editorController,
    setMarkdown: value => { state.md = value },
    showToast: message => runtimeController.showToast(message),
    alertError: message => alert(message),
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
    onSourceInput: value => { if (workspaceController) workspaceController.updateActiveTabDirtyFromEditor(value) },
    render,
    closeSearch: () => runtimeController.closeSearch(),
  })

  appShellController = window.MDVAppShell.createAppShellController({
    documentRef: document,
    windowRef: window,
    api: window.api,
    getRefs: () => $,
    themeController,
    markdownController,
    getExplorerRoot: () => (explorerController ? explorerController.getCurrentExplorerRoot() : null),
    revealInFinder: path => runtimeController.revealInFinder(path),
    clearExplorerRoot: () => runtimeController.clearExplorerRoot(),
    showAppContextMenu: (x, y, items) => runtimeController.showAppContextMenu(x, y, items),
    hideAppContextMenu: () => runtimeController.hideAppContextMenu(),
    runSearch: query => runtimeController.runSearch(query),
    searchNext: () => runtimeController.searchNext(),
    searchPrev: () => runtimeController.searchPrev(),
    closeSearch: () => runtimeController.closeSearch(),
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
    watchFile: path => documentFlowController.watchFile(path),
    updateToolbarActions: () => runtimeController.updateToolbarActions(),
    updateEntryAffordance: () => runtimeController.updateEntryAffordance(),
    maybeShowWelcomeGuide: () => runtimeController.maybeShowWelcomeGuide(),
    showAppContextMenu: (x, y, items) => runtimeController.showAppContextMenu(x, y, items),
    getSourceMode: () => editorController.getSourceMode(),
    setSourceMode: value => { editorController.setSourceMode(value) },
    setMarkdown: value => { state.md = value },
    confirmClose: message => confirm(message),
    openNewWindow: path => window.api.newWindow(path),
  })

  explorerController = window.MDVExplorer.createExplorerController({
    getRefs: () => $,
    api: window.api,
    load: data => runtimeController.load(data),
    switchToExplorerTab: () => runtimeController.switchTab('explorer'),
    showAppContextMenu: (x, y, items) => runtimeController.showAppContextMenu(x, y, items),
    revealInFinder: path => runtimeController.revealInFinder(path),
  })

  editorController.bindEditorEvents()
  rendererCommands = createRendererCommands()

  appShellController.initializeUi({
    applyTheme: () => runtimeController.applyTheme(),
    sidebarOpen: state.sidebarOpen,
    activeTab: state.activeTab,
    syncExplorerHeader: () => runtimeController.syncExplorerHeader(),
    updateToolbarActions: () => runtimeController.updateToolbarActions(),
    updateEntryAffordance: () => runtimeController.updateEntryAffordance(),
    maybeShowWelcomeGuide: () => runtimeController.maybeShowWelcomeGuide(),
  })
  appShellController.registerIpcHandlers()
  appShellController.bindUiEvents(rendererCommands)
  runtimeController.bindGlobalEvents()
  document.documentElement.dataset.rendererReady = 'true'
})

async function render(text, filename, docPath) {
  $.content.classList.remove('is-empty')
  await markdownController.render(text, filename, docPath)
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
    toggleSource: () => runtimeController.toggleSource(),
    toggleSearch: () => runtimeController.toggleSearch(),
    copyAll: () => runtimeController.copyAll(),
    printDoc: () => runtimeController.printDoc(),
    toggleTheme: () => runtimeController.toggleTheme(),
    toggleAddMenu: event => runtimeController.toggleAddMenu(event),
    hideAddMenu: () => runtimeController.hideAddMenu(),
    dismissWelcomeGuide: () => runtimeController.dismissWelcomeGuide(),
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

async function runRendererCommand(commandName) {
  const command = rendererCommands?.[commandName]
  if (!command) return
  await command()
}
