// Rules engine. No DOM access: the UI and the AI plug in through `controllers` and `hooks`.
// Log lines and action labels are {key, params} so the UI can show them in any language.
// Action `detail` strings are English descriptions for the decision model.
import { CARDS, DECKS, PRIZES, HAND_SIZE, MAX_BENCH } from './cards.js';
import { installModern } from './engine-modern.js';
import { installMega } from './engine-mega.js';
import { installSwsh } from './engine-swsh.js';
import { installSwshV } from './engine-swsh-v.js';
import { installSm } from './engine-sm.js';

let nextUid = 1;
// The game being played: Stadiums like Gravity Mountain change a Pokémon's HP, which the Pokémon itself reads.
let liveGame = null;
let nextMonId = 1;

export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const coin = () => Math.random() < 0.5;
export const isBasic = (c) => c.kind === 'pokemon' && c.stage === 0;
export const STAGES = ['Basic', 'Stage 1', 'Stage 2'];

// Log/label parameter helpers, resolved by the UI's translator.
export const C = (card) => ({ $card: { name: card.name, kind: card.kind, energyType: card.energyType, special: card.special } });
export const PL = (p) => ({ $pl: p.idx });
const ST = (s) => ({ $st: s });
const COIN = (h) => ({ $coin: h });

export function makeDeck(key) {
  const out = [];
  for (const [id, n] of Object.entries(DECKS[key].list))
    for (let i = 0; i < n; i++) out.push({ uid: nextUid++, ...CARDS[id] });
  return shuffle(out);
}

// An Energy unit of this type: 'Water', or a choice like 'Water|Fighting' (Rapid Strike Energy) that includes it.
export const isType = (t, type) => t === type || (t.includes('|') && t.split('|').includes(type));

