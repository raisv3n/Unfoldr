// Generates the extension's PNG icons (a dark tile with a white "download into box" glyph).
// Dependency-free: rasterizes with simple geometry and encodes PNG via zlib.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function pixel(x, y, s) {
  const u = x / s, v = y / s;
  const r = 0.2, inset = 0.04;
  const dx = Math.max(Math.abs(u - 0.5) - (0.5 - inset - r), 0);
  const dy = Math.max(Math.abs(v - 0.5) - (0.5 - inset - r), 0);
  if (Math.hypot(dx, dy) > r) return [0, 0, 0, 0];
  const white = [255, 255, 255, 255];
  // arrow shaft
  if (Math.abs(u - 0.5) < 0.06 && v > 0.2 && v < 0.55) return white;
  // arrow head
  if (v >= 0.45 && v < 0.65 && Math.abs(u - 0.5) < (0.65 - v) * 1.1) return white;
  // tray
  if (v > 0.7 && v < 0.78 && u > 0.25 && u < 0.75) return white;
  if (v > 0.58 && v < 0.78 && ((u > 0.25 && u < 0.31) || (u > 0.69 && u < 0.75))) return white;
  return [37, 37, 37, 255];
}
mkdirSync('public/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(`public/icons/icon${size}.png`, png(size, pixel));
console.log('icons written');
