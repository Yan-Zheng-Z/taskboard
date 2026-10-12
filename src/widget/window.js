// Creates the widget window. Shared by the app (main.js) and the screenshot script.

import { app, BrowserWindow, ipcMain, nativeTheme, screen, shell } from 'electron';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readState, call } from './api.js';
import { dataDir } from '../core/store.js';
import { loadSettings, saveSetting } from '../core/settings.js';
import { agentStatuses, installAgentSkill } from './agents.js';
import { watchData } from './watch.js';
import { createOrganizer, claudeLaunch, findClaude } from './organize.js';
import {
  COMPACT_HEIGHT, loadWidgetState, setCompact, windowBounds, rememberWindowBounds,
} from './window-state.js';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));

const packageInfo = JSON.parse(fs.readFileSync(here('../../package.json'), 'utf8'));
const VERSION = packageInfo.version;
// A fixed address: the page can ask to open it, but cannot choose what gets opened.
const REPO_URL = 'https://github.com/zyz122302-lang/taskboard';

const MIN_WIDTH = 280;
const MIN_HEIGHT = 200;

// Collapses the window to a strip or restores it. The strip cannot be resized vertically.
export function applyCompact(window, compact) {
  // Save where the window is now, in the mode it is still in: a move or resize just before
  // the switch may not have been saved yet (saving is debounced).
  rememberWindowBounds(window.getBounds());
  setCompact(compact);
  const displays = screen.getAllDisplays().map((display) => display.workArea);
  window.setMinimumSize(MIN_WIDTH, compact ? COMPACT_HEIGHT : MIN_HEIGHT);
  window.setMaximumSize(0, compact ? COMPACT_HEIGHT : 0); // 0 means no limit
  window.setBounds(windowBounds(displays));
}

export function createWidgetWindow({ show = true } = {}) {
  const displays = screen.getAllDisplays().map((display) => display.workArea);
  const window = new BrowserWindow({
    ...windowBounds(displays),
    minWidth: MIN_WIDTH,
    minHeight: loadWidgetState().compact ? COMPACT_HEIGHT : MIN_HEIGHT,
    maxHeight: loadWidgetState().compact ? COMPACT_HEIGHT : undefined,
    show,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#f6f5f2',
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
      if (!window.isDestroyed()) rememberWindowBounds(window.getBounds());
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
// `autostart` reads and changes start-at-login: { get(): boolean, set(boolean) }. The app passes
// the real one; without it (the screenshot script) the switch does nothing.
export function connectWindow(window, {
  launch = claudeLaunch(findClaude(process.env)),
  autostart = { get: () => false, set: () => {} },
} = {}) {
  // What the settings page shows besides the saved values.
  const settingsView = () => ({
    values: loadSettings(),
    autostart: autostart.get(),
    agents: agentStatuses(process.env),
    dataDir: dataDir(),
    version: VERSION,
    repo: REPO_URL,
  });
  // Everything the page draws: the task data, the organize card and the settings.
  const withOrganize = (state) => ({
    ...state,
    organize: organizer.view(state),
    compact: loadWidgetState().compact,
    settings: settingsView(),
  });
  const push = () => {
    if (!window.isDestroyed()) window.webContents.send('taskboard:state', withOrganize(readState()));
  };
  const organizer = createOrganizer({ launch, env: process.env, onChange: push });

  // Makes the window match the saved settings: colour scheme and staying on top.
  const applySettings = () => {
    const { theme, alwaysOnTop } = loadSettings();
    nativeTheme.themeSource = theme;
    // 'floating' keeps it above maximized and full-screen windows too.
    window.setAlwaysOnTop(alwaysOnTop, 'floating');
  };
  applySettings();

  // Each settings action answers { ok, error?, state } so the page can show what went wrong.
  const answer = (action) => {
    try {
      action();
      return { ok: true, state: withOrganize(readState()) };
    } catch (error) {
      return { ok: false, error: error.message, state: withOrganize(readState()) };
    }
  };
  ipcMain.handle('taskboard:set-setting', (_event, key, value) => answer(() => {
    saveSetting(key, value);
    applySettings();
  }));
  ipcMain.handle('taskboard:set-autostart', (_event, enabled) => answer(() => autostart.set(enabled === true)));
  // The only place that writes into an agent's directory, and only on this explicit request.
  ipcMain.handle('taskboard:install-skill', (_event, id) => answer(() => installAgentSkill(id, process.env)));
  ipcMain.on('taskboard:open-data-folder', () => {
    fs.mkdirSync(dataDir(), { recursive: true });
    shell.openPath(dataDir());
  });
  ipcMain.on('taskboard:open-repo', () => shell.openExternal(REPO_URL));

  ipcMain.handle('taskboard:read', () => withOrganize(readState()));
  ipcMain.handle('taskboard:call', (_event, method, payload) => {
    const result = call(method, payload);
    return { ...result, state: withOrganize(result.state) };
  });
  ipcMain.on('taskboard:hide', () => window.hide());
  ipcMain.on('taskboard:compact', (_event, compact) => {
    applyCompact(window, compact === true);
    push();
  });
  ipcMain.on('taskboard:organize', (_event, action) => {
    if (action === 'open') organizer.open();
    else if (action === 'start') organizer.start();
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
