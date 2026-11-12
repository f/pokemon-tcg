import { localizedCardImage } from './source.js';

const selector = '[data-card-image]';
const escape = (value) => String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
const bindings = new WeakMap();
const limit = 3;
let active = 0;
let state = { locale: 'en', downloads: false, generation: false };

function attributes(card, { large = false, upgrade = false, background = false } = {}) {
  const source = card.imgLarge;
  const original = large ? source || card.img : card.img || source;
  return {
    ...(background ? {} : { src: original }),
    'data-card-image': card.id,
    'data-card-original': original,
    'data-card-source': source,
    'data-card-upgrade': upgrade && source ? source : undefined,
  };
}

export function cardImageAttrs(card, options) {
  const attrs = attributes(card, options);
  const ready = state.ready?.get(imageKey(card.id, card.imgLarge));
  if (ready && attrs.src) attrs.src = ready;
  return Object.entries(attrs)
    .filter(([, value]) => value != null).map(([key, value]) => `${key}="${escape(value)}"`).join(' ');
}

export function bindCardImage(img, card, options) {
  for (const [key, value] of Object.entries(attributes(card, options))) {
    if (value == null) img.removeAttribute(key);
    else img.setAttribute(key, value);
  }
  track(img);
}

function paint(el, src) {
  if (el.tagName === 'IMG') {
    if (el.getAttribute('src') !== src) el.setAttribute('src', src);
  } else {
    el.style.backgroundImage = 'url(' + JSON.stringify(src) + ')';
  }
}

function drain() {
  while (active < limit && state.queue?.length) {
    const { run } = state.queue.shift();
    active++;
    run().finally(() => { active--; drain(); });
  }
}

const imageKey = (id, source) => id + ':' + (source ?? '');

function lookup(id, source, current) {
  const key = imageKey(id, source);
  if (!current.images.has(key)) {
    current.images.set(key, new Promise((resolve, reject) => {
      current.queue.push({
        cancel: () => resolve(),
        async run() {
          try {
            const blob = await localizedCardImage({ id, source }, current);
            if (blob && !current.signal.aborted) {
              const url = URL.createObjectURL(blob);
              current.ready.set(key, url);
              return resolve(url);
            }
            resolve();
          } catch (error) {
            current.images.delete(key);
            reject(error);
          }
        },
      });
      drain();
    }));
  }
  return current.images.get(key);
}

const observer = new IntersectionObserver((entries) => {
  for (const { target, isIntersecting } of entries) {
    if (!isIntersecting) continue;
    observer.unobserve(target);
    const binding = bindings.get(target);
    if (binding?.state !== state || !target.isConnected) continue;
    lookup(binding.id, binding.source, binding.state).then((url) => {
      if (!url || !target.isConnected || bindings.get(target) !== binding || state !== binding.state) return;
      binding.localized = true;
      paint(target, url);
    }).catch(() => {
      // Retry a temporary failure once while this card is still visible in the same settings.
      if (binding.retried || state !== binding.state) return;
      binding.retried = true;
      setTimeout(() => {
        if (target.isConnected && bindings.get(target) === binding && state === binding.state) observer.observe(target);
      }, 1000);
    });
  }
});

function track(el) {
  const { cardImage: id, cardOriginal: original, cardSource: source, cardUpgrade: upgrade } = el.dataset;
  if (!id || !original) return;
  const previous = bindings.get(el);
  if (previous?.state === state && previous.id === id && previous.original === original &&
      previous.source === source && previous.upgrade === upgrade) return;
  const ready = state.ready?.get(imageKey(id, source));
  const binding = { id, original, source, upgrade, state, localized: Boolean(ready) };
  bindings.set(el, binding);
  observer.unobserve(el);
  paint(el, ready ?? original);
  if (upgrade && upgrade !== original && !ready) {
    const hi = new Image();
    hi.src = upgrade;
    hi.decode().then(() => {
      if (bindings.get(el) === binding && !binding.localized) paint(el, upgrade);
    }).catch(() => {});
  }
  if (!ready && state.locale !== 'en' && (state.downloads || state.generation)) observer.observe(el);
}

function forEachCard(node, apply) {
  if (node.nodeType !== 1) return;
  if (node.matches(selector)) apply(node);
  node.querySelectorAll(selector).forEach(apply);
}

new MutationObserver((entries) => {
  for (const entry of entries) {
    if (entry.type === 'attributes') { track(entry.target); continue; }
    entry.removedNodes.forEach((node) => forEachCard(node, (el) => {
      if (!el.isConnected) { observer.unobserve(el); bindings.delete(el); }
    }));
    entry.addedNodes.forEach((node) => forEachCard(node, (el) => { if (el.isConnected) track(el); }));
  }
}).observe(document.body, {
  childList: true, subtree: true, attributes: true,
  attributeFilter: ['data-card-image', 'data-card-original', 'data-card-source', 'data-card-upgrade'],
});

export function refreshCardImages(locale, downloads, generation, retry = false) {
  if (locale === 'en') {
    downloads = false;
    generation = false;
    retry = false;
  }
  if (!retry && state.locale === locale && state.downloads === downloads && state.generation === generation) return;
  const previous = state;
  previous.controller?.abort();
  previous.queue?.splice(0).forEach(({ cancel }) => cancel());
  const controller = new AbortController();
  state = { locale, downloads, generation, controller, signal: controller.signal, ready: new Map(), images: new Map(), queue: [] };
  document.querySelectorAll(selector).forEach(track);
  previous.ready?.forEach((url) => URL.revokeObjectURL(url));
}
