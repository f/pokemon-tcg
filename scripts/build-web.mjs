// Builds site/: the hosted web version.
//   /        the landing page (web/), with the README screenshots and the app icon
//   /play/   the game from public/, CPU engine only (no server), card images from the public card image CDN
//   node scripts/build-web.mjs   then   sf publish site
// The card images are not copied: the deck files point at images.pokemontcg.io (and the few other sources listed
// in public/img/sources.json), the same places `npm run images` downloads them from.
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlay } from './lib/build-play.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'site'), play = join(site, 'play');

// SITE_URL: the production address (canonical links, sitemap, share image). Keep site/.spacefast: it links the folder
// to its Space, so the next `sf publish site` updates the same one.
const SITE_URL = (process.env.SITE_URL || 'https://pokemon.space.fast').replace(/\/$/, '');
for (const e of await readdir(site).catch(() => [])) if (e !== '.spacefast') await rm(join(site, e), { recursive: true, force: true });
const { rewritten } = await buildPlay(play, [{
  entry: 'ui.js', script: 'app.js', to: 'index.html',
  title: `<title>Play the Pokémon TCG in your browser · Pokémon TCG Academy</title>
  <meta name="description" content="Play the Pokémon Trading Card Game in your browser against Gary, with the Professor as your coach. 109 real decks, four languages.">
  <link rel="canonical" href="${SITE_URL}/play/">`,
}]);

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
