// Creates the widget window. Shared by the app (main.js) and the screenshot script.

import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { fileURLToPath } from 'node:url';
import { readState, call } from './api.js';
import { watchData } from './watch.js';
import { createOrganizer, claudeLaunch, findClaude } from './organize.js';
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
// `launch` says how to start the agent for the one-time organize run; the default is the
// user's Claude Code, or null when it is not installed.
export function connectWindow(window, { launch = claudeLaunch(findClaude(process.env)) } = {}) {
  // Everything the page draws: the task data plus the state of the organize card.
  const withOrganize = (state) => ({ ...state, organize: organizer.view(state) });
  const push = () => {
    if (!window.isDestroyed()) window.webContents.send('taskboard:state', withOrganize(readState()));
  };
  const organizer = createOrganizer({ launch, env: process.env, onChange: push });

  ipcMain.handle('taskboard:read', () => withOrganize(readState()));
  ipcMain.handle('taskboard:call', (_event, method, payload) => {
    const result = call(method, payload);
    return { ...result, state: withOrganize(result.state) };
  });
  ipcMain.on('taskboard:hide', () => window.hide());
  ipcMain.on('taskboard:organize', (_event, action) => {
    if (action === 'start') organizer.start();
    else if (action === 'later') organizer.later();
    else if (action === 'close') organizer.close();
  });
  const stopWatching = watchData(push);
  // "3 days left" goes stale at midnight even when the file never changes.
  const clock = setInterval(push, 60_000);
  return () => {
    clearInterval(clock);
    stopWatching();
    organizer.cancel();
  };
}

// Alt+F4 on the frameless window should hide it, like the "—" button, not destroy it:
// the tray icon needs a window to bring back. Quitting from the tray still closes it.
export function keepAliveOnClose(window) {
  let quitting = false;
  app.on('before-quit', () => { quitting = true; });
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });
}
