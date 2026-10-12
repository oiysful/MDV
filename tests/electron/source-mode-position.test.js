const test = require('node:test')
const assert = require('node:assert/strict')

const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { launchApp, closeApp } = require('./helpers/launch')
const { stubOpenDialog, emitRendererCommand } = require('./helpers/smoke-helpers')

// Plan 28 step 3: entering source mode (Cmd+U) used to land at the very end of the document
// with the caret there too, wherever the reader was (assigning textarea.value parks the caret
// at the end, and the deferred focus() scrolled to it). The reading position now carries over
// through heading anchors, and the caret goes on the TOC-active heading's line, or the top
// visible line when that heading is off screen.
//
// The document is built so a whole-document ratio would visibly miss: an intro before the
// first heading, then sections 5-10 each carry one very long source line that wraps into many
// preview lines (preview much taller than source there), so the two panes' height ratios
// differ section by section.
const INTRO = Array.from({ length: 60 }, (_, i) => `Intro line ${i + 1}.`).join('\n\n')
const SECTIONS = Array.from({ length: 30 }, (_, i) => {
  const n = i + 1
  const body = n >= 5 && n <= 10
    ? `${'Long wrapped prose that is a single source line. '.repeat(120)}`
    : Array.from({ length: 4 }, (_, j) => `Line ${j + 1} of section ${n}.`).join('\n\n')
  return `## Section ${n}\n\n${body}`
}).join('\n\n')
const DOC = `${INTRO}\n\n${SECTIONS}\n`

async function openDoc(electronApp, page) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-position-'))
  const docPath = path.join(tempDir, 'position.md')
  await fs.writeFile(docPath, DOC, 'utf-8')
  const cleanup = () => fs.rm(tempDir, { recursive: true, force: true })
  await page.waitForSelector('#empty')
  await stubOpenDialog(electronApp, [docPath])
  await emitRendererCommand(electronApp, 'openFile')
  await page.waitForFunction(() => document.title === 'position')
  return cleanup
}

async function enterSource(page, electronApp) {
  await emitRendererCommand(electronApp, 'toggleSource')
  await page.waitForFunction(() => document.getElementById('scroll-area').classList.contains('source-mode'))
  // The editor focus still arrives one frame late (AGENTS.md NOTES, #61) -- measure after it.
  await page.waitForFunction(() => document.activeElement?.id === 'source-editor')
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
}

async function leaveSource(page, electronApp) {
  await emitRendererCommand(electronApp, 'toggleSource')
  await page.waitForFunction(() => !document.getElementById('scroll-area').classList.contains('source-mode'))
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
}

// Scroll the preview so the given heading sits at the top of #scroll-area.
function scrollPreviewToHeading(page, text) {
  return page.evaluate(t => {
    const sa = document.getElementById('scroll-area')
    const h = [...document.querySelectorAll('#content h1,#content h2,#content h3')].find(el => el.textContent === t)
    sa.scrollTop = h.offsetTop - sa.offsetTop
    return sa.scrollTop
  }, text)
}

// Source-mode geometry, measured the same way the app does (editor.js computeSourceModeGeometry).
function sourceState(page) {
  return page.evaluate(() => {
    const sa = document.getElementById('scroll-area')
    const ed = document.getElementById('source-editor')
    const cs = getComputedStyle(ed)
    const lineHeight = parseFloat(cs.lineHeight)
    const baseTop = ed.getBoundingClientRect().top - sa.getBoundingClientRect().top + sa.scrollTop + parseFloat(cs.paddingTop)
    const lines = ed.value.split('\n')
    const topLine = Math.max(0, Math.ceil((sa.scrollTop - baseTop) / lineHeight))
    const bottomLine = Math.floor((sa.scrollTop + sa.clientHeight - baseTop) / lineHeight) - 1
    const caretLine = ed.value.slice(0, ed.selectionStart).split('\n').length - 1
    const lineOf = text => lines.indexOf(text)
    const lineEnd = i => lines.slice(0, i + 1).join('\n').length
    const lineStart = i => (i === 0 ? 0 : lines.slice(0, i).join('\n').length + 1)
    return {
      scrollTop: sa.scrollTop,
      maxScroll: sa.scrollHeight - sa.clientHeight,
      topLine,
      bottomLine,
      caret: ed.selectionStart,
      caretLine,
      len: ed.value.length,
      totalLines: lines.length,
      headingLine: Object.fromEntries([12, 25].map(n => [n, lineOf(`## Section ${n}`)])),
      headingLineEnd: Object.fromEntries([12, 25].map(n => [n, lineEnd(lineOf(`## Section ${n}`))])),
      topLineStart: lineStart(Math.max(0, Math.ceil((sa.scrollTop - baseTop) / lineHeight))),
    }
  })
}

