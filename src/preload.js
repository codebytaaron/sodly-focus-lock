const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lockdown', {
  onState: (cb) => ipcRenderer.on('lockdown:state', (_e, data) => cb(data)),
  onStray: (cb) => ipcRenderer.on('lockdown:stray', (_e, data) => cb(data)),
  onEnded: (cb) => ipcRenderer.on('lockdown:ended', (_e, data) => cb(data)),
  onFocusUnlock: (cb) => ipcRenderer.on('lockdown:focus-unlock', () => cb()),
  getState: () => ipcRenderer.invoke('lockdown:get-state'),
  requestUnlock: () => ipcRenderer.send('lockdown:request-unlock')
});
