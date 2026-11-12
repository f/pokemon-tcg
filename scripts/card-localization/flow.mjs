import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureLayout, iconFiles } from '../../public/card-image/flow.js';
export * from '../../public/card-image/flow.js';

const probes = new Map();
const chars = Array.from({ length: 95 }, (_, index) => String.fromCodePoint(index + 32)).join('') +
  'áéíóúüñÁÉÍÓÚÜÑçğıöşÇĞİÖŞ　中文，。；：、（）、《》「」！？—×’';
const sampleSize = 40;

// Measure the font used by librsvg once per process. CJK ideographs share the
// measured ideograph advance. Reserve a little room for shaped Latin runs.
function pangoMetrics(font, weight) {
  const family = font.split(',')[0];
  const key = family + ':' + (weight >= 700 ? 'bold' : 'regular');
  if (probes.has(key)) return probes.get(key);
  const temp = mkdtempSync(join(tmpdir(), 'tcg-card-font-'));
  try {
    const output = join(temp, 'layout.json');
    const lines = [...new Set(chars)].join('').match(/.{1,40}/gu).join('\n');
    execFileSync('pango-view', [
      '--no-display', '--pixels', '--margin=0', '--font=' + family + (weight >= 700 ? ' Bold ' : ' ') + sampleSize,
      '--serialize-to=' + output, '--text=' + lines,
    ], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 10_000 });
    const advances = new Map();
    for (const line of JSON.parse(readFileSync(output, 'utf8')).output.lines) {
      for (const run of line.runs) {
        const source = Buffer.from(run.text);
        const clusters = new Map();
        for (const glyph of run.glyphs) {
          clusters.set(glyph['log-cluster'], (clusters.get(glyph['log-cluster']) ?? 0) + glyph.width);
        }
        const offsets = [...clusters.keys()].sort((a, b) => a - b);
        for (const [index, offset] of offsets.entries()) {
          const value = source.subarray(offset, offsets[index + 1] ?? source.length).toString();
          if ([...value].length === 1 && clusters.get(offset)) {
            advances.set(value, clusters.get(offset) / 1024 / sampleSize);
          }
        }
      }
    }
    probes.set(key, advances);
    return advances;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export const energySymbols = Object.fromEntries(Object.entries(iconFiles).map(([key, file]) => {
  const svg = readFileSync(new URL('../../public/vendor/types/' + file + '.svg', import.meta.url), 'utf8');
  const ink = Buffer.from(svg.replaceAll('fill="white"', 'fill="#161617"')).toString('base64');
  return [key, '<image x="2.4" y="2.4" width="7.2" height="7.2" href="data:image/svg+xml;base64,' + ink + '"/>'];
}));

configureLayout({ fontMetrics: pangoMetrics, energySymbols });
