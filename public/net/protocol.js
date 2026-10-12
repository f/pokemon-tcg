// Two-player games: what travels between the host (who runs the game) and the guest (who sees a view of it).
//
// Each screen shows its own player as seat 0, so everything the host sends the guest is MIRRORED (seat 0 ↔ seat 1).
// Everything the guest may not know is REDACTED before it leaves the host:
//   - cards in hidden zones (both decks, all Prize cards, the host's hand, and during setup the host's Pokémon) travel as
//     opaque tokens, fresh for every snapshot, never as real uids (a uid is assigned in deck-list order, so it would
//     name the card);
//   - log details only the host may see ({$secret}) are dropped, and lines with an `alt` read as the alt;
//   - a Prize card is revealed only to the player who took it.
// The guest answers prompts with plain values (an action key, an option id, card uids, heads/tails); the host checks
// every answer against the prompt it sent.
import { CARDS, MAX_BENCH } from '../cards.js';
import { Game, Mon } from '../engine.js';

export const PROTOCOL = 1;
export const HIDDEN = '__hidden';

// A face-down card in the guest's view. The board only ever shows it as a card back.
CARDS[HIDDEN] ??= { id: HIDDEN, name: '', kind: 'hidden', img: 'img/card-back.jpg', imgLarge: 'img/card-back.jpg' };

export const swapSeat = (i) => (i === 0 ? 1 : i === 1 ? 0 : i);

function randomTokens(n) {
  const seen = new Set();
  const out = [];
  const buf = new Uint32Array(Math.max(1, n * 2));
  while (out.length < n) {
    crypto.getRandomValues(buf);
    for (const r of buf) {
      if (out.length >= n) break;
      const uid = -1 - (r & 0x3fffffff);
      if (!seen.has(uid)) { seen.add(uid); out.push({ uid, id: HIDDEN }); }
    }
  }
  return out;
}

// ---------------- Mirroring and redaction (host side) ----------------

// Log/label params: seats in {$pl}, secrets ({$secret: {vis, v}}) and Rock-Paper-Scissors' `by`.
export function guestParams(v, depth = 0) {
  if (depth > 10 || v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => guestParams(x, depth + 1));
  if (v.$secret) {
    const vis = swapSeat(v.$secret.vis);
    return vis === 0 ? { $secret: { vis: 0, v: guestParams(v.$secret.v, depth + 1) } } : { $hidden: true };
  }
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === '$pl' && typeof x === 'number') out[k] = swapSeat(x);
    else if (k === 'by' && typeof x === 'number') out[k] = swapSeat(x);
    else out[k] = guestParams(x, depth + 1);
  }
  return out;
}

const KEY_SWAP = { 'coin.o.first.you': 'coin.o.first.opp', 'coin.o.first.opp': 'coin.o.first.you' };
const guestLabel = (l) => l && typeof l === 'object' ? { ...l, key: KEY_SWAP[l.key] || l.key, params: guestParams(l.params) } : l;

// A log line as the guest reads it.
export function guestLog(e) {
  const pl = typeof e.pl === 'number' ? swapSeat(e.pl) : e.pl;
  const key = e.alt && pl !== 0 ? e.alt : e.key;
  return {
    key, params: guestParams(e.params || {}), pl,
    kind: e.kind === 'you' ? 'opp' : e.kind === 'opp' ? 'you' : e.kind,
  };
}

const wireCard = (c) => (c ? { uid: c.uid, id: c.id } : null);

// The guest's snapshot of the game, mirrored and redacted.
export function guestSnapshot(game, guest = 1) {
  const s = game.serialize();
  const mine = s.players[guest], theirs = s.players[1 - guest];
  const setup = s.phase === 'setup';
  const faceDown = (m) => m && { id: m.id, stack: randomTokens(1), energy: [], tools: [], damage: 0, status: {}, effects: {}, used: {}, playedTurn: m.playedTurn };
  return {
    v: PROTOCOL,
    turn: s.turn, phase: s.phase, learned: s.learned,
    current: swapSeat(s.current), first: swapSeat(s.first),
    stadium: s.stadium && { card: s.stadium.card, owner: swapSeat(s.stadium.owner) },
    winner: game.winner ? (game.winner === 'draw' ? 'draw' : swapSeat(game.winner.idx)) : null,
    players: [
      { ...mine, deck: randomTokens(mine.deck.length), prizes: randomTokens(mine.prizes.length) },
      {
        ...theirs, hand: randomTokens(theirs.hand.length), deck: randomTokens(theirs.deck.length), prizes: randomTokens(theirs.prizes.length),
        ...(setup && { active: faceDown(theirs.active), bench: theirs.bench.map(faceDown) }),
      },
    ],
  };
}

// A game hook, as the guest replays it. Returns null for hooks the guest doesn't need.
export function guestEvent(name, args, guest = 1) {
  const a = args[0] || {};
  switch (name) {
    case 'onCoin': return { h: !!a.h, why: a.why, params: guestParams(a.params || {}), heads: guestLabel(a.heads), tails: guestLabel(a.tails) };
    case 'onRps': return { ...a, p: swapSeat(a.p), c: guestParams(a.c) };
    case 'onAttack': return { p: swapSeat(a.p), from: a.from, to: a.to, atk: a.atk, type: a.type };
    case 'onHit': return { from: a.from, to: a.to, n: a.n, notes: a.notes };
    case 'onAttackEnd': return {};
    case 'onAttach': return { p: swapSeat(a.p), mon: a.mon, card: wireCard(a.card) };
    case 'onEvolve': return { p: swapSeat(a.p), mon: a.mon, from: wireCard(a.from), to: wireCard(a.to) };
    case 'onBench': return { p: swapSeat(a.p), card: wireCard(a.card) };
    case 'onTrainer': return { p: swapSeat(a.p), card: wireCard(a.card), label: guestLabel(a.label) };
    case 'onPrize': {
      const p = swapSeat(args[0].idx);
      return { p, card: p === 0 ? wireCard(args[1]) : null };
    }
    default: return null;
  }
}

