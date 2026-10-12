// Builds the game from public/ into <dir> for a static host: the web version at pokemon.space.fast/play/ and the
// game frame of two-player matches (scripts/build-versus.mjs). Both are the same code as the dev server and the app:
//   - card images point at their remote sources (images.pokemontcg.io and public/img/sources.json), not copied;
//   - few requests (a static host answers bursts with 429, and a module that fails to load stops the game): the
//     classic decks in one file, the modules bundled into one script, the icons inside the stylesheets;
//   - the page is marked as the web build, so api.js plays with the CPU engine and never calls a server.
import { cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, dirname, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pub = join(root, 'public');
const CDN = 'https://images.pokemontcg.io/';
const CARD_PATH = /img\/cards\/[\w./-]+?\.(?:webp|png)/g;

// pages: [{ entry: 'ui.js', from: 'index.html', to: 'index.html', script: 'app.js', head: '<meta …>' , title }]
export async function buildPlay(dir, pages) {
  const sources = JSON.parse(await readFile(join(pub, 'img', 'sources.json'), 'utf8'));
  // img/cards/<set>/<n>[_hires].webp → the remote PNG it was made from.
  const remote = (local) => { const png = local.replace(/\.webp$/, '.png'); return sources[png] || CDN + png.slice('img/cards/'.length); };
  await rm(dir, { recursive: true, force: true });
  await cp(pub, dir, {
    recursive: true,
    filter: (src) => {
      const rel = src.slice(pub.length + 1);
      return !(rel === join('img', 'cards') || rel.startsWith(`img${sep}cards${sep}`) || rel === join('img', 'sources.json') || rel.endsWith('.DS_Store'));
    },
  });

  let rewritten = 0;
  const unknown = new Set();
  async function walk(d) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { await walk(p); continue; }
      if (!['.json', '.js', '.html', '.css'].includes(extname(p))) continue;
      const text = await readFile(p, 'utf8');
      const out = text.replace(CARD_PATH, (m) => { rewritten++; const r = remote(m); if (!/^https:\/\//.test(r)) unknown.add(m); return r; });
      if (out !== text) await writeFile(p, out);
    }
  }
  await walk(dir);
  if (unknown.size) throw new Error(`no remote source for: ${[...unknown].slice(0, 5).join(', ')}`);

  const decksDir = join(dir, 'data', 'decks');
  const deckIndex = JSON.parse(await readFile(join(decksDir, 'index.json'), 'utf8'));
  const classic = {};
  for (const k of deckIndex.decks) classic[k] = JSON.parse(await readFile(join(decksDir, k, 'cards.json'), 'utf8'));
  await writeFile(join(decksDir, 'classic.json'), JSON.stringify(classic));
  await writeFile(join(decksDir, 'index.json'), JSON.stringify({ ...deckIndex, classicBundle: 'classic.json' }, null, 2) + '\n');

  for (const page of pages) {
    await esbuild.build({
      entryPoints: [join(dir, page.entry)], bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
      external: ['node:*'], minify: true, legalComments: 'none', outfile: join(dir, page.script), logLevel: 'warning',
    });
  }
  const keep = new Set(pages.map((p) => p.script));
  for (const f of await readdir(dir)) if (f.endsWith('.js') && !keep.has(f)) await rm(join(dir, f));
  await rm(join(dir, 'i18n'), { recursive: true, force: true });
  await rm(join(dir, 'net'), { recursive: true, force: true });

  for (const css of ['style.css', 'rps.css']) {
    const p = join(dir, css);
    let text = await readFile(p, 'utf8');
    const urls = [...new Set([...text.matchAll(/url\(\s*["']?(vendor\/[\w./-]+\.svg)["']?\s*\)/g)].map((m) => m[1]))];
    for (const u of urls) {
      const svg = (await readFile(join(dir, u), 'utf8')).replace(/\s+/g, ' ').trim();
      text = text.replace(new RegExp(`url\\(\\s*["']?${u.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}["']?\\s*\\)`, 'g'), `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
    }
    await writeFile(p, text);
  }

  const index = await readFile(join(pub, 'index.html'), 'utf8');
  for (const page of pages) {
    let html = index
      .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta name="tcg-build" content="web">${page.head || ''}`)
      .replace('<script type="module" src="ui.js"></script>', `<script type="module" src="${page.script}"></script>`)
      .replace('<title>Pokémon TCG Academy</title>', page.title);
    if (!html.includes('name="tcg-build"') || !html.includes(`src="${page.script}"`)) throw new Error(`could not build ${page.to}`);
    await writeFile(join(dir, page.to), html);
  }
  if (!pages.some((p) => p.to === 'index.html')) await rm(join(dir, 'index.html'));
  return { rewritten };
}
