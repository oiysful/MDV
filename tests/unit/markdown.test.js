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