test('entering source mode keeps the reading position and puts the caret on the visible TOC heading', async () => {
  const { electronApp, page } = await launchApp()
  let cleanup
  try {
    cleanup = await openDoc(electronApp, page)
    await scrollPreviewToHeading(page, 'Section 12')
    await enterSource(page, electronApp)
    const s = await sourceState(page)
    assert.ok(s.scrollTop < s.maxScroll - 1, `entered at the very end (scrollTop ${s.scrollTop} of ${s.maxScroll})`)
    assert.ok(Math.abs(s.topLine - s.headingLine[12]) <= 2, `top line ${s.topLine}, '## Section 12' is line ${s.headingLine[12]}`)
    assert.equal(s.caret, s.headingLineEnd[12], 'caret at the end of the TOC-active heading line')

    // Typing must not move the view -- the caret is already on screen.
    const before = s.scrollTop
    await page.keyboard.type('x')
    const after = await page.evaluate(() => document.getElementById('scroll-area').scrollTop)
    assert.ok(Math.abs(after - before) < 1, `typing scrolled the view from ${before} to ${after}`)
  } finally {
    await closeApp(electronApp)
    await cleanup?.()
  }
})

test('entering source mode past an asymmetric stretch still lands on the same heading (anchors, not one ratio)', async () => {
  const { electronApp, page } = await launchApp()
  let cleanup
  try {
    cleanup = await openDoc(electronApp, page)
    const previewTop = await scrollPreviewToHeading(page, 'Section 25')
    const previewMax = await page.evaluate(() => { const sa = document.getElementById('scroll-area'); return sa.scrollHeight - sa.clientHeight })
    await enterSource(page, electronApp)
    const s = await sourceState(page)
    assert.ok(Math.abs(s.topLine - s.headingLine[25]) <= 2, `top line ${s.topLine}, '## Section 25' is line ${s.headingLine[25]}`)
    // Guard the test's own discriminating power: a whole-document ratio must miss by a lot here.
    const ratioLine = Math.round((previewTop / previewMax) * s.totalLines)
    assert.ok(Math.abs(ratioLine - s.headingLine[25]) > 10, `fixture not asymmetric enough: ratio would land on line ${ratioLine}`)
  } finally {
    await closeApp(electronApp)
    await cleanup?.()
  }
})

test('entering source mode from the top stays at the top, and mid-section puts the caret on the top visible line', async () => {
  const { electronApp, page } = await launchApp()
  let cleanup
  try {
    cleanup = await openDoc(electronApp, page)
    await enterSource(page, electronApp)
    let s = await sourceState(page)
    assert.ok(s.scrollTop < 1, `entered at ${s.scrollTop}, not the top`)
    assert.equal(s.caret, 0, 'no TOC heading is active in the intro -> caret at the top visible line')
    await leaveSource(page, electronApp)

    // Halfway into the intro: no heading above the viewport, so the caret goes to the top visible line.
    await page.evaluate(() => {
      const sa = document.getElementById('scroll-area')
      const first = document.querySelector('#content h2')
      sa.scrollTop = (first.offsetTop - sa.offsetTop) / 2
    })
    await enterSource(page, electronApp)
    s = await sourceState(page)
    assert.ok(s.scrollTop > 1, 'stayed mid-intro rather than jumping to the top')
    assert.ok(s.caretLine >= s.topLine && s.caretLine <= s.bottomLine, `caret line ${s.caretLine} outside the visible ${s.topLine}-${s.bottomLine}`)
    assert.equal(s.caret, s.topLineStart, 'caret at the start of the top visible line')
    const before = s.scrollTop
    await page.keyboard.type('x')
    const after = await page.evaluate(() => document.getElementById('scroll-area').scrollTop)
    assert.ok(Math.abs(after - before) < 1, `typing scrolled the view from ${before} to ${after}`)
  } finally {
    await closeApp(electronApp)
    await cleanup?.()
  }
})

