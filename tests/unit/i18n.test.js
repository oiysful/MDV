const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')

const { STRINGS, resolveLocale, createTranslator, t, applyStaticTranslations } = require('../../src/renderer/i18n.js')

const SRC = path.join(__dirname, '..', '..', 'src')
const HANGUL = /[ㄱ-ㆎ가-힣]/
const normalize = text => text.replace(/\s+/g, ' ').trim()

test('Korean and English define the same keys, with the same kind of value', () => {
  assert.deepEqual(Object.keys(STRINGS.en).sort(), Object.keys(STRINGS.ko).sort())
  for (const key of Object.keys(STRINGS.ko)) {
    const ko = STRINGS.ko[key]
    const en = STRINGS.en[key]
    assert.equal(typeof en, typeof ko, `${key}: one language is a function, the other is not`)
    if (typeof ko === 'function') assert.equal(en.length, ko.length, `${key}: argument count differs`)
  }
})

test('no English value is left in Korean', () => {
  const sample = ['report.md', 3, '1.5.0', 'some error']
  for (const [key, value] of Object.entries(STRINGS.en)) {
    const text = typeof value === 'function' ? value(...sample) : value
    assert.doesNotMatch(text, HANGUL, `${key}: ${text}`)
  }
})

test('the main process picks Korean only for a Korean locale', () => {
  for (const tag of ['ko', 'ko-KR', 'ko_KR', 'KO-kr']) assert.equal(resolveLocale(tag), 'ko', tag)
  for (const tag of ['en', 'en-US', 'ja', 'zh-Hans', 'kok', '', undefined, null]) assert.equal(resolveLocale(tag), 'en', String(tag))
})

test('translators fill in arguments per language and fall back to Korean for an unknown locale', () => {
  assert.equal(createTranslator('en')('confirm.reloadChanged', 'a.md'), '“a.md” was changed outside MDV. Discard your edits and reload it from disk?')
  assert.equal(createTranslator('ko')('confirm.reloadChanged', 'a.md'), '"a.md"이(가) 외부에서 변경되었습니다. 편집 중인 내용을 버리고 디스크 내용으로 다시 불러오시겠습니까?')
  assert.equal(createTranslator('en')('doc.words', 1), '1 word')
  assert.equal(createTranslator('en')('doc.words', 1200), '1,200 words')
  assert.equal(createTranslator('xx')('action.save'), '저장')
  assert.equal(createTranslator('en')('no.such.key'), 'no.such.key')
})

test('the renderer follows api.locale and is Korean without it', () => {
  const saved = globalThis.api
  try {
    delete globalThis.api
    assert.equal(t('action.save'), '저장')
    globalThis.api = { locale: 'en' }
    assert.equal(t('action.save'), 'Save')
    globalThis.api = { locale: 'fr' }
    assert.equal(t('action.save'), '저장')
  } finally {
    if (saved === undefined) delete globalThis.api
    else globalThis.api = saved
  }
})

function loadIndexHtml() {
  const html = fs.readFileSync(path.join(SRC, 'renderer', 'index.html'), 'utf8')
  return new JSDOM(html).window.document
}

// index.html keeps Korean as written (it is what shows before scripts run, and what the jsdom
// tests read), so a "no Hangul" rule can't apply to it. Instead: every Korean string in the
// markup must be claimed by a data-i18n attribute, so applyStaticTranslations replaces it.
test('every Korean string in index.html is claimed by a data-i18n attribute', () => {
  const doc = loadIndexHtml()
  const unclaimed = []
  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */)
  while (walker.nextNode()) {
    const node = walker.currentNode
    const parent = node.parentElement
    if (!HANGUL.test(node.nodeValue) || parent.closest('script, style')) continue
    if (!parent.closest('[data-i18n-html]') && !parent.hasAttribute('data-i18n')) unclaimed.push(`text in <${parent.tagName.toLowerCase()}>: ${normalize(node.nodeValue)}`)
  }
  for (const el of doc.body.querySelectorAll('*')) {
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      const value = el.getAttribute(attr)
      if (!value || !HANGUL.test(value)) continue
      const claimed = el.hasAttribute(`data-i18n-${attr}`) || ((attr === 'title' || attr === 'aria-label') && el.hasAttribute('data-i18n-label'))
      if (!claimed) unclaimed.push(`${attr} on <${el.tagName.toLowerCase()}>: ${value}`)
    }
  }
  assert.deepEqual(unclaimed, [])
})

