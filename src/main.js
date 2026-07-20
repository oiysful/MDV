const { app, BrowserWindow, ipcMain, dialog, nativeTheme, Menu, shell } = require('electron')
const path = require('path')
const fs   = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')
const chokidar = require('chokidar')

const watchers = new Map() // path → { watcher: chokidar.FSWatcher, subscribers: Set<WebContents> }
const dirtyState = new Map() // BrowserWindow.id → boolean (미저장 변경 존재 여부)
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
      sandbox: true,
    },
  })

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  // The renderer holds `window.api`, so it must never navigate away from the local
  // shell: any remote page loaded into this frame would inherit that bridge. The
  // in-app link handler already routes clicks to the OS browser; these are the
  // backstops for anything that slips past it.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors)
    if (filePath) {
      sendFile(win, filePath)
    }
  })

  // 미저장 변경이 있으면 창을 닫기 전에 확인. 동기 다이얼로그를 쓰고
  // '닫기'를 고르면 preventDefault 하지 않아, ⌘Q 종료 루프가 다음 창으로
  // 자연스럽게 이어진다('취소'만 종료를 중단).
  win.on('close', (event) => {
    if (!dirtyState.get(win.id)) return
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['닫기', '취소'],
      defaultId: 1,
      cancelId: 1,
      message: '저장하지 않은 변경이 있습니다.',
      detail: '변경 내용을 저장하지 않고 창을 닫으시겠습니까?',
    })
    if (choice === 1) event.preventDefault()
  })

  win.on('closed', () => {
    dirtyState.delete(win.id)
  })

  return win
}

async function sendFile(win, filePath) {
  try {
    const content  = await fs.promises.readFile(filePath, 'utf-8')
    const filename = path.basename(filePath)
    if (!win.isDestroyed()) win.webContents.send('file-opened', JSON.stringify({ content, filename, path: filePath }))
  } catch (e) {
    if (!win.isDestroyed()) win.webContents.send('file-opened', JSON.stringify({ error: e.message }))
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
    const focused = BrowserWindow.getFocusedWindow()
    if (focused && !focused.webContents.isLoading()) {
      sendFile(focused, filePath)
      return
    }
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
    const content  = await fs.promises.readFile(filePath, 'utf-8')
    const filename = path.basename(filePath)
    return JSON.stringify({ content, filename, path: filePath })
  } catch (e) {
    // 저장 전 충돌 검사가 "삭제됨"(ENOENT)과 "읽을 수 없음"(EACCES 등)을
    // 구분해야 하므로 코드도 함께 넘긴다.
    return JSON.stringify({ error: e.message, code: e.code })
  }
})

ipcMain.handle('open-file-dialog', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  })
  if (result.canceled) return JSON.stringify({ cancelled: true })
  const files = await Promise.all(result.filePaths.map(async fp => {
    try {
      return { content: await fs.promises.readFile(fp, 'utf-8'), filename: path.basename(fp), path: fp }
    } catch (e) {
      return { error: e.message }
    }
  }))
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
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
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
    await fs.promises.writeFile(filePath, content, 'utf-8')
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

// Opens a link that points at a local file. `open-external-url`'s ^https?:// whitelist
// stays intact for web links; this is the separate path for schemeless (relative/absolute)
// targets the renderer resolves to an absolute filesystem path. Markdown files are read
// and returned (same shape as read-file) so the renderer can open them as a new tab —
// main cannot call the renderer's createTab directly. Everything else is handed to the OS
// default app via shell.openPath. A missing target gets a distinct "not found" error so it
// is never confused with the "not allowed" scheme rejection above.
ipcMain.handle('open-local-path', async (_, targetPath) => {
  try {
    if (!targetPath) {
      return JSON.stringify({ ok: false, error: '경로가 없습니다.' })
    }
    let stat
    try {
      stat = await fs.promises.stat(targetPath)
    } catch {
      return JSON.stringify({ ok: false, error: `파일을 찾을 수 없습니다: ${targetPath}` })
    }
    const ext = path.extname(targetPath).toLowerCase()
    if (stat.isFile() && MARKDOWN_EXTENSIONS.includes(ext)) {
      const content = await fs.promises.readFile(targetPath, 'utf-8')
      return JSON.stringify({ ok: true, kind: 'markdown', content, filename: path.basename(targetPath), path: targetPath })
    }
    const openError = await shell.openPath(targetPath)
    if (openError) return JSON.stringify({ ok: false, error: openError })
    return JSON.stringify({ ok: true, kind: 'external' })
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

const IMAGE_MIME_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
}

// 마크다운의 이미지 경로는 신뢰할 수 없는 입력이다. 예전에는 확장자와 무관하게
// 아무 파일이나 읽어 data URL로 만들었기 때문에 ![](../../.ssh/id_rsa) 같은
// 임의 파일 읽기가 가능했다. 알려진 이미지 확장자만 허용한다.
ipcMain.handle('read-image-data-url', async (_, filePath) => {
  try {
    const ext  = path.extname(filePath).slice(1).toLowerCase()
    const mime = IMAGE_MIME_TYPES[ext]
    if (!mime) {
      return JSON.stringify({ ok: false, error: `Unsupported image type: .${ext || '(none)'}` })
    }
    const data = await fs.promises.readFile(filePath)
    return JSON.stringify({ ok: true, data_url: `data:${mime};base64,${data.toString('base64')}` })
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.message })
  }
})

