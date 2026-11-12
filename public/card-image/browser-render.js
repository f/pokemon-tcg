import { configureLayout } from './flow.js';
import { materializeFace } from './layout.js';
import { checkCardImageAbort } from './request.js';
import { composeCardSvg } from './svg.js';

const canvas = (width, height) => Object.assign(document.createElement('canvas'), { width, height });
const workerUnavailable = Symbol('Card repair worker unavailable');

async function withImage(blob, use) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return await use(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function reconstruct(imageData, recipe, signal) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('card-image/repair-worker.js', document.baseURI), { type: 'module' });
    } catch {
      reject(workerUnavailable);
      return;
    }
    const finish = (result) => {
      worker.terminate();
      signal.removeEventListener('abort', abort);
      if (result.error) reject(new Error(result.error));
      else resolve(result);
    };
    const abort = () => finish({ error: 'Card image request canceled' });
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => finish(data);
    worker.onerror = () => {
      worker.terminate();
      signal.removeEventListener('abort', abort);
      reject(workerUnavailable);
    };
    const { width, height, data: rgba } = imageData;
    worker.postMessage({ width, height, rgba, recipe }, [rgba.buffer]);
  });
}

async function repairScan(readPixels, recipe, signal) {
  try {
    return await reconstruct(readPixels(), recipe, signal);
  } catch (error) {
    if (error !== workerUnavailable) throw error;
    const { repairImageData } = await import('./repair.js');
    checkCardImageAbort(signal);
    return repairImageData(readPixels(), recipe);
  }
}

function png(width, height, pixels) {
  const layer = canvas(width, height);
  layer.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), width, height), 0, 0);
  return layer.toDataURL('image/png');
}

export async function renderLocalizedCard(source, recipe, pack, signal) {
  checkCardImageAbort(signal);
  configureLayout({ energySymbols: pack.energySymbols });
  const font = pack.font.replace('sans-serif', '"Noto Sans CJK SC", "Microsoft YaHei", sans-serif');
  const layout = materializeFace({ recipe, font });
  return withImage(source, async (original) => {
    const width = Math.min(original.naturalWidth, 1024);
    const aspect = original.naturalHeight / original.naturalWidth;
    const height = Math.round(width * aspect);
    if (width < 600 || aspect < 1.2 || aspect > 1.6) throw new Error('English high-resolution scan unavailable');
    const scan = canvas(width, height);
    const ctx = scan.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(original, 0, 0, width, height);
    checkCardImageAbort(signal);
    const { patch, emblems } = await repairScan(() => ctx.getImageData(0, 0, width, height), layout, signal);
    const prepared = {
      source: scan.toDataURL('image/png'),
      aspect,
      patch: png(width, height, patch),
      emblems: Object.fromEntries(Object.entries(emblems).map(([name, { pixels, pixelWidth, pixelHeight, ...geometry }]) =>
        [name, { ...geometry, uri: png(pixelWidth, pixelHeight, pixels) }])),
    };
    const svg = composeCardSvg(prepared, layout, { width: 600, font });
    return withImage(new Blob([svg], { type: 'image/svg+xml' }), (image) => {
      checkCardImageAbort(signal);
      const output = canvas(image.naturalWidth, image.naturalHeight);
      output.getContext('2d').drawImage(image, 0, 0);
      return new Promise((resolve, reject) => output.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not encode localized card image'));
      }, 'image/webp', 0.9));
    });
  });
}
