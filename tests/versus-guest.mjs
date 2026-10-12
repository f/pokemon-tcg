// The guest of tests/versus.mjs, in its own thread (like a second browser): it rebuilds its view from the host's
// messages and answers every prompt from that view alone. Sometimes it sends a bad answer first, to fuzz the host.
import { parentPort, workerData } from 'node:worker_threads';
import { loadDeck } from '../public/cards.js';
import { fallbackAction } from '../public/ai.js';
import { createSession } from '../public/net/session.js';
import { runGuest } from '../public/net/guest.js';

const { decks, fuzz } = workerData;
await Promise.all([loadDeck(decks.host), loadDeck(decks.guest)]);

const transport = {
  send: (m) => parentPort.postMessage(JSON.stringify(m)),
  onMessage: (h) => parentPort.on('message', (s) => h(JSON.parse(s))),
  close() {},
};
const session = createSession({ role: 'guest', transport });
const stats = { prompts: 0, unresolved: 0, snaps: 0, events: 0, logs: 0, junk: 0 };
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const realReply = session.reply;
session.reply = (id, value) => {
  if (fuzz && Math.random() < 0.05) { stats.junk++; realReply(id, pick(['zz', 'a999', ['x'], [1, 1, 1, 1, 1, 1, 1], 'none-of-these'])); }
  realReply(id, value);
};

runGuest(session, {
  onSnap: () => { stats.snaps++; },
  onLog: () => { stats.logs++; },
  onEvent: () => { stats.events++; },
  onPrompt: (view, p) => {
    stats.prompts++;
    const me = view.players[0];
    if (p.kind === 'action') {
      // Every card and Pokémon an action refers to must exist in the guest's view.
      for (const a of p.actions) for (const k of ['card', 'target', 'card2']) if (a[k] === null) stats.unresolved++;
      const a = Math.random() < 0.3 ? pick(p.actions) : fallbackAction(view, me, p.actions);
      return a.key;
    }
    if (p.kind === 'bench') return p.cards.map((c) => c.uid);
    for (const o of p.prompt.options) if (o.card === null || o.mon === null) stats.unresolved++;
    return pick(p.prompt.options).id;
  },
  onOver: (view, m) => parentPort.postMessage(JSON.stringify({ t: '__done', winner: m.winner, stats })),
  onError: (err) => parentPort.postMessage(JSON.stringify({ t: '__error', message: String(err?.stack || err) })),
}, { decks });
