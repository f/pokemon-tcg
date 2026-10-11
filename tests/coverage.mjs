// Plays many bot games over every deck and reports which card rules never ran.
import { Game, Mon, canPay } from '../public/engine.js';
import { DECKS, CARDS, loadDeck } from '../public/cards.js';
import { fallbackAction, cpuPick } from '../public/ai.js';
import { readFileSync } from 'node:fs';
const N = Number(process.argv[2] || 3000);
const all = Object.keys(DECKS); await Promise.all(all.map(loadDeck));
// Everything the decks contain
const want = { fx: new Set(), trainer: new Set(), power: new Set(), stadium: new Set(), tool: new Set(), special: new Set() };
for (const c of Object.values(CARDS)) {
  for (const a of c.attacks || []) for (const k of Object.keys(a.fx || {})) want.fx.add(k);
  if (c.kind === 'trainer') { if (c.stadium) want.stadium.add(c.stadium); else if (c.tool) want.tool.add(c.tool); else want.trainer.add(c.tkind); }
  if (c.powerKind) want.power.add(c.powerKind);
  if (c.special) want.special.add(c.special);
}
const got = { fx: new Set(), trainer: new Set(), power: new Set(), stadium: new Set(), tool: new Set(), special: new Set() };
const origResolve = Game.prototype.resolveAttack;
Game.prototype.resolveAttack = async function (p, atk) { for (const k of Object.keys(atk.fx || {})) got.fx.add(k); return origResolve.call(this, p, atk); };
const origPerform = Game.prototype.perform;
Game.prototype.perform = async function (p, act) {
  if (act.kind === 'trainer') { const c = act.card; if (c.stadium) got.stadium.add(c.stadium); else if (c.tool) got.tool.add(c.tool); else got.trainer.add(c.tkind); }
  if (act.kind === 'power') got.power.add(act.pkind);
  if (act.kind === 'stadium') got.stadium.add('use:' + act.stadium);
  if (act.kind === 'energy' && act.card.special) got.special.add(act.card.special);
  return origPerform.call(this, p, act);
};
const R = 0.35;
// A curious bot: when a move would run a rule that hasn't run yet, it takes it.
const fresh = (g, p, x) => {
  if (x.kind === 'attack') return Object.keys(g.attacksOf(p.active)[x.index]?.fx || {}).some((k) => !got.fx.has(k));
  if (x.kind === 'trainer') { const c = x.card; return c.stadium ? !got.stadium.has(c.stadium) : c.tool ? !got.tool.has(c.tool) : !got.trainer.has(c.tkind); }
  if (x.kind === 'power') return !got.power.has(x.pkind);
  if (x.kind === 'stadium') return !got.stadium.has('use:' + x.stadium);
  return false;
};
// …and steers towards them: Pokémon whose attacks haven't run yet get the Energy, the Active Spot and the Bench.
const freshCard = (c) => c?.kind === 'pokemon' && (c.attacks || []).some((at) => Object.keys(at.fx || {}).some((k) => !got.fx.has(k)));
const steer = (g, p, a) =>
  a.find((x) => x.kind === 'energy' && freshCard(x.target?.card) && x.target === p.active) ||
  a.find((x) => x.kind === 'retreat' && freshCard(x.target?.card)) ||
  a.find((x) => x.kind === 'trainer' && x.tkind === 'switch' && freshCard(x.target?.card)) ||
  a.find((x) => x.kind === 'bench' && freshCard(x.card)) ||
  a.find((x) => x.kind === 'evolve' && freshCard(x.card)) ||
  a.find((x) => x.kind === 'energy' && freshCard(x.target?.card));
const bot = { chooseAction: async (g,p,a)=> a.find((x) => fresh(g, p, x)) || steer(g, p, a) || (Math.random()<R ? a[Math.floor(Math.random()*a.length)] : fallbackAction(g,p,a)),
  choose: async (g,p,pr)=> pr.options.find((o) => ['setup-active', 'promote', 'whirlwind'].includes(pr.kind) && freshCard(o.card || o.mon?.card))?.id
    ?? (Math.random()<0.5 ? pr.options[Math.floor(Math.random()*pr.options.length)].id : cpuPick(g,p,pr)),
  setupBench: async (g,p,b)=>b.filter(()=>Math.random()<0.8).map(c=>c.uid) };
