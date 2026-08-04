const test = require('node:test')
const assert = require('node:assert/strict')

const { JSDOM } = require('jsdom')
const marked = require('marked')
const createDOMPurify = require('dompurify')

const { computeStats, createMarkdownController, slugifyHeading } = require('../../src/renderer/markdown.js')

const DOMPurify = createDOMPurify(new JSDOM('').window)

// Minimal highlight.js stand-in: sanitization, not highlighting, is under test.
const hljsStub = {
  getLanguage: lang => (['javascript', 'python', 'json', 'bash'].includes(lang) ? {} : undefined),
  highlight: (code, { language }) => ({ value: `<span class="hljs-keyword">${language}</span>` }),
  highlightAuto: () => ({ value: '<span class="hljs-string">auto</span>' }),
}

function makeController() {
  return createMarkdownController({
    getRefs: () => ({}),
    markedLib: marked,
    hljsLib: hljsStub,
    pathUtils: {},
    api: {},
    domPurify: DOMPurify,
  })
}

test('computeStats returns zeroed values for empty text', () => {
  assert.deepEqual(computeStats('   '), { words: 0, minutes: 0 })
})

test('computeStats returns word count and rounded reading time', () => {
  const text = Array.from({ length: 420 }, (_, i) => `word${i}`).join(' ')
  assert.deepEqual(computeStats(text), { words: 420, minutes: 2 })
})

test('renderMarkdown strips raw <script> tags', () => {
  const html = makeController().renderMarkdown('<script>alert(1)</script>\n\nhello')
  assert.ok(!/<script/i.test(html), html)
  assert.ok(/hello/.test(html))
})

test('renderMarkdown strips onerror handlers from images', () => {
  const html = makeController().renderMarkdown('<img src="x" onerror="alert(1)">')
  assert.ok(!/onerror/i.test(html), html)
})

test('renderMarkdown neutralizes XSS in a code fence info string', () => {
  const html = makeController().renderMarkdown('```<script>alert(1)</script>\ncode\n```')
  assert.ok(!/<script/i.test(html), html)
})

test('renderMarkdown preserves task-list checkboxes', () => {
  const html = makeController().renderMarkdown('- [x] done\n- [ ] todo')
  assert.ok(/<input[^>]*type="checkbox"/i.test(html), html)
  assert.ok(/checked/i.test(html), html)
  assert.ok(/disabled/i.test(html), html)
})

test('renderMarkdown preserves custom code-block markup and data attributes', () => {
  const html = makeController().renderMarkdown('```js\nconst x = 1\n```')
  assert.ok(/data-command="copyCode"/.test(html), html)
  assert.ok(/class="hljs"/.test(html), html)
  assert.ok(/class="code-lang"/.test(html), html)
})

// --- snapshot capture / rehydration (plan 06) ---

const IMAGE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const LOCAL_PATH = '/docs/assets/pic.png'

// Build a real jsdom-backed refs object plus a spied api. resolveRenderedImagePaths
// walks refs.content for img[src]; buildToc/updateStats need the id="content" node
// attached and the stats elements present.
function makeSnapshotHarness() {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="scroll-area"><div id="content"></div></div><ul id="toc"></ul><div id="stats"></div><span id="sw"></span><span id="st"></span></body>')
  const prevDocument = global.document
  const prevWindow = global.window
  global.document = dom.window.document
  global.window = dom.window
  const refs = {
    scrollArea: dom.window.document.getElementById('scroll-area'),
    content: dom.window.document.getElementById('content'),
    tocList: dom.window.document.getElementById('toc'),
    stats: dom.window.document.getElementById('stats'),
    sWords: dom.window.document.getElementById('sw'),
    sTime: dom.window.document.getElementById('st'),
  }
  let readCalls = 0
  const api = {
    readImageDataUrl: async localPath => {
      readCalls += 1
      return { ok: true, data_url: IMAGE_DATA_URL }
    },
  }
  const controller = createMarkdownController({
    getRefs: () => refs,
    markedLib: marked,
    hljsLib: hljsStub,
    pathUtils: {
      resolveLocalImageCandidates: (src, docPath) => (docPath ? [LOCAL_PATH] : []),
    },
    api,
    domPurify: DOMPurify,
  })
  return {
    controller,
    refs,
    getReadCalls: () => readCalls,
    resetReadCalls: () => { readCalls = 0 },
    restore: () => { global.document = prevDocument; global.window = prevWindow },
  }
}

const flushMacrotask = () => new Promise(resolve => setTimeout(resolve, 0))

test('captureSnapshotHTML strips base64 payloads but keeps the local-path marker', async () => {
  const h = makeSnapshotHarness()
  try {
    await h.controller.render('# Doc\n\n![pic](pic.png)\n', 'doc.md', '/docs/doc.md')
    const liveHtml = h.refs.content.innerHTML
    assert.ok(liveHtml.includes('base64,'), 'live DOM should have base64 src before capture')

    const snapshot = h.controller.captureSnapshotHTML()
    assert.ok(!snapshot.includes('base64,'), snapshot)
    assert.ok(!snapshot.includes(IMAGE_DATA_URL), 'snapshot must not contain the data URL')
    assert.ok(snapshot.includes('data-mdv-local-path'), 'snapshot keeps the local-path marker')
    assert.ok(snapshot.length < liveHtml.length, `snapshot (${snapshot.length}) should be shorter than live (${liveHtml.length})`)
  } finally {
    h.restore()
  }
})

