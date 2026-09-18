const test = require('node:test')
const assert = require('node:assert/strict')

const { launchApp, closeApp, stubCloseDialog, getCloseDialogCalls } = require('./helpers/launch')
const {
  BASIC_MD, ROOT_MD, EXPLORER_DIR,
  stubOpenDialog, stubSaveDialog, createTempMarkdown,
  emitFileOpened, emitRendererCommand, clickApplicationMenuItem,
  stubOpenExternal, getOpenExternalCalls,
  emitFullScreenChanged, armSidebarTransitionWatch, waitForSidebarTransition,
} = require('./helpers/smoke-helpers')

// Overrides the real (OS-dependent) default-app-status IPC handler with a fixed response
// held shut until the test opens the gate, so a test can focus something before the guide
// claims focus during page load.
//
// This used to be a 400ms delay, which made the window a race rather than a barrier: the
// reload plus the rendererReady wait plus one evaluate round trip can overrun 400ms on a
// loaded runner, and then the guide opens first, its deferred rAF takes focus, the test
// steals that focus back, and the following wait sits out its timeout on a focus move that
// already happened. A wider delay would only have made it rarer. See
// docs/plans/19-default-app-guide-focus-flake.md.
//
// Safe to hold open-endedly: app.js dispatches checkMarkdownDefaultAppStatus() with `void`
// and sets rendererReady on the very next line, so a blocked status call does not hold up
// the readiness this test waits on.
async function stubDefaultAppStatusGate(electronApp) {
  await electronApp.evaluate(({ ipcMain }) => {
    globalThis.__mdvDefaultAppStatusGate = new Promise(resolve => {
      globalThis.__mdvOpenDefaultAppStatusGate = resolve
    })
    ipcMain.removeHandler('get-markdown-default-app-status')
    ipcMain.handle('get-markdown-default-app-status', async () => {
      await globalThis.__mdvDefaultAppStatusGate
      return { ok: true, registered: false, needsAction: true, appPath: '/Applications/MDV.app', defaultHandlers: [] }
    })
  })
}

async function openDefaultAppStatusGate(electronApp) {
  await electronApp.evaluate(() => { globalThis.__mdvOpenDefaultAppStatusGate() })
}

test('native menu exposes previously hidden file, edit, view, and help commands', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    await clickApplicationMenuItem(electronApp, '파일', '새 파일')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 2)

    await clickApplicationMenuItem(electronApp, '파일', '탭 닫기')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 1)

    await clickApplicationMenuItem(electronApp, '편집', '찾기…')
    await page.waitForSelector('#search-bar', { state: 'visible' })
    await clickApplicationMenuItem(electronApp, '편집', '찾기…')
    await page.waitForFunction(() => document.getElementById('search-bar').style.display === 'none')

    await clickApplicationMenuItem(electronApp, '보기', '소스 보기')
    await page.waitForFunction(() => document.getElementById('source-view').style.display === 'block')
    await clickApplicationMenuItem(electronApp, '보기', '소스 보기')
    await page.waitForFunction(() => document.getElementById('content').style.display === '')

    await clickApplicationMenuItem(electronApp, '보기', '분할뷰')
    await page.waitForFunction(() => document.getElementById('scroll-area').classList.contains('split-mode'))
    await clickApplicationMenuItem(electronApp, '보기', '분할뷰')
    await page.waitForFunction(() => !document.getElementById('scroll-area').classList.contains('split-mode'))

    // data-theme can stay the same string across a toggle when 'auto' already
    // resolves to the system's current appearance, so assert on the theme label
    // (which always cycles auto → light → dark) instead of the resolved value.
    const themeLabelBefore = await page.evaluate(() => document.getElementById('btn-theme').title)
    await clickApplicationMenuItem(electronApp, '보기', '테마 전환')
    await page.waitForFunction(before => document.getElementById('btn-theme').title !== before, themeLabelBefore)

    await clickApplicationMenuItem(electronApp, '도움말', '단축키')
    await page.waitForFunction(() => document.getElementById('shortcuts-guide')?.classList.contains('show'))
    await page.locator('#shortcuts-guide .guide-close').click()
    await page.waitForFunction(() => !document.getElementById('shortcuts-guide')?.classList.contains('show'))
  } finally {
    await closeApp(electronApp)
  }
})

