const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sodly', {
  onState: (cb) => ipcRenderer.on('sodly:state', (_e, data) => cb(data)),
  onStray: (cb) => ipcRenderer.on('sodly:stray', (_e, data) => cb(data)),
  onEnded: (cb) => ipcRenderer.on('sodly:ended', (_e, data) => cb(data)),
  onFocusUnlock: (cb) => ipcRenderer.on('sodly:focus-unlock', () => cb()),
  onQuitBlocked: (cb) => ipcRenderer.on('sodly:quit-blocked', () => cb()),
  getState: () => ipcRenderer.invoke('sodly:get-state'),
  requestUnlock: () => ipcRenderer.send('sodly:request-unlock')
});
