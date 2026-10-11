// Decks and cards. Each deck lives in data/decks/<deck>/cards.json: its cards with their counts, stats and images,
// plus how each attack (`effect`), Pokémon Power (`power.kind`) and Trainer (`trainer`) works.
// data/decks/index.json lists the decks in the order they appear in the deck chooser.

export const TYPES = {
  Grass: { color: '#3f9b4a' },
  Fire: { color: '#e5562f' },
  Water: { color: '#3a8ee0' },
  Lightning: { color: '#f2c12e' },
  Psychic: { color: '#9c5bc0' },
  Fighting: { color: '#b8642f' },
  Colorless: { color: '#bdb8aa' },
  Darkness: { color: '#3b4a5a' },
  Metal: { color: '#8b98a5' },
  Dragon: { color: '#b0912f' },
};

export const CARD_BACK = 'img/card-back.jpg';
export const POKEMON_LOGO = 'img/pokemon-logo.svg';
export const SET_LOGO = 'img/set-logo.png';
export const SET_SYMBOL = 'img/set-symbol.png';

export const PRIZES = 6;
export const HAND_SIZE = 7;
export const MAX_BENCH = 5;

// Load JSON in the browser (fetch) and in Node (tests and simulations). A busy host can answer 429 or 5xx for a
// moment: try again a few times, waiting a little longer each time.
async function loadJSON(rel) {
  const url = new URL(rel, import.meta.url);
  if (typeof window === 'undefined') {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(url, 'utf8'));
  }
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (attempt === 4 || ![429, 500, 502, 503, 504].includes(res.status)) throw new Error(`${res.status} loading ${rel}`);
    await new Promise((r) => setTimeout(r, 300 * 2 ** attempt + Math.random() * 300));
  }
}

const index = await loadJSON('./data/decks/index.json');
const { decks: deckKeys, groups } = index;
// Sections of the deck chooser, in order (each deck file names its group).
export const DECK_GROUPS = groups || ['trainer', 'theme'];
// Modern (Scarlet & Violet) decks: only their summary is in index.json; the cards load when the deck is picked.
export const MODERN_GROUPS = index.modernGroups || [];
// The classic decks load at start. The hosted web build puts them in one file (index.classicBundle: { key: deck }),
// so the page makes one request instead of one per deck.
const deckFiles = index.classicBundle
  ? await loadJSON(`./data/decks/${index.classicBundle}`).then((all) => deckKeys.map((k) => all[k]))
  : await Promise.all(deckKeys.map((k) => loadJSON(`./data/decks/${k}/cards.json`)));

function prepare(c) {
  const card = { ...c };
  delete card.count;
  if (c.kind === 'pokemon') {
    card.attacks = c.attacks.map((a) => ({ ...a, base: parseInt(a.damage, 10) || 0, fx: a.effect || {} }));
    if (c.power?.kind) card.powerKind = c.power.kind;
  }
  if (c.kind === 'trainer') {
    card.tkind = c.trainer;
    // Technical Machines carry an attack the Pokémon can use.
    if (c.attacks) card.attacks = c.attacks.map((a) => ({ ...a, base: parseInt(a.damage, 10) || 0, fx: a.effect || {} }));
  }
  return card;
}

// Every card used by any deck, by id (shared cards like Energy appear in several deck files).
export const CARDS = {};
export const DECKS = {};
deckKeys.forEach((key, i) => {
  const d = deckFiles[i];
  for (const c of d.cards) CARDS[c.id] ??= prepare(c);
  DECKS[key] = { name: d.name, group: d.group, format: d.format || 'classic', types: d.types, featured: d.featured, list: Object.fromEntries(d.cards.map((c) => [c.id, c.count])) };
});
for (const s of index.modern || [])
  DECKS[s.key] = { name: s.name, group: s.group, format: 'modern', types: s.types, featured: s.featured.map((f) => f.id), featuredImgs: s.featured.map((f) => f.img), counts: s.counts, lazy: true };

// Load a deck's cards if they aren't loaded yet (modern decks). Safe to call for any deck.
const loading = {};
export function loadDeck(key) {
  const d = DECKS[key];
  if (!d?.lazy) return Promise.resolve(d);
  loading[key] ??= loadJSON(`./data/decks/${key}/cards.json`).then((file) => {
    for (const c of file.cards) CARDS[c.id] ??= prepare(c);
    d.list = Object.fromEntries(file.cards.map((c) => [c.id, c.count]));
    d.lazy = false;
    return d;
  });
  return loading[key];
}
