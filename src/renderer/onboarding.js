(function (globalScope) {
  function createOnboardingController({ getRefs, storage, dismissedKey, defaultAppDismissedKey, getTabCount }) {
    let toastTimer = null
    let lastDefaultAppStatus = null

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

    function updateDefaultAppGuide(status) {
      const refs = getRefs()
      if (!refs?.defaultAppGuide) return
      lastDefaultAppStatus = status
      if (!status || status.registered || !status.needsAction) {
        refs.defaultAppGuide.classList.remove('show')
        return
      }
      if (isDefaultAppGuideDismissed(status)) {
        refs.defaultAppGuide.classList.remove('show')
        return
      }
      refs.defaultAppGuide.classList.add('show')
    }

    function dismissDefaultAppGuide() {
      const refs = getRefs()
      if (!refs?.defaultAppGuide) return
      if (defaultAppDismissedKey && refs.defaultAppDoNotShow?.checked) {
        storage.setItem(defaultAppDismissedKey, JSON.stringify({ signature: getDefaultAppDismissSignature(lastDefaultAppStatus) }))
      }
      refs.defaultAppGuide.classList.remove('show')
    }

    return {
      showToast,
      updateEntryAffordance,
      dismissWelcomeGuide,
      maybeShowWelcomeGuide,
      updateDefaultAppGuide,
      dismissDefaultAppGuide,
    }
  }

  const api = { createOnboardingController }
  globalScope.MDVOnboarding = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
