// Electron main process for the widget.

import { app, Menu, Tray, nativeImage } from 'electron';
import { fileURLToPath } from 'node:url';
import { createWidgetWindow, connectWindow, keepAliveOnClose } from './window.js';

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
const loginItem = () => ({ path: process.execPath, args: [appDir] });

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: toggleWindow },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: app.getLoginItemSettings(loginItem()).openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ ...loginItem(), openAtLogin: item.checked });
        tray.setContextMenu(buildTrayMenu());
        refreshPage(); // the settings page shows the same switch
      },
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);
}

function start() {
  window = createWidgetWindow();
  keepAliveOnClose(window);

  tray = new Tray(nativeImage.createFromPath(iconFile).resize({ width: 16, height: 16 }));
  tray.setToolTip('taskboard');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', toggleWindow);

  // Start-at-login can be switched from the tray menu and from the settings page; keep them in step.
  const autostart = {
    get: () => app.getLoginItemSettings(loginItem()).openAtLogin,
    set: (enabled) => {
      app.setLoginItemSettings({ ...loginItem(), openAtLogin: enabled });
      tray.setContextMenu(buildTrayMenu());
    },
  };
  const stop = connectWindow(window, { autostart });
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
