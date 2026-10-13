const { contextBridge, ipcRenderer, webUtils } = require('electron')

// The UI language the main process chose (main.js passes --mdv-locale= through
// additionalArguments). A sandboxed preload can't require the string table, so the check is
// inlined; anything unexpected is Korean, the same default the renderer's i18n.js falls back to.
const localeArg = process.argv.find(arg => arg.startsWith('--mdv-locale='))
const locale = localeArg && localeArg.slice('--mdv-locale='.length) === 'en' ? 'en' : 'ko'

contextBridge.exposeInMainWorld('api', {
  locale,
  readFile:        (p)    => ipcRenderer.invoke('read-file', p),
  openFileDialog:  ()     => ipcRenderer.invoke('open-file-dialog'),
  openFolderDialog:()     => ipcRenderer.invoke('open-folder-dialog'),
  listDirectory:   (p)    => ipcRenderer.invoke('list-directory', p),
  saveFile:        (p, c) => ipcRenderer.invoke('save-file', p, c),
  saveFileDialog:  (n, d) => ipcRenderer.invoke('save-file-dialog', n, d),
  exportPdf:       (n, d) => ipcRenderer.invoke('export-pdf', n, d),
  newWindow:       (p)    => ipcRenderer.invoke('new-window', p),
  openExternalUrl: (u)    => ipcRenderer.invoke('open-external-url', u),
  openLocalPath:   (p)    => ipcRenderer.invoke('open-local-path', p),
  revealInFinder:  (p)    => ipcRenderer.invoke('reveal-in-finder', p),
  getMarkdownDefaultAppStatus: () => ipcRenderer.invoke('get-markdown-default-app-status'),
  readImageDataUrl:(p)    => ipcRenderer.invoke('read-image-data-url', p),
  watchFile:       (p)    => ipcRenderer.invoke('watch-file', p),
  unwatchFile:     (p)    => ipcRenderer.invoke('unwatch-file', p),
  watchDirectory:  (p)    => ipcRenderer.invoke('watch-directory', p),
  unwatchDirectory:(p)    => ipcRenderer.invoke('unwatch-directory', p),
  setDirtyState:   (isDirty) => ipcRenderer.send('set-dirty-state', isDirty),
  saveSessionState:(state) => ipcRenderer.send('session-state-changed', state),
  dismissUpdateNotice: (version) => ipcRenderer.send('dismiss-update-notice', version),
  addRecentDocument:(p)   => ipcRenderer.invoke('add-recent-document', p),
  getPathForFile:  (file) => webUtils.getPathForFile(file),

  onFileChanged: (cb) => ipcRenderer.on('file-changed', (_, data) => cb(data)),
  onDirectoryChanged: (cb) => ipcRenderer.on('directory-changed', (_, data) => cb(data)),
  onDirectoryWatchUnavailable: (cb) => ipcRenderer.on('directory-watch-unavailable', (_, data) => cb(data)),
  onFileOpened:  (cb) => ipcRenderer.on('file-opened',  (_, path) => cb(path)),
  onRestoreSession:(cb) => ipcRenderer.on('restore-session', (_, data) => cb(data)),
  onRendererCommand:(cb) => ipcRenderer.on('renderer-command', (_, command) => cb(command)),
  onThemeChanged:(cb) => ipcRenderer.on('theme-changed', (_, dark) => cb(dark)),
  onFullScreenChanged:(cb) => ipcRenderer.on('fullscreen-changed', (_, fullScreen) => cb(Boolean(fullScreen))),
  onUpdateAvailable:(cb) => ipcRenderer.on('update-available', (_, data) => cb(data)),
})