const byFormat = { classic: all.filter(k => DECKS[k].format !== 'modern'), modern: all.filter(k => DECKS[k].format === 'modern') };
// Passive powers count as covered when their Pokémon was in play for a whole game (their effect is checked separately).
const passiveSeen = new Set();
for (let i = 0; i < N; i++) {
  const keys = i % 2 ? byFormat.modern : byFormat.classic;
  const d = [keys[i % keys.length], keys[Math.floor(Math.random() * keys.length)]];
  const g = new Game({ decks: d, controllers: [bot, bot], hooks: { onCheckpoint: (g) => { for (const p of g.players) for (const m of g.allMons(p)) if (m.card.powerKind) passiveSeen.add(m.card.powerKind); } } });
  try { await g.run(); } catch (e) { console.error('CRASH', d, e.stack); process.exit(1); }
  for (const p of g.players) { const n = p.deck.length + p.hand.length + p.discard.length + p.prizes.length + (p.lost?.length || 0) + g.allMons(p).reduce((s, m) => s + m.allCards().length, 0) + (g.stadium?.owner === p.idx ? 1 : 0); if (n !== 60) { console.error('COUNT', n, d); process.exit(1); } }
}
// Rules still missing: play the decks that have them (against opponents that make them usable, e.g. a Tera Pokémon for Gemstone Mimicry).
const fxCards = (k) => Object.values(CARDS).filter((c) => (c.attacks || []).some((a) => a.fx?.[k]));
const deckHas = (key, ids) => Object.keys(DECKS[key].list || {}).some((id) => ids.has(id));
for (let round = 0; round < 400; round++) {
  const missing = [...want.fx].filter((k) => !got.fx.has(k));
  if (!missing.length) break;
  const k = missing[round % missing.length];
  const ids = new Set(fxCards(k).map((c) => c.id));
  const mine = all.filter((d) => deckHas(d, ids));
  if (!mine.length) break;
  const a = mine[round % mine.length], fmt = DECKS[a].format || 'classic';
  let opps = all.filter((d) => (DECKS[d].format || 'classic') === fmt);
  if (k === 'needsDefTera') opps = opps.filter((d) => Object.keys(DECKS[d].list).some((id) => CARDS[id]?.tera));
  const g = new Game({ decks: [a, opps[Math.floor(Math.random() * opps.length)]], controllers: [bot, bot], hooks: {} });
  await g.run();
}
// Trainers that need something on the opponent's side: play their deck against opponents that have it.
const NEEDS_OPP = { fanOfWaves: (c) => c.kind === 'energy' && c.special, greatCatcher: (c) => c.tags?.includes('GX') || c.tags?.includes('EX') };
for (let round = 0; round < 300; round++) {
  const missing = Object.keys(NEEDS_OPP).filter((k) => want.trainer.has(k) && !got.trainer.has(k));
  if (!missing.length) break;
  const k = missing[round % missing.length];
  const mine = all.filter((d) => Object.keys(DECKS[d].list || {}).some((id) => CARDS[id]?.tkind === k));
  const opps = all.filter((d) => DECKS[d].format === DECKS[mine[0]].format && Object.keys(DECKS[d].list || {}).some((id) => NEEDS_OPP[k](CARDS[id])));
  if (!mine.length || !opps.length) break;
  const g = new Game({ decks: [mine[round % mine.length], opps[round % opps.length]], controllers: [bot, bot], hooks: {} });
  await g.run();
}
// Some attacks can't be paid for with the Energy in their own deck (e.g. Psyduck's Headache needs Psychic Energy
// but the Thunderstorm deck has none). Run those once in a real game state with the Energy they need.
const direct = [];
for (const k of [...want.fx].filter((x) => !got.fx.has(x))) {
  for (const c of fxCards(k)) {
    const deck = all.find((d) => DECKS[d].list?.[c.id]);
    const deckTypes = [...new Set(Object.keys(DECKS[deck].list).map((id) => CARDS[id]).filter((x) => x.kind === 'energy').flatMap((x) => Array(x.provides || 1).fill(x.energyType)))];
    const atk = c.attacks.find((a) => a.fx?.[k]);
    if (canPay(deckTypes.flatMap((t) => [t, t, t, t]), atk.cost)) continue; // reachable: it just didn't come up
    const g = new Game({ decks: [deck, deck], controllers: [bot, bot], hooks: {} });
    const [me, op] = g.players;
    for (const q of g.players) { q.prizes = q.deck.splice(-6); q.hand = q.deck.splice(-5); }
    me.active = new Mon({ ...c, uid: 990001 }, 0);
    me.active.energy = atk.cost.map((t, i) => ({ ...Object.values(CARDS).find((x) => x.kind === 'energy' && !x.special && x.energyType === (t === 'Colorless' ? atk.cost.find((y) => y !== 'Colorless') || 'Fire' : t)), uid: 990100 + i }));
    const foe = Object.values(CARDS).find((x) => x.kind === 'pokemon' && x.stage === 0 && DECKS[deck].list[x.id]);
    op.active = new Mon({ ...foe, uid: 990002 }, 0);
    g.current = me; g.turn = 5; g.phase = 'main';
    await g.attack(me, c.attacks.indexOf(atk));
    direct.push(`${k} (${c.name}: ${atk.name}, needs ${atk.cost.join('+')}; ${deck} has ${deckTypes.join('/')})`);
  }
}
// Powers used as an action (the case labels of the engine's power/ability action lists) must really be used;
// only passive ones count as covered by being in play.
const src = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const between = (text, a, b) => text.slice(text.indexOf(a), text.indexOf(b, text.indexOf(a)));
const activated = new Set([
  ...src('engine.js').match(/const ACTIVE_POWERS = new Set\(\[([^\]]+)\]/)[1].match(/'(\w+)'/g).map((x) => x.slice(1, -1)),
  ...[between(src('engine-modern.js'), 'abilityActions(p, o, add', 'async useAbility('), between(src('engine-mega.js'), 'megaAbilityAction(', 'async megaUseAbility('),
    between(src('engine-swsh.js'), 'swshAbilityAction(', 'async swshUseAbility(')]
    .flatMap((t) => [...t.matchAll(/case '(\w+)'/g)].map((m) => m[1])),
]);
// Activated Abilities whose condition their own deck can't meet (Fiery Flapping needs Articuno and Zapdos in play): run them on a set-up board.
const DIRECT_POWERS = {
  fieryFlapping: (g, me, mon) => { me.bench.push(mon('Articuno'), mon('Zapdos')); me.hand.push({ ...Object.values(CARDS).find((x) => x.kind === 'energy' && !x.special && x.energyType === 'Fire'), uid: 990300 }); },
};
for (const k of [...want.power].filter((x) => activated.has(x) && !got.power.has(x) && DIRECT_POWERS[x])) {
  const c = Object.values(CARDS).find((x) => x.powerKind === k);
  const deck = all.find((d) => DECKS[d].list?.[c.id]);
  const g = new Game({ decks: [deck, deck], controllers: [bot, bot], hooks: {} });
  const [me, op] = g.players;
  for (const q of g.players) { q.prizes = q.deck.splice(-6); q.hand = q.deck.splice(-5); }
  let uid = 990200;
  // No deck has a plain Articuno: a stand-in Basic named Articuno is enough for the name check.
  const base = (name) => Object.values(CARDS).find((x) => x.kind === 'pokemon' && x.name === name) || { ...Object.values(CARDS).find((x) => x.kind === 'pokemon' && x.stage === 0), name };
  const mon = (name) => new Mon({ ...base(name), uid: uid++ }, 0);
  me.active = new Mon({ ...c, uid: uid++ }, 0); op.active = mon(c.name);
  DIRECT_POWERS[k](g, me, mon);
  g.current = me; g.turn = 5; g.phase = 'main';
  const act = g.legalActions(me).find((a) => a.kind === 'power' && a.pkind === k);
  if (act) { await g.perform(me, act); direct.push(`${k} (${c.name}: ${c.power.name}, a condition its deck can't meet)`); }
}
for (const k of Object.keys(want)) {
  const miss = [...want[k]].filter(x => !got[k].has(x) && !(k === 'power' && !activated.has(x) && passiveSeen.has(x)));
  console.log(`${k}: ${want[k].size - miss.length}/${want[k].size} covered${miss.length ? ' — missing: ' + miss.join(', ') : ''}`);
}
if (direct.length) console.log('run directly (their own deck can never make them happen):\n  ' + direct.join('\n  '));
console.log('stadium actions used:', [...got.stadium].filter(x => x.startsWith('use:')).join(' '));
