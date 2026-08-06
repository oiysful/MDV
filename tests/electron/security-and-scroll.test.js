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

// Same trick as stubOpenExternal, for the two sinks open-local-path can reach: a test can
// then assert *which* one a given target was routed to without the OS launching anything.
async function stubShellTargets(electronApp) {
  await electronApp.evaluate(({ shell }) => {
    globalThis.__openPathCalls = []
    globalThis.__showItemCalls = []
    shell.openPath = async (target) => { globalThis.__openPathCalls.push(target); return '' }
    shell.showItemInFolder = (target) => { globalThis.__showItemCalls.push(target) }
  })
}

async function getShellTargetCalls(electronApp) {
  return electronApp.evaluate(() => ({
    openPath: globalThis.__openPathCalls ?? [],
    showItem: globalThis.__showItemCalls ?? [],
  }))
}

// HIGH-1 in docs/plans/done/2026-07-30/06-security-hardening-audit-2026-07-22.md: a link in an untrusted
// markdown document used to reach shell.openPath for *any* extension, so one click on
// [Setup](./setup.command) ran local code. Only the document/image/office allowlist may be
// opened; everything else — executables, unknown types, directories (macOS .app bundles are
// directories), and symlinks whose real target is outside the list — is revealed in Finder.
test('open-local-path opens only allowlisted file types and reveals everything else', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-openlocal-'))
  const allowed = path.join(tempDir, 'report.pdf')
  const executable = path.join(tempDir, 'setup.command')
  const unknown = path.join(tempDir, 'archive.zip')
  const subdir = path.join(tempDir, 'attachments')
  const disguised = path.join(tempDir, 'notes.pdf') // symlink → setup.command
  // Security-review follow-up: .svg is deliberately excluded from OPENABLE_EXTENSIONS
  // (unlike the other image formats) because it can carry an embedded <script> that would
  // run in whatever app shell.openPath hands it to. Pinned here so re-adding it to the
  // allowlist fails a test instead of silently reopening that gap.
  const svg = path.join(tempDir, 'icon.svg')
  await fs.writeFile(allowed, '%PDF-1.4\n')
  await fs.writeFile(executable, '#!/bin/sh\necho pwned\n')
  await fs.writeFile(unknown, 'zip')
  await fs.mkdir(subdir)
  await fs.symlink(executable, disguised)
  await fs.writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>\n')

  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubShellTargets(electronApp)

    const openLocal = target => page.evaluate(p => window.api.openLocalPath(p), target)

    const allowedRes = await openLocal(allowed)
    assert.equal(allowedRes.kind, 'external', 'an allowlisted .pdf is handed to the OS')

    for (const [target, label] of [[executable, '.command'], [unknown, '.zip'], [subdir, 'directory'], [disguised, 'symlinked .command'], [svg, '.svg']]) {
      const res = await openLocal(target)
      assert.equal(res.kind, 'revealed', `${label} must be revealed, not opened`)
    }

    // shell.openPath is now handed the realpath (check-then-use fix), which on macOS
    // canonicalizes /var/folders/... to /private/var/folders/... — resolve the same way here.
    const allowedRealPath = await fs.realpath(allowed)
    const calls = await getShellTargetCalls(electronApp)
    assert.deepEqual(calls.openPath, [allowedRealPath], `only the .pdf may reach openPath, got ${JSON.stringify(calls.openPath)}`)
    assert.deepEqual(calls.showItem, [executable, unknown, subdir, disguised, svg])
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

// Security-review follow-up on HIGH-1: the markdown branch used to check only the link's
// own extension, so a symlink named notes.md pointing at an arbitrary non-markdown file
// (e.g. a credential) would still be read and handed to the renderer as tab content. Both
// the link name and its realpath must end in a markdown extension.
test('open-local-path refuses to read a markdown-named symlink whose real target is not markdown', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-openlocal-mdlink-'))
  const secret = path.join(tempDir, 'secret.txt')
  const disguised = path.join(tempDir, 'notes.md') // symlink → secret.txt
  await fs.writeFile(secret, 'super-secret-value\n')
  await fs.symlink(secret, disguised)

  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubShellTargets(electronApp)

    const res = await page.evaluate(p => window.api.openLocalPath(p), disguised)
    assert.equal(res.kind, 'revealed', 'a .md-named symlink to a non-markdown target must be revealed, not read')
    assert.equal(res.content, undefined, 'file content must never be returned for a rejected target')

    const calls = await getShellTargetCalls(electronApp)
    assert.deepEqual(calls.showItem, [disguised])
    assert.deepEqual(calls.openPath, [])
  } finally {
    await closeApp(electronApp)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

// LOW-4: window.open() targets bypass the content link handler, so the window-open handler
// needs the same ^https?:// whitelist as open-external-url — a file:/// or custom-scheme
// target must be dropped, not handed to the OS.
test('setWindowOpenHandler forwards only http(s) targets to the OS', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenExternal(electronApp)

    await page.evaluate(() => {
      window.open('https://example.com/ok', '_blank')
      window.open('file:///etc/passwd', '_blank')
      window.open('mdv-evil://payload', '_blank')
    })
    await page.waitForTimeout(200)

    const urls = await getOpenExternalCalls(electronApp)
    assert.deepEqual(urls, ['https://example.com/ok'], `only http(s) may be forwarded, got ${JSON.stringify(urls)}`)
  } finally {
    await closeApp(electronApp)
  }
})

