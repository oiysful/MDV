const test = require('node:test')
const assert = require('node:assert/strict')

const { launchApp, closeApp, stubCloseDialog, getCloseDialogCalls } = require('./helpers/launch')
const { emitFileOpened, emitRendererCommand } = require('./helpers/smoke-helpers')

const HANGUL = /[ㄱ-ㆎ가-힣]/

// Every piece of app chrome the user can read: text nodes and the title / aria-label /
// placeholder / alt attributes, plus the copy button's CSS tooltip. User content is left out
// (the rendered document, tab names, explorer entries), since a Korean file name is not a
// missed translation -- but the empty state lives inside #content and is chrome, so it stays in. Static index.html keeps its Korean as written and English is applied at
// startup, so this DOM-wide scan -- not a source grep -- is what catches a static string that
// never got a key. Hidden guides and banners are in the DOM too, so they are covered without
// having to be opened.
function collectChrome() {
  const isUserContent = el => (el.closest('#content') && !el.closest('#empty')) || el.closest('.file-tab-name, .tree-name')
  const describe = el => {
    const anchor = el.closest('[id]')
    return `${anchor ? `#${anchor.id} ` : ''}${el.tagName.toLowerCase()}`
  }
  const out = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    const parent = node.parentElement
    if (!parent || parent.closest('script, style') || isUserContent(parent)) continue
    const value = node.nodeValue.replace(/\s+/g, ' ').trim()
    if (value) out.push({ where: describe(parent), kind: 'text', value })
  }
  for (const el of document.querySelectorAll('body *')) {
    if ((el.closest('#content') && !el.closest('#empty')) || el.matches('[role="tab"]')) continue
    for (const attr of ['title', 'aria-label', 'placeholder', 'alt']) {
      if (el.hasAttribute(attr)) out.push({ where: describe(el), kind: attr, value: el.getAttribute(attr) })
    }
  }
  const copyButton = document.querySelector('#content .copy-btn')
  if (copyButton) {
    out.push({ where: '#content .copy-btn', kind: 'aria-label', value: copyButton.getAttribute('aria-label') })
    out.push({ where: '#content .copy-btn', kind: '::after', value: getComputedStyle(copyButton, '::after').content })
  }
  return out
}

async function menuLabels(electronApp) {
  return electronApp.evaluate(({ Menu }) => {
    const labels = []
    const walk = items => {
      for (const item of items) {
        if (item.type === 'separator') continue
        labels.push(item.label)
        if (item.submenu) walk(item.submenu.items)
      }
    }
    walk(Menu.getApplicationMenu().items)
    return labels
  })
}

const koreanIn = entries => entries.filter(entry => HANGUL.test(entry.value))

test('the English locale leaves no Korean in the app chrome or the menu', async () => {
  const { electronApp, page } = await launchApp({ locale: 'en' })

  try {
    await page.waitForSelector('#empty')
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en')
    assert.deepEqual(koreanIn(await page.evaluate(collectChrome)), [], 'empty state')

    // A document brings in the stats line, the copy button and its tooltip; a search with no
    // hits brings in the "no results" counter; source mode swaps the mode button's title.
    await emitFileOpened(electronApp, { content: '---\ntitle: Doc\n---\n# Title\n\nSome words here.\n\n```js\nconst a = 1\n```\n', filename: 'doc.md', path: '/tmp/mdv-i18n-doc.md' })
    await page.waitForSelector('#content .copy-btn')
    await emitRendererCommand(electronApp, 'toggleSearch')
    await page.fill('#search-input', 'zzqqxx')
    await page.waitForFunction(() => document.getElementById('search-count').textContent.trim() !== '')
    assert.deepEqual(koreanIn(await page.evaluate(collectChrome)), [], 'document open, search with no hits')

    await emitRendererCommand(electronApp, 'closeSearch')
    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => document.getElementById('btn-mode').classList.contains('source-active'))
    assert.deepEqual(koreanIn(await page.evaluate(collectChrome)), [], 'source mode')

    const labels = await menuLabels(electronApp)
    assert.deepEqual(labels.filter(label => HANGUL.test(label)), [], 'menu')
    assert.ok(labels.includes('Open File…'), `the File menu is translated: ${labels.join(', ')}`)

    // Chrome that lives inside the rendered document: the front matter card's screen-reader prefix.
    assert.equal(await page.evaluate(() => document.querySelector('#content .frontmatter-content .visually-hidden')?.textContent), 'Metadata: ')

    // The update banner's text is built when an update is announced.
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('update-available', { version: '9.9.9', tagName: 'v9.9.9', releaseUrl: 'https://example.com/r' }))
    await page.waitForFunction(() => document.getElementById('update-banner')?.classList.contains('show'))
    assert.equal(await page.locator('#update-banner-text').textContent(), 'MDV 9.9.9 is available')

    // The tab context menu is built on demand.
    await page.locator('#tab-list .file-tab.active').click({ button: 'right' })
    await page.waitForFunction(() => document.getElementById('app-context-menu')?.style.display === 'block')
    const contextItems = await page.locator('#app-context-menu .ctx-item').allTextContents()
    assert.deepEqual(contextItems.map(item => item.trim()), ['Open in New Window', 'Close Other Tabs', 'Close All Tabs'])
    await page.keyboard.press('Escape')

    // The main process's own native dialog: a dirty window asks before closing.
    await page.locator('#source-editor').fill('# Title\n\nan unsaved edit\n')
    await page.waitForFunction(() => document.querySelector('#tab-list .file-tab.active .file-tab-name')?.textContent.trim().startsWith('●'))
    await stubCloseDialog(electronApp, 1)
    await electronApp.evaluate(async ({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].close()
      await new Promise(resolve => setTimeout(resolve, 300))
    })
    const [closeDialog] = await getCloseDialogCalls(electronApp)
    assert.deepEqual(
      { buttons: closeDialog?.buttons, message: closeDialog?.message, detail: closeDialog?.detail },
      { buttons: ['Close', 'Cancel'], message: 'You have unsaved changes.', detail: 'Close the window without saving your changes?' },
    )
  } finally {
    await closeApp(electronApp)
  }
})

test('the Korean locale is what tests run under unless they ask otherwise', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'ko')
    assert.equal(await page.evaluate(() => window.api.locale), 'ko')
    const labels = await menuLabels(electronApp)
    assert.ok(labels.includes('파일 열기…'))
    // role items carry explicit Korean labels instead of Electron's English defaults (plan 31).
    assert.ok(labels.includes('실행 취소'), `role items are translated: ${labels.join(', ')}`)
  } finally {
    await closeApp(electronApp)
  }
})
