// Controller-level test: TOC tracking in pure source mode.
//
// Regression: entering pure source mode used to leave the TOC scrollspy stuck on the last
// heading forever (editor.js's applySourceMode() recomputed heading offsets against #content
// right after hiding it, collapsing every offsetTop to 0 -- see markdown.js's
// rebuildSourceModeToc / editor.js's refreshSourceModeToc for the fix). This drives the real
// markdownController + editorController together, since the bug only exists in how they're
// wired, not in either one alone.

const test = require('node:test')
const assert = require('node:assert/strict')

const marked = require('marked')
const createDOMPurify = require('dompurify')

const { createMarkdownController } = require('../../src/renderer/markdown.js')
const { createEditorController } = require('../../src/renderer/editor.js')
const { createDom, createRefs, createStorageStub } = require('./helpers/harness.js')

// Minimal highlight.js stand-in -- this test never exercises rendered code fences.
const hljsStub = {
  getLanguage: () => undefined,
  highlight: code => ({ value: code }),
  highlightAuto: () => ({ value: '' }),
}

function makeHarness() {
  const dom = createDom()
  // createDom() only sets global.document; editor.js's resize listener and debounce timer
  // (bindEditorEvents/scheduleSourceModeTocRebuild) reference bare `window`, matching how
  // tests/unit/markdown.test.js's makeSnapshotHarness already sets this for the same reason.
  global.window = dom.window
  const refs = createRefs(dom)

  // jsdom has no layout engine: getComputedStyle falls back to the CSS-initial "normal" for
  // line-height, which parseFloat()s to NaN. Set explicit inline values so
  // computeSourceModeGeometry() has real numbers to work with (only *deltas* between
  // headings are meaningful here, since getBoundingClientRect() always reports an all-zero
  // rect under jsdom -- there's no way to assert an absolute baseTop).
  refs.sourceEditor.style.lineHeight = '20px'
  refs.sourceEditor.style.paddingTop = '8px'

  // jsdom doesn't implement scrollTo either (same gap harness.js already documents for
  // scrollIntoView) -- stub it to actually move scrollTop so a click's effect is observable.
  if (!dom.window.Element.prototype.scrollTo) {
    dom.window.Element.prototype.scrollTo = function (opts) {
      this.scrollTop = typeof opts === 'object' ? opts.top : opts
    }
  }

  const DOMPurify = createDOMPurify(dom.window)
  const markdownController = createMarkdownController({
    getRefs: () => refs,
    markedLib: marked,
    hljsLib: hljsStub,
    pathUtils: {},
    api: {},
    domPurify: DOMPurify,
  })

  let markdown = ''
  const editorController = createEditorController({
    getRefs: () => refs,
    getMarkdown: () => markdown,
    setMarkdown: value => { markdown = value },
    getActiveTab: () => ({ filename: 'a.md', path: '/docs/a.md' }),
    rerenderTabBar: () => {},
    syncTabImageWatches: () => {},
    onSourceInput: () => {},
    render: async () => new Set(),
    closeSearch: () => {},
    storage: createStorageStub(),
    markdownController,
  })

  // openInSourceMode()/applySourceMode() overwrite refs.sourceEditor.value from getMarkdown()
  // (applySourceModeToRefs), so a test must seed *this* -- not the textarea directly -- for
  // its content to actually survive entering source mode.
  const seedMarkdown = value => { markdown = value }

  return { dom, refs, editorController, markdownController, seedMarkdown }
}

const HEADINGS_MD = '# Title\n\nintro\n\n## Section One\n\nbody one\n\n## Section Two\n\nbody two\n'

test('entering pure source mode immediately builds the TOC from source text with distinct, non-stuck offsets', () => {
  const { refs, editorController, markdownController, seedMarkdown } = makeHarness()

  seedMarkdown(HEADINGS_MD)
  editorController.openInSourceMode()

  const links = Array.from(refs.tocList.querySelectorAll('a'))
  assert.deepEqual(links.map(a => a.textContent), ['Title', 'Section One', 'Section Two'])
  assert.deepEqual(links.map(a => a.getAttribute('href')), ['#title', '#section-one', '#section-two'])

  // The actual regression: scrolling to different points must activate different headings,
  // not collapse to "always the last one". Line deltas (20px line-height) guarantee each
  // heading's computed top differs from the others.
  markdownController.refreshTocActive(0)
  const activeAtTop = refs.tocList.querySelector('a.active')?.getAttribute('href')

  markdownController.refreshTocActive(999)
  const activeAtBottom = refs.tocList.querySelector('a.active')?.getAttribute('href')

  assert.equal(activeAtTop, '#title')
  assert.equal(activeAtBottom, '#section-two')
  assert.notEqual(activeAtTop, activeAtBottom, 'scrolling must move the highlight, not stick on one heading')
})

test('clicking a source-mode TOC entry scrolls #scroll-area to that heading instead of doing nothing', () => {
  const { dom, refs, editorController, seedMarkdown } = makeHarness()
  seedMarkdown(HEADINGS_MD)
  editorController.openInSourceMode()

  const secondLink = refs.tocList.querySelectorAll('a')[2] // Section Two
  refs.scrollArea.scrollTop = 0
  secondLink.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))

  assert.notEqual(refs.scrollArea.scrollTop, 0, 'clicking a TOC entry in source mode must scroll #scroll-area')
})

test('typing a new heading in source mode adds it to the TOC after the debounce settles', async () => {
  const { dom, refs, editorController, seedMarkdown } = makeHarness()
  seedMarkdown('# Only Heading\n')
  editorController.openInSourceMode()
  editorController.bindEditorEvents()

  assert.equal(refs.tocList.querySelectorAll('a').length, 1)

  refs.sourceEditor.value = '# Only Heading\n\n## New One\n'
  refs.sourceEditor.dispatchEvent(new dom.window.Event('input', { bubbles: true }))

  await new Promise(resolve => setTimeout(resolve, 200))

  const links = Array.from(refs.tocList.querySelectorAll('a'))
  assert.deepEqual(links.map(a => a.textContent), ['Only Heading', 'New One'])
})

test('wrap mode suppresses the scrollspy highlight but leaves the TOC list and click-to-navigate working', () => {
  const { refs, editorController, markdownController, seedMarkdown } = makeHarness()
  seedMarkdown(HEADINGS_MD)
  editorController.openInSourceMode()

  editorController.toggleWrap() // wrapMode: false -> true
  assert.equal(editorController.getWrapMode(), true)

  // The list itself must still be populated...
  assert.equal(refs.tocList.querySelectorAll('a').length, 3)
  // ...but no scroll position should activate any entry while wrapMode makes the
  // line-height math unreliable (same "hide rather than mislead" precedent as the
  // in-editor current-line highlight).
  markdownController.refreshTocActive(0)
  markdownController.refreshTocActive(999)
  assert.equal(refs.tocList.querySelector('a.active'), null)
})
