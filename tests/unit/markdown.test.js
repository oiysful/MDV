const test = require('node:test')
const assert = require('node:assert/strict')

const { JSDOM } = require('jsdom')
const marked = require('marked')
const createDOMPurify = require('dompurify')

const { computeStats, createMarkdownController } = require('../../src/renderer/markdown.js')

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
  const dom = new JSDOM('<!DOCTYPE html><body><div id="content"></div><ul id="toc"></ul><div id="stats"></div><span id="sw"></span><span id="st"></span></body>')
  const prevDocument = global.document
  const prevWindow = global.window
  global.document = dom.window.document
  global.window = dom.window
  const refs = {
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
      return JSON.stringify({ ok: true, data_url: IMAGE_DATA_URL })
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
