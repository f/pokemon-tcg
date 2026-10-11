// Copies everything the game used to load from CDNs into public/vendor/ so it runs with no internet
// (the desktop app is offline-first): Lucide icons (ISC), duiker101's Pokémon type icons (MIT) and the
// Google Fonts it uses (OFL). Rewrites style.css, rps.css and index.html to the local copies.
// Run once after adding a new icon or font: node scripts/vendor-assets.mjs (safe to re-run).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const PUB = join(dirname(new URL(import.meta.url).pathname), '..', 'public');
const VENDOR = join(PUB, 'vendor');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

async function get(url, binary = false) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return binary ? Buffer.from(await res.arrayBuffer()) : res.text();
}
async function save(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}

// ---- icons referenced from the stylesheets ----
const ICON_RE = /url\((https:\/\/cdn\.jsdelivr\.net\/(?:npm\/lucide-static@[^/]+|gh\/duiker101\/pokemon-type-svg-icons@[^/]+)\/icons\/([a-z0-9-]+)\.svg)\)/g;
for (const css of ['style.css', 'rps.css']) {
  const file = join(PUB, css);
  let text = await readFile(file, 'utf8');
  const found = [...text.matchAll(ICON_RE)];
  for (const [, url, name] of found) {
    const dir = url.includes('duiker101') ? 'types' : 'lucide';
    const out = join(VENDOR, dir, `${name}.svg`);
    if (!existsSync(out)) await save(out, await get(url));
    text = text.replaceAll(url, `vendor/${dir}/${name}.svg`);
  }
  await writeFile(file, text);
  console.log(`${css}: ${found.length} icon references now local`);
}

// ---- Google Fonts (woff2 files + a local stylesheet) ----
let html = await readFile(join(PUB, 'index.html'), 'utf8');
const FONT_LINK = /<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)">\n?/g;
const links = [...html.matchAll(FONT_LINK)];
let fontCss = '/* Local copies of the Google Fonts the game uses (SIL Open Font License). Made by scripts/vendor-assets.mjs. */\n';
let n = 0;
for (const [tag, rawUrl] of links) {
  const url = rawUrl.replaceAll('&amp;', '&');
  let css = await get(url);
  for (const [, src] of css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)) {
    const name = `font-${++n}.woff2`;
    await save(join(VENDOR, 'fonts', name), await get(src, true));
    css = css.replaceAll(src, `fonts/${name}`);
  }
  fontCss += css + '\n';
  html = html.replace(tag, '');
}
if (links.length) {
  await save(join(VENDOR, 'fonts.css'), fontCss);
  html = html.replace('<link rel="preconnect" href="https://fonts.googleapis.com">\n', '');
  html = html.replace(/(\s*)<link rel="stylesheet" href="style.css">/, '$1<link rel="stylesheet" href="vendor/fonts.css">$1<link rel="stylesheet" href="style.css">');
  html = html.replace(/\s*<!-- Only the katakana sound effects[^>]*-->/, '');
  await writeFile(join(PUB, 'index.html'), html);
}
console.log(`fonts: ${links.length} stylesheet(s), ${n} font files`);
