/**
 * Generates a minimal 512x512 app icon PNG (accent tile with a white "A"
 * triangle mark) using only Node built-ins, then the Tauri CLI expands it
 * into the full icon set (icon.ico for the Windows resource file).
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const SIZE = 512;
const R = 128; // corner radius

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Accent blue #5A8DFF with rounded corners.
const ACCENT = [0x5a, 0x8d, 0xff];
const WHITE = [0xff, 0xff, 0xff];

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
// Triangle mark: apex top-center, base bottom, spans most of the tile.
const apexX = SIZE / 2, apexY = 96;
const baseY = 448, halfBase = 150;
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter type None
  for (let x = 0; x < SIZE; x++) {
    // Rounded corner mask.
    const dx = Math.min(x, SIZE - 1 - x);
    const dy = Math.min(y, SIZE - 1 - y);
    const corner = dx < R && dy < R && Math.hypot(dx - R, dy - R) > R ? false : true;
    if (!corner) continue;
    // Inside the triangle?
    const t = (y - apexY) / (baseY - apexY);
    const inTri = t >= 0 && t <= 1 && Math.abs(x - apexX) <= halfBase * t;
    if (!inTri) continue;
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    const color = inTri ? WHITE : ACCENT;
    raw[o] = color[0];
    raw[o + 1] = color[1];
    raw[o + 2] = color[2];
    raw[o + 3] = 255;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync('apps/desktop/src-tauri/icons', { recursive: true });
writeFileSync('apps/desktop/icon.png', png);
console.log('wrote apps/desktop/icon.png');
