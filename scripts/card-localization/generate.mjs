import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { materializeFace, resolveCardFace } from './catalog.mjs';
import { iconFiles } from './flow.mjs';
import { fetchPrintedImage, hasPrintedDimensions, printedCandidates, printedFormat } from './printed.mjs';
import { buildCardSvg, prepareCard, writeCardImage } from './render.mjs';

export const defaultCacheDir = fileURLToPath(new URL('../../.cache/card-localization/', import.meta.url));
const jsonHash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceHash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fileHash = (file) => sourceHash(readFileSync(new URL(file, import.meta.url)));
const shared = '../../public/card-image/';
const prepareRevision = jsonHash(['./render.mjs', shared + 'repair.js', shared + 'edge-repair.js'].map(fileHash));
const outputRevision = jsonHash([
  './catalog.mjs', './flow.mjs', './generate.mjs',
  ...['flow.js', 'layout.js', 'pokemon.js', 'svg.js'].map(file => shared + file),
  ...Object.values(iconFiles).map(file => '../../public/vendor/types/' + file + '.svg'),
].map(fileHash));
const formats = new Set(['png', 'webp', 'svg']);

function fileReady(file) {
  try {
    const stat = statSync(file);
    return stat.isFile() && stat.size > 0;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return false;
  }
}

