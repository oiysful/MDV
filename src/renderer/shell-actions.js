(function (globalScope) {
  function hasDraggedFiles(dataTransfer) {
    const types = dataTransfer?.types
    return types ? Array.prototype.indexOf.call(types, 'Files') !== -1 : false
  }

  // Electron dropped a real file; recover its filesystem path so the tab opens
  // with a path (enabling in-place save and relative image resolution) instead
  // of falling back to "save as". webUtils.getPathForFile is the supported route
  // now that File.path is deprecated; keep the legacy field as a fallback.
  function resolveDroppedFilePath(file, api) {
    return api?.getPathForFile?.(file) || file?.path || null
  }

  function createShellActionsController({ getRefs, load, openFile, openFolder, dismissWelcomeGuide }) {
    function toggleAddMenu(event) {
      event.stopPropagation()
      const refs = getRefs()
      const menu = document.getElementById('add-menu')
      menu.style.display = menu.style.display === 'none' ? '' : 'none'
      refs.btnAdd.classList.toggle('active', menu.style.display !== 'none')
    }

    function hideAddMenu() {
      document.getElementById('add-menu').style.display = 'none'
      getRefs()?.btnAdd.classList.remove('active')
    }

    async function openFromGuide(kind) {
      dismissWelcomeGuide()
      if (kind === 'folder') await openFolder()
      else await openFile()
    }

    function onDragOver(event) {
      if (!hasDraggedFiles(event.dataTransfer)) return
      event.preventDefault()
      getRefs().dropOverlay.classList.add('on')
    }

    function onDragLeave() {
      getRefs().dropOverlay.classList.remove('on')
    }

    async function onDrop(event) {
      if (!hasDraggedFiles(event.dataTransfer)) return
      event.preventDefault()
      getRefs().dropOverlay.classList.remove('on')
      const files = [...event.dataTransfer.files].filter(file => /\.(md|markdown)$/i.test(file.name))
      if (!files.length) return
      const api = globalScope.api
      for (const file of files) {
        await load({
          content: await file.text(),
          filename: file.name,
          path: resolveDroppedFilePath(file, api),
        })
      }
    }

    return {
      toggleAddMenu,
      hideAddMenu,
      openFromGuide,
      onDragOver,
      onDragLeave,
      onDrop,
    }
  }

  const api = {
    createShellActionsController,
    hasDraggedFiles,
    resolveDroppedFilePath,
  }

  globalScope.MDVShellActions = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
