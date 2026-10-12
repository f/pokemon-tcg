// The guest's side of a two-player game (no DOM): it rebuilds its view of the game from the host's snapshots and
// replays everything strictly in order. `ui` decides how each step looks (ui.js) or plays it silently (tests).
import { DECKS } from '../cards.js';
import { cardFromWire, fromWire, restoreView } from './protocol.js';

export function runGuest(session, ui, { decks }) {
  let view = null;
  const queue = [];
  let busy = false;
  let asking = null; // the open question, cancelled when a restarted host says hello (its new game asks again)
  const allowed = new Set([decks.host, decks.guest]);
  const CANCELLED = Symbol('cancelled');

  session.listen((m) => {
    if (m.t === 'hello' && asking) asking();
    queue.push(m);
    pump();
  });

  async function pump() {
    if (busy) return;
    busy = true;
    try {
      while (queue.length) {
        const m = queue.shift();
        try { await handle(m, queue.length); } catch (err) { ui.onError?.(err, m); }
      }
    } finally { busy = false; }
  }

  async function handle(m, backlog) {
    switch (m.t) {
      case 'hello': return ui.onHello?.();
      case 'snap': {
        // Only the two decks of this match, in the guest's own order (guest first).
        const keys = m.s.players.map((p) => p.deckKey);
        if (keys[0] !== decks.guest || keys[1] !== decks.host || !keys.every((k) => allowed.has(k) && DECKS[k])) throw new Error('unexpected decks');
        view = restoreView(m.s);
        return ui.onSnap(view, backlog);
      }
      case 'log': return ui.onLog(m.e, backlog);
      case 'ev': return view && ui.onEvent(m.name, decodeEvent(view, m.name, m.a), view, backlog);
      case 'prompt': {
        if (!view) return;
        const cancelled = new Promise((resolve) => { asking = () => resolve(CANCELLED); });
        const value = await Promise.race([ui.onPrompt(view, decodePrompt(view, m)), cancelled]);
        asking = null;
        if (value === CANCELLED) return ui.onCancel?.();
        return session.reply(m.id, value);
      }
      case 'over': return ui.onOver(view, m);
      default: return undefined;
    }
  }
  return { get view() { return view; } };
}

function decodeEvent(view, name, a) {
  const out = { ...a };
  for (const k of ['card', 'from', 'to']) {
    if (a[k] && typeof a[k] === 'object' && 'uid' in a[k]) out[k] = cardFromWire(view, a[k]);
  }
  if (name === 'onPrize') return { p: view.players[a.p === 0 ? 0 : 1], card: a.card ? cardFromWire(view, a.card) : null };
  return out;
}

function decodePrompt(view, m) {
  if (m.kind === 'action') return { kind: 'action', actions: fromWire(view, m.actions) };
  if (m.kind === 'bench') return { kind: 'bench', cards: m.cards.map((c) => cardFromWire(view, c)).filter(Boolean) };
  return { kind: 'choose', prompt: fromWire(view, m.prompt) };
}
