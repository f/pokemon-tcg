import { readFileSync } from 'node:fs';
import { hasPrintedSource, loadPrintedImage, printedResource, requestPrintedResource, readPrintedResource } from '../../public/card-image/printed.js';
export { printedFormat, hasPrintedDimensions } from '../../public/card-image/printed.js';

const indexes = new Map();

export function printedCandidates(locale, id, width) {
  if (!/^[a-z]{2,3}(?:-[A-Z][a-zA-Z]+)?$/.test(locale)) return [];
  if (!indexes.has(locale)) {
    let cards;
    try {
      const index = JSON.parse(readFileSync(new URL('./data/printed/' + locale + '.json', import.meta.url), 'utf8'));
      if (index.version !== 1) throw new Error('Unsupported printed card image index for ' + locale);
      cards = index.cards;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    indexes.set(locale, cards ?? {});
  }
  const cards = indexes.get(locale);
  const candidates = Object.hasOwn(cards, id) ? cards[id] : [];
  return candidates.filter(image => hasPrintedSource(image, width));
}

export async function fetchPrintedImage(image) {
  const blob = await loadPrintedImage(image, async (url, type) =>
    readPrintedResource(await requestPrintedResource(url, printedResource(new URL(url))), type));
  return Buffer.from(await blob.arrayBuffer());
}