test('native menu switches tabs via next/prev commands', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await emitFileOpened(electronApp, { content: '# A\n', filename: 'a.md', path: '/tmp/mdv-menu-a.md' })
    await page.waitForFunction(() => document.title === 'a')
    await emitFileOpened(electronApp, { content: '# B\n', filename: 'b.md', path: '/tmp/mdv-menu-b.md' })
    await page.waitForFunction(() => document.title === 'b')

    await clickApplicationMenuItem(electronApp, '보기', '이전 탭')
    await page.waitForFunction(() => document.title === 'a')

    await clickApplicationMenuItem(electronApp, '보기', '다음 탭')
    await page.waitForFunction(() => document.title === 'b')
  } finally {
    await closeApp(electronApp)
  }
})

test('newFile is owned exclusively by the menu accelerator, not a leftover renderer keydown handler', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')

    // The main-process menu accelerator (⌘T) reaches the renderer only through
    // this IPC command, never through the page's own keydown listener.
    await emitRendererCommand(electronApp, 'newFile')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 1)

    // A raw Cmd+T keydown must be a no-op now that the menu (src/main.js#buildMenu)
    // owns this accelerator -- if the renderer still had its own 't' handler, this
    // would create a second tab and the original bug (double-fire) would be back.
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', metaKey: true, bubbles: true, cancelable: true }))
    })
    await page.waitForTimeout(200)
    assert.equal(await page.locator('#tab-list .file-tab').count(), 1)
  } finally {
    await closeApp(electronApp)
  }
})

test('default app guide has dialog semantics, traps Tab focus, and restores focus on ESC', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    // A prior run (or a real OS default-handler check) may have already opened and dismissed
    // this guide in the shared profile; force it back to "eligible to show" before asserting.
    await page.evaluate(() => {
      localStorage.removeItem('mdv-default-app-guide-dismissed')
      localStorage.removeItem('mdv-default-app-guide-dismissed-v2')
    })

    assert.deepEqual(
      await page.locator('#default-app-guide').evaluate(el => ({
        role: el.getAttribute('role'),
        ariaModal: el.getAttribute('aria-modal'),
        labelledBy: el.getAttribute('aria-labelledby'),
        labelText: document.getElementById(el.getAttribute('aria-labelledby'))?.textContent,
      })),
      { role: 'dialog', ariaModal: 'true', labelledBy: 'default-app-guide-title', labelText: 'Markdown 기본 앱 등록' }
    )

    // The real status IPC round trip resolves before a test script can race it, so there's no
    // window to plant a "previously focused" element. Hold the response shut, plant the focus,
    // then open the gate -- the guide cannot possibly precede the plant, at any runner speed.
    await stubDefaultAppStatusGate(electronApp)
    await page.reload()
    await page.waitForFunction(() => document.documentElement.dataset.rendererReady === 'true')
    await page.evaluate(() => document.getElementById('btn-theme').focus())
    await openDefaultAppStatusGate(electronApp)
    await page.waitForFunction(() => document.getElementById('default-app-guide')?.classList.contains('show'))

    await page.waitForFunction(() => document.activeElement?.id === 'default-app-do-not-show')

    // Shift+Tab from the first focusable element must wrap to the last one, not escape the dialog.
    await page.keyboard.press('Shift+Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.closest('.guide-actions') !== null), true)

    // Tab from the last focusable element must wrap back to the first one.
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'default-app-do-not-show')

    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.getElementById('default-app-guide')?.classList.contains('show'))
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-theme', 'focus must return to the element focused before the modal opened')
  } finally {
    await closeApp(electronApp)
  }
})

