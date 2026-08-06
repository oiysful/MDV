const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { ROOT, launchApp, closeApp, stubCloseDialog, getCloseDialogCalls } = require('./helpers/launch')
const {
  BASIC_MD, ROOT_MD, EXPLORER_DIR,
  stubOpenDialog, stubSaveDialog, createTempMarkdown,
  emitFileOpened, emitRendererCommand, clickApplicationMenuItem,
  stubOpenExternal, getOpenExternalCalls,
} = require('./helpers/smoke-helpers')

const MERMAID_MD = path.join(ROOT, 'tests/fixtures/mermaid.md')

const REMOVED_GLOBALS = [
  'openFile',
  'openFolder',
  'saveFile',
  'saveFileAs',
  'toggleSidebar',
  'toggleSource',
  'toggleSplitView',
  'toggleSearch',
  'copyAll',
  'printDoc',
  'exportPdf',
  'toggleTheme',
  'newFile',
  'toggleAddMenu',
  'hideAddMenu',
  'dismissWelcomeGuide',
  'dismissDefaultAppGuide',
  'openFromGuide',
  'searchPrev',
  'searchNext',
  'closeSearch',
  'closeCurrentTab',
  'switchToNextTab',
  'switchToPrevTab',
  'showShortcuts',
  'hideShortcuts',
  'switchTab',
  'toggleExplorerPathInfo',
  'clearExplorerRoot',
  'goTop',
  'copyCode',
  'onDragOver',
  'onDragLeave',
  'onDrop',
]

