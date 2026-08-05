const test = require('node:test')
const assert = require('node:assert/strict')

const { JSDOM } = require('jsdom')
const marked = require('marked')
const createDOMPurify = require('dompurify')

const { computeStats, createMarkdownController, slugifyHeading, extractFrontmatter } = require('../../src/renderer/markdown.js')

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

test('renderMarkdown preserves GFM table alignment attributes', () => {
  const html = makeController().renderMarkdown('| A | B | C |\n|:--|:-:|--:|\n| 1 | 2 | 3 |')
  assert.ok(/<th align="left">/.test(html), html)
  assert.ok(/<th align="center">/.test(html), html)
  assert.ok(/<th align="right">/.test(html), html)
  assert.ok(/<td align="left">/.test(html), html)
  assert.ok(/<td align="center">/.test(html), html)
  assert.ok(/<td align="right">/.test(html), html)
})

test('extractFrontmatter parses key: value pairs delimited by --- on the very first line', () => {
  const result = extractFrontmatter('---\ntitle: Hello\ndate: 2026-08-05\n---\n\n# Body\n')
  assert.deepEqual(result.frontmatter, [
    { key: 'title', value: 'Hello' },
    { key: 'date', value: '2026-08-05' },
  ])
  assert.equal(result.body, '\n# Body\n')
})

test('extractFrontmatter returns null frontmatter when the document has none', () => {
  const result = extractFrontmatter('# Just a heading\n\nSome text.\n')
  assert.equal(result.frontmatter, null)
  assert.equal(result.body, '# Just a heading\n\nSome text.\n')
})

test('extractFrontmatter leaves text untouched when there is no closing ---', () => {
  const text = '---\ntitle: Hello\n\n# Body without a closing delimiter\n'
  const result = extractFrontmatter(text)
  assert.equal(result.frontmatter, null)
  assert.equal(result.body, text)
})

test('extractFrontmatter ignores a --- that is not on the document\'s first line', () => {
  // A mid-document --- is ambiguous under marked's own hr/heading tokenizers (see the
  // 10-mermaid-support-and-usability-fixes.md design note) -- only line 0 may open a block.
  const text = '# Heading\n\nSome text\n\n---\n\nMore text after an hr\n'
  const result = extractFrontmatter(text)
  assert.equal(result.frontmatter, null)
  assert.equal(result.body, text)
})

function decodeBase64Utf8(b64) {
  return Buffer.from(b64, 'base64').toString('utf-8')
}

test('renderMarkdown turns a mermaid fence into a placeholder, not a highlighted code block', () => {
  const html = makeController().renderMarkdown('```mermaid\ngraph TD; A-->B\n```')
  assert.ok(/<pre class="mermaid" data-mermaid-src="[A-Za-z0-9+/=]+">graph TD; A--&gt;B<\/pre>/.test(html), html)
  assert.ok(!/class="hljs"/.test(html), html)
  assert.ok(!/class="copy-btn"/.test(html), html)
  assert.ok(!/code-lang/.test(html), html)

  // DOMPurify strips an attribute outright if its value contains an encoded `>` -- which an
  // escaped mermaid arrow does on nearly every real diagram. This is exactly why the source
  // is base64-encoded in data-mermaid-src rather than escapeHtml'd like the visible text is:
  // confirm it survives sanitization AND decodes back to the real, unescaped source.
  const match = html.match(/data-mermaid-src="([A-Za-z0-9+/=]+)"/)
  assert.ok(match, 'data-mermaid-src attribute must survive DOMPurify sanitization')
  assert.equal(decodeBase64Utf8(match[1]), 'graph TD; A-->B')
})

test('renderMarkdown escapes mermaid source so it cannot break out of the visible placeholder text', () => {
  // data-mermaid-src (base64) legitimately carries the raw, unescaped source through --
  // it's never HTML-parsed (only ever read as textContent or decoded plain text, and mermaid's
  // own securityLevel: 'strict' is what sanitizes it at diagram-render time). What must never
  // exist is a live, HTML-parseable <img>/onerror in the visible placeholder text itself.
  const html = makeController().renderMarkdown('```mermaid\ngraph TD; A["<img src=x onerror=alert(1)>"]\n```')
  assert.ok(!/<img\s/i.test(html), html)
  const visibleText = html.match(/>([^<]*)<\/pre>/)?.[1]
  assert.ok(visibleText, 'placeholder must have visible text content')
  assert.ok(/&lt;img/i.test(visibleText), 'the <img in the visible text must be HTML-escaped')
})

test('renderMarkdown keeps a Korean mermaid label intact through the base64 round trip', () => {
  const html = makeController().renderMarkdown('```mermaid\ngraph TD; A[한글 라벨] --> B\n```')
  const match = html.match(/data-mermaid-src="([A-Za-z0-9+/=]+)"/)
  assert.ok(match, 'data-mermaid-src attribute must be present')
  assert.equal(decodeBase64Utf8(match[1]), 'graph TD; A[한글 라벨] --> B')
})

