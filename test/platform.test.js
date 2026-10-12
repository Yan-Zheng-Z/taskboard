// Behaviour that differs between Windows, macOS and Linux. Only the Windows paths have been
// tried on a real machine; these tests pin down what the other two are meant to do.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { autostartFile, autostartContent, fileAutostart } from '../src/widget/autostart.js';
import { findClaude, commonBinDirs, withCommonPaths } from '../src/widget/organize.js';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskboard-platform-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const launch = { exec: '/Applications/Electron.app/Contents/MacOS/Electron', appDir: '/Users/someone/task board & co' };

// ---- start at login ----

test('macOS start-at-login is a LaunchAgent that runs the app with its directory', () => {
  assert.equal(autostartFile('darwin', '/Users/someone'), path.join('/Users/someone', 'Library', 'LaunchAgents', 'io.github.taskboard.plist'));
  const plist = autostartContent('darwin', launch);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>Label<\/key>\s*<string>io\.github\.taskboard<\/string>/);
  assert.ok(plist.includes(`<string>${launch.exec}</string>`));
  assert.ok(plist.includes('<string>/Users/someone/task board &amp; co</string>'), 'XML-escaped');
  assert.ok(!plist.includes('& co</string>'));
});

test('Linux start-at-login is a desktop entry in the autostart folder', () => {
  assert.equal(autostartFile('linux', '/home/someone'), path.join('/home/someone', '.config', 'autostart', 'taskboard.desktop'));
  const entry = autostartContent('linux', { exec: '/opt/electron/electron', appDir: '/home/someone/my apps/taskboard' });
  assert.match(entry, /^\[Desktop Entry\]/);
  assert.match(entry, /^Type=Application$/m);
  assert.match(entry, /^Exec="\/opt\/electron\/electron" "\/home\/someone\/my apps\/taskboard"$/m);
});

test('Windows has no start-at-login file: the app uses the system login items there', () => {
  assert.equal(autostartFile('win32', 'C:\\Users\\someone'), null);
  assert.equal(fileAutostart({ platform: 'win32', home: 'C:\\Users\\someone', ...launch }), null);
});

for (const platform of ['darwin', 'linux']) {
  test(`${platform}: switching start-at-login on writes the file, off removes it`, (t) => {
    const home = tempDir(t);
    const autostart = fileAutostart({ platform, home, ...launch });
    const file = autostartFile(platform, home);
    assert.equal(autostart.get(), false);
    autostart.set(true);
    assert.equal(autostart.get(), true);
    assert.equal(fs.readFileSync(file, 'utf8'), autostartContent(platform, launch));
    autostart.set(true); // again: no error
    autostart.set(false);
    assert.equal(autostart.get(), false);
    assert.equal(fs.existsSync(file), false);
    autostart.set(false); // already off: no error
  });
}

// ---- finding Claude Code when the app was not started from a terminal ----

const claudeName = process.platform === 'win32' ? 'claude.exe' : 'claude';

test('common install folders are derived from the home directory in the environment', () => {
  const dirs = commonBinDirs({ HOME: '/Users/someone' });
  assert.ok(dirs.includes(path.join('/Users/someone', '.local', 'bin')));
  assert.ok(dirs.includes(path.join('/Users/someone', '.npm-global', 'bin')));
  assert.deepEqual(commonBinDirs({ USERPROFILE: 'C:\\Users\\someone' }).slice(0, 1), [path.join('C:\\Users\\someone', '.local', 'bin')]);
  assert.deepEqual(commonBinDirs({}), [], 'no home known: nothing is guessed');
});

test('Claude Code is found in a common install folder when PATH does not have it', (t) => {
  const home = tempDir(t);
  const bin = path.join(home, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, claudeName), '', { mode: 0o755 });
  assert.equal(findClaude({ PATH: '', HOME: home }), path.join(bin, claudeName));
  assert.equal(findClaude({ PATH: '' }), null);
});

test('PATH is searched before the common folders', (t) => {
  const home = tempDir(t);
  const onPath = path.join(home, 'onpath');
  const common = path.join(home, '.local', 'bin');
  for (const dir of [onPath, common]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, claudeName), '', { mode: 0o755 });
  }
  assert.equal(findClaude({ PATH: onPath, HOME: home }), path.join(onPath, claudeName));
});

test('the agent is started with the common folders added to its PATH, so it can find the task command', () => {
  const env = withCommonPaths({ PATH: ['/usr/bin', '/bin'].join(path.delimiter), HOME: '/Users/someone', OTHER: 'kept' });
  const dirs = env.PATH.split(path.delimiter);
  assert.deepEqual(dirs.slice(0, 2), ['/usr/bin', '/bin'], 'the existing PATH comes first');
  assert.ok(dirs.includes(path.join('/Users/someone', '.local', 'bin')));
  assert.equal(new Set(dirs).size, dirs.length, 'no duplicates');
  assert.equal(env.OTHER, 'kept');
  assert.deepEqual(withCommonPaths({ PATH: '/usr/bin' }), { PATH: '/usr/bin' }, 'nothing added when no home is known');
});
