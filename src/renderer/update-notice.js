(function (globalScope) {
  const BREW_UPGRADE_COMMAND = 'brew upgrade --cask oiysful/tap/mdv'

  function createUpdateNoticeController({ getRefs, api, showToast, isBlockedByModal }) {
    let currentInfo = null

    function render() {
      const refs = getRefs()
      if (!refs?.updateBanner) return
      const shouldShow = Boolean(currentInfo) && !(isBlockedByModal && isBlockedByModal())
      refs.updateBanner.classList.toggle('show', shouldShow)
      // currentInfo.version already passed update-checker.js's normalizeTag (digits and dots
      // only) before this ever reaches the renderer, but textContent regardless -- see this
      // repo's own rule against building renderer hints from innerHTML with a dynamic part.
      if (currentInfo && refs.updateBannerText) {
        refs.updateBannerText.textContent = `MDV ${currentInfo.version} 버전이 있습니다`
      }
    }

    function handleUpdateAvailable(data) {
      currentInfo = data || null
      render()
    }

    function dismiss() {
      if (!currentInfo) return
      api.dismissUpdateNotice(currentInfo.version)
      currentInfo = null
      render()
    }

    function openReleaseNotes() {
      if (currentInfo?.releaseUrl) api.openExternalUrl(currentInfo.releaseUrl)
    }

    async function copyUpgradeCommand() {
      try {
        await navigator.clipboard.writeText(BREW_UPGRADE_COMMAND)
        showToast('명령어가 복사되었습니다')
      } catch {
        showToast('복사 실패')
      }
    }

    // Re-run visibility when a blocking modal (default-app-guide) closes, so a pending
    // banner suppressed behind it isn't lost for the rest of the session.
    function recheckVisibility() {
      render()
    }

    return { handleUpdateAvailable, dismiss, openReleaseNotes, copyUpgradeCommand, recheckVisibility }
  }

  const api = { createUpdateNoticeController, BREW_UPGRADE_COMMAND }
  globalScope.MDVUpdateNotice = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
