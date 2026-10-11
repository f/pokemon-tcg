// Cards of the newest decks (Mega Evolution Battle and League Battle Decks, Rival and Deluxe Battle Decks),
// installed on the Game class by engine.js on top of the modern rules in engine-modern.js.
// Mega Evolution Pokémon ex give up 3 Prize cards; Ancient and Future Pokémon have their own Trainers and Tools.

export function installMega(Game, { Mon, shuffle, C, isBasic, MAX_BENCH }) {
  const basicEnergy = (x) => x.kind === 'energy' && !x.special;
  const tool = (m, k) => m.tools.some((t) => t.card.tool === k);
  const tagged = (c, tag) => !!c?.tags?.includes(tag);
  const isEx = (c) => tagged(c, 'ex'); // Pokémon ex (Mega Evolution Pokémon ex too), not Pokémon V
  const isMega = (c) => tagged(c, 'Mega');
  const ofType = (type) => (x) => basicEnergy(x) && x.energyType === type;

  Object.assign(Game.prototype, {
    // ---------------- Passive effects ----------------
    megaAttackBonus(a, q) {
      let n = 0;
      if (q?.flags.ppp && a.card.type === 'Fighting') n += 30;          // Premium Power Pro
      if (q?.flags.heatBoost && a.card.type === 'Fire') n += 30;       // Heat Boost
      if (tool(a, 'futureBooster') && tagged(a.card, 'Future')) n += 20;
      if (a.card.powerKind === 'excitedPower' && q && this.allMons(q).some((x) => isMega(x.card) && x.card.type === 'Darkness')) n += 120;
      if (a.card.type === 'Lightning') n += 20 * a.energy.filter((en) => en.special === 'voltaic').length; // Voltaic Lightning Energy
      return n + this.swshAttackBonus(a, q);
    },
    megaDefense(a, d, dmg, notes) {
      const q = this.ownerOf(d);
      let cut = 0;
      if (d.card.powerKind === 'diamondCoat') cut += 30;
      const steven = d.name.startsWith("Steven's");
      if (steven && q?.bench.some((x) => x.card.powerKind === 'stonePalace')) cut += 30;
      if (steven && this.stadiumIs('graniteCave')) cut += 30;
      if (this.stadiumIs('lakeAcuity') && d.energyTypes.some((t) => t === 'Water' || t === 'Fighting')) cut += 20;
      if (cut) notes.push('reduce');
      return this.swshDefense(a, d, Math.max(0, dmg - cut), notes);
    },
    megaRetreat(p, m, c) {
      if (tool(m, 'airBalloon')) c -= 2;
      if (tool(m, 'futureBooster') && tagged(m.card, 'Future')) c = 0;
      if (m.card.powerKind === 'voltaicFloat' && m.energyTypes.includes('Lightning')) c = 0;
      return this.swshRetreat(p, m, c);
    },
    // Special Energy that may only stay on certain Pokémon (Team Rocket's Energy) is discarded anywhere else.
    checkEnergyRules() {
      for (const q of this.players) for (const m of this.allMons(q)) {
        // Rapid/Single/Fusion Strike Energy: only on their own kind of Pokémon.
        const bad = m.energy.filter((en) => (en.special === 'teamRocket' && !m.name.startsWith("Team Rocket's")) || (en.needsTag && !m.card.tags?.includes(en.needsTag)));
        if (!bad.length) continue;
        m.energy = m.energy.filter((en) => !bad.includes(en));
        q.discard.push(...bad);
        this.log('log.energyRemoved', { m: m.name, c: C(bad[0]) });
      }
    },
    // Life-Locked: while the opponent has it in play, your Active Pokémon can't be healed.
    healLocked(m) {
      const q = this.ownerOf(m);
      return !!q && q.active === m && this.allMons(this.opp(q)).some((x) => x.card.powerKind === 'lifeLocked' && this.powerOn(x));
    },
    statusImmune(m) { return this.modern && tool(m, 'ancientBooster') && tagged(m.card, 'Ancient'); },

    // How many Prize cards a Knock Out gives (Mega Evolution ex 3, ex/V 2; Shadowy Concealment takes 1 off).
    prizeValue(q, m) {
      let n = m.card.prizes || 1;
      const by = this.koBy;
      if (by && isEx(by.card) && m.card.type === 'Darkness' && this.allMons(q).some((x) => x.card.powerKind === 'shadowyConcealment')) n = Math.max(0, n - 1);
      return n + this.swshPrizeBonus(q, m);
    },

    // The Active Pokémon took damage from an attack: Punk Helmet and Automated Combat hit back.
    async megaOnDamaged(q, d, attacker) {
      if (!attacker || q.active !== d) return;
      let n = 0;
      if (tool(d, 'punkHelmet') && d.card.type === 'Darkness') n += 40;
      if (d.card.powerKind === 'automatedCombat') n += 30;
      if (!n) return;
      await this.spread(d, [[attacker, n]], { counters: true });
      this.log('log.counters', { n: n / 10, list: attacker.name }, 'dmg');
    },

    // A Pokémon was put onto the Bench: Risky Ruins and Gapejaw Bog put damage counters on it.
    async modernBenched(p, m, { fromHand = false } = {}) {
      let n = 0;
      if (this.stadiumIs('riskyRuins') && m.card.stage === 0 && m.card.type !== 'Darkness' && this.current === p) n += 20;
      if (this.stadiumIs('gapejawBog') && fromHand) n += 20;
      if (!n) return;
      await this.spread(null, [[m, n]], { counters: true });
      this.log('log.counters', { n: n / 10, list: m.name }, 'dmg');
    },
    benchFromDeck(p, x) {
      const m = new Mon(this.searchDeck(p, x), this.turn);
      p.bench.push(m);
      this.plog(p, 'log.bench', { c: C(x) });
      return this.modernBenched(p, m);
    },

    // A Pokémon moved from the Bench to the Active Spot on its owner's turn: Tachyon Bits.
    async becameActive(p) {
      const m = p.active;
      if (!this.modern || !m || this.current !== p) return;
      m.effects.movedActive = { expires: this.turn }; // Gale Thrust
      await this.swshBecameActive(p, m); // Libero
      if (m.card.powerKind !== 'tachyonBits' || p.flags.tachyon) return;
      p.flags.tachyon = true;
      const o = this.opp(p);
      const t = await this.pickMon(p, 'snipe', this.allMons(o), 'prompt.q.counters', { c: m.card.power.name, n: 2 }, "Put 2 damage counters on which of the opponent's Pokémon?", (x) => (x.hpLeft <= 20 ? 50 : 0) - x.hpLeft / 10);
      this.plog(p, 'log.ability', { m: m.name, pw: m.card.power.name });
      await this.spread(m, [[t, 20]], { counters: true });
      this.log('log.counters', { n: 2, list: t.name }, 'dmg');
    },

    // ---------------- Abilities ----------------
    async megaOnEvolve(p, m) {
      const k = m.card.powerKind, o = this.opp(p);
      const say = () => this.plog(p, 'log.ability', { m: m.name, pw: m.card.power.name });
      if (k === 'energizedSteps' || k === 'punkUp') {
        const found = k === 'punkUp' ? p.deck.filter(ofType('Darkness')).slice(0, 5) : p.deck.slice(-4).filter(basicEnergy);
        const targets = k === 'punkUp' ? this.allMons(p).filter((x) => x.name.startsWith("Marnie's")) : this.allMons(p);
        if (!found.length || !targets.length) return true;
        say();
        for (const en of found) {
          const t = await this.pickMon(p, 'attachTo', targets, 'prompt.q.attachTo', { c: m.card.power.name }, `Attach ${en.name} to which Pokémon?`, (x) => (x === m ? 3 : 0) + (x === p.active ? 2 : 0) - x.energyTypes.length * 0.5);
          await this.hooks.onAttach?.({ p: p.idx, mon: t.id, card: en });
          p.deck.splice(p.deck.indexOf(en), 1);
          t.energy.push(en);
        }
        shuffle(p.deck);
        this.plog(p, 'log.energiesFound', { n: found.length });
        return true;
      }
      if (k === 'heaveHoCatcher') {
        if (!o.bench.length) return true;
        const t = await this.pickMonOrNone(p, 'lure', o.bench, 'prompt.lure.text', {}, "You may pull one of the opponent's Benched Pokémon into the Active Spot.", (x) => -x.hpLeft / 10 + (x.card.prizes ? 40 : 0) + 5);
        if (!t) return true;
        say();
        this.swapActive(o, t);
        this.log('log.lure', { m: t.name });
        return true;
      }
      return this.swshOnEvolve(p, m);
    },

    async megaOnBench(p, m) {
      const k = m.card.powerKind, o = this.opp(p);
      if (k === 'lastDitchCatch') {
        if (p.flags.lastDitch) return true;
        const x = await this.pickCard(p, 'search', p.deck.filter((y) => y.ttype === 'supporter'), 'prompt.q.searchSupporter', { c: m.card.power.name }, 'Choose a Supporter card from your deck.', { none: true, ai: (y) => (y.tkind === 'bossOrders' ? 3 : 1) });
        if (x) { p.flags.lastDitch = true; p.hand.push(this.searchDeck(p, x)); this.plog(p, 'log.ability', { m: m.name, pw: m.card.power.name }); }
        return true;
      }
      if (k === 'flyingEntry') {
        const pool = [...o.bench], picked = [];
        for (let i = 0; i < 2 && pool.length; i++) {
          const t = await this.pickMon(p, 'snipe', pool, 'prompt.q.counters', { c: m.card.power.name, n: 1 }, "Put 1 damage counter on which of the opponent's Benched Pokémon?", (x) => (x.hpLeft <= 10 ? 50 : 0) - x.hpLeft / 10);
          pool.splice(pool.indexOf(t), 1);
          picked.push(t);
        }
        if (picked.length) {
          this.plog(p, 'log.ability', { m: m.name, pw: m.card.power.name });
          await this.spread(m, picked.map((x) => [x, 10]), { counters: true });
          this.log('log.counters', { n: 1, list: picked.map((x) => x.name).join(', ') }, 'dmg');
        }
        return true;
      }
      return this.swshOnBench(p, m);
    },

    megaAbilityAction(p, o, mon, kind, power, A, usable) {
      const handEnergy = (type) => p.hand.some((x) => basicEnergy(x) && (!type || x.energyType === type));
      const deckEnergy = (type) => p.deck.some((x) => basicEnergy(x) && (!type || x.energyType === type));
      switch (kind) {
        case 'lunarCycle':
          if (usable(mon) && !p.flags.lunarCycle && this.allMons(p).some((x) => x.name === 'Solrock') && handEnergy('Fighting') && p.deck.length)
            A('discard a basic Fighting Energy from your hand to draw 3 cards (you have Solrock in play). Once per turn.');
          break;
        case 'sinisterSurge':
          if (usable(mon) && deckEnergy('Darkness') && p.bench.some((x) => x.card.type === 'Darkness')) A('attach a basic Darkness Energy from your deck to one of your Benched Darkness Pokémon; it gets 2 damage counters. Once per turn.');
          break;
        case 'mortalShuriken':
          if (usable(mon) && p.active === mon && handEnergy('Water') && this.allMons(o).some((x) => !this.abilityImmune(x))) A("discard a basic Water Energy from your hand to put 6 damage counters on one of the opponent's Pokémon. Once per turn, only while Active.");
          break;
        case 'electrogenesis': if (usable(mon) && deckEnergy('Lightning')) A('attach a basic Lightning Energy from your deck to this Pokémon. Once per turn.'); break;
        case 'xBoot':
          if (usable(mon) && (deckEnergy('Psychic') || deckEnergy('Metal')) && this.allMons(p).some((x) => x.card.type === 'Psychic' || x.card.type === 'Metal'))
            A('attach a basic Psychic and/or Metal Energy from your deck to your Psychic and Metal Pokémon. Once per turn.');
          break;
        case 'bouquetMagic': if (usable(mon) && handEnergy('Grass') && o.bench.some((x) => !this.abilityImmune(x))) A("discard a basic Grass Energy from your hand to put 3 damage counters on one of the opponent's Benched Pokémon. Once per turn."); break;
        case 'magneticAbsorption': if (usable(mon) && o.prizes.length <= 4 && p.discard.some(ofType('Fighting'))) A('attach a basic Fighting Energy from your discard pile to this Pokémon. Once per turn.'); break;
        case 'heatBoost': if (usable(mon) && !p.flags.heatBoost && p.hand.some((x) => x.kind === 'energy' && x.energyType === 'Fire')) A('discard a Fire Energy from your hand: your Fire Pokémon do 30 more damage this turn. Once per turn.'); break;
        case 'painfulSpoons': if (usable(mon) && this.allMons(o).some((x) => x.damage && !this.abilityImmune(x)) && this.allMons(o).filter((x) => !this.abilityImmune(x)).length > 1) A("move up to 2 damage counters from one of the opponent's Pokémon to another of theirs. Once per turn."); break;
        case 'cottonLift': if (usable(mon) && deckEnergy()) A('take up to 2 basic Energy from your deck into your hand. Once per turn.'); break;
        case 'flaringMagic': if (usable(mon) && handEnergy('Fire') && p.hand.length - 1 < 7 && p.deck.length) A(`discard a basic Fire Energy from your hand, then draw until you have 7 cards (${p.hand.length - 1} after discarding). Once per turn.`); break;
        case 'fieryFlapping':
          if (usable(mon) && handEnergy('Fire') && ['Articuno', 'Zapdos'].every((n) => this.allMons(p).some((x) => x.name === n))) A('attach a basic Fire Energy from your hand to this Pokémon (you have Articuno and Zapdos in play). Once per turn.');
          break;
        default: this.swshAbilityAction(p, o, mon, kind, power, A, usable);
      }
    },

    async megaUseAbility(p, o, m, act, power, { pickHand }) {
      const counters = async (t, n) => { await this.spread(m, [[t, n]], { counters: true }); this.log('log.counters', { n: n / 10, list: t.name }, 'dmg'); };
      const discardFromHand = async (type) => {
        const d = await pickHand('prompt.q.energyFromHand', (x) => basicEnergy(x) && x.energyType === type, () => 1);
        if (d) p.discard.push(this.takeFromHand(p, d));
      };
      const fromDeckTo = async (type, targets, self) => {
        const en = p.deck.find(ofType(type));
        if (!en || !targets.length) return null;
        const t = self || (await this.pickMon(p, 'attachTo', targets, 'prompt.q.attachTo', { c: power.name }, `Attach ${en.name} to which Pokémon?`, (x) => (x === p.active ? 2 : 0) - x.energyTypes.length * 0.5));
        await this.hooks.onAttach?.({ p: p.idx, mon: t.id, card: en });
        t.energy.push(this.searchDeck(p, en));
        this.plog(p, 'log.energy', { c: C(en), m: t.name });
        return t;
      };
      switch (act.pkind) {
        case 'lunarCycle': p.flags.lunarCycle = true; await discardFromHand('Fighting'); this.plog(p, 'log.t.drewN', { n: this.draw(p, 3) }); break;
        case 'sinisterSurge': { const t = await fromDeckTo('Darkness', p.bench.filter((x) => x.card.type === 'Darkness')); if (t) await counters(t, 20); break; }
        case 'mortalShuriken': {
          await discardFromHand('Water');
          const t = await this.pickMon(p, 'snipe', this.allMons(o).filter((x) => !this.abilityImmune(x)), 'prompt.q.counters', { c: power.name, n: 6 }, "Put 6 damage counters on which of the opponent's Pokémon?", (x) => (x.hpLeft <= 60 ? 80 + (x.card.prizes || 1) * 10 : 0) - x.hpLeft / 10);
          if (t) await counters(t, 60);
          break;
        }
        case 'electrogenesis': await fromDeckTo('Lightning', [m], m); break;
        case 'xBoot':
          await fromDeckTo('Psychic', this.allMons(p).filter((x) => x.card.type === 'Psychic' || x.card.type === 'Metal'));
          await fromDeckTo('Metal', this.allMons(p).filter((x) => x.card.type === 'Psychic' || x.card.type === 'Metal'));
          shuffle(p.deck);
          break;
        case 'bouquetMagic': {
          await discardFromHand('Grass');
          const t = await this.pickMon(p, 'snipe', o.bench.filter((x) => !this.abilityImmune(x)), 'prompt.q.counters', { c: power.name, n: 3 }, "Put 3 damage counters on which of the opponent's Benched Pokémon?", (x) => (x.hpLeft <= 30 ? 60 : 0) - x.hpLeft / 10);
          if (t) await counters(t, 30);
          break;
        }
        case 'magneticAbsorption': await this.attachFromDiscard(p, [m], 1, ofType('Fighting'), power.name); break;
        case 'heatBoost': {
          const d = await pickHand('prompt.q.energyFromHand', (x) => x.kind === 'energy' && x.energyType === 'Fire', () => 1);
          if (d) p.discard.push(this.takeFromHand(p, d));
          p.flags.heatBoost = true;
          this.plog(p, 'log.boost', { n: 30, t: { $type: 'Fire' } });
          break;
        }
        case 'painfulSpoons': {
          const from = await this.pickMon(p, 'snipe', this.allMons(o).filter((x) => x.damage && !this.abilityImmune(x)), 'prompt.q.moveCountersFrom', { c: power.name }, "Move damage counters away from which of the opponent's Pokémon?", (x) => -x.hpLeft);
          const to = await this.pickMon(p, 'snipe', this.allMons(o).filter((x) => x !== from && !this.abilityImmune(x)), 'prompt.q.moveCountersTo', { c: power.name }, "Move them onto which of the opponent's Pokémon?", (x) => (x.hpLeft <= 20 ? 60 : 0) - x.hpLeft / 10);
          const n = Math.min(20, from.damage);
          from.damage -= n;
          await this.spread(m, [[to, n]], { counters: true });
          this.log('log.countersMoved', { n: n / 10, a: from.name, b: to.name }, 'dmg');
          break;
        }
        case 'flaringMagic': await discardFromHand('Fire'); this.plog(p, 'log.t.drewN', { n: this.draw(p, Math.max(0, 7 - p.hand.length)) }); break;
        case 'fieryFlapping': {
          const en = await pickHand('prompt.q.energyFromHand', ofType('Fire'), () => 1);
          if (!en) break;
          await this.attachHandCard(p, en, m); // Old Cemetery, Natural Cure
          break;
        }
        case 'cottonLift': {
          let n = 0;
          for (let k = 0; k < 2; k++) {
            const en = await this.pickCard(p, 'search', p.deck.filter(basicEnergy), 'prompt.q.searchEnergy', { c: power.name }, 'Choose a basic Energy from your deck.', { none: true, ai: () => 1 });
            if (!en) break;
            p.hand.push(p.deck.splice(p.deck.indexOf(en), 1)[0]); n++;
          }
          shuffle(p.deck);
          this.plog(p, 'log.energiesFound', { n });
          break;
        }
        default: return this.swshUseAbility(p, o, m, act, power);
      }
    },

    // ---------------- Stadiums ----------------
    megaStadiumActions(p, S) {
      const s = this.stadium?.card.stadium;
      const psychic = this.allMons(p).filter((x) => x.card.type === 'Psychic').length;
      if (s === 'mysteryGarden' && p.hand.some((x) => x.kind === 'energy') && p.hand.length - 1 < psychic && p.deck.length)
        S('mysteryGarden', `discard an Energy card from your hand to draw until you have as many cards as your Psychic Pokémon in play (${psychic}). Once per turn.`);
      if (s === 'surfingBeach' && p.active?.card.type === 'Water' && p.bench.some((x) => x.card.type === 'Water'))
        S('surfingBeach', 'switch your Active Water Pokémon with one of your Benched Water Pokémon. Once per turn.');
      if (s === 'spikemuthGym' && p.deck.some((x) => x.kind === 'pokemon' && x.name.startsWith("Marnie's"))) S('spikemuthGym', "take a Marnie's Pokémon from your deck into your hand. Once per turn.");
      if (s === 'jubilifeVillage') S('jubilifeVillage', 'shuffle your hand into your deck and draw 5 cards. Using this ENDS YOUR TURN.');
      this.swshStadiumActions(p, S);
    },
    async megaUseStadium(p, act) {
      const s = this.stadium.card;
      switch (act.stadium) {
        case 'mysteryGarden': {
          const d = await this.pickCard(p, 'discard', p.hand.filter((x) => x.kind === 'energy'), 'prompt.q.energyFromHand', { c: C(s) }, 'Choose an Energy card from your hand to discard.', { unique: false, ai: () => 1 });
          if (d) p.discard.push(this.takeFromHand(p, d));
          const psychic = this.allMons(p).filter((x) => x.card.type === 'Psychic').length;
          this.plog(p, 'log.t.drewN', { n: this.draw(p, Math.max(0, psychic - p.hand.length)) });
          break;
        }
        case 'surfingBeach': {
          const t = await this.pickMon(p, 'promote', p.bench.filter((x) => x.card.type === 'Water'), 'prompt.q.switchSelf', { c: C(s) }, 'Choose which Benched Water Pokémon becomes Active.', (x) => x.hpLeft / 10 + x.energy.length * 5);
          this.swapActive(p, t);
          this.plog(p, 'log.t.switched', { m: p.active.name });
          await this.becameActive(p);
          break;
        }
        case 'spikemuthGym': {
          const x = await this.pickCard(p, 'search', p.deck.filter((y) => y.kind === 'pokemon' && y.name.startsWith("Marnie's")), 'prompt.q.searchPokemon', { c: C(s) }, "Choose a Marnie's Pokémon from your deck.", { ai: (y) => (y.prizes ? 5 : 0) + y.stage });
          if (x) { p.hand.push(this.searchDeck(p, x)); this.plog(p, 'log.t.got', { c: C(s), got: p.idx === 0 ? C(x) : { $hidden: true } }); }
          break;
        }
        case 'jubilifeVillage':
          this.shuffleHandIn(p);
          this.plog(p, 'log.t.newHand', { n: this.draw(p, 5) });
          return true; // the turn ends
        default: return this.swshUseStadium(p, act);
      }
      return false;
    },

    // ---------------- Trainer cards ----------------
    megaTrainerActions(p, o, c, once, T, monEn) {
      const mons = this.allMons(p), others = p.hand.length - 1, deckHas = (f) => p.deck.some(f);
      switch (c.tkind) {
        case 'fightingGong': if (deckHas((x) => ofType('Fighting')(x) || (isBasic(x) && x.type === 'Fighting')) && once('gong')) T('fightingGong', {}, 'take a basic Fighting Energy or a Basic Fighting Pokémon from your deck.'); break;
        case 'lilliesDetermination': if (once('lillie')) T('lilliesDetermination', {}, `shuffle your hand into your deck and draw ${p.prizes.length === 6 ? 8 : 6} cards.`); break;
        case 'megaSignal': if (deckHas((x) => isMega(x)) && once('msig')) T('megaSignal', {}, 'take a Mega Evolution Pokémon ex from your deck.'); break;
        case 'premiumPowerPro': if (!p.flags.ppp && once('ppp')) T('premiumPowerPro', {}, 'your Fighting Pokémon do 30 more damage this turn.'); break;
        case 'wallysCompassion': for (const m of mons) if (isMega(m.card) && m.damage && once('wally' + m.id)) T('wallysCompassion', { m: m.name }, `heal all damage from ${monEn(m)} and put its Energy into your hand.`, { target: m }); break;
        case 'dawn': if (once('dawn')) T('dawn', {}, 'take a Basic, a Stage 1 and a Stage 2 Pokémon from your deck.'); break;
        case 'grimsleysMove': if (this.turn > 2 && p.bench.length < MAX_BENCH && p.deck.length && once('grim')) T('grimsleysMove', {}, 'look at the top 7 cards of your deck and put a Basic Darkness Pokémon from them onto your Bench.'); break;
        case 'wondrousPatch': if (p.bench.some((x) => x.card.type === 'Psychic') && p.discard.some(ofType('Psychic')) && once('patch')) T('wondrousPatch', {}, 'attach a basic Psychic Energy from your discard pile to one of your Benched Psychic Pokémon.'); break;
        case 'pokePad': if (deckHas((x) => x.kind === 'pokemon' && !x.ruleBox) && once('pad')) T('pokePad', {}, 'take a Pokémon without a Rule Box from your deck.'); break;
        case 'judge': if (once('judge')) T('judge', {}, 'both players shuffle their hands into their decks and draw 4 cards.'); break;
        case 'specialRedCard': if (o.prizes.length <= 3 && o.hand.length && once('src')) T('specialRedCard', {}, `the opponent puts their hand (${o.hand.length} cards) on the bottom of their deck and draws 3.`); break;
        case 'energySearch': if (deckHas(basicEnergy) && once('es')) T('energySearch', {}, 'take a basic Energy from your deck.'); break;
        case 'energyRecycler': if (p.discard.some(basicEnergy) && once('recyc')) T('energyRecycler', {}, 'shuffle up to 5 basic Energy cards from your discard pile into your deck.'); break;
        case 'sadaVitality': if (mons.some((x) => tagged(x.card, 'Ancient')) && p.discard.some(basicEnergy) && once('sada')) T('sadaVitality', {}, 'attach a basic Energy from your discard pile to up to 2 of your Ancient Pokémon, then draw 3 cards.'); break;
        case 'technoRadar': if (others >= 1 && deckHas((x) => tagged(x, 'Future')) && once('radar')) T('technoRadar', {}, 'discard another card from your hand to take up to 2 Future Pokémon from your deck.'); break;
        case 'ciphermaniac': if (p.deck.length >= 2 && once('cipher')) T('ciphermaniac', {}, 'choose 2 cards from your deck and put them on top of it.'); break;
        case 'explorersGuidance': if (p.deck.length && once('explorer')) T('explorersGuidance', {}, 'look at the top 6 cards of your deck, keep 2 and discard the rest.'); break;
        case 'cook': if (p.active?.damage && once('cook')) T('cook', { m: p.active.name }, `heal 70 damage from your Active ${p.active.name}.`); break;
        case 'secretBox': if (others >= 3 && once('sbox')) T('secretBox', {}, 'discard 3 other cards from your hand to take an Item, a Pokémon Tool, a Supporter and a Stadium from your deck.'); break;
        case 'drayton': if (p.deck.length && once('drayton')) T('drayton', {}, 'look at the top 7 cards of your deck and take a Pokémon and a Trainer from them.'); break;
        case 'surfer': if (p.bench.length && once('surfer')) T('surfer', {}, 'switch your Active Pokémon with a Benched one, then draw until you have 5 cards.'); break;
        case 'brocksScouting': if (deckHas((x) => x.kind === 'pokemon') && once('scout')) T('brocksScouting', {}, 'take up to 2 Basic Pokémon or 1 Evolution Pokémon from your deck.'); break;
        case 'irisFightingSpirit': if (others >= 1 && p.deck.length && once('iris')) T('irisFightingSpirit', {}, 'discard another card from your hand, then draw until you have 6 cards.'); break;
        case 'irida': if (once('irida')) T('irida', {}, 'take a Water Pokémon and an Item card from your deck.'); break;
        case 'zisu': if (p.deck.length && p.hand.length - 1 <= o.hand.length && once('zisu')) T('zisu', {}, `draw until you have 1 more card than your opponent (${o.hand.length + 1}).`); break;
        case 'escapeRope': if ((o.bench.length || p.bench.length) && once('rope')) T('escapeRope', {}, 'each player switches their Active Pokémon with a Benched one (the opponent first).'); break;
        case 'klara': if (p.discard.some((x) => x.kind === 'pokemon' || basicEnergy(x)) && once('klara')) T('klara', {}, 'put up to 2 Pokémon and/or up to 2 basic Energy cards from your discard pile into your hand.'); break;
        case 'hilda': if (deckHas((x) => (x.kind === 'pokemon' && x.stage > 0) || x.kind === 'energy') && once('hilda')) T('hilda', {}, 'take an Evolution Pokémon and an Energy card from your deck.'); break;
        case 'rosasEncouragement':
          if (p.prizes.length > o.prizes.length && mons.some((x) => x.card.stage === 2) && p.discard.some(basicEnergy) && once('rosa'))
            T('rosasEncouragement', {}, 'attach up to 2 basic Energy from your discard pile to one of your Stage 2 Pokémon (you have more Prize cards left than the opponent).');
          break;
        default: this.swshTrainerActions(p, o, c, once, T);
      }
    },

    async playMegaTrainer(p, o, c, act, L) {
      const m = act.target;
      const pokeAi = (x) => (x.stage > 0 && this.allMons(p).some((y) => y.name === x.evolvesFrom) ? 10 : 0) + (x.prizes ? 6 : 0) + (x.stage === 0 && p.bench.length < MAX_BENCH ? 3 : 0);
      const take = async (ok, text, en, { none = false, ai = pokeAi } = {}) => {
        const x = await this.pickCard(p, 'search', p.deck.filter(ok), text, { c: C(c) }, en, { none, ai });
        if (x) p.hand.push(p.deck.splice(p.deck.indexOf(x), 1)[0]);
        return x;
      };
      const discardOther = async (k, n) => {
        const d = await this.pickCard(p, 'discard', p.hand, n > 1 ? 'prompt.q.discardK' : 'prompt.q.discard1', { c: C(c), k, n }, 'Choose a card from your hand to discard.', { unique: false, ai: (x) => (x.kind === 'energy' ? 1 : 0) });
        if (d) p.discard.push(this.takeFromHand(p, d));
      };
      const fromDiscard = async (ok, max, text) => {
        let n = 0;
        for (let k = 0; k < max; k++) {
          const x = await this.pickCard(p, 'search', p.discard.filter(ok), text, { c: C(c) }, 'Choose a card from your discard pile.', { none: k > 0, unique: false, ai: (y) => (y.kind === 'pokemon' ? 2 : 1) });
          if (!x) break;
          p.hand.push(this.pullFromDiscard(p, x)); n++;
        }
        return n;
      };
      switch (c.tkind) {
        case 'fightingGong': { const x = await take((y) => ofType('Fighting')(y) || (isBasic(y) && y.type === 'Fighting'), 'prompt.q.searchAny', 'Choose a basic Fighting Energy or Basic Fighting Pokémon.', { ai: (y) => (y.kind === 'pokemon' ? 2 : 1) }); shuffle(p.deck); if (x) L('got', { got: C(x) }); break; }
        case 'lilliesDetermination': { const n = p.prizes.length === 6 ? 8 : 6; this.shuffleHandIn(p); L('drew', { n: this.draw(p, n) }); break; }
        case 'megaSignal': { const x = await take((y) => isMega(y), 'prompt.q.searchPokemon', 'Choose a Mega Evolution Pokémon ex.'); shuffle(p.deck); if (x) L('got', { got: C(x) }); break; }
        case 'premiumPowerPro': p.flags.ppp = true; this.plog(p, 'log.boost', { n: 30, t: { $type: 'Fighting' } }); break;
        case 'wallysCompassion': {
          // Energy goes back to the hand only if damage was healed (Life-Locked can stop that).
          const h = this.healLocked(m) ? 0 : m.damage;
          m.damage -= h;
          const n = h ? m.energy.length : 0;
          if (h) p.hand.push(...m.energy.splice(0)); else this.log('log.healLocked', { m: m.name }, 'status');
          L('wally', { m: m.name, h, n });
          break;
        }
        case 'dawn': {
          for (const st of [0, 1, 2]) await take((y) => y.kind === 'pokemon' && y.stage === st, 'prompt.q.searchPokemon', `Choose a ${['Basic', 'Stage 1', 'Stage 2'][st]} Pokémon.`, { none: true });
          shuffle(p.deck);
          L('played');
          break;
        }
        case 'grimsleysMove': {
          const top = p.deck.splice(-7);
          const x = await this.pickCard(p, 'search', top.filter((y) => isBasic(y) && y.type === 'Darkness'), 'prompt.q.callFamily', { c: C(c) }, 'Choose a Basic Darkness Pokémon to put onto your Bench.', { none: true, unique: false, ai: (y) => y.hp });
          if (x) top.splice(top.indexOf(x), 1);
          shuffle(top);
          p.deck.unshift(...top);
          if (x) { const nm = new Mon(x, this.turn); p.bench.push(nm); this.plog(p, 'log.bench', { c: C(x) }); await this.modernBenched(p, nm); } else L('nothing');
          break;
        }
        case 'wondrousPatch': await this.attachFromDiscard(p, p.bench.filter((x) => x.card.type === 'Psychic'), 1, ofType('Psychic'), c.name); break;
        case 'pokePad': { const x = await take((y) => y.kind === 'pokemon' && !y.ruleBox, 'prompt.q.searchPokemon', 'Choose a Pokémon without a Rule Box.'); shuffle(p.deck); if (x) L('got', { got: p.idx === 0 ? C(x) : { $hidden: true } }); break; }
        case 'judge': for (const q of [p, o]) { this.shuffleHandIn(q); this.plog(q, 'log.t.newHand', { n: this.draw(q, 4) }); } break;
        case 'specialRedCard': { shuffle(o.hand); o.deck.unshift(...o.hand); o.hand = []; this.plog(o, 'log.t.newHand', { n: this.draw(o, 3) }); break; }
        case 'energySearch': { const x = await take(basicEnergy, 'prompt.q.searchEnergy', 'Choose a basic Energy.', { ai: () => 1 }); shuffle(p.deck); if (x) L('got', { got: C(x) }); break; }
        case 'energyRecycler': {
          let n = 0;
          for (let k = 0; k < 5; k++) { const en = p.discard.findLast(basicEnergy); if (!en) break; p.deck.push(this.pullFromDiscard(p, en)); n++; }
          shuffle(p.deck);
          L('shuffledBack', { n });
          break;
        }
        case 'sadaVitality': {
          const ancient = this.allMons(p).filter((x) => tagged(x.card, 'Ancient'));
          const done = await this.attachFromDiscard(p, ancient, Math.min(2, ancient.length), basicEnergy, c.name);
          if (done) L('drew', { n: this.draw(p, 3) });
          break;
        }
        case 'technoRadar': {
          await discardOther(1, 1);
          let n = 0;
          for (let k = 0; k < 2; k++) if (await take((y) => tagged(y, 'Future'), 'prompt.q.searchPokemon', 'Choose a Future Pokémon.', { none: true })) n++;
          shuffle(p.deck);
          L('gotN', { n });
          break;
        }
        case 'ciphermaniac': {
          const picked = [];
          for (let k = 0; k < 2; k++) {
            const x = await this.pickCard(p, 'search', p.deck.filter((y) => !picked.includes(y)), 'prompt.q.searchAny', { c: C(c) }, 'Choose a card to put on top of your deck.', { unique: false, ai: (y) => (y.ttype === 'supporter' ? 3 : y.kind === 'pokemon' ? 2 : 1) });
            if (x) picked.push(x);
          }
          for (const x of picked) p.deck.splice(p.deck.indexOf(x), 1);
          shuffle(p.deck);
          p.deck.push(...picked.reverse()); // the first card chosen is drawn first
          L('cipher', { n: picked.length });
          break;
        }
        case 'explorersGuidance': {
          const top = p.deck.splice(-6).reverse();
          for (let k = 0; k < 2 && top.length; k++) {
            const x = (await this.pickCard(p, 'search', top, 'prompt.q.keepK', { c: C(c), k: k + 1, n: 2 }, 'Choose a card to keep.', { unique: false, ai: pokeAi })) || top[0];
            top.splice(top.indexOf(x), 1);
            p.hand.push(x);
          }
          p.discard.push(...top);
          L('wrath', { n: top.length });
          break;
        }
        case 'cook': L('heal', { m: p.active.name, n: await this.heal(p.active, 70) }); break;
        case 'secretBox': {
          for (let k = 0; k < 3; k++) await discardOther(k + 1, 3);
          let n = 0;
          for (const tt of ['item', 'tool', 'supporter', 'stadium']) if (await take((y) => y.ttype === tt, 'prompt.q.searchTrainer', `Choose a ${tt} card.`, { none: true, ai: () => 1 })) n++;
          shuffle(p.deck);
          L('gotN', { n });
          break;
        }
        case 'drayton': {
          const top = p.deck.slice(-7);
          let n = 0;
          for (const [ok, text] of [[(y) => y.kind === 'pokemon', 'prompt.q.searchPokemon'], [(y) => y.kind === 'trainer', 'prompt.q.searchTrainer']]) {
            const x = await this.pickCard(p, 'search', top.filter(ok), text, { c: C(c) }, 'Choose a card from the top of your deck.', { none: true, unique: false, ai: pokeAi });
            if (x) { p.deck.splice(p.deck.indexOf(x), 1); top.splice(top.indexOf(x), 1); p.hand.push(x); n++; }
          }
          shuffle(p.deck);
          L('gotN', { n });
          break;
        }
        case 'surfer': {
          const t = await this.pickMon(p, 'promote', p.bench, 'prompt.q.switchSelf', { c: C(c) }, 'Choose which Benched Pokémon becomes Active.', (x) => x.hpLeft / 10 + x.energy.length * 5);
          this.swapActive(p, t);
          L('switch', { m: p.active.name });
          await this.becameActive(p);
          this.plog(p, 'log.t.drewN', { n: this.draw(p, Math.max(0, 5 - p.hand.length)) });
          break;
        }
        case 'brocksScouting': {
          const first = await take((y) => y.kind === 'pokemon', 'prompt.q.searchPokemon', 'Choose up to 2 Basic Pokémon, or 1 Evolution Pokémon.', { ai: pokeAi });
          if (first && first.stage === 0) await take(isBasic, 'prompt.q.searchPokemon', 'Choose another Basic Pokémon.', { none: true });
          shuffle(p.deck);
          L('played');
          break;
        }
        case 'irisFightingSpirit': await discardOther(1, 1); L('drew', { n: this.draw(p, Math.max(0, 6 - p.hand.length)) }); break;
        case 'irida': {
          await take((y) => y.kind === 'pokemon' && y.type === 'Water', 'prompt.q.searchPokemon', 'Choose a Water Pokémon.', { none: true });
          await take((y) => y.ttype === 'item', 'prompt.q.searchTrainer', 'Choose an Item card.', { none: true, ai: (y) => (y.tkind === 'rareCandy' ? 3 : 1) });
          shuffle(p.deck);
          L('played');
          break;
        }
        case 'zisu': L('drew', { n: this.draw(p, Math.max(0, o.hand.length + 1 - p.hand.length)) }); break;
        case 'escapeRope': {
          if (o.bench.length) {
            const t = await this.pickMon(o, 'whirlwind', o.bench, 'prompt.q.warpOpp', { c: C(c) }, 'Your opponent played Escape Rope: choose which of your Benched Pokémon becomes Active.', (x) => x.hpLeft / 10);
            this.swapActive(o, t);
            this.plog(o, 'log.t.switched', { m: o.active.name });
          }
          if (p.bench.length) {
            const t = await this.pickMon(p, 'promote', p.bench, 'prompt.q.warpYou', { c: C(c) }, 'Choose which of your Benched Pokémon becomes Active.', (x) => x.hpLeft / 10 + x.energy.length * 5);
            this.swapActive(p, t);
            this.plog(p, 'log.t.switched', { m: p.active.name });
            await this.becameActive(p);
          }
          break;
        }
        case 'hilda': {
          let n = 0;
          if (await take((y) => y.kind === 'pokemon' && y.stage > 0, 'prompt.q.searchPokemon', 'Choose an Evolution Pokémon.', { none: true })) n++;
          if (await take((y) => y.kind === 'energy', 'prompt.q.searchEnergyAny', 'Choose an Energy card.', { none: true, ai: (y) => (y.special ? 2 : 1) })) n++;
          shuffle(p.deck);
          L('gotN', { n });
          break;
        }
        case 'rosasEncouragement': {
          const stage2 = this.allMons(p).filter((x) => x.card.stage === 2);
          const t = await this.pickMon(p, 'attachTo', stage2, 'prompt.q.attachTo', { c: C(c) }, 'Attach the Energy to which Stage 2 Pokémon?', (x) => (x === p.active ? 2 : 0) + x.card.hp / 100);
          if (t) await this.attachFromDiscard(p, [t], 2, basicEnergy, c.name);
          break;
        }
        case 'klara': {
          const a = await fromDiscard((x) => x.kind === 'pokemon', 2, 'prompt.q.fromDiscard');
          const b = await fromDiscard(basicEnergy, 2, 'prompt.q.fromDiscard');
          L('gotN', { n: a + b });
          break;
        }
        default: await this.playSwshTrainer(p, o, c, act, L);
      }
    },

    // ---------------- Attack effects ----------------
    async megaPreDamage(p, a, atk, fx) {
      let bonus = 0;
      if (fx.discardSelfTimes) {
        const n = await this.pickNumber(p, 'drawN', Math.min(fx.discardSelfTimes.max, a.energy.length), 'prompt.q.discardSelfHowMany', { c: atk.name, n: fx.discardSelfTimes.n }, `How many Energy do you discard from this Pokémon (${fx.discardSelfTimes.n} damage each)?`, (k) => k);
        p.discard.push(...a.energy.splice(-n || a.energy.length, n));
        bonus += fx.discardSelfTimes.n * n;
      }
      if (fx.returnEnergyBonus) {
        const en = a.energy.find((x) => x.energyType === fx.returnEnergyBonus.type);
        if (en) {
          const id = await this.pick(p, 'yesno', 'prompt.gen.title', 'prompt.q.returnForBonus', [
            { id: 'yes', label: { key: 'opt.yes' }, en: `Put a ${fx.returnEnergyBonus.type} Energy into your hand for +${fx.returnEnergyBonus.bonus} damage.`, ai: 1 },
            { id: 'no', label: { key: 'opt.no' }, en: 'Keep it attached.', ai: 0 }], { params: { c: atk.name, b: fx.returnEnergyBonus.bonus, t: { $type: fx.returnEnergyBonus.type } }, en: 'Return an Energy for more damage?' });
          if (id === 'yes') { p.hand.push(...a.energy.splice(a.energy.indexOf(en), 1)); bonus += fx.returnEnergyBonus.bonus; }
        }
      }
      return bonus + (await this.swshPreDamage(p, a, atk, fx));
    },

    async megaAfter(p, o, a, d, atk, fx) {
      // Fetch and Hide: the opponent reveals their hand; one Item from it goes to the bottom of their deck.
      if (fx.fetchHide) {
        this.plog(p, 'log.t.sawHand', { list: o.hand.map((x) => x.name).join(', ') || '—', c: atk.name });
        const x = await this.pickCard(p, 'search', o.hand.filter((y) => y.ttype === 'item'), 'prompt.q.fetchHide', { c: atk.name }, "Choose an Item card from the opponent's hand to put on the bottom of their deck.", { ai: (y) => (y.tkind === 'rareCandy' || y.tkind === 'ultraBall' ? 3 : 1) });
        if (x) { o.hand.splice(o.hand.indexOf(x), 1); o.deck.unshift(x); this.log('log.fetchHide', { c: C(x), P: { $pl: o.idx } }, 'status'); }
      }
      if (fx.lockout) { a.effects.cooldownAll = { expires: this.turn + 2 }; this.log('log.cooldownAll', { m: a.name }, 'status'); }
      if (fx.healBenchType) {
        const hurt = p.bench.filter((x) => x.damage && x.card.type === fx.healBenchType.type);
        const t = await this.pickMon(p, 'heal', hurt, 'prompt.q.healWhich', { c: atk.name, n: fx.healBenchType.n }, `Heal ${fx.healBenchType.n} damage from which Benched Pokémon?`, (x) => x.damage);
        if (t) await this.heal(t, fx.healBenchType.n);
      }
      if (fx.searchPokemonToHand) {
        let n = 0;
        for (let k = 0; k < fx.searchPokemonToHand.n; k++) {
          const ok = (y) => y.kind === 'pokemon' && (!fx.searchPokemonToHand.resistance || y.resistance === fx.searchPokemonToHand.resistance);
          const x = await this.pickCard(p, 'search', p.deck.filter(ok), 'prompt.q.searchPokemon', { c: atk.name }, 'Choose a Pokémon from your deck.', { none: true, ai: (y) => (y.stage > 0 ? 5 : 0) + (y.prizes ? 4 : 0) });
          if (!x) break;
          p.hand.push(p.deck.splice(p.deck.indexOf(x), 1)[0]); n++;
        }
        shuffle(p.deck);
        this.plog(p, 'log.t.drewN', { n });
      }
      if (fx.evolveFromDeck) {
        const opts = this.allMons(p).filter((x) => p.deck.some((y) => y.kind === 'pokemon' && y.evolvesFrom === x.name));
        const t = await this.pickMon(p, 'evolveWhich', opts, 'prompt.q.evolveWhich', { c: atk.name }, 'Which of your Pokémon evolves (from your deck)?', (x) => (x.card.stage === 1 ? 3 : 1) + (x === p.active ? 1 : 0));
        if (t) await this.evolveMon(p, t, p.deck.find((y) => y.kind === 'pokemon' && y.evolvesFrom === t.name), { fromDeck: true });
        shuffle(p.deck);
      }
      if (fx.discardAllEnergy && a.energy.length) { const n = a.energy.length; p.discard.push(...a.energy.splice(0)); this.log('log.discardedAll', { m: a.name, n }, 'status'); }
      if (fx.returnEnergyToHand && a.energy.length) {
        const n = Math.min(fx.returnEnergyToHand, a.energy.length);
        p.hand.push(...a.energy.splice(-n));
        this.plog(p, 'log.energyToHand', { m: a.name, n });
      }
      if (fx.searchAttachTag) {
        const targets = this.allMons(p).filter((x) => tagged(x.card, fx.searchAttachTag.tag));
        for (let k = 0; k < fx.searchAttachTag.n && targets.length; k++) {
          const ok = fx.searchAttachTag.anyEnergy ? (x) => x.kind === 'energy' : basicEnergy; // Energy Mix: any Energy card
          const en = await this.pickCard(p, 'search', p.deck.filter(ok), 'prompt.q.searchEnergy', { c: atk.name }, 'Choose an Energy card to attach.', { none: true, ai: (x) => (x.special ? 2 : 1) });
          if (!en) break;
          const t = await this.pickMon(p, 'attachTo', targets, 'prompt.q.attachTo', { c: atk.name }, `Attach ${en.name} to which Pokémon?`, (x) => -x.energyTypes.length);
          await this.hooks.onAttach?.({ p: p.idx, mon: t.id, card: en });
          t.energy.push(this.searchDeck(p, en));
        }
        shuffle(p.deck);
      }
      if (fx.selfToHandAll && this.allMons(p).includes(a) && p.bench.length) {
        const cards = this.removeFromPlay(p, a);
        p.hand.push(...cards);
        this.plog(p, 'log.toHand', { m: a.name });
        await this.refillActive();
      }
      await this.swshAfter(p, o, a, d, atk, fx);
    },

    // When a Pokémon is Knocked Out by an attack: Exp. Share.
    megaOnKO(q, m) {
      if (q.active !== m || !this.koBy) return;
      const holder = q.bench.find((x) => tool(x, 'expShare'));
      const en = m.energy.find(basicEnergy);
      if (!holder || !en) return;
      holder.energy.push(...m.energy.splice(m.energy.indexOf(en), 1));
      this.log('log.expShare', { m: holder.name, from: m.name }, 'status');
    },
  });
}
