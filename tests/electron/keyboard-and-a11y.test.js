const test = require('node:test')
const assert = require('node:assert/strict')

const { launchApp, closeApp, stubCloseDialog, getCloseDialogCalls } = require('./helpers/launch')
const {
  BASIC_MD, ROOT_MD, EXPLORER_DIR,
  stubOpenDialog, stubSaveDialog, createTempMarkdown,
  emitFileOpened, emitRendererCommand, clickApplicationMenuItem,
  stubOpenExternal, getOpenExternalCalls,
} = require('./helpers/smoke-helpers')

// Presses Tab (up to `max` times) until the focused element matches `selector`,
// proving the widget is reachable by keyboard without assuming toolbar tab order.
async function tabUntilFocused(page, selector, max = 60) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur())
  for (let i = 0; i < max; i++) {
    if (await page.evaluate(sel => Boolean(document.activeElement?.matches(sel)), selector)) return true
    await page.keyboard.press('Tab')
  }
  return page.evaluate(sel => Boolean(document.activeElement?.matches(sel)), selector)
}

test('toast announces status changes to assistive tech', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    assert.deepEqual(
      await page.locator('#toast').evaluate(el => ({ role: el.getAttribute('role'), ariaLive: el.getAttribute('aria-live') })),
      { role: 'status', ariaLive: 'polite' }
    )
  } finally {
    await closeApp(electronApp)
  }
})

test('holding Cmd flags the body and reveals shortcut badges, clearing on keyup and window blur', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')

    // btn-search is visible + enabled in the empty state, so its ::after box renders.
    const badgeContent = () => page.evaluate(() => {
      const search = document.getElementById('btn-search')
      return getComputedStyle(search, '::after').content
    })
    const bodyHeld = () => page.evaluate(() => document.body.classList.contains('cmd-held'))

    // No badge before Cmd is held.
    assert.equal(await bodyHeld(), false)
    assert.equal(await badgeContent(), 'none')

    // keydown with metaKey true adds the class and surfaces the badge string.
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, bubbles: true }))
    })
    assert.equal(await bodyHeld(), true)
    assert.equal(await badgeContent(), '"⌘F"')

    // keyup once Cmd is no longer held removes the class.
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', metaKey: false, bubbles: true }))
    })
    assert.equal(await bodyHeld(), false)
    assert.equal(await badgeContent(), 'none')

    // Re-hold, then blur the window (Cmd+Tab away never delivers keyup) — must still clear.
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, bubbles: true }))
    })
    assert.equal(await bodyHeld(), true)
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    assert.equal(await bodyHeld(), false)
    assert.equal(await badgeContent(), 'none')
  } finally {
    await closeApp(electronApp)
  }
})

test('active tab scrolls into view when switched to a tab off-screen in #tab-list', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')

    // Enough untitled tabs to overflow #tab-list's fixed-width scroll container.
    const TAB_COUNT = 15
    for (let i = 0; i < TAB_COUNT; i++) {
      await clickApplicationMenuItem(electronApp, '파일', '새 파일')
    }
    await page.waitForFunction(count => document.querySelectorAll('#tab-list .file-tab').length === count, TAB_COUNT)

    const isFirstTabOutOfView = () => page.evaluate(() => {
      const list = document.getElementById('tab-list')
      const first = list.querySelector('.file-tab')
      const listRect = list.getBoundingClientRect()
      const tabRect = first.getBoundingClientRect()
      return tabRect.left < listRect.left || tabRect.right > listRect.right
    })
    assert.equal(await isFirstTabOutOfView(), true, 'expected tabs to overflow #tab-list for this test to be meaningful')

    // Walk back to the first (now off-screen) tab via the same command path the
    // ⌘⇧[ accelerator drives (src/main.js#buildMenu -> switchToPrevTab).
    for (let i = 0; i < TAB_COUNT - 1; i++) {
      await emitRendererCommand(electronApp, 'switchToPrevTab')
    }
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return active && active.textContent.includes('untitled.md') && !active.textContent.includes('untitled-')
    })

    const isActiveTabVisible = await page.evaluate(() => {
      const list = document.getElementById('tab-list')
      const active = list.querySelector('.file-tab.active')
      const listRect = list.getBoundingClientRect()
      const tabRect = active.getBoundingClientRect()
      return tabRect.left >= listRect.left - 1 && tabRect.right <= listRect.right + 1
    })
    assert.equal(isActiveTabVisible, true)
  } finally {
    await closeApp(electronApp)
  }
})

test('clicking an already-visible tab does not scroll #tab-list', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await clickApplicationMenuItem(electronApp, '파일', '새 파일')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 1)
    await clickApplicationMenuItem(electronApp, '파일', '새 파일')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 2)

    const scrollLeftBefore = await page.evaluate(() => document.getElementById('tab-list').scrollLeft)
    await page.locator('#tab-list .file-tab').first().click()
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return active && active.textContent.includes('untitled.md') && !active.textContent.includes('untitled-')
    })
    const scrollLeftAfter = await page.evaluate(() => document.getElementById('tab-list').scrollLeft)
    assert.equal(scrollLeftAfter, scrollLeftBefore)
  } finally {
    await closeApp(electronApp)
  }
})

