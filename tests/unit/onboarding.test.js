const test = require('node:test')
const assert = require('node:assert/strict')

const { JSDOM } = require('jsdom')

const { getFocusableElements } = require('../../src/renderer/onboarding.js')

function makeContainer(html) {
  const dom = new JSDOM(`<div id="container">${html}</div>`)
  return dom.window.document.getElementById('container')
}

test('getFocusableElements collects buttons, inputs, and links in document order', () => {
  const container = makeContainer(`
    <div class="guide-title"><strong>Title</strong></div>
    <label><input type="checkbox" id="check"></label>
    <div class="guide-actions">
      <a href="#">link</a>
      <button id="confirm">확인</button>
    </div>
  `)

  const ids = getFocusableElements(container).map(el => el.id || el.tagName)
  assert.deepEqual(ids, ['check', 'A', 'confirm'])
})

test('getFocusableElements skips tabindex="-1" and plain text', () => {
  const container = makeContainer(`
    <span>skip me</span>
    <div tabindex="-1" id="skip">not reachable via Tab</div>
    <div tabindex="0" id="reachable">reachable via Tab</div>
    <button id="only">keep</button>
  `)

  const ids = getFocusableElements(container).map(el => el.id)
  assert.deepEqual(ids, ['reachable', 'only'])
})

test('getFocusableElements returns an empty array for a missing container', () => {
  assert.deepEqual(getFocusableElements(null), [])
})
