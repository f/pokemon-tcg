import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { repairCard } from '../../public/card-image/repair.js';
import { composeCardSvg } from '../../public/card-image/svg.js';
export { escapeXml } from '../../public/card-image/svg.js';

const dataUri = (png) => 'data:image/png;base64,' + png.toString('base64');
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value;
});

function pngChunk(type, payload) {
  const tag = Buffer.from(type);
  let crc = 0xffffffff;
  for (const bytes of [tag, payload]) {
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, tag, payload, checksum]);
}

function encodePatch(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 bits per channel
  header[9] = 6; // RGBA
  const stride = width * 4;
  const rows = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row++) {
    rows.set(rgba.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function decodePng(source) {
  const dir = mkdtempSync(join(tmpdir(), 'tcg-card-decode-'));
  try {
    const inputPath = join(dir, 'source.png');
    writeFileSync(inputPath, source);
    const bmpPath = join(dir, 'source.bmp');
    execFileSync('sips', ['-s', 'format', 'bmp', inputPath, '--out', bmpPath], { stdio: ['ignore', 'ignore', 'pipe'] });
    const bmp = readFileSync(bmpPath);
    const width = bmp.readInt32LE(18), signedHeight = bmp.readInt32LE(22);
    const height = Math.abs(signedHeight), bytesPerPixel = bmp.readUInt16LE(28) / 8;
    if (width < 1 || height < 1 || ![3, 4].includes(bytesPerPixel)) {
      throw new Error('Expected a 24-bit or 32-bit bitmap from sips');
    }
    const stride = Math.ceil(width * bytesPerPixel / 4) * 4;
    const offset = bmp.readUInt32LE(10);
    const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      const row = signedHeight < 0 ? y : height - y - 1;
      for (let x = 0; x < width; x++) {
        const from = offset + row * stride + x * bytesPerPixel;
        const to = (y * width + x) * 3;
        pixels[to] = bmp[from + 2];
        pixels[to + 1] = bmp[from + 1];
        pixels[to + 2] = bmp[from];
      }
    }
    return { width, height, pixels };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function prepareCard(inputPath, recipe, source = readFileSync(inputPath)) {
  if (!source.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('The input must be an English PNG scan');
  }
  const image = decodePng(source);
  const { patch, emblems } = repairCard(image, recipe);
  return {
    source,
    patch: encodePatch(image.width, image.height, patch),
    emblems: Object.fromEntries(Object.entries(emblems).map(([name, { pixels, pixelWidth, pixelHeight, ...geometry }]) =>
      [name, { ...geometry, png: encodePatch(pixelWidth, pixelHeight, pixels) }])),
  };
}

export function buildCardSvg({ source, patch, emblems }, recipe, options) {
  return composeCardSvg({
    source: dataUri(source), patch: dataUri(patch), aspect: source.readUInt32BE(20) / source.readUInt32BE(16),
    emblems: Object.fromEntries(Object.entries(emblems).map(([name, { png, ...geometry }]) =>
      [name, { ...geometry, uri: dataUri(png) }])),
  }, recipe, options);
}

export function writeCardImage(svg, outputPath, format, quality = 82) {
  if (format === 'svg') {
    writeFileSync(outputPath, svg);
    return;
  }
  if (format === 'png') {
    execFileSync('rsvg-convert', ['-o', outputPath], { input: svg, stdio: ['pipe', 'ignore', 'pipe'] });
    return;
  }
  if (format !== 'webp') throw new Error('Unsupported image format: ' + format);
  const dir = mkdtempSync(join(tmpdir(), 'tcg-card-render-'));
  try {
    const pngPath = join(dir, 'card.png');
    writeCardImage(svg, pngPath, 'png');
    execFileSync('cwebp', ['-quiet', '-q', String(quality), pngPath, '-o', outputPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