test('welcome guide is a non-blocking dialog: no focus trap, and ESC closes it before the search bar', async () => {
  // This test waits for the default-app-guide to genuinely appear (it takes ESC priority
  // over the welcome guide below), so it needs the real OS check rather than launchApp's
  // default deterministic stub (see helpers/launch.js).
  const { electronApp, page } = await launchApp({ realDefaultAppStatus: true })

  try {
    await page.waitForSelector('#empty')
    // A prior run may have already dismissed the welcome guide in this shared profile;
    // force it back to "eligible to show" and reload so this test is deterministic.
    await page.evaluate(() => {
      localStorage.removeItem('mdv-welcome-guide-dismissed')
      localStorage.removeItem('mdv-default-app-guide-dismissed')
      localStorage.removeItem('mdv-default-app-guide-dismissed-v2')
    })
    await page.reload()
    await page.waitForFunction(() => document.documentElement.dataset.rendererReady === 'true')

    assert.deepEqual(
      await page.locator('#welcome-guide').evaluate(el => ({
        role: el.getAttribute('role'),
        ariaModal: el.getAttribute('aria-modal'),
        labelledBy: el.getAttribute('aria-labelledby'),
      })),
      { role: 'dialog', ariaModal: null, labelledBy: 'welcome-guide-title' }
    )

    // The default app guide takes ESC priority; dismiss it first so welcome-guide is the top layer.
    await page.waitForFunction(() => document.getElementById('default-app-guide')?.classList.contains('show'))
    await page.click('#default-app-guide .guide-actions button')
    await page.waitForFunction(() => !document.getElementById('default-app-guide')?.classList.contains('show'))

    await page.waitForFunction(() => document.getElementById('welcome-guide')?.classList.contains('show'))

    // No focus trap: Shift+Tab from the first focusable element inside the card must escape it,
    // proving the card never intercepts Tab the way the blocking default-app-guide does.
    await page.evaluate(() => document.querySelector('#welcome-guide .guide-close').focus())
    await page.keyboard.press('Shift+Tab')
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('#welcome-guide'))), false)

    // ESC priority: guide closes before the search bar.
    await emitRendererCommand(electronApp, 'toggleSearch')
    await page.waitForSelector('#search-bar', { state: 'visible' })
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.getElementById('welcome-guide')?.classList.contains('show'))
    assert.equal(await page.locator('#search-bar').evaluate(el => el.style.display), 'flex', 'the guide should close first, leaving search open')

    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.getElementById('search-bar').style.display === 'none')
  } finally {
    await closeApp(electronApp)
  }
})

// A real ⌘B / ⌘⇧O keypress cannot be driven from here: a Playwright/CDP
// page.keyboard.press('Meta+b') reaches the renderer but never the native menu's
// accelerator matching (measured -- bold applied, sidebar unchanged), and
// webContents.sendInputEvent doesn't reach it either (plan 17, 공통 배경). So the
// registration and the behaviour are pinned separately: this test proves the
// accelerator strings are on the right menu items, and the tests below drive the
// same items through their click handler and their renderer command.
test('native menu registers the ⌘B sidebar and ⌘⇧O folder-open accelerators', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')

    const accelerators = await electronApp.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu()
      const itemIn = (menuLabel, itemLabel) => menu.items
        .find(item => item.label === menuLabel)?.submenu?.items
        .find(item => item.label === itemLabel)
      return {
        sidebar: itemIn('보기', '좌측 패널 표시/숨기기')?.accelerator ?? null,
        openFolder: itemIn('파일', '폴더 열기…')?.accelerator ?? null,
      }
    })

    assert.deepEqual(accelerators, {
      sidebar: 'CmdOrCtrl+B',
      openFolder: 'CmdOrCtrl+Shift+O',
    })
  } finally {
    await closeApp(electronApp)
  }
})

