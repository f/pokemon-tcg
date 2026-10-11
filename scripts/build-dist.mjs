// Builds dist/: what the macOS app ships. It is public/ without what only the browser/dev setup needs:
// the card PNGs (the game uses the .webp copies; see scripts/webp-images.mjs) and the image source list.
//   node scripts/build-dist.mjs   (run by `npm run app:build` / Tauri before bundling)
import { cp, rm, stat } from 'node:fs/promises';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'public'), to = join(root, 'dist');
await rm(to, { recursive: true, force: true });
let skipped = 0;
await cp(from, to, {
  recursive: true,
  filter: (src) => {
    const rel = src.slice(from.length + 1);
    const skip = (rel.startsWith(`img${sep}cards${sep}`) && rel.endsWith('.png')) || rel === join('img', 'sources.json') || rel.endsWith('.DS_Store');
    if (skip) skipped++;
    return !skip;
  },
});
const size = async (p) => { const s = await stat(p); return s.size; };
console.log(`dist/ ready (${skipped} files left out)`);
