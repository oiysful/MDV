const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('api', {
  readFile:        (p)    => ipcRenderer.invoke('read-file', p),
  openFileDialog:  ()     => ipcRenderer.invoke('open-file-dialog'),
  openFolderDialog:()     => ipcRenderer.invoke('open-folder-dialog'),
  listDirectory:   (p)    => ipcRenderer.invoke('list-directory', p),
  saveFile:        (p, c) => ipcRenderer.invoke('save-file', p, c),
  saveFileDialog:  (n)    => ipcRenderer.invoke('save-file-dialog', n),
  exportPdf:       (n)    => ipcRenderer.invoke('export-pdf', n),
  newWindow:       (p)    => ipcRenderer.invoke('new-window', p),
  openExternalUrl: (u)    => ipcRenderer.invoke('open-external-url', u),
  openLocalPath:   (p)    => ipcRenderer.invoke('open-local-path', p),
  revealInFinder:  (p)    => ipcRenderer.invoke('reveal-in-finder', p),
  getMarkdownDefaultAppStatus: () => ipcRenderer.invoke('get-markdown-default-app-status'),
  readImageDataUrl:(p)    => ipcRenderer.invoke('read-image-data-url', p),
  watchFile:       (p)    => ipcRenderer.invoke('watch-file', p),
  unwatchFile:     (p)    => ipcRenderer.invoke('unwatch-file', p),
  setDirtyState:   (isDirty) => ipcRenderer.send('set-dirty-state', isDirty),
  saveSessionState:(state) => ipcRenderer.send('session-state-changed', state),
  addRecentDocument:(p)   => ipcRenderer.invoke('add-recent-document', p),
  getPathForFile:  (file) => webUtils.getPathForFile(file),

  onFileChanged: (cb) => ipcRenderer.on('file-changed', (_, data) => cb(data)),
  onFileOpened:  (cb) => ipcRenderer.on('file-opened',  (_, path) => cb(path)),
  onRestoreSession:(cb) => ipcRenderer.on('restore-session', (_, data) => cb(data)),
  onRendererCommand:(cb) => ipcRenderer.on('renderer-command', (_, command) => cb(command)),
  onThemeChanged:(cb) => ipcRenderer.on('theme-changed', (_, dark) => cb(dark)),
})
