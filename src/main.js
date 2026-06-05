const { app, BrowserWindow, ipcMain, dialog, nativeTheme, Menu, shell } = require('electron')
const path = require('path')
const fs   = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')
const chokidar = require('chokidar')

const watchers = new Map() // path → chokidar.FSWatcher
const MARKDOWN_EXTENSIONS = ['.md', '.markdown']

// ── Window factory ──────────────────────────────────────────────
function createWindow(filePath = null) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 700,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors)
    if (filePath) {
      sendFile(win, filePath)
    }
  })

  return win
}

function sendFile(win, filePath) {
  try {
    const content  = fs.readFileSync(filePath, 'utf-8')
    const filename = path.basename(filePath)
    win.webContents.send('file-opened', JSON.stringify({ content, filename, path: filePath }))
  } catch (e) {
    win.webContents.send('file-opened', JSON.stringify({ error: e.message }))
  }
}

function getComparableAppPath(appPath) {
  if (process.platform !== 'darwin') return appPath
  const bundleMatch = String(appPath || '').match(/^(.+?\.app)(?:\/|$)/)
  return bundleMatch ? bundleMatch[1] : appPath
}

async function getDefaultMarkdownHandlers() {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mdv-default-app-'))
  try {
    const handlers = []
    const currentAppPath = getComparableAppPath(app.getPath('exe'))
    for (const extension of MARKDOWN_EXTENSIONS) {
      const samplePath = path.join(tempDir, `sample${extension}`)
      await fs.promises.writeFile(samplePath, '# MDV default app check\n', 'utf8')
      const info = await app.getApplicationInfoForProtocol(pathToFileURL(samplePath).href)
      const handlerPath = getComparableAppPath(info.path)
      handlers.push({
        extension,
        name: info.name || '',
        path: info.path || '',
        matchesCurrentApp: handlerPath === currentAppPath,
      })
    }
    return { handlers, registered: handlers.every(handler => handler.matchesCurrentApp) }
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  }
}

// ── App lifecycle ────────────────────────────────────────────────
let pendingFilePath = null

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (app.isReady()) {
    const wins = BrowserWindow.getAllWindows()
    const idle = wins.find(w => !w.webContents.isLoading())
    if (idle) {
      sendFile(idle, filePath)
    } else {
      createWindow(filePath)
    }
  } else {
    pendingFilePath = filePath
  }
})

app.whenReady().then(() => {
  buildMenu()
  createWindow(pendingFilePath)
  pendingFilePath = null

  nativeTheme.on('updated', () => {
    BrowserWindow.getAllWindows().forEach(w => {
      w.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors)
    })
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// ── IPC handlers ─────────────────────────────────────────────────
ipcMain.handle('read-file', async (_, filePath) => {
  try {
    const content  = fs.readFileSync(filePath, 'utf-8')
    const filename = path.basename(filePath)
    return JSON.stringify({ content, filename, path: filePath })
  } catch (e) {
    return JSON.stringify({ error: e.message })
  }
})

ipcMain.handle('open-file-dialog', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  })
  if (result.canceled) return JSON.stringify({ cancelled: true })
  const files = result.filePaths.map(fp => {
    try {
      return { content: fs.readFileSync(fp, 'utf-8'), filename: path.basename(fp), path: fp }
    } catch (e) {
      return { error: e.message }
    }
  })
  return JSON.stringify({ files })
})

ipcMain.handle('open-folder-dialog', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
  })
  if (result.canceled) return JSON.stringify({ cancelled: true })
  return JSON.stringify({ path: result.filePaths[0] })
})

ipcMain.handle('list-directory', async (_, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    const result = []
    const dirs  = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'))
    const files = entries.filter(e => e.isFile() && /\.(md|markdown)$/i.test(e.name))
    dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    ;[...dirs, ...files].forEach(e => {
      result.push({ name: e.name, path: path.join(dirPath, e.name), type: e.isDirectory() ? 'dir' : 'file' })
    })
    return JSON.stringify({ entries: result })
  } catch (e) {
    return JSON.stringify({ error: e.message })
  }
})

ipcMain.handle('save-file', async (_, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8')
    return JSON.stringify({ ok: true, filename: path.basename(filePath) })
  } catch (e) {
    return JSON.stringify({ error: e.message })
  }
})

ipcMain.handle('save-file-dialog', async (event, suggestedName) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showSaveDialog(win, {
    defaultPath: suggestedName || 'untitled.md',
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  })
  if (result.canceled) return JSON.stringify({ cancelled: true })
  return JSON.stringify({ path: result.filePath })
})

