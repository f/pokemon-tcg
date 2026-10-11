// Full games with a decision model as the opponent (Gary). Player 0 is the CPU engine (standing in for you,
// with some random moves to reach unusual situations).
// Model: Kev, the local model server (LOCAL_PORT, default 8009 — the one the game server starts), called directly so
// the app's saved engine setting isn't touched. DECIDER=server uses the game server's /api/decide (the engine chosen in
// Settings); DECIDE_URL=<url> points at any other /v1/systemone server. `node tests/model.mjs ping` checks the model answers.
import { Game } from '../public/engine.js';
import { DECKS, CARDS, loadDeck } from '../public/cards.js';
import { aiConfig, AIController, fallbackAction, cpuPick, askDecider } from '../public/ai.js';

aiConfig.endpoint = process.env.DECIDE_URL
  || (process.env.DECIDER === 'server' ? `http://localhost:${process.env.PORT || 8787}/api/decide` : `http://127.0.0.1:${process.env.LOCAL_PORT || 8009}/v1/systemone`);
aiConfig.engine = 'model';
console.log(`decision model: ${aiConfig.endpoint}`);
// `node tests/model.mjs ping`: one tiny question; exit 0 when the model answers.
if (process.argv[2] === 'ping') {
  try {
    await askDecider({ note: 'ping' }, { q: { type: 'choice', instructions: 'Pick one.', criteria: { a: 'first', b: 'second' } } });
    console.log('ping: ok'); process.exit(0);
  } catch (err) { console.log(`ping: ${err.status || ''} ${err.kind || ''} ${err.message}`.slice(0, 200)); process.exit(2); }
}
const N = Number(process.argv[2] || 20), PAR = Number(process.argv[3] || 4), FORMAT = process.argv[4] || 'both';
const RAND = Number(process.argv[5] || 0.15), MODEL_BOTH = process.argv[6] === 'both-model'; // the model sometimes plays your side too
// Optional 7th argument: deck key prefixes (comma-separated, e.g. "c30-"); every game then has one of them, on either side.
const ONLY = process.argv[7] ? process.argv[7].split(',') : null;
const all = Object.keys(DECKS); await Promise.all(all.map(loadDeck));
const pool = { classic: all.filter((k) => DECKS[k].format !== 'modern'), modern: all.filter((k) => DECKS[k].format === 'modern') };

// Which card rules ran in these games (either player), and which rules of the decks played never came up.
const ran = { fx: new Set(), trainer: new Set(), power: new Set(), stadium: new Set(), tool: new Set(), special: new Set() }, inPlay = new Set(), played = new Set();
const origResolve = Game.prototype.resolveAttack;
Game.prototype.resolveAttack = async function (p, atk) { for (const k of Object.keys(atk.fx || {})) ran.fx.add(k); return origResolve.call(this, p, atk); };
const origPerform = Game.prototype.perform;
Game.prototype.perform = async function (p, act) {
  if (act.kind === 'trainer') { const c = act.card; if (c.stadium) ran.stadium.add(c.stadium); else if (c.tool) ran.tool.add(c.tool); else ran.trainer.add(c.tkind); }
  if (act.kind === 'power') ran.power.add(act.pkind);
  if (act.kind === 'energy' && act.card.special) ran.special.add(act.card.special);
  return origPerform.call(this, p, act);
};
const stats = { games: 0, modelCalls: 0, modelErrors: 0, errorSamples: new Set(), wins: { you: 0, model: 0, draw: 0 }, reasons: {}, turns: 0, illegal: 0, actionKinds: {}, ms: 0 };
const human = {
  chooseAction: async (g, p, a) => (Math.random() < RAND ? a[Math.floor(Math.random() * a.length)] : fallbackAction(g, p, a)),
  choose: async (g, p, pr) => (Math.random() < RAND * 2 ? pr.options[Math.floor(Math.random() * pr.options.length)].id : cpuPick(g, p, pr)),
  setupBench: async (g, p, b) => b.map((c) => c.uid),
};
function modelController() {
  const ai = new AIController({ onError: (err) => { stats.modelErrors++; stats.errorSamples.add(err.message.slice(0, 120)); } });
  const choose = ai.chooseAction.bind(ai), pick = ai.choose.bind(ai);
  ai.chooseAction = async (g, p, actions) => {
    const t0 = Date.now();
    const act = await choose(g, p, actions);
    stats.ms += Date.now() - t0; stats.modelCalls++;
    if (!actions.includes(act)) stats.illegal++;
    stats.actionKinds[act.kind] = (stats.actionKinds[act.kind] || 0) + 1;
    return act;
  };
  ai.choose = async (g, p, prompt) => {
    const id = await pick(g, p, prompt);
    stats.modelCalls++;
    if (!prompt.options.some((o) => o.id === id)) stats.illegal++;
    return id;
  };
  return ai;
}

