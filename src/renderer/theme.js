(function (globalScope) {
  function createThemeController({ matchMedia, storage, documentRef, getRefs, onThemeApplied }) {
    let theme = storage.getItem('theme') || 'auto'

    // Split out so print/PDF export can force the light hljs stylesheet for the duration of
    // the job and restore it afterward without touching the stored theme setting or re-running
    // applyTheme()'s other side effects (icon labels, mermaid redraw).
    function applyCodeTheme(isDark) {
      const hlDark = documentRef.getElementById('hljs-dark')
      const hlLight = documentRef.getElementById('hljs-light')
      if (hlDark) hlDark.disabled = !isDark
      if (hlLight) hlLight.disabled = isDark
    }

    function applyTheme() {
      const isDark = theme === 'dark' || (theme === 'auto' && matchMedia.matches)
      documentRef.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')

      applyCodeTheme(isDark)

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

    // Pure read of the same isDark calculation applyTheme() makes, with none of its side
    // effects (DOM attribute, icon/label refresh, onThemeApplied redraw callback). Exists so
    // something that needs the current theme *outside* an actual theme-change event -- e.g. a
    // lazily-loaded library initializing itself for the first time -- can ask without
    // triggering a full re-apply.
    function getIsDark() {
      return theme === 'dark' || (theme === 'auto' && matchMedia.matches)
    }

    return {
      applyTheme,
      applyCodeTheme,
      toggleTheme,
      handleSystemThemeChange,
      getTheme,
      getIsDark,
    }
  }

  const api = { createThemeController }
  globalScope.MDVTheme = api

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
})(typeof window !== 'undefined' ? window : globalThis)
