// Download every card image the decks use, so the game doesn't depend on the image CDN.
//   node scripts/fetch-images.mjs
// Saves public/img/cards/<set>/<number>.png (small) and <number>_hires.png (large), then runs
// scripts/webp-images.mjs, which makes the .webp copies the game uses and points the deck files at them.
// Safe to re-run: files already on disk are skipped, and so are decks that already use local paths
// (their remote URL is rebuilt from the path; a .webp path downloads its .png source).
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const decksDir = join(root, 'data', 'decks');
const CDN = 'https://images.pokemontcg.io/';

const exists = (p) => stat(p).then(() => true, () => false);
// Images from other sources (e.g. TCGdex for promo cards) are listed in img/sources.json: local path → URL.
const sourcesFile = join(root, 'img', 'sources.json');
const sources = (await exists(sourcesFile)) ? JSON.parse(await readFile(sourcesFile, 'utf8')) : {};
const usedSources = {};
const toLocal = (url) => {
  if (url.startsWith(CDN)) return 'img/cards/' + url.slice(CDN.length);
  if (!/^https?:\/\//.test(url)) return url;
  // TCGdex: …/<series>/<set>/<number>/low.png; Scrydex (newest sets): …/pokemon/<set>-<number>/small (PNG files)
  const td = url.match(/tcgdex\.net\/\w+\/\w+\/(\w+)\/(\w+)\/(low|high)\.(png|webp|jpg)$/);
  const sx = url.match(/scrydex\.com\/pokemon\/(\w+)-(\w+)\/(small|large)$/);
  const local = td ? `img/cards/${td[1]}/${Number(td[2]) || td[2]}${td[3] === 'high' ? '_hires' : ''}.${td[4]}`
    : sx ? `img/cards/${sx[1]}/${sx[2]}${sx[3] === 'large' ? '_hires' : ''}.png`
    : 'img/cards/ext/' + url.replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '_');
  usedSources[local] = url;
  return local;
};
const toRemote = (path) => sources[path] || (path.startsWith('img/cards/') ? CDN + path.slice('img/cards/'.length) : path);

// Brand images used outside the decks.
const EXTRA = {
  'img/card-back.jpg': 'https://tcg.pokemon.com/assets/img/global/tcg-card-back.jpg',
  'img/pokemon-logo.svg': 'https://upload.wikimedia.org/wikipedia/commons/9/98/International_Pok%C3%A9mon_logo.svg',
  'img/set-logo.png': 'https://images.pokemontcg.io/base1/logo.png',
  'img/set-symbol.png': 'https://images.pokemontcg.io/base1/symbol.png',
};

const jobs = new Map(); // local path -> remote url
for (const [path, url] of Object.entries(EXTRA)) jobs.set(path, url);
const decks = (await readdir(decksDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
for (const key of decks) {
  const file = join(decksDir, key, 'cards.json');
  if (!(await exists(file))) continue;
  const deck = JSON.parse(await readFile(file, 'utf8'));
  let changed = false;
  for (const c of deck.cards) {
    for (const k of ['img', 'imgLarge']) {
      if (!c[k]) continue;
      const webp = c[k].endsWith('.webp');
      const remote = toRemote(c[k].replace(/\.webp$/, '.png')), local = toLocal(remote);
      if (local === remote) continue; // not from the card CDN
      jobs.set(local, remote);
      if (!webp && c[k] !== local) { c[k] = local; changed = true; }
    }
  }
  if (changed) await writeFile(file, JSON.stringify(deck, null, 2) + '\n');
}

// The deck chooser's summaries of lazily loaded decks (index.json) show featured card images too.
const indexFile = join(decksDir, 'index.json');
const index = JSON.parse(await readFile(indexFile, 'utf8'));
let indexChanged = false;
for (const s of index.modern || []) for (const f of s.featured) {
  const webp = f.img.endsWith('.webp');
  const remote = toRemote(f.img.replace(/\.webp$/, '.png')), local = toLocal(remote);
  if (local === remote) continue;
  jobs.set(local, remote);
  if (!webp && f.img !== local) { f.img = local; indexChanged = true; }
}
if (indexChanged) await writeFile(indexFile, JSON.stringify(index, null, 2) + '\n');
if (Object.keys(usedSources).length) { await mkdir(dirname(sourcesFile), { recursive: true }); await writeFile(sourcesFile, JSON.stringify(usedSources, null, 2) + '\n'); }

let done = 0, skipped = 0, failed = 0, bytes = 0;
const queue = [...jobs];
async function worker() {
  while (queue.length) {
    const [path, url] = queue.shift();
    const dest = join(root, path);
    if (await exists(dest)) { skipped++; continue; }
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, buf);
      bytes += buf.length;
      done++;
    } catch (err) {
      failed++;
      console.error('failed', url, err.message);
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
console.log(`images: ${done} downloaded (${(bytes / 1e6).toFixed(1)} MB), ${skipped} already there, ${failed} failed, ${jobs.size} total`);

// The board's watermark: the Pokémon logo in white (so the page needs no filter to draw it).
const logo = join(root, 'img', 'pokemon-logo.svg');
if (await exists(logo)) await writeFile(join(root, 'img', 'pokemon-logo-white.svg'), (await readFile(logo, 'utf8')).replace(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g, '#ffffff'));

// The game uses WebP copies (a tenth of the size): make them and point the deck files at them.
const { execFileSync } = await import('node:child_process');
execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'webp-images.mjs')], { stdio: 'inherit' });
