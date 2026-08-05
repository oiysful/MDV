(function (globalScope) {
  function createThemeController({ matchMedia, storage, documentRef, getRefs, onThemeApplied }) {
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

      // mermaid bakes its palette into the SVG at draw time (unlike hljs's stylesheet-swap
      // above), so a theme change needs an explicit redraw callback, not just this stylesheet
      // toggle. Fires on every applyTheme call, including the very first one at startup --
      // that call has nothing to redraw yet, but it's also this app's one guaranteed place to
      // hand mermaid its initial theme before any diagram renders.
      onThemeApplied?.(isDark)

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
