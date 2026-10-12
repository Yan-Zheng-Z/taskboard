// Calls onChange shortly after the task data file changes on disk.
// Watches the directory, not the file: writers replace the file, which would
// silently detach a watcher on the file itself. A slow poll covers missed events.

import fs from 'node:fs';
import path from 'node:path';
import { dataDir, dataFile } from '../core/store.js';

const DEBOUNCE_MS = 200;
const POLL_MS = 5000;

function modifiedAt() {
  try {
    return fs.statSync(dataFile()).mtimeMs;
  } catch {
    return 0;
  }
}

export function watchData(onChange) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const fileName = path.basename(dataFile());
  let lastSeen = modifiedAt();
  let timer = null;

  const check = () => {
    const current = modifiedAt();
    if (current === lastSeen) return;
    lastSeen = current;
    onChange();
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(check, DEBOUNCE_MS);
  };

  let watcher = null;
  try {
    watcher = fs.watch(dataDir(), (_event, changed) => {
      if (!changed || changed === fileName) schedule();
    });
    watcher.on('error', () => {});
  } catch {
    // Polling below still picks up changes.
  }
  const poll = setInterval(check, POLL_MS);

  return () => {
    clearTimeout(timer);
    clearInterval(poll);
    watcher?.close();
  };
}
