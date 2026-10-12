import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPACT_HEIGHT, loadWidgetState, setCompact, saveBounds, loadBounds, windowBounds, rememberWindowBounds, markOrganizeOffered,
} from '../src/widget/window-state.js';
import { useTempHome } from './helpers/tmp-home.js';

const display = [{ x: 0, y: 0, width: 1920, height: 1040 }];
const expanded = { x: 1500, y: 20, width: 360, height: 600 };

test('the widget starts expanded on a fresh install', (t) => {
  useTempHome(t);
  assert.equal(loadWidgetState().compact, false);
});

test('the compact setting is remembered and does not disturb other widget state', (t) => {
  useTempHome(t);
  saveBounds(expanded);
  markOrganizeOffered();
  setCompact(true);
  assert.deepEqual(loadWidgetState(), { organizeOffered: true, compact: true });
  assert.deepEqual(loadBounds(), expanded);
  setCompact(false);
  assert.equal(loadWidgetState().compact, false);
});

test('expanded, the window uses its saved bounds', (t) => {
  useTempHome(t);
  saveBounds(expanded);
  assert.deepEqual(windowBounds(display), expanded);
});

test('compact, the window keeps its position and width but is only a strip high', (t) => {
  useTempHome(t);
  saveBounds(expanded);
  setCompact(true);
  assert.deepEqual(windowBounds(display), { x: 1500, y: 20, width: 360, height: COMPACT_HEIGHT });
});

test('moving the strip keeps the expanded size for later', (t) => {
  useTempHome(t);
  saveBounds(expanded);
  setCompact(true);
  rememberWindowBounds({ x: 900, y: 300, width: 360, height: COMPACT_HEIGHT });
  assert.deepEqual(loadBounds(), { x: 900, y: 300, width: 360, height: 600 });
  setCompact(false);
  assert.deepEqual(windowBounds(display), { x: 900, y: 300, width: 360, height: 600 });
});

test('moving or resizing the expanded window is saved as is', (t) => {
  useTempHome(t);
  saveBounds(expanded);
  rememberWindowBounds({ x: 10, y: 10, width: 400, height: 700 });
  assert.deepEqual(loadBounds(), { x: 10, y: 10, width: 400, height: 700 });
});

test('a strip that was never expanded on this machine expands to the default size', (t) => {
  useTempHome(t);
  setCompact(true);
  const strip = windowBounds(display);
  assert.equal(strip.height, COMPACT_HEIGHT);
  rememberWindowBounds({ ...strip, x: 100, y: 100 });
  setCompact(false);
  const full = windowBounds(display);
  assert.deepEqual([full.x, full.y], [100, 100]);
  assert.ok(full.height > COMPACT_HEIGHT * 3);
});
