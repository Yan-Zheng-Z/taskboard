// Start-at-login on macOS and Linux, where it is a small file in the user's home that
// runs this Electron binary with the app directory. (taskboard runs from source, so the
// system's own "login item" for an app bundle would start a bare Electron.)
// On Windows the app uses the system login items instead; see main.js.
//
// Only the Windows path has been tried on a real machine.

import fs from 'node:fs';
import path from 'node:path';

const LABEL = 'io.github.taskboard';

export function autostartFile(platform, home) {
  if (platform === 'darwin') return path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
  if (platform === 'linux') return path.join(home, '.config', 'autostart', 'taskboard.desktop');
  return null;
}

const xml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function autostartContent(platform, { exec, appDir }) {
  if (platform === 'darwin') {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      '  <key>Label</key>',
      `  <string>${LABEL}</string>`,
      '  <key>ProgramArguments</key>',
      '  <array>',
      `    <string>${xml(exec)}</string>`,
      `    <string>${xml(appDir)}</string>`,
      '  </array>',
      '  <key>RunAtLoad</key>',
      '  <true/>',
      '</dict>',
      '</plist>',
      '',
    ].join('\n');
  }
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=taskboard',
    `Exec="${exec}" "${appDir}"`,
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

// Returns { get, set } for this platform, or null where the system login items are used.
export function fileAutostart({ platform, home, exec, appDir }) {
  const file = autostartFile(platform, home);
  if (!file) return null;
  return {
    get: () => fs.existsSync(file),
    set: (enabled) => {
      if (!enabled) {
        fs.rmSync(file, { force: true });
        return;
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, autostartContent(platform, { exec, appDir }));
    },
  };
}
