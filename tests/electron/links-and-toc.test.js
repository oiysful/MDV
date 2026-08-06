const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { launchApp, closeApp, stubCloseDialog, getCloseDialogCalls } = require('./helpers/launch')
const {
  BASIC_MD, ROOT_MD, EXPLORER_DIR,
  stubOpenDialog, stubSaveDialog, createTempMarkdown,
  emitFileOpened, emitRendererCommand, clickApplicationMenuItem,
  stubOpenExternal, getOpenExternalCalls,
} = require('./helpers/smoke-helpers')

test('clicking a local markdown link opens the target as a new tab', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-links-'))
  const sourcePath = path.join(tempDir, 'source.md')
  const relTargetPath = path.join(tempDir, 'target-rel.md')
  const absTargetPath = path.join(tempDir, 'target-abs.md')
  await fs.writeFile(relTargetPath, '# Relative Target\n\nOpened via relative link.\n', 'utf-8')
  await fs.writeFile(absTargetPath, '# Absolute Target\n\nOpened via absolute link.\n', 'utf-8')
  await fs.writeFile(
    sourcePath,
    `# Source Doc\n\n[open relative](./target-rel.md)\n\n[open absolute](${absTargetPath})\n`,
    'utf-8',
  )

  const { electronApp, page } = await launchApp()
  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [sourcePath])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'source')

    // Relative link resolves against the active tab's directory and opens a new tab.
    await page.locator('#content a', { hasText: 'open relative' }).click()
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return document.querySelectorAll('#tab-list .file-tab').length === 2 && active && active.textContent.includes('target-rel.md')
    })
    assert.match(await page.textContent('#content'), /Opened via relative link\./)

    // Back on the source tab, an absolute-path link opens its target too.
    await page.locator('#tab-list .file-tab', { hasText: 'source.md' }).click()
    await page.waitForFunction(() => document.title === 'source')
    await page.locator('#content a', { hasText: 'open absolute' }).click()
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return document.querySelectorAll('#tab-list .file-tab').length === 3 && active && active.textContent.includes('target-abs.md')
    })
    assert.match(await page.textContent('#content'), /Opened via absolute link\./)
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

// docs/plans/done/2026-07-30/05-local-link-anchor-fragment.md: a link with a URL fragment
// (`./target.md#some-heading`) used to fail with "file not found" because the raw href,
// hash included, was handed to resolveLocalPath as if it were part of the file path.
// Follow-up (the plan's own "v1 drops the fragment" note): the fragment is now also used
// to scroll the freshly opened document to the heading it names, which only works because
// buildToc assigns GFM slug ids instead of positional `h${index}` ones.
test('clicking a local markdown link with a #anchor fragment opens the target file and scrolls to the heading', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-links-'))
  const sourcePath = path.join(tempDir, 'source.md')
  const targetPath = path.join(tempDir, 'target-anchor.md')
  // Enough filler above the anchored heading that scrollTop can genuinely move —
  // a short document would scroll nowhere and the assertion would pass either way.
  const filler = `${'Filler paragraph for scroll height. '.repeat(40)}\n\n`.repeat(12)
  await fs.writeFile(
    targetPath,
    `# Anchor Target\n\nOpened via anchored link.\n\n${filler}## Some Heading\n\nDeep section content.\n\n${filler}`,
    'utf-8',
  )
  await fs.writeFile(
    sourcePath,
    '# Source Doc\n\n[open anchored](./target-anchor.md#some-heading)\n',
    'utf-8',
  )

  const { electronApp, page } = await launchApp()
  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [sourcePath])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'source')

    await page.locator('#content a', { hasText: 'open anchored' }).click()
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return document.querySelectorAll('#tab-list .file-tab').length === 2 && active && active.textContent.includes('target-anchor.md')
    })
    assert.match(await page.textContent('#content'), /Opened via anchored link\./)

    // The scroll is smooth (animated) and is deliberately queued behind restoreTabState's
    // own rAF, so poll rather than reading scrollTop once.
    await page.waitForFunction(() => {
      const heading = document.getElementById('some-heading')
      const scrollArea = document.getElementById('scroll-area')
      if (!heading || !scrollArea) return false
      return scrollArea.scrollTop > 0
        && Math.abs(heading.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top) < 40
    })
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