// docs/plans/done/2026-07-30/03-tab-switch-scroll-animation.md: `#scroll-area` carried a global
// scroll-behavior: smooth, and `scrollTop = n` scrolls with behavior 'auto' — which follows
// that computed value. So every tab restore animated across the full distance between the
// two tabs' offsets. Restore must land in the same frame it is assigned.
test('tab switching restores scroll position instantly, without a smooth animation', async () => {
  const { electronApp, page } = await launchApp()
  const longBody = Array.from({ length: 120 }, (_, index) => `## Section ${index + 1}\n\nParagraph ${index + 1}.`).join('\n\n')

  try {
    await page.waitForSelector('#empty')
    await emitFileOpened(electronApp, { content: `# A\n\n${longBody}\n`, filename: 'scroll-a.md', path: '/tmp/mdv-scroll-a.md' })
    await page.waitForFunction(() => document.title === 'scroll-a')
    await emitFileOpened(electronApp, { content: `# B\n\n${longBody}\n`, filename: 'scroll-b.md', path: '/tmp/mdv-scroll-b.md' })
    await page.waitForFunction(() => document.title === 'scroll-b')

    // The CSS property itself: an absolute scrollTop assignment must not animate.
    const behavior = await page.evaluate(() => getComputedStyle(document.getElementById('scroll-area')).scrollBehavior)
    assert.equal(behavior, 'auto', '#scroll-area must not declare scroll-behavior: smooth')

    // Park tab B deep in the document, then leave and come back.
    await page.evaluate(() => { document.getElementById('scroll-area').scrollTop = 2400 })
    await page.waitForFunction(() => document.getElementById('scroll-area').scrollTop === 2400)

    await page.locator('#tab-list .file-tab').first().click()
    await page.waitForFunction(() => document.title === 'scroll-a')
    await page.locator('#tab-list .file-tab').nth(1).click()
    await page.waitForFunction(() => document.title === 'scroll-b')

    // Two frames after the restore assignment: smooth scrolling is still hundreds of pixels
    // short of 2400 here (it starts from 0), so the value is what distinguishes instant from
    // animated. The small tolerance keeps that discriminating power while leaving room for a
    // loaded machine to drop a frame.
    const restored = await page.evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        resolve(document.getElementById('scroll-area').scrollTop)
      }))
    }))
    assert.ok(restored >= 2380, `scroll should be restored instantly, got ${restored}`)
  } finally {
    await closeApp(electronApp)
  }
})

// Same plan, cause B: a new tab reuses the one scroll container, so opening a document while
// the previous tab was scrolled down used to show the new document already scrolled.
test('opening a new document starts at the top instead of inheriting the previous scroll', async () => {
  const { electronApp, page } = await launchApp()
  const longBody = Array.from({ length: 120 }, (_, index) => `## Section ${index + 1}\n\nParagraph ${index + 1}.`).join('\n\n')

  try {
    await page.waitForSelector('#empty')
    await emitFileOpened(electronApp, { content: `# First\n\n${longBody}\n`, filename: 'first.md', path: '/tmp/mdv-first.md' })
    await page.waitForFunction(() => document.title === 'first')

    await page.evaluate(() => { document.getElementById('scroll-area').scrollTop = 1800 })
    await page.waitForFunction(() => document.getElementById('scroll-area').scrollTop === 1800)

    await emitFileOpened(electronApp, { content: `# Second\n\n${longBody}\n`, filename: 'second.md', path: '/tmp/mdv-second.md' })
    await page.waitForFunction(() => document.title === 'second')

    const offsets = await page.evaluate(() => ({
      scrollArea: document.getElementById('scroll-area').scrollTop,
      content: document.getElementById('content').scrollTop,
    }))
    assert.equal(offsets.scrollArea, 0, `a new tab must open at the top, got ${offsets.scrollArea}`)
    assert.equal(offsets.content, 0, `the preview pane must open at the top, got ${offsets.content}`)

    // The tab left behind still remembers where it was — this fix must not flatten restore.
    await page.locator('#tab-list .file-tab').first().click()
    await page.waitForFunction(() => document.title === 'first')
    const restored = await page.evaluate(() => document.getElementById('scroll-area').scrollTop)
    assert.equal(restored, 1800, `the previous tab keeps its own offset, got ${restored}`)
  } finally {
    await closeApp(electronApp)
  }
})