ipcMain.handle('export-pdf', async (event, suggestedName) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return JSON.stringify({ ok: false, error: '활성 창을 찾을 수 없습니다.' })

  try {
    const result = await dialog.showSaveDialog(win, {
      defaultPath: suggestedName || 'untitled.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (result.canceled || !result.filePath) return JSON.stringify({ cancelled: true })

    const data = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      generateTaggedPDF: true,
    })
    await fs.promises.writeFile(result.filePath, data)
    return JSON.stringify({ ok: true, path: result.filePath, filename: path.basename(result.filePath) })
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.message })
  }
})

ipcMain.handle('new-window', async (_, filePath) => {
  createWindow(filePath || null)
})

ipcMain.handle('open-external-url', async (_, url) => {
  try {
    if (!/^https?:\/\//i.test(url)) {
      return JSON.stringify({ ok: false, error: '허용되지 않은 링크입니다.' })
    }
    await shell.openExternal(url)
    return JSON.stringify({ ok: true })
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.message })
  }
})

ipcMain.handle('reveal-in-finder', async (_, targetPath) => {
  try {
    if (!targetPath) {
      return JSON.stringify({ ok: false, error: '경로가 없습니다.' })
    }
    shell.showItemInFolder(targetPath)
    return JSON.stringify({ ok: true })
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.message })
  }
})

ipcMain.handle('get-markdown-default-app-status', async () => {
  const appPath = getComparableAppPath(app.getPath('exe'))
  try {
    const { handlers, registered } = await getDefaultMarkdownHandlers()
    return JSON.stringify({
      ok: true,
      registered,
      needsAction: !registered,
      canVerify: true,
      canRegisterAutomatically: false,
      platform: process.platform,
      isPackaged: app.isPackaged,
      appName: app.name,
      appPath,
      extensions: MARKDOWN_EXTENSIONS,
      defaultHandlers: handlers,
      associationConfigured: true,
      reason: registered ? 'current-app-is-default-handler' : 'default-handler-is-different-app',
    })
  } catch (e) {
    return JSON.stringify({
      ok: false,
      registered: false,
      needsAction: true,
      canVerify: false,
      canRegisterAutomatically: false,
      platform: process.platform,
      isPackaged: app.isPackaged,
      appName: app.name,
      appPath,
      extensions: MARKDOWN_EXTENSIONS,
      defaultHandlers: [],
      associationConfigured: true,
      reason: 'file-extension-default-apps-require-os-settings',
      error: e.message,
    })
  }
})

ipcMain.handle('read-image-data-url', async (_, filePath) => {
  try {
    const data    = fs.readFileSync(filePath)
    const ext     = path.extname(filePath).slice(1).toLowerCase()
    const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }
    const mime    = mimeMap[ext] || 'image/png'
    return JSON.stringify({ ok: true, data_url: `data:${mime};base64,${data.toString('base64')}` })
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.message })
  }
})

ipcMain.handle('watch-file', async (event, filePath) => {
  if (watchers.has(filePath)) return
  const sender = event.sender
  const watcher = chokidar.watch(filePath, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 200 } })
  watcher.on('change', () => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      if (!sender.isDestroyed()) sender.send('file-changed', { path: filePath, content })
    } catch {}
  })
  watchers.set(filePath, watcher)
})

ipcMain.handle('unwatch-file', async (_, filePath) => {
  const w = watchers.get(filePath)
  if (w) { w.close(); watchers.delete(filePath) }
})

// ── Menu ─────────────────────────────────────────────────────────
function sendRendererCommand(command, targetWindow = BrowserWindow.getFocusedWindow()) {
  const win = targetWindow || BrowserWindow.getFocusedWindow()
  if (!win || win.webContents.isDestroyed()) return
  win.webContents.send('renderer-command', command)
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '파일',
      submenu: [
        {
          label: '파일 열기…',
          accelerator: 'CmdOrCtrl+O',
          click: (_, win) => sendRendererCommand('openFile', win),
        },
        {
          label: '폴더 열기…',
          click: (_, win) => sendRendererCommand('openFolder', win),
        },
        { type: 'separator' },
        {
          label: '저장',
          accelerator: 'CmdOrCtrl+S',
          click: (_, win) => sendRendererCommand('saveFile', win),
        },
        {
          label: '다른 이름으로 저장…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: (_, win) => sendRendererCommand('saveFileAs', win),
        },
        { type: 'separator' },
        {
          label: '새 창',
          accelerator: 'CmdOrCtrl+N',
          click: () => createWindow(),
        },
      ],
    },
    {
      label: '편집',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '보기',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '창',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
