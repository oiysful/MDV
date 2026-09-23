const { app, BrowserWindow, ipcMain, dialog, nativeTheme, Menu, shell, net } = require('electron')
const path = require('path')
const fs   = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')
const chokidar = require('chokidar')
const { isEmptySession } = require('./renderer/session-state')
const { normalizeTag, shouldNotify } = require('./update-checker')
const { pollRootsFromEnv, watchOptionsFor } = require('./watch-options')

// Tests point this at a throwaway directory so the suite never reads or clobbers the
// real user's session.json. Must run before app 'ready', which module-load time satisfies.
if (process.env.MDV_USER_DATA_DIR) {
  app.setPath('userData', process.env.MDV_USER_DATA_DIR)
}

const watchers = new Map() // path → { watcher: chokidar.FSWatcher, subscribers: Set<WebContents> }
const dirWatchers = new Map() // dirPath → { watcher: chokidar.FSWatcher, subscribers: Set<WebContents>, debounceTimer }
// Test-only introspection: a test asserting exactly which paths a directory watch actually
// covers (depth/ignore behavior) needs real chokidar state, not simulated IPC -- and live
// fs-event delivery timing under the Electron test harness is not reliable enough to assert
// against directly. Only exposed under the same env var launchApp() already uses to mark an
// isolated test run (never set for a real user launch).
if (process.env.MDV_USER_DATA_DIR) globalThis.__mdvDirWatchers = dirWatchers
// Same guard, same reason: the file-watcher error path is only observable as "this path is
// no longer watched", and asserting that needs the live map.
if (process.env.MDV_USER_DATA_DIR) globalThis.__mdvFileWatchers = watchers
const dirtyState = new Map() // BrowserWindow.id → boolean (미저장 변경 존재 여부)
const sessionState = new Map() // BrowserWindow.id → { tabs, activeIndex, explorerRoot } (렌더러가 통지한 최신 상태)
let lastFocusedWindowId = null
const MARKDOWN_EXTENSIONS = ['.md', '.markdown']

// ── Session persistence ──────────────────────────────────────────
function getSessionFilePath() {
  return path.join(app.getPath('userData'), 'session.json')
}

function readSavedSession() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getSessionFilePath(), 'utf-8'))
    if (!parsed || typeof parsed !== 'object') return null
    const tabs = Array.isArray(parsed.tabs) ? parsed.tabs.filter(p => typeof p === 'string') : []
    const explorerRoot = typeof parsed.explorerRoot === 'string' ? parsed.explorerRoot : null
    const activeIndex = Number.isInteger(parsed.activeIndex) ? parsed.activeIndex : 0
    const session = { tabs, activeIndex, explorerRoot }
    return isEmptySession(session) ? null : session
  } catch {
    return null
  }
}

function writeSession(session) {
  if (isEmptySession(session)) return // 빈 세션은 절대 기록하지 않는다 — 저장된 세션을 지우지 않도록.
  try {
    fs.writeFileSync(getSessionFilePath(), JSON.stringify(session), 'utf-8')
  } catch {
    // 세션 저장 실패는 조용히 무시 — 사용자 작업을 막을 이유가 없다.
  }
}

// v1 model: persist the last-focused window's state. If that window is a blank Cmd+N
// window (empty), fall back to any other non-empty window so opening/closing a blank
// window never wipes a real session.
function persistSession() {
  let state = sessionState.get(lastFocusedWindowId)
  if (isEmptySession(state)) {
    for (const candidate of sessionState.values()) {
      if (!isEmptySession(candidate)) { state = candidate; break }
    }
  }
  writeSession(state)
}

