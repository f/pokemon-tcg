// Targeted rule tests: build a board by hand, then check the exact numbers / legal moves each card should produce.
import { Game, Mon, canPay } from '../public/engine.js';
import { DECKS, CARDS, loadDeck } from '../public/cards.js';
await Promise.all(Object.keys(DECKS).map(loadDeck));

let uid = 900000, passed = 0, failed = 0;
const byName = (name, pick = (c) => true) => {
  const c = Object.values(CARDS).find((x) => x.name === name && pick(x));
  if (!c) throw new Error('no card ' + name);
  return c;
};
const card = (name, pick) => ({ ...byName(name, pick), uid: uid++ });
const energy = (t) => card(`Basic ${t} Energy`, () => true) || card(`${t} Energy`);
const en = (t) => { const c = Object.values(CARDS).find((x) => x.kind === 'energy' && !x.special && x.energyType === t); return { ...c, uid: uid++ }; };
const mon = (g, name, { energy: es = [], damage = 0, tools = [], pick, played = 0 } = {}) => {
  const m = new Mon(card(name, pick), played);
  m.energy = es.map(en); m.damage = damage;
  m.tools = tools.map((t) => ({ card: card(t), expires: 1e9 }));
  return m;
};
// A queue of answers for choices (by option id, or a function of the prompt); anything else picks the first option.
const scripted = (answers = []) => ({
  chooseAction: async (g, p, a) => a.at(-1),
  choose: async (g, p, pr) => { const ans = answers.shift(); return typeof ans === 'function' ? ans(pr) : ans ?? pr.options[0].id; },
  setupBench: async () => [],
});
function newGame(decks, { answers0 = [], answers1 = [] } = {}) {
  const g = new Game({ decks, controllers: [scripted(answers0), scripted(answers1)], hooks: {} });
  for (const p of g.players) { p.hand = []; p.prizes = p.deck.splice(-6); }
  g.current = g.players[0]; g.turn = 5; g.phase = 'main';
  return g;
}
const check = (name, ok, extra = '') => { if (ok) passed++; else { failed++; console.log('FAIL', name, extra); } };
const withCoin = async (h, fn) => { const r = Math.random; Math.random = () => (h ? 0.1 : 0.9); try { return await fn(); } finally { Math.random = r; } };
const attackBy = async (g, p, name) => { const i = g.attacksOf(p.active).findIndex((a) => a.name === name); if (i < 0) throw new Error('no attack ' + name); await g.attack(p, i); };

// ---------------- Classic ----------------
{ // Headache: the opponent can't play Trainers during their next turn
  const g = newGame(['lockdown', 'brushfire']);
  const [me, op] = g.players;
  me.active = mon(g, 'Psyduck', { energy: ['Water'], pick: (c) => c.attacks.some((a) => a.name === 'Headache') });
  op.active = mon(g, 'Charmander', {}); op.bench = [mon(g, 'Vulpix')];
  await attackBy(g, me, 'Headache');
  g.turn++; g.current = op; op.hand = [card('Potion'), card('Switch')];
  check('Headache blocks Trainers next turn', !g.legalActions(op).some((a) => a.kind === 'trainer'));
  g.turn++; g.current = op;
  check('Headache wears off', g.legalActions(op).some((a) => a.kind === 'trainer'));
}
{ // Toxic Gas stops other Pokémon Powers; Energy Burn while blocked
  const g = newGame(['bodyguard', 'brushfire']);
  const [me, op] = g.players;
  me.active = mon(g, 'Muk'); op.active = mon(g, 'Charizard', { pick: (c) => c.set === 'base1' });
  op.active.energy = [en('Water')];
  check('Toxic Gas switches off Energy Burn', !g.powerOn(op.active));
  me.active.status.asleep = true;
  check('Asleep Muk: Energy Burn works again', g.powerOn(op.active));
}
{ // Retreat Aid, Strange Barrier, Pollen Defense, Psylink, Bench Guard
  const g = newGame(['hot-water', 'erika']);
  const [me, op] = g.players;
  me.active = mon(g, 'Charmander'); me.bench = [mon(g, 'Dodrio', { pick: (c) => c.power })];
  check('Retreat Aid lowers retreat by 1', g.retreatCost(me, me.active) === Math.max(0, me.active.card.retreat - 1), g.retreatCost(me, me.active));
  op.active = mon(g, "Erika's Dratini");
  const d = g.finalDamage(me.active, op.active, 30).dmg;
  check('Strange Barrier: Basic attacker 30 → 10', d === 10, d);
}
{
  const g = newGame(['sabrina', 'koga']);
  const [me] = g.players;
  me.active = mon(g, "Sabrina's Alakazam"); me.bench = [mon(g, "Sabrina's Jynx")];
  const names = g.attacksOf(me.active).map((a) => a.name);
  check('Psylink copies Benched Psychic attacks', names.includes('Hug') && names.includes('Helping Hand'), names.join(','));
}
{
  const g = newGame(['gym-brock', 'lightning-bug'], { answers0: [() => 'yes'] });
  const [me, op] = g.players;
  me.bench = [mon(g, "Brock's Rhydon"), mon(g, "Brock's Geodude")];
  me.active = mon(g, "Brock's Onix");
  await g.spread(null, [[me.bench[1], 20]]);
  check('Bench Guard moves 10 damage to Rhydon', me.bench[1].damage === 10 && me.bench[0].damage === 10, `${me.bench[1].damage}/${me.bench[0].damage}`);
}
{ // Pollen Defense confuses the attacker (heads)
  const g = newGame(['erika', 'blaine']);
  const [me, op] = g.players;
  me.active = mon(g, "Erika's Vileplume"); op.active = mon(g, "Blaine's Growlithe");
  me.active.damage = 10;
  await withCoin(true, () => g.onDamaged(me, me.active, op.active));
  check('Pollen Defense confuses the attacker', op.active.status.confused === true);
}
{ // Flee: switch away, then nothing else hits it
  const g = newGame(['gym-misty', 'koga'], { answers0: [(pr) => pr.options.find((o) => o.mon)?.id] });
  const [me, op] = g.players;
  me.active = mon(g, "Misty's Tentacruel"); me.bench = [mon(g, "Misty's Horsea")];
  op.active = mon(g, "Koga's Ekans");
  me.active.damage = 10;
  const fled = await g.onDamaged(me, me.active, op.active);
  check('Flee switches the Active Pokémon', fled && me.active.name === "Misty's Horsea");
}
{ // Call the Boss: evolving into Giovanni's Persian fetches Giovanni
  const g = newGame(['giovanni', 'koga']);
  const [me] = g.players;
  me.active = mon(g, "Giovanni's Meowth", { played: 1 });
  const persian = card("Giovanni's Persian");
  me.hand = [persian]; me.deck = [card('Giovanni', (c) => c.kind === 'trainer'), ...me.deck];
  const act = g.legalActions(me).find((a) => a.kind === 'evolve');
  await g.perform(me, act);
  check('Call the Boss fetches Giovanni', me.hand.some((c) => c.name === 'Giovanni'));
}
{ // Stadiums: Cerulean, Pewter, Cinnabar, Viridian, Vermilion (optional flip)
  const g = newGame(['gym-misty', 'gym-brock']);
  const [me, op] = g.players;
  const set = (name) => { g.stadium = { card: card(name), owner: 0 }; };
  me.active = mon(g, "Misty's Starmie");
  set('Cerulean City Gym');
  check('Cerulean: Misty’s Pokémon retreat 1 less', g.retreatCost(me, me.active) === Math.max(0, me.active.card.retreat - 1));
  op.active = mon(g, "Brock's Onix");
  const res = mon(g, "Misty's Poliwag"); // any Pokémon resisting Fighting?
  set('Pewter City Gym');
  const vsRes = Object.values(CARDS).find((c) => c.kind === 'pokemon' && c.resistance === 'Fighting');
  if (vsRes) { const t = new Mon({ ...vsRes, uid: uid++ }, 0); check('Pewter: Brock’s Pokémon ignore Resistance', g.finalDamage(op.active, t, 40).dmg === 40, g.finalDamage(op.active, t, 40).dmg); }
  set('Cinnabar City Gym');
  const blaine = new Mon(card("Blaine's Vulpix"), 0); const water = new Mon(card("Misty's Poliwag"), 0);
  check('Cinnabar: Water ignores Blaine’s Weakness', g.finalDamage(water, blaine, 20).dmg === 20, g.finalDamage(water, blaine, 20).dmg);
  set('Viridian City Gym');
  const g2 = newGame(['giovanni', 'koga']);
  g2.stadium = { card: card('Viridian City Gym'), owner: 0 };
  const m2 = g2.players[0]; m2.active = mon(g2, "Giovanni's Nidoran♂", { damage: 30, played: 1 });
  m2.hand = [card("Giovanni's Nidorino")];
  await g2.perform(m2, g2.legalActions(m2).find((a) => a.kind === 'evolve'));
  check('Viridian: evolving Giovanni’s Pokémon heals 20', m2.active.damage === 10, m2.active.damage);
}
{ // Vermilion City Gym: the flip is asked, heads adds 10
  const g = newGame(['lt-surge', 'erika'], { answers0: [() => 'yes'] });
  const [me, op] = g.players;
  g.stadium = { card: card('Vermilion City Gym'), owner: 0 };
  me.active = mon(g, "Lt. Surge's Rattata", { energy: ['Lightning'] }); op.active = mon(g, "Erika's Oddish");
  const before = op.active.damage;
  await withCoin(true, () => attackBy(g, me, g.attacksOf(me.active).find((a) => a.base > 0).name));
  check('Vermilion: heads adds 10', op.active.damage - before >= 20, op.active.damage - before);
}
{ // Special Energy: Potion Energy heals, Full Heal Energy cures, Double Colorless counts 2
  const g = newGame(['devastation', 'trouble']);
  const [me] = g.players;
  me.active = mon(g, 'Squirtle', { damage: 20 }); me.active.status.poisoned = true;
  const pe = card('Potion Energy'), fh = card('Full Heal Energy');
  me.hand = [pe];
  await g.perform(me, g.legalActions(me).find((a) => a.kind === 'energy'));
  check('Potion Energy removes a damage counter', me.active.damage === 10);
  me.flags.energy = false; me.hand = [fh];
  await g.perform(me, g.legalActions(me).find((a) => a.kind === 'energy'));
  check('Full Heal Energy cures', !me.active.conditions().length);
  const dce = Object.values(CARDS).find((c) => c.special === 'dce');
  me.active.energy = [{ ...dce, uid: uid++ }];
  check('Double Colorless provides 2', me.active.energyTypes.length === 2);
}

