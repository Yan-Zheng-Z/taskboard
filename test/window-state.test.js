import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SIZE, loadBounds, saveBounds, fitToDisplays } from '../src/widget/window-state.js';
import { useTempHome } from './helpers/tmp-home.js';

const primary = { x: 0, y: 0, width: 1920, height: 1040 };

test('saved bounds come back after a restart', (t) => {
  useTempHome(t);
  saveBounds({ x: 1500, y: 20, width: 360, height: 600 });
  assert.deepEqual(loadBounds(), { x: 1500, y: 20, width: 360, height: 600 });
});

test('loadBounds returns null when nothing was saved or the file is unreadable', (t) => {
  const dir = useTempHome(t);
  assert.equal(loadBounds(), null);
  fs.writeFileSync(path.join(dir, 'widget.json'), 'garbage');
  assert.equal(loadBounds(), null);
  fs.writeFileSync(path.join(dir, 'widget.json'), '{"bounds":{"x":"left"}}');
  assert.equal(loadBounds(), null);
});

test('saveBounds does not touch the task data file', (t) => {
  const dir = useTempHome(t);
  saveBounds({ x: 1, y: 2, width: 300, height: 400 });
  assert.deepEqual(fs.readdirSync(dir), ['widget.json']);
});

test('bounds inside a display are kept as they are', () => {
  const bounds = { x: 1500, y: 20, width: 360, height: 600 };
  assert.deepEqual(fitToDisplays(bounds, [primary]), bounds);
});

test('bounds on a second display are kept', () => {
  const second = { x: 1920, y: 0, width: 1920, height: 1080 };
  const bounds = { x: 2500, y: 100, width: 360, height: 600 };
  assert.deepEqual(fitToDisplays(bounds, [primary, second]), bounds);
});

test('bounds that are off every display fall back to the top-right of the first display', () => {
  const expected = { x: 1920 - DEFAULT_SIZE.width - 24, y: 24, ...DEFAULT_SIZE };
  assert.deepEqual(fitToDisplays({ x: 5000, y: 300, width: 360, height: 600 }, [primary]), expected);
  assert.deepEqual(fitToDisplays(null, [primary]), expected);
});

test('a window that is mostly off-screen is treated as lost', () => {
  const result = fitToDisplays({ x: 1900, y: 1030, width: 360, height: 600 }, [primary]);
  assert.equal(result.y, 24);
});