test('보기 > 좌측 패널 표시/숨기기 toggles the sidebar when the menu item is clicked', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')

    const sidebarClosed = () => page.evaluate(() => document.getElementById('sidebar').classList.contains('closed'))
    const before = await sidebarClosed()

    // clickApplicationMenuItem calls target.click(target, win, {}). MenuItem#click is a
    // wrapper -- it re-calls the item's own handler as click(menuItem, focusedWindow, event)
    // with `event` taken from argument 1 -- so the handler receives the MenuItem there, which
    // has no triggeredByAccelerator. That is exactly the mouse-click path, which must always
    // toggle regardless of which element holds focus. Asserting a flip away from and back to
    // the launch state keeps this independent of whether the sidebar happens to start open.
    await clickApplicationMenuItem(electronApp, '보기', '좌측 패널 표시/숨기기')
    await page.waitForFunction(was => document.getElementById('sidebar').classList.contains('closed') !== was, before)

    await clickApplicationMenuItem(electronApp, '보기', '좌측 패널 표시/숨기기')
    await page.waitForFunction(was => document.getElementById('sidebar').classList.contains('closed') === was, before)
  } finally {
    await closeApp(electronApp)
  }
})

// Automates manual-checklist item 3 of plan 17: the menu item clicked with the mouse toggles
// even while the editor owns ⌘B. clickApplicationMenuItem calls win.focus(), which does not
// move document.activeElement, so #source-editor keeps focus across the click. This is also
// the one assertion that tells the two designs apart -- if the menu item ever sends
// toggleSidebarFromShortcut unconditionally (the plan's fallback for a missing
// triggeredByAccelerator), this goes red while every other test here stays green.
test('보기 > 좌측 패널 표시/숨기기 still toggles when the source editor holds focus', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => document.getElementById('source-view').style.display === 'block')
    await page.evaluate(() => document.getElementById('source-editor').focus())
    await page.waitForFunction(() => document.activeElement?.id === 'source-editor')

    const before = await page.evaluate(() => document.getElementById('sidebar').classList.contains('closed'))
    await clickApplicationMenuItem(electronApp, '보기', '좌측 패널 표시/숨기기')
    await page.waitForFunction(was => document.getElementById('sidebar').classList.contains('closed') !== was, before)
  } finally {
    await closeApp(electronApp)
  }
})

// Both halves belong in one test on purpose: if toggleSidebarFromShortcut were never
// registered as a command, the "editor focused" half would pass vacuously. The second half
// is what proves the command exists and does something, so the first half means "skipped"
// rather than "missing".
test('toggleSidebarFromShortcut skips the toggle only while the source editor has focus', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => document.getElementById('source-view').style.display === 'block')
    // Entering source mode schedules requestAnimationFrame(focusEditor) (editor.js#toggleSource),
    // and #source-view is already display:block by the time that frame is queued -- so the wait
    // above can return with the focus call still pending. On an occluded CI window frames are
    // deferred, and this one landed after the test had moved focus to #btn-theme, pulling focus
    // back to the editor so the command below correctly did nothing and the final wait timed out.
    // Drain the pending frame here (two nested rAFs: the second runs a frame after the first,
    // by which point anything queued earlier has run) so the app's own focus settles first.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.evaluate(() => document.getElementById('source-editor').focus())
    await page.waitForFunction(() => document.activeElement?.id === 'source-editor')

    const sidebarClosed = () => page.evaluate(() => document.getElementById('sidebar').classList.contains('closed'))
    const before = await sidebarClosed()

    await emitRendererCommand(electronApp, 'toggleSidebarFromShortcut')
    // Nothing to wait for -- the toggle would land synchronously when the IPC arrives, so a
    // short settle is the only way to observe that it didn't (same shape as the ⌘T no-op above).
    await page.waitForTimeout(200)
    assert.equal(await sidebarClosed(), before, '⌘B belongs to the editor\'s bold shortcut while the editor has focus')

    // Focus anywhere outside the editor and the same command is a plain sidebar toggle.
    await page.evaluate(() => document.getElementById('btn-theme').focus())
    await page.waitForFunction(() => document.activeElement?.id === 'btn-theme')
    await emitRendererCommand(electronApp, 'toggleSidebarFromShortcut')
    await page.waitForFunction(was => document.getElementById('sidebar').classList.contains('closed') !== was, before)
  } finally {
    await closeApp(electronApp)
  }
})

