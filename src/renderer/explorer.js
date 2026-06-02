(function (globalScope) {
  const EXPLORER_EMPTY_HTML = '<div class="tree-hint">위의 <strong>+</strong> 버튼으로<br>폴더를 열어 탐색하세요.</div>'
  const FOLDER_CLOSED_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.75 4.75A1.75 1.75 0 0 1 3.5 3h2.35c.34 0 .67.12.93.34l1.12.91c.13.11.3.16.47.16h4.13a1.75 1.75 0 0 1 1.75 1.75v5.34a1.75 1.75 0 0 1-1.75 1.75H3.5a1.75 1.75 0 0 1-1.75-1.75V4.75Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>'
  const FOLDER_OPEN_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.75 5.25A1.75 1.75 0 0 1 3.5 3.5h2.14c.34 0 .67.11.94.33l1.15.92c.13.1.29.15.46.15h4.31c.97 0 1.75.78 1.75 1.75 0 .14-.02.29-.05.43l-.86 4.02a1.75 1.75 0 0 1-1.71 1.4H3.48a1.75 1.75 0 0 1-1.72-1.42L1.2 7.07a1.75 1.75 0 0 1 .55-1.82Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>'
  const FILE_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 2.75h4.88c.33 0 .65.13.88.36l2.88 2.88c.23.23.36.55.36.88V13A1.25 1.25 0 0 1 11.75 14.25h-7.5A1.25 1.25 0 0 1 3 13V4A1.25 1.25 0 0 1 4.25 2.75H4Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M8.75 2.75V6.5h3.75" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>'

  function getTreeRowPadding(depth) {
    return `${12 + depth * 14}px`
  }

  function getFolderArrow(isOpen) {
    return isOpen ? '▼' : '▶'
  }

  function getExplorerRootLabel(root, showFullPath) {
    if (!root) return '폴더를 선택하세요'
    return showFullPath ? root : root.split('/').pop() || root
  }

  function createExplorerController({ getRefs, api, load, switchToExplorerTab, showAppContextMenu, revealInFinder }) {
    let currentExplorerRoot = null
    let explorerShowFullPath = false

    function setActiveTreeItem(container, item) {
      container.closest('#layout').querySelectorAll('.tree-item.active').forEach(element => { element.classList.remove('active') })
      item.classList.add('active')
    }

    function syncExplorerHeader() {
      const refs = getRefs()
      const hasRoot = Boolean(currentExplorerRoot)
      refs.explorerPath.textContent = getExplorerRootLabel(currentExplorerRoot, explorerShowFullPath)
      refs.explorerPath.title = hasRoot ? currentExplorerRoot : ''
      refs.btnExplorerReveal.classList.toggle('hidden', !hasRoot)
      refs.btnExplorerClose.classList.toggle('hidden', !hasRoot)
    }

    function clearExplorerRoot() {
      const refs = getRefs()
      currentExplorerRoot = null
      explorerShowFullPath = false
      refs.explorerTree.innerHTML = EXPLORER_EMPTY_HTML
      syncExplorerHeader()
    }

    function toggleExplorerPathInfo() {
      if (!currentExplorerRoot) return
      explorerShowFullPath = !explorerShowFullPath
      syncExplorerHeader()
    }

    async function revealCurrentExplorerRoot() {
      if (!currentExplorerRoot) return
      await revealInFinder(currentExplorerRoot)
    }

    function getCurrentExplorerRoot() {
      return currentExplorerRoot
    }

    async function openFolder() {
      const res = JSON.parse(await api.openFolderDialog())
      if (res.cancelled || res.error) return
      currentExplorerRoot = res.path
      explorerShowFullPath = false
      syncExplorerHeader()
      switchToExplorerTab()
      await loadDir(res.path, getRefs().explorerTree, 0)
    }

    async function loadDir(path, container, depth) {
      container.innerHTML = '<div class="tree-hint">로드 중…</div>'
      const res = JSON.parse(await api.listDirectory(path))
      container.innerHTML = ''
      if (res.error) {
        container.innerHTML = `<div class="tree-hint">${res.error}</div>`
        return
      }
      if (!res.entries.length) {
        container.innerHTML = '<div class="tree-hint">.md 파일 없음</div>'
        return
      }
      res.entries.forEach(entry => { renderTreeEntry(entry, container, depth) })
    }

    function renderTreeEntry(entry, container, depth) {
      const item = document.createElement('div')
      item.className = 'tree-item tree-' + entry.type
      const row = document.createElement('div')
      row.className = 'tree-row'
      row.style.paddingLeft = getTreeRowPadding(depth)

      if (entry.type === 'dir') {
        const arrow = document.createElement('span')
        arrow.className = 'tree-arrow'
        arrow.textContent = getFolderArrow(false)

        const icon = document.createElement('span')
        icon.className = 'tree-icon'
        icon.innerHTML = FOLDER_CLOSED_SVG

        const name = document.createElement('span')
        name.className = 'tree-name'
        name.textContent = entry.name

        row.append(arrow, icon, name)

        const children = document.createElement('div')
        children.className = 'tree-children'
        let loaded = false

        row.addEventListener('click', async () => {
          const isOpen = children.classList.toggle('open')
          arrow.textContent = getFolderArrow(isOpen)
          icon.innerHTML = isOpen ? FOLDER_OPEN_SVG : FOLDER_CLOSED_SVG
          if (isOpen && !loaded) {
            loaded = true
            await loadDir(entry.path, children, depth + 1)
          }
        })

        row.addEventListener('contextmenu', event => {
          if (!currentExplorerRoot) return
          event.preventDefault()
          showAppContextMenu(event.clientX, event.clientY, [
            {
              label: '폴더 닫기',
              action: () => clearExplorerRoot(),
            },
          ])
        })

        item.append(row, children)
      } else {
        const icon = document.createElement('span')
        icon.className = 'tree-icon'
        icon.innerHTML = FILE_SVG

        const name = document.createElement('span')
        name.className = 'tree-name'
        name.textContent = entry.name
        row.append(icon, name)

        row.addEventListener('click', async event => {
          if (event.metaKey) {
            await api.newWindow(entry.path)
            return
          }

          const data = JSON.parse(await api.readFile(entry.path))
          await load(data)
          setActiveTreeItem(container, item)
        })

        item.appendChild(row)
      }

      container.appendChild(item)
    }

    return {
      openFolder,
      loadDir,
      renderTreeEntry,
      syncExplorerHeader,
      clearExplorerRoot,
      toggleExplorerPathInfo,
      revealCurrentExplorerRoot,
      getCurrentExplorerRoot,
    }
  }

  const api = {
    createExplorerController,
    getTreeRowPadding,
    getFolderArrow,
    getExplorerRootLabel,
  }

  globalScope.MDVExplorer = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