async function cached(file, produce) {
  if (fileReady(file)) return true;
  mkdirSync(dirname(file), { recursive: true });
  const lock = file + '.lock';
  const deadline = Date.now() + 30_000;
  while (true) {
    try { mkdirSync(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (fileReady(file)) return true;
      // A crashed worker can leave a lock. These single-card renders take
      // seconds, so only reclaim locks well past the normal completion time.
      try {
        if (Date.now() - statSync(lock).mtimeMs > 5 * 60_000) rmSync(lock, { recursive: true, force: true });
      } catch (statError) {
        if (statError.code !== 'ENOENT') throw statError;
      }
      if (Date.now() > deadline) throw new Error('Timed out waiting for cached card image');
      await sleep(35);
    }
  }
  try {
    if (fileReady(file)) return true;
    await atomicGenerate(file, produce);
    return false;
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

async function atomicGenerate(file, produce) {
  mkdirSync(dirname(file), { recursive: true });
  const scratch = mkdtempSync(join(dirname(file), '.building-'));
  try {
    const temp = join(scratch, 'output');
    await produce(temp);
    renameSync(temp, file);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function readPrepared(path, source) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  return {
    source, patch: Buffer.from(data.patch, 'base64'),
    emblems: Object.fromEntries(Object.entries(data.emblems).map(([id, emblem]) =>
      [id, { ...emblem, png: Buffer.from(emblem.png, 'base64') }])),
  };
}

function originalSvg(source, width) {
  if (!source.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('Expected a PNG card image');
  }
  const height = Math.round(width * source.readUInt32BE(20) / source.readUInt32BE(16));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image width="${width}" height="${height}" href="data:image/png;base64,${source.toString('base64')}"/></svg>`;
}

function preparedIdentity(recipe) {
  return {
    grid: recipe.grid, erase: recipe.erase, preserveRules: recipe.preserveRules, repeatRows: recipe.repeatRows,
    cutouts: Object.fromEntries(Object.entries(recipe.cutouts ?? {}).map(([id, { position, ...source }]) => [id, source])),
  };
}

async function preferredPrinting(face, width, cacheRoot, offline) {
  for (const image of printedCandidates(face.requestedLocale, face.id, width)) {
    const path = join(cacheRoot, 'printed', image.sha256 + '.' + printedFormat(image));
    const verified = bytes => hasPrintedDimensions(bytes, image) && sourceHash(bytes) === image.sha256;
    const download = async temp => {
      const bytes = await fetchPrintedImage(image);
      if (!verified(bytes)) throw new Error('Printed card image differs from the reviewed file');
      writeFileSync(temp, bytes);
    };
    try {
      if (!offline) await cached(path, download);
      let bytes = readFileSync(path);
      if (!verified(bytes) && !offline) {
        await atomicGenerate(path, download);
        bytes = readFileSync(path);
      }
      if (verified(bytes)) return { bytes, image, path };
    } catch {
      // A retired source, timeout or incomplete cache entry leaves the next
      // reviewed source and the generated face available.
    }
  }
}

function writePrintedImage(printed, output, { width, format, quality }) {
  const sourceFormat = printedFormat(printed.image);
  const nativeWidth = width === printed.image.width;
  const png = format === 'png' ? output : output + '.png';
  if (format === 'webp' && sourceFormat === 'png') {
    execFileSync('cwebp', ['-quiet', '-q', String(quality), '-resize', String(width), '0', printed.path, '-o', output],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    return;
  }
  if (nativeWidth && sourceFormat === 'png') copyFileSync(printed.path, png);
  else execFileSync('sips', ['--setProperty', 'format', 'png', '--resampleWidth', String(width), printed.path, '--out', png],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  if (format === 'svg') writeFileSync(output, originalSvg(readFileSync(png), width));
  if (format === 'webp') execFileSync('cwebp', ['-quiet', '-q', String(quality), png, '-o', output],
    { stdio: ['ignore', 'ignore', 'pipe'] });
}

// Callable by a worker as well as by the CLI. A hit does not decode the scan,
// measure fonts, invoke the image encoder, or call any translation service.
export async function generateCardImage({
  id, locale = 'zh-Hans', width = 600, quality = 82, format = 'webp',
  cacheDir = process.env.TCG_CARD_IMAGE_CACHE ?? defaultCacheDir,
  input, output, face: provided, preferPrinted = false, offline = false, strict = false,
}) {
  if (!formats.has(format)) throw new Error('Unsupported image format ' + format);
  if (!Number.isInteger(width) || width < 80 || width > 2400) throw new Error('Card width must be 80–2400');
  if (!Number.isInteger(quality) || quality < 0 || quality > 100) throw new Error('WebP quality must be 0–100');
  const face = provided ?? resolveCardFace(id, locale);
  const sourcePath = resolve(input ?? face.input);
  if (output && resolve(output) === sourcePath) throw new Error('Output would overwrite the English source');
  const cacheRoot = resolve(cacheDir);
  const printed = preferPrinted && !input && !face.shared && await preferredPrinting(face, width, cacheRoot, offline);
  const actualLocale = printed ? face.requestedLocale : face.actualLocale;
  if (strict && actualLocale !== face.requestedLocale) {
    throw new Error(face.id + ' lacks ' + face.requestedLocale + ' resources: ' + face.reason);
  }
  const recipe = printed ? undefined : face.recipe;
  let source = printed?.bytes;
  if (!source) {
    try {
      source = readFileSync(sourcePath);
    } catch (error) {
      if (error.code !== 'ENOENT' || input) throw error;
      throw new Error('English scan missing at ' + sourcePath + '. Run npm run images or pass --input.', { cause: error });
    }
  }
  const baseKey = jsonHash([sourceHash(source), prepareRevision, preparedIdentity(recipe ?? {})]);
  const key = jsonHash([baseKey, outputRevision, recipe && actualLocale, recipe, recipe && face.font, width, format,
    format === 'webp' ? quality : null, process.platform, process.arch, process.env.TCG_CARD_FONT_REVISION]);
  const cacheFile = join(cacheRoot, 'images', key.slice(0, 2), key + '.' + format);
  let preparedHit;
  const hit = await cached(cacheFile, async (temp) => {
    if (printed) {
      writePrintedImage(printed, temp, { width, format, quality });
      return;
    }
    if (!recipe) {
      writeCardImage(originalSvg(source, width), temp, format, quality);
      return;
    }
    const materialized = materializeFace(face);
    const base = join(cacheRoot, 'prepared', baseKey.slice(0, 2), baseKey + '.json');
    let prepared;
    preparedHit = await cached(base, preparedTemp => {
      prepared = prepareCard(sourcePath, materialized, source);
      const data = {
        patch: prepared.patch.toString('base64'),
        emblems: Object.fromEntries(Object.entries(prepared.emblems).map(([name, emblem]) =>
          [name, { ...emblem, png: emblem.png.toString('base64') }])),
      };
      writeFileSync(preparedTemp, JSON.stringify(data));
    });
    prepared ??= readPrepared(base, source);
    writeCardImage(buildCardSvg(prepared, materialized, { width, font: face.font }), temp, format, quality);
  });
  if (output && resolve(output) !== resolve(cacheFile)) {
    await atomicGenerate(resolve(output), temp => copyFileSync(cacheFile, temp));
  }
  return { id: face.id, requestedLocale: face.requestedLocale, actualLocale, reason: printed ? undefined : face.reason,
    source: printed ? 'printed' : recipe ? 'generated' : 'original',
    ...(printed && { printing: printed.image.printing, sourcePage: printed.image.page, sourceSite: printed.image.site }),
    cacheFile, output: output ? resolve(output) : cacheFile, hit, preparedHit };
}
