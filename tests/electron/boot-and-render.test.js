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
  armToastWatch, waitForToast,
} = require('./helpers/smoke-helpers')

const MERMAID_MD = path.join(ROOT, 'tests/fixtures/mermaid.md')
const LATEX_MD = path.join(ROOT, 'tests/fixtures/latex.md')

// app-runtime.js's copyCode restores the button after this long, so `.copied` -- and
// everything CSS hangs off it -- is a window, not a state. Kept as a named constant
// because armCopyResetGate matches on the delay; see the assert in the copy test, which
// fails loudly if the two ever drift apart.
const COPY_RESET_DELAY_MS = 1500

// Holds copyCode's restore timer instead of racing it. Measured 2026-09-21: `.copied` goes
// on at 22ms and off at 1524ms, so a wait that starts after the window closed never sees the
// class and sits out its full 15s timeout -- while the toast recording still shows the copy
// itself succeeded. That is the same defect plan 18 fixed for #toast's 1.6s `show` window,
// and it made this test the fourth CI flake (docs/plans/20-...). Widening the window would
// only move the failure rate, so the test opens it instead and closes it on purpose, the
// gate move plan 19 used for the default-app guide. Releasing it also lets the test assert
// the restore, which it could not check at all while the timer ran on its own.
async function armCopyResetGate(page) {
  await page.evaluate((delay) => {
    const realSetTimeout = window.setTimeout
    window.__heldCopyResets = []
    window.setTimeout = function (fn, ms, ...rest) {
      if (ms === delay) {
        window.__heldCopyResets.push(fn)
        return -1
      }
      return realSetTimeout.call(window, fn, ms, ...rest)
    }
    // Restores the real timer before firing what was held, so anything scheduled from
    // inside a released callback behaves normally and later copies are ungated.
    window.__releaseCopyResetGate = () => {
      window.setTimeout = realSetTimeout
      window.__heldCopyResets.splice(0).forEach(fn => fn())
    }
  }, COPY_RESET_DELAY_MS)
}

async function heldCopyResetCount(page) {
  return page.evaluate(() => window.__heldCopyResets?.length ?? null)
}

async function releaseCopyResetGate(page) {
  await page.evaluate(() => window.__releaseCopyResetGate())
}

// The tooltip's opacity is CSS-transitioned (.1s), so it has to be polled rather than read
// straight after a class flip. On a timeout, report the opacity actually observed instead of
// a bare TimeoutError -- the same reason waitForToast asserts in Node rather than in the
// wait. This matters most for the opacity==='1' hover wait, the one wait in the copy test
// the gate does not cover: if it is ever the one that hangs, it now says so itself.
async function waitForTooltipOpacity(page, expected) {
  try {
    await page.waitForFunction(
      want => {
        const btn = document.querySelector('#content .copy-btn')
        return Boolean(btn) && getComputedStyle(btn, '::after').opacity === want
      },
      expected,
      { timeout: 5000 },
    )
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error
  }
  const actual = await page.evaluate(() => {
    const btn = document.querySelector('#content .copy-btn')
    return btn ? getComputedStyle(btn, '::after').opacity : null
  })
  assert.equal(actual, expected, `copy button tooltip opacity never reached ${expected}`)
}

