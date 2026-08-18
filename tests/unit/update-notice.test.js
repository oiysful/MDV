const test = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')

const { createUpdateNoticeController, BREW_UPGRADE_COMMAND } = require('../../src/renderer/update-notice.js')

function makeHarness({ writeText, isBlockedByModal } = {}) {
  const dom = new JSDOM(`
    <div id="update-banner">
      <span id="update-banner-text"></span>
    </div>
  `)
  global.document = dom.window.document
  // Node exposes a global `navigator` as a getter-only accessor (no setter); defineProperty
  // is required to stub it -- same pattern as tests/unit/app-runtime.test.js's copy tests.
  Object.defineProperty(global, 'navigator', {
    value: { clipboard: { writeText } },
    configurable: true,
    writable: true,
  })

  const refs = {
    updateBanner: dom.window.document.getElementById('update-banner'),
    updateBannerText: dom.window.document.getElementById('update-banner-text'),
  }
  const toasts = []
  const externalUrls = []
  const dismissedVersions = []
  const controller = createUpdateNoticeController({
    getRefs: () => refs,
    api: {
      openExternalUrl: url => externalUrls.push(url),
      dismissUpdateNotice: version => dismissedVersions.push(version),
    },
    showToast: message => toasts.push(message),
    isBlockedByModal,
  })

  return { controller, refs, toasts, externalUrls, dismissedVersions }
}

const INFO = { version: '1.3.0', tagName: 'v1.3.0', releaseUrl: 'https://github.com/oiysful/MDV/releases/tag/v1.3.0' }

test('handleUpdateAvailable(info) shows the banner with the version in the text', () => {
  const { controller, refs } = makeHarness()

  controller.handleUpdateAvailable(INFO)

  assert.equal(refs.updateBanner.classList.contains('show'), true)
  assert.match(refs.updateBannerText.textContent, /1\.3\.0/)
})

test('handleUpdateAvailable(null) hides the banner', () => {
  const { controller, refs } = makeHarness()
  controller.handleUpdateAvailable(INFO)

  controller.handleUpdateAvailable(null)

  assert.equal(refs.updateBanner.classList.contains('show'), false)
})

test('dismiss() reports the current version to main and hides the banner', () => {
  const { controller, refs, dismissedVersions } = makeHarness()
  controller.handleUpdateAvailable(INFO)

  controller.dismiss()

  assert.deepEqual(dismissedVersions, ['1.3.0'])
  assert.equal(refs.updateBanner.classList.contains('show'), false)
})

test('dismiss() with no current info is a no-op', () => {
  const { controller, dismissedVersions } = makeHarness()

  controller.dismiss()

  assert.deepEqual(dismissedVersions, [])
})

test('openReleaseNotes() opens the release URL from the current info', () => {
  const { controller, externalUrls } = makeHarness()
  controller.handleUpdateAvailable(INFO)

  controller.openReleaseNotes()

  assert.deepEqual(externalUrls, [INFO.releaseUrl])
})

test('copyUpgradeCommand writes the exact brew upgrade command and shows a success toast', async () => {
  const { controller, toasts } = makeHarness({ writeText: () => Promise.resolve() })

  await controller.copyUpgradeCommand()

  assert.equal(BREW_UPGRADE_COMMAND, 'brew upgrade --cask oiysful/tap/mdv')
  assert.deepEqual(toasts, ['명령어가 복사되었습니다'])
})

test('copyUpgradeCommand shows a failure toast when the clipboard write rejects', async () => {
  const { controller, toasts } = makeHarness({ writeText: () => Promise.reject(new Error('denied')) })

  await controller.copyUpgradeCommand()

  assert.deepEqual(toasts, ['복사 실패'])
})

test('a blocking modal (isBlockedByModal) suppresses the banner even with info set', () => {
  const { controller, refs } = makeHarness({ isBlockedByModal: () => true })

  controller.handleUpdateAvailable(INFO)

  assert.equal(refs.updateBanner.classList.contains('show'), false)
})

test('recheckVisibility() re-shows the banner once isBlockedByModal stops returning true', () => {
  let blocked = true
  const { controller, refs } = makeHarness({ isBlockedByModal: () => blocked })
  controller.handleUpdateAvailable(INFO)
  assert.equal(refs.updateBanner.classList.contains('show'), false)

  blocked = false
  controller.recheckVisibility()

  assert.equal(refs.updateBanner.classList.contains('show'), true)
})
