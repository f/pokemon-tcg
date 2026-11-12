import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { buildCardSvg, prepareCard, writeCardImage } from './card-localization/render.mjs';
import { cohortIds, materializeFace, resolveCardFace } from './card-localization/catalog.mjs';
import { generateCardImage } from './card-localization/generate.mjs';
import { printedCandidates } from './card-localization/printed.mjs';
import { normalizeLanguage } from '../public/locales.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const formats = new Set(['png', 'webp', 'svg']);

const usage = `Usage
  node scripts/localize-card.mjs CARD_ID [--locale zh-Hans] [--output FILE]
  node scripts/localize-card.mjs all --out-dir DIR [--format webp]
  node scripts/localize-card.mjs CARD_ID --recipe FILE --input PNG --output FILE
  node scripts/localize-card.mjs all --benchmark 5 [--format webp]

Options
  --input PNG       Original scan for a single card. Built-in samples use public/img/cards.
  --recipe FILE     Trusted JS module exporting one recipe or an array of recipes.
  --locale CODE     Card image language (default zh-Hans). Missing packs use the English scan.
  --group NAME      For all, select initial, extended, expansion, pokemon, zh-Hant-100 or catalog.
  --cache-dir DIR   Reuse prepared backgrounds and images in this directory.
  --prefer-printed  Try reviewed images of matching localized printings before rendering.
  --offline         With --prefer-printed, only use already downloaded source images.
  --strict          Fail if any card lacks a face for the requested language.
  --json            Print one JSON result per card.
  --width PX        Output width (default 600).
  --quality N       WebP quality (default 82).
  --format FORMAT   png, webp or svg. Defaults to the output extension or webp.
  --benchmark N     Repeat each card N times. Prints JSON and cleans temporary outputs.
`;

function integer(value, name, min, max) {
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return Number(value);
}

function defaultScan(recipe) {
  const match = recipe.id.match(/^([\w-]+)-([\w]+)$/);
  if (!match) throw new Error('No default source path for ' + recipe.id + '. Use --input.');
  return join(publicDir, 'img', 'cards', match[1], match[2] + '_hires.png');
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Object.fromEntries(Object.entries({
    median, p95: percentile(0.95), min: sorted[0], max: sorted.at(-1),
  }).map(([key, value]) => [key, Math.round(value * 10) / 10]));
}