// 2026-09-17 audit M2: JetBrains Mono used to come from fonts.googleapis.com /
// fonts.gstatic.com, so opening a local document contacted a third party. csp.test.js pins
// the markup and the CSP; this pins the behaviour those are supposed to produce -- that a
// real boot issues no remote request at all, and that the font genuinely resolves from the
// bundle rather than silently falling back to SF Mono with nobody noticing.
test('booting the app makes no remote request, and the bundled code font resolves', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')

    // launchApp returns an already-loaded page, so the initial requests are gone. Reload with
    // a listener attached to observe a genuine boot.
    const requested = []
    page.on('request', request => requested.push(request.url()))
    await page.reload()
    await page.waitForFunction(() => document.documentElement.dataset.rendererReady === 'true')

    const remote = requested.filter(url => /^https?:/i.test(url))
    assert.deepEqual(remote, [], `boot must not reach any remote origin:\n${remote.join('\n')}`)
    assert.ok(
      requested.some(url => url.includes('fonts/jetbrains-mono.css')),
      'the bundled font stylesheet should have been requested locally'
    )

    // Render a document with a code block so the mono face is actually exercised, then let
    // the font engine settle before asking whether it resolved.
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    const font = await page.evaluate(async () => {
      await document.fonts.ready
      return {
        available: document.fonts.check('400 13px "JetBrains Mono"'),
        loaded: [...document.fonts].filter(f => f.family === 'JetBrains Mono' && f.status === 'loaded').length,
      }
    })
    assert.equal(font.available, true, 'JetBrains Mono must resolve from the bundled woff2')
    assert.ok(font.loaded > 0, `expected at least one loaded JetBrains Mono face, got ${font.loaded}`)
  } finally {
    await closeApp(electronApp)
  }
})

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
    await waitForTooltipOpacity(page, '1')
    assert.equal(await copyButton.evaluate(el => getComputedStyle(el, '::after').content), '"복사"')

    // Everything below about the copied look lives inside copyCode's restore window, so hold
    // that window open first -- see armCopyResetGate.
    await armCopyResetGate(page)
    await armToastWatch(page)
    await copyButton.click()
    await page.waitForFunction(() => document.querySelector('#content .copy-btn')?.classList.contains('copied'))
    await waitForToast(page, /^코드 복사됨$/)
    // The gate has to have caught something. This does not prove it caught the *right*
    // timer -- the window check further down does that -- but it separates "copyCode stopped
    // scheduling a restore at all" from "it scheduled one the gate missed", which otherwise
    // both surface as the same confusing failure later.
    assert.equal(
      await heldCopyResetCount(page),
      1,
      `copy reset gate never intercepted a ${COPY_RESET_DELAY_MS}ms timer -- has copyCode's restore delay changed?`,
    )
    const copiedIconHtml = await copyButton.evaluate(el => el.innerHTML)
    assert.match(copiedIconHtml, /icon-check/)
    // Tooltip hides once the button flips to its "copied" state so it doesn't read stale.
    await waitForTooltipOpacity(page, '0')

    // The count above only proves the gate caught *a* timer of that delay, which is not the
    // same as catching this button's. Measured 2026-09-21: with COPY_RESET_DELAY_MS set to
    // 1600 the count assertion still passed, because the gate then caught #toast's own 1.6s
    // timer while the real restore ran on schedule -- the test would have gone straight back
    // to racing the window, silently. So wait past the restore delay and require the window
    // to still be open. This one costs real time on purpose (~1.8s): "the window did not
    // close" is a claim only elapsed time can support. The cheaper checks were considered
    // and rejected as more fragile than what they'd save -- matching on the delay value is
    // the thing being guarded against, and inspecting the held callback's source would break
    // on any refactor of copyCode that kept its behaviour.
    await page.waitForTimeout(COPY_RESET_DELAY_MS + 300)
    assert.equal(
      await copyButton.evaluate(el => el.classList.contains('copied')),
      true,
      'copy reset gate held some other timer -- the copied window closed on its own',
    )

    // Let the held restore run: the button goes back to its idle icon and drops `.copied`,
    // which nothing asserted while that timer was racing the test.
    await releaseCopyResetGate(page)
    await page.waitForFunction(() => document.querySelector('#content .copy-btn')?.classList.contains('copied') === false)
    assert.match(await copyButton.evaluate(el => el.innerHTML), /icon-copy/)

    // The gate is off again by now, so copyAll's own restore timer is untouched.
    await armToastWatch(page)
    await page.click('#btn-copy-all')
    await waitForToast(page, /^복사됨$/)
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

test('mermaid diagram keeps its intrinsic size after a source-mode round trip (plan 16)', async () => {
  // mermaid sizes itself off getBBox() of what it just drew. #content is display:none while
  // source mode is showing the editor, and toggleSource's exit path re-renders (fresh,
  // unprocessed mermaid nodes) before unhiding #content -- so without the measurement-parking
  // fix, the diagram bakes in a near-zero max-width and never recovers. The existence check
  // this repo used to run (`#content .mermaid svg` present) passes even on the broken output,
  // so this asserts the actual intrinsic width mermaid wrote into style.maxWidth.
  const { electronApp, page } = await launchApp()
  const consoleErrors = []
  page.on('pageerror', err => consoleErrors.push(String(err)))

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [MERMAID_MD])
    await clickApplicationMenuItem(electronApp, '파일', '파일 열기…')
    await page.waitForFunction(() => document.title === 'mermaid')
    await page.waitForFunction(() => !!document.querySelector('#content .mermaid svg'), { timeout: 8000 })

    const intrinsicWidth = () => page.evaluate(() =>
      parseFloat(document.querySelector('#content .mermaid svg').style.maxWidth))
    const before = await intrinsicWidth()
    // tests/fixtures/mermaid.md's diagram is tiny (~85px intrinsic) -- the collapsed-by-the-bug
    // value observed in practice is ~16px (padding only), so 50 sits well clear of both without
    // assuming a specific fixture size.
    assert.ok(before > 50, `sanity check on the first render's own width: ${before}`)

    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => document.getElementById('scroll-area').classList.contains('source-mode'))
    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => !document.getElementById('scroll-area').classList.contains('source-mode'))
    await page.waitForFunction(() => !!document.querySelector('#content .mermaid svg'), { timeout: 8000 })

    const after = await intrinsicWidth()
    assert.ok(after > 50, `diagram must not collapse to a near-zero width after the round trip, got ${after}`)
    assert.ok(Math.abs(after - before) < 2, `width must not drift between the visible and parked renders: before=${before} after=${after}`)

    assert.deepEqual(consoleErrors, [], 'mermaid must not raise CSP violations or runtime errors')
  } finally {
    await closeApp(electronApp)
  }
})

