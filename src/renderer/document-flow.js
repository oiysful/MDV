(function (globalScope) {
  function getLoadTargetsFromOpenResult(data) {
    if (!data || data.cancelled) return []
    if (Array.isArray(data.files)) return data.files
    if (data.content !== undefined) return [data]
    return []
  }

  function syncTabContentForSave({ tab, getSourceMode, getEditorValue, setMarkdown }) {
    if (!tab || !getSourceMode()) return tab
    tab.content = getEditorValue()
    setMarkdown(tab.content)
    return tab
  }

  function createDocumentFlowController({ api, getWorkspaceController, getEditorController, setMarkdown, showToast, alertError }) {
    let watchedPath = null

    async function watchFile(path) {
      if (watchedPath === path) return
      if (watchedPath) await api.unwatchFile(watchedPath)
      watchedPath = path
      if (path) await api.watchFile(path)
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
      tab.path = nextPath
      tab.filename = nextFilename
      tab.savedContent = tab.content
      tab.dirty = false
      document.title = tab.filename.replace(/\.md$/i, '')
      getWorkspaceController().renderTabBar()
      watchFile(tab.path)
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
        getEditorValue: () => editorController.getEditorValue(),
        setMarkdown,
      })

      if (!tab.path) {
        await saveFileAs()
        return
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

    async function handleFileChanged({ path, content }) {
      await getWorkspaceController().handleExternalFileChange({ path, content })
    }

    return {
      watchFile,
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
  }

  globalScope.MDVDocumentFlow = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
