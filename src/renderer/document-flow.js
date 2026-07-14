(function (globalScope) {
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
    changed: '이 파일이 외부에서 변경되었습니다. 편집 중인 내용으로 덮어쓰시겠습니까?',
    unreadable: '이 파일의 디스크 상태를 확인할 수 없습니다. 그래도 덮어쓰시겠습니까?',
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
        alertError('파일 오류: ' + data.error)
        return null
      }
      if (data.cancelled) return null
      return getWorkspaceController().createTab(data)
    }

    async function openFile() {
      try {
        const data = JSON.parse(await api.openFileDialog())
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
      document.title = globalScope.MDVWorkspace.stripMarkdownExtension(tab.filename)
      getWorkspaceController().renderTabBar()
      if (previousPath !== nextPath) {
        unwatchPath(previousPath)
        watchPath(nextPath)
      }
      // Our own save is ignored as a self-write echo, so it never triggers the
      // external-change cache clear. Do it here instead, since this save may have
      // also changed an image the document references.
      clearImageCache?.()
      showToast('저장됨')
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

      const diskResult = JSON.parse(await api.readFile(tab.path))
      const conflict = detectSaveConflict(diskResult, tab.savedContent)
      const prompt = SAVE_CONFLICT_PROMPTS[conflict]
      if (prompt) {
        const overwrite = confirmOverwrite ? confirmOverwrite(prompt) : true
        if (!overwrite) return
      }

      const res = JSON.parse(await api.saveFile(tab.path, tab.content))
      if (res.error) {
        alertError('저장 실패: ' + res.error)
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

      const dlg = JSON.parse(await api.saveFileDialog(tab.filename))
      if (dlg.cancelled || dlg.error) return

      const res = JSON.parse(await api.saveFile(dlg.path, tab.content))
      if (res.error) {
        alertError('저장 실패: ' + res.error)
        return
      }
      updateTabAfterSave(tab, dlg.path, res.filename)
    }

    async function handleFileOpened(jsonStr) {
      const data = JSON.parse(jsonStr)
      await load(data)
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