test('print/PDF export temporarily redraws a dark-mode mermaid diagram and hljs tokens in light palette, then restores dark (plan 16)', async () => {
  const { electronApp, page } = await launchApp()
  const consoleErrors = []
  page.on('pageerror', err => consoleErrors.push(String(err)))

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [MERMAID_MD])
    await clickApplicationMenuItem(electronApp, '파일', '파일 열기…')
    await page.waitForFunction(() => document.title === 'mermaid')
    await page.waitForFunction(() => !!document.querySelector('#content .mermaid svg'), { timeout: 8000 })

    const styleFingerprint = () => page.evaluate(() => {
      const svg = document.querySelector('#content .mermaid svg')
      const style = svg?.querySelector('style')
      return style ? style.textContent.replaceAll(svg.id, 'ID') : null
    })

    // toggleTheme cycles auto -> light -> dark -> auto from a stored default of 'auto' --
    // drive explicitly to each target instead of assuming a click count.
    const setTheme = async target => {
      for (let i = 0; i < 3 && (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) !== target; i++) {
        await page.evaluate(() => document.querySelector('[data-command="toggleTheme"]').click())
        await page.waitForFunction(() => !!document.querySelector('#content .mermaid svg'))
      }
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), target)
    }

    await setTheme('light')
    const lightPrint = await styleFingerprint()
    await setTheme('dark')
    const darkPrint = await styleFingerprint()
    assert.notEqual(lightPrint, darkPrint, 'sanity check: the fingerprint actually distinguishes theme')

    await page.evaluate(() => {
      const fp = () => {
        const svg = document.querySelector('#content .mermaid svg')
        const style = svg?.querySelector('style')
        return style ? style.textContent.replaceAll(svg.id, 'ID') : null
      }
      window.__atPrint = null
      window.__afterDelay = null
      window.print = () => {
        window.__atPrint = fp()
        window.__atPrintHljsDarkDisabled = document.getElementById('hljs-dark').disabled
        // Simulate the print job still painting after window.print() returns and afterprint
        // fires -- a restore keyed off print()'s own return (instead of afterprint) would flip
        // back to dark during this window, which is exactly the bug this covers.
        setTimeout(() => {
          window.__afterDelay = fp()
          window.__afterDelayHljsDarkDisabled = document.getElementById('hljs-dark').disabled
          window.dispatchEvent(new Event('afterprint'))
        }, 50)
      }
    })

    await emitRendererCommand(electronApp, 'printDoc')
    await page.waitForFunction(() => window.__afterDelay !== null, { timeout: 5000 })

    assert.equal(await page.evaluate(() => window.__atPrint), lightPrint, 'diagram was redrawn light before window.print() was called')
    assert.equal(await page.evaluate(() => window.__afterDelay), lightPrint, 'diagram stayed light through the delayed/still-painting print job')
    assert.equal(await page.evaluate(() => window.__atPrintHljsDarkDisabled), true, 'hljs dark stylesheet is disabled for the print job')
    assert.equal(await page.evaluate(() => window.__afterDelayHljsDarkDisabled), true, 'hljs stays light through the delayed print job too')

    // printDoc()'s restore runs in the async command handler after `afterprint`, which
    // emitRendererCommand doesn't wait on -- poll for it instead of asserting immediately.
    await page.waitForFunction(expected => {
      const svg = document.querySelector('#content .mermaid svg')
      const style = svg?.querySelector('style')
      const fp = style ? style.textContent.replaceAll(svg.id, 'ID') : null
      return fp === expected
    }, darkPrint, { timeout: 5000 })
    const restoredFingerprint = await styleFingerprint()
    assert.equal(restoredFingerprint, darkPrint, 'screen is restored to dark after the print job finishes')
    assert.equal(await page.evaluate(() => document.getElementById('hljs-dark').disabled), false, 'hljs restored to dark on screen')
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark', 'stored theme setting was never touched')

    assert.deepEqual(consoleErrors, [], 'print palette swap must not raise CSP violations or runtime errors')
  } finally {
    await closeApp(electronApp)
  }
})