// Can these attached energy types pay for an attack cost?
// An Energy unit like 'Psychic|Darkness' (Team Rocket's Energy) pays for either type.
export function canPay(types, cost) {
  const pool = [...types];
  for (const c of cost) {
    if (c === 'Colorless') continue;
    let i = pool.indexOf(c);
    if (i < 0) i = pool.findIndex((t) => t.includes('|') && t.split('|').includes(c));
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return pool.length >= cost.filter((c) => c === 'Colorless').length;
}

// A Pokémon in play: a stack of cards (Basic + evolutions) with Energy, damage, conditions and effects.
// Moving to the Bench or evolving ends the effects of attacks; effects from Abilities (Stance) and this turn's markers
// (moved to the Active Spot: Gale Thrust) stay.
export const keptEffects = (effects) => Object.fromEntries(Object.entries(effects || {}).filter(([k, v]) => v?.src === 'ability' || k === 'movedActive'));

export class Mon {
  constructor(card, turn) {
    this.id = nextMonId++;
    this.stack = [card];
    this.energy = [];
    this.tools = [];     // attached PlusPower / Defender: {card, expires}
    this.damage = 0;
    this.status = {};    // poisoned, asleep, paralyzed, confused
    this.effects = {};   // shield: {kind, expires}, destinyBond, sandAttack
    this.used = {};      // once-per-play attacks (Leek Slap)
    this.playedTurn = turn;
  }
  get card() { return this.stack[this.stack.length - 1]; }
  get name() { return this.card.name; }
  get maxHp() {
    let hp = this.card.hp;
    if (this.card.stage === 0 && this.tools.some((t) => t.card.tool === 'braveryCharm')) hp += 50;
    if (this.card.powerKind === 'nutritionalIron' && this.energyTypes.filter((t) => t === 'Metal').length >= 3) hp += 100;
    if (this.card.tags?.includes('Ancient') && this.tools.some((t) => t.card.tool === 'ancientBooster')) hp += 60;
    if (this.card.stage === 2 && liveGame?.stadiumIs('gravityMountain')) hp -= 30;
    if (this.tools.some((t) => t.card.tool === 'bigCharm')) hp += 30;
    return hp;
  }
  get hpLeft() { return Math.max(0, this.maxHp - this.damage); }
  get counters() { return Math.floor(this.damage / 10); }
  // Energy units: Double Colorless Energy provides 2 Colorless.
  get energyTypes() { return this.energy.flatMap((e) => Array(e.provides || 1).fill(e.energyType)); }
  // Energy as it pays for attacks (Pokémon Powers like Energy Burn can change it).
  get payTypes() {
    const blocked = this.status.asleep || this.status.confused || this.status.paralyzed;
    if (this.card.powerKind === 'energyBurn' && !blocked && !this.effects.noPower) return this.energyTypes.map(() => 'Fire');
    return this.energyTypes;
  }
  conditions() { return Object.keys(this.status).filter((k) => this.status[k]); }
  toolCount(tkind) { return this.tools.filter((t) => t.card.tkind === tkind).length; }
  allCards() { return [...this.stack, ...this.energy, ...this.tools.map((t) => t.card)]; }
}

export class Game {
  constructor({ decks, controllers, hooks = {} }) {
    this.players = [0, 1].map((i) => ({
      idx: i, deckKey: decks[i], deck: makeDeck(decks[i]),
      hand: [], discard: [], prizes: [], active: null, bench: [], lost: [], // lost: the Lost Zone (cards out of the game)
      flags: { energy: false, retreat: false, powers: {} },
      until: {}, // effects the opponent put on this player for one turn: { noTrainers: turn }
      koTurn: -9, vstarUsed: false, gxUsed: false, // modern rules: when one of their Pokémon was last Knocked Out; VSTAR Power / GX attack used
    }));
    // Modern (Scarlet & Violet) rules when the decks are modern ones.
    this.modern = decks.some((k) => DECKS[k]?.format === 'modern');
    this.stadium = null; // { card, owner }
    liveGame = this;
    this.controllers = controllers;
    this.hooks = hooks;
    this.turn = 0;
    this.current = null;
    this.phase = 'setup';
    this.winner = null;
    this.learned = new Set();
  }

  opp(p) { return this.players[1 - p.idx]; }
  ownerOf(m) { return this.players.find((q) => this.allMons(q).includes(m)); }
  stadiumIs(k) { return this.stadium?.card.stadium === k; }

  // Is this Pokémon's Pokémon Power working right now? Most stop while Asleep, Confused or Paralyzed,
  // a Stare stops them for a turn, and Muk's Toxic Gas switches off every other Power.
  powerOn(m, { always = false } = {}) {
    const k = m?.card.powerKind;
    if (!k || m.effects.noPower) return false;
    if (this.modern) return !(m.card.ruleBox && this.stadiumIs('pathToThePeak'));
    if (!always && (m.status.asleep || m.status.confused || m.status.paralyzed)) return false;
    if (k !== 'toxicGas' && this.players.some((q) => this.allMons(q).some((x) => x.card.powerKind === 'toxicGas' && this.powerOn(x)))) return false;
    return true;
  }

  // Attacks this Pokémon can use: its own, plus (Psylink) copies of its owner's other Psychic Pokémon's attacks.
  attacksOf(m) {
    let own = m.card.attacks;
    const tm = m.tools.filter((t) => !t.card.attackNeedsTag || m.card.tags?.includes(t.card.attackNeedsTag)).flatMap((t) => t.card.attacks || []);
    if (tm.length) own = [...own, ...tm.map((a) => ({ ...a, base: parseInt(a.damage, 10) || 0, fx: a.effect || a.fx || {}, tm: true }))];
    if (this.modern && m.card.powerKind === 'seasonedSkill') {
      const q = this.ownerOf(m), taken = q ? this.prizesTaken(this.opp(q)) : 0;
      own = own.map((a) => {
        if (a.name !== 'Blood Moon') return a;
        const cost = [...a.cost];
        for (let k = 0; k < taken; k++) { const i = cost.lastIndexOf('Colorless'); if (i >= 0) cost.splice(i, 1); }
        return { ...a, cost };
      });
    }
    if (this.modern && m.card.powerKind === 'rotoMotor') own = own.map((a) => ({ ...a, cost: this.smAttackCost(m, a.cost) }));
    if (m.card.powerKind !== 'psylink' || !this.powerOn(m)) return own;
    const q = this.ownerOf(m), seen = new Set(own.map((a) => a.name));
    const extra = (q ? this.allMons(q) : []).filter((x) => x !== m && x.card.type === 'Psychic')
      .flatMap((x) => x.card.attacks).filter((a) => !seen.has(a.name) && seen.add(a.name)).map((a) => ({ ...a, copied: true }));
    return [...own, ...extra];
  }

  retreatCost(p, m) {
    let c = m.card.retreat;
    c -= p.bench.filter((b) => b.card.powerKind === 'retreatAid' && this.powerOn(b)).length;
    if (this.stadiumIs('cerulean') && m.name.includes('Misty')) c--;
    if (this.modern) c = this.modernRetreat(p, m, c);
    return Math.max(0, c);
  }

  // Ask a player to choose. `en` explains the choice to the decision model.
  pick(p, kind, title, text, options, { params = {}, en = '' } = {}) {
    return this.ask(p, { kind, title, text, params, options, en });
  }
  async pickMon(p, kind, mons, text, params = {}, en = '', ai = (m) => 0) {
    if (!mons.length) return null;
    if (mons.length === 1) return mons[0];
    const id = await this.pick(p, kind, 'prompt.gen.title', text, mons.map((m) => ({ id: String(m.id), mon: m, ai: ai(m) })), { params, en });
    return mons.find((m) => String(m.id) === id) || mons[0];
  }
  // Like pickMon, but "nothing" is also an answer (for cards that say "you may").
  async pickMonOrNone(p, kind, mons, text, params = {}, en = '', ai = () => 0, noneAi = -1) {
    if (!mons.length) return null;
    const opts = [...mons.map((m) => ({ id: String(m.id), mon: m, ai: ai(m) })), { id: 'none', label: { key: 'opt.none' }, en: 'Choose nothing.', ai: noneAi }];
    const id = await this.pick(p, kind, 'prompt.gen.title', text, opts, { params, en });
    return mons.find((m) => String(m.id) === id) || null;
  }
  async yesNo(p, text, params, en, aiYes = 1) {
    const id = await this.pick(p, 'yesno', 'prompt.gen.title', text, [
      { id: 'yes', label: { key: 'opt.yes' }, en: 'Yes.', ai: aiYes }, { id: 'no', label: { key: 'opt.no' }, en: 'No.', ai: 0 }], { params, en });
    return id === 'yes';
  }
  async pickCard(p, kind, cards, text, params = {}, en = '', { none = false, ai = () => 0, unique = true } = {}) {
    const list = unique ? uniqueByName(cards) : cards;
    if (!list.length) return null;
    const opts = list.map((c) => ({ id: String(c.uid), card: c, ai: ai(c) }));
    if (none) opts.push({ id: 'none', label: { key: 'opt.none' }, en: 'Choose nothing.', ai: -1 });
    const id = await this.pick(p, kind, 'prompt.gen.title', text, opts, { params, en });
    return list.find((c) => String(c.uid) === id) || null;
  }
  async pickNumber(p, kind, max, text, params = {}, en = '', ai = (n) => n) {
    if (max <= 0) return 0;
    const id = await this.pick(p, kind, 'prompt.gen.title', text,
      Array.from({ length: max + 1 }, (_, n) => ({ id: String(n), label: { key: 'opt.n', params: { n } }, en: `${n}`, ai: ai(n) })), { params, en });
    return Math.max(0, Math.min(max, Number(id) || 0));
  }
  shuffleHandIn(p) { p.deck.push(...p.hand); p.hand = []; shuffle(p.deck); }
  searchDeck(p, card) { p.deck.splice(p.deck.indexOf(card), 1); shuffle(p.deck); return card; }
  // Take a Pokémon and everything attached out of play (to the deck, the hand or the discard pile).
  removeFromPlay(p, m) {
    if (p.active === m) p.active = null; else p.bench.splice(p.bench.indexOf(m), 1);
    return m.allCards();
  }
  async refillActive() {
    for (const q of this.players) if (!q.active && q.bench.length && !this.winner) await this.promote(q);
    for (const q of this.players) if (!q.active && !q.bench.length && !this.winner) this.setWinner(this.opp(q), 'reason.noPokemon', { P: PL(this.opp(q)), L: PL(q) });
  }
  async heal(m, n) {
    const h = Math.min(n, m.damage);
    if (h <= 0) return 0;
    // Life-Locked: the opponent's Active Pokémon can't be healed.
    if (this.modern && this.healLocked(m)) { this.log('log.healLocked', { m: m.name }, 'status'); return 0; }
    m.damage -= h;
    m.effects.healedNow = { expires: this.turn };
    this.log('log.heal', { m: m.name, n: h }, 'heal');
    return h;
  }
  allMons(p) { return [p.active, ...p.bench].filter(Boolean); }
  slot(p, m) { return { $slot: p.active === m ? ['active'] : ['bench', p.bench.indexOf(m) + 1] }; }
  slotEn(p, m) { return p.active === m ? 'Active' : `Bench ${p.bench.indexOf(m) + 1}`; }
  log(key, params = {}, kind = 'sys', pl = null) { this.hooks.onLog?.({ key, params, kind, pl }); }
  plog(p, key, params = {}) { this.log(key, { P: PL(p), ...params }, p.idx === 0 ? 'you' : 'opp', p.idx); }
  learn(key, params = {}) {
    if (this.learned.has(key)) return;
    this.learned.add(key);
    this.log('rule.' + key, params, 'rule');
  }
  update() { this.hooks.onUpdate?.(this); }
  async pause(ms) { if (this.hooks.pause) await this.hooks.pause(ms); }
  ask(p, prompt) { return this.controllers[p.idx].choose(this, p, prompt); }

  draw(p, n = 1) {
    let drawn = 0;
    while (drawn < n && p.deck.length) { p.hand.push(p.deck.pop()); drawn++; }
    return drawn;
  }
  takeFromHand(p, card) {
    p.hand.splice(p.hand.indexOf(card), 1);
    return card;
  }
  setWinner(p, reasonKey, params = {}) {
    if (this.winner) return;
    this.winner = p;
    this.winReason = { key: reasonKey, params };
    this.phase = 'over';
    this.log(p === 'draw' ? 'log.draw' : 'log.win', { P: p === 'draw' ? null : PL(p) }, 'win', p === 'draw' ? null : p.idx);
    this.update();
  }

  // `resume`: continue a restored game in the middle of the current player's turn.
  async run({ resume = false } = {}) {
    if (!resume) await this.setup();
    let skipStart = resume;
    while (!this.winner) {
      const p = this.current;
      if (!skipStart) await this.startTurn(p);
      skipStart = false;
      if (this.winner) break;
      for (let guard = 0; guard < 80 && !this.winner; guard++) {
        this.hooks.onCheckpoint?.(this);
        const actions = this.legalActions(p);
        const act = await this.controllers[p.idx].chooseAction(this, p, actions);
        const ended = await this.perform(p, act);
        this.update();
        if (ended) break;
      }
      if (this.winner) break;
      await this.checkup(p);
      this.current = this.opp(p);
    }
    this.hooks.onGameOver?.(this);
  }

  // ---------------- Setup ----------------
  async setup() {
    // One player calls the coin; a correct call goes first.
    const call = (await this.controllers[0].callCoin?.(this)) ?? 'heads';
    const youH = { key: 'coin.o.first.you' }, oppH = { key: 'coin.o.first.opp' };
    const h = await this.flip('first', { call: { $coin: call === 'heads' } }, call === 'heads' ? [youH, oppH] : [oppH, youH]);
    const first = h === (call === 'heads') ? this.players[0] : this.players[1];
    this.first = first;
    this.plog(first, 'log.first');

    const mulligans = [0, 0];
    for (const p of this.players) {
      for (;;) {
        this.draw(p, HAND_SIZE);
        if (p.hand.some(isBasic)) break;
        mulligans[p.idx]++;
        this.plog(p, 'log.mulligan');
        p.deck.push(...p.hand);
        p.hand = [];
        shuffle(p.deck);
      }
    }
    if (mulligans[0] || mulligans[1]) this.learn('mulligan');
    for (const p of this.players) {
      const extra = mulligans[1 - p.idx];
      if (extra) this.plog(p, 'log.mulliganDraw', { n: this.draw(p, extra) });
    }
    this.update();

    this.learn('setup');
    for (const p of this.players) {
      const canStart = (c) => isBasic(c) || (this.modern && c.powerKind === 'electricStart' && p !== first); // Electric Start
      const basics = p.hand.filter(canStart);
      const id = await this.ask(p, {
        kind: 'setup-active', title: 'prompt.active.title', text: 'prompt.active.text',
        options: uniqueByName(basics).map((c) => ({ id: String(c.uid), card: c })),
      });
      const card = basics.find((c) => String(c.uid) === id) || basics[0];
      p.active = new Mon(this.takeFromHand(p, card), 0);
      this.update();

      const rest = p.hand.filter(canStart);
      if (rest.length) {
        const picked = await this.controllers[p.idx].setupBench(this, p, rest);
        for (const c of rest.filter((c) => picked.includes(c.uid)).slice(0, MAX_BENCH))
          p.bench.push(new Mon(this.takeFromHand(p, c), 0));
      }
      this.update();
    }

    for (const p of this.players) p.prizes = p.deck.splice(-PRIZES);
    this.log('log.prizesSet', { n: PRIZES });
    this.learn('prizes', { n: PRIZES });
    this.current = first;
    this.update();
  }

  // ---------------- Turn flow ----------------
  async startTurn(p) {
    this.turn++;
    this.phase = 'main';
    p.flags = { energy: false, retreat: false, powers: {} };
    this.log('log.turn', { n: this.turn, P: PL(p) }, 'turn', p.idx);
    if (!p.deck.length) {
      this.setWinner(this.opp(p), 'reason.deckout', { P: PL(p) });
      return;
    }
    const c = p.deck.pop();
    p.hand.push(c);
    if (p.idx === 0) this.plog(p, 'log.drewCard', { c: C(c) });
    else this.plog(p, 'log.drew');
    this.learn('draw');
    if (this.turn === 1) this.learn('firstTurn');
    this.update();
    await this.pause(650); // let the draw be seen before the turn continues
  }

  // ---------------- Save / restore ----------------
  serialize() {
    const card = (c) => ({ uid: c.uid, id: c.id });
    const mon = (m) => m && {
      id: m.id, stack: m.stack.map(card), energy: m.energy.map(card), tools: m.tools.map((x) => ({ card: card(x.card), expires: x.expires })),
      damage: m.damage, status: m.status, effects: m.effects, used: m.used, playedTurn: m.playedTurn,
    };
    return {
      turn: this.turn, phase: this.phase, current: this.current?.idx, first: this.first?.idx, learned: [...this.learned],
      stadium: this.stadium && { card: card(this.stadium.card), owner: this.stadium.owner },
      players: this.players.map((p) => ({
        deckKey: p.deckKey, flags: p.flags, until: p.until, koTurn: p.koTurn, vstarUsed: p.vstarUsed, gxUsed: p.gxUsed, deck: p.deck.map(card), hand: p.hand.map(card), discard: p.discard.map(card), lost: (p.lost || []).map(card),
        prizes: p.prizes.map(card), active: mon(p.active), bench: p.bench.map(mon),
      })),
    };
  }

  static restore(data, { controllers, hooks }) {
    const g = new Game({ decks: data.players.map((p) => p.deckKey), controllers, hooks });
    const card = (c) => { nextUid = Math.max(nextUid, c.uid + 1); return { uid: c.uid, ...CARDS[c.id] }; };
    const mon = (d) => {
      if (!d) return null;
      const m = new Mon(card(d.stack[0]), d.playedTurn);
      m.id = d.id;
      nextMonId = Math.max(nextMonId, d.id + 1);
      m.stack = d.stack.map(card);
      m.energy = d.energy.map(card);
      m.tools = d.tools.map((x) => ({ card: card(x.card), expires: x.expires }));
      Object.assign(m, { damage: d.damage, status: d.status, effects: d.effects, used: d.used });
      return m;
    };
    data.players.forEach((d, i) => Object.assign(g.players[i], {
      flags: { ...d.flags, powers: d.flags.powers || {} }, until: d.until || {}, koTurn: d.koTurn ?? -9, vstarUsed: !!d.vstarUsed, gxUsed: !!d.gxUsed, deck: d.deck.map(card), hand: d.hand.map(card), discard: d.discard.map(card), lost: (d.lost || []).map(card),
      prizes: d.prizes.map(card), active: mon(d.active), bench: d.bench.map(mon),
    }));
    g.stadium = data.stadium ? { card: card(data.stadium.card), owner: data.stadium.owner } : null;
    Object.assign(g, { turn: data.turn, phase: data.phase, current: g.players[data.current], first: g.players[data.first], learned: new Set(data.learned) });
    return g;
  }

  legalActions(p) {
    const A = [];
    const o = this.opp(p);
    const seen = new Set();
    const once = (k) => (seen.has(k) ? false : (seen.add(k), true));
    const mons = this.allMons(p);
    const add = (kind, label, detail, extra = {}) => A.push({ kind, label, detail, ...extra });
    const lbl = (key, params = {}) => ({ key: 'act.' + key, params });
    const monEn = (m) => `${m.name} (${m.hpLeft}/${m.maxHp} HP, Energy: ${m.energyTypes.join(', ') || 'none'})`;

    for (const c of p.hand) {
      if (c.kind === 'pokemon') {
        if (c.stage === 0 && p.bench.length < MAX_BENCH && once('bench' + c.name))
          add('bench', lbl('bench', { c: C(c) }), `Play the Basic Pokémon ${c.name} (${c.hp} HP) from your hand onto your Bench (${p.bench.length}/${MAX_BENCH} used).`, { card: c });
        if (c.stage > 0)
          for (const m of mons) {
            // Giovanni lets one of his Pokémon evolve on the turn it was played (even on your first turn).
            const gio = p.flags.giovanni === m.id;
            if (m.name === c.evolvesFrom && (gio || (this.turn > 2 && m.playedTurn < this.turn)) && once('evo' + c.name + m.id))
              add('evolve', lbl('evolve', { from: m.name, s: this.slot(p, m), to: c.name }),
                `Evolve ${m.name} (${this.slotEn(p, m)}) into ${c.name}: max HP ${m.maxHp} → ${c.hp}, keeps damage and Energy, removes Special Conditions. New attacks: ${attacksEn(c)}.`, { card: c, target: m });
          }
      } else if (c.kind === 'energy') {
        if (!p.flags.energy)
          for (const m of mons)
            if (!m.effects.noEnergy && !(c.special === 'teamRocket' && !m.name.startsWith("Team Rocket's")) && !(c.needsTag && !m.card.tags?.includes(c.needsTag)) &&
              !(c.special === 'aurora' && p.hand.length < 2) && !(c.special && p.until.noSpecialStadium === this.turn) && once('en' + c.name + m.id))
              add('energy', lbl('energy', { c: C(c), m: m.name, s: this.slot(p, m) }),
                `Attach ${c.name} to ${m.name} (${this.slotEn(p, m)}). ${energyNote(m, c.energyType, c.provides)}${c.special ? ' ' + SPECIAL_EN[c.special] : ''}`, { card: c, target: m });
      } else if (c.kind === 'trainer') {
        if (p.until.noTrainers === this.turn) continue; // Headache
        if (this.modern) {
          const T = (key, params, detail, extra = {}) => add('trainer', lbl('t.' + key, { c: C(c), ...params }), `${TTYPE_EN[c.ttype] || 'Trainer'} ${c.name}: ${detail}`, { card: c, tkind: c.tkind, ...extra });
          this.modernTrainerActions(p, o, c, once, T, monEn);
        } else this.trainerActions(p, o, c, once, add, lbl, monEn);
      }
    }

    // Blaine: instead of the normal Energy, attach 2 Fire Energy to one of Blaine's Pokémon.
    const fires = p.hand.filter((x) => x.kind === 'energy' && x.energyType === 'Fire' && !x.special);
    if (p.flags.blaine && !p.flags.energy && fires.length >= 2)
      for (const m of mons) if (m.name.includes('Blaine') && !m.effects.noEnergy)
        add('energy', lbl('blaine', { m: m.name, s: this.slot(p, m) }), `Blaine's effect: attach 2 Fire Energy from your hand to ${monEn(m)} as your Energy for this turn.`, { card: fires[0], card2: fires[1], target: m });

    const a = p.active;
    const cost = a ? this.retreatCost(p, a) : 0;
    const stuck = a && (a.status.asleep || a.status.paralyzed) && !(this.modern && this.canRetreatStuck(a)); // Escape Board
    if (a && !p.flags.retreat && p.bench.length && !stuck && !a.effects.noRetreat && a.energyTypes.length >= cost)
      for (const b of p.bench)
        add('retreat', lbl('retreat', { from: a.name, to: b.name }),
          `Retreat: discard ${cost} Energy from ${a.name} to move it to the Bench; ${monEn(b)} becomes Active. Once per turn.`, { target: b });

    if (this.modern) {
      this.abilityActions(p, o, add, lbl, monEn);
      this.modernStadiumActions(p, add, lbl);
    } else {
      this.powerActions(p, o, add, lbl, monEn);
      this.stadiumActions(p, add, lbl, monEn);
    }

    const d = o.active;
    const blockedBy = a?.effects.noAttack;
    const modernBlock = a && (a.effects.cooldownAll || a.effects.noAttackAll ||
      (a.card.powerKind === 'powerSaver' && this.allMons(p).filter((x) => x.name.startsWith("Team Rocket's")).length < 4));
    if (a && this.turn !== 1 && !a.status.asleep && !a.status.paralyzed && !(blockedBy && blockedBy.target === d?.id) && !modernBlock)
      this.attacksOf(a).forEach((atk, i) => {
        const fx = atk.fx;
        if (!canPay(a.payTypes, atk.cost)) return;
        if (fx.needsDefAsleep && !d.status.asleep) return;
        if (fx.oncePerPlay && a.used[atk.name]) return;
        if (a.effects.cooldown?.atk === atk.name || a.effects.amnesia?.atk === atk.name || a.effects.usedActive?.atk === atk.name) return;
        if (fx.needsType && !a.energyTypes.includes(fx.needsType)) return;
        if (fx.needsCounters && a.counters < fx.needsCounters) return;
        if (fx.needsEqualEnergy && a.energy.length !== d.energy.length) return;
        if ((fx.callFamily || fx.callFriend) && p.bench.length >= MAX_BENCH) return;
        if ((fx.shuffleSelf || fx.fadeOut || fx.selfToHandAll) && !p.bench.length) return;
        if (fx.needsDefTera && !d.card.tera) return;
        if (fx.gx && p.gxUsed) return; // only 1 GX attack per game
        if (fx.copyBenchTag && !p.bench.some((x) => x.card.tags?.includes(fx.copyBenchTag) && x.card.attacks.length)) return;
        if (fx.flipMetronome && !d?.card.attacks.length) return;
        add('attack', lbl('attack', { name: atk.name }), this.attackPreview(p, i), { index: i });
      });

    add('end', lbl('end'), 'End your turn without attacking.');
    A.forEach((x, i) => { x.key = 'a' + i; });
    return A;
  }

  // Pokémon Powers you can use on your turn (before attacking).
  powerActions(p, o, add, lbl, monEn) {
    for (const m of this.allMons(p)) {
      const k = m.card.powerKind;
      if (!ACTIVE_POWERS.has(k) || !this.powerOn(m)) continue;
      const used = p.flags.powers[m.id];
      const P = (detail, extra = {}) => add('power', lbl('power', { m: m.name, pw: m.card.power.name }), `Pokémon Power ${m.card.power.name} of ${m.name}: ${detail}`, { target: m, pkind: k, ...extra });
      switch (k) {
        case 'pollenStench':
          if (!used && p.active && o.active) P(`flip a coin. Heads: the opponent's Active ${o.active.name} becomes Confused. Tails: your Active ${p.active.name} becomes Confused. Once per turn.`);
          break;
        case 'longDistanceHypnosis':
          if (!used && p.active && o.active) P(`flip a coin. Heads: the opponent's Active ${o.active.name} falls Asleep. Tails: your Active ${p.active.name} falls Asleep. Once per turn.`);
          break;
        case 'matterExchange':
          if (!used && p.hand.length && p.deck.length) P('discard a card from your hand to draw a card. Once per turn.');
          break;
        case 'energyCharge':
          if (p.active === m && this.allMons(p).some((x) => x !== m && x.energy.some((en) => en.energyType === 'Lightning' && !en.special)))
            P('move 1 Lightning Energy from one of your other Pokémon onto it. As often as you like.');
          break;
        case 'emerge':
          if (!used && p.deck.some((c) => c.name === "Koga's Beedrill")) P("flip a coin. Heads: search your deck for Koga's Beedrill and evolve this Kakuna into it. Once per turn.");
          break;
      }
    }
  }

  // Things the Stadium in play lets each player do on their turn.
  stadiumActions(p, add, lbl, monEn) {
    const s = this.stadium?.card;
    if (!s) return;
    const S = (key, params, detail, extra = {}) => add('stadium', lbl('s.' + key, { c: C(s), ...params }), `Stadium ${s.name}: ${detail}`, { stadium: key, ...extra });
    const mons = this.allMons(p);
    switch (s.stadium) {
      case 'celadon':
        if (!p.flags.stadiumUsed)
          for (const m of mons) if (m.name.includes('Erika') && m.energy.length && m.conditions().length)
            S('celadon', { m: m.name }, `discard 1 Energy from ${monEn(m)} to cure all its Special Conditions (${m.conditions().join(', ')}).`, { target: m });
        break;
      case 'fuchsia':
        if (!p.flags.stadiumUsed)
          for (const m of [p.active, ...p.bench]) if (m?.name.includes('Koga') && p.bench.length)
            S('fuchsia', { m: m.name }, `flip a coin. Heads: shuffle your ${monEn(m)} and its attached cards into your deck. Once per turn.`, { target: m });
        break;
      case 'saffron':
        for (const m of mons) if (m.name.includes('Sabrina') && m.energy.some((en) => !en.special))
          S('saffron', { m: m.name }, `return 1 basic Energy from ${monEn(m)} to your hand.`, { target: m });
        break;
    }
  }

  trainerActions(p, o, c, once, add, lbl, monEn) {
    const mons = this.allMons(p), oppMons = this.allMons(o);
    const others = p.hand.length - 1;
    const tk = c.tkind;
    const T = (key, params, detail, extra = {}) => add('trainer', lbl('t.' + key, { c: C(c), ...params }), `Trainer ${c.name}: ${detail}`, { card: c, tkind: tk, ...extra });
    switch (tk) {
      case 'potion':
        for (const m of mons) if (m.damage > 0 && once('potion' + m.id))
          T('potion', { m: m.name }, `heal 20 damage from ${monEn(m)}.`, { target: m });
        break;
      case 'superPotion':
        for (const m of mons) if (m.damage > 0 && m.energy.length && once('spotion' + m.id))
          T('superPotion', { m: m.name }, `discard 1 Energy from ${monEn(m)} to heal 40 damage from it.`, { target: m });
        break;
      case 'switch':
        for (const b of p.bench) if (once('switch' + b.id))
          T('switch', { m: b.name }, `switch your Active ${p.active.name} with Benched ${monEn(b)} for free.`, { target: b });
        break;
      case 'gust':
        for (const b of o.bench) if (once('gust' + b.id))
          T('gust', { m: b.name }, `force the opponent's Benched ${monEn(b)} into their Active Spot (their Active ${o.active.name} goes to the Bench).`, { target: b });
        break;
      case 'energyRemoval':
        for (const m of oppMons) for (const t of new Set(m.energyTypes)) if (once('er' + m.id + t))
          T('energyRemoval', { m: m.name, t: { $type: t } }, `discard 1 ${t} Energy from the opponent's ${monEn(m)}.`, { target: m, etype: t });
        break;
      case 'superEnergyRemoval':
        if (mons.some((m) => m.energy.length))
          for (const m of oppMons) if (m.energy.length && once('ser' + m.id))
            T('superEnergyRemoval', { m: m.name }, `discard 1 Energy from one of your Pokémon to discard up to 2 Energy from the opponent's ${monEn(m)}.`, { target: m });
        break;
      case 'plusPower':
        if (p.active && once('pp')) T('plusPower', { m: p.active.name }, `attach to your Active ${p.active.name}: its attack does 10 more damage this turn.`);
        break;
      case 'defender':
        for (const m of mons) if (once('def' + m.id))
          T('defender', { m: m.name }, `attach to ${monEn(m)}: damage done to it is reduced by 20 until the end of the opponent's next turn.`, { target: m });
        break;
      case 'bill':
        if (p.deck.length && once('bill')) T('bill', {}, 'draw 2 cards.');
        break;
      case 'professorOak':
        if (p.deck.length && once('oak')) T('professorOak', { n: others }, `discard your hand (${others} other cards) and draw 7 cards.`);
        break;
      case 'lass': {
        const mine = p.hand.filter((x) => x.kind === 'trainer').length - 1;
        if (once('lass')) T('lass', {}, `both players shuffle all Trainer cards from their hands into their decks (you would lose ${mine} other Trainers, the opponent has ${o.hand.length} cards in hand).`);
        break;
      }
      case 'energyRetrieval':
        if (others >= 1 && p.discard.some((x) => x.kind === 'energy') && once('eretr'))
          T('energyRetrieval', {}, `discard 1 other card from your hand to put up to 2 basic Energy cards from your discard pile into your hand (${p.discard.filter((x) => x.kind === 'energy').length} in discard).`);
        break;
      case 'computerSearch':
        if (others >= 2 && p.deck.length && once('cs')) T('computerSearch', {}, 'discard 2 other cards from your hand to search your deck for any 1 card.');
        break;
      case 'fullHeal':
        if (p.active?.conditions().length && once('fh')) T('fullHeal', { m: p.active.name }, `cure all Special Conditions (${p.active.conditions().join(', ')}) of your Active ${p.active.name}.`);
        break;
      case 'pokemonCenter':
        if (mons.some((m) => m.damage) && once('pc')) T('pokemonCenter', {}, `remove all damage from your damaged Pokémon (${mons.filter((m) => m.damage).map(monEn).join('; ')}), but discard all Energy attached to them.`);
        break;
      case 'pokedex':
        if (p.deck.length > 1 && once('dex')) T('pokedex', {}, 'look at the top 5 cards of your deck and choose which one you will draw next.');
        break;
      case 'pokeBall':
        if (p.deck.some((x) => x.kind === 'pokemon') && once('pb')) T('pokeBall', {}, 'flip a coin. Heads: search your deck for any Pokémon card and put it into your hand.');
        break;
      case 'energySearch':
        if (p.deck.some((x) => x.kind === 'energy' && !x.special) && once('es')) T('energySearch', {}, 'search your deck for a basic Energy card and put it into your hand.');
        break;
      case 'gambler':
        if (once('gam')) T('gambler', { n: others }, `shuffle your hand (${others} other cards) into your deck, then flip a coin: heads draw 8 cards, tails draw 1.`);
        break;
      case 'pokemonTrader':
        if (p.hand.some((x) => x.kind === 'pokemon') && p.deck.some((x) => x.kind === 'pokemon') && once('ptr'))
          T('pokemonTrader', {}, 'put a Pokémon card from your hand into your deck and take any Pokémon card from your deck instead.');
        break;
      case 'bossWay':
        if (p.deck.some((x) => x.kind === 'pokemon' && x.stage > 0 && x.name.includes('Dark')) && once('boss')) T('bossWay', {}, 'search your deck for an Evolution card with Dark in its name and put it into your hand.');
        break;
      case 'brockTraining':
        if (p.deck.some((x) => x.kind === 'pokemon' && x.name.includes('Brock')) && once('btm')) T('brockTraining', {}, "search your deck for a Pokémon card with Brock in its name and put it into your hand.");
        break;
      case 'imposterOak':
        if (others >= 1 && once('imp')) T('imposterOak', {}, `discard 1 other card from your hand; the opponent shuffles their hand (${o.hand.length} cards) into their deck and draws 4.`);
        break;
      case 'erika':
        if (p.deck.length && once('erika')) T('erika', {}, 'you may draw up to 3 cards, then the opponent may draw up to 3 cards.');
        break;
      case 'ltSurge':
        if (p.bench.length < MAX_BENCH && p.hand.some(isBasic) && once('surge'))
          T('ltSurge', {}, `put a Basic Pokémon from your hand into play as your new Active Pokémon; your Active ${p.active.name} moves to the Bench.`);
        break;
      case 'misty':
        if (others >= 2 && p.active?.name.includes('Misty') && !p.flags.misty && once('misty'))
          T('misty', {}, `discard 2 other cards from your hand: this turn, if your Active ${p.active.name} does damage with an attack, it does 20 more.`);
        break;
      case 'brock':
        if (mons.some((m) => m.damage) && once('brock')) T('brock', {}, 'remove 1 damage counter (10 damage) from each of your damaged Pokémon.');
        break;
      case 'erikasPerfume':
        if (o.bench.length < MAX_BENCH && once('perf')) T('erikasPerfume', {}, `look at the opponent's hand (${o.hand.length} cards) and put any of its Basic Pokémon onto their Bench.`);
        break;
      case 'mistysWrath':
        if (p.deck.length && once('wrath')) T('mistysWrath', {}, 'look at the top 7 cards of your deck, put 2 of them into your hand and discard the rest.');
        break;
      case 'secretMission':
        if (once('secret')) T('secretMission', {}, `look at the opponent's hand, then discard any number of other cards from your hand and draw that many.`);
        break;
      case 'blainesGamble':
        if (others >= 1 && once('bg')) T('blainesGamble', {}, 'discard any number of other cards from your hand, then flip a coin: heads, draw twice that many cards.');
        break;
      case 'sabrinasGaze':
        if (once('gaze')) T('sabrinasGaze', {}, `both players shuffle their hands into their decks and draw the same number of new cards (you: ${others}, opponent: ${o.hand.length}).`);
        break;
      case 'blaine':
        if (!p.flags.energy && !p.flags.blaine && mons.some((m) => m.name.includes('Blaine')) && p.hand.filter((x) => x.kind === 'energy' && x.energyType === 'Fire' && !x.special).length >= 2 && once('blaine'))
          T('blaine', {}, "this turn, instead of your normal Energy, you may attach 2 Fire Energy cards to one of your Pokémon with Blaine in its name.");
        break;
      case 'giovanni':
        if (p.flags.giovanni == null)
          for (const m of mons) if (m.name.includes('Giovanni') && p.hand.some((x) => x.evolvesFrom === m.name) && once('gio' + m.id))
            T('giovanni', { m: m.name }, `${monEn(m)} may evolve this turn even if it was just played or it is your first turn.`, { target: m });
        break;
      case 'koga':
        if (!p.flags.koga && p.active?.name.includes('Koga') && once('koga')) T('koga', {}, `this turn, if your Active ${p.active.name} does damage with an attack, the Defending Pokémon is also Poisoned.`);
        break;
      case 'sabrina': {
        const sab = mons.filter((m) => m.name.includes('Sabrina'));
        if (sab.length >= 2 && sab.some((m) => m.energy.length) && once('sabrina')) T('sabrina', {}, "move all Energy from one of your Pokémon with Sabrina in its name to another one.");
        break;
      }
      case 'maxRevive':
        if (p.bench.length < MAX_BENCH && p.discard.some(isBasic) && p.hand.filter((x) => x.kind === 'energy').length >= 2 && once('rev'))
          T('maxRevive', {}, `discard 2 Energy cards from your hand to put a Basic Pokémon from your discard pile onto your Bench (${uniqueByName(p.discard.filter(isBasic)).map((x) => x.name).join(', ')}).`);
        break;
      case 'psychicControl':
        if (o.discard.some((x) => x.kind === 'trainer' && COPYABLE.has(x.tkind)) && once('spc')) T('psychicControl', {}, "flip a coin. Heads: use one of the Trainer cards in the opponent's discard pile as if it were in your hand.");
        break;
      case 'fervor':
        if (p.deck.length && once('fervor')) T('fervor', {}, 'reveal the top 3 cards of your deck: Fire Energy cards go to your hand, the rest are discarded.');
        break;
      case 'warpPoint':
        if ((o.bench.length || p.bench.length) && once('warp')) T('warpPoint', {}, 'the opponent switches their Active Pokémon with a Benched one (they choose), then you may switch yours.');
        break;
      case 'stadium':
        if (this.stadium?.card.name !== c.name && once('std' + c.name)) T('stadium', {}, `put this Stadium into play (it replaces any other Stadium): ${STADIUM_EN[c.stadium]}`);
        break;
    }
  }

  damageCalc(attacker, defender, base, { noRes = false, noWeakness = false, ignoreDef = false } = {}) {
    let d = base;
    const notes = [];
    // Cinnabar City Gym: Water Pokémon ignore the Weakness of Blaine's Pokémon. Pewter City Gym: Brock's Pokémon ignore Resistance.
    const noWeak = this.stadiumIs('cinnabar') && attacker.card.type === 'Water' && defender.name.includes('Blaine');
    const weak = this.modern && !ignoreDef ? this.weaknessOf(defender) : defender.card.weakness;
    if (d > 0 && weak === attacker.card.type && !noWeak && !noWeakness) { d *= 2; notes.push('weakness'); }
    const resOff = noRes || (this.stadiumIs('pewter') && attacker.name.includes('Brock'));
    if (d > 0 && defender.card.resistance === attacker.card.type && !resOff) { d = Math.max(0, d - 30); notes.push('resistance'); }
    return { d, notes };
  }

  // Damage before coin flips, as [min, max] base values.
  baseRange(a, d, atk) {
    const fx = atk.fx;
    let base = atk.base;
    // "For each Energy attached": modern cards count Energy (Double Turbo is 2); the classic texts say "Energy card".
    if (fx.plusDefEnergy) base += fx.plusDefEnergy * (this.modern ? d.energyTypes.length : d.energy.length);
    if (fx.plusDefCounters) base += fx.plusDefCounters * d.counters;
    if (fx.minusSelfCounters) base = Math.max(0, base - fx.minusSelfCounters * a.counters);
    if (fx.timesSelfCounters) base = fx.timesSelfCounters * a.counters;
    if (fx.plusSelfCounters) base += fx.plusSelfCounters * a.counters;
    if (fx.plusOwnBench) base += fx.plusOwnBench * (this.ownerOf(a)?.bench.length || 0);
    if (fx.bonusIfDamaged && d.damage > 0) base += fx.bonusIfDamaged;
    if (fx.halfHp) base = Math.ceil(d.hpLeft / 20) * 10;
    if (fx.massExplosion) base = 20 * this.players.flatMap((q) => this.allMons(q)).filter(isKoffingLine).length;
    if (a.effects.focus?.atk === atk.name) base *= 2;
    if (this.modern) {
      const me = this.ownerOf(a), foe = me && this.opp(me);
      if (fx.fixedBase) base = fx.fixedBase;
      if (fx.timesPrizeTaken) base = fx.timesPrizeTaken * (foe ? this.prizesTaken(foe) : 0);
      if (fx.plusPrizeTaken) base += fx.plusPrizeTaken * (foe ? this.prizesTaken(foe) : 0);
      if (fx.plusSelfEnergy) base += fx.plusSelfEnergy.n * a.energyTypes.filter((t) => isType(t, fx.plusSelfEnergy.type)).length;
      if (fx.timesNamedInPlay) base = fx.timesNamedInPlay.n * (me ? this.allMons(me).filter((x) => x.name.startsWith(fx.timesNamedInPlay.who)).length : 0);
      if (fx.bonusIfAttachedName && a.energy.some((en) => en.name === fx.bonusIfAttachedName.name)) base += fx.bonusIfAttachedName.n;
      if (fx.bonusIfDefEvolved && d.card.stage > 0) base += fx.bonusIfDefEvolved;
      if (fx.bonusIfEqualHands && me && me.hand.length === foe.hand.length) base += fx.bonusIfEqualHands;
      if (fx.bonusIfKOLastTurn && me && this.koLastTurn(me)) base += fx.bonusIfKOLastTurn.n;
      if (fx.timesHand) base = fx.timesHand * (me ? me.hand.length : 0);
      if (fx.timesOwnInPlay) base = fx.timesOwnInPlay * (me ? this.allMons(me).length : 0);
      if (fx.timesAllEnergy) base = fx.timesAllEnergy * this.players.reduce((s, q) => s + this.allMons(q).reduce((t, x) => t + x.energyTypes.length, 0), 0);
      if (fx.bonusIfTool && a.tools.length) base += fx.bonusIfTool;
      if (fx.bonusIfSelfCounters && a.counters >= fx.bonusIfSelfCounters.min) base += fx.bonusIfSelfCounters.n;
      if (fx.plusBenchNamed) base += fx.plusBenchNamed.n * (me ? me.bench.filter((x) => x.name === fx.plusBenchNamed.name).length : 0);
      if (fx.plusDiscardNamed) base += fx.plusDiscardNamed.n * (me ? me.discard.filter((x) => x.name === fx.plusDiscardNamed.name).length : 0);
      if (fx.plusDefRetreat && foe && foe.active === d) base += fx.plusDefRetreat * this.retreatCost(foe, d);
      if (fx.bonusIfExtraEnergy && a.energyTypes.length > atk.cost.length) base += fx.bonusIfExtraEnergy;
      if (a.effects.boost && atk.damage && (!a.effects.boost.atk || a.effects.boost.atk === atk.name)) base += a.effects.boost.n; // Hone Claws, Work Up (attacks that do damage)
      if (fx.bonusIfEqualBench && me && me.bench.length === foe.bench.length) base += fx.bonusIfEqualBench;
      if (fx.bonusIfBenchName && me?.bench.some((x) => x.name === fx.bonusIfBenchName.name)) base += fx.bonusIfBenchName.n;
      if (fx.bonusIfHealedThisTurn && a.effects.healedNow) base += fx.bonusIfHealedThisTurn;
      if (fx.bonusIfEvolvedThisTurn && a.effects.evolvedNow) base += fx.bonusIfEvolvedThisTurn;
      if (fx.bonusIfMovedToActive && a.effects.movedActive) base += fx.bonusIfMovedToActive;
      if (fx.bonusIfStadium && this.stadium) base += fx.bonusIfStadium;
      if (fx.plusOppBench) base += fx.plusOppBench * (foe ? foe.bench.length : 0);
      if (fx.plusAllBench) base += fx.plusAllBench * this.players.reduce((t, q) => t + q.bench.length, 0);
      if (fx.plusTypeEnergyAll && me) base += fx.plusTypeEnergyAll.n * this.allMons(me).reduce((t, x) => t + x.energyTypes.filter((y) => isType(y, fx.plusTypeEnergyAll.type)).length, 0);
      if (fx.timesAttachedNameAll) base = fx.timesAttachedNameAll.n * (me ? this.allMons(me).reduce((t, x) => t + x.energy.filter((en) => en.name === fx.timesAttachedNameAll.name).length, 0) : 0);
      if (fx.timesBothActiveEnergy) base = fx.timesBothActiveEnergy * this.players.reduce((t, q) => t + (q.active ? q.active.energyTypes.length : 0), 0);
      // Sun & Moon
      const times = atk.damage?.includes('×'); // "N×" attacks do N for each, nothing else
      if (fx.plusDiscardEnergyTypes && me) base += Math.min(fx.plusDiscardEnergyTypes.max, fx.plusDiscardEnergyTypes.n * new Set(me.discard.filter((x) => x.kind === 'energy' && !x.special).map((x) => x.energyType)).size);
      if (fx.bonusIfDefBasic && d.card.stage === 0) base += fx.bonusIfDefBasic;
      if (fx.timesAllBench) base = fx.timesAllBench * this.players.reduce((t, q) => t + q.bench.length, 0);
      if (fx.plusOppEnergyAll && foe) base += fx.plusOppEnergyAll * this.allMons(foe).reduce((t, x) => t + x.energyTypes.length, 0);
      if (fx.bonusIfPlayed && me?.flags.played?.includes(fx.bonusIfPlayed.name)) base += fx.bonusIfPlayed.n;
      if (fx.bonusIfDeckLE && me && me.deck.length <= fx.bonusIfDeckLE.max) base += fx.bonusIfDeckLE.n;
      if (fx.bonusIfMoreHand && me && me.hand.length > foe.hand.length) base += fx.bonusIfMoreHand;
      if (fx.bonusIfFewerInPlay && me && this.allMons(me).length < this.allMons(foe).length) base += fx.bonusIfFewerInPlay;
      if (fx.bonusIfSelfType && a.energyTypes.some((t) => isType(t, fx.bonusIfSelfType.type))) base += fx.bonusIfSelfType.n;
      if (fx.timesSelfType) base = fx.timesSelfType.n * a.energyTypes.filter((t) => isType(t, fx.timesSelfType.type)).length;
      if (fx.bonusIfPrizesExactly && me && me.prizes.length === fx.bonusIfPrizesExactly.n) base += fx.bonusIfPrizesExactly.bonus;
      if (fx.plusBenchEvolved && me) base += fx.plusBenchEvolved * me.bench.filter((x) => x.card.stage > 0).length;
      if (fx.bonusIfLostType && me?.lost?.some((x) => x.kind === 'energy' && x.energyType === fx.bonusIfLostType.type)) base += fx.bonusIfLostType.n;
      if (fx.bonusIfDefResist && d.card.resistance === fx.bonusIfDefResist.type) base += fx.bonusIfDefResist.n;
      if (fx.bonusIfDefStatus && d.status[fx.bonusIfDefStatus.status]) base += fx.bonusIfDefStatus.n;
      if (fx.timesOwnEnergyAll && me) base = fx.timesOwnEnergyAll * this.allMons(me).reduce((t, x) => t + x.energyTypes.length, 0);
      if (fx.bonusIfSelfStatus && fx.bonusIfSelfStatus.statuses.some((s) => a.status[s])) base += fx.bonusIfSelfStatus.n;
      if (fx.bonusIfDefType && d.card.type === fx.bonusIfDefType.type) base += fx.bonusIfDefType.n;
      if (fx.timesOwnDamaged && me) base = fx.timesOwnDamaged * this.allMons(me).filter((x) => x.damage).length;
      if (fx.bonusIfUsedLastTurn && a.effects.lastAtk?.atk === fx.bonusIfUsedLastTurn.atk && a.effects.lastAtk.expires === this.turn) base += fx.bonusIfUsedLastTurn.n;
      if (fx.needsStadium && !this.stadium) return [0, 0];
      if (fx.optionalBonusSelfDamage) return [base, base + fx.optionalBonusSelfDamage.bonus];
      if (fx.discardAllTypeTimes) { // "for each Energy card you discarded": counted here, before smPreDamage discards them
        const k = a.energy.filter((en) => isType(en.energyType, fx.discardAllTypeTimes.type)).length * fx.discardAllTypeTimes.n;
        return times ? [k, k] : [base + k, base + k];
      }
      if (fx.discardHandTypeTimes) return [0, fx.discardHandTypeTimes.n * Math.min(fx.discardHandTypeTimes.max, me ? me.hand.filter((x) => x.kind === 'energy' && x.energyType === fx.discardHandTypeTimes.type).length : 0)];
      if (fx.furyCutter) return [base, base + 110];
      if (fx.eruption) return [base, base + 2 * fx.eruption];
      if (fx.bonusIfOppHandHas) return [base, base + fx.bonusIfOppHandHas.n];
      if (fx.timesOppHand) base = fx.timesOppHand * (foe ? foe.hand.length : 0);
      if (fx.timesTagInPlay) base = fx.timesTagInPlay.n * (me ? this.allMons(me).filter((x) => x.card.tags?.includes(fx.timesTagInPlay.tag)).length : 0);
      if (fx.bonusIfOppPrizesLE && foe && foe.prizes.length <= fx.bonusIfOppPrizesLE.max) base += fx.bonusIfOppPrizesLE.n;
      if (fx.bonusIfBenchStage2Type && me?.bench.some((x) => x.card.stage === 2 && (!fx.bonusIfBenchStage2Type.type || x.card.type === fx.bonusIfBenchStage2Type.type))) base += fx.bonusIfBenchStage2Type.n;
      if (fx.bonusIfDefEx && d.card.tags?.includes('ex')) base += fx.bonusIfDefEx;
      if (fx.bonusIfDefExV && (d.card.tags?.includes('ex') || d.card.tags?.includes('V') || d.card.tags?.includes('VMAX'))) base += fx.bonusIfDefExV;
      if (fx.bonusIfOwnBenchDamaged && me?.bench.some((x) => x.damage)) base += fx.bonusIfOwnBenchDamaged;
      if (fx.bonusIfEnergyInPlay && me && this.allMons(me).reduce((s, x) => s + x.energyTypes.length, 0) >= fx.bonusIfEnergyInPlay.min) base += fx.bonusIfEnergyInPlay.n;
      if (fx.discardSelfTimes) return [0, fx.discardSelfTimes.n * Math.min(fx.discardSelfTimes.max, a.energy.length)];
      if (fx.returnEnergyBonus) return [base, base + (a.energyTypes.includes(fx.returnEnergyBonus.type) ? fx.returnEnergyBonus.bonus : 0)];
      if (fx.flipUntilTailsBonus) return [base, base + fx.flipUntilTailsBonus * 3];
      if (fx.optionalDiscardBonus) return [base, base + fx.optionalDiscardBonus.bonus];
      if (fx.hailBlade) return [0, fx.hailBlade.n * (me ? this.allMons(me).reduce((s, m) => s + m.energyTypes.filter((t) => t === fx.hailBlade.type).length, 0) : 0)];
      if (fx.discardBenchEnergyBonus) return [base, base + fx.discardBenchEnergyBonus.n * fx.discardBenchEnergyBonus.max];
      if (fx.discardBenchNamedTimes) return [0, fx.discardBenchNamedTimes.n * (me ? me.bench.filter((x) => x.name === fx.discardBenchNamedTimes.name).length : 0)];
      if (fx.optionalDiscardTypeAll) return [base, base + (a.energyTypes.includes(fx.optionalDiscardTypeAll.type) ? fx.optionalDiscardTypeAll.bonus : 0)];
      if (fx.flipMultiBonus) return [base, base + fx.flipMultiBonus.bonus * fx.flipMultiBonus.n];
      if (fx.discardSelfBonus) return [base, base + fx.discardSelfBonus.n * Math.min(fx.discardSelfBonus.max, a.energy.length)];
      if (fx.discardTypeTimes) return [base, base + fx.discardTypeTimes.n * Math.max(...fx.discardTypeTimes.types.map((t) => Math.min(fx.discardTypeTimes.max, a.energy.filter((en) => !en.special && en.energyType === t).length)))];
    }
    if (fx.extraWater) base += Math.min(fx.extraWater, 10 * Math.max(0, this.extraWater(a, atk)));
    if (fx.doubleVs && d.card.type === fx.doubleVs) base *= 2;
    if (fx.mirrorMove) { const h = a.effects.lastHit; return h ? [h.dmg, h.dmg] : [0, 0]; }
    if (fx.spiral || fx.lure) return [0, 0];
    if (fx.flipMulti) return [0, base * fx.flipMulti];
    if (fx.flipPerEnergy) return [0, base * a.energyTypes.length];
    if (fx.flipUntilTails) return [0, base * 4];
    if (fx.flipFail || fx.flipAll || fx.riskyTails) return [0, base];
    if (fx.flipBonus) return [base, base + fx.flipBonus];
    if (fx.bothHeadsBonus) return [base, base + fx.bothHeadsBonus];
    if (fx.waterPunch) return [base, base + fx.waterPunch * this.countType(a, 'Water')];
    return [base, base];
  }

  countType(m, type) { return m.energyTypes.filter((t) => isType(t, type)).length; }
  // Water Energy attached beyond what pays the attack's Water cost.
  extraWater(m, atk) { return this.countType(m, 'Water') - atk.cost.filter((c) => c === 'Water').length;
  }

  // `noWR`: Swift-like, ignores everything on the Defending Pokémon. `noWROnly`: skips only Weakness and Resistance.
  finalDamage(a, d, base, { noWR = false, noWROnly = false, noRes = false, ignoreDef = false, noWeakness = false } = {}) {
    const owner = this.ownerOf(a);
    const misty = (x) => (x > 0 && owner?.flags.misty && a.name.includes('Misty') ? x + 20 : x);
    if (this.modern && base > 0) base = Math.max(0, base + this.modernAttackBonus(a)); // Double Turbo Energy can take some off
    // Daunt: the Defending Pokémon's attacks do less damage (before Weakness and Resistance).
    if (this.modern && base > 0 && a.effects.weaken) base = Math.max(0, base - a.effects.weaken.n);
    if (noWR) return { dmg: misty(base + (base > 0 ? 10 * a.toolCount('plusPower') : 0)), notes: ['noWR'] };
    let { d: dmg, notes } = noWROnly ? { d: base, notes: ['noWR'] } : this.damageCalc(a, d, base, { noRes, noWeakness, ignoreDef });
    if (dmg > 0) dmg += 10 * a.toolCount('plusPower');
    dmg = misty(dmg);
    // Pulverizing Press: nothing on the Defending Pokémon changes the damage.
    if (ignoreDef) return { dmg, notes };
    if (this.modern && dmg > 0) dmg = this.modernDefense(a, d, dmg, notes);
    if (dmg > 0 && d.toolCount('defender')) { dmg = Math.max(0, dmg - 20 * d.toolCount('defender')); notes.push('defender'); }
    if (dmg > 0 && d.effects.reduce) { dmg = Math.max(0, dmg - d.effects.reduce.n); notes.push('reduce'); }
    const sh = d.effects.shield;
    if (sh && sh.kind === 'damage') { dmg = 0; notes.push('shield'); }
    if (sh && sh.kind === 'harden' && dmg <= 30) { dmg = 0; notes.push('harden'); }
    // Strange Barrier: attacks by Basic Pokémon that would do 20 or more only do 10.
    if (dmg >= 20 && d.card.powerKind === 'strangeBarrier' && a.card.stage === 0 && this.powerOn(d)) { dmg = 10; notes.push('barrier10'); }
    return { dmg, notes };
  }

  attackPreview(p, i) {
    const a = p.active, d = this.opp(p).active;
    const atk = this.attacksOf(a)[i], fx = atk.fx;
    const copied = atk.copied ? ' (copied by Psylink)' : '';
    if (fx.lure) return `Attack ${atk.name}: ${atk.text} (no damage). Attacking ends your turn.`;
    const [lo, hi] = this.baseRange(a, d, atk);
    const opts = { noWR: fx.noWR, noWROnly: fx.noWROnly, noRes: fx.noRes, ignoreDef: fx.ignoreDefEffects, noWeakness: fx.noWeakness };
    const L = this.finalDamage(a, d, lo, opts), H = this.finalDamage(a, d, hi, opts);
    const dmg = L.dmg === H.dmg ? `${L.dmg}` : `${L.dmg}–${H.dmg}`;
    let ko = '';
    if (d.effects.shield?.kind === 'all' && !(fx.ignoreDefEffects || (this.modern && fx.noWR))) ko = ` ${d.name} is protected: the attack will do nothing to it!`;
    else if (L.dmg >= d.hpLeft) ko = ` This WILL Knock Out ${d.name} and take a Prize card!`;
    else if (H.dmg >= d.hpLeft) ko = ` May Knock Out ${d.name} depending on coin flips.`;
    const notes = L.notes.length ? ` (${L.notes.join(', ')})` : '';
    const conf = a.status.confused ? ' WARNING: your Pokémon is Confused — 50% chance the attack fails and it takes 30 damage.' : '';
    return `Attack ${d.name} (${d.hpLeft} HP left) with ${atk.name}${copied}: ${dmg} damage${notes}.${ko}${atk.text ? ' Card text: ' + atk.text : ''}${conf} Attacking ends your turn.`;
  }

  // Returns true when the action ends the turn.
  async perform(p, act) {
    switch (act.kind) {
      case 'bench': {
        this.hooks.onBench?.({ p: p.idx, card: act.card });
        const nm = new Mon(this.takeFromHand(p, act.card), this.turn);
        p.bench.push(nm);
        this.plog(p, 'log.bench', { c: C(act.card) });
        this.learn('bench');
        if (this.modern) { this.update(); await this.onBenchAbility(p, nm); await this.modernBenched(p, nm, { fromHand: true }); }
        break;
      }
      case 'evolve': {
        if (this.modern) { await this.evolveMon(p, act.target, act.card); break; }
        await this.hooks.onEvolve?.({ p: p.idx, mon: act.target.id, from: act.target.card, to: act.card });
        const m = act.target, from = m.name;
        m.stack.push(this.takeFromHand(p, act.card));
        m.playedTurn = this.turn;
        m.status = {};
        m.effects = {};
        this.plog(p, 'log.evolve', { from, to: m.name });
        this.learn('evolve');
        if (this.stadiumIs('viridian') && m.name.includes('Giovanni')) await this.heal(m, 20);
        // Call the Boss: playing Giovanni's Persian fetches the Giovanni Trainer card.
        if (m.card.powerKind === 'callTheBoss' && this.powerOn(m)) {
          const g = p.deck.find((x) => x.name === 'Giovanni');
          if (g) { p.hand.push(this.searchDeck(p, g)); this.plog(p, 'log.power.got', { m: m.name, pw: m.card.power.name, c: C(g) }); }
        }
        break;
      }
      case 'energy': {
        for (const card of [act.card, act.card2].filter(Boolean)) {
          await this.hooks.onAttach?.({ p: p.idx, mon: act.target.id, card });
          act.target.energy.push(this.takeFromHand(p, card));
          this.plog(p, 'log.energy', { c: C(card), m: act.target.name });
        }
        p.flags.energy = true;
        this.learn('energy');
        const c = act.card, m = act.target;
        if (this.modern) await this.swshAttached(p, c, m);
        if (c.special === 'potion') await this.heal(m, 10);
        if (c.special === 'fullHeal' && m.conditions().length) { m.status = {}; this.log('log.cured', { m: m.name }, 'heal'); }
        if (c.special) this.learn('specialEnergy');
        else if (!m.card.attacks.some((x) => x.cost.includes(c.energyType))) this.learn('offType', { t: { $type: c.energyType }, m: m.name });
        break;
      }
      case 'trainer':
        await this.hooks.onTrainer?.({ p: p.idx, card: act.card, label: act.label });
        p.discard.push(this.takeFromHand(p, act.card));
        this.learn(this.modern ? 'trainerModern' : 'trainer'); // the Base Set note would teach the wrong limits here
        (p.flags.played ||= []).push(act.card.name); // e.g. Vise Wave: "if you played Nessa from your hand during this turn"
        await this.playTrainer(p, act);
        break;
      case 'retreat': {
        const a = p.active;
        // Pay the retreat cost in Energy units (a Double Colorless Energy pays 2).
        const paid = [];
        for (let units = 0, cost = this.retreatCost(p, a); units < cost && a.energy.length;) {
          const en = a.energy.pop();
          paid.push(en);
          units += en.provides || 1;
        }
        p.discard.push(...paid);
        this.swapActive(p, act.target);
        p.flags.retreat = true;
        this.plog(p, 'log.retreat', { from: a.name, n: paid.length, to: p.active.name });
        this.learn('retreat');
        if (this.modern) await this.becameActive(p);
        break;
      }
      case 'power':
        if ((await (this.modern ? this.useAbility(p, act) : this.usePower(p, act))) === true) return true; // Intrepid Sword ends the turn
        break;
      case 'stadium':
        if (this.modern ? await this.useModernStadium(p, act) : await this.useStadium(p, act)) return true; // Jubilife Village ends the turn
        break;
      case 'attack':
        await this.attack(p, act.index);
        return true;
      case 'end':
        this.plog(p, 'log.end');
        return true;
    }
    if (this.modern) this.checkEnergyRules();
    // Abilities, Stadiums and Trainers can Knock Out Pokémon too (damage counters, Gravity Mountain…).
    if (this.players.some((q) => this.allMons(q).some((m) => m.damage >= m.maxHp))) { this.update(); await this.handleKOs(p); }
    return false;
  }

  async playTrainer(p, act) {
    const o = this.opp(p), c = act.card, m = act.target;
    const L = (key, params = {}) => this.plog(p, 'log.t.' + key, { c: C(c), ...params });
    if (this.modern) return this.playModernTrainer(p, o, c, act, L);
    switch (act.tkind) {
      case 'potion': {
        const h = Math.min(20, m.damage);
        m.damage -= h;
        L('heal', { m: m.name, n: h });
        break;
      }
      case 'superPotion': {
        p.discard.push(m.energy.pop());
        const h = Math.min(40, m.damage);
        m.damage -= h;
        L('superPotion', { m: m.name, n: h });
        break;
      }
      case 'switch':
        this.swapActive(p, m);
        L('switch', { m: p.active.name });
        break;
      case 'gust':
        this.swapActive(o, m);
        L('gust', { m: o.active.name });
        break;
      case 'energyRemoval': {
        const i = m.energy.findIndex((e) => e.energyType === act.etype);
        o.discard.push(...m.energy.splice(i, 1));
        L('energyRemoval', { m: m.name, t: { $type: act.etype } });
        this.learn('energyRemoval');
        break;
      }
      case 'superEnergyRemoval': {
        const mine = this.allMons(p).filter((x) => x.energy.length);
        const id = await this.ask(p, { kind: 'ser', title: 'prompt.ser.title', text: 'prompt.ser.text', options: mine.map((x) => ({ id: String(x.id), mon: x })) });
        const src = mine.find((x) => String(x.id) === id) || mine[0];
        p.discard.push(src.energy.pop());
        const removed = m.energy.splice(-2, 2);
        o.discard.push(...removed);
        L('superEnergyRemoval', { src: src.name, m: m.name, n: removed.length });
        break;
      }
      case 'plusPower':
        await this.hooks.onAttach?.({ p: p.idx, mon: p.active.id, card: c });
        p.active.tools.push({ card: this.pullFromDiscard(p, c), expires: this.turn });
        L('attach', { m: p.active.name });
        this.learn('tool');
        break;
      case 'defender':
        await this.hooks.onAttach?.({ p: p.idx, mon: m.id, card: c });
        m.tools.push({ card: this.pullFromDiscard(p, c), expires: this.turn + 1 });
        L('attach', { m: m.name });
        this.learn('tool');
        break;
      case 'bill':
        L('drew', { n: this.draw(p, 2) });
        break;
      case 'professorOak':
        p.discard.push(...p.hand);
        p.hand = [];
        L('oak', { n: this.draw(p, 7) });
        break;
      case 'lass':
        for (const q of this.players) {
          const tr = q.hand.filter((x) => x.kind === 'trainer');
          q.hand = q.hand.filter((x) => x.kind !== 'trainer');
          q.deck.push(...tr);
          shuffle(q.deck);
          this.plog(q, 'log.t.lassEach', { n: tr.length });
        }
        break;
      case 'energyRetrieval': {
        const id = await this.ask(p, { kind: 'discard', title: 'prompt.discard1.title', text: 'prompt.discard1.text', options: p.hand.map((x) => ({ id: String(x.uid), card: x })) });
        const d = p.hand.find((x) => String(x.uid) === id) || p.hand[0];
        p.discard.push(this.takeFromHand(p, d));
        const got = [];
        for (let k = 0; k < 2; k++) {
          const i = p.discard.findLastIndex((x) => x.kind === 'energy');
          if (i >= 0) got.push(...p.discard.splice(i, 1));
        }
        p.hand.push(...got);
        L('retrieval', { d: C(d), n: got.length });
        break;
      }
      case 'computerSearch': {
        const dropped = [];
        for (let k = 0; k < 2; k++) {
          const id = await this.ask(p, { kind: 'discard', title: 'prompt.discardN.title', text: 'prompt.discardN.text', params: { k: k + 1 }, options: p.hand.map((x) => ({ id: String(x.uid), card: x })) });
          const d = p.hand.find((x) => String(x.uid) === id) || p.hand[0];
          dropped.push(d.name);
          p.discard.push(this.takeFromHand(p, d));
        }
        const id = await this.ask(p, { kind: 'search', title: 'prompt.search.title', text: 'prompt.search.text', options: uniqueByName(p.deck).map((x) => ({ id: String(x.uid), card: x })) });
        const got = p.deck.find((x) => String(x.uid) === id) || p.deck[0];
        p.deck.splice(p.deck.indexOf(got), 1);
        p.hand.push(got);
        shuffle(p.deck);
        L('search', { a: dropped[0], b: dropped[1], got: p.idx === 0 ? C(got) : { $hidden: true } });
        break;
      }
      default:
        await this.playTrainer2(p, o, c, m, act, L);
    }
  }

  async playTrainer2(p, o, c, m, act, L) {
    const hide = (x) => (p.idx === 0 ? C(x) : { $hidden: true }); // what the opponent searched stays hidden from you
    const isPoke = (x) => x.kind === 'pokemon';
    const pokeAi = (x) => (x.stage > 0 && this.allMons(p).some((y) => y.name === x.evolvesFrom) ? 10 : 0) + (x.stage === 0 && p.bench.length < MAX_BENCH ? 4 : 0);
    const discardLoop = async (kind, text) => {
      const out = [];
      for (let k = 0; k < 60 && p.hand.length; k++) {
        const pickd = await this.pickCard(p, kind, p.hand, text, { c: C(c), n: out.length }, `Discard a card from your hand for ${c.name}, or choose nothing to stop.`,
          { none: true, unique: false, ai: (x) => (x.kind === 'energy' && p.hand.filter((y) => y.kind === 'energy').length > 2 ? 1 : -2) });
        if (!pickd) break;
        p.discard.push(this.takeFromHand(p, pickd));
        out.push(pickd);
      }
      return out;
    };
    switch (act.tkind) {
      case 'fullHeal':
        p.active.status = {};
        L('fullHeal', { m: p.active.name });
        break;
      case 'pokemonCenter': {
        let n = 0;
        for (const x of this.allMons(p)) if (x.damage) { n += x.damage; x.damage = 0; p.discard.push(...x.energy.splice(0)); }
        L('pokemonCenter', { n });
        break;
      }
      case 'pokedex': {
        // Rearrange the top cards: choose which is drawn 1st, then 2nd, …
        const pool = p.deck.splice(-Math.min(5, p.deck.length)).reverse();
        const order = [];
        while (pool.length > 1) {
          const x = (await this.pickCard(p, 'pokedex', pool, 'prompt.q.pokedexK', { c: C(c), k: order.length + 1 }, `Choose the card you will draw ${['1st', '2nd', '3rd', '4th'][order.length]}.`, { unique: false, ai: (y) => pokeAi(y) + (y.kind === 'energy' ? 3 : 0) })) || pool[0];
          pool.splice(pool.indexOf(x), 1);
          order.push(x);
        }
        order.push(...pool);
        p.deck.push(...order.reverse()); // the top of the deck is the end of the array
        L('pokedex');
        break;
      }
      case 'pokeBall': {
        if (!(await this.flip('trainer', { c: C(c) }, [{ key: 'coin.o.search', params: {} }, { key: 'coin.o.nothing', params: {} }]))) { L('nothing'); break; }
        const got = await this.pickCard(p, 'search', p.deck.filter(isPoke), 'prompt.q.searchPokemon', { c: C(c) }, 'Choose a Pokémon card from your deck to put into your hand.', { ai: pokeAi });
        if (got) { p.hand.push(this.searchDeck(p, got)); L('got', { got: hide(got) }); }
        break;
      }
      case 'energySearch': {
        const got = await this.pickCard(p, 'search', p.deck.filter((x) => x.kind === 'energy' && !x.special), 'prompt.q.searchEnergy', { c: C(c) }, 'Choose a basic Energy card from your deck to put into your hand.',
          { ai: (x) => this.allMons(p).filter((y) => this.attacksOf(y).some((at) => at.cost.includes(x.energyType))).length });
        if (got) { p.hand.push(this.searchDeck(p, got)); L('got', { got: C(got) }); }
        break;
      }
      case 'gambler': {
        this.shuffleHandIn(p);
        const h = await this.flip('trainer', { c: C(c) }, [{ key: 'coin.o.draw', params: { n: 8 } }, { key: 'coin.o.draw', params: { n: 1 } }]);
        L('drew', { n: this.draw(p, h ? 8 : 1) });
        break;
      }
      case 'pokemonTrader': {
        const give = await this.pickCard(p, 'trade', p.hand.filter(isPoke), 'prompt.q.tradeGive', { c: C(c) }, 'Choose a Pokémon card from your hand to shuffle into your deck.', { ai: (x) => -pokeAi(x) });
        const get = await this.pickCard(p, 'search', p.deck.filter(isPoke), 'prompt.q.searchPokemon', { c: C(c) }, 'Choose a Pokémon card from your deck to take instead.', { ai: pokeAi });
        if (get) p.hand.push(p.deck.splice(p.deck.indexOf(get), 1)[0]);
        if (give) p.deck.push(this.takeFromHand(p, give));
        shuffle(p.deck);
        L('trade', { a: C(give), got: C(get) });
        break;
      }
      case 'bossWay': case 'brockTraining': {
        const ok = act.tkind === 'bossWay' ? (x) => isPoke(x) && x.stage > 0 && x.name.includes('Dark') : (x) => isPoke(x) && x.name.includes('Brock');
        const got = await this.pickCard(p, 'search', p.deck.filter(ok), 'prompt.q.searchPokemon', { c: C(c) }, 'Choose a Pokémon card from your deck to put into your hand.', { ai: pokeAi });
        if (got) { p.hand.push(this.searchDeck(p, got)); L('got', { got: C(got) }); }
        break;
      }
      case 'imposterOak': {
        const d = await this.pickCard(p, 'discard', p.hand, 'prompt.q.discard1', { c: C(c) }, 'Choose 1 card from your hand to discard.', { unique: false, ai: (x) => (x.kind === 'energy' ? 1 : 0) });
        if (d) p.discard.push(this.takeFromHand(p, d));
        this.shuffleHandIn(o);
        this.plog(o, 'log.t.newHand', { n: this.draw(o, 4) });
        L('played');
        break;
      }
      case 'erika': {
        const a = await this.pickNumber(p, 'drawN', Math.min(3, p.deck.length), 'prompt.q.drawUpTo', { c: C(c) }, 'How many cards do you draw (up to 3)?', (n) => (p.hand.length + n > 9 ? -n : n));
        this.plog(p, 'log.t.drewN', { n: this.draw(p, a) });
        const b = await this.pickNumber(o, 'drawN', Math.min(3, o.deck.length), 'prompt.q.oppMayDraw', { c: C(c) }, 'Your opponent played Erika: how many cards do you draw (up to 3)?', (n) => (o.deck.length < 10 ? -n : n));
        this.plog(o, 'log.t.drewN', { n: this.draw(o, b) });
        break;
      }
      case 'ltSurge': {
        const b = await this.pickCard(p, 'setup-active', p.hand.filter(isBasic), 'prompt.q.newActive', { c: C(c) }, 'Choose a Basic Pokémon from your hand to become your new Active Pokémon.', { unique: false, ai: (x) => x.hp });
        const old = p.active;
        old.status = {}; old.effects = {};
        p.bench.push(old);
        p.active = new Mon(this.takeFromHand(p, b), this.turn);
        L('ltSurge', { m: b.name, old: old.name });
        break;
      }
      case 'misty': {
        for (let k = 0; k < 2; k++) {
          const d = await this.pickCard(p, 'discard', p.hand, 'prompt.q.discardK', { c: C(c), k: k + 1, n: 2 }, 'Choose a card from your hand to discard.', { unique: false, ai: (x) => (x.kind === 'trainer' ? 1 : 0) });
          if (d) p.discard.push(this.takeFromHand(p, d));
        }
        p.flags.misty = true;
        L('misty', { m: p.active.name });
        break;
      }
      case 'brock':
        for (const x of this.allMons(p)) await this.heal(x, 10);
        L('played');
        break;
      case 'erikasPerfume': {
        this.plog(p, 'log.t.sawHand', { list: o.hand.map((x) => x.name).join(', ') || '—', c: C(c) });
        for (let k = 0; k < MAX_BENCH && o.bench.length < MAX_BENCH; k++) {
          const b = await this.pickCard(p, 'perfume', o.hand.filter(isBasic), 'prompt.q.perfume', { c: C(c) }, "Choose a Basic Pokémon from the opponent's hand to put onto their Bench, or nothing to stop.", { none: true, unique: false, ai: (x) => 60 - x.hp });
          if (!b) break;
          o.bench.push(new Mon(this.takeFromHand(o, b), this.turn));
          this.plog(o, 'log.bench', { c: C(b) });
        }
        break;
      }
      case 'mistysWrath': {
        const top = p.deck.splice(-7);
        for (let k = 0; k < 2 && top.length; k++) {
          const pickd = await this.pickCard(p, 'search', top, 'prompt.q.keepK', { c: C(c), k: k + 1, n: 2 }, 'Choose a card to put into your hand; the rest are discarded.', { unique: false, ai: pokeAi });
          const x = pickd || top[0];
          top.splice(top.indexOf(x), 1);
          p.hand.push(x);
        }
        p.discard.push(...top);
        L('wrath', { n: top.length });
        break;
      }
      case 'secretMission': {
        this.plog(p, 'log.t.sawHand', { list: o.hand.map((x) => x.name).join(', ') || '—', c: C(c) });
        const out = await discardLoop('discard', 'prompt.q.discardMore');
        L('drew', { n: this.draw(p, out.length) });
        break;
      }
      case 'blainesGamble': {
        const out = await discardLoop('discard', 'prompt.q.discardMore');
        const h = await this.flip('trainer', { c: C(c) }, [{ key: 'coin.o.draw', params: { n: out.length * 2 } }, { key: 'coin.o.nothing', params: {} }]);
        L('drew', { n: h ? this.draw(p, out.length * 2) : 0 });
        break;
      }
      case 'sabrinasGaze':
        for (const q of this.players) { const n = q.hand.length; this.shuffleHandIn(q); this.plog(q, 'log.t.newHand', { n: this.draw(q, n) }); }
        break;
      case 'blaine':
        p.flags.blaine = true;
        L('played');
        break;
      case 'giovanni':
        p.flags.giovanni = m.id;
        L('giovanni', { m: m.name });
        break;
      case 'koga':
        p.flags.koga = true;
        L('played');
        break;
      case 'sabrina': {
        const sab = this.allMons(p).filter((x) => x.name.includes('Sabrina'));
        const from = await this.pickMon(p, 'sabrinaFrom', sab.filter((x) => x.energy.length), 'prompt.q.moveFrom', { c: C(c) }, 'Move all Energy away from which Pokémon?', (x) => -energyProgressEn(x));
        const to = await this.pickMon(p, 'sabrinaTo', sab.filter((x) => x !== from), 'prompt.q.moveTo', { c: C(c) }, 'Move all that Energy onto which Pokémon?', (x) => (x === p.active ? 5 : 0));
        if (from && to) { const n = from.energy.length; to.energy.push(...from.energy.splice(0)); L('moved', { a: from.name, b: to.name, n }); }
        break;
      }
      case 'maxRevive': {
        for (let k = 0; k < 2; k++) {
          const d = await this.pickCard(p, 'discard', p.hand.filter((x) => x.kind === 'energy'), 'prompt.q.discardEnergy', { c: C(c), k: k + 1, n: 2 }, 'Choose an Energy card from your hand to discard.', { unique: false });
          if (d) p.discard.push(this.takeFromHand(p, d));
        }
        const b = await this.pickCard(p, 'revive', p.discard.filter(isBasic), 'prompt.q.revive', { c: C(c) }, 'Choose a Basic Pokémon from your discard pile to put onto your Bench.', { ai: (x) => x.hp });
        if (b) { p.bench.push(new Mon(this.pullFromDiscard(p, b), this.turn)); L('revive', { m: b.name }); }
        break;
      }
      case 'psychicControl': {
        if (!(await this.flip('trainer', { c: C(c) }, [{ key: 'coin.o.copy', params: {} }, { key: 'coin.o.nothing', params: {} }]))) { L('nothing'); break; }
        // Use the opponent's discarded Trainer as if it were in your hand: list what it could do right now.
        const acts = [];
        for (const tc of uniqueByName(o.discard.filter((x) => x.kind === 'trainer' && COPYABLE.has(x.tkind)))) {
          const copy = { ...tc };
          p.hand.push(copy);
          const seen = new Set();
          this.trainerActions(p, o, copy, (k) => (seen.has(k) ? false : (seen.add(k), true)), (kind, label, detail, extra) => acts.push({ kind, label, detail, ...extra }), (key, params = {}) => ({ key: 'act.' + key, params }), (x) => x.name);
          p.hand.pop();
        }
        if (!acts.length) { L('nothing'); break; }
        const id = await this.pick(p, 'copyTrainer', 'prompt.gen.title', 'prompt.q.copyTrainer', acts.map((a, i) => ({ id: String(i), label: a.label, en: a.detail })), { params: { c: C(c) }, en: "Choose which of the opponent's discarded Trainer cards to use." });
        const chosen = acts[Number(id)] || acts[0];
        L('copied', { c2: C(chosen.card) });
        await this.playTrainer(p, { ...chosen, card: chosen.card });
        break;
      }
      case 'fervor': {
        const top = p.deck.splice(-3);
        const fire = top.filter((x) => x.kind === 'energy' && x.energyType === 'Fire' && !x.special);
        p.hand.push(...fire);
        p.discard.push(...top.filter((x) => !fire.includes(x)));
        L('fervor', { list: top.map((x) => x.name).join(', '), n: fire.length });
        break;
      }
      case 'warpPoint': {
        if (o.bench.length) {
          const t = await this.pickMon(o, 'whirlwind', o.bench, 'prompt.q.warpOpp', { c: C(c) }, 'Your opponent played Warp Point: choose which of your Benched Pokémon becomes Active.', (x) => x.hpLeft / 10);
          this.swapActive(o, t);
          this.plog(o, 'log.t.switched', { m: o.active.name });
        }
        if (p.bench.length) {
          const t = await this.pickMon(p, 'promote', p.bench, 'prompt.q.warpYou', { c: C(c) }, 'Choose which of your Benched Pokémon becomes Active.', (x) => x.hpLeft / 10 + x.energy.length * 3);
          this.swapActive(p, t);
          this.plog(p, 'log.t.switched', { m: p.active.name });
        }
        break;
      }
      case 'stadium': {
        if (this.stadium) { this.players[this.stadium.owner].discard.push(this.stadium.card); this.log('log.stadiumOff', { c: C(this.stadium.card) }); }
        this.stadium = { card: this.pullFromDiscard(p, c), owner: p.idx };
        L('stadium');
        this.learn('stadium');
        break;
      }
    }
  }

  // ---------------- Pokémon Powers and Stadium actions ----------------
  async usePower(p, act) {
    const o = this.opp(p), m = act.target;
    p.flags.powers[m.id] = true;
    this.plog(p, 'log.power', { m: m.name, pw: m.card.power.name });
    this.learn('power');
    const O = (key, params = {}) => ({ key: 'coin.o.' + key, params });
    switch (act.pkind) {
      case 'pollenStench': case 'longDistanceHypnosis': {
        const s = act.pkind === 'pollenStench' ? 'confused' : 'asleep';
        const h = await this.flip('power', { pw: m.card.power.name }, [O('status', { s: ST(s) }), O('selfStatus', { s: ST(s) })]);
        this.applyStatus(h ? o.active : p.active, s);
        break;
      }
      case 'matterExchange': {
        const d = await this.pickCard(p, 'discard', p.hand, 'prompt.q.discard1', { c: m.card.power.name }, 'Choose 1 card from your hand to discard (you then draw 1).', { unique: false, ai: (x) => (x.kind === 'energy' ? 0 : x.kind === 'trainer' ? 1 : -1) });
        if (d) p.discard.push(this.takeFromHand(p, d));
        this.plog(p, 'log.t.drewN', { n: this.draw(p, 1) });
        break;
      }
      case 'energyCharge': {
        const src = await this.pickMon(p, 'chargeFrom', this.allMons(p).filter((x) => x !== m && x.energy.some((en) => en.energyType === 'Lightning' && !en.special)), 'prompt.q.moveFrom', { c: m.card.power.name }, 'Take 1 Lightning Energy from which Pokémon?', (x) => -energyProgressEn(x));
        const i = src.energy.findIndex((en) => en.energyType === 'Lightning' && !en.special);
        m.energy.push(...src.energy.splice(i, 1));
        this.log('log.energyMoved', { a: src.name, b: m.name, t: { $type: 'Lightning' } });
        p.flags.powers[m.id] = false; // as often as you like
        break;
      }
      case 'emerge': {
        if (await this.flip('power', { pw: m.card.power.name }, [O('evolve'), O('nothing')])) {
          const c = p.deck.find((x) => x.name === "Koga's Beedrill");
          if (c) {
            await this.hooks.onEvolve?.({ p: p.idx, mon: m.id, from: m.card, to: c });
            const from = m.name;
            m.stack.push(this.searchDeck(p, c));
            m.status = {}; m.effects = {};
            this.plog(p, 'log.evolve', { from, to: m.name });
          }
        }
        break;
      }
    }
  }

  async useStadium(p, act) {
    const m = act.target, s = this.stadium.card;
    p.flags.stadiumUsed = true;
    switch (act.stadium) {
      case 'celadon':
        p.discard.push(m.energy.pop());
        m.status = {};
        this.plog(p, 'log.s.celadon', { m: m.name, c: C(s) });
        break;
      case 'fuchsia':
        if (await this.flip('trainer', { c: C(s) }, [{ key: 'coin.o.shuffleIn', params: { m: m.name } }, { key: 'coin.o.nothing', params: {} }])) {
          p.deck.push(...this.removeFromPlay(p, m));
          shuffle(p.deck);
          this.plog(p, 'log.s.fuchsia', { m: m.name, c: C(s) });
          await this.refillActive();
        }
        break;
      case 'saffron': {
        const i = m.energy.findIndex((en) => !en.special);
        const en = m.energy.splice(i, 1)[0];
        p.hand.push(en);
        this.plog(p, 'log.s.saffron', { m: m.name, e: C(en), c: C(s) });
        break;
      }
    }
  }

  pullFromDiscard(p, card) {
    p.discard.splice(p.discard.indexOf(card), 1);
    return card;
  }

  swapActive(p, benched) {
    const old = p.active;
    old.status = {};
    old.effects = keptEffects(old.effects); // effects of attacks end; an Ability's (Stance) stays
    p.bench[p.bench.indexOf(benched)] = old;
    p.active = benched;
  }

  applyStatus(m, s) {
    if (this.modern && this.statusImmune(m)) { this.log('log.immune', { m: m.name }, 'status'); return; }
    if (s === 'asleep' || s === 'paralyzed' || s === 'confused') { delete m.status.asleep; delete m.status.paralyzed; delete m.status.confused; }
    m.status[s] = s === 'poisoned' && typeof m.status.poisoned === 'number' ? m.status.poisoned : true; // Toxic / Severe Poison keep their counters
    // Remember it for Mirror Move (the victim can copy what was done to it last turn).
    const lh = m.effects.lastHit;
    if (lh && lh.expires === this.turn + 1) lh.statuses.push(s);
    else m.effects.lastHit = { expires: this.turn + 1, dmg: 0, statuses: [s] };
    this.log('log.status', { m: m.name, s: ST(s) }, 'status');
    this.learn('status.' + s);
  }

  // The player picks which of these Energy cards (asked only when they differ). For their own Pokémon the AI keeps the
  // Energy its attacks need; for the opponent's it takes Special Energy first.
  async chooseEnergy(p, m, pool, text, en) {
    if (!pool.length) return null;
    if (uniqueByName(pool).length === 1) return pool.at(-1);
    const mine = this.ownerOf(m) === p;
    const need = new Set((m.card.attacks || []).flatMap((x) => x.cost).filter((t) => t !== 'Colorless'));
    const ai = (x) => (mine ? (need.has(x.energyType) ? 0 : 2) - (x.special ? 1 : 0) : (x.special ? 3 : 1) + (need.has(x.energyType) ? 1 : 0));
    return (await this.pickCard(p, 'discard', pool, text, { m: m.name }, en, { ai })) || pool.at(-1);
  }

  // "Discard N [type] Energy from this Pokémon" (no type: any Energy; the player chooses which when they differ).
  async discardEnergyOfType(p, m, type, n, strict = false) {
    for (let k = 0; k < n && m.energy.length; k++) {
      const of = m.energy.filter((e) => (strict && type ? isType(e.energyType, type) : e.energyType === type));
      if (strict && type && !of.length) break; // a copied attack: only the Energy it names
      const en = await this.chooseEnergy(p, m, of.length ? of : m.energy, 'prompt.q.discardWhichEnergy', 'Which Energy do you discard from this Pokémon?');
      p.discard.push(...m.energy.splice(m.energy.indexOf(en), 1));
    }
  }

  // Flip a coin. `outcomes` = [what heads means, what tails means], shown by the UI while the coin spins.
  async flip(why, params = {}, outcomes = []) {
    const h = coin();
    await this.hooks.onCoin?.({ h, why, params, heads: outcomes[0], tails: outcomes[1] });
    this.log('log.coin', { h: COIN(h) }, 'coin');
    this.learn('coin');
    return h;
  }

  // Damage about to be placed on `to` (the UI animates it before the dice change).
  async hit(from, to, n, notes = []) {
    await this.hooks.onHit?.({ from: from?.id ?? null, to: to.id, n, notes });
  }

  async attack(p, i) {
    const a = p.active, d = this.opp(p).active, atk = this.attacksOf(a)[i];
    this.plog(p, 'log.attack', { m: a.name, atk: atk.name });
    p.until.lastAtk = { turn: this.turn, id: a.card.id, name: atk.name, gx: !!atk.fx.gx, atk: { ...atk } }; // Copycat (the attack itself: a TM's isn't on the card)
    // Both Active Pokémon step into the arena for the whole attack, coin flips included.
    await this.hooks.onAttack?.({ p: p.idx, from: a.id, to: d.id, atk: atk.name, type: a.card.type });
    this.attacking = a; // spread() knows this damage comes from an attack (shields, "takes less damage from attacks")
    try {
      await this.resolveAttack(p, atk);
    } finally {
      this.attacking = null;
      await this.hooks.onAttackEnd?.();
    }
    // Swallow Dive: "if this Pokémon used Agility during your last turn" (recorded after this attack's own damage).
    if (this.allMons(p).includes(a)) a.effects.lastAtk = { atk: atk.name, expires: this.turn + 2 };
    if (this.modern) this.checkEnergyRules();
    this.update();
    this.koBy = a;
    await this.handleKOs(p);
    this.koBy = null;
    await this.refillActive();
  }

  // Damage to several Pokémon at once (Benched damage never applies Weakness or Resistance).
  // Bench Guard: a Benched Brock's Rhydon takes 10 of the damage done to each of its owner's other Benched Pokémon.
  async spread(src, list, { counters = false } = {}) {
    const plan = new Map();
    const add = (m, n) => plan.set(m, (plan.get(m) || 0) + n);
    for (let [m, n] of list) {
      const q = this.ownerOf(m);
      // From the opponent's attack: Agility / Detect / Stance (and Luminous Barrier) stop its damage and damage counters;
      // a Benched Pokémon still gets its "takes less damage from attacks" (the Active already got it through finalDamage).
      const fromAttack = !!src && this.attacking === src && !!q && this.ownerOf(src) !== q;
      if (fromAttack && (m.effects.shield?.kind === 'all' || (this.modern && this.smBarrier(src, m)))) { this.log('log.barrier', { m: m.name }, 'status'); continue; }
      if (fromAttack && this.modern && !counters && n > 0 && q.bench.includes(m)) n = this.modernDefense(src, m, n, []);
      if (this.modern && !counters && m.card.tera && q?.bench.includes(m)) { this.log('log.tera', { m: m.name }, 'status'); continue; }
      if (this.modern && !counters && src && q && this.ownerOf(src) !== q && !(await this.swshBenchShield(q, m, src, n))) continue; // Wave Veil, Infiltrator
      const guard = !counters && q && q.bench.includes(m) && n >= 10 &&
        q.bench.find((r) => r !== m && r.card.powerKind === 'benchGuard' && this.powerOn(r));
      // Bench Guard ("you may"): its owner decides; worth it unless it would Knock Out the Rhydon.
      const left = guard ? guard.hpLeft - (plan.get(guard) || 0) : 0;
      if (guard && (await this.yesNo(q, 'prompt.q.benchGuard', { c: guard.card.power.name, m: m.name }, `Bench Guard: should ${guard.name} take 10 of the ${n} damage meant for ${m.name}?`, left > 10 ? 2 : -1))) {
        add(m, n - 10); add(guard, 10); this.log('log.benchGuard', { m: guard.name, b: m.name }, 'status');
      } else add(m, n);
    }
    const hits = [...plan].filter(([, n]) => n > 0);
    await Promise.all(hits.map(([m, n]) => this.hit(src, m, n)));
    for (const [m, n] of hits) {
      m.damage += n;
      if (!counters && this.attacking) m.hitTurn = this.turn; // damage from an attack (Wishful Baton, Energy Grounding)
    }
  }

  // Pokémon Powers that react to the Active Pokémon taking damage. Returns true if it fled (Flee).
  async onDamaged(q, m, attacker) {
    const O = (key, params = {}) => ({ key: 'coin.o.' + key, params });
    if (q.active !== m || m.damage >= m.maxHp) return false;
    if (m.card.powerKind === 'pollenDefense' && this.powerOn(m, { always: true }) && attacker && this.ownerOf(attacker)?.active === attacker) {
      this.log('log.power.auto', { m: m.name, pw: m.card.power.name }, 'status');
      if (await this.flip('power', { pw: m.card.power.name }, [O('status', { s: ST('confused') }), O('nothing')])) this.applyStatus(attacker, 'confused');
    }
    if (m.card.powerKind === 'flee' && this.powerOn(m) && q.bench.length) {
      const opts = [{ id: 'stay', label: { key: 'opt.stay' }, en: 'Stay Active.', ai: m.hpLeft > 40 ? 1 : -1 }, ...q.bench.map((b) => ({ id: String(b.id), mon: b, ai: b.hpLeft / 20 }))];
      const id = await this.pick(q, 'flee', 'prompt.gen.title', 'prompt.q.flee', opts, { params: { c: m.card.power.name }, en: 'Flee: switch your damaged Active Pokémon with a Benched one so the rest of the attack misses it?' });
      const b = q.bench.find((x) => String(x.id) === id);
      if (b) { this.swapActive(q, b); this.plog(q, 'log.flee', { m: m.name, to: b.name }); return true; }
    }
    return false;
  }

  async resolveAttack(p, atk) {
    const o = this.opp(p), a = p.active;
    let fx = atk.fx;
    const O = (key, params = {}) => ({ key: 'coin.o.' + key, params });
    const flip = (heads, tails) => this.flip('attack', { atk: atk.name }, [heads, tails]);
    const fail = async () => { await this.hit(a, o.active, 0, ['miss']); this.log('log.failed', { atk: atk.name }); };

    if (a.status.confused) {
      this.learn('status.confused');
      if (!(await this.flip('confused', { m: a.name }, [O('attackGoes'), O('confusedHit')]))) {
        await this.hit(null, a, 30);
        a.damage += 30;
        this.log('log.confusedHit', { m: a.name }, 'dmg');
        return;
      }
    }
    if (a.effects.sandAttack) {
      if (!(await this.flip('sand', { m: a.name }, [O('attackGoes'), O('miss')]))) { await this.hit(a, o.active, 0, ['miss']); this.log('log.sandMiss', { m: a.name }, 'status'); return; }
    }
    if (fx.gx) { p.gxUsed = true; this.learn('gx'); }
    if (fx.flipMetronome && !(await flip(O('copy'), O('miss')))) return fail();
    // Metronome: copy one of the Defending Pokémon's attacks, without its Energy cost or other requirements.
    // Cross Fusion Strike: the same with the attacks of your own Benched Fusion Strike Pokémon.
    if (fx.metronome || fx.flipMetronome || fx.copyBenchTag || fx.copyLastAttack) {
      const last = o.until.lastAtk; // Copycat: the attack the opponent's Pokémon used during their last turn (not a GX attack)
      const copied = last && last.turn === this.turn - 1 && !last.gx ? (last.atk ? [last.atk] : CARDS[last.id]?.attacks.filter((x) => x.name === last.name) || []) : [];
      const list = (fx.copyLastAttack ? copied : fx.copyBenchTag ? p.bench.filter((x) => x.card.tags?.includes(fx.copyBenchTag)).flatMap((x) => this.attacksOf(x)) : this.attacksOf(o.active))
        .filter((x) => !x.fx.metronome && !x.fx.flipMetronome && !x.fx.copyBenchTag && !x.fx.copyLastAttack && !x.fx.gx);
      if (!list.length) return fail();
      const id = await this.pick(p, 'metronome', 'prompt.gen.title', 'prompt.q.metronome',
        list.map((x, k) => ({ id: String(k), label: { key: 'opt.attack', params: { name: x.name, d: x.damage || '—' } }, en: `${x.name}: ${x.damage || 'no'} damage. ${x.text}`, ai: x.base })),
        { params: { c: atk.name }, en: "Choose which of the Defending Pokémon's attacks Metronome copies." });
      const src = list[Number(id)] || list[0];
      this.log('log.metronome', { m: a.name, atk: src.name });
      const { discard, needsType, needsCounters, needsEqualEnergy, ...rest } = src.fx;
      // Base Set Metronome ignores the copied attack's discards; the modern copies (Mini-Metronome, Copycat, Cross Fusion
      // Strike) use the whole attack, so this Pokémon discards that Energy if it can.
      if (discard && !fx.metronome) rest.discard = { ...discard, strict: true };
      atk = { ...src, fx: rest };
      fx = rest;
    }
    if (fx.needsBenchName && !p.bench.some((x) => x.name === fx.needsBenchName)) return fail();
    if (fx.discard) await this.discardEnergyOfType(p, a, fx.discard.type, fx.discard.n, fx.discard.strict);
    if (fx.oncePerPlay) a.used[atk.name] = true;
    if (fx.cooldown) a.effects.cooldown = { atk: atk.name, expires: this.turn + 2 };
    if (fx.flipFail && !(await flip(atk.base ? O('plus', { n: atk.base }) : O('attackGoes'), O('miss')))) return fail();

    if (fx.lure && o.bench.length) {
      const t = await this.pickMon(p, 'lure', o.bench, 'prompt.lure.text', {}, "Choose one of the opponent's Benched Pokémon to pull into the Active Spot.", (x) => -x.hpLeft);
      this.swapActive(o, t);
      this.log('log.lure', { m: t.name });
    }

    const d = o.active;
    let base = this.baseRange(a, d, atk)[0];
    if (fx.mirrorMove && !a.effects.lastHit) return fail();
    if (fx.flipAll) {
      for (let k = 0; k < fx.flipAll; k++)
        if (!(await this.flip('multi', { atk: atk.name, i: k + 1, n: fx.flipAll, so: k }, [O('keepGoing'), O('miss')]))) return fail();
      base = atk.base;
    }
    let heads1 = null; // result of the single "Flip a coin" for bonus damage
    if (fx.flipBonus) {
      heads1 = await flip(O('plus', { n: fx.flipBonus }), fx.tailsSelf ? O('self', { m: a.name, n: fx.tailsSelf }) : O('nothing'));
      if (heads1) base += fx.flipBonus;
    }
    if (fx.bothHeadsBonus) {
      let heads = 0;
      for (let k = 0; k < 2; k++) if (await this.flip('multi', { atk: atk.name, i: k + 1, n: 2, so: heads }, [O('bothHeads', { n: fx.bothHeadsBonus }), O('nothing')])) heads++;
      if (heads === 2) base += fx.bothHeadsBonus;
    }
    if (fx.waterPunch) {
      const n = this.countType(a, 'Water');
      let heads = 0;
      for (let k = 0; k < n; k++) if (await this.flip('multi', { atk: atk.name, i: k + 1, n, so: heads }, [O('plus', { n: fx.waterPunch }), O('zero')])) heads++;
      base += fx.waterPunch * heads;
    }
    const multi = fx.flipMulti || (fx.flipPerEnergy ? a.energyTypes.length : 0);
    if (multi) {
      let heads = 0;
      for (let k = 0; k < multi; k++)
        if (await this.flip('multi', { atk: atk.name, i: k + 1, n: multi, so: heads }, [O('plus', { n: atk.base }), O('zero')])) heads++;
      base = atk.base * heads;
      this.multiHeads = heads; // Triple Heads: all heads also protects the attacker
    } else if (fx.flipUntilTails) {
      let heads = 0;
      while (heads < 20 && (await this.flip('untilTails', { atk: atk.name, so: heads }, [O('plus', { n: atk.base }), O('stop')]))) heads++;
      base = atk.base * heads;
    } else if (fx.flipFail) base = this.baseRange(a, d, atk)[1];
    if (this.modern) base += await this.modernPreDamage(p, a, atk, fx);
    let risky = false;
    if (fx.riskyTails && !(await flip(O('attackGoes'), O('self', { m: a.name, n: fx.riskyTails })))) { base = 0; risky = true; }
    // Vermilion City Gym: Lt. Surge's Pokémon flip for 10 more damage (heads) or 10 damage to themselves (tails).
    let surge = 0;
    if (this.stadiumIs('vermilion') && a.name.includes('Lt. Surge') && base > 0 &&
      (await this.yesNo(p, 'prompt.q.vermilion', { c: C(this.stadium.card) }, 'Vermilion City Gym: flip a coin? Heads: +10 damage; tails: 10 damage to your attacker.', a.hpLeft > 30 ? 1 : -1)))
      surge = (await this.flip('stadium', { c: C(this.stadium.card) }, [O('plus', { n: 10 }), O('self', { m: a.name, n: 10 })])) ? 10 : -10;

    let dealt = 0, fled = false;
    // Agility / Detect / Luminous Barrier: no damage or effects. Damage that "isn't affected by any effects on your
    // opponent's Active Pokémon" (G-Max One Blow, Max Miracle, modern Swift) still goes through, the effects don't.
    const ignoreDef = fx.ignoreDefEffects || (this.modern && fx.noWR);
    const shielded = d.effects.shield?.kind === 'all' || (this.modern && this.smBarrier(a, d));
    const barrier = shielded && !ignoreDef;
    if (barrier) {
      await this.hit(a, d, 0, ['barrier']);
      this.log('log.barrier', { m: d.name }, 'status');
    } else {
      if (base > 0) {
        let { dmg, notes } = fx.mirrorMove ? { dmg: base, notes: [] } : this.finalDamage(a, d, base, { noWR: fx.noWR, noWROnly: fx.noWROnly, noRes: fx.noRes, ignoreDef: fx.ignoreDefEffects, noWeakness: fx.noWeakness });
        if (surge > 0 && dmg > 0) dmg += 10;
        if (this.modern && dmg > 0 && !ignoreDef) dmg = await this.swshBeforeDamage(a, d, dmg, notes); // Infiltrator
        await this.hit(a, d, dmg, notes);
        d.damage += dmg;
        dealt = dmg;
        if (dmg > 0) { d.effects.lastHit = { expires: this.turn + 1, dmg, statuses: [] }; d.hitTurn = this.turn; }
        this.log('log.damage', { m: d.name, n: dmg, notes: notes.map((n) => ({ $note: n })) }, 'dmg');
        if (dmg > 0) this.learn('dice');
        if (notes.includes('weakness')) this.learn('weakness', { m: d.name, t: { $type: a.card.type } });
        if (notes.includes('resistance')) this.learn('resistance');
        if (notes.includes('shield') || notes.includes('harden')) this.learn('prevent');
        // Mirror Shell strikes back with the same damage.
        if (dmg > 0 && d.effects.mirrorShell) { await this.hit(d, a, dmg); a.damage += dmg; this.log('log.mirrorShell', { m: d.name, n: dmg }, 'dmg'); }
        if (dmg > 0 && p.flags.koga && a.name.includes('Koga')) this.applyStatus(d, 'poisoned');
        if (dmg > 0 && this.modern) await this.megaOnDamaged(o, d, a);
        if (dmg > 0) fled = await this.onDamaged(o, d, a);
      }
      if (!fled && !shielded && !this.effectsBlocked(d)) await this.defenderEffects(p, o, a, d, atk, fx, heads1);
    }
    if (fx.headache) { o.until.noTrainers = this.turn + 1; this.log('log.headache', { P: PL(o) }, 'status'); }

    // Caturday: "Draw a card. If you do, this Pokémon is now Asleep" (the draw comes in selfEffects).
    if (!(fx.draw && !p.deck.length)) for (const s of [].concat(fx.selfStatus || [])) this.applyStatus(a, s);
    if (fx.drainHalf && dealt > 0 && a.damage) await this.heal(a, Math.ceil(dealt / 20) * 10);
    if (fx.drainAll && dealt > 0) await this.heal(a, dealt);
    await this.splashEffects(p, o, a, atk, fx, heads1);
    if (fx.whirlwind && o.bench.length && o.active === d && d.damage < d.maxHp) {
      // The opponent chooses which Benched Pokémon comes in.
      const t = await this.pickMon(o, 'whirlwind', o.bench, 'prompt.whirlwind.text', {}, 'Your Active Pokémon is blown away: choose which Benched Pokémon becomes Active.', (x) => x.hpLeft / 10);
      this.swapActive(o, t);
      this.log('log.whirlwind', { m: d.name, to: t.name });
    }
    if (fx.gustAfter && o.bench.length && (!fx.gustAfter.flip || (await flip(O('gust'), O('nothing'))))) {
      const t = await this.pickMon(p, 'lure', o.bench, 'prompt.lure.text', {}, "Choose one of the opponent's Benched Pokémon to switch into the Active Spot.", (x) => -x.hpLeft);
      this.swapActive(o, t);
      this.log('log.lure', { m: t.name });
      if (fx.gustAfter.status) this.applyStatus(t, fx.gustAfter.status);
    }
    await this.selfEffects(p, o, a, atk, fx, { dealt, heads1, risky, surge });
    if (this.modern) await this.modernAfter(p, o, a, d, atk, fx, dealt);
    if (dealt > 0 && d.effects.destinyBond && d.damage >= d.maxHp) {
      await this.hit(d, a, a.hpLeft);
      a.damage = Math.max(a.damage, a.maxHp);
      this.log('log.destinyBondHit', { m: a.name }, 'ko');
    }
    await this.leaveEffects(p, a, fx);
    this.update();
  }

  // Effects on the Defending Pokémon (skipped if it fled).
  async defenderEffects(p, o, a, d, atk, fx, heads1) {
    const O = (key, params = {}) => ({ key: 'coin.o.' + key, params });
    const flip = (heads, tails) => this.flip('attack', { atk: atk.name }, [heads, tails]);
    const statuses = (s) => [].concat(s || []);
    const stOpt = (s) => O('status', { s: ST(statuses(s)[0]), s2: statuses(s)[1] ? ST(statuses(s)[1]) : null });
    for (const s of statuses(fx.status)) this.applyStatus(d, s);
    if (fx.flipStatus && (await flip(stOpt(fx.flipStatus), O('nothing')))) {
      for (const s of statuses(fx.flipStatus)) this.applyStatus(d, s);
      if (fx.toxic) { d.status.poisoned = 2; this.log('log.toxic', { m: d.name }, 'status'); }
    }
    if (heads1 && fx.headsStatus) this.applyStatus(d, fx.headsStatus);
    if (heads1 === false && fx.tailsStatus) this.applyStatus(d, fx.tailsStatus); // Headlock
    if (fx.flipStatusEither) {
      const [hs, ts] = fx.flipStatusEither;
      this.applyStatus(d, (await flip(O('status', { s: ST(hs) }), O('status', { s: ST(ts) }))) ? hs : ts);
    }
    if (fx.flipStatusChoice && (await flip(O('statusChoice'), O('nothing')))) {
      const list = ['asleep', 'confused', 'paralyzed', 'poisoned'];
      const id = await this.pick(p, 'status', 'prompt.gen.title', 'prompt.q.status', list.map((s) => ({ id: s, label: { key: 'st.' + s }, en: s, ai: { paralyzed: 4, asleep: 3, confused: 2, poisoned: 1 }[s] })),
        { params: { c: atk.name }, en: 'Choose which Special Condition the Defending Pokémon gets.' });
      this.applyStatus(d, list.includes(id) ? id : 'paralyzed');
    }
    if (fx.bothHeadsStatus) {
      let heads = 0;
      for (let k = 0; k < 2; k++) if (await this.flip('multi', { atk: atk.name, i: k + 1, n: 2, so: heads }, [stOpt(fx.bothHeadsStatus), O('nothing')])) heads++;
      if (heads === 2) for (const s of fx.bothHeadsStatus) this.applyStatus(d, s);
    }
    if (fx.mirrorMove) for (const st of a.effects.lastHit.statuses) this.applyStatus(d, st);
    if (fx.sandAttack) d.effects.sandAttack = { expires: this.turn + 1 };
    const dropEnergy = async () => { // the attacker chooses which Energy
      const en = await this.chooseEnergy(p, d, d.energy, 'prompt.q.removeWhichEnergy', "Which of the opponent's Energy do you discard?");
      o.discard.push(...d.energy.splice(d.energy.indexOf(en), 1));
      this.log('log.energyRemoved', { m: d.name, c: C(en) });
    };
    if (fx.flipRemoveEnergy && d.energy.length && (await flip(O('removeEnergy'), O('nothing')))) await dropEnergy();
    if (fx.removeEnergy && d.energy.length) await dropEnergy();
    if (fx.flipNoAttack && (await flip(O('noAttack'), O('nothing')))) { d.effects.noAttack = { target: a.id, expires: this.turn + 1 }; this.log('log.noAttack', { m: d.name, a: a.name }, 'status'); }
    if (fx.noRetreat || (fx.flipNoRetreat && (await flip(O('noRetreat'), O('nothing'))))) { d.effects.noRetreat = { expires: this.turn + 1 }; this.log('log.noRetreat', { m: d.name }, 'status'); }
    if (fx.flipNoEnergy && (await flip(O('noEnergy'), O('nothing')))) { d.effects.noEnergy = { expires: this.turn + 1 }; this.log('log.noEnergy', { m: d.name }, 'status'); }
    if (fx.amnesia) {
      const list = d.card.attacks;
      const id = await this.pick(p, 'amnesia', 'prompt.gen.title', 'prompt.q.amnesia',
        list.map((x, k) => ({ id: String(k), label: { key: 'opt.attack', params: { name: x.name, d: x.damage || '—' } }, en: `${x.name}: ${x.damage || 'no'} damage, cost ${x.cost.join('+')}. ${x.text}`, ai: x.base + (canPay(d.payTypes, x.cost) ? 30 : 0) })),
        { params: { c: atk.name }, en: "Choose which of the Defending Pokémon's attacks it can't use next turn." });
      const x = list[Number(id)] || list[0];
      d.effects.amnesia = { atk: x.name, expires: this.turn + 1 };
      this.log('log.amnesia', { m: d.name, atk: x.name }, 'status');
    }
    if (fx.lifeDrain && (await flip(O('lifeDrain'), O('nothing')))) {
      const n = Math.max(0, d.maxHp - 10 - d.damage);
      if (n) { await this.hit(a, d, n); d.damage += n; this.log('log.lifeDrain', { m: d.name }, 'dmg'); }
    }
  }

  // Damage to other Pokémon (Benched, or chosen ones).
  async splashEffects(p, o, a, atk, fx, heads1) {
    const O = (key, params = {}) => ({ key: 'coin.o.' + key, params });
    const flip = (heads, tails) => this.flip('attack', { atk: atk.name }, [heads, tails]);
    const names = (l) => l.map((x) => x.name).join(', ');
    // Multishot Lightning only hits Benched Pokémon that already have damage counters.
    const snipePool = fx.benchSnipe?.damagedOnly ? o.bench.filter((x) => x.damage) : o.bench;
    if (fx.benchSnipe && snipePool.length) {
      const go = !fx.benchSnipe.flip || (await flip(O('benchHit', { n: fx.benchSnipe.n }), O('nothing')));
      if (go) {
        let targets;
        if (fx.benchSnipe.count >= snipePool.length) targets = [...snipePool];
        else if (fx.benchSnipe.count === 1) targets = [await this.pickMon(p, 'snipe', snipePool, 'prompt.q.snipe', { c: atk.name, n: fx.benchSnipe.n }, `Choose one of the opponent's Benched Pokémon to take ${fx.benchSnipe.n} damage.`, (x) => (x.hpLeft <= fx.benchSnipe.n ? 50 : 0) - x.hpLeft / 10)];
        else { // the attacker chooses each target (the AI aims at those closest to being Knocked Out)
          const pool = [...snipePool];
          targets = [];
          for (let k = 0; k < fx.benchSnipe.count; k++) {
            const t = await this.pickMon(p, 'snipe', pool, 'prompt.q.snipe', { c: atk.name, n: fx.benchSnipe.n }, `Choose one of the opponent's Benched Pokémon to take ${fx.benchSnipe.n} damage (${k + 1} of ${fx.benchSnipe.count}).`, (x) => (x.hpLeft <= fx.benchSnipe.n ? 50 : 0) - x.hpLeft / 10);
            pool.splice(pool.indexOf(t), 1);
            targets.push(t);
          }
        }
        await this.spread(a, targets.map((x) => [x, fx.benchSnipe.n]));
        this.log('log.benchSnipe', { n: fx.benchSnipe.n, list: names(targets) }, 'dmg');
      }
    }
    if (heads1 && fx.headsBench && o.bench.length) { await this.spread(a, o.bench.map((x) => [x, fx.headsBench])); this.log('log.benchSnipe', { n: fx.headsBench, list: names(o.bench) }, 'dmg'); }
    if (fx.oppBenchAll && o.bench.length) { await this.spread(a, o.bench.map((x) => [x, fx.oppBenchAll])); this.log('log.benchSnipe', { n: fx.oppBenchAll, list: names(o.bench) }, 'dmg'); }
    if (fx.benchType) {
      const t = o.bench.filter((x) => x.card.type === fx.benchType.type);
      if (t.length) { await this.spread(a, t.map((x) => [x, fx.benchType.n])); this.log('log.benchSnipe', { n: fx.benchType.n, list: names(t) }, 'dmg'); }
    }
    if (fx.flipBenchAll && (await flip(O('benchAll', { n: fx.flipBenchAll }), O('nothing')))) {
      await this.spread(a, this.players.flatMap((q) => q.bench).map((x) => [x, fx.flipBenchAll]));
      this.log('log.benchAll', { n: fx.flipBenchAll }, 'dmg');
    }
    if (fx.thunderstorm) {
      let tails = 0;
      const hitList = [];
      for (const [k, b] of o.bench.entries()) {
        if (await this.flip('multi', { atk: atk.name, i: k + 1, n: o.bench.length, so: hitList.length }, [O('benchHitOne', { m: b.name, n: 20 }), O('self', { m: a.name, n: 10 })])) hitList.push(b); else tails++;
      }
      if (hitList.length) { await this.spread(a, hitList.map((x) => [x, 20])); this.log('log.benchSnipe', { n: 20, list: names(hitList) }, 'dmg'); }
      if (tails) { await this.hit(null, a, 10 * tails); a.damage += 10 * tails; this.log('log.recoil', { m: a.name, n: 10 * tails }, 'dmg'); }
    }
    if (fx.bonfire) {
      let heads = 0;
      for (let k = 0; k < 3; k++) if (await this.flip('multi', { atk: atk.name, i: k + 1, n: 3, so: heads }, [O('bonfire'), O('zero')])) heads++;
      heads = Math.min(heads, this.countType(a, 'Fire'));
      if (heads) {
        await this.discardEnergyOfType(p, a, 'Fire', heads);
        const all = this.allMons(o);
        await this.spread(a, all.map((x) => [x, 10 * heads]));
        this.log('log.spiral', { n: 10 * heads }, 'dmg');
      } else this.log('log.failed', { atk: atk.name });
    }
    if (fx.massExplosion) {
      const line = this.players.flatMap((q) => this.allMons(q)).filter(isKoffingLine);
      await this.spread(a, line.map((x) => [x, 20]));
      this.log('log.benchSnipe', { n: 20, list: names(line) }, 'dmg');
    }
    if (fx.snipeAny) {
      const targets = this.allMons(o);
      const t = await this.pickMon(p, 'snipe', targets, 'prompt.q.snipeAny', { c: atk.name, n: fx.snipeAny.n }, `Choose any of the opponent's Pokémon to take ${fx.snipeAny.n} damage (no Weakness or Resistance).`,
        (x) => (x.hpLeft <= fx.snipeAny.n ? 50 : 0) + (fx.snipeAny.noPower && x.card.powerKind ? 20 : 0) - x.hpLeft / 10);
      if (t && (!fx.snipeAny.flip || (await flip(O('benchHitOne', { m: t.name, n: fx.snipeAny.n }), O('nothing'))))) {
        const n = this.modern && t === o.active && !fx.snipeAny.noWR ? this.finalDamage(a, t, fx.snipeAny.n).dmg : fx.snipeAny.n;
        await this.spread(a, [[t, n]]);
        this.log('log.benchSnipe', { n, list: t.name }, 'dmg');
        if (fx.snipeAny.noPower && t.card.powerKind) { t.effects.noPower = { expires: this.turn + 1 }; this.log('log.noPower', { m: t.name }, 'status'); }
      }
    }
    if (fx.spiral) {
      await this.spread(a, this.allMons(o).map((x) => [x, this.modern && x === o.active ? this.finalDamage(a, x, fx.spiral).dmg : fx.spiral]));
      this.log('log.spiral', { n: fx.spiral }, 'dmg');
    }
    if (fx.benchNonType) {
      const targets = this.players.flatMap((q) => q.bench).filter((b) => b.card.type !== fx.benchNonType.type);
      if (targets.length) {
        await this.spread(a, targets.map((x) => [x, fx.benchNonType.n]));
        this.log('log.benchNonType', { n: fx.benchNonType.n, t: { $type: fx.benchNonType.type } }, 'dmg');
      }
    }
    if (fx.benchAll) {
      await this.spread(a, this.players.flatMap((q) => q.bench).map((x) => [x, fx.benchAll]));
      this.log('log.benchAll', { n: fx.benchAll }, 'dmg');
    }
  }

  // Effects on the attacker and its player: healing, cards, damage to itself, protection.
  async selfEffects(p, o, a, atk, fx, { dealt, heads1, risky, surge }) {
    const O = (key, params = {}) => ({ key: 'coin.o.' + key, params });
    const flip = (heads, tails) => this.flip('attack', { atk: atk.name }, [heads, tails]);
    const recoil = async (n) => { await this.hit(null, a, n); a.damage += n; this.log('log.recoil', { m: a.name, n }, 'dmg'); };
    if (fx.healAll && a.damage) await this.heal(a, a.damage);
    if (fx.healIfDamage && dealt > 0) await this.heal(a, fx.healIfDamage);
    if (fx.heal) await this.heal(a, fx.heal);
    if (fx.flipHeal && a.damage && (await flip(O('heal', { n: fx.flipHeal }), O('nothing')))) await this.heal(a, fx.flipHeal);
    if (fx.draw) this.plog(p, 'log.t.drewN', { n: this.draw(p, fx.draw) });
    if (fx.flipDraw && (await flip(O('draw', { n: fx.flipDraw }), O('nothing')))) this.plog(p, 'log.t.drewN', { n: this.draw(p, fx.flipDraw) });
    if (fx.handReset) { this.shuffleHandIn(p); this.plog(p, 'log.t.newHand', { n: this.draw(p, fx.handReset) }); }
    const family = fx.callFamily || fx.callFriend;
    if (family && p.bench.length < MAX_BENCH && (!family.flip || (await flip(O('search'), O('nothing'))))) {
      const ok = fx.callFamily ? (x) => isBasic(x) && family.names.includes(x.name) : (x) => isBasic(x) && x.name.includes(family.who);
      const got = await this.pickCard(p, 'search', p.deck.filter(ok), 'prompt.q.callFamily', { c: atk.name }, 'Choose a Basic Pokémon from your deck to put onto your Bench.', { ai: (x) => x.hp, none: !!fx.callFriend });
      if (got) { p.bench.push(new Mon(this.searchDeck(p, got), this.turn)); this.plog(p, 'log.bench', { c: C(got) }); }
      else shuffle(p.deck);
    }
    if (fx.searchAttach) {
      const en = p.deck.find((x) => x.kind === 'energy' && x.energyType === fx.searchAttach && !x.special);
      if (en) { await this.hooks.onAttach?.({ p: p.idx, mon: a.id, card: en }); a.energy.push(this.searchDeck(p, en)); this.plog(p, 'log.energy', { c: C(en), m: a.name }); }
    }
    if (fx.searchEnergy) {
      const en = p.deck.find((x) => x.kind === 'energy' && x.energyType === fx.searchEnergy && !x.special);
      if (en) { p.hand.push(this.searchDeck(p, en)); this.plog(p, 'log.t.got', { c: C(atk.name), got: C(en) }); }
    }
    if (fx.attachFromDiscard) {
      const i = p.discard.findLastIndex((x) => x.kind === 'energy' && x.energyType === fx.attachFromDiscard && !x.special);
      if (i >= 0) { const en = p.discard.splice(i, 1)[0]; await this.hooks.onAttach?.({ p: p.idx, mon: a.id, card: en }); a.energy.push(en); this.plog(p, 'log.energy', { c: C(en), m: a.name }); }
    }
    if (fx.flipRecoverEnergy) {
      let heads = 0;
      for (let k = 0; k < fx.flipRecoverEnergy.n; k++) if (await this.flip('multi', { atk: atk.name, i: k + 1, n: fx.flipRecoverEnergy.n, so: heads }, [O('recover'), O('zero')])) heads++;
      let got = 0;
      for (let k = 0; k < heads; k++) {
        const i = p.discard.findLastIndex((x) => x.kind === 'energy' && x.energyType === fx.flipRecoverEnergy.type && !x.special);
        if (i >= 0) { p.hand.push(p.discard.splice(i, 1)[0]); got++; }
      }
      this.plog(p, 'log.recovered', { n: got, t: { $type: fx.flipRecoverEnergy.type } });
    }
    if (fx.peekHand) this.plog(p, 'log.t.sawHand', { list: o.hand.map((x) => x.name).join(', ') || '—', c: atk.name });
    if (fx.falseCharity && o.deck.length && (await flip(O('peekTop'), O('nothing')))) {
      const top = o.deck.pop();
      if (top.kind === 'trainer') { o.discard.push(top); this.log('log.falseCharityDiscard', { c: C(top) }); }
      else { o.hand.push(top); this.log('log.falseCharityHand', { P: PL(o) }); }
    }
    if (fx.helpingHand) {
      const hurt = this.allMons(o).filter((x) => x.damage);
      const t = await this.pickMon(p, 'helpingHand', hurt, 'prompt.q.helpingHand', { c: atk.name }, "Choose one of the opponent's damaged Pokémon: remove damage counters from it and draw that many cards.", (x) => -x.hpLeft);
      if (t) {
        const n = await this.pickNumber(p, 'drawN', Math.min(t.counters, p.deck.length), 'prompt.q.helpingHandN', { c: atk.name, m: t.name }, `How many damage counters do you remove from ${t.name} (you draw that many cards)?`, (k) => (p.hand.length + k > 9 ? -k : k / 2));
        if (n) { t.damage -= 10 * n; this.log('log.heal', { m: t.name, n: 10 * n }, 'heal'); this.plog(p, 'log.t.drewN', { n: this.draw(p, n) }); }
      }
    }
    if (fx.focus) { a.effects.focus = { atk: fx.focus, expires: this.turn + 2 }; this.log('log.focus', { m: a.name, atk: fx.focus }, 'status'); }
    if (fx.reduce) { a.effects.reduce = { n: fx.reduce, expires: this.turn + 1 }; this.log('log.reduce', { m: a.name, n: fx.reduce }, 'status'); }
    if (fx.mirrorShell) { a.effects.mirrorShell = { expires: this.turn + 1 }; this.log('log.mirrorShellOn', { m: a.name }, 'status'); }
    if (fx.selfDamage) await recoil(fx.selfDamage);
    if (fx.flipSelfDamage && !(await flip(O('nothing'), O('self', { m: a.name, n: fx.flipSelfDamage })))) await recoil(fx.flipSelfDamage);
    if (heads1 === false && fx.tailsSelf) await recoil(fx.tailsSelf);
    if (heads1 && fx.headsSelf) await recoil(fx.headsSelf);
    if (risky) await recoil(fx.riskyTails);
    if (surge < 0) await recoil(10);
    if (fx.flipTailsDiscard && !(await flip(O('nothing'), O('discardOwn', { t: { $type: fx.flipTailsDiscard } })))) await this.discardEnergyOfType(p, a, fx.flipTailsDiscard, 1);
    if (fx.shield) { a.effects.shield = { kind: fx.shield, expires: this.turn + 1 }; this.log('log.shield.' + fx.shield, { m: a.name }, 'status'); }
    if (fx.flipShield && (await flip(O('shield'), O('nothing')))) { a.effects.shield = { kind: fx.flipShield, expires: this.turn + 1 }; this.log('log.shield.' + fx.flipShield, { m: a.name }, 'status'); }
    if (fx.destinyBond) { a.effects.destinyBond = { expires: this.turn + 1 }; this.log('log.destinyBond', { m: a.name }, 'status'); }
    if (fx.switchSelf && p.bench.length && p.active === a && (await flip(O('switchSelf'), O('nothing')))) {
      const t = await this.pickMon(p, 'promote', p.bench, 'prompt.q.switchSelf', { c: atk.name }, 'Choose which Benched Pokémon switches in.', (x) => x.hpLeft / 10 + x.energy.length * 3);
      this.swapActive(p, t);
      this.plog(p, 'log.t.switched', { m: p.active.name });
    }
  }

  // Attacks that take the attacker out of play (after everything else).
  async leaveEffects(p, a, fx) {
    if (!this.allMons(p).includes(a) || a.damage >= a.maxHp || !p.bench.length) return;
    const shuffleIn = fx.shuffleSelf || (fx.flipShuffleSelf && (await this.flip('attack', { atk: '' }, [{ key: 'coin.o.shuffleIn', params: { m: a.name } }, { key: 'coin.o.nothing', params: {} }])));
    if (shuffleIn) {
      p.deck.push(...this.removeFromPlay(p, a));
      shuffle(p.deck);
      this.plog(p, 'log.shuffledIn', { m: a.name });
    } else if (fx.fadeOut) {
      const tools = a.tools.map((x) => x.card);
      const cards = this.removeFromPlay(p, a).filter((x) => !tools.includes(x));
      p.hand.push(...cards);
      p.discard.push(...tools);
      this.plog(p, 'log.fadeOut', { m: a.name });
    }
  }

  // `attacker` is the player whose turn it is (they pick Prize cards first if both sides KO).
  async handleKOs(attacker = this.current) {
    const kos = [];
    for (const p of this.players) for (const m of this.allMons(p)) if (m.damage >= m.maxHp) kos.push([p, m]);
    if (!kos.length) return;
    for (const [p, m] of kos) {
      this.log('log.ko', { m: m.name, P: PL(p) }, 'ko', p.idx);
      if (this.current !== p) p.koTurn = this.turn; // "during your opponent's last turn" (Bruno, Gym Trainer): not overwritten by KOs on p's own turn
      m.prizeValue = this.modern ? this.prizeValue(p, m) : 1;
      if (this.modern) {
        await this.modernOnKO(p, m);
        if (m.card.prizes > 1) this.learn('multiPrize', { n: m.card.prizes });
      }
      p.discard.push(...m.allCards());
      if (p.active === m) p.active = null;
      else p.bench.splice(p.bench.indexOf(m), 1);
      this.learn('ko', { n: PRIZES });
    }
    this.update();
    // Prizes: each KO gives the other player one Prize card.
    const order = [attacker, this.opp(attacker)];
    for (const taker of order) {
      const n = kos.filter(([p]) => p !== taker).reduce((s, [, m]) => s + (m.prizeValue ?? 1), 0);
      for (let k = 0; k < n && taker.prizes.length; k++) await this.takePrize(taker);
    }

    const losers = new Set();
    for (const p of this.players) {
      if (!p.prizes.length) losers.add(this.opp(p));
      if (!p.active && !p.bench.length) losers.add(p);
    }
    if (losers.size === 2) return this.setWinner('draw', 'reason.both');
    if (losers.size === 1) {
      const loser = [...losers][0], winner = this.opp(loser);
      return this.setWinner(winner, !winner.prizes.length ? 'reason.prizes' : 'reason.noPokemon', { P: PL(winner), L: PL(loser) });
    }
    for (const p of this.players) if (!p.active) await this.promote(p);
  }

  async takePrize(p) {
    const id = await this.ask(p, {
      kind: 'prize', title: 'prompt.prize.title', text: 'prompt.prize.text',
      options: p.prizes.map((c, i) => ({ id: String(i), back: true })),
    });
    const i = Math.min(Number(id) || 0, p.prizes.length - 1);
    const [card] = p.prizes.splice(i, 1);
    p.hand.push(card);
    this.plog(p, p.idx === 0 ? 'log.prizeCard' : 'log.prize', { c: C(card), n: p.prizes.length });
    await this.hooks.onPrize?.(p, card);
    this.update();
  }

  async promote(p) {
    const id = await this.ask(p, {
      kind: 'promote', title: 'prompt.promote.title', text: 'prompt.promote.text',
      options: p.bench.map((m) => ({ id: String(m.id), mon: m })),
    });
    const m = p.bench.find((x) => String(x.id) === id) || p.bench[0];
    p.bench.splice(p.bench.indexOf(m), 1);
    p.active = m;
    this.plog(p, 'log.promote', { m: m.name });
    this.update();
    if (this.modern) await this.becameActive(p);
  }

  // Pokémon Checkup between turns. `p` is the player whose turn just ended.
  async checkup(p) {
    this.phase = 'checkup';
    let any = false;
    for (const q of this.players) {
      for (const m of this.allMons(q)) {
        for (const k of Object.keys(m.effects)) if (m.effects[k].expires <= this.turn) delete m.effects[k];
        const expired = m.tools.filter((t) => t.expires <= this.turn);
        if (expired.length) {
          m.tools = m.tools.filter((t) => t.expires > this.turn);
          q.discard.push(...expired.map((t) => t.card));
          for (const t of expired) this.log('log.toolOff', { c: C(t.card), m: m.name });
        }
      }
      const m = q.active;
      if (!m) continue;
      if (m.status.poisoned) { const pd = typeof m.status.poisoned === 'number' ? 10 * m.status.poisoned : 10; await this.hit(null, m, pd, ['poison']); m.damage += pd; any = true; this.log('log.poison', { m: m.name, n: pd }, 'status'); }
      if (m.status.burned) {
        any = true;
        await this.hit(null, m, 20, ['burn']); m.damage += 20;
        this.log('log.burn', { m: m.name }, 'status');
        if (await this.flip('burn', { m: m.name }, [{ key: 'coin.o.unburn', params: {} }, { key: 'coin.o.stillBurned', params: {} }])) { delete m.status.burned; this.log('log.unburned', { m: m.name }, 'status'); }
      }
      if (m.status.asleep) {
        any = true;
        this.log('log.asleepCheck', { m: m.name }, 'status');
        if (await this.flip('asleep', { m: m.name }, [{ key: 'coin.o.wake', params: {} }, { key: 'coin.o.sleep', params: {} }])) { delete m.status.asleep; this.log('log.woke', { m: m.name }, 'status'); }
      }
      if (m.status.paralyzed && q === p) {
        delete m.status.paralyzed; any = true;
        this.log('log.unparalyzed', { m: m.name }, 'status');
      }
    }
    if (any) this.learn('checkup');
    this.update();
    await this.handleKOs(this.opp(p));
  }
}

function uniqueByName(cards) {
  const seen = new Set();
  return cards.filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)));
}

