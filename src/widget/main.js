// Electron main process for the widget.

import { app, Menu, Tray, nativeImage } from 'electron';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createWidgetWindow, connectWindow, keepAliveOnClose } from './window.js';
import { fileAutostart } from './autostart.js';

const appDir = fileURLToPath(new URL('../../', import.meta.url));
const iconFile = fileURLToPath(new URL('../../assets/icon.png', import.meta.url));

let window = null;
let tray = null;
// Redraws the page; set once the window is connected.
let refreshPage = () => {};

function toggleWindow() {
  if (window.isVisible()) {
    window.hide();
  } else {
    window.show();
    window.focus();
  }
}

// Start-at-login launches this Electron binary with the app directory as its argument.
// Windows keeps that in the system login items; macOS and Linux need a file (see autostart.js).
const loginItem = () => ({ path: process.execPath, args: [appDir] });
const autostart = fileAutostart({ platform: process.platform, home: os.homedir(), exec: process.execPath, appDir }) ?? {
  get: () => app.getLoginItemSettings(loginItem()).openAtLogin,
  set: (enabled) => app.setLoginItemSettings({ ...loginItem(), openAtLogin: enabled }),
};

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: toggleWindow },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: autostart.get(),
      click: (item) => {
        autostart.set(item.checked);
        tray.setContextMenu(buildTrayMenu());
        refreshPage(); // the settings page shows the same switch
      },
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);
}

function start() {
  // The widget lives in the menu bar on macOS, like the tray elsewhere: no Dock icon.
  if (process.platform === 'darwin') app.dock?.hide();
  window = createWidgetWindow();
  keepAliveOnClose(window);

  tray = new Tray(nativeImage.createFromPath(iconFile).resize({ width: 16, height: 16 }));
  tray.setToolTip('taskboard');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', toggleWindow);

  // Start-at-login can be switched from the tray menu and from the settings page; keep them in step.
  const stop = connectWindow(window, {
    autostart: {
      get: autostart.get,
      set: (enabled) => {
        autostart.set(enabled);
        tray.setContextMenu(buildTrayMenu());
      },
    },
  });
  refreshPage = stop.refresh;
  app.on('will-quit', stop);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window && !window.isVisible()) toggleWindow();
  });
  // The widget lives in the tray: closing or hiding the window must not quit the app.
  app.on('window-all-closed', () => {});
  app.whenReady().then(start);
}
