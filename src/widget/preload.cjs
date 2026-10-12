// The only bridge between the page and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taskboard', {
  read: () => ipcRenderer.invoke('taskboard:read'),
  call: (method, payload) => ipcRenderer.invoke('taskboard:call', method, payload),
  hide: () => ipcRenderer.send('taskboard:hide'),
  // true collapses the window to a strip, false restores it
  setCompact: (compact) => ipcRenderer.send('taskboard:compact', compact),
  // action: 'open' | 'start' | 'later' | 'close' — the "organize from conversations" card
  organize: (action) => ipcRenderer.send('taskboard:organize', action),
  onState: (listener) => {
    ipcRenderer.on('taskboard:state', (_event, state) => listener(state));
  },
});
