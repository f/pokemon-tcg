import { inApp, webOnly } from '../api.js';
import { cachedCardImage, generatedImageRevision, pruneGeneratedCache } from './cache.js';
import { hasPrintedSource, hasPrintedDimensions, loadPrintedImage, printedResource, readPrintedResource } from './printed.js';
import { checkCardImageAbort, requestCardImage, waitForCardImage } from './request.js';

const indexes = new Map();

async function digest(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readIndex(kind, locale) {
  const key = kind + '/' + locale;
  if (!indexes.has(key)) {
    const url = new URL('card-image/data/' + key + '.json', document.baseURI);
    // One request serves all visible cards in this locale. Each caller can stop waiting independently.
    indexes.set(key, requestCardImage(url, async (response) => {
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Localized card index unavailable');
      const pack = await response.json();
      if (!pack?.cards || typeof pack.cards !== 'object' || Array.isArray(pack.cards)) {
        throw new Error('Invalid localized card index');
      }
      if (kind === 'recipes' && pack.versions && pack.rendererRevision) void pruneGeneratedCache(locale, pack);
      return pack;
    }).catch((error) => {
      indexes.delete(key);
      throw error;
    }));
  }
  return indexes.get(key);
}

async function requestPrinted(url, mime, signal) {
  checkCardImageAbort(signal);
  const kind = printedResource(new URL(url));
  if (kind && inApp) {
    const bytes = await window.__TAURI__.core.invoke('card_image_resource', { url });
    return new Blob([Array.isArray(bytes) ? Uint8Array.from(bytes) : bytes], { type: mime });
  }
  const target = kind && !webOnly ? '/api/card-image-resource?url=' + encodeURIComponent(url) : url;
  return requestCardImage(target, (response) => readPrintedResource(response, mime), { signal, redirect: 'error' });
}

async function download(candidate, signal) {
  return cachedCardImage('printed:' + candidate.sha256, async () => {
    checkCardImageAbort(signal);
    const blob = await loadPrintedImage(candidate, (url, mime) => requestPrinted(url, mime, signal));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!hasPrintedDimensions(bytes, candidate)) throw new Error('Printed card image has unexpected dimensions');
    if (await digest(bytes) !== candidate.sha256) {
      throw new Error('Printed card image differs from the reviewed source');
    }
    checkCardImageAbort(signal);
    return blob;
  });
}

async function readScan(url, signal) {
  return requestCardImage(url, (response) => {
    if (!response.ok) throw new Error('English card image unavailable');
    return response.blob();
  }, { signal });
}

async function generate(id, source, locale, recipe, pack, signal) {
  const version = pack.versions?.[id];
  const url = new URL(source, document.baseURI);
  const localScan = version?.scan && url.href === new URL(version.scan.path, document.baseURI).href;
  let blob;
  let scanRevision;
  if (localScan) {
    scanRevision = version.scan.hash;
    url.searchParams.set('v', scanRevision);
  } else {
    // Hosted scans may change at the same URL. Use the bytes returned by the browser's HTTP cache or CDN.
    blob = await readScan(url, signal);
    scanRevision = await digest(await blob.arrayBuffer());
  }
  // A localhost page can reload before the server has been restarted with the new manifest format.
  const recipeRevision = version?.recipe ?? await digest(new TextEncoder().encode(JSON.stringify([recipe, pack.font])));
  const revision = generatedImageRevision(pack.rendererRevision ?? pack.revision, recipeRevision, scanRevision);
  return cachedCardImage(`card:${locale}:${id}`, async () => {
    checkCardImageAbort(signal);
    const { renderLocalizedCard } = await import('./browser-render.js');
    const image = await renderLocalizedCard(blob ?? await readScan(url, signal), recipe, pack, signal);
    checkCardImageAbort(signal);
    return image;
  }, revision);
}

async function resolveLocalizedImage({ id, source }, { locale, downloads, generation, signal }) {
  let downloadError;
  if (downloads) {
    try {
      const printed = await readIndex('printed', locale);
      checkCardImageAbort(signal);
      for (const candidate of printed?.cards[id] ?? []) {
        if (!hasPrintedSource(candidate)) continue;
        try {
          return await download(candidate, signal);
        } catch (error) {
          checkCardImageAbort(signal);
          downloadError = error;
        }
      }
    } catch (error) {
      checkCardImageAbort(signal);
      downloadError = error;
    }
  }
  if (generation && source) {
    const pack = await readIndex('recipes', locale);
    checkCardImageAbort(signal);
    const recipe = pack && Object.hasOwn(pack.cards, id) && pack.cards[id];
    if (recipe) return generate(id, source, locale, recipe, pack, signal);
  }
  if (downloadError) throw downloadError;
}

export async function localizedCardImage(card, options) {
  if (options.locale === 'en' || options.signal.aborted) return;
  return waitForCardImage(resolveLocalizedImage(card, options), options.signal);
}