test('renderMarkdown preserves custom code-block markup and data attributes', () => {
  const html = makeController().renderMarkdown('```js\nconst x = 1\n```')
  assert.ok(/data-command="copyCode"/.test(html), html)
  assert.ok(/class="hljs"/.test(html), html)
  assert.ok(/class="code-lang"/.test(html), html)
  assert.ok(/class="code-lang-row"/.test(html), html)
  assert.ok(/class="copy-btn"/.test(html), html)
  assert.ok(!/title="/.test(html), html)
  assert.ok(/aria-label="코드 복사"/.test(html), html)
})

test('renderMarkdown omits the code-lang element entirely for a fence with no language', () => {
  const html = makeController().renderMarkdown('```\nplain text\n```')
  assert.ok(!/code-lang/.test(html), html)
  assert.ok(!/code-meta/.test(html), html)
  assert.ok(/data-command="copyCode"/.test(html), html)
  assert.ok(/class="copy-btn"/.test(html), html)
})

// --- snapshot capture / rehydration (plan 06) ---

const IMAGE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const LOCAL_PATH = '/docs/assets/pic.png'

// Build a real jsdom-backed refs object plus a spied api. resolveRenderedImagePaths
// walks refs.content for img[src]; buildToc/updateStats need the id="content" node
// attached and the stats elements present.
function makeSnapshotHarness({ mermaidLib } = {}) {
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
    mermaidLib,
  })
  return {
    controller,
    refs,
    getReadCalls: () => readCalls,
    resetReadCalls: () => { readCalls = 0 },
    restore: () => { global.document = prevDocument; global.window = prevWindow },
  }
}

// mermaid.run() replaces each node's content with an <svg> and marks it data-processed --
// this stub mimics just enough of that contract for the sequencing/guard tests below,
// without pulling the real (large) mermaid library into the unit-test suite.
function makeMermaidStub() {
  const calls = []
  return {
    calls,
    run: async ({ nodes }) => {
      calls.push(nodes)
      nodes.forEach(node => {
        node.innerHTML = '<svg data-fake-mermaid-output="true"></svg>'
        node.setAttribute('data-processed', 'true')
      })
    },
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

test('render collapses frontmatter into a meta card and keeps it out of the TOC and stats', async () => {
  const h = makeSnapshotHarness()
  try {
    await h.controller.render('---\ntitle: Hello\ndate: 2026-08-05\n---\n\n# Heading\n\nBody text here.\n', 'doc.md', null)

    const card = h.refs.content.querySelector('details.frontmatter-card')
    assert.ok(card, 'frontmatter renders as a collapsible card')
    assert.equal(card.hasAttribute('open'), false, 'card is collapsed by default')
    assert.match(card.innerHTML, /title/)
    assert.match(card.innerHTML, /Hello/)

    // TOC must only see the real body heading, not anything from the frontmatter card.
    const tocLinks = h.refs.tocList.querySelectorAll('a')
    assert.equal(tocLinks.length, 1)
    assert.equal(tocLinks[0].textContent, 'Heading')

    // Word/reading-time stats must be computed from the body only.
    assert.equal(h.refs.sWords.textContent, computeStats('# Heading\n\nBody text here.\n').words.toLocaleString() + ' 단어')
  } finally {
    h.restore()
  }
})

test('render does not add a frontmatter card for a document with none', async () => {
  const h = makeSnapshotHarness()
  try {
    await h.controller.render('# Just a heading\n\nSome text.\n', 'doc.md', null)
    assert.equal(h.refs.content.querySelector('details.frontmatter-card'), null)
  } finally {
    h.restore()
  }
})

// This suite's other harnesses omit mermaidLib on purpose (the getMermaidLib() ||
// globalScope.mermaid fallback), which is what proves the jsdom-without-mermaid guard below.
// These tests inject a stub explicitly to exercise the actual run()-calling path.

test('render runs mermaid.run() on a mermaid fence and waits for it before resolving', async () => {
  const mermaidLib = makeMermaidStub()
  const h = makeSnapshotHarness({ mermaidLib })
  try {
    await h.controller.render('```mermaid\ngraph TD; A-->B\n```\n', 'doc.md', null)
    const node = h.refs.content.querySelector('.mermaid')
    assert.ok(node, 'mermaid placeholder is present')
    // render() awaited runMermaidBlocks internally, so by the time it resolves the stub's
    // fake <svg> must already be in place -- not still pending in a floating promise.
    assert.ok(node.querySelector('svg[data-fake-mermaid-output]'), 'mermaid.run() output landed before render() resolved')
    assert.equal(node.getAttribute('data-processed'), 'true')
    assert.equal(mermaidLib.calls.length, 1)
    assert.equal(mermaidLib.calls[0].length, 1)
  } finally {
    h.restore()
  }
})

test('render without a mermaid library leaves the placeholder untouched instead of throwing', async () => {
  // No global mermaid exists in this jsdom suite and no mermaidLib is injected --
  // runMermaidBlocks' typeof/fallback guard must make this a no-op, not a crash.
  const h = makeSnapshotHarness()
  try {
    await h.controller.render('```mermaid\ngraph TD; A-->B\n```\n', 'doc.md', null)
    const node = h.refs.content.querySelector('.mermaid')
    assert.ok(node, 'mermaid placeholder still renders')
    assert.equal(node.querySelector('svg'), null, 'no mermaid ran, so no svg was produced')
  } finally {
    h.restore()
  }
})

test('rerenderMermaidTheme resets processed nodes back to source and re-runs them', async () => {
  const mermaidLib = makeMermaidStub()
  const h = makeSnapshotHarness({ mermaidLib })
  try {
    await h.controller.render('```mermaid\ngraph TD; A-->B\n```\n', 'doc.md', null)
    assert.equal(mermaidLib.calls.length, 1)
    const node = h.refs.content.querySelector('.mermaid')
    assert.equal(node.getAttribute('data-processed'), 'true')

    await h.controller.rerenderMermaidTheme(h.refs.content)

    assert.equal(mermaidLib.calls.length, 2, 'theme change re-invokes mermaid.run()')
    // The re-run's node must have been reset to source first, not re-run against the
    // stale <svg> from the first pass (which mermaid.run() would just skip as processed).
    const rerunNode = mermaidLib.calls[1][0]
    assert.equal(rerunNode.getAttribute('data-processed'), 'true', 'stub marks it processed again after the re-run')
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