// The sibling of the guard below, and the reason it matters more than it looks: openFolder
// calls switchToExplorerTab(), whose switchTab() force-opens the sidebar on its own path,
// bypassing toggleSidebar's split guard entirely. Reopened that way the sidebar could not be
// closed again -- #btn-sidebar stays disabled and both sidebar commands hit their guard -- so
// the only escape was toggling split view twice. ⌘⇧O put that one keystroke away.
test('opening a folder in split view does not force the sidebar back open', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    const sidebarClosed = () => page.evaluate(() => document.getElementById('sidebar').classList.contains('closed'))

    await armSidebarTransitionWatch(page)
    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => document.getElementById('scroll-area').classList.contains('split-mode'))
    await waitForSidebarTransition(page)
    assert.equal(await sidebarClosed(), true, 'entering split view force-closes the sidebar')

    // stubOpenDialog replaces dialog.showOpenDialog, which serves the folder dialog too.
    await stubOpenDialog(electronApp, [EXPLORER_DIR])
    await emitRendererCommand(electronApp, 'openFolder')
    // The root is still adopted -- only the sidebar reveal is suppressed -- so wait on that
    // rather than on a timeout, then assert the sidebar stayed shut.
    await page.waitForFunction(() => document.getElementById('explorer-tree')?.children.length > 0)
    assert.equal(await sidebarClosed(), true, 'the explorer must not reopen a sidebar split view closed')
  } finally {
    await closeApp(electronApp)
  }
})

// Split view already force-closes the sidebar and disables #btn-sidebar
// (split-view-core.test.js), but a disabled button only blocks the mouse -- the command path
// had no guard, so adding a ⌘B accelerator opened a way to reopen the sidebar in split view.
// Each command is asserted right after it is sent: checking only the end state would stay
// green on unguarded code, where toggleSidebar opens the sidebar and toggleSidebarFromShortcut
// closes it again.
test('split view blocks both sidebar commands, not just the disabled toolbar button', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    const sidebarClosed = () => page.evaluate(() => document.getElementById('sidebar').classList.contains('closed'))
    // waitForSidebarTransition below only resolves if the width transition actually runs, so
    // state the precondition it depends on as an assertion rather than letting it time out.
    assert.equal(await sidebarClosed(), false, 'the sidebar should be open before split view force-closes it')

    const sidebarBadge = () => page.evaluate(() => {
      document.body.classList.add('cmd-held')
      const content = getComputedStyle(document.getElementById('btn-sidebar'), '::after').content
      document.body.classList.remove('cmd-held')
      return content
    })
    // Read the badge while the button is still enabled. Without this, the 'none' asserted after
    // entering split view would be indistinguishable from a badge that never rendered at all --
    // getComputedStyle reports 'none' both when the :disabled rule suppresses the pseudo-element
    // and when no rule ever generated one.
    assert.equal(await sidebarBadge(), '"⌘B"', 'an enabled #btn-sidebar shows its ⌘B badge while Cmd is held')

    await armSidebarTransitionWatch(page)
    await emitRendererCommand(electronApp, 'toggleSplitView')
    await page.waitForFunction(() => document.getElementById('scroll-area').classList.contains('split-mode'))
    await waitForSidebarTransition(page)
    assert.equal(await sidebarClosed(), true, 'entering split view force-closes the sidebar')

    await emitRendererCommand(electronApp, 'toggleSidebar')
    await page.waitForTimeout(200)
    assert.equal(await sidebarClosed(), true, 'toggleSidebar must be a no-op in split view')

    // Move focus off the editor first -- split view focuses #source-editor, and
    // toggleSidebarFromShortcut no-ops on editor focus. Without this, the editor guard rather
    // than the split-view guard would be what keeps the next assertion green.
    await page.evaluate(() => document.getElementById('btn-theme').focus())
    await page.waitForFunction(() => document.activeElement?.id === 'btn-theme')
    await emitRendererCommand(electronApp, 'toggleSidebarFromShortcut')
    await page.waitForTimeout(200)
    assert.equal(await sidebarClosed(), true, 'the shortcut must not reopen the sidebar in split view either')

    // ...and while ⌘B does nothing here, the button must not keep advertising it. #btn-sidebar
    // is disabled but still visible in split view, unlike #btn-split which goes display:none.
    // The enabled-state read above is what makes this assertion mean something.
    assert.equal(await sidebarBadge(), 'none', 'a disabled #btn-sidebar must not show a ⌘B badge it cannot honour')
  } finally {
    await closeApp(electronApp)
  }
})

