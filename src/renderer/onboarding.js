(function (globalScope) {
  function createOnboardingController({ getRefs, storage, dismissedKey, getTabCount }) {
    let toastTimer = null

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

    return {
      showToast,
      updateEntryAffordance,
      dismissWelcomeGuide,
      maybeShowWelcomeGuide,
    }
  }

  const api = { createOnboardingController }
  globalScope.MDVOnboarding = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