// The Korean written in index.html and the Korean in the table must not drift apart: the table
// wins at startup, so a drift would mean the pre-script flash and the jsdom tests see one
// wording and the running app another.
test("index.html's Korean matches the table's Korean for every data-i18n key", () => {
  const doc = loadIndexHtml()
  const scratch = new JSDOM('').window.document.createElement('div')
  const htmlText = html => { scratch.innerHTML = html; return normalize(scratch.textContent) }
  const mismatches = []
  const check = (el, attr, actual, expected) => {
    if (normalize(actual) !== expected) mismatches.push(`${el.getAttribute(attr)} (${attr}): "${normalize(actual)}" vs table "${expected}"`)
  }
  for (const el of doc.querySelectorAll('[data-i18n]')) check(el, 'data-i18n', el.textContent, STRINGS.ko[el.getAttribute('data-i18n')])
  for (const el of doc.querySelectorAll('[data-i18n-html]')) check(el, 'data-i18n-html', el.textContent, htmlText(STRINGS.ko[el.getAttribute('data-i18n-html')]))
  for (const el of doc.querySelectorAll('[data-i18n-label]')) {
    const expected = STRINGS.ko[el.getAttribute('data-i18n-label')]
    check(el, 'data-i18n-label', el.getAttribute('title') ?? '', expected)
    check(el, 'data-i18n-label', el.getAttribute('aria-label') ?? '', expected)
  }
  for (const attr of ['title', 'aria-label', 'placeholder']) {
    for (const el of doc.querySelectorAll(`[data-i18n-${attr}]`)) check(el, `data-i18n-${attr}`, el.getAttribute(attr) ?? '', STRINGS.ko[el.getAttribute(`data-i18n-${attr}`)])
  }
  assert.deepEqual(mismatches, [])
})

test('applyStaticTranslations swaps the static markup into English and sets <html lang>', () => {
  const doc = loadIndexHtml()
  const saved = globalThis.api
  try {
    globalThis.api = { locale: 'en' }
    applyStaticTranslations(doc)
  } finally {
    if (saved === undefined) delete globalThis.api
    else globalThis.api = saved
  }
  assert.equal(doc.documentElement.lang, 'en')
  assert.equal(doc.querySelector('#btn-add').getAttribute('title'), 'Open')
  assert.equal(doc.querySelector('#search-input').getAttribute('placeholder'), 'Search…')
  assert.equal(normalize(doc.querySelector('#empty .empty-title').textContent), 'No file open')
  assert.ok(doc.querySelector('#add-menu [data-command="newFile"] svg'), 'translating the label keeps the icon next to it')
})

// Strips comments and console.* lines -- neither is UI -- and reports any Hangul left in a JS
// source file. i18n.js is the one file allowed to hold Korean.
function hangulLinesIn(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ''))
  return text.split('\n')
    .map((line, index) => ({ line: line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'), number: index + 1 }))
    .filter(({ line }) => HANGUL.test(line) && !/\bconsole\.(error|warn|log)\(/.test(line))
    .map(({ line, number }) => `${path.relative(SRC, file)}:${number}: ${line.trim()}`)
}

test('no Korean UI string is left in JS outside the string table', () => {
  const files = fs.readdirSync(SRC, { recursive: true })
    .filter(name => name.endsWith('.js'))
    .map(name => path.join(SRC, name))
    .filter(file => file !== path.join(SRC, 'renderer', 'i18n.js'))
  assert.ok(files.length > 10, 'the scan found the source files')
  assert.deepEqual(files.flatMap(hangulLinesIn), [])
})

test('a prototype member name is not a key', () => {
  const { has } = require('../../src/renderer/i18n.js')
  for (const key of ['constructor', '__proto__', '__defineGetter__', 'toString', 'hasOwnProperty']) {
    assert.equal(has(key), false, key)
    assert.equal(createTranslator('en')(key), key, key)
  }
  assert.equal(createTranslator('__proto__')('action.save'), '저장')
})

// Every key the code asks for exists, and every key in the table is asked for. A typo at a call
// site would otherwise put the raw key on screen; an unused key is a string nobody maintains.
test('the keys used in src/ and the keys in the table are the same set', () => {
  const used = new Set()
  for (const name of fs.readdirSync(SRC, { recursive: true })) {
    const file = path.join(SRC, name)
    if (file === path.join(SRC, 'renderer', 'i18n.js')) continue
    if (name.endsWith('.js')) {
      const text = fs.readFileSync(file, 'utf8')
      for (const match of text.matchAll(/\bt\(\s*'([^']+)'/g)) used.add(match[1])
      // main.js's role('undo') helper reads role.<name>
      for (const match of text.matchAll(/\brole\(\s*'([^']+)'/g)) used.add(`role.${match[1]}`)
    } else if (name.endsWith('.html')) {
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) used.add(match[1])
    }
  }
  const defined = new Set(Object.keys(STRINGS.ko))
  assert.deepEqual([...used].filter(key => !defined.has(key)).sort(), [], 'used but not defined')
  assert.deepEqual([...defined].filter(key => !used.has(key)).sort(), [], 'defined but never used')
})

// The copy button's tooltip used to be `content: '복사'` in CSS, out of reach of both the table
// and the data-i18n scan. CSS now reads it from an attribute; keep Korean out of <style>.
test('no Korean is left in index.html styles', () => {
  const html = fs.readFileSync(path.join(SRC, 'renderer', 'index.html'), 'utf8')
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1].replace(/\/\*[\s\S]*?\*\//g, ''))
  assert.ok(styles.length > 0)
  assert.deepEqual(styles.flatMap(css => css.split('\n').filter(line => HANGUL.test(line))), [])
})
