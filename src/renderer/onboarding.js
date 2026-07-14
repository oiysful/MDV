(function (globalScope) {
  const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

  function getFocusableElements(container) {
    if (!container) return []
    return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
  }

  function createOnboardingController({ getRefs, storage, dismissedKey, defaultAppDismissedKey, getTabCount }) {
    let toastTimer = null
    let lastDefaultAppStatus = null
    let defaultAppGuideLastFocus = null
    let defaultAppGuideTrapBound = false

    function getDefaultAppDismissSignature(status) {
      if (!status) return ''
      const handlers = Array.isArray(status.defaultHandlers)
        ? status.defaultHandlers.map(handler => `${handler.extension}:${handler.path}`).join('|')
        : ''
      return `${status.appPath || ''}::${handlers}`
    }

    function isDefaultAppGuideDismissed(status) {
      if (!defaultAppDismissedKey) return false
      try {
        const saved = JSON.parse(storage.getItem(defaultAppDismissedKey) || 'null')
        return Boolean(saved && saved.signature === getDefaultAppDismissSignature(status))
      } catch (error) {
        console.warn('기본 앱 안내 숨김 상태를 읽을 수 없습니다:', error)
        return false
      }
    }

    function showToast(message) {
      const refs = getRefs()
      if (!refs?.toast) return
      refs.toast.textContent = message
      refs.toast.classList.add('show')
      clearTimeout(toastTimer)
      toastTimer = setTimeout(() => refs.toast.classList.remove('show'), 1600)
    }

    function updateEntryAffordance() {
      const refs = getRefs()
      const isEmpty = getTabCount() === 0
      document.body.classList.toggle('empty-entry-emphasis', isEmpty)
      if (!isEmpty && refs?.welcomeGuide) refs.welcomeGuide.classList.remove('show')
    }

    function dismissWelcomeGuide(persist = true) {
      const refs = getRefs()
      if (!refs?.welcomeGuide) return
      refs.welcomeGuide.classList.remove('show')
      if (persist) storage.setItem(dismissedKey, '1')
    }

    function maybeShowWelcomeGuide() {
      const refs = getRefs()
      if (!refs?.welcomeGuide) return
      const dismissed = storage.getItem(dismissedKey) === '1'
      refs.welcomeGuide.classList.toggle('show', getTabCount() === 0 && !dismissed)
    }

    function isWelcomeGuideOpen() {
      return Boolean(getRefs()?.welcomeGuide?.classList.contains('show'))
    }

    function isDefaultAppGuideOpen() {
      return Boolean(getRefs()?.defaultAppGuide?.classList.contains('show'))
    }

    // #default-app-guide is the only blocking guide (centered, no close-X), so it's the only
    // one that gets a focus trap. #welcome-guide is a dismissible corner card that must stay
    // non-blocking — trapping focus there would lock the app around a card meant to be ignorable.
    function bindDefaultAppGuideFocusTrap(modal) {
      if (defaultAppGuideTrapBound) return
      defaultAppGuideTrapBound = true
      modal.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return
        const focusable = getFocusableElements(modal)
        if (!focusable.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      })
    }

    function openDefaultAppGuide(modal) {
      defaultAppGuideLastFocus = document.activeElement
      bindDefaultAppGuideFocusTrap(modal)
      modal.classList.add('show')
      // requestAnimationFrame: focusing an element in the same tick it goes from
      // display:none to visible silently fails because it has no layout box yet.
      requestAnimationFrame(() => {
        const focusable = getFocusableElements(modal)
        if (focusable.length) focusable[0].focus()
      })
    }

    function closeDefaultAppGuide(modal) {
      modal.classList.remove('show')
      const previousFocus = defaultAppGuideLastFocus
      defaultAppGuideLastFocus = null
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus()
    }

    function updateDefaultAppGuide(status) {
      const refs = getRefs()
      if (!refs?.defaultAppGuide) return
      lastDefaultAppStatus = status
      const shouldShow = Boolean(status && !status.registered && status.needsAction && !isDefaultAppGuideDismissed(status))
      const isShown = refs.defaultAppGuide.classList.contains('show')
      if (shouldShow && !isShown) openDefaultAppGuide(refs.defaultAppGuide)
      else if (!shouldShow && isShown) closeDefaultAppGuide(refs.defaultAppGuide)
    }

    function dismissDefaultAppGuide() {
      const refs = getRefs()
      if (!refs?.defaultAppGuide) return
      if (defaultAppDismissedKey && refs.defaultAppDoNotShow?.checked) {
        storage.setItem(defaultAppDismissedKey, JSON.stringify({ signature: getDefaultAppDismissSignature(lastDefaultAppStatus) }))
      }
      closeDefaultAppGuide(refs.defaultAppGuide)
    }

    return {
      showToast,
      updateEntryAffordance,
      dismissWelcomeGuide,
      maybeShowWelcomeGuide,
      updateDefaultAppGuide,
      dismissDefaultAppGuide,
      isWelcomeGuideOpen,
      isDefaultAppGuideOpen,
    }
  }

  const api = { createOnboardingController, getFocusableElements }
  globalScope.MDVOnboarding = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
