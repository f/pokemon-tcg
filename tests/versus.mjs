// Two-player games, headless: the host runs the engine here, the guest runs in a worker thread (tests/versus-guest.mjs)
// and only ever sees what the host sends it. Checks that every game finishes, that the guest can answer every prompt
// from its own view, and that nothing the guest may not know leaves the host:
//   - no real card uid outside the zones the guest can see (its hand, both discard piles and Lost Zones, Pokémon in
//     play except the host's during setup, the Stadium), apart from cards a prompt shows the guest;
//   - no {$secret} meant for the host.
//   node tests/versus.mjs [games=200]
import { Worker } from 'node:worker_threads';
import { Game } from '../public/engine.js';
import { fallbackAction } from '../public/ai.js';
import { DECKS, loadDeck } from '../public/cards.js';
import { createSession } from '../public/net/session.js';
import { RemoteController, forwardHooks } from '../public/net/host.js';

const GAMES = Number(process.argv[2] || 200);
const keys = Object.keys(DECKS);
const formatOf = (k) => DECKS[k].format || 'classic';
const bot = {
  chooseAction: async (g, p, a) => (Math.random() < 0.3 ? a[Math.floor(Math.random() * a.length)] : fallbackAction(g, p, a)),
  choose: async (g, p, pr) => pr.options[Math.floor(Math.random() * pr.options.length)].id,
  setupBench: async (g, p, b) => b.map((c) => c.uid),
  callCoin: async () => (Math.random() < 0.5 ? 'heads' : 'tails'),
};

function visibleToGuest(g) {
  const [host, guest] = g.players;
  const ids = new Set(guest.hand.map((c) => c.uid));
  for (const p of g.players) {
    for (const c of [...p.discard, ...(p.lost || [])]) ids.add(c.uid);
    if (p === host && g.phase === 'setup') continue;
    for (const m of g.allMons(p)) for (const c of m.allCards()) ids.add(c.uid);
  }
  if (g.stadium) ids.add(g.stadium.card.uid);
  return ids;
}

function uidsIn(json) {
  const out = [];
  for (const m of json.matchAll(/"uid":(\d+)/g)) out.push(Number(m[1]));
  return out;
}

let failures = 0, finished = 0, totalBytes = 0, maxMsg = 0, prompts = 0, junk = 0, unresolved = 0;
for (let i = 0; i < GAMES; i++) {
  const a = keys[(i * 13) % keys.length];
  const same = keys.filter((k) => formatOf(k) === formatOf(a));
  const decks = { host: a, guest: same[(i * 7 + 3) % same.length] };
  await Promise.all([loadDeck(decks.host), loadDeck(decks.guest)]);
  const worker = new Worker(new URL('./versus-guest.mjs', import.meta.url), { workerData: { decks, fuzz: i % 3 === 0 } });

  let game = null;
  const shownByPrompt = new Set();
  const leaks = [];
  const done = new Promise((resolve, reject) => {
    worker.on('message', (s) => {
      const m = JSON.parse(s);
      if (m.t === '__done') resolve(m);
      if (m.t === '__error') reject(new Error('guest: ' + m.message));
    });
    worker.on('error', reject);
  });
  const transport = {
    send(m) {
      const json = JSON.stringify(m);
      totalBytes += json.length;
      maxMsg = Math.max(maxMsg, json.length);
      if (game) {
        if (m.t === 'prompt') for (const u of uidsIn(json)) shownByPrompt.add(u);
        // A card being played (a Trainer, an attached Energy, a benched or evolved Pokémon) is revealed by the play itself,
        // a moment before it lands in a public zone. A Prize card is the exception: only its owner may see it.
        if (m.t === 'ev' && (m.name !== 'onPrize' || m.a.p === 0)) for (const u of uidsIn(json)) shownByPrompt.add(u);
        if (m.t === 'ev' && m.name === 'onPrize' && m.a.p !== 0 && m.a.card) leaks.push('the host\'s Prize card reached the guest');
        const visible = visibleToGuest(game);
        for (const u of uidsIn(json)) if (!visible.has(u) && !shownByPrompt.has(u)) leaks.push(`${m.t}${m.name ? ':' + m.name : ''} uid ${u}`);
        const secrets = [...json.matchAll(/"\$secret":\{"vis":(\d)/g)].filter((x) => x[1] !== '0');
        if (secrets.length) leaks.push(`${m.t} carries a host secret`);
      }
      worker.postMessage(json);
    },
    onMessage(h) { worker.on('message', (s) => { const m = JSON.parse(s); if (!m.t.startsWith('__')) h(m); }); },
    close() {},
  };
  const session = createSession({ role: 'host', transport, decisionMs: 20000 });
  game = new Game({ decks: [decks.host, decks.guest], controllers: [bot, new RemoteController(session)], hooks: forwardHooks({}, session) });
  try {
    await game.run();
    const res = await Promise.race([done, new Promise((_, r) => setTimeout(() => r(new Error('guest never saw the end')), 20000))]);
    const expected = game.winner === 'draw' ? 'draw' : 1 - game.winner.idx;
    if (res.winner !== expected) throw new Error(`guest saw winner ${res.winner}, expected ${expected}`);
    prompts += res.stats.prompts; junk += res.stats.junk; unresolved += res.stats.unresolved;
    if (leaks.length) throw new Error(`leaks: ${[...new Set(leaks)].slice(0, 5).join('; ')}`);
    finished++;
  } catch (err) {
    failures++;
    console.log(`game ${i} (${decks.host} vs ${decks.guest}):`, err.message);
  } finally {
    session.close();
    await worker.terminate();
  }
}
console.log(JSON.stringify({ games: GAMES, finished, failures, prompts, junkAnswers: junk, unresolvedRefs: unresolved, avgKB: Math.round(totalBytes / GAMES / 1024), maxMsgKB: Math.round(maxMsg / 1024) }));
if (failures) process.exit(1);