// Driven through the IPC channel rather than win.setFullScreen(true) (see
// emitFullScreenChanged): a real fullscreen transition moves the window to its own macOS
// Space over ~0.6s and is unreliable on CI runners. main.js's own enter/leave-full-screen
// wiring is therefore not covered here; it is manual-checklist item 6 of plan 17.
test('fullscreen collapses the traffic-light gap and pulls the toolbar to the left edge', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')

    const toolbarGeometry = () => page.evaluate(() => ({
      fullscreen: document.body.classList.contains('is-fullscreen'),
      gapWidth: document.querySelector('.traffic-gap').offsetWidth,
      addButtonLeft: Math.round(document.getElementById('btn-add').getBoundingClientRect().left),
    }))

    const windowed = await toolbarGeometry()
    assert.equal(windowed.fullscreen, false, 'a windowed launch must not start with the fullscreen class')
    assert.equal(windowed.gapWidth, 70, 'the windowed toolbar keeps the 70px macOS traffic-light gap')

    await emitFullScreenChanged(electronApp, true)
    await page.waitForFunction(() => document.body.classList.contains('is-fullscreen'))
    const fullscreen = await toolbarGeometry()
    assert.equal(fullscreen.gapWidth, 0, 'fullscreen hides the traffic lights, so the gap must collapse')
    assert.ok(
      fullscreen.addButtonLeft < 30,
      `#btn-add should sit at the toolbar's own padding once the gap collapses, got ${fullscreen.addButtonLeft}px`
    )

    await emitFullScreenChanged(electronApp, false)
    await page.waitForFunction(() => !document.body.classList.contains('is-fullscreen'))
    assert.equal((await toolbarGeometry()).gapWidth, 70, 'leaving fullscreen must restore the gap before the traffic lights reappear')
  } finally {
    await closeApp(electronApp)
  }
})

