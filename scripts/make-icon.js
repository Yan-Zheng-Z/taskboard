// Generates assets/icon.png (the tray icon): a rounded square with three progress bars.
// Run with: node scripts/make-icon.js

import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SIZE = 64;
const BACKGROUND = [37, 99, 235, 255];
const TRACK = [255, 255, 255, 90];
const FILL = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];
const RADIUS = 14;
// [top, filled width] for each bar; every bar's track spans x 12..52.
const BARS = [[16, 40], [29, 26], [42, 12]];

function insideRoundedSquare(x, y) {
  const cx = Math.min(Math.max(x, RADIUS), SIZE - 1 - RADIUS);
  const cy = Math.min(Math.max(y, RADIUS), SIZE - 1 - RADIUS);
  return (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2;
}

function pixel(x, y) {
  if (!insideRoundedSquare(x, y)) return CLEAR;
  for (const [top, filled] of BARS) {
    if (y >= top && y < top + 7 && x >= 12 && x < 52) return x < 12 + filled ? FILL : TRACK;
  }
  return BACKGROUND;
}

function blend([r, g, b, a]) {
  // Tracks are drawn as translucent white over the background colour.
  if (a === 255 || a === 0) return [r, g, b, a];
  const mix = (top, bottom) => Math.round((top * a + bottom * (255 - a)) / 255);
  return [mix(r, BACKGROUND[0]), mix(g, BACKGROUND[1]), mix(b, BACKGROUND[2]), 255];
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([length, body, crc]);
}

const rows = [];
for (let y = 0; y < SIZE; y += 1) {
  const row = [0]; // filter type: none
  for (let x = 0; x < SIZE; x += 1) row.push(...blend(pixel(x, y)));
  rows.push(Buffer.from(row));
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
  chunk('IEND', Buffer.alloc(0)),
]);

const target = fileURLToPath(new URL('../assets/icon.png', import.meta.url));
fs.mkdirSync(fileURLToPath(new URL('../assets/', import.meta.url)), { recursive: true });
fs.writeFileSync(target, png);
console.log(`wrote ${target} (${png.length} bytes)`);