test('latex/math fences render via KaTeX and are unaffected by a theme toggle', async () => {
  const { electronApp, page } = await launchApp()
  const consoleErrors = []
  page.on('pageerror', err => consoleErrors.push(String(err)))

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [LATEX_MD])
    await clickApplicationMenuItem(electronApp, '파일', '파일 열기…')
    await page.waitForFunction(() => document.title === 'latex')

    await page.waitForFunction(() => document.querySelectorAll('#content .mdv-latex .katex-html').length === 2, { timeout: 8000 })
    assert.equal(await page.locator('#content .mdv-latex').count(), 2, 'both the latex and math fences must render through the katex path')

    // KaTeX's output is theme-agnostic (currentColor, no baked-in SVG fill like mermaid), so
    // toggling theme must leave the already-rendered markup untouched -- no re-render pass exists.
    const htmlBeforeToggle = await page.evaluate(() => document.querySelector('#content .mdv-latex').innerHTML)
    await page.evaluate(() => document.querySelector('[data-command="toggleTheme"]').click())
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light')
    const htmlAfterToggle = await page.evaluate(() => document.querySelector('#content .mdv-latex').innerHTML)
    assert.equal(htmlAfterToggle, htmlBeforeToggle, 'a theme toggle must not re-render katex output')

    assert.deepEqual(consoleErrors, [], 'katex rendering must not raise CSP violations (e.g. local webfont loading) or runtime errors')
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

test('long unbroken inline code in a table cell wraps instead of widening the table past #content', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')

    // No hyphens: a hyphen is a normal line-break opportunity, which would shrink the
    // path's min-content even under break-word and hide the overflow this guards against.
    const longPath = 'src/renderer/components/very/deeply/nested/directory/structure/with/a/really/long/filename/that/keeps/going/forever.js'
    const html = await page.evaluate(longPath => {
      const ctrl = window.MDVMarkdown.createMarkdownController({
        getRefs: () => ({}),
        markedLib: window.marked,
        hljsLib: window.hljs,
        pathUtils: window.MDVPathUtils,
        api: window.api,
      })
      return ctrl.renderMarkdown(`| 이름 | 경로 | 비고 |\n| --- | --- | --- |\n| 파일 | \`${longPath}\` | 일반 텍스트 설명 |`)
    }, longPath)

    await page.evaluate(htmlStr => {
      const content = document.getElementById('content')
      content.classList.remove('is-empty')
      content.innerHTML = htmlStr
    }, html)

    // Table auto layout sizes each column from its min-content width. Under
    // overflow-wrap: break-word the path's wrap points don't count toward min-content, so
    // the path column locked to the full path width and the table overflowed #content.
    const sizes = await page.locator('#content').evaluate(el => ({
      contentWidth: el.clientWidth,
      contentScrollWidth: el.scrollWidth,
      tableWidth: el.querySelector('table').getBoundingClientRect().width,
      codeLines: el.querySelector('td code').getClientRects().length,
    }))
    assert.ok(sizes.contentScrollWidth <= sizes.contentWidth, JSON.stringify(sizes))
    assert.ok(sizes.tableWidth <= sizes.contentWidth + 1, JSON.stringify(sizes))
    assert.ok(sizes.codeLines > 1, `expected the long path to wrap: ${JSON.stringify(sizes)}`)
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

    await armToastWatch(page)
    await page.click('#btn-export-pdf')
    // waitForFile polls for up to 5s and the toast fades after 1.6s, so the recording -- not
    // the live element -- is the only thing still around to check by the time we get here.
    await waitForFile(pdfPath)
    await waitForToast(page, /^PDF 저장됨$/)

    const pdf = await fs.readFile(pdfPath)
    assert.equal(pdf.subarray(0, 4).toString('utf8'), '%PDF')
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})