// Pins the menu handler's BRANCH rather than either destination command: the accelerator arm
// must dispatch toggleSidebarFromShortcut and the mouse arm toggleSidebar. Reachable because
// MenuItem#click re-calls the item's handler with argument 1 as its `event` parameter, so a
// synthesized { triggeredByAccelerator: true } lands where a real accelerator's flag would.
//
// Limit worth stating: the flag is synthesized here, so this covers the handler's branching,
// NOT macOS actually setting the flag on a real ⌘B -- no synthetic keypress reaches the native
// menu's key matching (measured: sendInputEvent and Playwright's keyboard.press both miss it),
// which is why plan 17 keeps a manual checklist. A green here is not "item 1 verified".
//
// Both halves live in one test on purpose: the accelerator half alone would pass vacuously if
// the branch dispatched a command that does not exist.
test('the ⌘B menu item routes the accelerator and the mouse click to different commands', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.title === 'basic')

    await emitRendererCommand(electronApp, 'toggleSource')
    await page.waitForFunction(() => document.getElementById('source-view').style.display === 'block')
    await page.evaluate(() => document.getElementById('source-editor').focus())
    await page.waitForFunction(() => document.activeElement?.id === 'source-editor')

    const sidebarClosed = () => page.evaluate(() => document.getElementById('sidebar').classList.contains('closed'))
    const before = await sidebarClosed()

    await electronApp.evaluate(({ BrowserWindow, Menu }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.focus()
      const target = Menu.getApplicationMenu().items
        .find(item => item.label === '보기')?.submenu?.items
        .find(item => item.label === '좌측 패널 표시/숨기기')
      if (!target) throw new Error('Menu item not found: 보기 > 좌측 패널 표시/숨기기')
      target.click({ triggeredByAccelerator: true }, win, {})
    })
    // Same shape as the ⌘T no-op assertion above: the toggle would land synchronously with the
    // IPC, so a short settle is the only way to observe that it did not happen.
    await page.waitForTimeout(200)
    assert.equal(await sidebarClosed(), before, 'the accelerator arm must defer to the editor\'s bold shortcut')

    await clickApplicationMenuItem(electronApp, '보기', '좌측 패널 표시/숨기기')
    await page.waitForFunction(was => document.getElementById('sidebar').classList.contains('closed') !== was, before)
  } finally {
    await closeApp(electronApp)
  }
})

// The ⌘ badge (data-shortcut) is reserved for controls backed by a real system shortcut
// (index.html, README), so #btn-sidebar's badge and the menu accelerator have to ship
// together -- this test fails if either half lands alone. The + menu hints are checked by
// containment: their exact wording is a label, the shortcut hint is the contract.
//
// #shortcuts-guide is covered here too because discoverability is the entire point of these
// two shortcuts: ⌘B has no other on-screen home than the badge and this list, and ⌘⇧O was
// added precisely because 폴더 열기 had no advertised key. A guide row is the kind of static
// markup that silently drifts out of sync with the menu it documents.
test('toolbar, + menu, and the shortcuts guide advertise the shortcuts their menu accelerators provide', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')

    const hints = await page.evaluate(() => {
      const sidebar = document.getElementById('btn-sidebar')
      const titleOf = selector => document.querySelector(selector)?.getAttribute('title') ?? ''
      return {
        sidebarShortcut: sidebar.dataset.shortcut ?? null,
        sidebarTitle: sidebar.getAttribute('title'),
        sidebarAriaLabel: sidebar.getAttribute('aria-label'),
        newFile: titleOf('#add-menu [data-command="newFile"]'),
        openFolder: titleOf('#add-menu [data-command="openFolder"]'),
        openFile: titleOf('#add-menu [data-command="openFile"]'),
        guideRows: Object.fromEntries(
          [...document.querySelectorAll('#shortcuts-guide .shortcuts-list li')]
            .map(row => [row.querySelector('span')?.textContent, row.querySelector('kbd')?.textContent])
        ),
      }
    })

    assert.equal(hints.sidebarShortcut, '⌘B', '#btn-sidebar needs the ⌘ badge now that ⌘B is a real accelerator')
    assert.equal(hints.sidebarTitle, '좌측 패널 (⌘B)')
    assert.equal(hints.sidebarAriaLabel, '좌측 패널 (⌘B)')
    assert.ok(hints.newFile.includes('⌘T'), `새 파일 hint missing ⌘T: ${hints.newFile}`)
    assert.ok(hints.openFolder.includes('⌘⇧O'), `폴더 열기 hint missing ⌘⇧O: ${hints.openFolder}`)
    assert.ok(hints.openFile.includes('⌘O'), `파일 열기 hint missing ⌘O: ${hints.openFile}`)
    assert.equal(hints.guideRows['좌측 패널 표시/숨기기'], '⌘B', 'the shortcuts guide must list ⌘B')
    assert.equal(hints.guideRows['폴더 열기'], '⌘⇧O', 'the shortcuts guide must list ⌘⇧O')
  } finally {
    await closeApp(electronApp)
  }
})
