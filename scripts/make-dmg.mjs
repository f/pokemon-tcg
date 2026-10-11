// Packs the built app into a compressed DMG (the app and a link to Applications), with plain hdiutil — no
// Finder/AppleScript step, so it also works on CI and in sandboxed shells.
//   node scripts/make-dmg.mjs   (after `tauri build --bundles app`; `npm run app:build` does both)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, cpSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const name = conf.productName, version = conf.version;
const app = join(root, 'src-tauri', 'target', 'release', 'bundle', 'macos', `${name}.app`);
const outDir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'dmg');
const out = join(outDir, `${name.replaceAll(' ', '-')}_${version}_aarch64.dmg`);

const stage = mkdtempSync(join(tmpdir(), 'pokemon-tcg-dmg-'));
cpSync(app, join(stage, `${name}.app`), { recursive: true, verbatimSymlinks: true });
symlinkSync('/Applications', join(stage, 'Applications'));
mkdirSync(outDir, { recursive: true });
rmSync(out, { force: true });
execFileSync('hdiutil', ['create', '-volname', name, '-srcfolder', stage, '-fs', 'HFS+', '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-ov', out], { stdio: 'inherit' });
rmSync(stage, { recursive: true, force: true });
console.log(out);
