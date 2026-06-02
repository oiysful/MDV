(function (globalScope) {
  function computeContextMenuPosition(x, y, menuWidth, menuHeight, windowWidth, windowHeight, padding = 8) {
    return {
      left: Math.max(padding, Math.min(x, windowWidth - menuWidth - padding)),
      top: Math.max(padding, Math.min(y, windowHeight - menuHeight - padding)),
    }
  }

  function createAppContextMenuController({ getRefs, documentRef, windowRef }) {
    function hide() {
      const menu = getRefs()?.appContextMenu
      if (!menu) return
      menu.style.display = 'none'
      menu.innerHTML = ''
    }

    function show(x, y, items) {
      const menu = getRefs()?.appContextMenu
      if (!menu || !items.length) return

      menu.innerHTML = ''
      items.forEach(item => {
        const button = documentRef.createElement('button')
        button.className = 'ctx-item'
        button.textContent = item.label
        button.addEventListener('click', async event => {
          event.stopPropagation()
          hide()
          await item.action()
        })
        menu.appendChild(button)
      })

      menu.style.display = 'block'
      menu.style.left = '0px'
      menu.style.top = '0px'

      const rect = menu.getBoundingClientRect()
      const position = computeContextMenuPosition(
        x,
        y,
        rect.width,
        rect.height,
        windowRef.innerWidth,
        windowRef.innerHeight,
      )

      menu.style.left = `${position.left}px`
      menu.style.top = `${position.top}px`
    }

    return {
      show,
      hide,
    }
  }

  const api = {
    createAppContextMenuController,
    computeContextMenuPosition,
  }

  globalScope.MDVContextMenu = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