async function playOne(i) {
  const fmt = FORMAT === 'both' ? (i % 2 ? 'modern' : 'classic') : FORMAT;
  const keys = pool[fmt];
  const d = [keys[Math.floor(Math.random() * keys.length)], keys[(i * 7 + 3) % keys.length]];
  if (ONLY) { const focus = keys.filter((k) => ONLY.some((x) => k.startsWith(x))); d[i % 2] = focus[Math.floor(i / 2) % focus.length]; }
  d.forEach((k) => played.add(k));
  const g = new Game({ decks: d, controllers: [MODEL_BOTH && i % 3 === 0 ? modelController() : human, modelController()],
    hooks: { onCheckpoint: (gm) => { for (const q of gm.players) for (const m of gm.allMons(q)) if (m.card.powerKind) inPlay.add(m.card.powerKind); } } });
  try { await g.run(); } catch (e) { console.log('CRASH', d, e.stack); stats.crashes = (stats.crashes || 0) + 1; return; }
  for (const p of g.players) {
    const n = p.deck.length + p.hand.length + p.discard.length + p.prizes.length + (p.lost?.length || 0) + g.allMons(p).reduce((s, m) => s + m.allCards().length, 0) + (g.stadium?.owner === p.idx ? 1 : 0);
    if (n !== 60) { console.log('CARD COUNT', n, d); stats.badCount = (stats.badCount || 0) + 1; }
    for (const m of g.allMons(p)) if (m.damage < 0) stats.negDamage = (stats.negDamage || 0) + 1;
  }
  stats.games++; stats.turns += g.turn;
  const w = g.winner === 'draw' ? 'draw' : g.winner.idx === 1 ? 'model' : 'you';
  stats.wins[w]++;
  const r = g.winner === 'draw' ? 'draw' : g.winReason.key; stats.reasons[r] = (stats.reasons[r] || 0) + 1;
  console.log(`game ${i + 1}: ${fmt} ${d[0]} (you) vs ${d[1]} (model) → ${w} by ${r} in ${g.turn} turns`);
}

const t0 = Date.now();
let next = 0;
await Promise.all(Array.from({ length: PAR }, async () => { while (next < N) await playOne(next++); }));
console.log(JSON.stringify({ ...stats, errorSamples: [...stats.errorSamples], avgTurns: (stats.turns / Math.max(1, stats.games)).toFixed(1), avgModelMs: Math.round(stats.ms / Math.max(1, stats.actionKinds ? Object.values(stats.actionKinds).reduce((a, b) => a + b, 0) : 1)), minutes: ((Date.now() - t0) / 60000).toFixed(1) }, null, 1));
// Rules of the focus decks (or of all decks played) that never ran: not a failure, but shows what these games didn't reach.
const want = { fx: new Set(), trainer: new Set(), power: new Set(), stadium: new Set(), tool: new Set(), special: new Set() };
for (const k of played) {
  if (ONLY && !ONLY.some((x) => k.startsWith(x))) continue;
  for (const c of Object.keys(DECKS[k].list || {}).map((id) => CARDS[id]).filter(Boolean)) {
    for (const at of c.attacks || []) for (const f of Object.keys(at.fx || at.effect || {})) want.fx.add(f);
    if (c.kind === 'trainer') { if (c.stadium) want.stadium.add(c.stadium); else if (c.tool) want.tool.add(c.tool); else want.trainer.add(c.tkind); }
    if (c.powerKind) want.power.add(c.powerKind);
    if (c.special) want.special.add(c.special);
  }
}
const missing = Object.fromEntries(Object.keys(want).map((k) => [k, [...want[k]].filter((x) => !ran[k].has(x) && !(k === 'power' && inPlay.has(x)))]));
console.log('rules run: ' + Object.keys(want).map((k) => `${k} ${want[k].size - missing[k].length}/${want[k].size}`).join(', '));
for (const [k, l] of Object.entries(missing)) if (l.length) console.log(`  not reached (${k}): ${l.join(', ')}`);
// Fail when the model didn't really play (unreachable, erroring) or a game broke.
if (stats.modelErrors) console.error(`The model failed ${stats.modelErrors} of ${stats.modelCalls} times: ${[...stats.errorSamples].join(' | ')}`);
process.exit(stats.modelErrors || stats.illegal || stats.crashes || stats.badCount ? 1 : 0);
