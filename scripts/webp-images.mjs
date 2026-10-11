// Turns the downloaded card images into WebP (with transparency) and points the deck files at them.
//   node scripts/webp-images.mjs        (needs `cwebp`: brew install webp)
// Large card images are scaled to 600 px wide (sharp at 2× in the biggest preview); small ones keep their size.
// The PNGs stay where they are (scripts/fetch-images.mjs downloads them); only the .webp files ship.
// Safe to re-run: existing .webp files are kept.
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const cards = join(root, 'img', 'cards');
const exists = (p) => stat(p).then(() => true, () => false);

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.png')) yield p;
  }
}

const todo = [];
for await (const png of walk(cards)) {
  const webp = png.replace(/\.png$/, '.webp');
  if (!(await exists(webp))) todo.push([png, webp]);
}
let done = 0;
const workers = Array.from({ length: Math.max(2, cpus().length - 1) }, async () => {
  while (todo.length) {
    const [png, webp] = todo.pop();
    const big = png.endsWith('_hires.png');
    await run('cwebp', ['-quiet', '-q', '82', '-alpha_q', '90', ...(big ? ['-resize', '600', '0'] : []), png, '-o', webp]);
    if (++done % 200 === 0) console.log(`${done} converted`);
  }
});
await Promise.all(workers);
console.log(`converted ${done} images`);

// Deck files: every card image path → .webp
const decksDir = join(root, 'data', 'decks');
const toWebp = (s) => s.replace(/(img\/cards\/[^"]+?)\.png"/g, '$1.webp"');
let files = 0;
for (const e of await readdir(decksDir, { withFileTypes: true })) {
  const f = e.isDirectory() ? join(decksDir, e.name, 'cards.json') : e.name.endsWith('.json') ? join(decksDir, e.name) : null;
  if (!f || !(await exists(f))) continue;
  const text = await readFile(f, 'utf8'), next = toWebp(text);
  if (next !== text) { await writeFile(f, next); files++; }
}
console.log(`updated ${files} deck files`);
