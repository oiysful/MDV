(function (globalScope) {
  const EXPLORER_EMPTY_HTML = '<div class="tree-hint">위의 <strong>열기</strong> 버튼으로<br>폴더를 열어 탐색하세요.</div>'
  const FOLDER_CLOSED_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.75 4.75A1.75 1.75 0 0 1 3.5 3h2.35c.34 0 .67.12.93.34l1.12.91c.13.11.3.16.47.16h4.13a1.75 1.75 0 0 1 1.75 1.75v5.34a1.75 1.75 0 0 1-1.75 1.75H3.5a1.75 1.75 0 0 1-1.75-1.75V4.75Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>'
  const FOLDER_OPEN_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.75 5.25V4.75A1.75 1.75 0 0 1 3.5 3h2.14c.34 0 .67.11.94.33l1.15.92c.13.1.29.15.46.15h4.31a1.75 1.75 0 0 1 1.75 1.75v.35" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M1 6.75L1.9 5.65A1.5 1.5 0 0 1 3.06 5.1H12.46A1.5 1.5 0 0 1 13.62 5.65L14.52 6.75 13.6 11.3A1.5 1.5 0 0 1 12.16 12.5H3.36A1.5 1.5 0 0 1 1.92 11.3Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>'
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

  function createExplorerController({ getRefs, api, load, switchToExplorerTab, showAppContextMenu, revealInFinder, onExplorerRootChanged }) {
    let currentExplorerRoot = null
    let explorerShowFullPath = false
    let treeKeyboardBound = false
    let currentActiveFilePath = null
    let refreshInFlight = false
    const { getRovingIndex } = globalScope.MDVRoving

    function clearActiveTreeItems(container) {
      container.closest('#layout').querySelectorAll('.tree-item.active').forEach(element => { element.classList.remove('active') })
    }

    function setActiveTreeItem(container, item) {
      clearActiveTreeItems(container)
      item.classList.add('active')
    }

    // Tab -> explorer sync (openFileRow below already covers the explorer -> tab direction:
    // clicking a file row opens it and highlights that row immediately). Remembers the active
    // path so it survives tree re-renders (loadDir re-applies it at the end of every render,
    // root or subtree), and clears the highlight rather than reaching for it when the row isn't visible
    // (e.g. inside a collapsed folder) — v1 deliberately doesn't auto-expand to reveal it.
    function setActiveFilePath(path) {
      currentActiveFilePath = path
      const tree = getRefs().explorerTree
      const row = path ? getVisibleTreeRows().find(r => r.dataset.path === path) : null
      if (row) {
        setActiveTreeItem(tree, row.closest('.tree-item'))
      } else {
        clearActiveTreeItems(tree)
      }
    }

    // Rows inside a collapsed (non-.open) .tree-children group are hidden, and lazily-loaded
    // subtrees aren't in the DOM at all — so this returns exactly the rows a user can see,
    // which is the set arrow-key navigation walks.
    function getVisibleTreeRows() {
      const tree = getRefs().explorerTree
      return Array.from(tree.querySelectorAll('.tree-row')).filter(row => !row.closest('.tree-children:not(.open)'))
    }

    // Roving tabindex: exactly one row is Tab-reachable (tabindex="0"); arrows move focus and
    // the 0 follows it. focusTreeRow moves focus now; syncTreeRoving only positions the 0
    // (without stealing focus) after a root render.
    function focusTreeRow(row) {
      const tree = getRefs().explorerTree
      tree.querySelectorAll('.tree-row').forEach(r => { r.tabIndex = -1 })
      row.tabIndex = 0
      row.focus()
    }

    function syncTreeRoving(preferredRow) {
      const tree = getRefs().explorerTree
      tree.querySelectorAll('.tree-row').forEach(r => { r.tabIndex = -1 })
      const rows = getVisibleTreeRows()
      const target = preferredRow && rows.includes(preferredRow) ? preferredRow : rows[0]
      if (target) target.tabIndex = 0
    }

    // Shared open/toggle logic, DOM-driven so both the per-row click listener and the
    // delegated keyboard handler call the same path (no mouse/keyboard duplication).
    // Also reused by the directory-watch refresh to deterministically re-open a folder
    // (rather than toggle it) when restoring expansion state after a tree rebuild.
    async function setFolderRowOpen(row, open) {
      const children = row.nextElementSibling
      const arrow = row.querySelector('.tree-arrow')
      const icon = row.querySelector('.tree-icon')
      children.classList.toggle('open', open)
      arrow.textContent = getFolderArrow(open)
      icon.innerHTML = open ? FOLDER_OPEN_SVG : FOLDER_CLOSED_SVG
      row.setAttribute('aria-expanded', open ? 'true' : 'false')
      if (open && children.dataset.loaded !== 'true') {
        children.dataset.loaded = 'true'
        await loadDir(row.dataset.path, children, Number(row.dataset.depth) + 1)
      }
    }

    async function toggleFolderRow(row) {
      const isOpen = row.nextElementSibling.classList.contains('open')
      await setFolderRowOpen(row, !isOpen)
    }

    // Snapshot of which folder paths are currently expanded, in document order (parent
    // rows always precede their children here since the tree renders depth-first) --
    // that order matters for restoreExpandedPaths, which must open a parent before it can
    // find and open a child that was lazily rendered underneath it.
    function getExpandedPaths() {
      const tree = getRefs().explorerTree
      return Array.from(tree.querySelectorAll('.tree-row')).filter(row => {
        const children = row.nextElementSibling
        return children?.classList.contains('tree-children') && children.classList.contains('open')
      }).map(row => row.dataset.path)
    }

    // Re-opens (and lazily loads) each previously-expanded folder path after a full tree
    // rebuild wiped the DOM. Must run sequentially in top-down order: a nested path's row
    // doesn't exist until its ancestor has been re-opened and re-rendered.
    async function restoreExpandedPaths(paths) {
      for (const path of paths) {
        const row = getVisibleTreeRows().find(r => r.dataset.path === path && r.parentElement.classList.contains('tree-dir'))
        if (row) await setFolderRowOpen(row, true)
      }
    }

    // Debounced on the main-process side already; this guard just avoids two overlapping
    // rebuilds if a second directory-changed event arrives while the first is still restoring
    // expanded folders.
    async function refreshTree() {
      if (!currentExplorerRoot || refreshInFlight) return
      refreshInFlight = true
      try {
        const expandedPaths = getExpandedPaths()
        await loadDir(currentExplorerRoot, getRefs().explorerTree, 0)
        await restoreExpandedPaths(expandedPaths)
      } finally {
        refreshInFlight = false
      }
    }

    api.onDirectoryChanged?.(payload => {
      if (payload?.path === currentExplorerRoot) refreshTree()
    })

    async function openFileRow(row, event) {
      if (event?.metaKey) {
        await api.newWindow(row.dataset.path)
        return
      }
      const data = await api.readFile(row.dataset.path)
      await load(data)
      setActiveTreeItem(getRefs().explorerTree, row.closest('.tree-item'))
    }

    // One delegated keydown listener on the persistent #explorer-tree container (survives every
    // loadDir innerHTML rebuild). ARIA APG Treeview navigation, manual activation.
    function bindTreeKeyboard(tree) {
      if (treeKeyboardBound) return
      treeKeyboardBound = true
      tree.addEventListener('keydown', async event => {
        const row = event.target.closest('.tree-row')
        if (!row) return
        const rows = getVisibleTreeRows()
        const index = rows.indexOf(row)
        const isDir = row.parentElement.classList.contains('tree-dir')
        const children = isDir ? row.nextElementSibling : null
        const isOpen = isDir && children.classList.contains('open')

        if (event.key === 'ArrowDown') {
          event.preventDefault()
          const target = rows[getRovingIndex(index, 1, rows.length)]
          if (target) focusTreeRow(target)
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          const target = rows[getRovingIndex(index, -1, rows.length)]
          if (target) focusTreeRow(target)
        } else if (event.key === 'Home') {
          event.preventDefault()
          if (rows[0]) focusTreeRow(rows[0])
        } else if (event.key === 'End') {
          event.preventDefault()
          if (rows[rows.length - 1]) focusTreeRow(rows[rows.length - 1])
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          if (isDir && !isOpen) {
            await toggleFolderRow(row)
            const firstChild = children.querySelector('.tree-row')
            if (firstChild) focusTreeRow(firstChild)
          } else {
            const target = rows[getRovingIndex(index, 1, rows.length)]
            if (target) focusTreeRow(target)
          }
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault()
          if (isDir && isOpen) {
            await toggleFolderRow(row)
            focusTreeRow(row)
          } else {
            const group = row.parentElement.parentElement
            if (group && group.classList.contains('tree-children')) {
              const parentRow = group.parentElement.querySelector(':scope > .tree-row')
              if (parentRow) focusTreeRow(parentRow)
            }
          }
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (isDir) await toggleFolderRow(row)
          else await openFileRow(row, event)
        }
      })
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
      if (currentExplorerRoot) api.unwatchDirectory?.(currentExplorerRoot)
      currentExplorerRoot = null
      explorerShowFullPath = false
      refs.explorerTree.innerHTML = EXPLORER_EMPTY_HTML
      syncExplorerHeader()
      onExplorerRootChanged?.()
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
      const res = await api.openFolderDialog()
      if (res.cancelled || res.error) return
      // Switching roots (re-picking a folder) must drop the previous watch first, or every
      // switch leaks one more chokidar watcher that never gets closed.
      if (currentExplorerRoot) await api.unwatchDirectory?.(currentExplorerRoot)
      currentExplorerRoot = res.path
      explorerShowFullPath = false
      syncExplorerHeader()
      onExplorerRootChanged?.()
      switchToExplorerTab()
      await loadDir(res.path, getRefs().explorerTree, 0)
      await api.watchDirectory?.(currentExplorerRoot)
    }

    // Session restore path: set the root and repaint the tree without switching the sidebar
    // tab or re-notifying the session (this is restoring, not a user-initiated change). If the
    // folder is gone, loadDir surfaces list-directory's error hint via the existing path.
    async function restoreRoot(root) {
      if (!root) return
      currentExplorerRoot = root
      explorerShowFullPath = false
      syncExplorerHeader()
      // loadDir re-applies currentActiveFilePath at the end of every render, this one included.
      await loadDir(root, getRefs().explorerTree, 0)
      await api.watchDirectory?.(root)
    }

    async function loadDir(path, container, depth) {
      const isRoot = depth === 0
      bindTreeKeyboard(getRefs().explorerTree)
      // Only restore focus on a full root re-render, and only if a tree row was the focused
      // element — never yank focus away from the editor on an unrelated rebuild.
      const focusedPath = isRoot && document.activeElement?.classList?.contains('tree-row')
        ? document.activeElement.dataset.path
        : null
      container.innerHTML = '<div class="tree-hint">로드 중…</div>'
      const res = await api.listDirectory(path)
      container.innerHTML = ''
      if (res.error) {
        // The error string carries OS text and the directory name, i.e. untrusted input —
        // it is the one hint that isn't a static literal, so it goes in as text, never HTML.
        const hint = document.createElement('div')
        hint.className = 'tree-hint'
        hint.textContent = res.error
        container.appendChild(hint)
        return
      }
      if (!res.entries.length) {
        container.innerHTML = '<div class="tree-hint">.md 파일 없음</div>'
        return
      }
      res.entries.forEach(entry => { renderTreeEntry(entry, container, depth) })
      if (isRoot) {
        const restore = focusedPath ? getVisibleTreeRows().find(r => r.dataset.path === focusedPath) : null
        if (restore) focusTreeRow(restore)
        else syncTreeRoving()
      }
      // Re-applied on every render, not just the root: expanding a subfolder re-renders just
      // that subtree (isRoot false) and can newly reveal the active tab's row, which should
      // light up immediately rather than staying dark until the next unrelated root re-render.
      // setActiveFilePath reads from getRefs().explorerTree (the whole tree), not `container`,
      // so it's safe to call regardless of which depth just rendered.
      setActiveFilePath(currentActiveFilePath)
    }

    function renderTreeEntry(entry, container, depth) {
      const item = document.createElement('div')
      item.className = 'tree-item tree-' + entry.type
      const row = document.createElement('div')
      row.className = 'tree-row'
      row.style.paddingLeft = getTreeRowPadding(depth)
      row.setAttribute('role', 'treeitem')
      row.setAttribute('aria-level', String(depth + 1))
      row.tabIndex = -1
      row.dataset.path = entry.path
      row.dataset.depth = depth

      if (entry.type === 'dir') {
        row.setAttribute('aria-expanded', 'false')

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
        children.setAttribute('role', 'group')

        row.addEventListener('click', () => toggleFolderRow(row))

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

        row.addEventListener('click', event => openFileRow(row, event))

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
      restoreRoot,
      setActiveFilePath,
      refreshTree,
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