// ── Update check (notify-only) ───────────────────────────────────
// See docs/plans/15-in-app-update-notification.md. This checks GitHub Releases and shows
// an in-app banner pointing at `brew upgrade --cask oiysful/tap/mdv` — it never downloads
// or applies an update itself (the app is unsigned, so Electron's autoUpdater can't apply
// one anyway; see the plan doc for why).
const GITHUB_REPO_OWNER = process.env.MDV_REPO_OWNER || 'oiysful'
const GITHUB_REPO_NAME = process.env.MDV_REPO_NAME || 'MDV'
const UPDATE_CHECK_URL = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`
const UPDATE_CHECK_MAX_BODY_BYTES = 1_000_000
const UPDATE_CHECK_TIMEOUT_MS = 10_000
const UPDATE_CHECK_STARTUP_DELAY_MS = 5000
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24h -- throttles the network call, not the banner (see maybeCheckForUpdate)

let cachedUpdateInfo = null // { version, tagName, releaseUrl } | null -- process-lifetime only, re-sent to windows created after the startup check

function getUpdateCheckFilePath() {
  return path.join(app.getPath('userData'), 'update-check.json')
}

function readUpdateCheckState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getUpdateCheckFilePath(), 'utf-8'))
    if (!parsed || typeof parsed !== 'object') return { lastCheckedAt: 0, latestVersion: null, latestTag: null, dismissedVersion: null }
    return {
      lastCheckedAt: Number.isFinite(parsed.lastCheckedAt) ? parsed.lastCheckedAt : 0,
      latestVersion: typeof parsed.latestVersion === 'string' ? parsed.latestVersion : null,
      // The raw GitHub tag string (e.g. "v1.3.0", or "1.3.0" with no prefix on a repo that
      // doesn't use one) -- kept alongside the normalized latestVersion so the release URL
      // can be built from the tag GitHub actually published, not a reconstructed guess.
      latestTag: typeof parsed.latestTag === 'string' ? parsed.latestTag : null,
      dismissedVersion: typeof parsed.dismissedVersion === 'string' ? parsed.dismissedVersion : null,
    }
  } catch {
    return { lastCheckedAt: 0, latestVersion: null, latestTag: null, dismissedVersion: null }
  }
}

function writeUpdateCheckState(state) {
  try {
    fs.writeFileSync(getUpdateCheckFilePath(), JSON.stringify(state), 'utf-8')
  } catch {
    // 업데이트 체크 상태 저장 실패는 조용히 무시 -- session.json과 동일 정책.
  }
}

function releaseUrlForTag(tagName) {
  return `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/tag/${tagName}`
}

// Every failure path (offline, non-200, timeout, oversized body, malformed JSON, missing
// tag_name) resolves null -- a background check must never surface an error to the user.
function fetchLatestReleaseTag() {
  return new Promise(resolve => {
    let settled = false
    const finish = value => { if (!settled) { settled = true; resolve(value) } }
    try {
      const request = net.request({ method: 'GET', url: UPDATE_CHECK_URL })
      request.setHeader('User-Agent', `MDV/${app.getVersion()}`)
      request.setHeader('Accept', 'application/vnd.github+json')
      const timer = setTimeout(() => { request.abort(); finish(null) }, UPDATE_CHECK_TIMEOUT_MS)
      request.on('response', response => {
        if (response.statusCode !== 200) { clearTimeout(timer); response.destroy?.(); finish(null); return }
        let body = ''
        let overflowed = false
        response.on('data', chunk => {
          if (overflowed) return
          body += chunk
          if (body.length > UPDATE_CHECK_MAX_BODY_BYTES) { overflowed = true; request.abort() }
        })
        response.on('end', () => {
          clearTimeout(timer)
          if (overflowed) { finish(null); return }
          try {
            const parsed = JSON.parse(body)
            finish(typeof parsed?.tag_name === 'string' ? { tagName: parsed.tag_name } : null)
          } catch {
            finish(null)
          }
        })
      })
      request.on('error', () => { clearTimeout(timer); finish(null) })
      request.end()
    } catch {
      finish(null)
    }
  })
}

function broadcastUpdateAvailable(info) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.webContents.isDestroyed()) w.webContents.send('update-available', info)
  })
}

async function maybeCheckForUpdate() {
  if (process.env.MDV_TEST_SKIP_UPDATE_CHECK) return
  const state = readUpdateCheckState()
  const now = Date.now()

  if (now - state.lastCheckedAt < UPDATE_CHECK_INTERVAL_MS) {
    // Throttled: skip the network call, but still re-evaluate the last known result so the
    // banner reappears on every relaunch inside the 24h window, not just the one that fetched.
    if (state.latestVersion && state.latestTag && shouldNotify({ latestVersion: state.latestVersion, currentVersion: app.getVersion(), dismissedVersion: state.dismissedVersion })) {
      cachedUpdateInfo = { version: state.latestVersion, tagName: state.latestTag, releaseUrl: releaseUrlForTag(state.latestTag) }
      broadcastUpdateAvailable(cachedUpdateInfo)
    }
    return
  }

  // lastCheckedAt is written before the fetch: a crash/hang mid-request must not turn into
  // an every-launch retry -- losing one day's check to a transient network blip is fine.
  writeUpdateCheckState({ ...state, lastCheckedAt: now })

  const release = await fetchLatestReleaseTag()
  if (!release) return
  const latestVersion = normalizeTag(release.tagName)
  if (!latestVersion) return

  writeUpdateCheckState({ lastCheckedAt: now, latestVersion, latestTag: release.tagName, dismissedVersion: state.dismissedVersion })

  if (!shouldNotify({ latestVersion, currentVersion: app.getVersion(), dismissedVersion: state.dismissedVersion })) return
  // The release page URL is built from the tag GitHub actually published (release.tagName),
  // not a reconstructed "v" + version -- a repo without a "v" prefix (confirmed against
  // sass/dart-sass's "1.102.0" tag during manual verification) would otherwise 404.
  cachedUpdateInfo = { version: latestVersion, tagName: release.tagName, releaseUrl: releaseUrlForTag(release.tagName) }
  broadcastUpdateAvailable(cachedUpdateInfo)
}

// ── Window factory ──────────────────────────────────────────────
function createWindow(filePath = null, restoredSession = null) {
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
    // Same ^https?:// whitelist as the open-external-url handler — a window.open() with a
    // file:/// or custom-scheme target must not be handed to the OS just because it took
    // this path instead of the IPC one. Anything else is dropped; the deny below stands
    // either way, so nothing ever loads into a frame that holds window.api.
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  // Native fullscreen hides the traffic lights, so the renderer drops .traffic-gap.
  let lastFullScreen = null
  const sendFullScreenState = (force = false) => {
    const fullScreen = win.isFullScreen()
    if (!force && fullScreen === lastFullScreen) return
    lastFullScreen = fullScreen
    win.webContents.send('fullscreen-changed', fullScreen)
  }
  win.on('enter-full-screen', () => sendFullScreenState())
  win.on('leave-full-screen', () => sendFullScreenState())
  // resize arrives ~30-40ms into the transition with isFullScreen() already flipped, while
  // enter/leave-full-screen only fire after the ~0.6s macOS animation. Hook it for the leave
  // direction only: the gap must be restored before the traffic lights reappear. Entering,
  // the lights are still drawn through the animation, so an early collapse would overlap
  // #btn-add for ~0.6s.
  win.on('resize', () => { if (!win.isFullScreen()) sendFullScreenState() })

  // did-finish-load fires on every load (including page.reload()), so restore is gated
  // behind a one-shot flag — otherwise a reload would resurrect tabs closed since launch.
  let sessionRestored = false
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors)
    sendFullScreenState(true)
    if (cachedUpdateInfo) win.webContents.send('update-available', cachedUpdateInfo)
    if (filePath) {
      sendFile(win, filePath)
    } else if (restoredSession && !sessionRestored) {
      sessionRestored = true
      win.webContents.send('restore-session', restoredSession)
    }
  })

  lastFocusedWindowId = win.id
  win.on('focus', () => { lastFocusedWindowId = win.id })

  // 미저장 변경이 있으면 창을 닫기 전에 확인. 동기 다이얼로그를 쓰고
  // '닫기'를 고르면 preventDefault 하지 않아, ⌘Q 종료 루프가 다음 창으로
  // 자연스럽게 이어진다('취소'만 종료를 중단).
  win.on('close', (event) => {
    if (dirtyState.get(win.id)) {
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning',
        buttons: ['닫기', '취소'],
        defaultId: 1,
        cancelId: 1,
        message: '저장하지 않은 변경이 있습니다.',
        detail: '변경 내용을 저장하지 않고 창을 닫으시겠습니까?',
      })
      if (choice === 1) {
        event.preventDefault()
        return
      }
    }
    // Window close fires reliably (including under the test harness); before-quit is the
    // backstop for a quit that doesn't route through a window close.
    persistSession()
  })

  win.on('closed', () => {
    dirtyState.delete(win.id)
    sessionState.delete(win.id)
  })

  return win
}

async function sendFile(win, filePath) {
  try {
    const content  = await fs.promises.readFile(filePath, 'utf-8')
    const filename = path.basename(filePath)
    if (!win.isDestroyed()) win.webContents.send('file-opened', { content, filename, path: filePath })
  } catch (e) {
    if (!win.isDestroyed()) win.webContents.send('file-opened', { error: e.message })
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
  // Without this, the native About panel (Dock right-click, or the app-menu "About MDV"
  // role item) falls back to Electron's own defaults -- Electron's icon/name/version
  // instead of MDV's. app.getVersion() reads package.json's "version" at build time via
  // electron-builder, so this always matches the running app, never a hardcoded string.
  app.setAboutPanelOptions({
    applicationName: 'MDV',
    applicationVersion: app.getVersion(),
    iconPath: path.join(__dirname, '..', 'assets', 'icon.icns'),
  })
  buildMenu()
  // An OS file-open (double-click) launch has a clear intent — restore is skipped so an
  // old session doesn't pile on top of the file the user asked to open. Restore is only
  // ever handed to this first startup window, never to Cmd+N / activate / new-window.
  const restoredSession = pendingFilePath ? null : readSavedSession()
  createWindow(pendingFilePath, restoredSession)
  pendingFilePath = null

  // Deferred well past first paint (see docs/plans/15-in-app-update-notification.md) --
  // this app's own performance-diet history (mermaid/katex/session-tab lazy loading) is the
  // reason nothing runs synchronously here. Once per app launch, not per window.
  setTimeout(() => { maybeCheckForUpdate().catch(() => {}) }, UPDATE_CHECK_STARTUP_DELAY_MS)

  nativeTheme.on('updated', () => {
    BrowserWindow.getAllWindows().forEach(w => {
      w.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors)
    })
  })
})

app.on('before-quit', () => {
  persistSession()
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
    return { content, filename, path: filePath }
  } catch (e) {
    // 저장 전 충돌 검사가 "삭제됨"(ENOENT)과 "읽을 수 없음"(EACCES 등)을
    // 구분해야 하므로 코드도 함께 넘긴다.
    return { error: e.message, code: e.code }
  }
})

ipcMain.handle('open-file-dialog', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  })
  if (result.canceled) return { cancelled: true }
  const files = await Promise.all(result.filePaths.map(async fp => {
    try {
      return { content: await fs.promises.readFile(fp, 'utf-8'), filename: path.basename(fp), path: fp }
    } catch (e) {
      return { error: e.message }
    }
  }))
  return { files }
})

ipcMain.handle('open-folder-dialog', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
  })
  if (result.canceled) return { cancelled: true }
  return { path: result.filePaths[0] }
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
    return { entries: result }
  } catch (e) {
    return { error: e.message }
  }
})

ipcMain.handle('save-file', async (_, filePath, content) => {
  try {
    await fs.promises.writeFile(filePath, content, 'utf-8')
    return { ok: true, filename: path.basename(filePath) }
  } catch (e) {
    return { error: e.message }
  }
})

ipcMain.handle('save-file-dialog', async (event, suggestedName) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showSaveDialog(win, {
    defaultPath: suggestedName || 'untitled.md',
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  })
  if (result.canceled) return { cancelled: true }
  return { path: result.filePath }
})

ipcMain.handle('export-pdf', async (event, suggestedName) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return { ok: false, error: '활성 창을 찾을 수 없습니다.' }

  try {
    const result = await dialog.showSaveDialog(win, {
      defaultPath: suggestedName || 'untitled.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (result.canceled || !result.filePath) return { cancelled: true }

    const data = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      generateTaggedPDF: true,
    })
    await fs.promises.writeFile(result.filePath, data)
    return { ok: true, path: result.filePath, filename: path.basename(result.filePath) }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('new-window', async (_, filePath) => {
  createWindow(filePath || null)
})

ipcMain.handle('open-external-url', async (_, url) => {
  try {
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: '허용되지 않은 링크입니다.' }
    }
    await shell.openExternal(url)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// Non-markdown link targets that may be handed to the OS default app: documents, images
// and office files only. A markdown document is untrusted input, so a link like
// [Setup](./setup.command) must never reach shell.openPath — one click would run local
// code (macOS Gatekeeper quarantine only covers *downloaded* files, so a git clone slips
// through). Everything outside this list is revealed in Finder instead of opened.
// .svg is deliberately excluded: unlike the other raster formats, it can carry an
// embedded <script> and shell.openPath would hand it to the OS default handler (typically
// a browser) at a file:// origin. Local SVGs already render inertly in-app as data: URIs
// via read-image-data-url, so no *embedding* functionality is lost -- but a link
// [icon](./icon.svg) now reveals in Finder instead of opening, which is the accepted
// tradeoff (a link handing an active-content format to an external app is exactly what
// this allowlist exists to stop).
const OPENABLE_EXTENSIONS = [
  '.pdf', '.txt', '.csv',
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.docx', '.xlsx', '.pptx',
]

// stat()/extname() only see the link's own name, but shell.openPath opens whatever the
// link resolves to — so `notes.pdf` symlinked at `setup.command` would pass a name-only
// check. Both the link name and its realpath must be allowlisted.
function isOpenableTarget(targetPath, realPath) {
  const named = path.extname(targetPath).toLowerCase()
  const real  = path.extname(realPath).toLowerCase()
  return OPENABLE_EXTENSIONS.includes(named) && OPENABLE_EXTENSIONS.includes(real)
}

// Opens a link that points at a local file. `open-external-url`'s ^https?:// whitelist
// stays intact for web links; this is the separate path for schemeless (relative/absolute)
// targets the renderer resolves to an absolute filesystem path. Markdown files are read
// and returned (same shape as read-file) so the renderer can open them as a new tab —
// main cannot call the renderer's createTab directly. Allowlisted files are handed to the
// OS default app via shell.openPath; everything else (including directories, which on
// macOS covers .app bundles) only gets shell.showItemInFolder. A missing target gets a
// distinct "not found" error so it is never confused with the rejections above.
ipcMain.handle('open-local-path', async (_, targetPath) => {
  try {
    if (!targetPath) {
      return { ok: false, error: '경로가 없습니다.' }
    }
    let stat
    try {
      stat = await fs.promises.stat(targetPath)
    } catch {
      return { ok: false, error: `파일을 찾을 수 없습니다: ${targetPath}` }
    }
    // realpath failure (broken/looping symlink) is treated exactly like a non-allowlisted
    // target: reveal, never open or read. Resolved before the markdown check below so a
    // symlink named notes.md pointing at an arbitrary file (e.g. ~/.ssh/id_rsa) can't be
    // read just because its own name ends in .md.
    let realPath = null
    try {
      realPath = await fs.promises.realpath(targetPath)
    } catch {
      realPath = null
    }
    const ext = path.extname(targetPath).toLowerCase()
    const realExt = realPath ? path.extname(realPath).toLowerCase() : ''
    if (
      stat.isFile() &&
      realPath &&
      MARKDOWN_EXTENSIONS.includes(ext) &&
      MARKDOWN_EXTENSIONS.includes(realExt)
    ) {
      const content = await fs.promises.readFile(realPath, 'utf-8')
      // path is deliberately the symlink (targetPath), not realPath: it becomes the tab's
      // identity for save/reveal/watch, and those should act on what the user actually
      // clicked. Content alone comes from the resolved target.
      return { ok: true, kind: 'markdown', content, filename: path.basename(targetPath), path: targetPath }
    }
    if (!stat.isFile() || !realPath || !isOpenableTarget(targetPath, realPath)) {
      shell.showItemInFolder(targetPath)
      return { ok: true, kind: 'revealed' }
    }
    const openError = await shell.openPath(realPath)
    if (openError) return { ok: false, error: openError }
    return { ok: true, kind: 'external' }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('reveal-in-finder', async (_, targetPath) => {
  try {
    if (!targetPath) {
      return { ok: false, error: '경로가 없습니다.' }
    }
    shell.showItemInFolder(targetPath)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('get-markdown-default-app-status', async () => {
  const appPath = getComparableAppPath(app.getPath('exe'))
  // The real check below shells out to the OS (spawns temp files, queries Launch Services)
  // and is unawaited by the renderer's own init (app.js's `void checkMarkdownDefaultAppStatus()`),
  // so a test that doesn't care about the first-launch guide can still race it: on a slow/loaded
  // machine the guide can pop up and intercept a click mid-test. Tests set this env var (via
  // launchApp's default) to skip the real check entirely and get a deterministic "already
  // registered" response instead, matching what a real user with MDV already set as default sees.
  if (process.env.MDV_TEST_SKIP_DEFAULT_APP_CHECK) {
    return {
      ok: true,
      registered: true,
      needsAction: false,
      canVerify: true,
      canRegisterAutomatically: false,
      platform: process.platform,
      isPackaged: app.isPackaged,
      appName: app.name,
      appPath,
      extensions: MARKDOWN_EXTENSIONS,
      defaultHandlers: [],
      associationConfigured: true,
      reason: 'test-mode-check-skipped',
    }
  }
  try {
    const { handlers, registered } = await getDefaultMarkdownHandlers()
    return {
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
    }
  } catch (e) {
    return {
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
    }
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
//
// 확장자는 링크 자신의 이름과 realpath 양쪽에서 확인한다. extname()은 링크 이름만 보는데
// readFile()은 심링크를 따라가므로, ~/.ssh/id_rsa를 가리키는 photo.png 심링크가 이름만
// 보는 검사를 그대로 통과한다 — open-local-path의 isOpenableTarget()이 막는 것과 정확히
// 같은 우회다(`notes.pdf → setup.command`). 읽기도 realpath로 하는데, 그래야 검사와 읽기
// 사이에 심링크가 바뀌는 TOCTOU가 남지 않는다. realpath 실패(끊어진/순환 심링크)는
// 허용목록 밖과 동일하게 거부한다. mime은 실제 대상의 확장자에서 가져온다 — 이름이
// 무엇이든 바이트의 정체를 따르는 쪽이 맞다.
ipcMain.handle('read-image-data-url', async (_, filePath) => {
  try {
    const named = path.extname(filePath).slice(1).toLowerCase()
    if (!IMAGE_MIME_TYPES[named]) {
      return { ok: false, error: `Unsupported image type: .${named || '(none)'}` }
    }
    let realPath
    try {
      realPath = await fs.promises.realpath(filePath)
    } catch {
      return { ok: false, error: `Image not found: ${filePath}` }
    }
    const real = path.extname(realPath).slice(1).toLowerCase()
    const mime = IMAGE_MIME_TYPES[real]
    if (!mime) {
      return { ok: false, error: `Unsupported image type: .${real || '(none)'}` }
    }
    const data = await fs.promises.readFile(realPath)
    return { ok: true, data_url: `data:${mime};base64,${data.toString('base64')}` }
  } catch (e) {
    return { ok: false, error: e.message }
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

function removeDirWatchSubscriber(dirPath, wc) {
  const entry = dirWatchers.get(dirPath)
  if (!entry) return
  entry.subscribers.delete(wc)
  if (entry.subscribers.size === 0) {
    clearTimeout(entry.debounceTimer)
    entry.watcher.close()
    dirWatchers.delete(dirPath)
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
    for (const dirPath of [...dirWatchers.keys()]) removeDirWatchSubscriber(dirPath, wc)
  })
}

// node_modules/.git/any dot-prefixed directory, plus common build/output directories, are
// excluded so opening a large repo root doesn't spin up tens of thousands of watchers --
// that would make the debounce below meaningless under real event volume. chokidar has no
// fsevents fast path here (confirmed against node_modules/chokidar/handler.js: it keys a
// plain FsWatchInstances map and calls fs.watch() per directory on every platform, macOS
// included), so an unfiltered deep tree means one native watch handle per directory found.
const DIR_WATCH_IGNORED = /(^|[\\/])(node_modules|dist|build|out|coverage|target|vendor|\.[^\\/]+)([\\/]|$)/
const DIR_WATCH_DEBOUNCE_MS = 300
// The explorer tree already re-reads a folder's contents on demand when it's expanded
// (list-directory, one level per call) -- this watcher only needs to catch changes shallow
// enough that the user is likely looking at them without having to toggle the folder.
// Deeper external changes are picked up the next time that folder is collapsed/re-expanded.
const DIR_WATCH_DEPTH = 1
// Safety net for a pathologically flat/large root (e.g. a photo library, or a container
// directory like ~/projects holding several repos) that DIR_WATCH_IGNORED/DEPTH don't catch.
// Once the number of distinct paths chokidar has looked at while watching a root crosses
// this, watching that root is abandoned entirely rather than let the scan keep growing.
// Overridable so a test can trip the guard without actually creating tens of thousands of
// files, matching the MDV_TEST_SKIP_DEFAULT_APP_CHECK precedent below.
const DIR_WATCH_MAX_PATHS = Number(process.env.MDV_TEST_DIR_WATCH_MAX_PATHS) || 20000
// Paths under these roots get chokidar's poll backend instead of a kqueue vnode watch,
// which is what keeps a vanishing volume from aborting the process. See watch-options.js.
const WATCH_POLL_ROOTS = pollRootsFromEnv(process.env)

// chokidar's `ignored` option accepts a function `(path, stats) => boolean` alongside
// regex/glob/string forms (see its own watch() JSDoc) and is queried for both the initial
// recursive scan and later fs events -- a directory this returns true for is never
// recursed into (readdirp's directoryFilter), so it doubles as the recursion cutoff the
// count guard needs. `seen` dedupes because the same path can be re-queried across the
// initial scan and subsequent watch events, which would otherwise inflate a raw call count.
function makeGuardedIgnore(baseRegex, maxPaths, onOverflow) {
  const seen = new Set()
  let overflowed = false
  return (candidatePath) => {
    if (baseRegex.test(candidatePath)) return true
    if (overflowed) return true
    seen.add(candidatePath)
    if (seen.size > maxPaths) {
      overflowed = true
      onOverflow()
      return true
    }
    return false
  }
}

ipcMain.handle('watch-directory', async (event, dirPath) => {
  try {
    const stat = await fs.promises.stat(dirPath)
    if (!stat.isDirectory()) return { error: 'Not a directory' }
  } catch (e) {
    return { error: e.message }
  }

  const wc = event.sender
  registerWatchSweep(wc)
  const existing = dirWatchers.get(dirPath)
  if (existing) {
    existing.subscribers.add(wc)
    return {}
  }

  const entry = { watcher: null, subscribers: new Set([wc]), debounceTimer: null, ready: false }
  const notify = () => {
    for (const sub of entry.subscribers) {
      if (!sub.isDestroyed()) sub.send('directory-changed', { path: dirPath })
    }
  }
  const scheduleNotify = () => {
    clearTimeout(entry.debounceTimer)
    entry.debounceTimer = setTimeout(notify, DIR_WATCH_DEBOUNCE_MS)
  }
  // Both the path-count guard and a watcher error end here: stop watching this root and tell
  // the renderer it has to fall back to on-demand reads (the explorer already re-reads a
  // folder when it's expanded). Guarded so a second call is a no-op -- the guard can trip
  // while an error teardown is already done. An overflow that fires before this entry is
  // registered leaves the watcher inert instead of throwing on `entry.watcher.close()`; that
  // ordering has never been observed, because chokidar's scan is async and reaches the ignore
  // predicate after chokidar.watch() has returned.
  const dropDirWatch = (reason) => {
    if (dirWatchers.get(dirPath) !== entry) return
    clearTimeout(entry.debounceTimer)
    entry.watcher.close()
    dirWatchers.delete(dirPath)
    for (const sub of entry.subscribers) {
      if (!sub.isDestroyed()) sub.send('directory-watch-unavailable', { path: dirPath, reason })
    }
  }

  const watcher = chokidar.watch(dirPath, watchOptionsFor(dirPath, WATCH_POLL_ROOTS, {
    ignoreInitial: true,
    ignored: makeGuardedIgnore(DIR_WATCH_IGNORED, DIR_WATCH_MAX_PATHS, () => dropDirWatch('overflow')),
    depth: DIR_WATCH_DEPTH,
  }))
  // An EventEmitter 'error' with no listener throws, and this one is on the main process's
  // emitter -- so the listener itself is the fix, whatever it then does. chokidar swallows the
  // codes that mean "the path is gone" (ENOENT/ENOTDIR, plus EPERM/EACCES under its default
  // ignorePermissionErrors, see its index.js _handleError), so what reaches here is the
  // EMFILE/ENOSPC class: descriptor or kernel-queue exhaustion, where one root's watch is
  // beyond saving but the app is not.
  watcher.on('error', (error) => {
    console.error(`디렉토리 워처 오류 (${dirPath}):`, error && error.code ? error.code : error)
    dropDirWatch('error')
  })
  watcher.on('add', scheduleNotify)
  watcher.on('unlink', scheduleNotify)
  watcher.on('addDir', scheduleNotify)
  watcher.on('unlinkDir', scheduleNotify)
  // This handler's own IPC response doesn't wait for the initial scan to settle (chokidar's
  // depth-limited readdirp walk can take a moment on a large root, and there's nothing the
  // caller needs to block on) -- entry.ready records it anyway so anything that does care
  // whether the scan has finished (e.g. a test asserting exactly which paths ended up
  // watched) has something deterministic to poll for.
  watcher.once('ready', () => { entry.ready = true })

  entry.watcher = watcher
  dirWatchers.set(dirPath, entry)
  return {}
})

ipcMain.handle('unwatch-directory', async (event, dirPath) => {
  removeDirWatchSubscriber(dirPath, event.sender)
})

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

  const watcher = chokidar.watch(filePath, watchOptionsFor(filePath, WATCH_POLL_ROOTS, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200 },
  }))
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
  // See the directory watcher's error listener for what actually reaches here. Dropping the
  // entry is the recovery path rather than a surrender: the renderer re-issues watch-file for
  // the active tab on every tab switch (that's why removeWatchSubscriber is reference-counted
  // at all), so the next switch rebuilds a fresh watcher for this path.
  watcher.on('error', (error) => {
    console.error(`파일 워처 오류 (${filePath}):`, error && error.code ? error.code : error)
    if (watchers.get(filePath)?.watcher !== watcher) return
    watcher.close()
    watchers.delete(filePath)
  })

  watchers.set(filePath, { watcher, subscribers: new Set([wc]) })
})

ipcMain.handle('unwatch-file', async (event, filePath) => {
  removeWatchSubscriber(filePath, event.sender)
})

ipcMain.on('set-dirty-state', (event, isDirty) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) dirtyState.set(win.id, !!isDirty)
})

// Dismissing in one window hides the banner in every window (null payload = hide).
ipcMain.on('dismiss-update-notice', (_event, version) => {
  if (typeof version !== 'string') return
  const state = readUpdateCheckState()
  writeUpdateCheckState({ ...state, dismissedVersion: version })
  cachedUpdateInfo = null
  broadcastUpdateAvailable(null)
})

// The renderer pushes its latest session shape here (debounced on its side). Main only
// mirrors it in memory per window; the actual disk write happens at close/quit.
ipcMain.on('session-state-changed', (event, state) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) sessionState.set(win.id, state)
})

ipcMain.handle('add-recent-document', (_, filePath) => {
  if (filePath) app.addRecentDocument(filePath)
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
          accelerator: 'CmdOrCtrl+Shift+O',
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
          label: '좌측 패널 표시/숨기기',
          accelerator: 'CmdOrCtrl+B',
          // A real ⌘B press also reaches the source editor's own keydown (bold) -- menu
          // accelerators fire even when the renderer preventDefault()s (fb2284d's ⌘T
          // double-fire). The shortcut variant lets the renderer skip the toggle when the
          // editor owns the key; a mouse click on the menu item always toggles.
          click: (_, win, event) => sendRendererCommand(
            event?.triggeredByAccelerator ? 'toggleSidebarFromShortcut' : 'toggleSidebar', win),
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
