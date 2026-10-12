(function (globalScope) {
  // The order the theme button cycles through, and the only values this controller accepts.
  // A stored value outside the set used to survive construction unvalidated, and then
  // toggleTheme's lookup produced `undefined`, which storage wrote back as the string
  // "undefined" -- not a key either, so the button stayed dead across restarts (issue #20).
  // The plausible way to get such a value is a downgrade from a build that shipped a fourth
  // theme. Normalizing at construction is enough on its own: `theme` is otherwise only ever
  // assigned this map's result, which cannot miss for a key that is already in the set.
  const THEME_CYCLE = { auto: 'light', light: 'dark', dark: 'auto' }

  function normalizeStoredTheme(stored) {
    return Object.hasOwn(THEME_CYCLE, stored) ? stored : 'auto'
  }

  function createThemeController({ matchMedia, storage, documentRef, getRefs, onThemeApplied }) {
    let theme = normalizeStoredTheme(storage.getItem('theme'))

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
      theme = THEME_CYCLE[theme]
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