// Same plan doc, in-page half: `[텍스트](#헤더-슬러그)` inside a document used to do nothing at
// all, because heading ids were positional (`h0`, `h1`, ...) so the slug matched no element.
// The Korean anchor also exercises the decodeURIComponent step — marked percent-encodes
// non-ASCII hrefs while heading ids stay raw.
test('clicking an in-page #slug anchor scrolls to that heading, including Korean slugs', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-inpage-anchor-'))
  const docPath = path.join(tempDir, 'inpage.md')
  const filler = `${'Filler paragraph for scroll height. '.repeat(40)}\n\n`.repeat(12)
  await fs.writeFile(
    docPath,
    // "Content" slugifies to `content`, which collides with the #content chrome div —
    // a document-wide getElementById would return the div, not the heading.
    `# In-page Doc\n\n[jump ascii](#deep-section)\n\n[jump korean](#한글-절)\n\n[jump colliding](#content)\n\n${filler}## Deep Section\n\nAscii target body.\n\n${filler}## 한글 절\n\nKorean target body.\n\n${filler}## Content\n\nColliding-slug target body.\n\n${filler}`,
    'utf-8',
  )

  const { electronApp, page } = await launchApp()
  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [docPath])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'inpage')

    // Both headings must have real slug ids for the anchors to resolve at all.
    assert.deepEqual(
      await page.evaluate(() => Array.from(document.querySelectorAll('#content h2')).map(el => el.id)),
      ['deep-section', '한글-절', 'content'],
    )

    await page.locator('#content a', { hasText: 'jump ascii' }).click()
    await page.waitForFunction(() => {
      const heading = document.getElementById('deep-section')
      const scrollArea = document.getElementById('scroll-area')
      return scrollArea.scrollTop > 0
        && Math.abs(heading.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top) < 40
    })

    // Back to the top so the Korean jump is a real movement, not a no-op.
    await page.evaluate(() => { document.getElementById('scroll-area').scrollTop = 0 })
    await page.locator('#content a', { hasText: 'jump korean' }).click()
    await page.waitForFunction(() => {
      const heading = document.getElementById('한글-절')
      const scrollArea = document.getElementById('scroll-area')
      return scrollArea.scrollTop > 0
        && Math.abs(heading.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top) < 40
    })

    // A slug that collides with an app-chrome id must still resolve to the heading.
    // getElementById('content') returns the chrome div (earlier in document order), so
    // scrollToContentFragment has to search inside #content rather than document-wide;
    // scrolling the div itself would land at the top of the document instead.
    await page.evaluate(() => { document.getElementById('scroll-area').scrollTop = 0 })
    await page.locator('#content a', { hasText: 'jump colliding' }).click()
    await page.waitForFunction(() => {
      const heading = Array.from(document.querySelectorAll('#content h2')).find(el => el.id === 'content')
      const scrollArea = document.getElementById('scroll-area')
      return scrollArea.scrollTop > 0
        && Math.abs(heading.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top) < 40
    })
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

