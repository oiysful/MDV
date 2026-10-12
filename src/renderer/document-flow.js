(function (globalScope) {
  // Browser: index.html loads i18n.js first, which puts it on globalScope. Node (unit tests via
  // require()): no script tag ran, so require it -- same fallback shape as markdown.js's js-yaml.
  const { t } = globalScope.MDVI18n || require('./i18n.js')
  function getLoadTargetsFromOpenResult(data) {
    if (!data || data.cancelled) return []
    if (Array.isArray(data.files)) return data.files
    if (data.content !== undefined) return [data]
    return []
  }

  function syncTabContentForSave({ tab, getSourceMode, getSplitMode = () => false, getEditorValue, setMarkdown }) {
    if (!tab || (!getSourceMode() && !getSplitMode())) return tab
    tab.content = getEditorValue()
    setMarkdown(tab.content)
    return tab
  }

  // Returns why saving might clobber someone else's work:
  //   null         — safe: disk matches what we last wrote
  //   'deleted'    — the file is gone; saving simply recreates it
  //   'changed'    — the file was edited outside the app since our last save
  //   'unreadable' — we could not check (permissions, I/O). Treating this as "no
  //                  conflict" used to silently overwrite, so ask instead.
  function detectSaveConflict(diskResult, savedContent) {
    if (!diskResult) return 'unreadable'
    if (diskResult.error) {
      return diskResult.code === 'ENOENT' ? 'deleted' : 'unreadable'
    }
    return diskResult.content === savedContent ? null : 'changed'
  }

  const SAVE_CONFLICT_PROMPTS = {
    get changed() { return t('confirm.overwriteChanged') },
    get unreadable() { return t('confirm.overwriteUnreadable') },
  }

  function createDocumentFlowController({ api, getWorkspaceController, getEditorController, setMarkdown, showToast, alertError, confirmOverwrite, clearImageCache }) {
    // Reference-counted: a document path has exactly one watching tab, but an image
    // path can be embedded in several open tabs at once, so only the last reference
    // going away should actually unwatch it.
    const pathRefCounts = new Map()

    async function watchPath(path) {
      if (!path) return
      const count = pathRefCounts.get(path) || 0
      pathRefCounts.set(path, count + 1)
      if (count === 0) await api.watchFile(path)
    }

    async function unwatchPath(path) {
      if (!path) return
      const count = pathRefCounts.get(path) || 0
      if (count <= 0) return
      if (count === 1) {
        pathRefCounts.delete(path)
        await api.unwatchFile(path)
      } else {
        pathRefCounts.set(path, count - 1)
      }
    }

    async function load(data) {
      if (data.error) {
        alertError(t('error.file', data.error))
        return null
      }
      if (data.cancelled) return null
      return getWorkspaceController().createTab(data)
    }

    async function openFile() {
      try {
        const data = await api.openFileDialog()
        const targets = getLoadTargetsFromOpenResult(data)
        for (const target of targets) {
          await load(target)
        }
      } catch (error) {
        console.error(error)
      }
    }

    function updateTabAfterSave(tab, nextPath, nextFilename) {
      const previousPath = tab.path
      tab.path = nextPath
      tab.filename = nextFilename
      tab.savedContent = tab.content
      tab.dirty = false
      tab.deletedExternally = false
      document.title = globalScope.MDVWorkspace.stripMarkdownExtension(tab.filename)
      // A save that assigns/keeps a path is the second place (besides opening) a file
      // becomes a recent document — covers first save of a new file and "save as".
      if (nextPath) api.addRecentDocument?.(nextPath)
      getWorkspaceController().renderTabBar()
      if (previousPath !== nextPath) {
        unwatchPath(previousPath)
        watchPath(nextPath)
      }
      // Our own save is ignored as a self-write echo, so it never triggers the
      // external-change cache clear. Do it here instead, since this save may have
      // also changed an image the document references.
      clearImageCache?.()
      showToast(t('toast.saved'))
    }

    async function saveFile() {
      const workspaceController = getWorkspaceController()
      const editorController = getEditorController()
      const tab = workspaceController.getActiveTab()
      if (!tab) return

      syncTabContentForSave({
        tab,
        getSourceMode: () => editorController.getSourceMode(),
        getSplitMode: () => editorController.getSplitMode(),
        getEditorValue: () => editorController.getEditorValue(),
        setMarkdown,
      })

      if (!tab.path) {
        await saveFileAs()
        return
      }

      const diskResult = await api.readFile(tab.path)
      const conflict = detectSaveConflict(diskResult, tab.savedContent)
      const prompt = SAVE_CONFLICT_PROMPTS[conflict]
      if (prompt) {
        const overwrite = confirmOverwrite ? confirmOverwrite(prompt) : true
        if (!overwrite) return
      }

      const res = await api.saveFile(tab.path, tab.content)
      if (res.error) {
        alertError(t('error.saveFailed', res.error))
        return
      }
      updateTabAfterSave(tab, tab.path, res.filename || tab.filename)
    }

    async function saveFileAs() {
      const workspaceController = getWorkspaceController()
      const editorController = getEditorController()
      const tab = workspaceController.getActiveTab()
      if (!tab) return

      syncTabContentForSave({
        tab,
        getSourceMode: () => editorController.getSourceMode(),
        getSplitMode: () => editorController.getSplitMode(),
        getEditorValue: () => editorController.getEditorValue(),
        setMarkdown,
      })

      const dlg = await api.saveFileDialog(tab.filename, tab.path)
      if (dlg.cancelled || dlg.error) return

      const res = await api.saveFile(dlg.path, tab.content)
      if (res.error) {
        alertError(t('error.saveFailed', res.error))
        return
      }
      updateTabAfterSave(tab, dlg.path, res.filename)
    }

    async function handleFileOpened(payload) {
      await load(payload)
    }

    async function handleFileChanged({ path, content, event }) {
      await getWorkspaceController().handleExternalFileChange({ path, content, event })
    }

    return {
      watchPath,
      unwatchPath,
      load,
      openFile,
      saveFile,
      saveFileAs,
      handleFileOpened,
      handleFileChanged,
    }
  }

  const api = {
    createDocumentFlowController,
    getLoadTargetsFromOpenResult,
    syncTabContentForSave,
    detectSaveConflict,
  }

  globalScope.MDVDocumentFlow = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