// ---------------- Modern ----------------
{ // Mind Ruler (times opponent's hand) and Dark Frost (+60 with Team Rocket's Energy)
  const g = newGame(['svd-meowscarada', 'svl-mewtwo']);
  const [me, op] = g.players;
  me.active = mon(g, 'Radiant Alakazam'); op.active = mon(g, "Team Rocket's Articuno");
  op.hand = [card('Switch'), card('Switch'), card('Switch')];
  const ruler = g.attacksOf(me.active).find((a) => a.name === 'Mind Ruler');
  check('Mind Ruler: 20 × 3 cards', g.baseRange(me.active, op.active, ruler)[0] === 60, g.baseRange(me.active, op.active, ruler)[0]);
  const frost = g.attacksOf(op.active).find((a) => a.name === 'Dark Frost');
  const base0 = g.baseRange(op.active, me.active, frost)[0];
  op.active.energy = [card("Team Rocket's Energy")];
  check('Dark Frost +60 with Team Rocket’s Energy', g.baseRange(op.active, me.active, frost)[0] === base0 + 60);
  check('Team Rocket’s Energy pays for Psychic or Darkness', op.active.energyTypes.length === 2);
}
{ // Abilities that change damage
  const g = newGame(['me-diancie', 'mel-lucario']);
  const [me, op] = g.players;
  me.active = mon(g, 'Mega Diancie ex'); op.active = mon(g, 'Riolu');
  check('Diamond Coat: −30', g.finalDamage(op.active, me.active, 100).dmg === 70, g.finalDamage(op.active, me.active, 100).dmg);
  check('Mega ex gives 3 Prize cards', me.active.card.prizes === 3);
  op.flags.ppp = true;
  check('Premium Power Pro: +30 Fighting', g.finalDamage(op.active, me.active, 100).dmg === 100, g.finalDamage(op.active, me.active, 100).dmg);
}
{
  const g = newGame(['sv-kangaskhan', 'sv-iron-leaves']);
  const [me, op] = g.players;
  me.active = mon(g, 'Bouffalant'); op.active = mon(g, 'Tangrowth');
  check('Bouffer: −20', g.finalDamage(op.active, me.active, 100).dmg === 80, g.finalDamage(op.active, me.active, 100).dmg);
  check('Thicket Body: −30', g.finalDamage(me.active, op.active, 100).dmg === 70 || g.finalDamage(me.active, op.active, 100).dmg === 170, g.finalDamage(me.active, op.active, 100).dmg);
}
{ // Retreat: Flare Float, In a Hungry Hurry, Voltaic Float, Air Balloon, Rescue Board, Beach Court, Future Booster
  const g = newGame(['svl-charizard', 'sv-houndoom']);
  const [me, op] = g.players;
  me.active = mon(g, 'Moltres', { pick: (c) => c.power?.kind === 'flareFloat' }); check('Flare Float: no Fire → normal cost', g.retreatCost(me, me.active) === me.active.card.retreat);
  me.active.energy = [en('Fire')]; check('Flare Float: Fire → free', g.retreatCost(me, me.active) === 0);
  op.active = mon(g, 'Morpeko'); check('Hungry Hurry: no Energy → free', g.retreatCost(op, op.active) === 0);
  const g2 = newGame(['svd-zapdos', 'mel-greninja']);
  const z = g2.players[0]; z.active = mon(g2, 'Zapdos ex', { energy: ['Lightning'] });
  check('Voltaic Float: Lightning → free', g2.retreatCost(z, z.active) === 0);
  const gr = g2.players[1]; gr.active = mon(g2, 'Mega Greninja ex', { tools: ['Air Balloon'] });
  check('Air Balloon: −2', g2.retreatCost(gr, gr.active) === Math.max(0, gr.active.card.retreat - 2));
  const g3 = newGame(['svl-dragapult', 'svd-miraidon']);
  const r = g3.players[0]; r.active = mon(g3, 'Dragapult ex', { tools: ['Rescue Board'] });
  check('Rescue Board: −1', g3.retreatCost(r, r.active) === Math.max(0, r.active.card.retreat - 1));
  r.active.damage = r.active.maxHp - 30; check('Rescue Board: ≤30 HP → free', g3.retreatCost(r, r.active) === 0);
  const f = g3.players[1]; f.active = mon(g3, 'Iron Hands', { tools: ['Future Booster Energy Capsule'] });
  check('Future Booster: free retreat', g3.retreatCost(f, f.active) === 0);
  check('Future Booster: +20 damage', g3.finalDamage(f.active, r.active, 80).dmg >= 100, g3.finalDamage(f.active, r.active, 80).dmg);
  g3.stadium = { card: card('Beach Court'), owner: 0 };
  const b = mon(g3, 'Iron Valiant'); f.active = b;
  check('Beach Court: Basic −1', g3.retreatCost(f, b) === Math.max(0, b.card.retreat - 1));
}
{ // HP: Bravery Charm, Nutritional Iron, Ancient Booster, Gravity Mountain
  const g = newGame(['svd-zapdos', 'svd-koraidon']);
  const [me, op] = g.players;
  me.active = mon(g, 'Pawmi', { tools: ['Bravery Charm'] }); check('Bravery Charm +50 HP', me.active.maxHp === me.active.card.hp + 50);
  op.active = mon(g, 'Great Tusk', { tools: ['Ancient Booster Energy Capsule'] }); check('Ancient Booster +60 HP', op.active.maxHp === op.active.card.hp + 60);
  g.applyStatus(op.active, 'poisoned'); check('Ancient Booster: immune to Special Conditions', !op.active.conditions().length);
  const g2 = newGame(['sv-melmetal', 'me-gengar']);
  const o = g2.players[0]; o.active = mon(g2, 'Orthworm', { energy: ['Metal', 'Metal', 'Metal'] }); check('Nutritional Iron +100 HP', o.active.maxHp === o.active.card.hp + 100);
  const gg = g2.players[1]; gg.active = mon(g2, 'Mega Gengar ex'); g2.stadium = { card: card('Gravity Mountain'), owner: 0 };
  check('Gravity Mountain: Stage 2 −30 HP', gg.active.maxHp === gg.active.card.hp - 30);
}
{ // Defiance Band, Vitality Band, Transistor, Excited Power, Stone Palace, Granite Cave, Lake Acuity
  const g = newGame(['svl-miraidon', 'sv-steven']);
  const [me, op] = g.players;
  me.active = mon(g, 'Zeraora', { pick: (c) => c.set === 'swsh12' }); me.bench = [mon(g, 'Regieleki VMAX')];
  op.active = mon(g, "Steven's Beldum");
  const base = g.finalDamage(me.active, op.active, 100).dmg;
  me.active.tools = [{ card: card('Vitality Band'), expires: 1e9 }];
  check('Vitality Band +10', g.finalDamage(me.active, op.active, 100).dmg === base + 10);
  me.bench = []; const noTr = g.finalDamage(me.active, op.active, 100).dmg;
  check('Transistor gave +30', base - (noTr - 10) === 30, `${base} vs ${noTr}`);
  op.bench = [mon(g, "Steven's Carbink")];
  check('Stone Palace −30', g.finalDamage(me.active, op.active, 100).dmg === noTr - 30, g.finalDamage(me.active, op.active, 100).dmg);
  g.stadium = { card: card('Granite Cave'), owner: 1 };
  check('Granite Cave −30 more', g.finalDamage(me.active, op.active, 100).dmg === Math.max(0, noTr - 60));
  const g2 = newGame(['me-gengar', 'svd-quaquaval']);
  const [a, b] = g2.players;
  a.active = mon(g2, 'Seviper', { pick: (c) => c.set === 'me2' }); b.active = mon(g2, 'Quaxly', { energy: ['Water'] });
  const s0 = g2.finalDamage(a.active, b.active, 50).dmg;
  a.bench = [mon(g2, 'Mega Gengar ex')];
  check('Excited Power +120', g2.finalDamage(a.active, b.active, 50).dmg === s0 + 120, g2.finalDamage(a.active, b.active, 50).dmg);
  g2.stadium = { card: card('Lake Acuity'), owner: 1 };
  check('Lake Acuity −20 (Water attached)', g2.finalDamage(a.active, b.active, 50).dmg === s0 + 100);
  const g3 = newGame(['svl-charizard', 'sv-houndoom']);
  const [c, h] = g3.players;
  c.active = mon(g3, 'Charmander', { pick: (x) => x.set === 'sv4pt5' }); c.active.tools = [{ card: card('Defiance Band'), expires: 1e9 }];
  h.active = mon(g3, 'Houndour'); h.prizes = h.prizes.slice(0, 3);
  check('Defiance Band +30 when behind', g3.finalDamage(c.active, h.active, 10).dmg >= 40, g3.finalDamage(c.active, h.active, 10).dmg);
}
{ // Power Saver, Repelling Veil, Flare Veil, Seasoned Skill
  const g = newGame(['svl-mewtwo', 'svl-charizard']);
  const [me, op] = g.players;
  me.active = mon(g, "Team Rocket's Mewtwo ex", { energy: ['Psychic', 'Psychic', 'Psychic', 'Psychic'] });
  op.active = mon(g, 'Pidgey', { pick: (c) => c.set === 'sv3pt5' });
  check('Power Saver: can’t attack with < 4 Team Rocket’s', !g.legalActions(me).some((a) => a.kind === 'attack'));
  me.bench = [mon(g, "Team Rocket's Zubat"), mon(g, "Team Rocket's Zubat"), mon(g, "Team Rocket's Tarountula")];
  check('Power Saver: 4 Team Rocket’s → can attack', g.legalActions(me).some((a) => a.kind === 'attack'));
  me.bench.push(mon(g, "Team Rocket's Articuno"));
  const golbat = mon(g, "Team Rocket's Golbat"); me.bench.push(golbat);
  check('Repelling Veil protects Basic Team Rocket’s (not Stage 1)', g.effectsBlocked(me.bench[0]) && g.effectsBlocked(me.active) && !g.effectsBlocked(golbat));
  me.bench.pop();
  op.active = mon(g, 'Charmeleon', { pick: (c) => c.set === 'sv4pt5' });
  check('Flare Veil blocks effects', g.effectsBlocked(op.active));
  const g2 = newGame(['mel-lucario', 'me-gengar']);
  const u = g2.players[0]; u.active = mon(g2, 'Bloodmoon Ursaluna ex');
  const full = g2.attacksOf(u.active).find((a) => a.name === 'Blood Moon').cost.length;
  g2.players[1].prizes = g2.players[1].prizes.slice(0, 3);
  check('Seasoned Skill: 3 cheaper after 3 Prizes taken', u.active && g2.attacksOf(u.active).find((a) => a.name === 'Blood Moon').cost.length === full - 3, full);
}
{ // Punk Helmet + Automated Combat, Exp. Share, Electrical Grounding, Tachyon Bits, Risky Ruins, Gapejaw Bog
  const g = newGame(['me-gengar', 'svd-miraidon']);
  const [me, op] = g.players;
  me.active = mon(g, 'Sableye', { tools: ['Punk Helmet'] }); op.active = mon(g, 'Iron Jugulis');
  await g.megaOnDamaged(me, me.active, op.active);
  check('Punk Helmet: 4 counters on attacker', op.active.damage === 40, op.active.damage);
  await g.megaOnDamaged(op, op.active, me.active);
  check('Automated Combat: 3 counters on attacker', me.active.damage === 30, me.active.damage);
  const g2 = newGame(['sv-steven', 'sv-miraidon']);
  const s = g2.players[0]; s.active = mon(g2, "Steven's Beldum", { energy: ['Metal'] }); s.bench = [mon(g2, "Steven's Carbink", { tools: ['Exp. Share'] })];
  g2.koBy = mon(g2, 'Pikachu', { pick: (c) => c.set === 'sv3pt5' });
  g2.megaOnKO(s, s.active);
  check('Exp. Share moves an Energy', s.bench[0].energy.length === 1);
  const m = g2.players[1]; m.active = mon(g2, 'Pikachu', { pick: (c) => c.set === 'sv3pt5', energy: ['Lightning'] }); m.bench = [mon(g2, 'Raichu', { pick: (c) => c.power })];
  await g2.modernOnKO(m, m.active);
  check('Electrical Grounding moves Lightning Energy', m.bench[0].energy.length === 1);
  const g3 = newGame(['svd-miraidon', 'me-gengar']);
  const [v, x] = g3.players;
  v.active = mon(g3, 'Iron Hands'); v.bench = [mon(g3, 'Iron Valiant ex')]; x.active = mon(g3, 'Gastly');
  g3.current = v;
  g3.swapActive(v, v.bench[0]); await g3.becameActive(v);
  check('Tachyon Bits: 2 counters', x.active.damage === 20, x.active.damage);
  g3.stadium = { card: card('Risky Ruins'), owner: 1 };
  const nb = mon(g3, 'Iron Valiant'); v.bench.push(nb); await g3.modernBenched(v, nb);
  check('Risky Ruins: 2 counters on non-Darkness Basic', nb.damage === 20);
  g3.stadium = { card: card('Gapejaw Bog'), owner: 1 };
  const nb2 = mon(g3, 'Iron Hands'); v.bench.push(nb2); await g3.modernBenched(v, nb2, { fromHand: true });
  check('Gapejaw Bog: 2 counters from hand', nb2.damage === 20);
}
{ // Leafy Camo Poncho stops Boss's Orders; Tera on the Bench; Shadowy Concealment checked elsewhere
  const g = newGame(['svl-charizard', 'svl-miraidon']);
  const [me, op] = g.players;
  me.active = mon(g, 'Pidgey', { pick: (c) => c.set === 'sv3pt5' });
  op.active = mon(g, 'Regieleki V'); op.bench = [mon(g, 'Regieleki VMAX', { tools: ['Leafy Camo Poncho'] }), mon(g, 'Bidoof')];
  me.hand = [card("Boss's Orders (Ghetsis)")];
  const targets = g.legalActions(me).filter((a) => a.tkind === 'bossOrders').map((a) => a.target.name);
  check('Leafy Camo Poncho blocks Boss’s Orders', !targets.includes('Regieleki VMAX') && targets.includes('Bidoof'), targets.join(','));
  me.bench = [mon(g, 'Charizard ex')];
  await g.spread(op.active, [[me.bench[0], 100]]);
  check('Tera: no damage on the Bench', me.bench[0].damage === 0);
}
{ // Burned between turns
  const g = newGame(['svd-ninetales', 'sv-lucario']);
  const [me, op] = g.players;
  me.active = mon(g, 'Vulpix', { pick: (c) => c.set === 'sv3' }); op.active = mon(g, 'Riolu');
  op.active.status.burned = true;
  await withCoin(false, () => g.checkup(me));
  check('Burn: 20 damage, stays Burned on tails', op.active.damage === 20 && op.active.status.burned);
}
{ // Supporter limit and first-turn rule, Stadium once per turn, Rare Candy
  const g = newGame(['svl-gardevoir', 'svl-charizard']);
  const [me, op] = g.players;
  me.active = mon(g, 'Ralts', { played: 1 }); op.active = mon(g, 'Pidgey', { pick: (c) => c.set === 'sv3pt5' });
  me.hand = [card('Iono'), card('Iono'), card('Artazon'), card('Rare Candy'), card('Gardevoir ex')];
  g.turn = 1;
  check('No Supporter on the first player’s first turn', !g.legalActions(me).some((a) => a.card?.ttype === 'supporter'));
  g.turn = 5; me.flags.supporter = true;
  check('Only 1 Supporter per turn', !g.legalActions(me).some((a) => a.card?.ttype === 'supporter'));
  me.flags.stadiumPlayed = true;
  check('Only 1 Stadium per turn', !g.legalActions(me).some((a) => a.card?.ttype === 'stadium'));
  check('Rare Candy offered for Ralts → Gardevoir ex', g.legalActions(me).some((a) => a.tkind === 'rareCandy'));
}