// Code-review follow-up on docs/plans/done/2026-07-30/05-local-link-anchor-fragment.md: splitHrefFragment's
// first-`#` policy is deterministic but not lossless -- a filename that itself contains a
// literal `#` with no trailing anchor now fails to open, because the `#` is read as an anchor
// separator regardless of intent. This is a known, accepted limitation (see the plan's own
// risk note), not a silent regression, so this test documents and pins that failure mode
// rather than trying to fix it.
test('clicking a local link whose filename contains a literal # fails to open (known limitation)', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-links-hash-'))
  const sourcePath = path.join(tempDir, 'source.md')
  const hashedPath = path.join(tempDir, 'a#b.md')
  await fs.writeFile(hashedPath, '# Hashed Target\n\nShould not be reachable via a link.\n', 'utf-8')
  await fs.writeFile(sourcePath, '# Source Doc\n\n[open hashed](./a#b.md)\n', 'utf-8')

  const { electronApp, page } = await launchApp()
  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [sourcePath])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'source')

    let dialogMessage = null
    page.on('dialog', async dialog => {
      dialogMessage = dialog.message()
      await dialog.dismiss()
    })

    await page.locator('#content a', { hasText: 'open hashed' }).click()
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 1)

    assert.ok(dialogMessage, 'the split-at-first-# path must fail to resolve, not silently no-op')
    assert.match(dialogMessage, /파일을 찾을 수 없습니다/)
    // The failure signature pins *why* it fails: split on the first `#` leaves "a" as the
    // path (dropping "b.md" as a discarded fragment), never the real "a#b.md" target.
    assert.match(dialogMessage, /\/a$/, `expected the resolved path to end in bare "a", got: ${dialogMessage}`)
    assert.equal(await page.locator('#tab-list .file-tab').count(), 1, 'no tab opens for the mis-split target')
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test('clicking a link to a missing local file shows a not-found error, not "not allowed"', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-links-'))
  const sourcePath = path.join(tempDir, 'source.md')
  await fs.writeFile(sourcePath, '# Source Doc\n\n[open missing](./does-not-exist.md)\n', 'utf-8')

  const { electronApp, page } = await launchApp()
  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [sourcePath])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'source')

    let dialogMessage = null
    page.on('dialog', async dialog => {
      dialogMessage = dialog.message()
      await dialog.dismiss()
    })

    await page.locator('#content a', { hasText: 'open missing' }).click()
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 1)

    assert.ok(dialogMessage, 'a link-failure alert should have been shown')
    assert.match(dialogMessage, /파일을 찾을 수 없습니다/)
    assert.doesNotMatch(dialogMessage, /허용되지 않은 링크입니다/)
    // No tab was opened for the missing target.
    assert.equal(await page.locator('#tab-list .file-tab').count(), 1)
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test('clicking an https link still opens externally without opening a tab', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-links-'))
  const sourcePath = path.join(tempDir, 'source.md')
  await fs.writeFile(sourcePath, '# Source Doc\n\n[visit web](https://example.com/page)\n', 'utf-8')

  const { electronApp, page } = await launchApp()
  try {
    await page.waitForSelector('#empty')
    await stubOpenExternal(electronApp)
    await stubOpenDialog(electronApp, [sourcePath])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'source')

    await page.locator('#content a', { hasText: 'visit web' }).click()

    let calls = []
    const startedAt = Date.now()
    while (Date.now() - startedAt < 5000) {
      calls = await getOpenExternalCalls(electronApp)
      if (calls.length > 0) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.deepEqual(calls, ['https://example.com/page'])
    // The external link must not have spawned a document tab.
    assert.equal(await page.locator('#tab-list .file-tab').count(), 1)
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

// docs/plans/done/2026-07-30/02-toc-scrollspy-offset-bias.md: cachedHeadings.top used to be cached
// relative to document.body while the scrollspy comparison used #scroll-area-relative
// scrollTop, so the active highlight always lagged the true scroll position -- most
// visibly, clicking a TOC item left the *previous* item highlighted instead of the one
// just clicked. jsdom's offsetTop is always 0, so this can only be verified against a
// real layout engine here, not in the unit suite.
test('TOC scrollspy activates the clicked heading itself, and tracks the heading nearest the top while scrolling', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-toc-'))
  const docPath = path.join(tempDir, 'toc.md')
  const sections = Array.from({ length: 12 }, (_, i) => `## Section ${i + 1}\n\n${'Paragraph text for scroll height. '.repeat(40)}`).join('\n\n')
  await fs.writeFile(docPath, `# TOC Doc\n\n${sections}\n`, 'utf-8')

  const { electronApp, page } = await launchApp()
  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [docPath])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'toc')

    // The TOC sidebar tab is active by default (index.html #sidebar-tabs data-active="toc").
    await page.waitForFunction(() => document.querySelectorAll('#toc-list a').length === 13)

    // Click a mid-list item (not the first, so a "stuck on the previous item" regression
    // is actually observable) and confirm the clicked item itself ends up active.
    const targetLink = page.locator('#toc-list a').nth(6) // Section 6
    const targetHref = await targetLink.getAttribute('href')
    // Heading ids are GFM slugs (markdown.js slugifyHeading), not positional `h${index}`.
    assert.equal(targetHref, '#section-6')
    await targetLink.click()
    await page.waitForFunction(
      href => document.querySelector('#toc-list a.active')?.getAttribute('href') === href,
      targetHref,
    )
    assert.equal(await page.locator('#toc-list a.active').getAttribute('href'), targetHref)

    // Programmatic scroll, independent of the click/scrollIntoView path: jump just past
    // a later heading's cached top and confirm the highlight follows it, not the one before.
    // A synthetic resize forces refreshHeadingOffsets() to recompute cachedHeadings from
    // the current live layout right before reading it here, so this isn't racing whatever
    // reflow (font swap, async highlight.js pass) may have shifted offsets since buildToc()
    // ran at open time.
    await page.evaluate(() => window.dispatchEvent(new Event('resize')))
    const expectedHref = await page.evaluate(() => {
      const heading = document.querySelectorAll('#content h2')[8] // Section 9
      const scrollArea = document.getElementById('scroll-area')
      // +15: past the fixed formula's -24px lead (so the fixed code activates this
      // heading), but inside the old buggy formula's ~43px "still shows the previous
      // item" window (verified empirically against the pre-fix code) -- this margin
      // genuinely exercises the offset fix rather than just landing deep inside the
      // section where both formulas would agree.
      scrollArea.scrollTop = heading.offsetTop - scrollArea.offsetTop + 15
      return `#${heading.id}`
    })
    await page.waitForFunction(
      href => document.querySelector('#toc-list a.active')?.getAttribute('href') === href,
      expectedHref,
    )
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

// Cause B from the same plan doc: in split view #scroll-area itself stops scrolling
// (overflow: hidden), so scrollspy needs a listener on #content, the pane that actually
// scrolls there -- otherwise the TOC highlight never updates while split view is open.
test('TOC scrollspy keeps updating from the #content pane while split view is open', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-smoke-toc-'))
  const docPath = path.join(tempDir, 'toc-split.md')
  const sections = Array.from({ length: 12 }, (_, i) => `## Section ${i + 1}\n\n${'Paragraph text for scroll height. '.repeat(40)}`).join('\n\n')
  await fs.writeFile(docPath, `# TOC Split Doc\n\n${sections}\n`, 'utf-8')

  const { electronApp, page } = await launchApp()
  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [docPath])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'toc-split')

    // Entering split view force-closes #sidebar, whose width transition (index.html, .25s)
    // keeps reflowing #content's available width for the whole span -- wait for it to
    // finish (same event the production refreshHeadingOffsets() re-run listens for) before
    // reading layout, same as a real user would before scrolling.
    await page.evaluate(() => {
      window.__mdvSidebarTransitionDone = false
      const sidebar = document.getElementById('sidebar')
      const onEnd = event => {
        if (event.propertyName !== 'width') return
        sidebar.removeEventListener('transitionend', onEnd)
        window.__mdvSidebarTransitionDone = true
      }
      sidebar.addEventListener('transitionend', onEnd)
    })
    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => document.getElementById('scroll-area').classList.contains('split-mode'))
    await page.waitForFunction(() => window.__mdvSidebarTransitionDone === true)

    // No synthetic resize here (unlike the normal-mode test above): entering split view
    // reflows #content to a different width, so toggleSplitView's own applySourceMode()
    // must recompute cachedHeadings itself (via markdownController.refreshHeadingOffsets(),
    // re-run once more on the sidebar's transitionend) -- a resize event would recompute it
    // for us and mask a regression in that wiring.
    const expectedHref = await page.evaluate(() => {
      const content = document.getElementById('content')
      const scrollArea = document.getElementById('scroll-area')
      const heading = content.querySelectorAll('h2')[8] // Section 9
      // cachedHeadings.top is anchored to #scroll-area.offsetTop regardless of mode (see
      // markdown.js buildToc), so the target uses that same base even though #content is
      // the element actually being scrolled here.
      content.scrollTop = heading.offsetTop - scrollArea.offsetTop + 15
      return `#${heading.id}`
    })
    await page.waitForFunction(
      href => document.querySelector('#toc-list a.active')?.getAttribute('href') === href,
      expectedHref,
    )
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})
