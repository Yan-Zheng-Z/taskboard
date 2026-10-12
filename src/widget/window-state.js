// The widget's own state: where its window was, and whether the one-time organize card
// has been offered. Kept apart from the task data file.

import { readLocalState as readFile, writeLocalState as writeFile } from '../core/local-state.js';

export const DEFAULT_SIZE = { width: 340, height: 520 };
export const COMPACT_HEIGHT = 44;
const MARGIN = 24;
// A window counts as visible only if at least this much of it is on a display.
const MIN_VISIBLE = { width: 120, height: 80 };


function isBounds(value) {
  return value !== null && typeof value === 'object'
    && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key]))
    && value.width > 0 && value.height > 0;
}


export function loadWidgetState() {
  const stored = readFile();
  return { organizeOffered: stored.organizeOffered === true, compact: stored.compact === true };
}

// Compact: the window is collapsed to a strip that shows only the next task.
export function setCompact(compact) {
  writeFile({ compact });
}

export function markOrganizeOffered() {
  writeFile({ organizeOffered: true });
}

export function loadBounds() {
  const { bounds } = readFile();
  return isBounds(bounds) ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null;
}

export function saveBounds(bounds) {
  writeFile({ bounds });
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

// Where and how big the window should be right now. The saved bounds are always the
// expanded ones; the strip borrows their position and width.
export function windowBounds(displays) {
  const expanded = fitToDisplays(loadBounds(), displays);
  return loadWidgetState().compact ? { ...expanded, height: COMPACT_HEIGHT } : expanded;
}

// Called when the user moves or resizes the window. Moving the strip must not
// replace the expanded height it will return to.
export function rememberWindowBounds(bounds) {
  if (!loadWidgetState().compact) {
    saveBounds(bounds);
    return;
  }
  const height = loadBounds()?.height ?? DEFAULT_SIZE.height;
  saveBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height });
}
