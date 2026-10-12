// Creates the widget window. Shared by the app (main.js) and the screenshot script.

import { BrowserWindow, ipcMain, screen } from 'electron';
import { fileURLToPath } from 'node:url';
import { readState, call } from './api.js';
import { watchData } from './watch.js';
import { loadBounds, saveBounds, fitToDisplays } from './window-state.js';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));

export function createWidgetWindow({ show = true } = {}) {
  const displays = screen.getAllDisplays().map((display) => display.workArea);
  const window = new BrowserWindow({
    ...fitToDisplays(loadBounds(), displays),
    minWidth: 280,
    minHeight: 200,
    show,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: here('./preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The window only ever shows its own local page.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  let saveTimer = null;
  const rememberBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!window.isDestroyed()) saveBounds(window.getBounds());
    }, 400);
  };
  window.on('moved', rememberBounds);
  window.on('resized', rememberBounds);

  window.loadFile(here('./renderer/index.html'));
  return window;
}

// Answers the page's requests and pushes fresh state when the data file changes.
// Returns a function that stops watching.
export function connectWindow(window) {
  ipcMain.handle('taskboard:read', () => readState());
  ipcMain.handle('taskboard:call', (_event, method, payload) => call(method, payload));
  ipcMain.on('taskboard:hide', () => window.hide());
  return watchData(() => {
    if (!window.isDestroyed()) window.webContents.send('taskboard:state', readState());
  });
}
