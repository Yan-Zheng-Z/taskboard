// Remembers where the widget window was. Kept apart from the task data file.

import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../core/store.js';

export const DEFAULT_SIZE = { width: 340, height: 520 };
const MARGIN = 24;
// A window counts as visible only if at least this much of it is on a display.
const MIN_VISIBLE = { width: 120, height: 80 };

const stateFile = () => path.join(dataDir(), 'widget.json');

function isBounds(value) {
  return value !== null && typeof value === 'object'
    && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key]))
    && value.width > 0 && value.height > 0;
}

export function loadBounds() {
  try {
    const { bounds } = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    return isBounds(bounds) ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null;
  } catch {
    return null;
  }
}

export function saveBounds(bounds) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(stateFile(), `${JSON.stringify({ bounds }, null, 2)}\n`);
}

function overlap(a, b) {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

// Returns the saved bounds if enough of the window is on some display,
// otherwise the default spot at the top-right of the first display.
export function fitToDisplays(bounds, displays) {
  const visible = isBounds(bounds) && displays.some((display) => {
    const shared = overlap(bounds, display);
    return shared.width >= MIN_VISIBLE.width && shared.height >= MIN_VISIBLE.height;
  });
  if (visible) return bounds;
  const [first] = displays;
  return {
    x: first.x + first.width - DEFAULT_SIZE.width - MARGIN,
    y: first.y + MARGIN,
    ...DEFAULT_SIZE,
  };
}