test('leaving source mode keeps the reading position in the preview', async () => {
  const { electronApp, page } = await launchApp()
  let cleanup
  try {
    cleanup = await openDoc(electronApp, page)
    await enterSource(page, electronApp)
    // Put '## Section 25' (past the asymmetric stretch) at the top of the source view.
    await page.evaluate(() => {
      const sa = document.getElementById('scroll-area')
      const ed = document.getElementById('source-editor')
      const cs = getComputedStyle(ed)
      const baseTop = ed.getBoundingClientRect().top - sa.getBoundingClientRect().top + sa.scrollTop + parseFloat(cs.paddingTop)
      sa.scrollTop = baseTop + ed.value.split('\n').indexOf('## Section 25') * parseFloat(cs.lineHeight)
    })
    await leaveSource(page, electronApp)
    const topHeading = await page.evaluate(() => {
      const sa = document.getElementById('scroll-area')
      const hs = [...document.querySelectorAll('#content h2')]
      let current = null
      for (const h of hs) if (h.offsetTop - sa.offsetTop <= sa.scrollTop + 4) current = h.textContent
      return current
    })
    assert.ok(['Section 24', 'Section 25'].includes(topHeading), `preview top heading is ${topHeading}`)
  } finally {
    await closeApp(electronApp)
    await cleanup?.()
  }
})

// Advisor review of plan 28 step 3: two document classes the first fixture never exercised.
// Frontmatter used to lex as hr + paragraph + setext `---`, giving the source side a bogus h2
// so the heading lists never paired. And a tall image right above a heading: render() awaits
// the data URL assignment, not image decode, so the preview offsets read on exit could be
// short by the image's height.
const TALL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="900"><rect width="400" height="900" fill="#ccc"/></svg>'
const FM_DOC = `---\ntitle: Position\ntags: [a, b]\n---\n\n${DOC.replace('## Section 25', '![tall](tall.svg)\n\n## Section 25')}`

async function openFrontmatterImageDoc(electronApp, page) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-position-fm-'))
  const docPath = path.join(tempDir, 'position-fm.md')
  await fs.writeFile(docPath, FM_DOC, 'utf-8')
  await fs.writeFile(path.join(tempDir, 'tall.svg'), TALL_SVG, 'utf-8')
  await page.waitForSelector('#empty')
  await stubOpenDialog(electronApp, [docPath])
  await emitRendererCommand(electronApp, 'openFile')
  await page.waitForFunction(() => document.title === 'position-fm')
  await page.waitForFunction(() => document.querySelector('#content img')?.complete && document.querySelector('#content img').naturalHeight > 0)
  return () => fs.rm(tempDir, { recursive: true, force: true })
}

test('frontmatter and a tall image above a heading: Cmd+U still pairs headings both ways', async () => {
  const { electronApp, page } = await launchApp()
  let cleanup
  try {
    cleanup = await openFrontmatterImageDoc(electronApp, page)
    // No bogus "title: …" entry in the source-mode TOC either.
    await scrollPreviewToHeading(page, 'Section 12')
    await enterSource(page, electronApp)
    const tocTexts = await page.evaluate(() => [...document.querySelectorAll('#toc-list a')].map(a => a.textContent))
    assert.equal(tocTexts[0], 'Section 1', `source-mode TOC starts with ${JSON.stringify(tocTexts[0])}`)
    const s = await sourceState(page)
    assert.ok(Math.abs(s.topLine - s.headingLine[12]) <= 2, `top line ${s.topLine}, '## Section 12' is line ${s.headingLine[12]}`)
    assert.equal(s.caret, s.headingLineEnd[12], 'caret at the end of the TOC-active heading line')

    // Exit with '## Section 25' at the top: the 900px image sits right above it in the preview.
    await page.evaluate(() => {
      const sa = document.getElementById('scroll-area')
      const ed = document.getElementById('source-editor')
      const cs = getComputedStyle(ed)
      const baseTop = ed.getBoundingClientRect().top - sa.getBoundingClientRect().top + sa.scrollTop + parseFloat(cs.paddingTop)
      sa.scrollTop = baseTop + ed.value.split('\n').indexOf('## Section 25') * parseFloat(cs.lineHeight)
    })
    await leaveSource(page, electronApp)
    const result = await page.evaluate(() => {
      const sa = document.getElementById('scroll-area')
      const h = [...document.querySelectorAll('#content h2')].find(el => el.textContent === 'Section 25')
      return { headingTop: h.offsetTop - sa.offsetTop, scrollTop: sa.scrollTop, clientHeight: sa.clientHeight }
    })
    // The heading must be at (or just below) the top of the view, not pushed off by the image.
    const offset = result.headingTop - result.scrollTop
    assert.ok(offset >= -4 && offset < result.clientHeight / 4, `'Section 25' is ${offset}px from the top of the view`)
  } finally {
    await closeApp(electronApp)
    await cleanup?.()
  }
})
