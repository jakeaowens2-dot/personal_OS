import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const output = process.argv[2];
if (!output) throw new Error("Provide an output PNG path.");
const size = 1024;
const pixels = Buffer.alloc((size * 4 + 1) * size);
const warm = [246, 240, 231, 255];
const rust = [163, 84, 52, 255];
const navy = [15, 23, 42, 255];
const transparent = [0, 0, 0, 0];
const distanceToSegment = (x, y, x1, y1, x2, y2) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
};
const insideRoundedSquare = (x, y) => {
  const radius = 224;
  const cx = Math.max(radius, Math.min(size - radius, x));
  const cy = Math.max(radius, Math.min(size - radius, y));
  return Math.hypot(x - cx, y - cy) <= radius;
};
for (let y = 0; y < size; y += 1) {
  const row = y * (size * 4 + 1);
  pixels[row] = 0;
  for (let x = 0; x < size; x += 1) {
    let color = insideRoundedSquare(x, y) ? warm : transparent;
    const segments = [
      [512, 172, 512, 852],
      [172, 512, 852, 512],
      [272, 272, 752, 752],
      [752, 272, 272, 752],
    ];
    if (segments.some(([x1, y1, x2, y2]) => distanceToSegment(x, y, x1, y1, x2, y2) <= 42)) color = rust;
    const center = Math.hypot(x - 512, y - 512);
    if (center <= 128) color = navy;
    if (center <= 92) color = warm;
    const offset = row + 1 + x * 4;
    pixels.set(color, offset);
  }
}

const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (name, data) => {
  const type = Buffer.from(name);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  type.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([type, data])), data.length + 8);
  return result;
};
const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header.set([8, 6, 0, 0, 0], 8);
writeFileSync(output, Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(pixels, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]));
