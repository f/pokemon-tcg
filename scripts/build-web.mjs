// Builds site/: the hosted web version.
//   /        the landing page (web/), with the README screenshots and the app icon
//   /play/   the game from public/, CPU engine only (no server), card images from the public card image CDN
//   node scripts/build-web.mjs   then   sf publish site
// The card images are not copied: the deck files point at images.pokemontcg.io (and the few other sources listed
// in public/img/sources.json), the same places `npm run images` downloads them from.
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public'), site = join(root, 'site'), play = join(site, 'play');
const CDN = 'https://images.pokemontcg.io/';
const sources = JSON.parse(await readFile(join(pub, 'img', 'sources.json'), 'utf8'));
// img/cards/<set>/<n>[_hires].webp → the remote PNG it was made from.
const remote = (local) => { const png = local.replace(/\.webp$/, '.png'); return sources[png] || CDN + png.slice('img/cards/'.length); };
const CARD_PATH = /img\/cards\/[\w./-]+?\.(?:webp|png)/g;

// SITE_URL: the production address (canonical links, sitemap, share image). Keep site/.spacefast: it links the folder
// to its Space, so the next `sf publish site` updates the same one.
const SITE_URL = (process.env.SITE_URL || 'https://pokemon.space.fast').replace(/\/$/, '');
for (const e of await readdir(site).catch(() => [])) if (e !== '.spacefast') await rm(join(site, e), { recursive: true, force: true });
await cp(pub, play, {
  recursive: true,
  filter: (src) => {
    const rel = src.slice(pub.length + 1);
    return !(rel === join('img', 'cards') || rel.startsWith(`img${sep}cards${sep}`) || rel === join('img', 'sources.json') || rel.endsWith('.DS_Store'));
  },
});

// Point every card image at its remote source: the deck files, the deck index and the How to play pages.
let rewritten = 0;
const unknown = new Set();
async function rewrite(file) {
  const text = await readFile(file, 'utf8');
  const out = text.replace(CARD_PATH, (p) => { rewritten++; const r = remote(p); if (!/^https:\/\//.test(r)) unknown.add(p); return r; });
  if (out !== text) await writeFile(file, out);
}
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else if (['.json', '.js', '.html', '.css'].includes(extname(p))) await rewrite(p);
  }
}
await walk(play);
if (unknown.size) throw new Error(`no remote source for: ${[...unknown].slice(0, 5).join(', ')}`);

// A static host limits bursts of requests (Spacefast answers 429), and a module that fails to load stops the game.
// So the web build makes few requests: the classic decks in one file, the game's modules in one script, and the
// icons inside the stylesheets. The source stays the same files the app and the dev server use.
const decksDir = join(play, 'data', 'decks');
const deckIndex = JSON.parse(await readFile(join(decksDir, 'index.json'), 'utf8'));
const classic = {};
for (const k of deckIndex.decks) classic[k] = JSON.parse(await readFile(join(decksDir, k, 'cards.json'), 'utf8'));
await writeFile(join(decksDir, 'classic.json'), JSON.stringify(classic));
await writeFile(join(decksDir, 'index.json'), JSON.stringify({ ...deckIndex, classicBundle: 'classic.json' }, null, 2) + '\n');

await esbuild.build({
  entryPoints: [join(play, 'ui.js')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  external: ['node:*'], minify: true, legalComments: 'none', outfile: join(play, 'app.js'), logLevel: 'warning',
});
for (const f of await readdir(play)) if (f.endsWith('.js') && f !== 'app.js') await rm(join(play, f));
await rm(join(play, 'i18n'), { recursive: true, force: true });

for (const css of ['style.css', 'rps.css']) {
  const p = join(play, css);
  let text = await readFile(p, 'utf8'), inlined = 0;
  const urls = [...new Set([...text.matchAll(/url\(\s*["']?(vendor\/[\w./-]+\.svg)["']?\s*\)/g)].map((m) => m[1]))];
  for (const u of urls) {
    const svg = (await readFile(join(play, u), 'utf8')).replace(/\s+/g, ' ').trim();
    text = text.replace(new RegExp(`url\\(\\s*["']?${u.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}["']?\\s*\\)`, 'g'), `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
    inlined++;
  }
  await writeFile(p, text);
  console.log(`${css}: ${inlined} icons inlined`);
}

// Mark the page as the web build: api.js then answers with the CPU engine and never calls a server.
const indexFile = join(play, 'index.html');
const index = await readFile(indexFile, 'utf8');
await writeFile(indexFile, index
  .replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta name="tcg-build" content="web">')
  .replace('<script type="module" src="ui.js"></script>', '<script type="module" src="app.js"></script>')
  .replace('<title>Pokémon TCG Academy</title>', `<title>Play the Pokémon TCG in your browser · Pokémon TCG Academy</title>
  <meta name="description" content="Play the Pokémon Trading Card Game in your browser against Gary, with the Professor as your coach. 109 real decks, four languages.">
  <link rel="canonical" href="${SITE_URL}/play/">`));
const marked = await readFile(indexFile, 'utf8');
if (!marked.includes('name="tcg-build"') || !marked.includes('src="app.js"')) throw new Error('could not mark play/index.html as the web build');

// The landing page, its screenshots and the app icon. __VERSION__ becomes the app version (the DMG link names it).
await cp(join(root, 'web'), site, { recursive: true });
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
for (const f of ['index.html', 'landing.js', 'robots.txt', 'sitemap.xml']) {
  const p = join(site, f);
  await writeFile(p, (await readFile(p, 'utf8')).replaceAll('__VERSION__', version).replaceAll('__SITE_URL__', SITE_URL));
}
// Screenshots at two widths (the page picks one with srcset), and a 1200x630 share image.
await mkdir(join(site, 'screenshots'), { recursive: true });
await cp(join(root, 'docs', 'screenshots'), join(site, 'screenshots'), { recursive: true });
for (const f of await readdir(join(site, 'screenshots'))) {
  if (!f.endsWith('.webp')) continue;
  const png = join(site, 'screenshots', f.replace('.webp', '.tmp.png'));
  execFileSync('dwebp', ['-quiet', join(site, 'screenshots', f), '-o', png]);
  execFileSync('cwebp', ['-quiet', '-q', '86', '-resize', '800', '0', png, '-o', join(site, 'screenshots', f.replace('.webp', '-800.webp'))]);
  if (f === 'board.webp') {
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '-Z', '1200', png, '--out', join(site, 'og.jpg')], { stdio: 'ignore' });
    execFileSync('sips', ['-c', '630', '1200', join(site, 'og.jpg')], { stdio: 'ignore' });
  }
  await rm(png);
}
for (const size of [256, 64]) {
  execFileSync('sips', ['-Z', String(size), join(root, 'src-tauri', 'icons', 'icon.png'), '--out', join(site, `icon-${size}.png`)], { stdio: 'ignore' });
}
console.log(`site/ ready for ${SITE_URL}: ${rewritten} card image paths point at their remote sources`);