const attacksEn = (c) => c.attacks.map((a) => `${a.name} [${a.cost.join('+')}] ${a.damage || '-'}${a.text ? ` (${a.text})` : ''}`).join('; ');

// Explains what an extra energy of `type` would do for Pokémon `m` (for the decision model).
function energyNote(m, type, provides = 1) {
  const after = [...m.energyTypes, ...Array(provides).fill(type)];
  const now = m.card.attacks.filter((a) => canPay(after, a.cost) && !canPay(m.energyTypes, a.cost)).map((a) => a.name);
  const parts = [`It will have ${after.length} Energy (${after.join(', ')}).`];
  if (now.length) parts.push(`This enables: ${now.join(', ')}.`);
  const missing = m.card.attacks.filter((a) => !canPay(after, a.cost)).map((a) => `${a.name} needs ${a.cost.join('+')}`);
  if (missing.length) parts.push(`Still short for: ${missing.join('; ')}.`);
  if (type !== 'Colorless' && !m.card.attacks.some((a) => a.cost.includes(type))) parts.push('(Off-type: only counts as Colorless.)');
  return parts.join(' ');
}

const isKoffingLine = (m) => ['Koffing', 'Weezing', 'Dark Weezing'].includes(m.name);
const energyProgressEn = (m) => m.energy.length;
// Pokémon Powers used as an action on your turn.
const ACTIVE_POWERS = new Set(['pollenStench', 'longDistanceHypnosis', 'matterExchange', 'energyCharge', 'emerge']);
// Trainers Sabrina's Psychic Control can borrow from the opponent's discard pile (not ones that stay in play).
const COPYABLE = new Set(['potion', 'superPotion', 'switch', 'gust', 'energyRemoval', 'superEnergyRemoval', 'bill', 'professorOak', 'lass', 'energyRetrieval',
  'computerSearch', 'fullHeal', 'pokemonCenter', 'pokedex', 'pokeBall', 'energySearch', 'gambler', 'pokemonTrader', 'imposterOak', 'erika', 'brock',
  'erikasPerfume', 'mistysWrath', 'secretMission', 'blainesGamble', 'sabrinasGaze', 'maxRevive', 'fervor', 'warpPoint']);