async function waitForFile(filePath, timeoutMs = 5000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const stat = await fs.stat(filePath)
      if (stat.size > 0) return stat
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for file: ${filePath}`)
}

test('app boots into empty state without renderer command globals', async () => {
  // This test asserts the default-app-guide's real content and dismiss-persistence
  // behavior below, so it needs the genuine OS check rather than launchApp's default
  // deterministic stub (see helpers/launch.js).
  const { electronApp, page } = await launchApp({ realDefaultAppStatus: true })
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(String(error)))

  try {
    await page.waitForSelector('#empty')
    assert.equal(await page.title(), 'MDV')

    const emptyTitle = await page.textContent('#empty .empty-title')
    assert.match(emptyTitle, /열린 파일 없음/)
    assert.match(await page.textContent('#empty .empty-sub'), /좌측 상단의 열기 버튼/)

    const globals = await page.evaluate(names => {
      return Object.fromEntries(names.map(name => {
        return [name, typeof window[name] === 'function']
      }))
    }, REMOVED_GLOBALS)

    for (const name of REMOVED_GLOBALS) {
      assert.equal(globals[name], false, `${name} should not be exposed on window`)
    }

    assert.equal(await page.locator('[onclick], [ondragover], [ondragleave], [ondrop], [data-action]').count(), 0)

    const labelledControls = await page.evaluate(() => {
      const selectors = ['#btn-add', '#btn-sidebar', '#btn-split', '#btn-search', '#btn-copy-all', '#btn-print', '#btn-export-pdf', '#btn-theme', '#go-top']
      return Object.fromEntries(selectors.map(selector => {
        const el = document.querySelector(selector)
        return [selector, Boolean(el?.getAttribute('title') && el?.getAttribute('aria-label'))]
      }))
    })
    assert.deepEqual(labelledControls, {
      '#btn-add': true,
      '#btn-sidebar': true,
      '#btn-split': true,
      '#btn-search': true,
      '#btn-copy-all': true,
      '#btn-print': true,
      '#btn-export-pdf': true,
      '#btn-theme': true,
      '#go-top': true,
    })

    assert.equal(await page.locator('#btn-split').evaluate(button => getComputedStyle(button).display), 'none')

    const depsReady = await page.evaluate(() => ({
      marked: Boolean(window.marked),
      hljs: Boolean(window.hljs),
    }))

    assert.equal(depsReady.marked, true)
    assert.equal(depsReady.hljs, true)
    await page.waitForFunction(() => document.getElementById('default-app-guide')?.classList.contains('show'))
    await page.evaluate(() => {
      localStorage.setItem('mdv-default-app-guide-dismissed', '1')
      localStorage.setItem('mdv-default-app-guide-dismissed-v2', '1')
    })
    await page.reload()
    await page.waitForFunction(() => document.documentElement.dataset.rendererReady === 'true')
    await page.waitForFunction(() => document.getElementById('default-app-guide')?.classList.contains('show'))
    await page.evaluate(() => {
      localStorage.removeItem('mdv-default-app-guide-dismissed-v2')
    })
    await page.reload()
    await page.waitForFunction(() => document.documentElement.dataset.rendererReady === 'true')
    await page.waitForFunction(() => document.getElementById('default-app-guide')?.classList.contains('show'))
    const defaultAppGuide = await page.evaluate(() => ({
      title: document.querySelector('#default-app-guide .guide-title strong')?.textContent || '',
      body: document.querySelector('#default-app-guide .guide-body')?.textContent.replace(/\s+/g, ' ').trim() || '',
      checkboxLabel: document.querySelector('#default-app-guide .guide-check')?.textContent.trim() || '',
      confirmCommand: document.querySelector('#default-app-guide .guide-actions button')?.textContent.trim() || '',
      codeTexts: Array.from(document.querySelectorAll('#default-app-guide .guide-body code')).map(code => code.textContent.trim()),
      actionCount: document.querySelectorAll('#default-app-guide .guide-actions button').length,
      closeButtonCount: document.querySelectorAll('#default-app-guide .guide-close').length,
      checkboxRightAligned: (() => {
        const guide = document.getElementById('default-app-guide')
        const check = document.querySelector('#default-app-guide .guide-check')
        if (!guide || !check) return false
        const guideRect = guide.getBoundingClientRect()
        const checkRect = check.getBoundingClientRect()
        return Math.abs(guideRect.right - 20 - checkRect.right) < 2
      })(),
      confirmFullWidth: (() => {
        const actions = document.querySelector('#default-app-guide .guide-actions')
        const button = document.querySelector('#default-app-guide .guide-actions button')
        if (!actions || !button) return false
        return Math.abs(actions.getBoundingClientRect().width - button.getBoundingClientRect().width) < 2
      })(),
      centered: (() => {
        const rect = document.getElementById('default-app-guide').getBoundingClientRect()
        return Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2) < 2 && Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2) < 2
      })(),
    }))
    assert.equal(defaultAppGuide.title, 'Markdown 기본 앱 등록')
    assert.match(defaultAppGuide.body, /마크다운 문서\(\.md, \.markdown 확장자\)를 편리하게 보기 위해서 아래의 단계를 진행해주세요\./)
    assert.match(defaultAppGuide.body, /Finder에서 마크다운 문서\(\.md, \.markdown\) 우클릭/)
    assert.match(defaultAppGuide.body, /정보 가져오기/)
    assert.match(defaultAppGuide.body, /다음으로 열기 드롭다운 > MDV 선택/)
    assert.match(defaultAppGuide.body, /모두 변경\.\.\. 버튼 클릭/)
    assert.equal(defaultAppGuide.checkboxLabel, '다시 보지 않기')
    assert.equal(defaultAppGuide.confirmCommand, '확인했습니다.')
    assert.deepEqual(defaultAppGuide.codeTexts, ['.md', '.markdown', '.md', '.markdown', '모두 변경...'])
    assert.equal(defaultAppGuide.actionCount, 1)
    assert.equal(defaultAppGuide.closeButtonCount, 0)
    assert.equal(defaultAppGuide.checkboxRightAligned, true)
    assert.equal(defaultAppGuide.confirmFullWidth, true)
    assert.equal(defaultAppGuide.centered, true)

    await page.check('#default-app-do-not-show')
    await page.click('#default-app-guide .guide-actions button')
    await page.waitForFunction(() => !document.getElementById('default-app-guide')?.classList.contains('show'))
    const storedDismissal = await page.evaluate(() => JSON.parse(localStorage.getItem('mdv-default-app-guide-dismissed-v2')))
    assert.equal(typeof storedDismissal.signature, 'string')
    assert.match(storedDismissal.signature, /::/)
    await page.reload()
    await page.waitForFunction(() => document.documentElement.dataset.rendererReady === 'true')
    await page.waitForTimeout(400)
    assert.equal(await page.locator('#default-app-guide').evaluate(guide => guide.classList.contains('show')), false)

    await page.evaluate(() => {
      localStorage.setItem('mdv-default-app-guide-dismissed-v2', JSON.stringify({ signature: '/Applications/Old-MDV.app::.md:/Applications/TextEdit.app|.markdown:/Applications/TextEdit.app' }))
    })
    await page.reload()
    await page.waitForFunction(() => document.documentElement.dataset.rendererReady === 'true')
    await page.waitForFunction(() => document.getElementById('default-app-guide')?.classList.contains('show'))
    assert.deepEqual(pageErrors, [])
  } finally {
    await closeApp(electronApp)
  }
})

test('openFile loads markdown, updates title, and renders code highlighting', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await clickApplicationMenuItem(electronApp, '파일', '파일 열기…')

    await page.waitForFunction(() => document.title === 'basic')
    assert.equal(await page.title(), 'basic')

    const heading = await page.textContent('#content h1')
    assert.match(heading, /Smoke Fixture/)

    const tabText = await page.textContent('#tab-list .file-tab.active .file-tab-name')
    assert.match(tabText, /basic\.md/)

    const codeBlockCount = await page.locator('#content code.hljs').count()
    assert.ok(codeBlockCount > 0)

    const copyButton = page.locator('#content .copy-btn').first()
    assert.equal(await copyButton.getAttribute('onclick'), null)
    assert.equal(await copyButton.getAttribute('data-command'), 'copyCode')
    assert.equal(await copyButton.getAttribute('aria-label'), '코드 복사')

    // The copy button is an absolute-positioned overlay pinned to the wrapper's top-right
    // corner (Claude desktop-style): it must sit inside the wrapper's bounds and stay
    // clickable regardless of how the code beneath it scrolls.
    const codeWrapper = page.locator('#content .code-wrapper').first()
    const wrapperBox = await codeWrapper.boundingBox()
    const btnBox = await copyButton.boundingBox()
    assert.ok(wrapperBox && btnBox, 'expected bounding boxes for wrapper and copy button')
    assert.ok(
      btnBox.x >= wrapperBox.x && btnBox.x + btnBox.width <= wrapperBox.x + wrapperBox.width &&
      btnBox.y >= wrapperBox.y && btnBox.y + btnBox.height <= wrapperBox.y + wrapperBox.height,
      `copy button not inside wrapper bounds: ${JSON.stringify({ wrapperBox, btnBox })}`
    )
    assert.equal(await copyButton.evaluate(el => getComputedStyle(el).pointerEvents), 'auto')

    const langLabel = page.locator('#content .code-lang').first()
    assert.equal(await langLabel.textContent(), 'js')

    // Hovering the button alone (not just the wrapper) reveals the custom "복사" tooltip,
    // and no native title tooltip fights it since the title attribute was dropped.
    await copyButton.hover()
    await page.waitForFunction(() => {
      const btn = document.querySelector('#content .copy-btn')
      return btn && getComputedStyle(btn, '::after').opacity === '1'
    })
    assert.equal(await copyButton.evaluate(el => getComputedStyle(el, '::after').content), '"복사"')

    await copyButton.click()
    await page.waitForFunction(() => document.querySelector('#content .copy-btn')?.classList.contains('copied'))
    await page.waitForFunction(() => document.getElementById('toast')?.textContent === '코드 복사됨' && document.getElementById('toast')?.classList.contains('show'))
    const copiedIconHtml = await copyButton.evaluate(el => el.innerHTML)
    assert.match(copiedIconHtml, /icon-check/)
    // Tooltip hides once the button flips to its "copied" state so it doesn't read stale.
    // The opacity is CSS-transitioned (.1s), so poll for it to actually settle rather than
    // asserting immediately after the class flip -- getComputedStyle can still report the
    // pre-transition value until the next paint.
    await page.waitForFunction(() => {
      const btn = document.querySelector('#content .copy-btn')
      return btn && getComputedStyle(btn, '::after').opacity === '0'
    })

    await page.click('#btn-copy-all')
    await page.waitForFunction(() => document.getElementById('toast')?.textContent === '복사됨' && document.getElementById('toast')?.classList.contains('show'))
  } finally {
    await closeApp(electronApp)
  }
})

test('mermaid fence renders an actual diagram, redraws on a theme toggle, and reuses its snapshot on tab switch', async () => {
  const { electronApp, page } = await launchApp()
  const consoleErrors = []
  page.on('pageerror', err => consoleErrors.push(String(err)))

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [MERMAID_MD])
    await clickApplicationMenuItem(electronApp, '파일', '파일 열기…')
    await page.waitForFunction(() => document.title === 'mermaid')

    await page.waitForFunction(() => !!document.querySelector('#content .mermaid svg'), { timeout: 8000 })
    const mermaidNode = page.locator('#content .mermaid')
    assert.equal(await mermaidNode.getAttribute('data-processed'), 'true')
    assert.ok(await mermaidNode.getAttribute('data-mermaid-src'), 'raw source is preserved for a future theme re-render')

    // mermaid mints a fresh random id per render (never assert its exact value) -- only
    // whether it changed. Two clicks from the default 'auto' state deterministically land on
    // 'dark' (mirrors the toggleTheme test above: 1st click -> light, 2nd -> dark).
    const svgIdInitial = await page.evaluate(() => document.querySelector('#content .mermaid svg').id)
    await page.evaluate(() => document.querySelector('[data-command="toggleTheme"]').click())
    await page.evaluate(() => document.querySelector('[data-command="toggleTheme"]').click())
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark')
    await page.waitForFunction(
      prevId => document.querySelector('#content .mermaid svg')?.id !== prevId,
      svgIdInitial,
      { timeout: 5000 }
    )
    const svgIdAfterThemeToggle = await page.evaluate(() => document.querySelector('#content .mermaid svg').id)
    assert.notEqual(svgIdAfterThemeToggle, svgIdInitial, 'theme toggle must redraw the diagram, not just leave the old SVG in place')

    // Switching away and back must reuse the cached snapshot rather than re-running mermaid.
    await stubOpenDialog(electronApp, [BASIC_MD])
    await clickApplicationMenuItem(electronApp, '파일', '파일 열기…')
    await page.waitForFunction(() => document.title === 'basic')
    await page.evaluate(() => {
      const tab = Array.from(document.querySelectorAll('.file-tab')).find(t => t.textContent.includes('mermaid.md'))
      tab.click()
    })
    await page.waitForFunction(() => document.title === 'mermaid')
    const svgIdAfterTabSwitch = await page.evaluate(() => document.querySelector('#content .mermaid svg')?.id)
    assert.equal(svgIdAfterTabSwitch, svgIdAfterThemeToggle, 'a plain tab switch must reuse the snapshot, not re-run mermaid')

    assert.deepEqual(consoleErrors, [], 'mermaid must not raise CSP violations or runtime errors')
  } finally {
    await closeApp(electronApp)
  }
})

test('code fence with no language renders without a reserved header row', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')

    const html = await page.evaluate(() => {
      const ctrl = window.MDVMarkdown.createMarkdownController({
        getRefs: () => ({}),
        markedLib: window.marked,
        hljsLib: window.hljs,
        pathUtils: window.MDVPathUtils,
        api: window.api,
      })
      return ctrl.renderMarkdown('```\nplain text\n```')
    })
    assert.ok(!/code-lang/.test(html), html)
    assert.ok(!/code-meta/.test(html), html)
    assert.ok(/data-command="copyCode"/.test(html), html)
    assert.ok(/class="copy-btn"/.test(html), html)

    await page.evaluate(htmlStr => {
      const probe = document.createElement('div')
      probe.id = 'code-fence-probe'
      probe.innerHTML = htmlStr
      document.body.appendChild(probe)
    }, html)

    // With no language label to show, the wrapper must not reserve any extra vertical space
    // for a header bar: its height should match the <pre> alone, plus .code-wrapper's own
    // top+bottom 1px border (index.html's `.code-wrapper { border: 1px solid ... }`) -- that
    // border is a fixed decorative frame around the whole block, not reserved header space.
    const heights = await page.locator('#code-fence-probe .code-wrapper').first().evaluate(el => ({
      wrapper: el.getBoundingClientRect().height,
      pre: el.querySelector('pre').getBoundingClientRect().height,
      borderTop: parseFloat(getComputedStyle(el).borderTopWidth),
      borderBottom: parseFloat(getComputedStyle(el).borderBottomWidth),
    }))
    const expectedWrapperHeight = heights.pre + heights.borderTop + heights.borderBottom
    assert.ok(Math.abs(heights.wrapper - expectedWrapperHeight) < 1, JSON.stringify(heights))
  } finally {
    await closeApp(electronApp)
  }
})

test('long code lines scroll under the copy button and it stays clickable', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')

    const longLine = 'x'.repeat(400)
    const html = await page.evaluate(longLine => {
      const ctrl = window.MDVMarkdown.createMarkdownController({
        getRefs: () => ({}),
        markedLib: window.marked,
        hljsLib: window.hljs,
        pathUtils: window.MDVPathUtils,
        api: window.api,
      })
      return ctrl.renderMarkdown('```js\nconst longLine = "' + longLine + '"\n```')
    }, longLine)

    // Must land inside #content (not document.body, unlike the no-language probe above) so
    // #content pre code's overflow-x:auto actually gets a real scrollbar to exercise.
    await page.evaluate(htmlStr => {
      const content = document.getElementById('content')
      content.classList.remove('is-empty')
      content.innerHTML = htmlStr
    }, html)

    const wrapper = page.locator('#content .code-wrapper').first()
    const copyButton = wrapper.locator('.copy-btn')

    await wrapper.locator('pre code').evaluate(el => { el.scrollLeft = el.scrollWidth })

    // The overlay copy button is deliberately allowed to sit on top of scrolled code (this
    // reverts plan 09's overlap-proof gutter in favor of matching Claude desktop's look) --
    // what must still hold is that it stays positioned and clickable.
    assert.equal(await copyButton.evaluate(el => getComputedStyle(el).position), 'absolute')
    const btnBox = await copyButton.boundingBox()
    const wrapperBox = await wrapper.boundingBox()
    assert.ok(
      btnBox.x + btnBox.width <= wrapperBox.x + wrapperBox.width + 1,
      `copy button drifted outside wrapper after scroll: ${JSON.stringify({ wrapperBox, btnBox })}`
    )
  } finally {
    await closeApp(electronApp)
  }
})

test('PDF export button sits right of print and saves a PDF', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-'))
  const pdfPath = path.join(tempDir, 'basic.pdf')
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await stubSaveDialog(electronApp, pdfPath)
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    const toolbarState = await page.evaluate(() => {
      const print = document.getElementById('btn-print')
      const exportPdf = document.getElementById('btn-export-pdf')
      return {
        printEnabled: Boolean(print && !print.disabled),
        exportEnabled: Boolean(exportPdf && !exportPdf.disabled),
        exportRightOfPrint: Boolean(print && exportPdf && (print.compareDocumentPosition(exportPdf) & Node.DOCUMENT_POSITION_FOLLOWING)),
        command: exportPdf?.dataset.command || '',
        title: exportPdf?.getAttribute('title') || '',
        ariaLabel: exportPdf?.getAttribute('aria-label') || '',
      }
    })
    assert.deepEqual(toolbarState, {
      printEnabled: true,
      exportEnabled: true,
      exportRightOfPrint: true,
      command: 'exportPdf',
      title: 'PDF 내보내기',
      ariaLabel: 'PDF 내보내기',
    })

    await page.click('#btn-export-pdf')
    await waitForFile(pdfPath)
    await page.waitForFunction(() => document.getElementById('toast')?.textContent === 'PDF 저장됨' && document.getElementById('toast')?.classList.contains('show'))

    const pdf = await fs.readFile(pdfPath)
    assert.equal(pdf.subarray(0, 4).toString('utf8'), '%PDF')
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})