function removeWatchSubscriber(filePath, wc) {
  const entry = watchers.get(filePath)
  if (!entry) return
  entry.subscribers.delete(wc)
  if (entry.subscribers.size === 0) {
    entry.watcher.close()
    watchers.delete(filePath)
  }
}

// 탭을 바꿀 때마다 unwatch+watch가 호출되므로, 경로마다 'destroyed' 리스너를
// 달면 창 하나에 리스너가 무한히 쌓인다. WebContents당 한 번만 등록해서
// 파괴될 때 그 창의 모든 구독을 한 번에 정리한다.
const sweepRegistered = new WeakSet()

function registerWatchSweep(wc) {
  if (sweepRegistered.has(wc)) return
  sweepRegistered.add(wc)
  wc.once('destroyed', () => {
    for (const filePath of [...watchers.keys()]) removeWatchSubscriber(filePath, wc)
  })
}

// filePath 하나에 여러 창(WebContents)이 구독할 수 있다. 마지막 구독자가
// 빠질 때만 워처를 닫는다.
ipcMain.handle('watch-file', async (event, filePath) => {
  const wc = event.sender
  registerWatchSweep(wc)
  const existing = watchers.get(filePath)
  if (existing) {
    existing.subscribers.add(wc)
    return
  }

  const watcher = chokidar.watch(filePath, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 200 } })
  const notify = async (changeEvent) => {
    const entry = watchers.get(filePath)
    if (!entry) return
    let content = null
    if (changeEvent !== 'unlink') {
      try {
        content = await fs.promises.readFile(filePath, 'utf-8')
      } catch {
        return
      }
    }
    for (const sub of entry.subscribers) {
      if (!sub.isDestroyed()) sub.send('file-changed', { path: filePath, content, event: changeEvent })
    }
  }
  watcher.on('change', () => notify('change'))
  watcher.on('add',    () => notify('add'))
  watcher.on('unlink', () => notify('unlink'))

  watchers.set(filePath, { watcher, subscribers: new Set([wc]) })
})

ipcMain.handle('unwatch-file', async (event, filePath) => {
  removeWatchSubscriber(filePath, event.sender)
})

ipcMain.on('set-dirty-state', (event, isDirty) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) dirtyState.set(win.id, !!isDirty)
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
          label: '새 파일',
          accelerator: 'CmdOrCtrl+T',
          click: (_, win) => sendRendererCommand('newFile', win),
        },
        {
          label: '탭 닫기',
          accelerator: 'CmdOrCtrl+W',
          click: (_, win) => sendRendererCommand('closeCurrentTab', win),
        },
        { type: 'separator' },
        {
          label: 'PDF로 내보내기…',
          click: (_, win) => sendRendererCommand('exportPdf', win),
        },
        {
          label: '인쇄…',
          accelerator: 'CmdOrCtrl+P',
          click: (_, win) => sendRendererCommand('printDoc', win),
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
        { type: 'separator' },
        {
          label: '찾기…',
          accelerator: 'CmdOrCtrl+F',
          click: (_, win) => sendRendererCommand('toggleSearch', win),
        },
      ],
    },
    {
      label: '보기',
      submenu: [
        {
          label: '소스 보기',
          accelerator: 'CmdOrCtrl+U',
          click: (_, win) => sendRendererCommand('toggleSource', win),
        },
        {
          label: '분할뷰',
          accelerator: 'CmdOrCtrl+\\',
          click: (_, win) => sendRendererCommand('toggleSplitView', win),
        },
        {
          label: '테마 전환',
          click: (_, win) => sendRendererCommand('toggleTheme', win),
        },
        { type: 'separator' },
        {
          label: '다음 탭',
          accelerator: 'CmdOrCtrl+Shift+]',
          click: (_, win) => sendRendererCommand('switchToNextTab', win),
        },
        {
          label: '이전 탭',
          accelerator: 'CmdOrCtrl+Shift+[',
          click: (_, win) => sendRendererCommand('switchToPrevTab', win),
        },
        { type: 'separator' },
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
    {
      label: '도움말',
      submenu: [
        {
          label: '단축키',
          click: (_, win) => sendRendererCommand('showShortcuts', win),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
