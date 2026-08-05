const test = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')

const {
  createEmptyStateHtml,
  getNextUntitledFilename,
  createAppRuntimeController,
} = require('../../src/renderer/app-runtime.js')

// copyAll/copyCode only touch documentRef, getMarkdown, and showToast (which only needs
// onboardingController.showToast); every other constructor param is a no-op stub since
// createAppRuntimeController just defines closures and never calls them eagerly.
function makeCopyHarness({ markdown, writeText } = {}) {
  const dom = new JSDOM(`
    <button id="btn-copy-all"></button>
    <div class="code-wrapper">
      <button class="copy-btn"></button>
      <code>console.log('hi')</code>
    </div>
  `)
  global.document = dom.window.document
  // Node exposes a global `navigator` as a getter-only accessor (no setter), so a plain
  // `global.navigator = ...` assignment silently no-ops; defineProperty is required to stub it.
  Object.defineProperty(global, 'navigator', {
    value: { clipboard: { writeText } },
    configurable: true,
    writable: true,
  })

  const toasts = []
  const controller = createAppRuntimeController({
    getRefs: () => ({}),
    documentRef: dom.window.document,
    windowRef: dom.window,
    api: {},
    sysDark: false,
    markdownController: {},
    themeController: {},
    onboardingController: { showToast: (message) => toasts.push(message) },
    searchController: {},
    getMarkdown: () => markdown,
    setMarkdown: () => {},
    getSidebarOpen: () => false,
    setSidebarOpen: () => {},
    setActiveTabName: () => {},
    getEditorController: () => ({}),
    getExplorerController: () => ({}),
    getWorkspaceController: () => ({}),
    getDocumentFlowController: () => ({}),
    getShellActionsController: () => ({}),
    getContextMenuController: () => ({}),
    ensurePreviewRendered: () => {},
  })

  return {
    controller,
    toasts,
    copyAllButton: dom.window.document.getElementById('btn-copy-all'),
    codeButton: dom.window.document.querySelector('.copy-btn'),
  }
}

test('getNextUntitledFilename increments untitled names predictably', () => {
  assert.equal(getNextUntitledFilename(1), 'untitled.md')
  assert.equal(getNextUntitledFilename(2), 'untitled-2.md')
  assert.equal(getNextUntitledFilename(5), 'untitled-5.md')
})

test('createEmptyStateHtml keeps file and folder open actions in the empty state', () => {
  const html = createEmptyStateHtml()
  assert.match(html, /data-command="openFile"/)
  assert.match(html, /data-command="openFolder"/)
  assert.match(html, /좌측 상단/)
  assert.match(html, /aria-label="파일 열기"/)
  assert.match(html, /aria-label="폴더 열기"/)
  assert.doesNotMatch(html, /onclick=/)
  assert.match(html, /열린 파일 없음/)
})

test('copyAll shows a failure toast and does not mark the button copied when clipboard write rejects', async () => {
  const { controller, toasts, copyAllButton } = makeCopyHarness({
    markdown: '# hello',
    writeText: () => Promise.reject(new Error('denied')),
  })

  await controller.copyAll()

  assert.deepEqual(toasts, ['복사 실패'])
  assert.equal(copyAllButton.classList.contains('copied'), false)
})

test('copyAll shows the success toast and marks the button copied when clipboard write resolves', async () => {
  const { controller, toasts, copyAllButton } = makeCopyHarness({
    markdown: '# hello',
    writeText: () => Promise.resolve(),
  })

  await controller.copyAll()

  assert.deepEqual(toasts, ['복사됨'])
  assert.equal(copyAllButton.classList.contains('copied'), true)
})

test('copyCode shows a failure toast and does not mark the button copied when clipboard write rejects', async () => {
  const { controller, toasts, codeButton } = makeCopyHarness({
    writeText: () => Promise.reject(new Error('denied')),
  })

  await controller.copyCode(codeButton)

  assert.deepEqual(toasts, ['코드 복사 실패'])
  assert.equal(codeButton.classList.contains('copied'), false)
})

test('copyCode shows the success toast and marks the button copied when clipboard write resolves', async () => {
  const { controller, toasts, codeButton } = makeCopyHarness({
    writeText: () => Promise.resolve(),
  })

  await controller.copyCode(codeButton)

  assert.deepEqual(toasts, ['코드 복사됨'])
  assert.equal(codeButton.classList.contains('copied'), true)
})
