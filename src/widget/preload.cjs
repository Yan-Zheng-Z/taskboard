// The only bridge between the page and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taskboard', {
  read: () => ipcRenderer.invoke('taskboard:read'),
  call: (method, payload) => ipcRenderer.invoke('taskboard:call', method, payload),
  hide: () => ipcRenderer.send('taskboard:hide'),
  onState: (listener) => {
    ipcRenderer.on('taskboard:state', (_event, state) => listener(state));
  },
});
