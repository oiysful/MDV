(function (globalScope) {
  // Browser: index.html loads i18n.js first, which puts it on globalScope. Node (unit tests via
  // require()): no script tag ran, so require it -- same fallback shape as markdown.js's js-yaml.
  const { t } = globalScope.MDVI18n || require('./i18n.js')
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
        refs.updateBannerText.textContent = t('update.available', currentInfo.version)
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
        showToast(t('update.commandCopied'))
      } catch {
        showToast(t('toast.copyFailed'))
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