function benchmark(entries, { width, format, quality, rounds }) {
  const temp = mkdtempSync(join(tmpdir(), 'tcg-card-bench-'));
  const file = join(temp, 'card.' + format);
  const timings = new Map(entries.map(({ recipe }) => [recipe.id, {
    prepare: [], render: [], total: [], reused: [], bytes: 0,
  }]));
  const render = (prepared, recipe, font) => writeCardImage(buildCardSvg(prepared, recipe, { width, font }), file, format, quality);

  try {
    // First warm up font discovery and the renderer. Each measured first conversion
    // still decodes the source, reconstructs the background, and writes a real file.
    const first = entries[0];
    render(prepareCard(first.input, first.recipe), first.recipe, first.font);

    for (let round = 0; round < rounds; round++) {
      for (const { recipe, input, font } of entries) {
        const result = timings.get(recipe.id);
        const start = performance.now();
        const prepared = prepareCard(input, recipe);
        const afterPrepare = performance.now();
        render(prepared, recipe, font);
        const end = performance.now();
        result.prepare.push(afterPrepare - start);
        result.render.push(end - afterPrepare);
        result.total.push(end - start);
        result.bytes = statSync(file).size;

        const reusedStart = performance.now();
        render(prepared, recipe, font);
        result.reused.push(performance.now() - reusedStart);
      }
    }

    const stats = (rows) => ({
      prepareMs: summarize(rows.flatMap(({ prepare }) => prepare)),
      renderMs: summarize(rows.flatMap(({ render }) => render)),
      totalMs: summarize(rows.flatMap(({ total }) => total)),
      renderWithPreparedMs: summarize(rows.flatMap(({ reused }) => reused)),
    });
    const rows = [...timings.values()];
    const bytes = rows.map((row) => row.bytes);
    return {
      format, width, quality: format === 'webp' ? quality : undefined,
      cardCount: entries.length, runsPerCard: rounds, sampleCount: rows.length * rounds,
      ...stats(rows),
      outputBytes: summarize(bytes),
      cards: [...timings].map(([id, row]) => ({ id, ...stats([row]), outputBytes: row.bytes })),
    };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      input: { type: 'string' },
      recipe: { type: 'string' },
      locale: { type: 'string', default: 'zh-Hans' },
      group: { type: 'string' },
      'cache-dir': { type: 'string' },
      'prefer-printed': { type: 'boolean' },
      offline: { type: 'boolean' },
      strict: { type: 'boolean' },
      json: { type: 'boolean' },
      output: { type: 'string', short: 'o' },
      'out-dir': { type: 'string' },
      format: { type: 'string' },
      width: { type: 'string', default: '600' },
      quality: { type: 'string', default: '82' },
      benchmark: { type: 'string' },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  if (positionals.length !== 1) throw new Error('Specify a card ID or all. See --help.');
  const [id] = positionals;
  const locale = normalizeLanguage(values.locale);
  if (!locale) throw new Error('Unsupported card image language ' + values.locale);
  const preferPrinted = values['prefer-printed'] ?? false;
  if (preferPrinted && (values.input || values.recipe || values.benchmark !== undefined)) {
    throw new Error('--prefer-printed requires the built-in catalog without --input or --benchmark');
  }
  if (values.offline && !preferPrinted) throw new Error('--offline requires --prefer-printed');
  if (values.group && (id !== 'all' || values.recipe)) throw new Error('--group requires the built-in catalog and all');
  let faces;
  if (values.recipe) {
    const { default: loaded } = await import(pathToFileURL(resolve(values.recipe)));
    const recipes = Array.isArray(loaded) ? loaded : [loaded];
    const selected = id === 'all' ? recipes : recipes.filter((recipe) => recipe?.id === id);
    if (!selected.length) throw new Error('No recipe for ' + id);
    faces = selected.map(recipe => {
      if (!/^[\w-]+$/.test(recipe?.id) || recipe.grid?.length !== 2 ||
          !recipe.grid.every(dimension => Number.isFinite(dimension) && dimension > 0) ||
          !Array.isArray(recipe.erase) || typeof recipe.overlay !== 'string') {
        throw new Error('Invalid recipe: expected id, grid, erase and overlay');
      }
      return {
        id: recipe.id, recipe, input: values.input ? resolve(values.input) : defaultScan(recipe),
        requestedLocale: locale, actualLocale: normalizeLanguage(recipe.locale ?? locale) ?? locale,
      };
    });
  } else {
    faces = (id === 'all' ? cohortIds(values.group) : [id]).map(key => resolveCardFace(key, locale));
  }
  if (new Set(faces.map(face => face.id)).size !== faces.length) throw new Error('Duplicate recipe IDs');
  if (values.input && faces.length > 1) throw new Error('--input requires exactly one card');
  const width = integer(values.width, '--width', 80, 2400);
  if (values.strict) {
    const missing = faces.filter(face => face.actualLocale !== locale &&
      !(preferPrinted && printedCandidates(locale, face.id, width).length));
    if (missing.length) {
      throw new Error(missing.length + ' cards lack ' + locale + ' resources: ' +
        missing.slice(0, 10).map(({ id, reason }) => id + ' (' + reason + ')').join(', '));
    }
  }

  const quality = integer(values.quality, '--quality', 0, 100);
  const extension = values.output && extname(values.output).slice(1).toLowerCase();
  const format = values.format ?? (extension || 'webp');
  if (!formats.has(format)) throw new Error('--format must be png, webp or svg');
  if (extension && extension !== format) throw new Error('--output extension must match the format');
  if (values.benchmark !== undefined) {
    if (values.output || values['out-dir']) throw new Error('--benchmark uses temporary files');
    const rounds = integer(values.benchmark, '--benchmark', 1, 100);
    if (faces.some(face => !face.recipe && !face.shared)) throw new Error('Benchmark requires localized card recipes');
    const entries = faces.filter(face => !face.shared).map(face => ({
      recipe: materializeFace(face), input: values.input ? resolve(values.input) : face.input, font: face.font,
    }));
    if (!entries.length) throw new Error('Selected cards share the English art and require no localized rendering');
    console.log(JSON.stringify(benchmark(entries, { width, format, quality, rounds }), null, 2));
    return;
  }

  if (values.output && (faces.length > 1 || values['out-dir'])) throw new Error('--output is for a single card');
  for (const face of faces) {
    const output = values.output ?? (values['out-dir'] && join(values['out-dir'], face.id + '.' + format));
    const start = performance.now();
    const result = await generateCardImage({
      face, input: values.input, output, width, format, quality, cacheDir: values['cache-dir'],
      preferPrinted, offline: values.offline, strict: values.strict,
    });
    const ms = Math.round(performance.now() - start);
    if (values.json) console.log(JSON.stringify({ ...result, ms }));
    else console.log(`${result.id} → ${result.output} (${result.actualLocale}, ${result.source}, ${result.hit ? 'cache hit, ' : ''}${ms} ms)`);
  }
}

main().catch((error) => {
  console.error(error.message);
  if (error.code === 'ENOENT' && error.syscall?.startsWith('spawnSync ')) {
    console.error('Install the missing renderer. On macOS: brew install librsvg pango webp');
  }
  process.exitCode = 1;
});