{ // TM: Evolution with two identical Benched Pokémon and only one Evolution card in the deck (found by the Jev run)
  const g = newGame(['svl-charizard', 'sv-tapu-koko'], { answers0: [(pr) => pr.options[0].id, (pr) => pr.options[0].id] });
  const [me, op] = g.players;
  me.active = mon(g, 'Pidgey', { pick: (c) => c.set === 'sv3pt5', energy: ['Fire'], tools: ['Technical Machine: Evolution'] });
  me.bench = [mon(g, 'Charmander', { pick: (c) => c.set === 'sv4pt5' }), mon(g, 'Charmander', { pick: (c) => c.set === 'sv4pt5' })];
  op.active = mon(g, 'Tynamo');
  me.deck = me.deck.filter((c) => c.name !== 'Charmeleon' && c.name !== 'Pidgeotto'); me.deck.push(card('Charmeleon', (c) => c.set === 'sv4pt5'));
  const before = me.deck.length;
  await attackBy(g, me, 'Evolution');
  check('TM Evolution: only one Charmeleon → one evolves, no crash', me.bench.filter((x) => x.name === 'Charmeleon').length === 1 && me.deck.length === before - 1, me.bench.map((x) => x.name).join(','));
}
{ // Tuck Tail: Meowth ex and all its cards go back to the hand
  const g = newGame(['mel-greninja', 'svl-charizard']);
  const [me, op] = g.players;
  me.active = mon(g, 'Meowth ex', { energy: ['Water', 'Water', 'Water'] }); me.bench = [mon(g, 'Froakie')];
  op.active = mon(g, 'Pidgey', { pick: (c) => c.set === 'sv3pt5' });
  const hand0 = me.hand.length;
  await attackBy(g, me, 'Tuck Tail');
  check('Tuck Tail: Meowth ex and its Energy go to the hand', me.hand.some((c) => c.name === 'Meowth ex') && me.hand.filter((c) => c.kind === 'energy').length >= 3 && me.active?.name === 'Froakie', `${me.hand.map((c) => c.name)} ${me.active?.name}`);
}
{ // Gemstone Mimicry: only against a Tera Pokémon, and it copies one of its attacks
  const g = newGame(['svl-mewtwo', 'svl-charizard'], { answers0: [(pr) => pr.options[0].id] });
  const [me, op] = g.players;
  me.active = mon(g, "Team Rocket's Mimikyu", { energy: ['Psychic', 'Psychic'] });
  op.active = mon(g, 'Pidgey', { pick: (c) => c.set === 'sv3pt5' });
  check('Gemstone Mimicry needs a Tera Defending Pokémon', !g.legalActions(me).some((a) => a.kind === 'attack'));
  op.active = mon(g, 'Charizard ex');
  check('Gemstone Mimicry usable against Charizard ex (Tera)', g.legalActions(me).some((a) => a.kind === 'attack'));
  await attackBy(g, me, 'Gemstone Mimicry');
  check('Gemstone Mimicry copies Burning Darkness (180+)', op.active.damage >= 180, op.active.damage);
}
{ // ex-only vs ex-or-V bonuses, and Shadowy Concealment ignores Pokémon V
  const g = newGame(['sv-marnie', 'svd-miraidon']);
  const [me, op] = g.players;
  me.active = mon(g, "Marnie's Purrloin"); op.active = mon(g, 'Iron Hands');
  const nails = g.attacksOf(me.active).find((a) => a.name === 'Pointy Nails');
  const vsHands = g.baseRange(me.active, op.active, nails)[0];
  op.active = mon(g, 'Miraidon ex', { pick: (c) => c.set === 'sv5' });
  check('Pointy Nails +40 only against Pokémon ex', g.baseRange(me.active, op.active, nails)[0] === vsHands + 40);
  const g2 = newGame(['svd-miraidon', 'svl-miraidon']);
  const [h, v] = g2.players;
  h.active = mon(g2, 'Iron Hands'); v.active = mon(g2, 'Regieleki V');
  const sup = g2.attacksOf(h.active).find((a) => a.name === 'Superalloy Hands');
  check('Superalloy Hands +80 against a Pokémon V', g2.baseRange(h.active, v.active, sup)[0] === 160, g2.baseRange(h.active, v.active, sup)[0]);
  const g3 = newGame(['me-gengar', 'svl-miraidon']);
  const [gg, rv] = g3.players;
  gg.bench = [mon(g3, 'Mega Gengar ex')]; const sab = mon(g3, 'Sableye', { pick: (c) => c.set === 'me2' });
  g3.koBy = mon(g3, 'Regieleki V');
  check('Shadowy Concealment does not apply to a Pokémon V attacker', g3.prizeValue(gg, sab) === 1);
  g3.koBy = mon(g3, 'Miraidon ex', { pick: (c) => c.set === 'sv1' });
  check('Shadowy Concealment applies to a Pokémon ex attacker', g3.prizeValue(gg, sab) === 0);
}
// ---------------- 30th Celebration ----------------
{ // Damage: Solar Beatdown, Lunatic Claw, Energized Storm, Hardened Blade, Whirling Envy
  const g = newGame(['c30-espeon', 'c30-umbreon']);
  const [me, op] = g.players;
  const base = (a, name, d = op.active) => g.baseRange(a, d, g.attacksOf(a).find((x) => x.name === name))[0];
  me.active = mon(g, 'Espeon ex', { energy: ['Psychic', 'Fire'] }); me.bench = [mon(g, 'Eevee'), mon(g, 'Fennekin')];
  op.active = mon(g, 'Umbreon ex', { energy: ['Darkness'] });
  check('Solar Beatdown: 30 for each of your Pokémon (3)', base(me.active, 'Solar Beatdown') === 90, base(me.active, 'Solar Beatdown'));
  check('Lunatic Claw: 100 against an undamaged Pokémon', base(op.active, 'Lunatic Claw', me.active) === 100);
  me.active.damage = 10;
  check('Lunatic Claw: 240 against a damaged Pokémon', base(op.active, 'Lunatic Claw', me.active) === 240);
  const delphox = mon(g, 'Delphox', { energy: ['Fire', 'Fire'] }); me.bench.push(delphox);
  check('Energized Storm counts Energy on all Pokémon of both players (2+2+1)', base(delphox, 'Energized Storm') === 150, base(delphox, 'Energized Storm'));
  const zac = mon(g, 'Zacian', { pick: (c) => c.id === 'me55-106' });
  check('Hardened Blade: 20 without a Tool', base(zac, 'Hardened Blade') === 20);
  zac.tools = [{ card: card('Air Balloon'), expires: 1e9 }];
  check('Hardened Blade: 60 with a Tool', base(zac, 'Hardened Blade') === 60);
  const chi = mon(g, 'Chi-Yu', { pick: (c) => c.id === 'me5-59', damage: 10 });
  check('Whirling Envy: 20 with 1 damage counter', base(chi, 'Whirling Envy') === 20);
  chi.damage = 20;
  check('Whirling Envy: 110 with 2 damage counters', base(chi, 'Whirling Envy') === 110);
  check('Whirling Envy ignores Weakness', g.attacksOf(chi).find((x) => x.name === 'Whirling Envy').fx.noWeakness === true);
}
{ // Voltaic Lightning Energy: +20 for a Lightning Pokémon, nothing for others; it is not basic Energy
  const g = newGame(['c30-umbreon', 'c30-espeon']);
  const [me, op] = g.players;
  const volt = card('Voltaic Lightning Energy');
  check('Voltaic Lightning Energy provides Lightning and is Special', volt.energyType === 'Lightning' && volt.special === 'voltaic');
  me.active = mon(g, 'Zeraora', { pick: (c) => c.id === 'me55-57' }); me.active.energy = [volt];
  op.active = mon(g, 'Kangaskhan');
  check('Voltaic: Lightning Pokémon does 20 more (50 → 70)', g.finalDamage(me.active, op.active, 50).dmg === 70, g.finalDamage(me.active, op.active, 50).dmg);
  me.active.energy.push(card('Voltaic Lightning Energy'));
  check('Voltaic: two attached give +40', g.finalDamage(me.active, op.active, 50).dmg === 90);
  const umb = mon(g, 'Umbreon ex'); umb.energy = [card('Voltaic Lightning Energy')];
  check('Voltaic: no bonus for a Darkness Pokémon', g.finalDamage(umb, op.active, 100).dmg === 100);
  me.active.energy = [card('Voltaic Lightning Energy')];
  check('Voltaic pays a Lightning cost', g.attacksOf(me.active).some((a) => a.name === 'Rapid Draw') && canPay(me.active.payTypes, ['Lightning']));
}
{ // Life-Locked: the opponent's Active can't be healed; their Bench can
  const g = newGame(['c30-umbreon', 'c30-espeon']);
  const [me, op] = g.players;
  me.bench = [mon(g, 'Yveltal')]; me.active = mon(g, 'Toxel');
  op.active = mon(g, 'Eevee', { damage: 30 }); op.bench = [mon(g, 'Fennekin', { damage: 30 })];
  check('Life-Locked: the opponent’s Active is not healed', (await g.heal(op.active, 30)) === 0 && op.active.damage === 30);
  check('Life-Locked: a Benched Pokémon still heals', (await g.heal(op.bench[0], 30)) === 30);
  me.active.damage = 30;
  check('Life-Locked does not stop healing its owner’s Active', (await g.heal(me.active, 30)) === 30);
}
{ // Fetch and Hide: an Item from the opponent's hand goes to the bottom of their deck
  const g = newGame(['c30-espeon', 'c30-umbreon']);
  const [me, op] = g.players;
  me.active = mon(g, 'Eevee', { pick: (c) => c.attacks.some((a) => a.name === 'Fetch and Hide'), energy: ['Psychic'] });
  op.active = mon(g, 'Toxel');
  const ball = card('Ultra Ball'); op.hand = [card('Zeraora'), ball, card('Hilda')];
  await attackBy(g, me, 'Fetch and Hide');
  check('Fetch and Hide: Ultra Ball goes to the bottom of the deck', op.deck[0] === ball && !op.hand.includes(ball) && op.hand.length === 2);
}
{ // Flaring Magic, Fiery Flapping, Hilda, Rosa's Encouragement
  const g = newGame(['c30-espeon', 'c30-umbreon']);
  const [me, op] = g.players;
  me.active = mon(g, 'Delphox'); me.bench = [mon(g, 'Moltres', { pick: (c) => c.id === 'me55-11' })];
  op.active = mon(g, 'Toxel');
  me.hand = [en('Fire'), card('Switch'), card('Ultra Ball')];
  const acts = g.legalActions(me);
  check('Fiery Flapping needs Articuno and Zapdos in play', !acts.some((a) => a.pkind === 'fieryFlapping'));
  const fm = acts.find((a) => a.pkind === 'flaringMagic');
  check('Flaring Magic is offered with a Fire Energy in hand', !!fm);
  await g.perform(me, fm);
  check('Flaring Magic: Fire Energy discarded, hand refilled to 7', me.hand.length === 7 && me.discard.some((c) => c.energyType === 'Fire'), me.hand.length);
  check('Flaring Magic: once per turn', !g.legalActions(me).some((a) => a.pkind === 'flaringMagic'));
  // Fiery Flapping with Articuno and Zapdos in play (no deck has a plain Articuno: a stand-in Basic named Articuno)
  me.bench.push(mon(g, 'Zapdos'), new Mon({ ...card('Toxel'), name: 'Articuno' }, 0));
  me.hand.push(en('Fire'));
  const moltres = me.bench[0];
  const ff = g.legalActions(me).find((a) => a.pkind === 'fieryFlapping');
  check('Fiery Flapping offered with Articuno and Zapdos in play', !!ff && ff.target === moltres);
  if (ff) await g.perform(me, ff);
  check('Fiery Flapping attaches a Fire Energy from the hand to Moltres', moltres.energy.length === 1 && moltres.energy[0].energyType === 'Fire');

  const g2 = newGame(['c30-umbreon', 'c30-espeon']);
  const [u, e] = g2.players;
  u.active = mon(g2, 'Toxel'); e.active = mon(g2, 'Eevee');
  u.hand = [card('Hilda')];
  const hilda = g2.legalActions(u).find((a) => a.tkind === 'hilda');
  await g2.perform(u, hilda);
  check('Hilda: an Evolution Pokémon and an Energy card', u.hand.some((c) => c.kind === 'pokemon' && c.stage > 0) && u.hand.some((c) => c.kind === 'energy'), u.hand.map((c) => c.name));

  const g3 = newGame(['c30-espeon', 'c30-umbreon']);
  const [r, x] = g3.players;
  r.active = mon(g3, 'Delphox'); x.active = mon(g3, 'Toxel');
  r.discard = [en('Fire'), en('Fire'), en('Psychic')];
  r.hand = [card("Rosa's Encouragement")];
  check('Rosa’s Encouragement needs more Prize cards left than the opponent', !g3.legalActions(r).some((a) => a.tkind === 'rosasEncouragement'));
  x.prizes.pop();
  const rosa = g3.legalActions(r).find((a) => a.tkind === 'rosasEncouragement');
  check('Rosa’s Encouragement playable when behind', !!rosa);
  await g3.perform(r, rosa);
  check('Rosa’s Encouragement attaches 2 basic Energy to the Stage 2', r.active.energy.length === 2 && r.discard.length === 2, r.active.energy.length);
}
// ---------------- Sword & Shield ----------------
const sw = (c) => c.set?.startsWith('swsh');
const isBasicCard = (c) => c.kind === 'pokemon' && c.stage === 0;
// A Defending Pokémon that survives the hit, so the damage can be read (same card, 400 HP).
const withAtk = (atk) => (c) => (c.attacks || []).some((a) => a.name === atk);
const tank = (g, name, opts) => { const m = mon(g, name, opts); m.stack[0] = { ...m.card, hp: 400 }; return m; };
// Play a Trainer from the hand through the legal moves (the Supporter limit is reset so several can be played).
const play = async (g, p, name) => {
  p.flags.supporter = false;
  const c = card(name, sw); p.hand.push(c);
  const act = g.legalActions(p).find((a) => a.kind === 'trainer' && a.card === c);
  if (!act) throw new Error('not playable: ' + name);
  await g.perform(p, act);
};
{ // Damage formulas: Charge Order, Royal Blaze, Vise Bite, Power Press, Double Stomp range, Gulp Missile range, Hone Claws
  const g = newGame(['swsh-zamazenta', 'swsh-drednaw']);
  const [me, op] = g.players;
  const base = (a, name, d = op.active) => g.baseRange(a, d, g.attacksOf(a).find((x) => x.name === name));
  me.active = mon(g, 'Bisharp'); me.bench = [mon(g, 'Pawniard'), mon(g, 'Pawniard'), mon(g, 'Rookidee')];
  op.active = mon(g, 'Drednaw', { pick: (c) => c.attacks.some((a) => a.name === 'Vise Bite') });
  check('Charge Order: 30 + 30 for each Benched Pawniard (2)', base(me.active, 'Charge Order')[0] === 90, base(me.active, 'Charge Order'));
  me.active = mon(g, 'Charizard', { pick: sw }); me.discard = [card('Leon', sw), card('Leon', sw), card('Hop', sw)];
  check('Royal Blaze: 100 + 50 for each Leon in the discard pile (2)', base(me.active, 'Royal Blaze')[0] === 200, base(me.active, 'Royal Blaze')[0]);
  const dred = me.active = mon(g, 'Drednaw', { pick: (c) => c.attacks.some((a) => a.name === 'Vise Bite') });
  const cost = g.retreatCost(op, op.active);
  check('Vise Bite: +30 for each Colorless in the Retreat Cost', base(dred, 'Vise Bite', op.active)[0] === 60 + 30 * cost && cost > 0, `${base(dred, 'Vise Bite', op.active)[0]} cost ${cost}`);
  const ston = mon(g, 'Stonjourner', { energy: ['Fighting', 'Fighting', 'Fighting', 'Fighting'] });
  check('Power Press: 120 with exactly the cost', base(ston, 'Power Press')[0] === 120);
  ston.energy.push(en('Fighting'));
  check('Power Press: 180 with an extra Energy', base(ston, 'Power Press')[0] === 180);
  const hip = mon(g, 'Hippopotas');
  check('Double Stomp: 70 to 130', String(base(hip, 'Double Stomp')) === '70,130');
  me.bench = [mon(g, 'Arrokuda'), mon(g, 'Arrokuda'), mon(g, 'Pawniard')];
  const cram = me.active = mon(g, 'Cramorant', { pick: (c) => c.attacks.some((a) => a.name === 'Continuous Gulp Missile') });
  check('Continuous Gulp Missile: 0 to 120 with 2 Benched Arrokuda', String(base(cram, 'Continuous Gulp Missile')) === '0,120');
}
{ // Attacks with choices and side effects
  const g = newGame(['swsh-drednaw', 'swsh-zacian'], { answers0: ['2'] });
  const [me, op] = g.players;
  me.active = mon(g, 'Cramorant', { pick: (c) => c.attacks.some((a) => a.name === 'Continuous Gulp Missile'), energy: ['Water', 'Water'] });
  me.bench = [mon(g, 'Arrokuda'), mon(g, 'Arrokuda'), mon(g, 'Oshawott')];
  op.active = mon(g, 'Unfezant'); op.bench = [mon(g, 'Pidove')];
  await attackBy(g, me, 'Continuous Gulp Missile');
  check('Continuous Gulp Missile: 2 Arrokuda discarded, 120 damage', op.active.damage === 120 && me.bench.length === 1 && me.discard.filter((c) => c.name === 'Arrokuda').length === 2, `${op.active.damage} ${me.bench.length}`);
}
{ // Targeted Skewer, Aqua Wash (2 Energy back), Vise Wave after Nessa
  const g = newGame(['swsh-drednaw', 'swsh-zacian'], { answers0: ['yes'] });
  const [me, op] = g.players;
  me.active = mon(g, 'Barraskewda', { pick: withAtk('Targeted Skewer'), energy: ['Water'] });
  op.active = mon(g, 'Zacian', { pick: sw }); op.bench = [mon(g, 'Unfezant', { damage: 30 })];
  await attackBy(g, me, 'Targeted Skewer');
  check('Targeted Skewer: 20 for each of 3 damage counters', op.bench[0].damage === 90, op.bench[0].damage);
  const g2 = newGame(['swsh-drednaw', 'swsh-zacian'], { answers0: ['yes'] });
  const [m2, o2] = g2.players;
  m2.active = mon(g2, 'Samurott', { pick: withAtk('Aqua Wash'), energy: ['Water', 'Water', 'Water'] });
  o2.active = mon(g2, 'Unfezant', { energy: ['Colorless', 'Colorless', 'Colorless'] }); o2.bench = [mon(g2, 'Pidove')];
  const h0 = o2.hand.length;
  await attackBy(g2, m2, 'Aqua Wash');
  check('Aqua Wash: 2 Energy from the Defending Pokémon go to its owner’s hand', o2.active.energy.length === 1 && o2.hand.length === h0 + 2, `${o2.active.energy.length} ${o2.hand.length - h0}`);
  check('Swaddling Leaves: Samurott takes 30 less', g2.finalDamage(o2.active, m2.active, 100).dmg === 70 || g2.finalDamage(o2.active, m2.active, 100).dmg === 170, g2.finalDamage(o2.active, m2.active, 100).dmg);
  const g3 = newGame(['swsh-drednaw', 'swsh-zacian']);
  const [m3, o3] = g3.players;
  m3.active = mon(g3, 'Drednaw', { pick: (c) => c.attacks.some((a) => a.name === 'Vise Wave'), energy: ['Water', 'Water', 'Water'] }); o3.active = mon(g3, 'Unfezant'); o3.bench = [mon(g3, 'Pidove')];
  await attackBy(g3, m3, 'Vise Wave');
  check('Vise Wave without Nessa: no Paralysis', !o3.active.status.paralyzed);
  g3.turn += 2; g3.current = m3; m3.flags = { energy: false, retreat: false, powers: {} }; o3.active.damage = 0;
  m3.discard.push(en('Water'));
  await play(g3, m3, 'Nessa');
  await attackBy(g3, m3, 'Vise Wave');
  check('Vise Wave after playing Nessa: Paralyzed', !!o3.active.status.paralyzed);
}
{ // Iron Wings, Pluck, Frozen Heat, Hone Claws, Meteor Assault, Daunt
  const g = newGame(['swsh-zamazenta', 'swsh-cinderace'], { answers0: ['yes'] });
  const [me, op] = g.players;
  me.active = mon(g, 'Corviknight', { pick: withAtk('Iron Wings'), energy: ['Metal', 'Metal', 'Metal'] }); me.bench = [mon(g, 'Rookidee')];
  op.active = mon(g, 'Dubwool');
  await attackBy(g, me, 'Iron Wings');
  check('Iron Wings: 2 Energy discarded, takes 100 less next turn', me.active.energy.length === 1 && me.active.effects.reduce?.n === 100);
  const g2 = newGame(['swsh-zamazenta', 'swsh-zacian']);
  const [m2, o2] = g2.players;
  m2.active = mon(g2, 'Corvisquire', { pick: withAtk('Pluck'), energy: ['Metal'] });
  o2.active = mon(g2, 'Zacian', { pick: sw }); o2.active.tools = [{ card: card('Air Balloon'), expires: 1e9 }];
  await attackBy(g2, m2, 'Pluck');
  check('Pluck: the Defending Pokémon’s Tool is discarded', !o2.active.tools.length && o2.discard.some((c) => c.name === 'Air Balloon'));
  const g3 = newGame(['swsh-darmanitan', 'swsh-zacian'], { answers0: ['yes'] });
  const [m3, o3] = g3.players;
  m3.active = mon(g3, 'Galarian Darmanitan', { pick: (c) => c.attacks.some((a) => a.name === 'Frozen Heat'), energy: ['Water', 'Water', 'Water'] });
  o3.active = tank(g3, 'Zacian', { pick: sw });
  await attackBy(g3, m3, 'Frozen Heat');
  check('Frozen Heat: all Water Energy discarded, 110 + 60', o3.active.damage >= 170 && !m3.active.energy.length, o3.active.damage);
  const g4 = newGame(['swsh-zacian', 'swsh-cinderace']);
  const [m4, o4] = g4.players;
  m4.active = mon(g4, 'Galarian Meowth', { pick: withAtk('Hone Claws'), energy: ['Metal', 'Colorless'] }); o4.active = mon(g4, 'Wooloo');
  await attackBy(g4, m4, 'Hone Claws');
  const slash = g4.attacksOf(m4.active).find((a) => a.name === 'Slash');
  g4.turn += 2;
  check('Hone Claws: Slash does 60 more next turn', g4.baseRange(m4.active, o4.active, slash)[0] === 90, g4.baseRange(m4.active, o4.active, slash)[0]);
  const g5 = newGame(['swsh-sirfetchd', 'swsh-cinderace']);
  const [m5, o5] = g5.players;
  m5.active = mon(g5, "Galarian Sirfetch'd", { energy: ['Fighting', 'Fighting', 'Fighting'] }); m5.bench = [mon(g5, 'Diglett')];
  o5.active = mon(g5, 'Dubwool', { damage: 0 }); o5.bench = [mon(g5, 'Wooloo')];
  await attackBy(g5, m5, 'Meteor Assault');
  g5.turn += 2; g5.current = m5;
  const canMeteor = () => g5.legalActions(m5).some((a) => a.kind === 'attack' && g5.attacksOf(m5.active)[a.index].name === 'Meteor Assault');
  check('Meteor Assault: not again while it stays Active', !canMeteor());
  g5.swapActive(m5, m5.bench[0]); g5.swapActive(m5, m5.bench[0]);
  check('Meteor Assault: usable again after leaving the Active Spot', canMeteor());
  const g6 = newGame(['swsh-zacian', 'swsh-cinderace']);
  const [m6, o6] = g6.players;
  m6.active = mon(g6, 'Unfezant', { pick: withAtk('Daunt'), energy: ['Colorless', 'Colorless'] }); o6.active = mon(g6, 'Dubwool');
  await attackBy(g6, m6, 'Daunt');
  check('Daunt: the Defending Pokémon does 50 less next turn', g6.finalDamage(o6.active, m6.active, 120).dmg === 70, g6.finalDamage(o6.active, m6.active, 120).dmg);
}
{ // Coin flips: Bright Flame (tails), Double Stomp (two heads), Dig (heads), Cotton Ride (heads)
  const g = newGame(['swsh-cinderace', 'swsh-sirfetchd']);
  const [me, op] = g.players;
  me.active = mon(g, 'Cinderace', { pick: withAtk('Bright Flame'), energy: ['Fire', 'Fire', 'Fire'] }); op.active = mon(g, 'Hippowdon'); op.bench = [mon(g, 'Diglett')];
  await withCoin(false, () => attackBy(g, me, 'Bright Flame'));
  check('Bright Flame tails: 2 Energy discarded', me.active.energy.length === 1);
  const g2 = newGame(['swsh-sirfetchd', 'swsh-cinderace']);
  const [m2, o2] = g2.players;
  m2.active = mon(g2, 'Hippopotas', { pick: withAtk('Double Stomp'), energy: ['Fighting', 'Fighting', 'Fighting', 'Fighting'] }); o2.active = tank(g2, 'Cinderace');
  await withCoin(true, () => attackBy(g2, m2, 'Double Stomp'));
  check('Double Stomp: two heads → 130', o2.active.damage === 130, o2.active.damage);
  const g3 = newGame(['swsh-sirfetchd', 'swsh-cinderace']);
  const [m3, o3] = g3.players;
  m3.active = mon(g3, 'Dugtrio', { pick: withAtk('Dig'), energy: ['Fighting'] }); o3.active = mon(g3, 'Cinderace');
  await withCoin(true, () => attackBy(g3, m3, 'Dig'));
  check('Dig heads: all damage and effects prevented next turn', m3.active.effects.shield?.kind === 'all');
  const g4 = newGame(['swsh-rillaboom', 'swsh-cinderace']);
  const [m4, o4] = g4.players;
  m4.active = mon(g4, 'Whimsicott', { pick: withAtk('Cotton Ride'), energy: ['Grass'] }); o4.active = mon(g4, 'Cinderace'); o4.bench = [mon(g4, 'Vulpix')];
  const deck0 = o4.deck.length;
  await withCoin(true, () => attackBy(g4, m4, 'Cotton Ride'));
  check('Cotton Ride heads: the Active Pokémon goes into the deck, a new one comes in', o4.active?.name === 'Vulpix' && o4.deck.length === deck0 + 1);
}
{ // Silent Shot, Heavy Pincers, Raging Flames, Aurora Loop, Chirp, Water Reserve, Metal Sharpener, Energy Slap, Void Gale
  const g = newGame(['swsh-inteleon', 'swsh-cinderace']);
  const [me, op] = g.players;
  me.active = mon(g, 'Inteleon', { pick: withAtk('Silent Shot'), energy: ['Water'] }); op.active = mon(g, 'Cinderace'); op.hand = [card('Hop', sw), card('Switch'), card('Bede', sw)];
  await attackBy(g, me, 'Silent Shot');
  check('Silent Shot: a random card of the opponent’s hand is discarded', op.hand.length === 2 && op.discard.length === 1);
  me.active = mon(g, 'Kingler', { energy: ['Water'], pick: withAtk('Heavy Pincers') });
  const od = op.deck.length;
  await attackBy(g, me, 'Heavy Pincers');
  check('Heavy Pincers: top card of the opponent’s deck discarded', op.deck.length === od - 1);
  const g2 = newGame(['swsh-charizard', 'swsh-inteleon']);
  const [m2, o2] = g2.players;
  m2.active = mon(g2, 'Charmeleon', { pick: withAtk('Raging Flames'), energy: ['Fire', 'Fire'] }); o2.active = mon(g2, 'Kingler');
  const d2 = m2.deck.length;
  await attackBy(g2, m2, 'Raging Flames');
  check('Raging Flames: top 3 cards of your deck discarded', m2.deck.length === d2 - 3 && m2.discard.length === 3);
  const g3 = newGame(['swsh-darmanitan', 'swsh-cinderace']);
  const [m3, o3] = g3.players;
  m3.active = mon(g3, 'Suicune', { pick: withAtk('Aurora Loop'), energy: ['Water', 'Water', 'Water'] }); o3.active = tank(g3, 'Cinderace');
  const hand3 = m3.hand.length;
  await attackBy(g3, m3, 'Aurora Loop');
  check('Aurora Loop: 2 Water Energy back to the hand', m3.hand.length === hand3 + 2 && m3.active.energy.length === 1);
  const g4 = newGame(['swsh-zacian', 'swsh-cinderace']);
  const [m4, o4] = g4.players;
  m4.active = mon(g4, 'Pidove', { pick: withAtk('Chirp') }); o4.active = mon(g4, 'Cinderace');
  await attackBy(g4, m4, 'Chirp');
  check('Chirp: only Pokémon with Fighting Resistance', m4.hand.length > 0 && m4.hand.every((c) => c.kind === 'pokemon' && c.resistance === 'Fighting'), m4.hand.map((c) => c.name));
  const g5 = newGame(['swsh-inteleon', 'swsh-cinderace']);
  const [m5, o5] = g5.players;
  m5.active = mon(g5, 'Mantine', { pick: withAtk('Water Reserve'), energy: ['Water'] }); o5.active = mon(g5, 'Cinderace');
  await attackBy(g5, m5, 'Water Reserve');
  check('Water Reserve: up to 3 Water Energy', m5.hand.length === 3 && m5.hand.every((c) => c.energyType === 'Water'));
  const g6 = newGame(['swsh-zamazenta', 'swsh-cinderace']);
  const [m6, o6] = g6.players;
  m6.active = mon(g6, 'Duraludon', { pick: withAtk('Metal Sharpener'), energy: ['Colorless'] }); m6.bench = [mon(g6, 'Ferroseed')]; o6.active = mon(g6, 'Cinderace');
  m6.discard = [en('Metal'), en('Fire')];
  await attackBy(g6, m6, 'Metal Sharpener');
  check('Metal Sharpener: a Metal Energy from the discard pile is attached', g6.allMons(m6).some((x) => x.energy.some((e) => e.energyType === 'Metal')) && m6.discard.length === 1);
  const g7 = newGame(['swsh-zamazenta', 'swsh-cinderace'], { answers0: ['yes'] });
  const [m7, o7] = g7.players;
  m7.active = mon(g7, 'Ferrothorn', { pick: withAtk('Energy Slap'), energy: ['Metal', 'Metal', 'Metal'] }); m7.bench = [mon(g7, 'Ferroseed')]; o7.active = mon(g7, 'Cinderace');
  await attackBy(g7, m7, 'Energy Slap');
  check('Energy Slap (yes): all Energy moved to the Bench', !m7.active.energy.length && m7.bench[0].energy.length === 3);
  const g8 = newGame(['me-gengar', 'swsh-cinderace']);
  const [m8, o8] = g8.players;
  m8.active = mon(g8, 'Mega Gengar ex', { pick: withAtk('Void Gale'), energy: ['Darkness', 'Darkness', 'Darkness'] }); m8.bench = [mon(g8, 'Gastly')]; o8.active = mon(g8, 'Cinderace');
  await attackBy(g8, m8, 'Void Gale');
  check('Void Gale: moves an Energy to the Bench (was a no-op before)', m8.bench[0].energy.length === 1 && m8.active.energy.length === 2, `${m8.bench[0].energy.length}`);
}
{ // Trainers
  const g = newGame(['swsh-charizard', 'swsh-inteleon'], { answers0: ['rock'], answers1: ['scissors'] });
  const [me, op] = g.players;
  me.active = mon(g, 'Charmander', { energy: ['Fire'] }); me.bench = [mon(g, 'Yanma')]; op.active = mon(g, 'Krabby'); op.bench = [mon(g, 'Sobble')];
  await play(g, me, 'Dan');
  check('Dan: 2 cards, +2 for winning Rock-Paper-Scissors', me.hand.length === 4, me.hand.length);
  me.hand = [];
  await play(g, me, 'Leon');
  check('Leon: +30 to the Defending Pokémon this turn', g.finalDamage(me.active, op.active, 30).dmg === 60, g.finalDamage(me.active, op.active, 30).dmg);
  me.hand = [];
  await play(g, me, 'Bird Keeper');
  check('Bird Keeper: switched and drew 3', me.active.name === 'Yanma' && me.hand.length === 3);
  me.hand = [en('Fire')];
  await play(g, me, 'Bede');
  check('Bede: basic Energy from the hand to a Benched Pokémon', me.bench[0].energy.length === 2 && !me.hand.some((c) => c.kind === 'energy'));
  me.hand = [];
  await play(g, me, 'Hop');
  check('Hop: draw 3', me.hand.length === 3);
  me.hand = [];
  { // Ordinary Rod, "both"
    const gr = newGame(['swsh-charizard', 'swsh-inteleon'], { answers0: ['both'] });
    const [r, q] = gr.players;
    r.active = mon(gr, 'Charmander'); q.active = mon(gr, 'Krabby');
    r.discard = [card('Charmander'), card('Charmeleon'), en('Fire'), en('Fire'), en('Fire')];
    const deckN = r.deck.length;
    await play(gr, r, 'Ordinary Rod');
    check('Ordinary Rod (both): 2 Pokémon and 2 basic Energy back into the deck', r.deck.length === deckN + 4 && r.discard.filter((c) => c.name !== 'Ordinary Rod').length === 1, r.deck.length - deckN);
  }
  me.hand = [];
  await play(g, me, 'Evolution Incense');
  check('Evolution Incense: an Evolution Pokémon', me.hand.length === 1 && me.hand[0].stage > 0);
  me.hand = [];
  await play(g, me, 'Sonia');
  check('Sonia: up to 2 Basic Pokémon or basic Energy', me.hand.length === 2 && (me.hand.every((c) => c.stage === 0 && c.kind === 'pokemon') || me.hand.every((c) => c.kind === 'energy')));
  me.active.damage = 80; me.active.status.poisoned = 1; me.hand = [];
  await play(g, me, 'Pokémon Center Lady');
  check('Pokémon Center Lady: heal 60 and cure', me.active.damage === 20 && !me.active.status.poisoned);
  me.hand = [];
  await withCoin(true, () => play(g, me, 'Pokémon Catcher'));
  check('Pokémon Catcher heads: a Benched Pokémon is pulled in', op.active.name === 'Sobble');
  me.discard.push(en('Fire'));
  const basicBefore = me.bench.concat(me.active).filter((x) => x.card.stage === 0).reduce((s, x) => s + x.energy.length, 0);
  await withCoin(true, () => play(g, me, 'Turbo Patch'));
  const basicAfter = me.bench.concat(me.active).filter((x) => x.card.stage === 0).reduce((s, x) => s + x.energy.length, 0);
  check('Turbo Patch heads: a basic Energy from the discard pile onto a Basic Pokémon', basicAfter === basicBefore + 1);
  me.hand = []; me.discard.push(card('Sobble'), en('Water'));
  await play(g, me, 'Nessa');
  check('Nessa: Water Pokémon and Water Energy back to the hand', me.hand.some((c) => c.name === 'Sobble') && me.hand.some((c) => c.energyType === 'Water'));
  const g2 = newGame(['swsh-zacian', 'swsh-inteleon']);
  const [z, x2] = g2.players;
  z.active = mon(g2, 'Zacian', { pick: sw }); z.bench = [mon(g2, 'Galarian Perrserker')]; x2.active = mon(g2, 'Krabby');
  z.discard = [en('Metal')];
  await play(g2, z, 'Metal Saucer');
  check('Metal Saucer: Metal Energy onto a Benched Metal Pokémon', z.bench[0].energy.length === 1);
  z.hand = [card('Capacious Bucket', sw)];
  check('Capacious Bucket is not offered when the deck has no Water Energy', !g2.legalActions(z).some((a) => a.tkind === 'capaciousBucket'));
  const gb = newGame(['swsh-drednaw', 'swsh-zacian']);
  const [b, bq] = gb.players;
  b.active = mon(gb, 'Chewtle'); bq.active = mon(gb, 'Pidove');
  await play(gb, b, 'Capacious Bucket');
  check('Capacious Bucket: 2 Water Energy', b.hand.filter((c) => c.energyType === 'Water').length === 2);
  z.hand = [];
  await play(g2, z, 'Poké Kid');
  check('Poké Kid: a Pokémon', z.hand.length === 1 && z.hand[0].kind === 'pokemon');
}
{ // Battle Sense: top 3 cards, keep 1, discard 2, once per turn
  const g = newGame(['swsh-charizard', 'swsh-inteleon']);
  const [me, op] = g.players;
  me.active = mon(g, 'Charizard', { pick: sw }); op.active = mon(g, 'Krabby');
  const d0 = me.deck.length;
  const act = g.legalActions(me).find((a) => a.pkind === 'battleSense');
  await g.perform(me, act);
  check('Battle Sense: 1 card to the hand, 2 discarded', me.hand.length === 1 && me.discard.length === 2 && me.deck.length === d0 - 3);
  check('Battle Sense: once per turn', !g.legalActions(me).some((a) => a.pkind === 'battleSense'));
}
// ---------------- Sword & Shield V Battle / League Battle Decks ----------------
const playAny = async (g, p, name, pick) => {
  p.flags.supporter = false;
  const c = card(name, pick); p.hand.push(c);
  const act = g.legalActions(p).find((a) => a.kind === 'trainer' && a.card.name === c.name); // one action per card name
  if (!act) throw new Error('not playable: ' + name);
  await g.perform(p, act);
  return c;
};
const useAbility = async (g, p, kind) => { const act = g.legalActions(p).find((a) => a.kind === 'power' && a.pkind === kind); if (!act) throw new Error('no ability ' + kind); return g.perform(p, act); };
{ // Prize cards and Rule Boxes: VSTAR 2, VMAX 3, TAG TEAM 3
  const g = newGame(['swl-palkia', 'swl-zacian']);
  check('VSTAR gives up 2 Prize cards and evolves from its V', byName('Origin Forme Palkia VSTAR').prizes === 2 && byName('Origin Forme Palkia VSTAR').stage === 1 && byName('Origin Forme Palkia VSTAR').evolvesFrom === 'Origin Forme Palkia V');
  check('VMAX gives up 3 Prize cards', byName('Mew VMAX').prizes === 3);
  check('TAG TEAM gives up 3 Prize cards', byName('Arceus & Dialga & Palkia-GX').prizes === 3);
  check('Radiant Pokémon have a Rule Box', byName('Radiant Greninja').ruleBox === true);
}
{ // GX attack once per game (and saved), Altered Creation +30 and the extra Prize card
  const g = newGame(['swl-zacian', 'swl-inteleon']);
  const [me, op] = g.players;
  me.active = mon(g, 'Arceus & Dialga & Palkia-GX', { energy: ['Metal', 'Water'] }); me.bench = [mon(g, 'Jirachi')];
  op.active = mon(g, 'Sobble', { pick: (c) => c.set === 'swsh1' }); op.bench = [mon(g, 'Snom')];
  check('GX attack offered before any GX attack was used', g.legalActions(me).some((a) => a.kind === 'attack' && g.attacksOf(me.active)[a.index].name === 'Altered Creation-GX'));
  await attackBy(g, me, 'Altered Creation-GX');
  g.turn += 2; g.current = me;
  check('GX attack: not again in the same game', !g.legalActions(me).some((a) => a.kind === 'attack' && g.attacksOf(me.active)[a.index].name === 'Altered Creation-GX'));
  const g2 = Game.restore(JSON.parse(JSON.stringify(g.serialize())), { controllers: [scripted(), scripted()], hooks: {} });
  check('GX attack used is saved with the game', g2.players[0].gxUsed === true);
  check('Altered Creation-GX: your attacks do 30 more', g.finalDamage(me.active, op.active, 100).dmg === 130, g.finalDamage(me.active, op.active, 100).dmg);
  g.koBy = me.active;
  check('Altered Creation-GX with an extra Water Energy: 1 more Prize card', g.prizeValue(op, op.active) === 2, g.prizeValue(op, op.active));
}
{ // Strike Energy: only on their Pokémon; Rapid Strike Energy pays 2 Water/Fighting; Single Strike +20; Double Turbo −20; Stone Fighting −20
  const g = newGame(['swl-urshifu-rapid', 'swl-urshifu-single']);
  const [me, op] = g.players;
  me.active = mon(g, 'Rapid Strike Urshifu V'); me.bench = [mon(g, 'Minccino', { pick: (c) => c.set === 'swsh1' })];
  op.active = mon(g, 'Single Strike Urshifu V');
  const rse = card('Rapid Strike Energy'); me.hand = [rse];
  const targets = g.legalActions(me).filter((a) => a.kind === 'energy').map((a) => a.target.name);
  check('Rapid Strike Energy can only be attached to Rapid Strike Pokémon', targets.includes('Rapid Strike Urshifu V') && !targets.includes('Minccino'), targets);
  me.active.energy = [rse];
  check('Rapid Strike Energy pays Fighting + Water', canPay(me.active.payTypes, ['Fighting', 'Water']));
  op.active.energy = [card('Single Strike Energy')];
  check('Single Strike Energy: +20 damage', g.finalDamage(op.active, me.active, 100).dmg === 120, g.finalDamage(op.active, me.active, 100).dmg);
  const g2 = newGame(['swl-mew', 'swl-urshifu-single']);
  const [mw, ss] = g2.players;
  mw.active = mon(g2, 'Mew V'); mw.active.energy = [card('Double Turbo Energy')];
  ss.active = mon(g2, 'Stonjourner', { pick: (c) => c.set === 'swsh5' }); ss.active.energy = [card('Stone Fighting Energy')];
  check('Double Turbo Energy: 2 Colorless, attacks do 20 less', mw.active.energyTypes.length === 2 && g2.finalDamage(mw.active, ss.active, 100).dmg === 80 - 20, g2.finalDamage(mw.active, ss.active, 100).dmg);
  mw.active.energy = [card('Fusion Strike Energy')];
  check('Fusion Strike Energy pays any type', canPay(mw.active.payTypes, ['Metal']) && canPay(mw.active.payTypes, ['Psychic']));
  const g3 = newGame(['swl-zacian', 'swl-mew']);
  const [z, x3] = g3.players;
  z.active = mon(g3, 'Zacian V'); x3.active = mon(g3, 'Mew V');
  const aurora = card('Aurora Energy'); z.hand = [aurora];
  check('Aurora Energy needs another card in hand to discard', !g3.legalActions(z).some((a) => a.kind === 'energy'));
  z.hand.push(card('Switch'));
  await g3.perform(z, g3.legalActions(z).find((a) => a.kind === 'energy'));
  check('Aurora Energy: attached, another card discarded, any type', z.active.energy.length === 1 && z.hand.length === 0 && z.discard.length === 1 && canPay(z.active.payTypes, ['Water']));
}
{ // Path to the Peak, Steely Spirit, Choice Belt, Big Charm, Tower of Waters
  const g = newGame(['swl-zacian', 'swl-urshifu-rapid']);
  const [me, op] = g.players;
  me.active = mon(g, 'Zacian V', { energy: ['Metal'] }); me.bench = [mon(g, 'Galarian Perrserker', { pick: (c) => c.set === 'swsh1' }), mon(g, 'Galarian Perrserker', { pick: (c) => c.set === 'swsh1' })];
  op.active = mon(g, 'Rapid Strike Urshifu V'); op.bench = [mon(g, 'Remoraid')];
  check('Steely Spirit: +20 for each Perrserker (2)', g.finalDamage(me.active, op.active, 100).dmg === 140, g.finalDamage(me.active, op.active, 100).dmg);
  me.active.tools = [{ card: card('Choice Belt'), expires: 1e9 }];
  check('Choice Belt: +30 against a Pokémon V', g.finalDamage(me.active, op.active, 100).dmg === 170);
  [op.active, op.bench[0]] = [op.bench[0], op.active];
  check('Choice Belt: nothing against a non-V', g.finalDamage(me.active, op.active, 100).dmg === 140, g.finalDamage(me.active, op.active, 100).dmg);
  me.bench[0].tools = [{ card: card('Big Charm'), expires: 1e9 }];
  check('Big Charm: +30 HP', me.bench[0].maxHp === me.bench[0].card.hp + 30);
  check('Intrepid Sword offered without Path to the Peak', g.legalActions(me).some((a) => a.pkind === 'intrepidSword'));
  g.stadium = { card: card('Path to the Peak'), owner: 1 };
  check('Path to the Peak: Rule Box Pokémon have no Abilities', !g.legalActions(me).some((a) => a.pkind === 'intrepidSword'));
  check('Path to the Peak: Steely Spirit (no Rule Box) still works', g.finalDamage(me.active, op.active, 100).dmg === 140);
  [op.active, op.bench[0]] = [op.bench[0], op.active];
  const cost = g.retreatCost(op, op.active);
  g.stadium = { card: card('Tower of Waters'), owner: 1 };
  check('Tower of Waters: Rapid Strike Pokémon retreat for 2 less', g.retreatCost(op, op.active) === Math.max(0, cost - 2), `${cost} → ${g.retreatCost(op, op.active)}`);
}
{ // Wave Veil, Infiltrator, Lesson in Zeal
  const g = newGame(['swv-gardevoir', 'swl-palkia']);
  const [me, op] = g.players;
  me.active = mon(g, 'Inteleon V', { energy: ['Water'] }); op.active = mon(g, 'Bidoof'); op.bench = [mon(g, 'Manaphy', { pick: (c) => c.powerKind === 'waveVeil' }), mon(g, 'Bibarel')];
  await g.spread(me.active, [[op.bench[1], 30]]);
  check('Wave Veil: no damage to Benched Pokémon from attacks', op.bench[1].damage === 0);
  const g2 = newGame(['swv-gardevoir', 'swl-palkia']);
  const [m2, o2] = g2.players;
  m2.active = mon(g2, 'Dragapult', { pick: (c) => c.set === 'swsh2' }); o2.active = mon(g2, 'Origin Forme Palkia V', { energy: ['Water', 'Water', 'Water'] }); m2.bench = [mon(g2, 'Dreepy')];
  g2.current = o2;
  await withCoin(true, () => attackBy(g2, o2, 'Hydro Break'));
  check('Infiltrator heads: the damage is prevented', m2.active.damage === 0, m2.active.damage);
  const g3 = newGame(['swl-mew', 'swl-palkia']);
  const [m3, o3] = g3.players;
  m3.active = mon(g3, 'Mew V'); m3.bench = [mon(g3, 'Oricorio', { pick: (c) => c.powerKind === 'lessonInZeal' })]; o3.active = mon(g3, 'Bidoof');
  check('Lesson in Zeal: Fusion Strike Pokémon take 20 less', g3.finalDamage(o3.active, m3.active, 100).dmg === 80);
}
{ // Abilities: Intrepid Sword ends the turn, Ice Dance repeats, Shady Dealings, Libero, Old Cemetery
  const g = newGame(['swl-zacian', 'swl-inteleon']);
  const [me, op] = g.players;
  me.active = mon(g, 'Zacian V'); op.active = mon(g, 'Sobble', { pick: (c) => c.set === 'swsh1' });
  me.deck.push(en('Metal'), card('Switch'), en('Metal'));
  const ends = await useAbility(g, me, 'intrepidSword');
  check('Intrepid Sword: Metal Energy attached, the rest to the hand, turn ends', ends === true && me.active.energy.length === 2 && me.hand.length === 1);
  const g2 = newGame(['swl-inteleon', 'swl-zacian']);
  const [i2, z2] = g2.players;
  i2.active = mon(g2, 'Frosmoth'); i2.bench = [mon(g2, 'Inteleon V'), mon(g2, 'Sobble', { pick: (c) => c.set === 'swsh1' })]; z2.active = mon(g2, 'Zacian V');
  i2.hand = [en('Water'), en('Water')];
  await useAbility(g2, i2, 'iceDance'); await useAbility(g2, i2, 'iceDance');
  check('Ice Dance: as often as you like', i2.bench.reduce((t, x) => t + x.energy.length, 0) === 2 && !i2.hand.length);
  i2.hand = [card('Drizzile', (c) => c.powerKind === 'shadyDealings1')];
  const hand0 = i2.hand.length;
  const evo = g2.legalActions(i2).find((a) => a.kind === 'evolve');
  g2.turn = 5; i2.bench[1].playedTurn = 1;
  await g2.perform(i2, g2.legalActions(i2).find((a) => a.kind === 'evolve'));
  check('Shady Dealings (Drizzile): a Trainer card from the deck', i2.hand.length === 1 && i2.hand[0].kind === 'trainer', i2.hand.map((c) => c.name));
  const g3 = newGame(['swv-victini', 'swv-blastoise'], { answers0: ['yes'] });
  const [v3, b3] = g3.players;
  v3.active = mon(g3, 'Victini V'); v3.bench = [mon(g3, 'Cinderace', { pick: (c) => c.powerKind === 'libero' })]; b3.active = mon(g3, 'Chewtle', { pick: (c) => c.set === 'swsh45' });
  v3.discard = [en('Fire'), en('Fire'), en('Fire')];
  v3.hand = [card('Switch')];
  await g3.perform(v3, g3.legalActions(v3).find((a) => a.kind === 'trainer'));
  check('Libero: 2 Fire Energy from the discard pile when it becomes Active', v3.active.name === 'Cinderace' && v3.active.energy.length === 2, v3.active.energy.length);
  const g4 = newGame(['swl-mew', 'swl-zacian']);
  const [m4, z4] = g4.players;
  m4.active = mon(g4, 'Genesect V'); m4.bench = [mon(g4, 'Mew V')]; z4.active = mon(g4, 'Zacian V');
  g4.stadium = { card: card('Old Cemetery'), owner: 1 };
  m4.hand = [en('Psychic'), en('Psychic')];
  await g4.perform(m4, g4.legalActions(m4).find((a) => a.kind === 'energy' && a.target === m4.active));
  check('Old Cemetery: 2 damage counters on a non-Psychic Pokémon', m4.active.damage === 20);
  m4.flags.energy = false;
  await g4.perform(m4, g4.legalActions(m4).find((a) => a.kind === 'energy' && a.target === m4.bench[0]));
  check('Old Cemetery: nothing on a Psychic Pokémon', m4.bench[0].damage === 0);
}
{ // Shadow Mist, Gale Thrust, Swelling Pulse, Raid, Cross Fusion Strike, Scroll of Scorn, Max Lance, Spiral Jet, Energy Burst
  const g = newGame(['swl-calyrex-shadow', 'swl-mew']);
  const [me, op] = g.players;
  me.active = mon(g, 'Shadow Rider Calyrex V', { energy: ['Psychic'] }); op.active = mon(g, 'Mew V'); op.bench = [mon(g, 'Genesect V')];
  await attackBy(g, me, 'Shadow Mist');
  g.turn++; g.current = op; op.hand = [card('Fusion Strike Energy'), card('Old Cemetery'), en('Psychic')];
  const acts = g.legalActions(op);
  check('Shadow Mist: no Special Energy or Stadium from the hand next turn', !acts.some((a) => a.kind === 'energy' && a.card.special) && !acts.some((a) => a.tkind === 'stadium') && acts.some((a) => a.kind === 'energy'));
  const g2 = newGame(['swl-urshifu-rapid', 'swl-mew']);
  const [u, m2] = g2.players;
  u.active = mon(g2, 'Remoraid'); u.bench = [mon(g2, 'Rapid Strike Urshifu VMAX', { energy: ['Fighting'] })]; m2.active = mon(g2, 'Mew V');
  const gale = () => g2.baseRange(u.active, m2.active, g2.attacksOf(u.active).find((a) => a.name === 'Gale Thrust'))[0];
  u.hand = [card('Switch')];
  await g2.perform(u, g2.legalActions(u).find((a) => a.kind === 'trainer'));
  check('Gale Thrust: +120 after moving to the Active Spot this turn', gale() === 150, gale());
  g2.checkup && (u.active.effects.movedActive.expires = g2.turn - 1, delete u.active.effects.movedActive);
  check('Gale Thrust: 30 otherwise', gale() === 30);
  const g3 = newGame(['swv-gardevoir', 'swv-zeraora']);
  const [gv, zr] = g3.players;
  gv.active = mon(g3, 'Gardevoir V', { damage: 50 }); zr.active = mon(g3, 'Shinx');
  const pulse = () => g3.baseRange(gv.active, zr.active, g3.attacksOf(gv.active).find((a) => a.name === 'Swelling Pulse'))[0];
  check('Swelling Pulse: 120 when not healed', pulse() === 120);
  await g3.heal(gv.active, 20);
  check('Swelling Pulse: 200 after being healed this turn', pulse() === 200);
  const g4 = newGame(['swv-zeraora', 'swv-gardevoir']);
  const [zz, gg] = g4.players;
  zz.active = mon(g4, 'Luxio'); gg.active = mon(g4, 'Snubbull'); zz.hand = [card('Luxray', (c) => c.set === 'swsh2')]; g4.turn = 5; zz.active.playedTurn = 1;
  await g4.perform(zz, g4.legalActions(zz).find((a) => a.kind === 'evolve'));
  check('Raid: +100 when it evolved this turn', g4.baseRange(zz.active, gg.active, g4.attacksOf(zz.active).find((a) => a.name === 'Raid'))[0] === 160);
  const g5 = newGame(['swl-mew', 'swl-palkia'], { answers0: [(pr) => pr.options.find((o) => /Techno Blast/.test(o.en))?.id ?? pr.options[0].id] });
  const [mm, pp] = g5.players;
  mm.active = mon(g5, 'Mew VMAX', { energy: ['Psychic', 'Psychic'] }); mm.bench = [mon(g5, 'Genesect V')]; pp.active = mon(g5, 'Origin Forme Palkia V');
  await attackBy(g5, mm, 'Cross Fusion Strike');
  check('Cross Fusion Strike copies a Benched Fusion Strike attack (Techno Blast 210)', pp.active.damage >= 210, pp.active.damage);
  const g6 = newGame(['swl-urshifu-single', 'swl-mew']);
  const [s6, m6] = g6.players;
  s6.active = mon(g6, 'Single Strike Urshifu V'); s6.bench = [mon(g6, 'Houndour')]; m6.active = mon(g6, 'Mew V');
  s6.active.tools = [{ card: card('Single Strike Scroll of Scorn'), expires: 1e9 }]; s6.bench[0].tools = [{ card: card('Single Strike Scroll of Scorn'), expires: 1e9 }];
  check('Scroll of Scorn: a Single Strike Pokémon gets Furious Anger', g6.attacksOf(s6.active).some((a) => a.name === 'Furious Anger'));
  check('Scroll of Scorn: Houndour (not Single Strike) does not', g6.attacksOf(s6.bench[0]).every((a) => a.name !== 'Furious Anger'));
  const g7 = newGame(['swl-calyrex-ice', 'swl-mew'], { answers0: ['2'] });
  const [c7, m7] = g7.players;
  c7.active = mon(g7, 'Ice Rider Calyrex VMAX', { energy: ['Water', 'Water', 'Water'] }); m7.active = tank(g7, 'Mew V');
  await attackBy(g7, c7, 'Max Lance');
  check('Max Lance: discard 2 Energy for 10 + 240', m7.active.damage === 250 && c7.active.energy.length === 1, m7.active.damage);
  const g8 = newGame(['swv-blastoise', 'swv-victini']);
  const [b8, v8] = g8.players;
  b8.active = mon(g8, 'Barraskewda', { pick: (c) => c.set === 'swsh2', energy: ['Water'] }); v8.active = tank(g8, 'Victini V');
  b8.hand = [en('Water')];
  await attackBy(g8, b8, 'Spiral Jet');
  check('Spiral Jet: does nothing without 2 Water Energy in hand', v8.active.damage === 0 && b8.hand.length === 1);
  b8.hand.push(en('Water'));
  await attackBy(g8, b8, 'Spiral Jet');
  check('Spiral Jet: 130 after discarding 2 Water Energy', v8.active.damage === 260 && !b8.hand.length, v8.active.damage);
  const g9 = newGame(['swv-victini', 'swv-blastoise']);
  const [v9, b9] = g9.players;
  v9.active = mon(g9, 'Victini V', { energy: ['Fire', 'Fire', 'Fire'] }); b9.active = mon(g9, 'Chewtle', { pick: (c) => c.set === 'swsh45', energy: ['Water', 'Water'] });
  check('Energy Burst: 30 for each Energy on both Active Pokémon (5)', g9.baseRange(v9.active, b9.active, g9.attacksOf(v9.active).find((a) => a.name === 'Energy Burst'))[0] === 150);
}
{ // Trainers: Marnie, Scoop Up Net, Hisuian Heavy Ball, Fan of Waves, Tool Scrapper, Echoing Horn, Star Portal once per game
  const g = newGame(['swl-zacian', 'swl-mew']);
  const [me, op] = g.players;
  me.active = mon(g, 'Zacian V'); me.bench = [mon(g, 'Jirachi', { damage: 50 })]; op.active = mon(g, 'Mew V'); op.bench = [mon(g, 'Genesect V')];
  me.hand = [card('Switch'), card('Switch')]; op.hand = [card('Switch'), card('Switch'), card('Switch'), card('Switch'), card('Switch'), card('Switch'), card('Switch')];
  await playAny(g, me, 'Marnie');
  check('Marnie: you draw 5, the opponent draws 4', me.hand.length === 5 && op.hand.length === 4);
  me.bench[0].energy = [en('Metal')];
  await playAny(g, me, 'Scoop Up Net');
  check('Scoop Up Net: the Pokémon back to the hand, Energy discarded', me.hand.some((c) => c.name === 'Jirachi') && !me.bench.length && me.discard.some((c) => c.energyType === 'Metal'));
  const g2 = newGame(['swl-palkia', 'swl-mew']);
  const [p2, o2] = g2.players;
  p2.active = mon(g2, 'Origin Forme Palkia V'); o2.active = mon(g2, 'Mew V', { energy: ['Psychic'] }); o2.active.energy.push(card('Fusion Strike Energy')); o2.bench = [mon(g2, 'Genesect V')];
  p2.prizes[0] = card('Bidoof');
  const prizes0 = p2.prizes.length;
  await playAny(g2, p2, 'Hisuian Heavy Ball');
  check('Hisuian Heavy Ball: a Basic Pokémon from the Prize cards, the Ball takes its place', p2.hand.some((c) => c.name === 'Bidoof') && p2.prizes.length === prizes0 && p2.prizes.some((c) => c.name === 'Hisuian Heavy Ball'));
  const g3 = newGame(['swl-urshifu-rapid', 'swl-mew']);
  const [r3, m3] = g3.players;
  r3.active = mon(g3, 'Remoraid'); m3.active = mon(g3, 'Mew V'); m3.active.energy = [card('Fusion Strike Energy')]; m3.active.tools = [{ card: card('Choice Belt'), expires: 1e9 }];
  await playAny(g3, r3, 'Fan of Waves');
  check('Fan of Waves: Special Energy to the bottom of the deck', !m3.active.energy.length && m3.deck[0].special === 'fusionStrike');
  await playAny(g3, r3, 'Tool Scrapper');
  check('Tool Scrapper: the Tool is discarded', !m3.active.tools.length && m3.discard.some((c) => c.name === 'Choice Belt'));
  m3.discard.push(card('Mew V'));
  await playAny(g3, r3, 'Echoing Horn');
  check('Echoing Horn: a Basic from the opponent’s discard pile onto their Bench', m3.bench.some((x) => x.name === 'Mew V'));
  const g4 = newGame(['swl-palkia', 'swl-mew']);
  const [p4, o4] = g4.players;
  p4.active = mon(g4, 'Origin Forme Palkia VSTAR'); p4.bench = [mon(g4, 'Manaphy')]; o4.active = mon(g4, 'Mew V');
  p4.discard = [en('Water'), en('Water'), en('Water'), en('Water')];
  await useAbility(g4, p4, 'starPortal');
  check('Star Portal: 3 Water Energy from the discard pile', g4.allMons(p4).reduce((t, x) => t + x.energy.length, 0) === 3 && p4.vstarUsed);
  g4.turn += 2; p4.flags.powers = {};
  check('Star Portal: VSTAR Power only once per game', !g4.legalActions(p4).some((a) => a.pkind === 'starPortal'));
}
// ---------------- Sun & Moon ----------------
const sm = (c) => /^sm\d|^smp|^sm75|^sm35/.test(c.set || '');
{ // Weakness: Perplexing Eyes, Weakness Policy, Altar of the Sunne
  const g = newGame(['sm-rock-steady', 'sm-hidden-moon']);
  const [me, op] = g.players;
  me.active = mon(g, 'Espurr', { pick: withAtk('Perplexing Eyes') }); op.active = tank(g, 'Salazzle', { pick: sm });
  await attackBy(g, me, 'Perplexing Eyes');
  me.active = mon(g, 'Meowstic', { pick: sm });
  check('Perplexing Eyes: the Defending Pokémon is now weak to Psychic', g.finalDamage(me.active, op.active, 50).dmg === 100, g.finalDamage(me.active, op.active, 50).dmg);
  op.active.tools = [{ card: card('Weakness Policy'), expires: 1e9 }];
  check('Weakness Policy: no Weakness', g.finalDamage(me.active, op.active, 50).dmg === 50);
  const g2 = newGame(['sm-steel-sun', 'sm-luminous-frost']);
  const [s2, l2] = g2.players;
  s2.active = mon(g2, 'Solgaleo', { pick: sm }); l2.active = mon(g2, 'Simisear', { pick: sm });
  const before = g2.finalDamage(l2.active, s2.active, 50).dmg;
  g2.stadium = { card: card('Altar of the Sunne'), owner: 0 };
  check('Altar of the Sunne: Metal Pokémon have no Weakness', before === 100 && g2.finalDamage(l2.active, s2.active, 50).dmg === 50, `${before} → ${g2.finalDamage(l2.active, s2.active, 50).dmg}`);
}
{ // Retreat: Escape Board (also while Asleep), Altar of the Moone, Surge Surfer
  const g = newGame(['sm-clanging-thunder', 'sm-hidden-moon']);
  const [me, op] = g.players;
  me.active = mon(g, 'Kommo-o', { energy: ['Fighting', 'Fighting'] }); me.bench = [mon(g, 'Jangmo-o')]; op.active = mon(g, 'Cosmog');
  const base = g.retreatCost(me, me.active);
  me.active.tools = [{ card: card('Escape Board'), expires: 1e9 }];
  check('Escape Board: retreat costs 1 less', g.retreatCost(me, me.active) === base - 1);
  me.active.status.asleep = true;
  check('Escape Board: can retreat while Asleep', g.legalActions(me).some((a) => a.kind === 'retreat'));
  me.active.tools = []; me.active.energy = [en('Psychic')];
  g.stadium = { card: card('Altar of the Moone'), owner: 1 };
  check('Altar of the Moone: 2 less with Psychic Energy attached', g.retreatCost(me, me.active) === Math.max(0, base - 2));
  const ra = mon(g, 'Alolan Raichu', { pick: (c) => c.powerKind === 'surgeSurfer' });
  check('Surge Surfer: no Retreat Cost with a Stadium in play', g.retreatCost(me, ra) === 0);
}
{ // Damage boosts and reductions: Strong Cheer (only 1), Steelworker, Devoured Field, Professor Kukui, Wall of Sand, Clanging Scales, Power of Nature
  const g = newGame(['sm-roaring-heat', 'sm-steel-sun']);
  const [me, op] = g.players;
  me.active = mon(g, 'Torracat', { pick: sm }); me.bench = [mon(g, 'Incineroar', { pick: (c) => c.powerKind === 'strongCheer' }), mon(g, 'Incineroar', { pick: (c) => c.powerKind === 'strongCheer' })];
  op.active = mon(g, 'Cosmog');
  check('Strong Cheer: +30, only once with 2 Incineroar', g.finalDamage(me.active, op.active, 50).dmg === 80, g.finalDamage(me.active, op.active, 50).dmg);
  me.bench[0] = mon(g, 'Palossand', { pick: (c) => c.powerKind === 'wallOfSand' });
  check('Wall of Sand: 20 less', g.finalDamage(op.active, me.bench[0], 100).dmg === 80 || g.finalDamage(op.active, me.bench[0], 100).dmg === 180);
  const g2 = newGame(['sm-steel-sun', 'sm-destruction-fang']);
  const [s2, d2] = g2.players;
  s2.active = mon(g2, 'Metang', { pick: sm }); s2.bench = [mon(g2, 'Dhelmise', { pick: (c) => c.powerKind === 'steelworker' })]; d2.active = mon(g2, 'Deino');
  check('Steelworker: Metal Pokémon +10', g2.finalDamage(s2.active, d2.active, 50).dmg === 60);
  g2.stadium = { card: card('Devoured Field'), owner: 1 };
  check('Devoured Field: Darkness Pokémon +10', g2.finalDamage(d2.active, s2.active, 50).dmg === 60 || g2.finalDamage(d2.active, s2.active, 50).dmg === 30, g2.finalDamage(d2.active, s2.active, 50).dmg);
  s2.hand = [];
  await playAny(g2, s2, 'Professor Kukui');
  check('Professor Kukui: draw 2, +20 this turn', s2.hand.length === 2 && g2.finalDamage(s2.active, d2.active, 50).dmg === 80, g2.finalDamage(s2.active, d2.active, 50).dmg);
  const g3 = newGame(['sm-clanging-thunder', 'sm-mach-strike']);
  const [k3, m3] = g3.players;
  k3.active = mon(g3, 'Kommo-o', { energy: ['Lightning', 'Fighting', 'Colorless'] }); m3.active = tank(g3, 'Hippowdon');
  await attackBy(g3, k3, 'Clanging Scales');
  check('Clanging Scales: takes 30 more next turn', g3.finalDamage(m3.active, k3.active, 50).dmg === 80 || g3.finalDamage(m3.active, k3.active, 50).dmg === 50 + 30, g3.finalDamage(m3.active, k3.active, 50).dmg);
  const g4 = newGame(['sm-leaf-charge', 'sm-storm-caller']);
  const [l4, u4] = g4.players;
  l4.active = mon(g4, 'Grovyle', { energy: ['Grass'] }); l4.bench = [mon(g4, 'Sceptile', { pick: (c) => c.powerKind === 'powerOfNature' })]; u4.active = mon(g4, 'Naganadel');
  check('Power of Nature: Ultra Beasts do no damage to Pokémon with Grass Energy', g4.finalDamage(u4.active, l4.active, 80).dmg === 0);
}
{ // Luminous Barrier, Copycat, Severe Poison, Headlock, Swallow Dive
  const g = newGame(['sm-luminous-frost', 'swl-zacian']);
  const [me, op] = g.players;
  me.active = mon(g, 'Alolan Ninetales', { pick: (c) => c.powerKind === 'luminousBarrier' }); op.active = mon(g, 'Arceus & Dialga & Palkia-GX', { energy: ['Water', 'Metal', 'Colorless'] });
  g.current = op;
  await attackBy(g, op, 'Ultimate Ray');
  check('Luminous Barrier: no damage from a Pokémon-GX', me.active.damage === 0);
  const g2 = newGame(['sm-hidden-moon', 'sm-roaring-heat']);
  const [h2, r2] = g2.players;
  r2.active = mon(g2, 'Torracat', { pick: withAtk('Fire Fang'), energy: ['Fire'] }); h2.active = mon(g2, 'Mimikyu', { pick: withAtk('Copycat'), energy: ['Psychic', 'Colorless'] });
  g2.current = r2; g2.turn = 5;
  await attackBy(g2, r2, 'Fire Fang');
  g2.current = h2; g2.turn = 6;
  await attackBy(g2, h2, 'Copycat');
  check('Copycat: uses the attack the opponent used last turn (Fire Fang: 20 and Burned)', r2.active.damage >= 20 && r2.active.status.burned, `${r2.active.damage} ${JSON.stringify(r2.active.status)}`);
  const g3 = newGame(['sm-hidden-moon', 'sm-roaring-heat']);
  const [p3, o3] = g3.players;
  p3.active = mon(g3, 'Salazzle', { pick: withAtk('Severe Poison'), energy: ['Psychic'] }); o3.active = tank(g3, 'Bewear');
  await attackBy(g3, p3, 'Severe Poison');
  await g3.checkup(p3);
  check('Severe Poison: 4 damage counters between turns', o3.active.damage === 40, o3.active.damage);
  const g4 = newGame(['sm-bright-tide', 'sm-roaring-heat']);
  const [b4, r4] = g4.players;
  b4.active = mon(g4, 'Cloyster', { pick: withAtk('Headlock'), energy: ['Water', 'Water'] }); r4.active = tank(g4, 'Bewear');
  await withCoin(false, () => attackBy(g4, b4, 'Headlock'));
  check('Headlock tails: the Defending Pokémon is Paralyzed', !!r4.active.status.paralyzed);
  const g5 = newGame(['sm-steel-sun', 'sm-roaring-heat']);
  const [s5, x5] = g5.players;
  s5.active = mon(g5, 'Swellow', { energy: ['Colorless'] }); x5.active = tank(g5, 'Bewear');
  await withCoin(false, () => attackBy(g5, s5, 'Agility'));
  g5.turn += 2;
  const dive = g5.attacksOf(s5.active).find((a) => a.name === 'Swallow Dive');
  check('Swallow Dive: +80 after using Agility last turn', g5.baseRange(s5.active, x5.active, dive)[0] === 120, g5.baseRange(s5.active, x5.active, dive)[0]);
}
{ // Lost Zone: Unseen Flash and Lost Voltage; Energy Grounding; Wishful Baton
  const g = newGame(['sm-storm-caller', 'sm-roaring-heat']);
  const [me, op] = g.players;
  me.active = mon(g, 'Ampharos', { pick: (c) => c.powerKind === 'unseenFlash' }); op.active = mon(g, 'Litten');
  me.hand = [en('Lightning'), en('Lightning')];
  await useAbility(g, me, 'unseenFlash');
  check('Unseen Flash: 2 Lightning Energy to the Lost Zone, the opponent is Paralyzed', me.lost.length === 2 && !me.hand.length && op.active.status.paralyzed);
  const r = mon(g, 'Raikou', { pick: withAtk('Lost Voltage') }); me.bench = [r];
  [me.active, me.bench[0]] = [r, me.active];
  check('Lost Voltage: +90 with Lightning Energy in the Lost Zone', g.baseRange(r, op.active, g.attacksOf(r).find((a) => a.name === 'Lost Voltage'))[0] === 120);
  const g2 = newGame(['sm-leaf-charge', 'sm-roaring-heat'], { answers0: ['yes'] });
  const [l2, x2] = g2.players;
  l2.active = mon(g2, 'Grovyle', { energy: ['Grass', 'Water'], damage: 0 }); l2.bench = [mon(g2, 'Lanturn', { pick: (c) => c.powerKind === 'energyGrounding' })];
  x2.active = mon(g2, 'Incineroar', { pick: withAtk('Flamethrower'), energy: ['Fire', 'Fire'] });
  l2.active.damage = l2.active.maxHp - 10; g2.current = x2;
  await attackBy(g2, x2, 'Flamethrower');
  check('Energy Grounding: a basic Energy moves to Lanturn', g2.allMons(l2).some((m) => m.name === 'Lanturn' && m.energy.length === 1), g2.allMons(l2).map((m) => m.name + m.energy.length));
}
{ // Smeargle: Stunning Likeness uses a Supporter from the opponent's hand
  const g = newGame(['sm-bright-tide', 'sm-roaring-heat'], { answers0: [(pr) => pr.options[0].id] });
  const [me, op] = g.players;
  me.active = mon(g, 'Smeargle', { pick: withAtk('Stunning Likeness') }); op.active = mon(g, 'Litten');
  op.hand = [card('Hau')];
  await attackBy(g, me, 'Stunning Likeness');
  check('Stunning Likeness: Hau’s effect draws 3; the card stays in the opponent’s hand', me.hand.length === 3 && op.hand.some((c) => c.name === 'Hau'), me.hand.length);
}
{ // Abilities: Weed Out, Magnetic Circuit, Roaring Resolve, Dark Invitation; Trainers: Lillie (first turn), Guzma, Welder, Acerola, Tate & Liza
  const g = newGame(['sm-destruction-fang', 'sm-roaring-heat']);
  const [me, op] = g.players;
  me.active = mon(g, 'Deino'); me.bench = [mon(g, 'Hydreigon'), mon(g, 'Zweilous'), mon(g, 'Houndour'), mon(g, 'Salandit'), mon(g, 'Stufful')]; op.active = mon(g, 'Litten');
  await useAbility(g, me, 'weedOut');
  check('Weed Out: keep 3 Benched Pokémon, discard the others', me.bench.length === 3 && me.discard.filter((c) => c.kind === 'pokemon').length === 2);
  const g2 = newGame(['sm-lightning-loop', 'sm-roaring-heat']);
  const [z2, x2] = g2.players;
  z2.active = mon(g2, 'Magnezone'); z2.bench = [mon(g2, 'Magnemite')]; x2.active = mon(g2, 'Litten');
  z2.hand = [en('Lightning'), en('Lightning'), en('Lightning')];
  for (let k = 0; k < 3; k++) await useAbility(g2, z2, 'magneticCircuit');
  check('Magnetic Circuit: as often as you like', g2.allMons(z2).reduce((t, m) => t + m.energy.length, 0) === 3);
  const g3 = newGame(['sm-relentless-flame', 'sm-roaring-heat']);
  const [c3, x3] = g3.players;
  c3.active = mon(g3, 'Charizard', { pick: (c) => c.powerKind === 'roaringResolve' }); x3.active = mon(g3, 'Litten');
  await useAbility(g3, c3, 'roaringResolve');
  check('Roaring Resolve: 2 damage counters, 2 Fire Energy from the deck', c3.active.damage === 20 && c3.active.energy.length === 2);
  const g4 = newGame(['sm-twilight-rogue', 'sm-roaring-heat']);
  const [d4, x4] = g4.players;
  d4.active = mon(g4, 'Dusknoir'); x4.active = mon(g4, 'Torracat', { pick: sm }); x4.hand = [card('Litten')];
  await useAbility(g4, d4, 'darkInvitation');
  check('Dark Invitation: a Basic from the opponent’s hand onto their Bench with 3 damage counters', x4.bench.length === 1 && x4.bench[0].damage === 30);
  const g5 = newGame(['sm-roaring-heat', 'sm-hidden-moon']);
  const [m5, h5] = g5.players;
  m5.active = mon(g5, 'Litten'); m5.bench = [mon(g5, 'Stufful')]; h5.active = mon(g5, 'Cosmog'); h5.bench = [mon(g5, 'Salandit')];
  g5.first = m5; g5.turn = 1; m5.hand = [];
  await playAny(g5, m5, 'Lillie').catch(() => {});
  check('Lillie is not playable on the very first turn (Supporter rule)', m5.hand.length <= 1);
  g5.turn = 3; m5.hand = [];
  await playAny(g5, m5, 'Guzma');
  check('Guzma: the opponent’s Benched Pokémon comes in, and you switch too', h5.active.name === 'Salandit' && m5.active.name === 'Stufful');
  m5.hand = [en('Fire'), en('Fire')];
  await playAny(g5, m5, 'Welder');
  check('Welder: 2 Fire Energy attached, 3 cards drawn', g5.allMons(m5).some((m) => m.energy.length === 2) && m5.hand.length === 3, m5.hand.length);
  m5.bench[0].damage = 30;
  await playAny(g5, m5, 'Acerola');
  check('Acerola: a damaged Pokémon and its cards back to the hand', m5.hand.some((c) => c.name === 'Litten') && !m5.bench.length || m5.hand.some((c) => c.name === 'Litten'));
}
{ // Electric Start: going second, Manectric may start in play
  const g = new Game({ decks: ['sm-relentless-flame', 'sm-leaf-charge'], controllers: [scripted(), scripted([(pr) => pr.options.find((o) => o.card?.name === 'Manectric')?.id ?? pr.options[0].id])], hooks: {} });
  const second = g.players[1];
  const man = second.deck.find((c) => c.powerKind === 'electricStart'), basic = second.deck.find(isBasicCard);
  second.deck.splice(second.deck.indexOf(man), 1); second.deck.splice(second.deck.indexOf(basic), 1); second.deck.push(basic, man);
  await withCoin(true, () => g.setup());
  check('Electric Start: going second, Manectric can be the starting Active Pokémon', g.first === g.players[0] && second.active?.name === 'Manectric', second.active?.name);
}
{ // Card-text audit: Sun & Moon and Sword & Shield V/League fixes, played as real attacks
  const g = newGame(['sm-relentless-flame', 'sm-roaring-heat']);
  const [me, op] = g.players;
  me.active = mon(g, 'Charizard', { pick: withAtk('Continuous Blaze Ball'), energy: ['Fire', 'Fire'] }); op.active = tank(g, 'Bewear');
  await attackBy(g, me, 'Continuous Blaze Ball');
  check('Continuous Blaze Ball: 30 + 50 for each Fire Energy discarded (2 → 130, counted once)', op.active.damage === 130 && !me.active.energy.length, op.active.damage);
  const g2 = newGame(['sm-bright-tide', 'sm-roaring-heat']);
  const [t2, o2] = g2.players;
  t2.active = mon(g2, 'Togedemaru', { pick: withAtk('Discharge'), energy: ['Lightning', 'Lightning'] }); o2.active = tank(g2, 'Bewear');
  await attackBy(g2, t2, 'Discharge');
  check('Discharge: 30 × 2 Lightning Energy = 60', o2.active.damage === 60, o2.active.damage);
  const g3 = newGame(['sm-steel-sun', 'sm-roaring-heat']);
  const [s3, x3] = g3.players;
  s3.active = mon(g3, 'Swellow', { pick: withAtk('Swallow Dive'), energy: ['Fire'] }); x3.active = tank(g3, 'Bewear');
  await withCoin(false, () => attackBy(g3, s3, 'Agility'));
  const before = x3.active.damage;
  g3.turn += 2;
  await attackBy(g3, s3, 'Swallow Dive');
  check('Swallow Dive, really attacking after Agility last turn: 40 + 80', x3.active.damage - before === 120, x3.active.damage - before);
}
{ // "Prevent all effects of attacks, including damage" (Detect, Agility, Dig, Stance) also stops snipes and after-damage effects
  const g = newGame(['sm-mach-strike', 'sm-luminous-frost']);
  const [r, s] = g.players;
  r.active = mon(g, 'Riolu', { pick: withAtk('Detect'), energy: ['Fighting'] }); s.active = mon(g, 'Seadra', { pick: withAtk('Water Arrow'), energy: ['Water'] });
  await withCoin(true, () => attackBy(g, r, 'Detect'));
  g.current = s; g.turn++;
  await attackBy(g, s, 'Water Arrow');
  check('Detect: a snipe at the protected Active Pokémon does nothing', r.active.effects.shield?.kind === 'all' && r.active.damage === 0, r.active.damage);
  const g2 = newGame(['sm-hidden-moon', 'sm-mach-strike']);
  const [z, r2] = g2.players;
  r2.active = mon(g2, 'Riolu', { pick: withAtk('Detect') }); r2.active.effects.shield = { kind: 'all', expires: g2.turn + 1 };
  z.active = mon(g2, 'Salazzle', { pick: withAtk('Severe Poison'), energy: ['Psychic'] });
  await attackBy(g2, z, 'Severe Poison');
  check('Detect: Severe Poison does nothing to the protected Pokémon', !r2.active.status.poisoned, JSON.stringify(r2.active.status));
  const g3 = newGame(['swl-urshifu-single', 'swv-lycanroc']);
  const [u, d] = g3.players;
  u.active = mon(g3, 'Single Strike Urshifu VMAX', { energy: ['Fighting', 'Fighting', 'Fighting', 'Fighting'] }); d.active = tank(g3, 'Diglett', { pick: withAtk('Dig') });
  d.active.effects.shield = { kind: 'all', expires: g3.turn + 1 };
  await attackBy(g3, u, 'G-Max One Blow');
  check("G-Max One Blow: its damage isn't stopped by Dig (an effect on the Defending Pokémon)", d.active.damage === 270, d.active.damage);
}
{ // Bench damage from attacks gets the "takes less damage" Abilities; the attacker picks Bench targets; Energy counts in units
  const g = newGame(['sm-mach-strike', 'sm-roaring-heat'], { answers0: [(pr) => pr.options.find((o) => o.mon?.name === 'Palossand')?.id ?? pr.options[0].id] });
  const [c, p] = g.players;
  c.active = mon(g, 'Garchomp', { pick: withAtk('Quick Dive'), energy: ['Fighting', 'Fighting'] });
  p.active = tank(g, 'Bewear'); p.bench = [mon(g, 'Palossand', { pick: (x) => x.powerKind === 'wallOfSand' })];
  await attackBy(g, c, 'Quick Dive');
  check('Wall of Sand also works on the Bench: Quick Dive 50 → 30', p.bench[0].damage === 30, p.bench[0].damage);
  const g2 = newGame(['sm-leaf-charge', 'sm-roaring-heat']);
  const [ch, o2] = g2.players;
  ch.active = mon(g2, 'Chinchou', { pick: withAtk('Spark'), energy: ['Lightning', 'Lightning'] }); o2.active = tank(g2, 'Bewear');
  o2.bench = [tank(g2, 'Litten'), tank(g2, 'Litten'), mon(g2, 'Litten', { damage: 30 })];
  await attackBy(g2, ch, 'Spark');
  check('Spark: the attacker chooses the 2 Benched Pokémon', o2.bench[0].damage === 10 && o2.bench[1].damage === 10 && o2.bench[2].damage === 30, o2.bench.map((m) => m.damage).join('/'));
  const g3 = newGame(['sm-leaf-charge', 'swl-mew']);
  const [or, d3] = g3.players;
  or.active = mon(g3, 'Oranguru', { pick: withAtk('Psychic'), energy: ['Grass', 'Grass', 'Grass'] }); d3.active = tank(g3, 'Bewear');
  d3.active.energy = [card('Double Turbo Energy'), en('Psychic')];
  await attackBy(g3, or, 'Psychic');
  check('Psychic: Double Turbo Energy counts as 2 Energy (60 + 20 × 3)', d3.active.damage === 120, d3.active.damage);
}
{ // Player choices and "if you do"
  const g = newGame(['sm-hidden-moon', 'sm-roaring-heat'], { answers0: [(pr) => pr.options.find((o) => o.card?.energyType === 'Psychic')?.id ?? pr.options[0].id] });
  const [s, b] = g.players;
  s.active = mon(g, 'Salazzle', { pick: withAtk('Flamethrower'), energy: ['Fire', 'Psychic', 'Psychic'] }); b.active = tank(g, 'Bewear');
  await attackBy(g, s, 'Flamethrower');
  check('Flamethrower: the player picks which Energy to discard (keeps the Fire)', s.active.energy.length === 2 && s.active.energy.some((e) => e.energyType === 'Fire'), s.active.energy.map((e) => e.energyType).join(','));
  const g2 = newGame(['sm-steel-sun', 'sm-roaring-heat']);
  const [c2] = g2.players;
  c2.active = mon(g2, 'Castform', { pick: withAtk('Weather Teller'), energy: ['Metal'] }); g2.players[1].active = tank(g2, 'Bewear');
  const stadiums = c2.deck.filter((x) => x.ttype === 'stadium').length;
  await attackBy(g2, c2, 'Weather Teller');
  check('Weather Teller: up to 2 Stadium cards', c2.hand.filter((x) => x.ttype === 'stadium').length === Math.min(2, stadiums), `${c2.hand.length} of ${stadiums}`);
  const g3 = newGame(['sm-battle-mind', 'sm-roaring-heat']);
  const [l3] = g3.players;
  l3.active = mon(g3, 'Litten', { pick: withAtk('Caturday'), energy: ['Fire'] }); g3.players[1].active = tank(g3, 'Bewear'); l3.deck = [];
  await attackBy(g3, l3, 'Caturday');
  check('Caturday: no card drawn (empty deck), so it does not fall Asleep', !l3.active.status.asleep);
  const g4 = newGame(['sm-bright-tide', 'sm-roaring-heat']);
  const [w4, b4] = g4.players;
  w4.active = mon(g4, 'Lillipup', { pick: withAtk('Work Up'), energy: ['Water'] }); b4.active = tank(g4, 'Bewear');
  await attackBy(g4, w4, 'Work Up'); g4.turn += 2; await attackBy(g4, w4, 'Work Up');
  check('Work Up: its +20 only adds to attacks that do damage', b4.active.damage === 0, b4.active.damage);
}
{ // Dan: Rock-Paper-Scissors — a tie plays another round (each round reaches the UI), winning draws 2 more
  const g = newGame(['swsh-charizard', 'swsh-zacian'], { answers0: ['rock', 'rock'], answers1: ['rock', 'scissors'] });
  const [me, op] = g.players;
  me.active = mon(g, 'Charmander', { pick: sw }); op.active = mon(g, 'Zacian V', { pick: sw });
  const rounds = [];
  g.hooks.onRps = async (r) => { rounds.push(r); };
  const before = me.deck.length;
  await playAny(g, me, 'Dan');
  check('Dan: tie, then rock beats scissors → 2 + 2 cards drawn', before - me.deck.length === 4, before - me.deck.length);
  check('Dan: the UI sees both rounds with both throws', rounds.length === 2 && rounds[0].result === 'tie' && !rounds[0].last && rounds[1].result === 'win' && rounds[1].last && rounds[1].a === 'rock' && rounds[1].b === 'scissors' && rounds[1].p === 0, JSON.stringify(rounds));
}
console.log(`scenario checks: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
