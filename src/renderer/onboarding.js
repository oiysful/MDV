(function (globalScope) {
  const EXPLORER_EMPTY_HTML = '<div class="tree-hint">위의 <strong>+</strong> 버튼으로<br>폴더를 열어 탐색하세요.</div>'

  function createOnboardingController({ getRefs, storage, dismissedKey, getTabCount, getExplorerRoot, getExplorerShowFullPath, setExplorerShowFullPath, revealInFinder }) {
    let toastTimer = null

    function syncExplorerHeader() {
      const refs = getRefs()
      if (!refs) return
      const root = getExplorerRoot()
      const hasRoot = Boolean(root)
      const label = hasRoot
        ? (getExplorerShowFullPath() ? root : root.split('/').pop() || root)
        : '폴더를 선택하세요'
      refs.explorerPath.textContent = label
      refs.explorerPath.title = hasRoot ? root : ''
      refs.btnExplorerReveal.classList.toggle('hidden', !hasRoot)
      refs.btnExplorerClose.classList.toggle('hidden', !hasRoot)
    }

    function clearExplorerRoot() {
      const refs = getRefs()
      setExplorerShowFullPath(false)
      refs.explorerTree.innerHTML = EXPLORER_EMPTY_HTML
      syncExplorerHeader()
    }

    function toggleExplorerPathInfo() {
      if (!getExplorerRoot()) return
      setExplorerShowFullPath(!getExplorerShowFullPath())
      syncExplorerHeader()
    }

    async function revealCurrentExplorerRoot() {
      const root = getExplorerRoot()
      if (!root) return
      await revealInFinder(root)
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

    return {
      syncExplorerHeader,
      clearExplorerRoot,
      toggleExplorerPathInfo,
      revealCurrentExplorerRoot,
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
