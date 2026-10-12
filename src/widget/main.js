// Electron main process for the widget.

import { app, Menu, Tray, nativeImage } from 'electron';
import { fileURLToPath } from 'node:url';
import { createWidgetWindow, connectWindow } from './window.js';

const appDir = fileURLToPath(new URL('../../', import.meta.url));
const iconFile = fileURLToPath(new URL('../../assets/icon.png', import.meta.url));

let window = null;
let tray = null;

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
      },
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);
}

function start() {
  window = createWidgetWindow();
  // Stay above full-screen and maximized windows too.
  window.setAlwaysOnTop(true, 'floating');

  tray = new Tray(nativeImage.createFromPath(iconFile).resize({ width: 16, height: 16 }));
  tray.setToolTip('taskboard');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', toggleWindow);

  app.on('will-quit', connectWindow(window));
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
