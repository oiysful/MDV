const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { ROOT, launchApp } = require('./helpers/launch')

const BASIC_MD = path.join(ROOT, 'tests/fixtures/basic.md')
const EXPLORER_DIR = path.join(ROOT, 'tests/fixtures/explorer')

const REQUIRED_GLOBALS = [
  'openFile',
  'openFolder',
  'saveFile',
  'saveFileAs',
  'toggleSidebar',
  'toggleSource',
  'toggleSearch',
  'copyAll',
  'printDoc',
  'toggleTheme',
  'toggleAddMenu',
  'hideAddMenu',
  'dismissWelcomeGuide',
  'openFromGuide',
  'searchPrev',
  'searchNext',
  'closeSearch',
  'switchTab',
  'toggleExplorerPathInfo',
  'clearExplorerRoot',
  'goTop',
  'copyCode',
]

async function stubOpenDialog(electronApp, filePaths) {
  await electronApp.evaluate(({ dialog }, result) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: result.filePaths,
    })
  }, { filePaths })
}

test('app boots into empty state with expected globals', async () => {
  const { electronApp, page } = await launchApp()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(String(error)))

  try {
    await page.waitForSelector('#empty')
    assert.equal(await page.title(), 'MDV')

    const emptyTitle = await page.textContent('#empty .empty-title')
    assert.match(emptyTitle, /열린 파일 없음/)

    const globals = await page.evaluate(names => {
      return Object.fromEntries(names.map(name => {
        try {
          return [name, typeof eval(name) === 'function']
        } catch {
          return [name, false]
        }
      }))
    }, REQUIRED_GLOBALS)

    for (const name of REQUIRED_GLOBALS) {
      assert.equal(globals[name], true, `${name} should be exposed on window`)
    }

    const depsReady = await page.evaluate(() => ({
      marked: Boolean(window.marked),
      hljs: Boolean(window.hljs),
    }))

    assert.equal(depsReady.marked, true)
    assert.equal(depsReady.hljs, true)
    assert.deepEqual(pageErrors, [])
  } finally {
    await electronApp.close()
  }
})

test('openFile loads markdown, updates title, and renders code highlighting', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [BASIC_MD])
    await page.evaluate(() => openFile())

    await page.waitForFunction(() => document.title === 'basic')
    assert.equal(await page.title(), 'basic')

    const heading = await page.textContent('#content h1')
    assert.match(heading, /Smoke Fixture/)

    const tabText = await page.textContent('#tab-list .file-tab.active .file-tab-name')
    assert.match(tabText, /basic\.md/)

    const codeBlockCount = await page.locator('#content code.hljs').count()
    assert.ok(codeBlockCount > 0)
  } finally {
    await electronApp.close()
  }
})

test('openFolder shows markdown files and hides unsupported or dot-directories', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')
    await stubOpenDialog(electronApp, [EXPLORER_DIR])
    await page.evaluate(() => openFolder())

    await page.waitForFunction(() => {
      const label = document.getElementById('explorer-root-path')
      return Boolean(label && label.textContent && label.textContent.includes('explorer'))
    })

    const treeText = await page.textContent('#explorer-tree')
    assert.match(treeText, /nested/)
    assert.match(treeText, /root\.md/)
    assert.doesNotMatch(treeText, /ignore\.txt/)
    assert.doesNotMatch(treeText, /secret\.md/)
  } finally {
    await electronApp.close()
  }
})

test('toggleTheme cycles theme state and highlight stylesheets', async () => {
  const { electronApp, page } = await launchApp()

  try {
    await page.waitForSelector('#empty')

    const initial = await page.evaluate(() => ({
      theme: localStorage.getItem('theme') || 'auto',
      attr: document.documentElement.getAttribute('data-theme'),
      hlDarkDisabled: document.getElementById('hljs-dark').disabled,
      hlLightDisabled: document.getElementById('hljs-light').disabled,
    }))
    assert.equal(initial.theme, 'auto')

    const afterLight = await page.evaluate(() => {
      toggleTheme()
      return {
        theme: localStorage.getItem('theme'),
        attr: document.documentElement.getAttribute('data-theme'),
        hlDarkDisabled: document.getElementById('hljs-dark').disabled,
        hlLightDisabled: document.getElementById('hljs-light').disabled,
      }
    })
    assert.equal(afterLight.theme, 'light')
    assert.equal(afterLight.attr, 'light')
    assert.equal(afterLight.hlDarkDisabled, true)
    assert.equal(afterLight.hlLightDisabled, false)

    const afterDark = await page.evaluate(() => {
      toggleTheme()
      return {
        theme: localStorage.getItem('theme'),
        attr: document.documentElement.getAttribute('data-theme'),
        hlDarkDisabled: document.getElementById('hljs-dark').disabled,
        hlLightDisabled: document.getElementById('hljs-light').disabled,
      }
    })
    assert.equal(afterDark.theme, 'dark')
    assert.equal(afterDark.attr, 'dark')
    assert.equal(afterDark.hlDarkDisabled, false)
    assert.equal(afterDark.hlLightDisabled, true)

    const afterAuto = await page.evaluate(() => {
      toggleTheme()
      return {
        theme: localStorage.getItem('theme'),
      }
    })
    assert.equal(afterAuto.theme, 'auto')
  } finally {
    await electronApp.close()
  }
})
