const path = require('node:path')
const { _electron: electron } = require('playwright')

const electronBinary = require('electron')

const ROOT = path.resolve(__dirname, '../../..')

async function launchApp() {
  const electronApp = await electron.launch({
    executablePath: electronBinary,
    args: ['.'],
    cwd: ROOT,
  })

  const page = await electronApp.firstWindow()
  page.setDefaultTimeout(15000)
  await page.waitForFunction(() => {
    return Boolean(window.api && document.documentElement.dataset.rendererReady === 'true')
  })

  return { electronApp, page }
}

module.exports = {
  ROOT,
  launchApp,
}