const STADIUM_EN = {
  celadon: "once per turn, a player may discard an Energy from one of their Erika's Pokémon to cure its Special Conditions.",
  cerulean: "Misty's Pokémon retreat for 1 less Energy.",
  pewter: "attacks by Brock's Pokémon ignore Resistance.",
  vermilion: "when Lt. Surge's Pokémon attack, flip: heads +10 damage, tails 10 damage to the attacker.",
  cinnabar: "Water Pokémon ignore the Weakness of Blaine's Pokémon.",
  fuchsia: "once per turn, a player may flip a coin to shuffle a Benched Koga's Pokémon into their deck.",
  saffron: "a player may return basic Energy from Sabrina's Pokémon to their hand.",
  viridian: "when one of Giovanni's Pokémon evolves, remove 2 damage counters from it.",
};
const SPECIAL_EN = {
  dce: 'Double Colorless Energy counts as 2 Colorless Energy.',
  potion: 'Potion Energy counts as 1 Colorless Energy and removes 1 damage counter when attached.',
  fullHeal: 'Full Heal Energy counts as 1 Colorless Energy and cures Special Conditions when attached.',
  teamRocket: "Team Rocket's Energy only stays on Team Rocket's Pokémon; it counts as 2 Energy, each Psychic or Darkness.",
  voltaic: 'Voltaic Lightning Energy counts as Lightning Energy; a Lightning Pokémon with it does 20 more damage to the Defending Pokémon.',
  aurora: 'Aurora Energy counts as 1 Energy of any type; attaching it costs discarding another card from your hand.',
  doubleTurbo: "Double Turbo Energy counts as 2 Colorless Energy, but this Pokémon's attacks do 20 less damage.",
  fusionStrike: "Fusion Strike Energy (Fusion Strike Pokémon only) counts as 1 Energy of any type and blocks the opponent's Abilities on this Pokémon.",
  rapidStrike: 'Rapid Strike Energy (Rapid Strike Pokémon only) counts as 2 Energy, each Water or Fighting.',
  singleStrike: "Single Strike Energy (Single Strike Pokémon only) counts as Fighting or Darkness; this Pokémon's attacks do 20 more damage.",
  stoneFighting: 'Stone Fighting Energy counts as Fighting Energy; a Fighting Pokémon with it takes 20 less damage.',
};

const TTYPE_EN = { item: 'Item', supporter: 'Supporter (only 1 per turn)', stadium: 'Stadium', tool: 'Pokémon Tool' };
// The Basic a Stage 1 Pokémon evolves from (Rare Candy needs to look two steps back).
const evolvesFromOf = (name) => Object.values(CARDS).find((c) => c.kind === 'pokemon' && c.name === name && c.stage === 1)?.evolvesFrom;
installModern(Game, { Mon, shuffle, C, PL, isBasic, MAX_BENCH, evolvesFromOf });
installMega(Game, { Mon, shuffle, C, isBasic, MAX_BENCH });
installSwsh(Game, { Mon, shuffle, C, isBasic, MAX_BENCH });
installSwshV(Game, { Mon, shuffle, C, isBasic, isType, MAX_BENCH });
installSm(Game, { Mon, shuffle, C, isBasic, isType, MAX_BENCH });
