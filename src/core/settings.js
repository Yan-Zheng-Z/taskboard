// User settings, shared by the window and the command line.

import { TaskError } from './model.js';
import { readLocalState, writeLocalState } from './local-state.js';

export const DIGEST_AGENTS = ['claude', 'deepseek'];

export const DEFAULT_SETTINGS = {
  theme: 'system', // 'system' | 'light' | 'dark'
  alwaysOnTop: true,
  archiveDays: 7, // how long finished tasks stay visible in the archive: 7 | 14 | 30
  digestAgents: [...DIGEST_AGENTS], // whose conversations "organize" may read
  digestDays: 7, // how far back it reads: 3 | 7 | 14
};

const oneOf = (...choices) => (value) => (choices.includes(value) ? value : undefined);

// Each returns the cleaned value, or undefined when the value is not an allowed choice.
const CLEANERS = new Map(Object.entries({
  theme: oneOf('system', 'light', 'dark'),
  alwaysOnTop: (value) => (typeof value === 'boolean' ? value : undefined),
  archiveDays: oneOf(7, 14, 30),
  digestDays: oneOf(3, 7, 14),
  digestAgents: (value) => {
    if (!Array.isArray(value) || value.length === 0 || !value.every((agent) => DIGEST_AGENTS.includes(agent))) return undefined;
    return DIGEST_AGENTS.filter((agent) => value.includes(agent)); // no duplicates, fixed order
  },
}));

// A stored value that is not an allowed choice (a hand-edited file) falls back to its default.
export function loadSettings() {
  const stored = readLocalState().settings;
  const source = stored !== null && typeof stored === 'object' ? stored : {};
  const settings = {};
  for (const [key, clean] of CLEANERS) {
    settings[key] = clean(source[key]) ?? DEFAULT_SETTINGS[key];
  }
  return settings;
}

// Saves one setting and returns all of them. Refuses unknown names and values.
export function saveSetting(key, value) {
  const clean = CLEANERS.get(key);
  if (!clean) throw new TaskError(`unknown setting "${key}"`);
  const cleaned = clean(value);
  if (cleaned === undefined) throw new TaskError(`"${JSON.stringify(value)}" is not a valid value for the setting "${key}"`);
  const settings = { ...loadSettings(), [key]: cleaned };
  writeLocalState({ settings });
  return settings;
}
