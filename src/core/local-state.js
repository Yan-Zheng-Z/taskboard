// The small file next to the task data that holds what is local to this machine and
// this user: the window's position, and their settings. Not task data, so it is kept apart
// from it, and losing it only resets preferences.

import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './store.js';

const stateFile = () => path.join(dataDir(), 'widget.json');

// Returns the stored object, or an empty one when the file is missing or unreadable.
export function readLocalState() {
  try {
    const stored = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    return stored !== null && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  } catch {
    return {};
  }
}

// Merges the given top-level keys into the file and leaves the others as they are.
export function writeLocalState(changes) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(stateFile(), `${JSON.stringify({ ...readLocalState(), ...changes }, null, 2)}\n`);
}
