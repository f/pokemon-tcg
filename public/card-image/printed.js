// Printed image references are reviewed by English printing ID.
export const minimumWidth = 600;
const minimumHeight = 825;
const png = [137, 80, 78, 71, 13, 10, 26, 10];
const pages = new Map();
const maxImageBytes = 20 * 1024 * 1024;
const requestTimeout = 6_000;
const articlePath = /^\/tcg\/(?:(?:product|other|campaign)\/)?\d+\.html$/;
const imageTypes = ['image/png', 'image/webp', 'image/jpeg'];

export function hasPrintedSource(image, width = minimumWidth) {
  if (!image || image.width < Math.max(width, minimumWidth) || image.height < minimumHeight ||
      !Number.isInteger(image.width) || !Number.isInteger(image.height) || !/^[0-9a-f]{64}$/.test(image.sha256) ||
      !imageTypes.includes('image/' + printedFormat(image))) return false;
  try {
    if (image.path) return printedResource(new URL(image.page)) === 'article' &&
      /^\/wp-content\/uploads\/[^?#]+$/.test(image.path);
    const url = new URL(image.url);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}

// The relay only covers the origins and path classes present in the reviewed catalog.
export function printedResource(url) {
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return;
  if (url.hostname === 'www.pokemon.cn' && articlePath.test(url.pathname) && !url.search) return 'article';
  if (url.hostname === 'image.pokemon.com.cn' && url.pathname.startsWith('/wp-content/uploads/')) return 'official';
  if (url.hostname === 'media.52poke.com' && url.pathname.startsWith('/wiki/')) return 'wiki';
  if (url.hostname === 'campaign-30th.pokemon.cn') return 'campaign';
  if (url.hostname === 'asia.pokemon-card.com' && /^\/tw\/card-img\/tw\d{8}\.png$/.test(url.pathname) && !url.search) return 'taiwan';
  if (url.hostname === 'assets.tcgdex.net' && !url.search &&
      /^\/(?:zh-tw|zh-cn|ja|es)\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/high\.(?:png|webp)$/.test(url.pathname)) return 'tcgdex';
  if (url.search) return;
  if (url.hostname === 'asia.pokemon-card.com' &&
      /^\/(?:tw|hk)\/archive\/special\/card\/[\w-]+\/assets\/images\/[\w-]+\.png$/.test(url.pathname)) return 'asia';
  if (url.hostname === 'www.pokemon-card.com' &&
      /^\/assets\/images\/card_images\/large\/[\w.-]+\/\d{6}_[A-Za-z0-9_-]+\.jpg$/.test(url.pathname)) return 'japan';
  if (url.hostname === 'limitlesstcg.nyc3.cdn.digitaloceanspaces.com' &&
      /^\/(?:tpc\/[\w.-]+\/[\w.-]+_JP|tpci\/[\w.-]+\/[\w.-]+_ES)\.png$/.test(url.pathname)) return 'limitless';
  if (url.hostname === 'cdn.malie.io' &&
      /^\/file\/malie-io\/tcgl\/cards\/png\/es\/[\w.-]+\/[\w.-]+\.png$/.test(url.pathname)) return 'malie';
  if (url.hostname === 'images.wikidexcdn.net' &&
      /^\/mwuploads\/wikidex\/[0-9a-f]\/[0-9a-f]{2}\/latest\/\d{14}\/[^/]+\.png$/.test(url.pathname)) return 'wikidex';
}

export function requestPrintedResource(url, kind) {
  const referer = kind === 'official' ? 'https://www.pokemon.cn/' : kind === 'wiki' ? 'https://wiki.52poke.com/' : undefined;
  return fetch(url, { ...(referer && { headers: { referer } }), redirect: 'error', signal: AbortSignal.timeout(requestTimeout) });
}

export async function readPrintedResource(response, type) {
  const mime = response.headers.get('content-type')?.split(';', 1)[0].trim();
  if (!response.ok || (type ? mime !== type : mime !== 'text/html' && !imageTypes.includes(mime)) ||
      Number(response.headers.get('content-length')) > maxImageBytes || !response.body) {
    await response.body?.cancel();
    throw new Error('Invalid printed card source response');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxImageBytes) throw new Error('Printed card resource exceeds the download limit');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return new Blob(chunks, { type: mime });
}

function articleImages(page, load) {
  const now = Date.now();
  const cached = pages.get(page);
  if (cached && cached.until > now) return cached.images;
  const images = load(page, 'text/html').then(async (article) => {
    const urls = new Map();
    for (const match of (await article.text()).matchAll(/\b(?:src|data-src)="(https:\/\/image\.pokemon\.com\.cn\/wp-content\/uploads\/[^"]+)"/g)) {
      const url = new URL(match[1].replace(/&(?:amp|#0*38);/g, '&'));
      const previous = urls.get(url.pathname);
      if (!previous || !previous.search && url.search) urls.set(url.pathname, url);
    }
    return urls;
  }).catch((error) => {
    pages.delete(page);
    throw error;
  });
  // The article supplies short-lived query signatures for these paths.
  pages.set(page, { until: now + 60_000, images });
  return images;
}

export const printedFormat = (image) => image.format ?? 'png';

function hasJpegDimensions(view, { width, height }) {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return false;
  let offset = 2;
  while (offset < view.byteLength && view.getUint8(offset++) === 0xff) {
    while (offset < view.byteLength && view.getUint8(offset) === 0xff) offset++;
    if (offset + 3 > view.byteLength) return false;
    const marker = view.getUint8(offset++);
    if (marker === 0xda || marker === 0xd9) return false;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > view.byteLength) return false;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return length >= 8 && view.getUint16(offset + 3) === height && view.getUint16(offset + 5) === width;
    }
    offset += length;
  }
  return false;
}

export function hasPrintedDimensions(bytes, image) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (printedFormat(image) === 'jpeg') return hasJpegDimensions(view, image);
  if (printedFormat(image) === 'png') {
    return bytes.length >= 24 && png.every((value, index) => bytes[index] === value) &&
      view.getUint32(16) === image.width && view.getUint32(20) === image.height;
  }
  if (bytes.length < 30 || ascii(0, 4) !== 'RIFF' || view.getUint32(4, true) + 8 !== bytes.length ||
      ascii(8, 12) !== 'WEBP') return false;
  const chunk = ascii(12, 16);
  let width, height;
  if (chunk === 'VP8X' && view.getUint32(16, true) === 10 && !(bytes[20] & 0x02)) {
    width = (view.getUint32(24, true) & 0xffffff) + 1;
    height = (bytes[27] | bytes[28] << 8 | bytes[29] << 16) + 1;
  } else if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const size = view.getUint32(21, true);
    width = (size & 0x3fff) + 1;
    height = ((size >>> 14) & 0x3fff) + 1;
  } else if (chunk === 'VP8 ' && (view.getUint32(23, true) & 0xffffff) === 0x2a019d) {
    width = view.getUint16(26, true) & 0x3fff;
    height = view.getUint16(28, true) & 0x3fff;
  }
  return width === image.width && height === image.height;
}

export async function loadPrintedImage(image, load) {
  if (!hasPrintedSource(image)) throw new Error('Missing reviewed printed card URL');
  const url = image.path ? (await articleImages(image.page, load)).get(image.path)?.href : image.url;
  if (!url) throw new Error('Printed card image is missing from its source page');
  return load(url, 'image/' + printedFormat(image));
}
