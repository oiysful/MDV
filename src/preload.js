const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  readFile:        (p)    => ipcRenderer.invoke('read-file', p),
  openFileDialog:  ()     => ipcRenderer.invoke('open-file-dialog'),
  openFolderDialog:()     => ipcRenderer.invoke('open-folder-dialog'),
  listDirectory:   (p)    => ipcRenderer.invoke('list-directory', p),
  saveFile:        (p, c) => ipcRenderer.invoke('save-file', p, c),
  saveFileDialog:  (n)    => ipcRenderer.invoke('save-file-dialog', n),
  newWindow:       (p)    => ipcRenderer.invoke('new-window', p),
  openExternalUrl: (u)    => ipcRenderer.invoke('open-external-url', u),
  revealInFinder:  (p)    => ipcRenderer.invoke('reveal-in-finder', p),
  readImageDataUrl:(p)    => ipcRenderer.invoke('read-image-data-url', p),
  watchFile:       (p)    => ipcRenderer.invoke('watch-file', p),
  unwatchFile:     (p)    => ipcRenderer.invoke('unwatch-file', p),

  onFileChanged: (cb) => ipcRenderer.on('file-changed', (_, data) => cb(data)),
  onFileOpened:  (cb) => ipcRenderer.on('file-opened',  (_, path) => cb(path)),
  onThemeChanged:(cb) => ipcRenderer.on('theme-changed', (_, dark) => cb(dark)),
})
