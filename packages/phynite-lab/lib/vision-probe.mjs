// Synthetic image used to verify that a connected model actually reads images.
// The digits exist only as pixels; they never appear in the prompt text, so a
// model can pass only by reading the image it was sent.
import { randomInt } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const FONT = {
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
};

export const randomProbeDigits = () => String(randomInt(0, 10000)).padStart(4, '0');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A grayscale PNG with black digits on white, large enough for any vision model to read. */
export function digitImage(digits, scale = 12) {
  if (!/^[0-9]{1,12}$/.test(digits)) throw new Error('Probe digits must be 1 to 12 decimal digits.');
  const margin = 2, columns = digits.length * 6 - 1 + margin * 2, rows = 7 + margin * 2;
  const width = columns * scale, height = rows * scale;
  const raw = Buffer.alloc((width + 1) * height, 255);
  for (let y = 0; y < height; y++) raw[y * (width + 1)] = 0; // filter type: none
  [...digits].forEach((digit, index) => {
    FONT[digit].forEach((line, row) => [...line].forEach((bit, column) => {
      if (bit !== '1') return;
      const left = (margin + index * 6 + column) * scale, top = (margin + row) * scale;
      for (let y = top; y < top + scale; y++) raw.fill(0, y * (width + 1) + 1 + left, y * (width + 1) + 1 + left + scale);
    }));
  });
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 0; header[10] = 0; header[11] = 0; header[12] = 0; // 8-bit grayscale
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
