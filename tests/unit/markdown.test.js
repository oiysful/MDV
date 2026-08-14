const test = require('node:test')
const assert = require('node:assert/strict')

const { JSDOM } = require('jsdom')
const marked = require('marked')
const createDOMPurify = require('dompurify')
const katex = require('katex')

const { computeStats, createMarkdownController, slugifyHeading, extractFrontmatter, extractHeadingsFromSource } = require('../../src/renderer/markdown.js')

const DOMPurify = createDOMPurify(new JSDOM('').window)

// Minimal highlight.js stand-in: sanitization, not highlighting, is under test.
const hljsStub = {
  getLanguage: lang => (['javascript', 'python', 'json', 'bash'].includes(lang) ? {} : undefined),
  highlight: (code, { language }) => ({ value: `<span class="hljs-keyword">${language}</span>` }),
  highlightAuto: () => ({ value: '<span class="hljs-string">auto</span>' }),
}

function makeController({ katexLib } = {}) {
  return createMarkdownController({
    getRefs: () => ({}),
    markedLib: marked,
    hljsLib: hljsStub,
    katexLib,
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
  assert.equal(result.frontmatter[0].key, 'title')
  assert.equal(result.frontmatter[0].value, 'Hello')
  assert.equal(result.frontmatter[1].key, 'date')
  assert.ok(result.frontmatter[1].value instanceof Date, 'unquoted ISO dates parse as Date')
  assert.equal(result.frontmatter[1].value.toISOString().slice(0, 10), '2026-08-05')
  assert.equal(result.body, '\n# Body\n')
})

test('extractFrontmatter parses an inline flow array', () => {
  const result = extractFrontmatter('---\ntags: [a, b, c]\n---\nBody\n')
  assert.deepEqual(result.frontmatter, [{ key: 'tags', value: ['a', 'b', 'c'] }])
})

test('extractFrontmatter parses a block-style array', () => {
  const result = extractFrontmatter('---\ntags:\n  - a\n  - b\n---\nBody\n')
  assert.deepEqual(result.frontmatter, [{ key: 'tags', value: ['a', 'b'] }])
})

test('extractFrontmatter parses an array of objects', () => {
  const text = '---\nitems:\n  - name: x\n    value: y\n  - name: z\n    value: w\n---\nBody\n'
  const result = extractFrontmatter(text)
  assert.deepEqual(result.frontmatter, [
    { key: 'items', value: [{ name: 'x', value: 'y' }, { name: 'z', value: 'w' }] },
  ])
})

test('extractFrontmatter parses a nested object', () => {
  const text = '---\nauthor:\n  name: Jane\n  email: jane@x.com\n---\nBody\n'
  const result = extractFrontmatter(text)
  assert.deepEqual(result.frontmatter, [
    { key: 'author', value: { name: 'Jane', email: 'jane@x.com' } },
  ])
})

test('extractFrontmatter preserves newlines from a literal block scalar', () => {
  const text = '---\nnote: |\n  line1\n  line2\n---\nBody\n'
  const result = extractFrontmatter(text)
  assert.equal(result.frontmatter[0].value, 'line1\nline2\n')
})

test('extractFrontmatter folds newlines into spaces from a folded block scalar', () => {
  const text = '---\nnote: >\n  line1\n  line2\n---\nBody\n'
  const result = extractFrontmatter(text)
  assert.equal(result.frontmatter[0].value, 'line1 line2\n')
})

test('extractFrontmatter parses numbers, booleans, and null with real types', () => {
  const text = '---\ncount: 5\npublished: true\ndeleted:\n---\nBody\n'
  const result = extractFrontmatter(text)
  assert.deepEqual(result.frontmatter, [
    { key: 'count', value: 5 },
    { key: 'published', value: true },
    { key: 'deleted', value: null },
  ])
})

test('extractFrontmatter falls back to no-frontmatter on malformed YAML', () => {
  const text = '---\ntitle: "unterminated\n---\n# Body\n'
  const result = extractFrontmatter(text)
  assert.equal(result.frontmatter, null)
  assert.equal(result.body, text)
})

test('extractFrontmatter falls back to no-frontmatter when the top level is not a mapping', () => {
  const text = '---\n- a\n- b\n---\n# Body\n'
  const result = extractFrontmatter(text)
  assert.equal(result.frontmatter, null)
  assert.equal(result.body, text)
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

// --- extractHeadingsFromSource (pure-source-mode TOC tracking) ---

test('extractHeadingsFromSource finds ATX headings and their correct line numbers', () => {
  const text = 'intro line\n\n# One\n\nbody\n\n## Two\n\nmore body\ntwo lines\n\n### Three\n'
  const headings = extractHeadingsFromSource(text, marked)
  assert.deepEqual(headings.map(h => ({ depth: h.depth, text: h.text, line: h.line })), [
    { depth: 1, text: 'One', line: 2 },
    { depth: 2, text: 'Two', line: 6 },
    { depth: 3, text: 'Three', line: 11 },
  ])
})

test('extractHeadingsFromSource ignores a "#" inside a fenced code block', () => {
  const text = '# Real Heading\n\n```bash\n# not a heading, just a shell comment\necho hi\n```\n\n## Also Real\n'
  const headings = extractHeadingsFromSource(text, marked)
  assert.deepEqual(headings.map(h => h.text), ['Real Heading', 'Also Real'])
})

test('extractHeadingsFromSource strips inline markup from the heading label', () => {
  const text = '## **Bold** and `code` heading\n'
  const headings = extractHeadingsFromSource(text, marked)
  assert.equal(headings[0].text, 'Bold and code heading')
})

test('extractHeadingsFromSource excludes h4 and deeper', () => {
  const text = '# One\n\n#### Four\n\n###### Six\n\n## Two\n'
  const headings = extractHeadingsFromSource(text, marked)
  assert.deepEqual(headings.map(h => h.text), ['One', 'Two'])
})

test('extractHeadingsFromSource does not find a heading nested inside a blockquote (documented limitation)', () => {
  // marked.lexer() only returns top-level block tokens; a heading nested inside a
  // blockquote is buried in that token's own .tokens and invisible to the flat scan here,
  // unlike the rendered preview's `#content h1,h2,h3` selector, which does catch it. This
  // test pins that known, accepted divergence rather than leaving it silently undiscovered.
  const text = '> ## Quoted Heading\n\n## Real Heading\n'
  const headings = extractHeadingsFromSource(text, marked)
  assert.deepEqual(headings.map(h => h.text), ['Real Heading'])
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

// --- latex/math fences ---

const katexStub = {
  renderToString: (tex, opts) => `<span class="katex-stub" data-display="${opts.displayMode}">${tex}</span>`,
}

test('renderMarkdown turns a latex fence into a katex-rendered block when a katex lib is present', () => {
  const html = makeController({ katexLib: katexStub }).renderMarkdown('```latex\nx^2\n```')
  assert.ok(/<div class="mdv-latex"><span class="katex-stub" data-display="true">x\^2<\/span><\/div>/.test(html), html)
  assert.ok(!/class="hljs"/.test(html), html)
  assert.ok(!/class="copy-btn"/.test(html), html)
})

test('renderMarkdown aliases a math fence to the same katex path as latex', () => {
  const html = makeController({ katexLib: katexStub }).renderMarkdown('```math\n\\frac{1}{2}\n```')
  assert.ok(/class="mdv-latex"/.test(html), html)
  assert.ok(/katex-stub/.test(html), html)
})

test('renderMarkdown falls back to a normal code block when no katex lib is injected', () => {
  const html = makeController().renderMarkdown('```latex\nx^2\n```')
  assert.ok(!/class="mdv-latex"/.test(html), html)
  assert.ok(/class="hljs"/.test(html), html)
  assert.ok(/class="copy-btn"/.test(html), html)
})

test('renderMarkdown renders real KaTeX output through DOMPurify without losing the visible MathML', () => {
  const html = makeController({ katexLib: katex }).renderMarkdown('```latex\n\\frac{1}{2}\n```')
  assert.ok(/class="mdv-latex"/.test(html), html)
  assert.ok(/class="katex-html"/.test(html), html)
  assert.ok(/<mfrac>/.test(html), html)
})

test('renderMarkdown renders malformed LaTeX as an inline error span instead of throwing', () => {
  assert.doesNotThrow(() => {
    const html = makeController({ katexLib: katex }).renderMarkdown('```latex\n\\frac{1\n```')
    assert.ok(/katex-error/.test(html), html)
  })
})

// --- GitHub-style alert blockquotes (plan 11) ---

test('renderMarkdown renders each alert type with its class and label', () => {
  for (const type of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
    const html = makeController().renderMarkdown(`> [!${type}]\n> body text`)
    assert.ok(new RegExp(`class="markdown-alert markdown-alert-${type.toLowerCase()}"`).test(html), html)
    assert.ok(new RegExp(`class="markdown-alert-title">.*${type[0]}${type.slice(1).toLowerCase()}`).test(html), html)
    assert.ok(/body text/.test(html), html)
    assert.ok(!/<blockquote>/.test(html), html)
  }
})

test('renderMarkdown recognizes a lowercase alert marker', () => {
  const html = makeController().renderMarkdown('> [!note]\n> body text')
  assert.ok(/class="markdown-alert markdown-alert-note"/.test(html), html)
})

test('renderMarkdown renders a blank-line-separated alert body across multiple paragraphs', () => {
  const html = makeController().renderMarkdown('> [!WARNING]\n>\n> first\n> second')
  assert.ok(/class="markdown-alert markdown-alert-warning"/.test(html), html)
  assert.ok(/<p>first<br>second<\/p>/.test(html), html)
  // The marker paragraph itself must not survive as a second copy of "[!WARNING]" in the body.
  assert.ok(!/\[!WARNING\]/.test(html), html)
})

test('renderMarkdown leaves a plain blockquote untouched', () => {
  const html = makeController().renderMarkdown('> just a quote')
  assert.ok(/<blockquote>/.test(html), html)
  assert.ok(!/markdown-alert/.test(html), html)
})

test('renderMarkdown does not treat a marker followed by same-line text as an alert', () => {
  const html = makeController().renderMarkdown('> [!NOTE] extra text on the same line')
  assert.ok(/<blockquote>/.test(html), html)
  assert.ok(!/markdown-alert/.test(html), html)
})

test('renderMarkdown sanitizes script content inside an alert body', () => {
  const html = makeController().renderMarkdown('> [!NOTE]\n> <script>alert(1)</script>safe text')
  assert.ok(/class="markdown-alert markdown-alert-note"/.test(html), html)
  assert.ok(!/<script/i.test(html), html)
  assert.ok(/safe text/.test(html), html)
})

// --- snapshot capture / rehydration (plan 06) ---

const IMAGE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const LOCAL_PATH = '/docs/assets/pic.png'

// Build a real jsdom-backed refs object plus a spied api. resolveRenderedImagePaths
// walks refs.content for img[src]; buildToc/updateStats need the id="content" node
// attached and the stats elements present.
function makeSnapshotHarness({ mermaidLib, simulateScriptLoad = 'fail', onMermaidLoaded } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="scroll-area"><div id="content"></div></div><ul id="toc"></ul><div id="stats"></div><span id="sw"></span><span id="st"></span></body>')
  const prevDocument = global.document
  const prevWindow = global.window
  global.document = dom.window.document
  global.window = dom.window
  // jsdom never fires load/error for an externally-sourced <script> (no resource loading by
  // default -- confirmed empirically, not just per its docs), so ensureMermaidLoaded/
  // ensureKatexLoaded's dynamic <script> path would hang this suite forever on any render()
  // call with a mermaid/latex fence and no lib injected. Simulate a load instead of letting it
  // hang: 'fail' (the default -- matches what a real broken/missing bundle path would do) or
  // 'succeed', which also defines window.mermaid/window.katex right before onload fires, same
  // as what actually executing the real bundle would do. Tests that want the lib available
  // without exercising this dynamic-load path at all still just inject mermaidLib directly.
  const appendedScriptSrcs = []
  const globalsToClean = []
  const originalAppendChild = dom.window.document.head.appendChild.bind(dom.window.document.head)
  dom.window.document.head.appendChild = node => {
    const result = originalAppendChild(node)
    if (node.tagName === 'SCRIPT' && node.src) {
      appendedScriptSrcs.push(node.src)
      setTimeout(() => {
        if (simulateScriptLoad === 'succeed') {
          // getMermaidLib/getKatexLib read `globalScope`, which markdown.js closes over once
          // at require() time (this test file's process, before any test runs) -- not
          // `dom.window`, which is per-harness and never what that closure actually sees.
          // globalThis is the real target here; clean it up so a later test in this same
          // process/file doesn't inherit it.
          if (node.src.includes('mermaid')) { globalThis.mermaid = mermaidLib || makeMermaidStub(); globalsToClean.push('mermaid') }
          if (node.src.includes('katex')) { globalThis.katex = { renderToString: tex => `<span class="katex-stub">${tex}</span>` }; globalsToClean.push('katex') }
          node.onload?.()
        } else {
          node.onerror?.(new Error('jsdom does not load external scripts'))
        }
      }, 0)
    }
    return result
  }
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
    onMermaidLoaded,
  })
  return {
    controller,
    refs,
    getReadCalls: () => readCalls,
    resetReadCalls: () => { readCalls = 0 },
    getAppendedScriptSrcs: () => appendedScriptSrcs,
    restore: () => {
      global.document = prevDocument
      global.window = prevWindow
      for (const key of globalsToClean) delete globalThis[key]
    },
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

test('render shows a simple array field as a list', async () => {
  const h = makeSnapshotHarness()
  try {
    await h.controller.render('---\ntags: [a, b, c]\n---\n\nBody\n', 'doc.md', null)
    const list = h.refs.content.querySelector('details.frontmatter-card ul.frontmatter-list')
    assert.ok(list, 'array value renders as a list')
    assert.deepEqual(Array.from(list.querySelectorAll('li')).map(li => li.textContent), ['a', 'b', 'c'])
  } finally {
    h.restore()
  }
})

test('render shows an array of objects and a nested object as nested tables', async () => {
  const h = makeSnapshotHarness()
  try {
    const text = '---\nitems:\n  - name: x\n    value: y\nauthor:\n  name: Jane\n---\n\nBody\n'
    await h.controller.render(text, 'doc.md', null)
    const card = h.refs.content.querySelector('details.frontmatter-card')
    const nestedTables = card.querySelectorAll('table.frontmatter-nested')
    assert.equal(nestedTables.length, 2, 'one nested table for the object-array item, one for author')
    assert.match(card.innerHTML, /name/)
    assert.match(card.innerHTML, /Jane/)
  } finally {
    h.restore()
  }
})

test('render preserves newlines from a literal block scalar in a multiline div', async () => {
  const h = makeSnapshotHarness()
  try {
    await h.controller.render('---\nnote: |\n  line1\n  line2\n---\n\nBody\n', 'doc.md', null)
    const multiline = h.refs.content.querySelector('details.frontmatter-card div.frontmatter-multiline')
    assert.ok(multiline, 'multiline value renders in a preserved-whitespace div')
    assert.equal(multiline.textContent, 'line1\nline2\n')
  } finally {
    h.restore()
  }
})

test('render escapes malicious strings nested inside frontmatter arrays/objects', async () => {
  const h = makeSnapshotHarness()
  try {
    const text = '---\nitems:\n  - name: "<script>window.__pwned = true</script>"\n---\n\nBody\n'
    await h.controller.render(text, 'doc.md', null)
    assert.equal(h.refs.content.querySelector('details.frontmatter-card script'), null)
    assert.match(h.refs.content.querySelector('details.frontmatter-card').innerHTML, /&lt;script&gt;/)
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

// --- lazy mermaid/katex loading (plan 12-C-1) ---

test('render never attempts a dynamic script load for a document with no mermaid/latex fence', async () => {
  const h = makeSnapshotHarness()
  try {
    await h.controller.render('# Just a heading\n\nSome text, no fences at all.\n', 'doc.md', null)
    assert.deepEqual(h.getAppendedScriptSrcs(), [])
  } finally {
    h.restore()
  }
})

test('render dynamically loads mermaid only for a document that actually has a mermaid fence', async () => {
  const h = makeSnapshotHarness()
  try {
    await h.controller.render('```mermaid\ngraph TD; A-->B\n```\n', 'doc.md', null)
    const srcs = h.getAppendedScriptSrcs()
    assert.equal(srcs.length, 1)
    assert.match(srcs[0], /mermaid\.min\.js$/)
  } finally {
    h.restore()
  }
})

test('render dynamically loads katex only for a document that actually has a latex/math fence', async () => {
  const h = makeSnapshotHarness()
  try {
    await h.controller.render('```latex\nx^2\n```\n', 'doc.md', null)
    const srcs = h.getAppendedScriptSrcs()
    assert.equal(srcs.length, 1)
    assert.match(srcs[0], /katex\.min\.js$/)
  } finally {
    h.restore()
  }
})

test('render runs a mermaid diagram through a successfully lazy-loaded library and fires onMermaidLoaded', async () => {
  let onMermaidLoadedCalls = 0
  const h = makeSnapshotHarness({ simulateScriptLoad: 'succeed', onMermaidLoaded: () => { onMermaidLoadedCalls += 1 } })
  try {
    await h.controller.render('```mermaid\ngraph TD; A-->B\n```\n', 'doc.md', null)
    const node = h.refs.content.querySelector('.mermaid')
    assert.ok(node.querySelector('svg[data-fake-mermaid-output]'), 'the dynamically-loaded mermaid stub actually ran')
    assert.equal(onMermaidLoadedCalls, 1)
  } finally {
    h.restore()
  }
})

test('render reuses an in-flight/loaded script instead of appending a second one for a later document', async () => {
  const h = makeSnapshotHarness({ simulateScriptLoad: 'succeed' })
  try {
    await h.controller.render('```mermaid\ngraph TD; A-->B\n```\n', 'doc.md', null)
    await h.controller.render('```mermaid\ngraph LR; C-->D\n```\n', 'doc2.md', null)
    assert.equal(h.getAppendedScriptSrcs().length, 1, 'mermaid.min.js should only be appended once across both renders')
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
