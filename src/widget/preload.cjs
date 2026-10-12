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
  // Settings. Each of the first three answers { ok, error?, state }.
  setSetting: (key, value) => ipcRenderer.invoke('taskboard:set-setting', key, value),
  setAutostart: (enabled) => ipcRenderer.invoke('taskboard:set-autostart', enabled),
  installSkill: (agentId) => ipcRenderer.invoke('taskboard:install-skill', agentId),
  openDataFolder: () => ipcRenderer.send('taskboard:open-data-folder'),
  openRepo: () => ipcRenderer.send('taskboard:open-repo'),
  onState: (listener) => {
    ipcRenderer.on('taskboard:state', (_event, state) => listener(state));
  },
});
