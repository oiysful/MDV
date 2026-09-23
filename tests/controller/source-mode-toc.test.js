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

// The line metrics makeHarness() fabricates below (jsdom has no layout engine, see the note
// there). Named rather than inlined because the intermediate-position test derives its probe
// scroll offset from them instead of hardcoding a number that would silently drift out of
// Section One's band if these changed.
const LINE_HEIGHT_PX = 20
const PADDING_TOP_PX = 8

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
  refs.sourceEditor.style.lineHeight = `${LINE_HEIGHT_PX}px`
  refs.sourceEditor.style.paddingTop = `${PADDING_TOP_PX}px`

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

// 0-based source line of each `##` heading in HEADINGS_MD. rebuildSourceModeToc() turns a
// heading's line index into its scroll offset (baseTop + paddingTop + line * lineHeight, and
// baseTop is 0 here because jsdom's getBoundingClientRect() reports an all-zero rect), so these
// two are all the intermediate-position test needs to locate Section One's band. Read off the
// fixture rather than written as literals: editing HEADINGS_MD would otherwise leave the probe
// aimed at a stale offset, which widens the band instead of failing, silently weakening the test.
const sourceLineOf = heading => HEADINGS_MD.split('\n').indexOf(heading)
const SECTION_ONE_LINE = sourceLineOf('## Section One')
const SECTION_TWO_LINE = sourceLineOf('## Section Two')

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

// Closes the gap docs/plans/done/2026-09-23/21-electron-suite-audit.md §6 recorded. A classification lane judged
// tests/electron/links-and-toc.test.js:349 a near-duplicate of this file with "highest
// confidence", and the audit found that judgement wrong: the test above probes only scrollTop 0
// and 999, which a first/last binary passes (collapse every entry but the first onto the last
// heading's offset and both endpoints still answer correctly), so the only assertion actually
// proving continuous line-position tracking lived in the Electron suite -- 570ms of app boot away
// from the layer that can catch it. The audit's 2026-09-23 decision on recommendation 5 keeps the
// Electron test and brings the requirement down here too, so a binary regression fails fast.
test('a scroll position between the two ## headings activates the middle TOC entry, not the first or the last', () => {
  const { refs, editorController, markdownController, seedMarkdown } = makeHarness()

  seedMarkdown(HEADINGS_MD)
  editorController.openInSourceMode()

  // refreshTocActive() hands a heading the highlight once scrollTop reaches that heading's own
  // offset minus a lead-in, which under this harness gives #section-one the range 64..143
  // (measured, not assumed). Probe that range's midpoint: it clears both edges by two full
  // lines, so a lead-in tweak can't flip the result. A boundary-hugging value would have made
  // this a flake vector, and plans 18-20 spent three rounds removing those.
  const ACTIVE_LEAD_IN_PX = 24
  const sectionOneActivatesAt = PADDING_TOP_PX + SECTION_ONE_LINE * LINE_HEIGHT_PX - ACTIVE_LEAD_IN_PX
  const sectionTwoActivatesAt = PADDING_TOP_PX + SECTION_TWO_LINE * LINE_HEIGHT_PX - ACTIVE_LEAD_IN_PX
  const insideSectionOne = (sectionOneActivatesAt + sectionTwoActivatesAt) / 2

  markdownController.refreshTocActive(insideSectionOne)

  assert.equal(
    refs.tocList.querySelector('a.active')?.getAttribute('href'),
    '#section-one',
    `scrollTop ${insideSectionOne} lies between Section One's line and Section Two's, so each heading's `
      + 'own line position must be tracked -- a first/last binary reports #title or #section-two here',
  )
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
