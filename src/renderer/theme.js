(function (globalScope) {
  function createThemeController({ matchMedia, storage, documentRef, getRefs }) {
    let theme = storage.getItem('theme') || 'auto'

    function applyTheme() {
      const isDark = theme === 'dark' || (theme === 'auto' && matchMedia.matches)
      documentRef.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')

      const hlDark = documentRef.getElementById('hljs-dark')
      const hlLight = documentRef.getElementById('hljs-light')
      if (hlDark) hlDark.disabled = !isDark
      if (hlLight) hlLight.disabled = isDark

      const refs = getRefs ? getRefs() : null
      if (refs) {
        refs.icAuto.style.display = theme === 'auto' ? '' : 'none'
        refs.icMoon.style.display = theme === 'dark' ? '' : 'none'
        refs.icSun.style.display = theme === 'light' ? '' : 'none'
        const labels = { auto: '시스템 테마', light: '밝게', dark: '어둡게' }
        refs.btnTheme.title = labels[theme]
        refs.btnTheme.setAttribute('aria-label', labels[theme])
      }

      return { theme, isDark }
    }

    function toggleTheme() {
      theme = { auto: 'light', light: 'dark', dark: 'auto' }[theme]
      storage.setItem('theme', theme)
      return applyTheme()
    }

    function handleSystemThemeChange() {
      if (theme === 'auto') applyTheme()
    }

    function getTheme() {
      return theme
    }

    return {
      applyTheme,
      toggleTheme,
      handleSystemThemeChange,
      getTheme,
    }
  }

  const api = { createThemeController }
  globalScope.MDVTheme = api

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
})(typeof window !== 'undefined' ? window : globalThis)