// Actions and prompt options on the wire: cards as {$c: {uid, id}}, Pokémon as {$m: id}; the decision model's English
// (`detail`, `en`) and the AI hints (`ai`) stay on the host.
export function toWire(v, depth = 0) {
  if (depth > 8) return null;
  if (v == null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
  if (v instanceof Mon) return { $m: v.id };
  if (Array.isArray(v)) return v.map((x) => toWire(x, depth + 1));
  if (typeof v.uid === 'number' && typeof v.id === 'string') return { $c: { uid: v.uid, id: v.id } };
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === 'detail' || k === 'en' || k === 'ai') continue;
    const w = toWire(x, depth + 1);
    if (w !== undefined) out[k] = w;
  }
  return out;
}

export function guestPrompt(kind, body) {
  if (kind === 'action') return { kind, actions: body.actions.map((a) => guestParams(toWire(a))) };
  if (kind === 'bench') return { kind, cards: body.cards.map(wireCard) };
  const p = body.prompt;
  return {
    kind, prompt: {
      kind: p.kind, title: p.title, text: p.text, params: guestParams(toWire(p.params || {})),
      options: p.options.map((o) => guestParams(toWire(o))),
    },
  };
}

// Is this the right kind of answer to this prompt? (Never trust the guest's value.)
export function validAnswer(kind, body, value) {
  if (kind === 'action') return typeof value === 'string' && body.actions.some((a) => a.key === value);
  if (kind === 'choose') return typeof value === 'string' && body.prompt.options.some((o) => o.id === value);
  if (kind === 'bench') {
    if (!Array.isArray(value) || value.length > MAX_BENCH) return false;
    const offered = new Set(body.cards.map((c) => c.uid));
    return value.every((u) => Number.isInteger(u) && offered.has(u)) && new Set(value).size === value.length;
  }
  return false;
}

// What the host does when the guest never gives a valid answer (or runs out of time).
export function defaultAnswer(kind, body) {
  if (kind === 'action') return (body.actions.find((a) => a.kind === 'end') || body.actions.at(-1)).key;
  if (kind === 'choose') return (body.prompt.options.find((o) => o.id === 'none') || body.prompt.options[0]).id;
  return [];
}

// ---------------- The guest's view ----------------

// Rebuild the guest's Game from a snapshot. Hidden cards become face-down placeholders.
export function restoreView(snap) {
  const view = Game.restore(snap, { controllers: [], hooks: {} });
  if (snap.winner === 'draw') view.winner = 'draw';
  else if (snap.winner === 0 || snap.winner === 1) view.winner = view.players[snap.winner];
  return view;
}

function findCard(view, uid) {
  for (const p of view.players) {
    for (const zone of [p.hand, p.discard, p.lost || []]) { const c = zone.find((x) => x.uid === uid); if (c) return c; }
    for (const m of [p.active, ...p.bench].filter(Boolean)) {
      const c = m.allCards().find((x) => x.uid === uid);
      if (c) return c;
    }
  }
  if (view.stadium?.card.uid === uid) return view.stadium.card;
  return null;
}
const findMon = (view, id) => view.players.flatMap((p) => [p.active, ...p.bench]).find((m) => m && m.id === id) || null;

// Turn wire values back into live objects of the guest's view (cards it can see, its Pokémon in play).
export function fromWire(view, v, depth = 0) {
  if (depth > 8 || v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => fromWire(view, x, depth + 1));
  if ('$m' in v) return findMon(view, v.$m);
  if (v.$c) {
    const { uid, id } = v.$c;
    if (!Number.isInteger(uid) || typeof id !== 'string' || !Object.hasOwn(CARDS, id)) return null;
    return findCard(view, uid) || { uid, ...CARDS[id] };
  }
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = fromWire(view, x, depth + 1);
  return out;
}

export const cardFromWire = (view, c) => (c && Number.isInteger(c.uid) && typeof c.id === 'string' && Object.hasOwn(CARDS, c.id) ? findCard(view, c.uid) || { uid: c.uid, ...CARDS[c.id] } : null);

// ---------------- Message shapes ----------------
// Host → guest: hello, snap, ev, log, prompt, over, ping. Guest → host: hello, answer, ping.
const isStr = (x, max = 200) => typeof x === 'string' && x.length <= max;
export function validFromHost(m) {
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return false;
  switch (m.t) {
    case 'hello': case 'ping': return true;
    case 'snap': return m.s && typeof m.s === 'object' && Array.isArray(m.s.players) && m.s.players.length === 2;
    case 'ev': return isStr(m.name, 40) && m.a && typeof m.a === 'object';
    case 'log': return m.e && isStr(m.e.key, 120);
    case 'prompt': return Number.isInteger(m.id) && ['action', 'choose', 'bench'].includes(m.kind);
    case 'over': return m.winner === 'draw' || m.winner === 0 || m.winner === 1;
    default: return false;
  }
}
export function validFromGuest(m) {
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return false;
  if (m.t === 'hello' || m.t === 'ping') return true;
  if (m.t === 'answer') return Number.isInteger(m.id) && (typeof m.value === 'string' || Array.isArray(m.value)) && JSON.stringify(m.value).length < 400;
  return false;
}
