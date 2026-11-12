import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LANGS } from '../../public/locales.js';
import { hasPrintedSource } from '../../public/card-image/printed.js';
import { cohortIds, resolveCardFace } from './catalog.mjs';
import { energySymbols } from './flow.mjs';

const assets = new Map();
const scans = new Map();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const modules = new URL('../../public/card-image/', import.meta.url);
const rendererFiles = ['browser-render.js', 'edge-repair.js', 'flow.js', 'layout.js', 'pokemon.js', 'repair-worker.js', 'repair.js', 'svg.js'];
const rendererRevision = hash(JSON.stringify([
  ...rendererFiles.map((file) => [file, hash(readFileSync(new URL(file, modules)))]),
  energySymbols,
]));

function scanVersion(path) {
  if (!scans.has(path)) {
    let version;
    try {
      version = hash(readFileSync(new URL(path, new URL('../../public/', import.meta.url))));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    scans.set(path, version);
  }
  return scans.get(path);
}

export function cardImageAsset(locale, kind, { hosted = false } = {}) {
  if (!LANGS.includes(locale) || locale === 'en' || !['printed', 'recipes'].includes(kind)) return;
  const key = kind + '/' + locale + (kind === 'recipes' && hosted ? '/hosted' : '');
  if (assets.has(key)) return assets.get(key);
  let data;
  if (kind === 'printed') {
    let index;
    try {
      index = JSON.parse(readFileSync(new URL('./data/printed/' + locale + '.json', import.meta.url), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (index !== undefined) {
      if (index?.version !== 1 || !index.cards || typeof index.cards !== 'object' || Array.isArray(index.cards)) {
        throw new Error('Invalid printed card index for ' + locale);
      }
      const knownCards = new Set(cohortIds('catalog'));
      const cards = {};
      for (const [id, candidates] of Object.entries(index.cards)) {
        if (!knownCards.has(id)) throw new Error(`Printed card index for ${locale} references unknown card ${id}`);
        if (!Array.isArray(candidates) || !candidates.length || candidates.some((candidate) => !hasPrintedSource(candidate))) {
          throw new Error(`Invalid printed card candidates for ${locale}/${id}`);
        }
        if (!resolveCardFace(id, 'en').shared) cards[id] = candidates;
      }
      if (Object.keys(cards).length) data = { cards };
    }
  } else {
    const cards = {};
    const versions = {};
    let font;
    for (const id of cohortIds('catalog')) {
      const face = resolveCardFace(id, locale);
      if (!face.recipe || face.actualLocale !== locale) continue;
      cards[id] = face.recipe;
      font = face.font;
      const version = versions[id] = { recipe: hash(JSON.stringify([face.recipe, font])) };
      const scan = hosted ? undefined : scanVersion(face.scan);
      if (scan) version.scan = { path: face.scan, hash: scan };
    }
    if (Object.keys(cards).length) {
      data = { rendererRevision, font, energySymbols, cards, versions };
    }
  }
  const json = data && JSON.stringify(data);
  assets.set(key, json);
  return json;
}

export function cardImageCoverageAsset() {
  if (!assets.has('coverage')) {
    const ids = cohortIds('catalog');
    const total = ids.length;
    const shared = ids.filter((id) => resolveCardFace(id, 'en').shared).length;
    const byLocale = Object.fromEntries(LANGS.map((locale) => {
      if (locale === 'en') return [locale, total];
      const printed = cardImageAsset(locale, 'printed');
      return [locale, shared + (printed ? Object.keys(JSON.parse(printed).cards).length : 0)];
    }));
    assets.set('coverage', JSON.stringify({ total, byLocale }));
  }
  return assets.get('coverage');
}

export async function writeCardImageAssets(outDir, options) {
  const root = join(outDir, 'card-image', 'data');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'coverage.json'), cardImageCoverageAsset());
  for (const kind of ['printed', 'recipes']) {
    for (const locale of LANGS) {
      const json = cardImageAsset(locale, kind, options);
      if (!json) continue;
      const dir = join(root, kind);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, locale + '.json'), json);
    }
  }
}