test('hydrateFromDom refills img src synchronously from a warm cache without IPC', async () => {
  const h = makeSnapshotHarness()
  try {
    await h.controller.render('# Doc\n\n![pic](pic.png)\n', 'doc.md', '/docs/doc.md')
    const snapshot = h.controller.captureSnapshotHTML()
    h.resetReadCalls()

    h.controller.hydrateFromDom(snapshot, '', 'body text')

    const img = h.refs.content.querySelector('img')
    assert.equal(img.getAttribute('src'), IMAGE_DATA_URL)
    assert.equal(h.getReadCalls(), 0, 'warm cache must not hit the IPC mock')
  } finally {
    h.restore()
  }
})

test('hydrateFromDom falls back to async IPC on a cold cache and converges', async () => {
  const h = makeSnapshotHarness()
  try {
    await h.controller.render('# Doc\n\n![pic](pic.png)\n', 'doc.md', '/docs/doc.md')
    const snapshot = h.controller.captureSnapshotHTML()
    h.controller.clearImageCacheEntry(LOCAL_PATH)
    h.resetReadCalls()

    h.controller.hydrateFromDom(snapshot, '', 'body text')

    // Synchronously the image has no src yet (cache miss); the fallback is async.
    assert.equal(h.refs.content.querySelector('img').getAttribute('src'), null)

    await flushMacrotask()

    assert.equal(h.getReadCalls(), 1, 'cold cache must hit the IPC mock exactly once')
    assert.equal(h.refs.content.querySelector('img').getAttribute('src'), IMAGE_DATA_URL)
  } finally {
    h.restore()
  }
})

// buildToc used to assign positional ids (`h0`, `h1`, ...), so a hand-written
// `[텍스트](#헤더-슬러그)` anchor -- the convention this repo's own docs use -- pointed at
// an element that never existed and the jump silently did nothing. slugifyHeading is the
// GFM-compatible id source that makes those links resolve.
test('slugifyHeading lowercases and hyphenates plain ASCII heading text', () => {
  assert.equal(slugifyHeading('Getting Started'), 'getting-started')
  assert.equal(slugifyHeading('API Reference'), 'api-reference')
})

test('slugifyHeading keeps non-ASCII (Korean) characters intact', () => {
  assert.equal(slugifyHeading('구현 요약 2026-07-20'), '구현-요약-2026-07-20')
  assert.equal(slugifyHeading('한글 제목'), '한글-제목')
})

test('slugifyHeading drops punctuation but keeps hyphens and underscores', () => {
  assert.equal(slugifyHeading('Hello, World!'), 'hello-world')
  assert.equal(slugifyHeading('What is MDV? (v1.1)'), 'what-is-mdv-v11')
  assert.equal(slugifyHeading('snake_case and kebab-case'), 'snake_case-and-kebab-case')
})

test('slugifyHeading collapses whitespace runs and trims surrounding space', () => {
  assert.equal(slugifyHeading('   Spaced    Out   '), 'spaced-out')
  assert.equal(slugifyHeading('Tabs\tand\nnewlines'), 'tabs-and-newlines')
})

test('slugifyHeading trims leading and trailing hyphens left by stripped punctuation', () => {
  assert.equal(slugifyHeading('...Leading'), 'leading')
  assert.equal(slugifyHeading('Trailing...'), 'trailing')
  assert.equal(slugifyHeading('-- Both --'), 'both')
})

test('slugifyHeading returns an empty slug for text with nothing sluggable', () => {
  // buildToc turns this into its positional `h${index}` fallback rather than an id of ''.
  assert.equal(slugifyHeading('???'), '')
  assert.equal(slugifyHeading('   '), '')
})

test('slugifyHeading suffixes duplicate slugs -1, -2 like GitHub does', () => {
  const seen = new Map()
  assert.equal(slugifyHeading('Notes', seen), 'notes')
  assert.equal(slugifyHeading('Notes', seen), 'notes-1')
  assert.equal(slugifyHeading('Notes', seen), 'notes-2')
  // Punctuation differences that slugify identically collide too, as on GitHub.
  assert.equal(slugifyHeading('notes!', seen), 'notes-3')
  // An unrelated heading is unaffected by the counter.
  assert.equal(slugifyHeading('Other', seen), 'other')
})

test('slugifyHeading without a seen map does not deduplicate', () => {
  assert.equal(slugifyHeading('Notes'), 'notes')
  assert.equal(slugifyHeading('Notes'), 'notes')
})

test('buildToc gives every heading its slug id and a matching TOC href', async () => {
  const h = makeSnapshotHarness()
  try {
    await h.controller.render('# Hello, World!\n\n## 한글 제목\n\n## Notes\n\n## Notes\n', 'doc.md', null)
    const ids = Array.from(h.refs.content.querySelectorAll('h1,h2,h3')).map(el => el.id)
    assert.deepEqual(ids, ['hello-world', '한글-제목', 'notes', 'notes-1'])
    const hrefs = Array.from(h.refs.tocList.querySelectorAll('a')).map(a => a.getAttribute('href'))
    assert.deepEqual(hrefs, ids.map(id => `#${id}`))
  } finally {
    h.restore()
  }
})