test('keyboard: Tab reaches the tab bar, arrows move focus only, Enter switches (manual activation)', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 1)

    await stubOpenDialog(electronApp, [ROOT_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return document.querySelectorAll('#tab-list .file-tab').length === 2 && active && active.textContent.includes('root.md')
    })

    // Keep the blocking default-app guide from trapping focus during the Tab walk.
    await emitRendererCommand(electronApp, 'dismissDefaultAppGuide')

    const reached = await tabUntilFocused(page, '#tab-list .file-tab')
    assert.equal(reached, true, 'Tab should land inside the tablist')

    // Tab lands on the roving (active) tab. Record the pre-arrow state.
    const before = await page.evaluate(() => ({
      title: document.title,
      active: document.querySelector('#tab-list .file-tab.active')?.getAttribute('aria-label'),
      focused: document.activeElement?.getAttribute('aria-label'),
    }))
    assert.equal(before.focused, 'root.md')

    // ArrowLeft: focus moves to the other tab, but nothing is activated.
    await page.keyboard.press('ArrowLeft')
    const afterArrow = await page.evaluate(() => ({
      title: document.title,
      active: document.querySelector('#tab-list .file-tab.active')?.getAttribute('aria-label'),
      selectedTrue: document.querySelector('#tab-list [aria-selected="true"]')?.getAttribute('aria-label'),
      focused: document.activeElement?.getAttribute('aria-label'),
    }))
    assert.equal(afterArrow.title, before.title, 'arrow move must not switch the active document')
    assert.equal(afterArrow.active, before.active, 'active tab must be unchanged by arrow move')
    assert.equal(afterArrow.selectedTrue, before.active, 'aria-selected must not follow focus')
    assert.equal(afterArrow.focused, 'basic.md', 'focus should have moved to the other tab')

    // Enter activates the focused tab.
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return document.title === 'basic' && active && active.textContent.includes('basic.md')
    })
  } finally {
    await closeApp(electronApp)
  }
})

test('keyboard: explorer tree is navigable and opens files without a mouse', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [EXPLORER_DIR])
    await emitRendererCommand(electronApp, 'openFolder')
    await page.waitForFunction(() => document.getElementById('explorer-tree').textContent.includes('root.md'))
    await emitRendererCommand(electronApp, 'dismissDefaultAppGuide')

    // Roving tabindex: exactly one visible row is Tab-reachable.
    assert.equal(await page.locator('#explorer-tree .tree-row[tabindex="0"]').count(), 1)

    const reached = await tabUntilFocused(page, '#explorer-tree .tree-row')
    assert.equal(reached, true, 'Tab should land inside the tree')

    // ArrowDown moves focus to another visible row.
    const firstText = await page.evaluate(() => document.activeElement?.textContent)
    await page.keyboard.press('ArrowDown')
    const secondText = await page.evaluate(() => document.activeElement?.textContent)
    assert.notEqual(secondText, firstText, 'ArrowDown should move focus to a different row')
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.matches('.tree-row'))), true)

    // ArrowRight on the nested folder expands it and moves focus into the first child.
    await page.locator('#explorer-tree .tree-row').filter({ hasText: 'nested' }).evaluate(el => el.focus())
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(() => {
      const focused = document.activeElement
      return document.getElementById('explorer-tree').textContent.includes('child.md')
        && focused && focused.matches('.tree-row') && focused.textContent.includes('child.md')
    })

    // Enter on the focused file row opens it.
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return document.title === 'child' && active && active.textContent.includes('child.md')
    })
  } finally {
    await closeApp(electronApp)
  }
})

test('mouse: tab and explorer click paths still work after the keyboard refactor', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')

    // Tabs: clicking a background tab still switches to it.
    await stubOpenDialog(electronApp, [BASIC_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 1)
    await stubOpenDialog(electronApp, [ROOT_MD])
    await emitRendererCommand(electronApp, 'openFile')
    await page.waitForFunction(() => document.querySelectorAll('#tab-list .file-tab').length === 2)

    await page.locator('#tab-list .file-tab').filter({ hasText: 'basic.md' }).click()
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return document.title === 'basic' && active && active.textContent.includes('basic.md')
    })

    // Explorer: clicking a folder expands it and clicking a file opens it.
    await stubOpenDialog(electronApp, [EXPLORER_DIR])
    await emitRendererCommand(electronApp, 'openFolder')
    await page.waitForFunction(() => document.getElementById('explorer-tree').textContent.includes('root.md'))

    await page.locator('#explorer-tree .tree-row').filter({ hasText: 'nested' }).click()
    await page.waitForFunction(() => document.getElementById('explorer-tree').textContent.includes('child.md'))

    await page.locator('#explorer-tree .tree-row').filter({ hasText: 'child.md' }).click()
    await page.waitForFunction(() => {
      const active = document.querySelector('#tab-list .file-tab.active .file-tab-name')
      return document.title === 'child' && active && active.textContent.includes('child.md')
    })
  } finally {
    await closeApp(electronApp)
  }
})
