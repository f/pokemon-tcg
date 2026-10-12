// Cards of the Sword & Shield V Battle Decks and League Battle Decks (2020–2022), installed on the Game class by engine.js.
// Pokémon V / VMAX / VSTAR, Rapid / Single / Fusion Strike, a TAG TEAM-GX, and their Trainers, Stadiums, Tools and Special Energy.
// Reached from the hooks in engine-swsh.js, engine-mega.js and engine.js.

export function installSwshV(Game, { Mon, shuffle, C, SECRET, isBasic, isType, MAX_BENCH }) {
  const basicEnergy = (x) => x.kind === 'energy' && !x.special;
  const ofType = (type) => (x) => basicEnergy(x) && x.energyType === type;
  const tag = (c, t) => !!c?.tags?.includes(t);
  const isV = (c) => tag(c, 'V') || tag(c, 'VMAX') || tag(c, 'VSTAR');
  const counterLog = (g, t, n) => g.log('log.counters', { n: n / 10, list: t.name }, 'dmg');

  Object.assign(Game.prototype, {
    // ---------------- Damage ----------------
    // Bonuses of the attacker against the Defending Pokémon (before Weakness and Resistance).
    swshVAttackBonus(a, q) {
      if (!q) return 0;
      const d = this.opp(q).active;
      let n = 0;
      if (a.card.type === 'Metal') n += 20 * this.allMons(q).filter((x) => x.card.powerKind === 'steelySpirit' && this.powerOn(x)).length; // Steely Spirit
      if (d && isV(d.card) && a.tools.some((t) => t.card.tool === 'choiceBelt')) n += 30;
      n += 20 * a.energy.filter((en) => en.special === 'singleStrike').length;
      n -= 20 * a.energy.filter((en) => en.special === 'doubleTurbo').length;
      if (q.flags.powerTablet && tag(a.card, 'Fusion Strike')) n += 30 * q.flags.powerTablet;
      if (q.until.alteredCreation) n += 30; // Altered Creation-GX, for the rest of the game
      return n + this.smAttackBonus(a, q);
    },
    // Reductions on the Defending Pokémon (after Weakness and Resistance).
    swshDefense(a, d, dmg, notes) {
      let cut = 0;
      if (d.card.type === 'Fighting') cut += 20 * d.energy.filter((en) => en.special === 'stoneFighting').length;
      const q = this.ownerOf(d);
      if (tag(d.card, 'Fusion Strike') && q && this.allMons(q).some((x) => x.card.powerKind === 'lessonInZeal' && this.powerOn(x))) cut += 20; // only 1 Lesson in Zeal counts
      if (cut && dmg > 0) notes.push('reduce');
      return this.smDefense(a, d, Math.max(0, dmg - cut), notes);
    },
    // Infiltrator: flip a coin when an attack would damage this Pokémon; heads prevents it.
    async swshBeforeDamage(a, d, dmg, notes) {
      if (d.card.powerKind !== 'infiltrator' || !this.powerOn(d)) return dmg;
      this.log('log.power.auto', { m: d.name, pw: d.card.power.name }, 'status');
      if (await this.flip('power', { pw: d.card.power.name }, [{ key: 'coin.o.preventDamage', params: {} }, { key: 'coin.o.nothing', params: {} }])) { notes.push('shield'); return 0; }
      return dmg;
    },
    // Damage from an opponent's attack to a Pokémon other than through the main hit (Bench damage, snipes).
    // Returns false when it is prevented: Wave Veil protects the Bench, Infiltrator flips.
    async swshBenchShield(q, m, src, n) {
      if (q.bench.includes(m) && this.allMons(q).some((x) => x.card.powerKind === 'waveVeil' && this.powerOn(x))) { this.log('log.waveVeil', { m: m.name }, 'status'); return false; }
      if (n > 0 && m.card.powerKind === 'infiltrator' && this.powerOn(m)) {
        this.log('log.power.auto', { m: m.name, pw: m.card.power.name }, 'status');
        if (await this.flip('power', { pw: m.card.power.name }, [{ key: 'coin.o.preventDamage', params: {} }, { key: 'coin.o.nothing', params: {} }])) return false;
      }
      return true;
    },
    swshRetreat(p, m, c) { return this.smRetreat(p, m, this.stadiumIs('towerOfWaters') && tag(m.card, 'Rapid Strike') ? c - 2 : c); },
    // Altered Creation-GX with an extra Water Energy: 1 more Prize card for Knocking Out the Defending Pokémon.
    swshPrizeBonus(q, m) {
      const by = this.koBy, taker = by && this.ownerOf(by);
      return taker && taker !== q && taker.until.alteredPrize && q.active === m ? 1 : 0;
    },
    // Fusion Strike Energy: the opponent's Abilities have no effect on this Pokémon.
    abilityImmune(m) { return m.energy.some((en) => en.special === 'fusionStrike'); },

    // ---------------- Energy ----------------
    // Attaching an Energy card from the hand: Old Cemetery puts 2 damage counters on a non-Psychic Pokémon.
    async oldCemetery(m) {
      if (!this.stadiumIs('oldCemetery') || m.card.type === 'Psychic') return;
      await this.spread(null, [[m, 20]], { counters: true });
      this.log('log.counters', { n: 2, list: m.name }, 'dmg');
    },
    async attachHandCard(p, en, t) {
      await this.hooks.onAttach?.({ p: p.idx, mon: t.id, card: en });
      t.energy.push(this.takeFromHand(p, en));
      this.plog(p, 'log.energy', { c: C(en), m: t.name });
      await this.oldCemetery(t);
      this.naturalCure(t);
    },
    // After the once-per-turn Energy attachment: Aurora Energy's cost, Old Cemetery.
    async swshAttached(p, c, m) {
      if (c.special === 'aurora' && p.hand.length) {
        const d = await this.pickCard(p, 'discard', p.hand, 'prompt.q.discard1', { c: C(c) }, 'Aurora Energy: discard another card from your hand.', { unique: false, ai: (x) => (x.kind === 'energy' ? 1 : x.kind === 'pokemon' ? 0 : -1) });
        if (d) p.discard.push(this.takeFromHand(p, d));
      }
      await this.oldCemetery(m);
      this.naturalCure(m);
    },

    // ---------------- Abilities ----------------
    swshVAbilityAction(p, o, mon, kind, power, A, usable) {
      const hand = (f) => p.hand.some(f), deck = (f) => p.deck.some(f);
      const fusion = this.allMons(p).filter((x) => tag(x.card, 'Fusion Strike')).length;
      switch (kind) {
        case 'makeDo': if (usable(mon) && p.hand.length && p.deck.length) A('discard a card from your hand to draw 2 cards. Once per turn.'); break;
        case 'lunarBlessing': {
          const a = p.active;
          if (usable(mon) && a && a.energyTypes.some((t) => isType(t, 'Psychic')) && (a.damage || a.conditions().length)) A(`heal 20 damage from your Active ${a.name} and cure a Special Condition. Once per turn.`);
          break;
        }
        case 'witchRondo': if (usable(mon) && p.bench.length) A('switch your Active Pokémon with a Benched one; then the opponent switches theirs. Once per turn.'); break;
        case 'shiningArcana': if (usable(mon) && p.deck.length) A('look at the top 2 cards of your deck: attach the basic Energy among them to your Pokémon, put the rest into your hand. Once per turn.'); break;
        case 'intrepidSword': if (usable(mon) && p.deck.length) A('look at the top 3 cards: attach the Metal Energy among them to this Pokémon, put the rest into your hand. Using it ENDS YOUR TURN.'); break;
        case 'stellarWish': if (usable(mon) && p.active === mon && p.deck.length) A('look at the top 5 cards and take a Trainer from them; this Pokémon falls Asleep. Once per turn, only while Active.'); break;
        case 'primateWisdom': if (usable(mon) && p.hand.length && p.deck.length) A('swap a card from your hand with the top card of your deck. Once per turn.'); break;
        case 'evolutionRoar': if (usable(mon) && p.hand.length >= 2 && deck((x) => x.name === 'Galarian Perrserker')) A('discard 2 cards from your hand to take a Galarian Perrserker from your deck. Once per turn.'); break;
        case 'iceDance': if (hand((x) => x.kind === 'energy' && x.energyType === 'Water') && p.bench.some((x) => x.card.type === 'Water')) A('attach a Water Energy from your hand to one of your Benched Water Pokémon. As often as you like.'); break;
        case 'rapidStrikeSearch': if (usable(mon) && !p.flags.rapidStrikeSearch && deck((x) => tag(x, 'Rapid Strike'))) A('take a Rapid Strike card from your deck. Once per turn (only 1 Rapid Strike Search each turn).'); break;
        case 'singleStrikeRoar':
          if (usable(mon) && deck((x) => x.special === 'singleStrike') && this.allMons(p).some((x) => tag(x.card, 'Single Strike'))) A('attach a Single Strike Energy from your deck to one of your Single Strike Pokémon; it gets 2 damage counters. Once per turn.');
          break;
        case 'quickShooting': if (usable(mon) && this.allMons(o).some((x) => !this.abilityImmune(x))) A("put 2 damage counters on one of the opponent's Pokémon. Once per turn."); break;
        case 'underworldDoor':
          if (usable(mon) && hand(ofType('Psychic')) && p.bench.some((x) => x.card.type === 'Psychic')) A('attach a basic Psychic Energy from your hand to one of your Benched Psychic Pokémon and draw 2 cards. Once per turn.');
          break;
        case 'fusionStrikeSystem': if (usable(mon) && p.hand.length < fusion && p.deck.length) A(`draw until you have as many cards as your Fusion Strike Pokémon in play (${fusion}). Once per turn.`); break;
        case 'starPortal':
          if (!p.vstarUsed && p.discard.some(ofType('Water')) && this.allMons(p).some((x) => x.card.type === 'Water')) A('VSTAR Power: attach up to 3 Water Energy from your discard pile to your Water Pokémon. Only once per game.');
          break;
        default: this.smAbilityAction(p, o, mon, kind, power, A, usable);
      }
    },
    async swshVUseAbility(p, o, m, act, power) {
      const pickHand = (text, ok, ai) => this.pickCard(p, 'discard', p.hand.filter(ok), text, { c: power.name }, 'Choose a card from your hand.', { unique: false, ai });
      const toHand = (cards) => { p.hand.push(...cards); };
      switch (act.pkind) {
        case 'makeDo': {
          const d = await pickHand('prompt.q.discard1', () => true, (x) => (x.kind === 'energy' ? 1 : 0));
          if (d) p.discard.push(this.takeFromHand(p, d));
          this.plog(p, 'log.t.drewN', { n: this.draw(p, 2) });
          break;
        }
        case 'lunarBlessing': {
          const a = p.active;
          await this.heal(a, 20);
          const conds = a.conditions();
          if (conds.length) {
            const s = conds.length === 1 ? conds[0] : await this.pick(p, 'status', 'prompt.gen.title', 'prompt.q.cureWhich', conds.map((x) => ({ id: x, label: { key: 'st.' + x }, en: x, ai: { paralyzed: 4, asleep: 3, confused: 2, poisoned: 1, burned: 1 }[x] || 1 })), { params: { c: power.name }, en: 'Which Special Condition is cured?' });
            delete a.status[conds.includes(s) ? s : conds[0]];
            this.log('log.curedOne', { m: a.name, s: { $st: conds.includes(s) ? s : conds[0] } }, 'heal');
          }
          break;
        }
        case 'witchRondo': {
          const t = await this.pickMon(p, 'promote', p.bench, 'prompt.q.switchSelf', { c: power.name }, 'Choose which Benched Pokémon becomes Active.', (x) => x.hpLeft / 10 + x.energy.length * 5);
          this.swapActive(p, t);
          this.plog(p, 'log.t.switched', { m: p.active.name });
          await this.becameActive(p);
          if (o.bench.length) {
            const u = await this.pickMon(o, 'whirlwind', o.bench, 'prompt.q.warpOpp', { c: power.name }, 'Witch Rondo: choose which of your Benched Pokémon becomes Active.', (x) => x.hpLeft / 10);
            this.swapActive(o, u);
            this.plog(o, 'log.t.switched', { m: o.active.name });
          }
          break;
        }
        case 'shiningArcana': case 'intrepidSword': {
          const n = act.pkind === 'intrepidSword' ? 3 : 2;
          const top = p.deck.splice(-n).reverse();
          const ok = act.pkind === 'intrepidSword' ? (x) => x.kind === 'energy' && x.energyType === 'Metal' && !x.special : basicEnergy;
          // "Attach any number of [them]": each one may go into the hand with the rest instead.
          let attached = 0;
          const kept = top.filter((x) => !ok(x));
          for (const en of top.filter(ok)) {
            const t = act.pkind === 'intrepidSword'
              ? ((await this.yesNo(p, 'prompt.q.attachOrHand', { c: power.name, m: m.name }, `Attach ${en.name} to ${m.name}? (No: it goes into your hand.)`, 1)) ? m : null)
              : await this.pickMonOrNone(p, 'attachTo', this.allMons(p), 'prompt.q.attachToOrHand', { c: power.name }, `Attach ${en.name} to which Pokémon? (Nothing: it goes into your hand.)`, (x) => (x === p.active ? 2 : 0) - x.energyTypes.length * 0.5, -5);
            if (!t) { kept.push(en); continue; }
            await this.hooks.onAttach?.({ p: p.idx, mon: t.id, card: en });
            t.energy.push(en); attached++;
            this.plog(p, 'log.energy', { c: C(en), m: t.name });
          }
          toHand(kept);
          this.plog(p, 'log.arcana', { c: power.name, n: attached, k: top.length - attached });
          if (act.pkind === 'intrepidSword') { this.log('log.turnEnds', { m: m.name }, 'status'); return true; }
          break;
        }
        case 'stellarWish': {
          const top = p.deck.splice(-5);
          const x = await this.pickCard(p, 'search', top.filter((y) => y.kind === 'trainer'), 'prompt.q.searchTrainer', { c: power.name }, 'Choose a Trainer card to keep.', { none: true, unique: false, ai: (y) => (y.ttype === 'supporter' ? 3 : y.tkind === 'quickBall' ? 2 : 1) });
          if (x) { top.splice(top.indexOf(x), 1); p.hand.push(x); }
          p.deck.push(...top);
          shuffle(p.deck);
          this.plog(p, 'log.t.got', { c: power.name, got: x ? SECRET(p, C(x)) : '—' });
          this.applyStatus(m, 'asleep');
          break;
        }
        case 'primateWisdom': {
          const x = await pickHand('prompt.q.primateWisdom', () => true, (y) => (y.kind === 'energy' && p.hand.filter((z) => z.kind === 'energy').length > 2 ? 2 : 0));
          if (!x) break;
          const top = p.deck.pop();
          p.deck.push(this.takeFromHand(p, x));
          p.hand.push(top);
          this.plog(p, 'log.primateWisdom', { c: power.name });
          break;
        }
        case 'evolutionRoar': {
          for (let k = 0; k < 2; k++) { const d = await pickHand('prompt.q.discardK', () => true, (y) => (y.kind === 'energy' ? 1 : 0)); if (d) p.discard.push(this.takeFromHand(p, d)); }
          const x = p.deck.find((y) => y.name === 'Galarian Perrserker');
          if (x) { p.hand.push(this.searchDeck(p, x)); this.plog(p, 'log.t.got', { c: power.name, got: C(x) }); }
          shuffle(p.deck);
          break;
        }
        case 'iceDance': {
          p.flags.powers[m.id] = false; // as often as you like
          const en = await pickHand('prompt.q.energyFromHand', (x) => x.kind === 'energy' && x.energyType === 'Water', () => 1);
          const t = await this.pickMon(p, 'attachTo', p.bench.filter((x) => x.card.type === 'Water'), 'prompt.q.attachTo', { c: power.name }, `Attach ${en.name} to which Benched Water Pokémon?`, (x) => -x.energyTypes.length);
          await this.attachHandCard(p, en, t);
          break;
        }
        case 'rapidStrikeSearch': {
          p.flags.rapidStrikeSearch = true;
          const x = await this.pickCard(p, 'search', p.deck.filter((y) => tag(y, 'Rapid Strike')), 'prompt.q.searchAny', { c: power.name }, 'Choose a Rapid Strike card.', { ai: (y) => (y.kind === 'pokemon' ? 2 + (y.prizes || 0) : y.ttype === 'supporter' ? 2 : 1) });
          if (x) { p.hand.push(this.searchDeck(p, x)); this.plog(p, 'log.t.got', { c: power.name, got: SECRET(p, C(x)) }); }
          shuffle(p.deck);
          break;
        }
        case 'singleStrikeRoar': {
          const en = p.deck.find((x) => x.special === 'singleStrike');
          const t = await this.pickMon(p, 'attachTo', this.allMons(p).filter((x) => tag(x.card, 'Single Strike')), 'prompt.q.attachTo', { c: power.name }, 'Attach the Single Strike Energy to which Pokémon?', (x) => (x.hpLeft > 40 ? 2 : -5) + (x === p.active ? 1 : 0) + (x.card.prizes || 0));
          await this.hooks.onAttach?.({ p: p.idx, mon: t.id, card: en });
          t.energy.push(this.searchDeck(p, en));
          shuffle(p.deck);
          this.plog(p, 'log.energy', { c: C(en), m: t.name });
          await this.spread(m, [[t, 20]], { counters: true });
          counterLog(this, t, 20);
          break;
        }
        case 'quickShooting': {
          const t = await this.pickMon(p, 'snipe', this.allMons(o).filter((x) => !this.abilityImmune(x)), 'prompt.q.counters', { c: power.name, n: 2 }, "Put 2 damage counters on which of the opponent's Pokémon?", (x) => (x.hpLeft <= 20 ? 80 + (x.card.prizes || 1) * 10 : 0) - x.hpLeft / 10);
          if (t) { await this.spread(m, [[t, 20]], { counters: true }); counterLog(this, t, 20); }
          break;
        }
        case 'underworldDoor': {
          const en = await pickHand('prompt.q.energyFromHand', ofType('Psychic'), () => 1);
          const t = await this.pickMon(p, 'attachTo', p.bench.filter((x) => x.card.type === 'Psychic'), 'prompt.q.attachTo', { c: power.name }, `Attach ${en.name} to which Benched Psychic Pokémon?`, (x) => -x.energyTypes.length + (x.card.prizes || 0));
          await this.attachHandCard(p, en, t);
          this.plog(p, 'log.t.drewN', { n: this.draw(p, 2) });
          break;
        }
        case 'fusionStrikeSystem': {
          const n = this.allMons(p).filter((x) => tag(x.card, 'Fusion Strike')).length;
          this.plog(p, 'log.t.drewN', { n: this.draw(p, Math.max(0, n - p.hand.length)) });
          break;
        }
        case 'starPortal': {
          p.vstarUsed = true;
          this.learn('vstar');
          await this.attachFromDiscard(p, this.allMons(p).filter((x) => x.card.type === 'Water'), 3, ofType('Water'), power.name, { upTo: true });
          break;
        }
        default: return this.smUseAbility(p, o, m, act, power);
      }
    },

    // "When you play this Pokémon from your hand to evolve 1 of your Pokémon" Abilities. True if handled.
    async swshOnEvolve(p, m) {
      const k = m.card.powerKind, pw = m.card.power?.name;
      const say = () => this.plog(p, 'log.ability', { m: m.name, pw });
      if (k === 'drawOnEvolve3' || k === 'drawOnEvolve2') {
        const n = k === 'drawOnEvolve3' ? 3 : 2;
        if (p.deck.length && (await this.yesNo(p, 'prompt.q.drawOnEvolve', { c: pw, n }, `${pw}: draw ${n} cards?`, p.deck.length > 10 ? 1 : -1))) { say(); this.plog(p, 'log.t.drewN', { n: this.draw(p, n) }); }
        return true;
      }
      if (k === 'shadyDealings1' || k === 'shadyDealings2') {
        const n = k === 'shadyDealings2' ? 2 : 1;
        let got = 0;
        for (let i = 0; i < n; i++) {
          const x = await this.pickCard(p, 'search', p.deck.filter((y) => y.kind === 'trainer'), 'prompt.q.searchTrainer', { c: pw }, 'Choose a Trainer card from your deck.', { none: true, ai: (y) => (y.ttype === 'supporter' ? 3 : y.tkind === 'quickBall' || y.tkind === 'rareCandy' ? 2 : 1) });
          if (!x) break;
          p.hand.push(this.searchDeck(p, x)); got++;
        }
        if (got) { say(); this.plog(p, 'log.t.drewN', { n: got }); }
        shuffle(p.deck);
        return true;
      }
      return this.smOnEvolve(p, m);
    },
    // "When you play this Pokémon from your hand onto your Bench" Abilities. True if handled.
    async swshOnBench(p, m) {
      const k = m.card.powerKind, o = this.opp(p), pw = m.card.power?.name;
      const say = () => this.plog(p, 'log.ability', { m: m.name, pw });
      if (k === 'headbuttTantrum') {
        const t = await this.pickMonOrNone(p, 'snipe', this.allMons(o).filter((x) => !this.abilityImmune(x)), 'prompt.q.counters', { c: pw, n: 1 }, "You may put 1 damage counter on one of the opponent's Pokémon.", (x) => (x.hpLeft <= 10 ? 60 : 0) - x.hpLeft / 10, -50);
        if (t) { say(); await this.spread(m, [[t, 10]], { counters: true }); counterLog(this, t, 10); }
        return true;
      }
      if (k === 'mindReport') {
        const x = await this.pickCard(p, 'search', p.discard.filter((y) => y.ttype === 'supporter'), 'prompt.q.mindReport', { c: pw }, 'You may put a Supporter from your discard pile on top of your deck.', { none: true, ai: (y) => (y.tkind === 'bossOrders' ? 3 : 1) });
        if (x) { say(); p.deck.push(this.pullFromDiscard(p, x)); this.plog(p, 'log.onTop', { c: C(x) }); }
        return true;
      }
      if (k === 'cruelCharge') {
        let n = 0;
        for (let i = 0; i < 2; i++) {
          const en = await this.pickCard(p, 'discard', p.hand.filter(ofType('Psychic')), 'prompt.q.energyFromHand', { c: pw }, 'You may attach a basic Psychic Energy from your hand to this Pokémon.', { none: true, unique: false, ai: () => 1 });
          if (!en) break;
          await this.attachHandCard(p, en, m); n++;
        }
        if (n) say();
        return true;
      }
      if (k === 'pumpkinPit') {
        if (this.stadium && (await this.yesNo(p, 'prompt.q.pumpkinPit', { c: pw, s: C(this.stadium.card) }, `${pw}: discard the Stadium in play?`, this.stadium.owner === p.idx ? -1 : 1))) {
          say();
          this.players[this.stadium.owner].discard.push(this.stadium.card);
          this.log('log.stadiumOff', { c: C(this.stadium.card) });
          this.stadium = null;
        }
        return true;
      }
      return this.smOnBench(p, m);
    },
    // Libero: when this Pokémon moves from the Bench to the Active Spot during your turn.
    async swshBecameActive(p, m) {
      if (this.phase === 'checkup') return; // "during your turn": not when it is promoted in Pokémon Checkup
      if (m.card.powerKind !== 'libero' || !this.powerOn(m) || p.flags['libero' + m.id] || !p.discard.some(ofType('Fire'))) return;
      if (!(await this.yesNo(p, 'prompt.q.libero', { c: m.card.power.name, m: m.name }, `${m.card.power.name}: attach up to 2 Fire Energy from your discard pile to ${m.name}?`, 1))) return;
      p.flags['libero' + m.id] = true;
      this.plog(p, 'log.ability', { m: m.name, pw: m.card.power.name });
      await this.attachFromDiscard(p, [m], 2, ofType('Fire'), m.card.power.name, { upTo: true });
    },

    // ---------------- Stadiums ----------------
    swshStadiumActions(p, S) {
      const s = this.stadium?.card.stadium;
      if (s === 'towerOfDarkness' && p.deck.length && p.hand.some((x) => tag(x, 'Single Strike'))) S('towerOfDarkness', 'discard a Single Strike card from your hand to draw 2 cards. Once per turn.');
      if (s === 'trainingCourt' && p.discard.some(basicEnergy)) S('trainingCourt', 'put a basic Energy from your discard pile into your hand. Once per turn.');
      if (s === 'viridianForest' && p.hand.length && p.deck.some(basicEnergy)) S('viridianForest', 'discard a card from your hand to take a basic Energy from your deck. Once per turn.');
      this.smStadiumActions(p, S);
    },
    async swshUseStadium(p, act) {
      const s = this.stadium.card;
      switch (act.stadium) {
        case 'towerOfDarkness': {
          const d = await this.pickCard(p, 'discard', p.hand.filter((x) => tag(x, 'Single Strike')), 'prompt.q.discard1', { c: C(s) }, 'Discard a Single Strike card from your hand.', { unique: false, ai: (x) => (x.kind === 'energy' ? 0 : 1) });
          if (d) { p.discard.push(this.takeFromHand(p, d)); this.plog(p, 'log.t.drewN', { n: this.draw(p, 2) }); }
          break;
        }
        case 'trainingCourt': {
          const en = await this.pickCard(p, 'search', p.discard.filter(basicEnergy), 'prompt.q.fromDiscard', { c: C(s) }, 'Choose a basic Energy from your discard pile.', { ai: () => 1 });
          if (en) { p.hand.push(this.pullFromDiscard(p, en)); this.plog(p, 'log.t.got', { c: C(s), got: C(en) }); }
          break;
        }
        case 'viridianForest': {
          const d = await this.pickCard(p, 'discard', p.hand, 'prompt.q.discard1', { c: C(s) }, 'Discard a card from your hand.', { unique: false, ai: (x) => (x.kind === 'pokemon' && x.stage > 0 ? -1 : x.kind === 'energy' ? 0 : 1) });
          if (d) p.discard.push(this.takeFromHand(p, d));
          const en = await this.pickCard(p, 'search', p.deck.filter(basicEnergy), 'prompt.q.searchEnergy', { c: C(s) }, 'Choose a basic Energy from your deck.', { ai: () => 1 });
          if (en) { p.hand.push(this.searchDeck(p, en)); this.plog(p, 'log.t.got', { c: C(s), got: C(en) }); }
          shuffle(p.deck);
          break;
        }
        default: return this.smUseStadium(p, act);
      }
      return false;
    },

    // ---------------- Trainer cards ----------------
    swshVTrainerActions(p, o, c, once, T) {
      const mons = this.allMons(p), others = p.hand.length - 1, deckHas = (f) => p.deck.some(f), bench = p.bench.length < MAX_BENCH;
      const firstTurn = this.turn === (this.first === p ? 1 : 2);
      switch (c.tkind) {
        case 'barry': if (p.deck.length && once('barry')) T('barry', {}, 'draw 3 cards.'); break;
        case 'shauna': if ((p.deck.length || p.hand.length > 1) && once('shauna')) T('shauna', {}, 'shuffle your hand into your deck and draw 5 cards.'); break;
        case 'bugCatcher': if (p.deck.length && once('bug')) T('bugCatcher', {}, 'draw 2 cards, then flip a coin: heads, draw 2 more.'); break;
        case 'gymTrainer': if (p.deck.length && once('gym')) T('gymTrainer', {}, `draw ${this.koLastTurn(p) ? 4 : 2} cards${this.koLastTurn(p) ? ' (one of your Pokémon was Knocked Out last turn)' : ''}.`); break;
        case 'bruno': if (once('bruno')) T('bruno', {}, `shuffle your hand into your deck and draw ${this.koLastTurn(p) ? 7 : 4} cards.`); break;
        case 'copycat': if (once('copycat')) T('copycat', {}, `shuffle your hand into your deck and draw as many cards as the opponent has (${o.hand.length}).`); break;
        case 'korrinasFocus': if (p.deck.length && others < 6 && once('korrina')) T('korrinasFocus', {}, 'draw until you have 6 cards in your hand.'); break;
        case 'marnie': if ((p.hand.length > 1 || o.hand.length) && once('marnie')) T('marnie', {}, 'both players put their hands on the bottom of their decks; you draw 5, the opponent draws 4.'); break;
        case 'roxanne': if (o.prizes.length <= 3 && once('roxanne')) T('roxanne', {}, 'both players shuffle their hands into their decks; you draw 6, the opponent draws 2.'); break;
        case 'milo': if (others >= 1 && p.deck.length && once('milo')) T('milo', {}, 'discard up to 2 cards from your hand and draw 2 for each.'); break;
        case 'cheryl': if (mons.some((x) => x.card.stage > 0 && x.damage) && once('cheryl')) T('cheryl', {}, 'heal all damage from each of your Evolution Pokémon; those healed discard all their Energy.'); break;
        case 'gordie': if (p.deck.length && once('gordie')) T('gordie', {}, 'look at the top 7 cards of your deck and take any Energy cards among them.'); break;
        case 'lady': if (deckHas(basicEnergy) && once('lady')) T('lady', {}, 'take up to 4 basic Energy cards from your deck.'); break;
        case 'melony': if (mons.some((x) => isV(x.card)) && p.discard.some((x) => x.kind === 'energy' && x.energyType === 'Water') && once('melony')) T('melony', {}, 'attach a Water Energy from your discard pile to one of your Pokémon V, then draw 3 cards.'); break;
        case 'elesasSparkle': if (mons.some((x) => tag(x.card, 'Fusion Strike')) && deckHas((x) => x.special === 'fusionStrike') && once('elesa')) T('elesasSparkle', {}, 'attach a Fusion Strike Energy from your deck to up to 2 of your Fusion Strike Pokémon.'); break;
        case 'guzmaHala': if (deckHas((x) => x.ttype === 'stadium' || x.ttype === 'tool' || (x.kind === 'energy' && x.special)) && once('guzma')) T('guzmaHala', {}, 'take a Stadium from your deck; you may discard 2 other cards to also take a Pokémon Tool and a Special Energy.'); break;
        case 'mallowLana': if (p.bench.length && once('mallow')) T('mallowLana', {}, 'switch your Active Pokémon with a Benched one; you may discard 2 other cards to heal 120 damage from the Pokémon moved to the Bench.'); break;
        case 'battleVipPass': if (firstTurn && bench && deckHas(isBasic) && once('vip')) T('battleVipPass', {}, 'put up to 2 Basic Pokémon from your deck onto your Bench (only during your first turn).'); break;
        case 'quickBall': if (others >= 1 && deckHas(isBasic) && once('quick')) T('quickBall', {}, 'discard another card from your hand to take a Basic Pokémon from your deck.'); break;
        case 'levelBall': if (deckHas((x) => x.kind === 'pokemon' && x.hp <= 90) && once('level')) T('levelBall', {}, 'take a Pokémon with 90 HP or less from your deck.'); break;
        case 'fogCrystal': if (deckHas((x) => ofType('Psychic')(x) || (isBasic(x) && x.type === 'Psychic')) && once('fog')) T('fogCrystal', {}, 'take a basic Psychic Energy or a Basic Psychic Pokémon from your deck.'); break;
        case 'energySpinner': if (deckHas(basicEnergy) && once('spinner')) T('energySpinner', {}, `take ${this.turn === 2 ? 'up to 3 basic Energy' : 'a basic Energy'} from your deck.`); break;
        case 'tagCall': if (deckHas((x) => tag(x, 'TAG TEAM')) && once('tagcall')) T('tagCall', {}, 'take up to 2 TAG TEAM cards from your deck.'); break;
        case 'eggIncubator': if (bench && deckHas(isBasic) && once('egg')) T('eggIncubator', {}, 'flip a coin: heads, put a Basic Pokémon from your deck onto your Bench; tails, this card goes to the bottom of your deck.'); break;
        case 'lureModule': if ((p.deck.length || o.deck.length) && once('lure')) T('lureModule', {}, 'each player reveals the top 3 cards of their deck and takes the Pokémon among them.'); break;
        case 'cramOMatic': if (p.hand.some((x) => x !== c && x.ttype === 'item') && p.deck.length && once('cram')) T('cramOMatic', {}, 'discard another Item from your hand, then flip a coin: heads, take any card from your deck.'); break;
        case 'trekkingShoes': if (p.deck.length && once('trek')) T('trekkingShoes', {}, 'look at the top card of your deck: keep it, or discard it and draw a card.'); break;
        case 'hisuianHeavyBall': if (once('heavy')) T('hisuianHeavyBall', {}, 'look at your Prize cards; you may swap a Basic Pokémon among them for this card.'); break;
        case 'powerTablet': if (mons.some((x) => tag(x.card, 'Fusion Strike')) && once('tablet')) T('powerTablet', {}, 'your Fusion Strike Pokémon do 30 more damage to the Defending Pokémon this turn.'); break;
        case 'urnOfVitality': if (p.discard.some((x) => x.special === 'singleStrike') && once('urn')) T('urnOfVitality', {}, 'shuffle up to 2 Single Strike Energy from your discard pile into your deck.'); break;
        case 'echoingHorn': if (o.bench.length < MAX_BENCH && o.discard.some(isBasic) && once('horn')) T('echoingHorn', {}, "put a Basic Pokémon from the opponent's discard pile onto their Bench."); break;
        case 'fanOfWaves': if (this.allMons(o).some((x) => x.energy.some((en) => en.special)) && once('fan')) T('fanOfWaves', {}, "put a Special Energy attached to one of the opponent's Pokémon on the bottom of their deck."); break;
        case 'toolScrapper': if (this.players.some((q) => this.allMons(q).some((x) => x.tools.length)) && once('scrap')) T('toolScrapper', {}, 'discard up to 2 Pokémon Tools attached to any Pokémon.'); break;
        case 'greatCatcher':
          if (others >= 2) for (const b of o.bench) if ((tag(b.card, 'GX') || tag(b.card, 'EX')) && once('gc' + b.id)) T('greatCatcher', { m: b.name }, `discard 2 other cards to pull the opponent's Benched ${b.name} (a Pokémon-GX/EX) into the Active Spot.`, { target: b });
          break;
        case 'scoopUpNet': for (const m of mons) if (!isV(m.card) && !tag(m.card, 'GX') && (m !== p.active || p.bench.length) && once('scoop' + m.id)) T('scoopUpNet', { m: m.name }, `put ${m.name} (and its evolutions) back into your hand; attached cards are discarded.`, { target: m }); break;
        case 'switchCart': if (p.active && p.active.card.stage === 0 && p.bench.length && once('cart')) T('switchCart', {}, `switch your Active Basic ${p.active.name} with a Benched Pokémon and heal 30 damage from it.`); break;
        case 'luckyIcePop': if (p.active?.damage && once('icepop')) T('luckyIcePop', {}, `heal 20 damage from your Active ${p.active.name}; on heads, this card goes back to your hand.`); break;
        case 'suspiciousFoodTin': if (mons.some((x) => x.damage && x.energy.some((en) => isType(en.energyType, 'Psychic'))) && once('tin')) T('suspiciousFoodTin', {}, 'heal 80 damage from one of your Pokémon with Psychic Energy, then discard a Psychic Energy from it.'); break;
        default: this.smTrainerActions(p, o, c, once, T);
      }
    },

    async playSwshVTrainer(p, o, c, act, L) {
      const pokeAi = (x) => (x.stage > 0 && this.allMons(p).some((y) => y.name === x.evolvesFrom) ? 10 : 0) + (x.prizes ? 6 : 0) + (x.stage === 0 && p.bench.length < MAX_BENCH ? 3 : 0);
      const take = async (ok, text, en, { none = false, ai = pokeAi } = {}) => {
        const x = await this.pickCard(p, 'search', p.deck.filter(ok), text, { c: C(c) }, en, { none, ai });
        if (x) p.hand.push(p.deck.splice(p.deck.indexOf(x), 1)[0]);
        return x;
      };
      const discardOther = async (k, n, ok = () => true) => {
        const d = await this.pickCard(p, 'discard', p.hand.filter(ok), n > 1 ? 'prompt.q.discardK' : 'prompt.q.discard1', { c: C(c), k, n }, 'Choose a card from your hand to discard.', { unique: false, ai: (x) => (x.kind === 'energy' ? 1 : x.kind === 'pokemon' && x.stage === 0 ? 0.5 : 0) });
        if (d) p.discard.push(this.takeFromHand(p, d));
        return d;
      };
      const coin = (heads) => this.flip('trainer', { c: C(c) }, [{ key: 'coin.o.' + heads, params: heads === 'draw' ? { n: 2 } : {} }, { key: 'coin.o.nothing', params: {} }]);
      const newHand = (q, n) => { this.shuffleHandIn(q); this.plog(q, 'log.t.newHand', { n: this.draw(q, n) }); };
      const benchBasics = async (max) => {
        let n = 0;
        for (let k = 0; k < max && p.bench.length < MAX_BENCH; k++) {
          const x = await this.pickCard(p, 'search', p.deck.filter(isBasic), 'prompt.q.callFamily', { c: C(c) }, 'Choose a Basic Pokémon to put onto your Bench.', { none: true, ai: (y) => y.hp + (y.prizes ? 30 : 0) });
          if (!x) break;
          await this.benchFromDeck(p, x); n++;
        }
        shuffle(p.deck);
        return n;
      };
      const m = act.target;
      switch (c.tkind) {
        case 'barry': L('drew', { n: this.draw(p, 3) }); break;
        case 'shauna': newHand(p, 5); break;
        case 'bugCatcher': { let n = this.draw(p, 2); if (await coin('draw')) n += this.draw(p, 2); L('drew', { n }); break; }
        case 'gymTrainer': L('drew', { n: this.draw(p, this.koLastTurn(p) ? 4 : 2) }); break;
        case 'bruno': newHand(p, this.koLastTurn(p) ? 7 : 4); break;
        case 'copycat': { const n = o.hand.length; newHand(p, n); break; }
        case 'korrinasFocus': L('drew', { n: this.draw(p, Math.max(0, 6 - p.hand.length)) }); break;
        case 'marnie': {
          const any = p.hand.length || o.hand.length;
          for (const q of [p, o]) { shuffle(q.hand); q.deck.unshift(...q.hand); q.hand = []; }
          if (any) { this.plog(p, 'log.t.newHand', { n: this.draw(p, 5) }); this.plog(o, 'log.t.newHand', { n: this.draw(o, 4) }); }
          break;
        }
        case 'roxanne': newHand(p, 6); newHand(o, 2); break;
        case 'milo': {
          let k = 0;
          for (let i = 0; i < 2 && p.hand.length; i++) {
            const d = await this.pickCard(p, 'discard', p.hand, 'prompt.q.discardK', { c: C(c), k: i + 1, n: 2 }, 'Choose a card to discard (2 cards drawn for each).', { none: i > 0, unique: false, ai: (x) => (x.kind === 'energy' && p.hand.filter((y) => y.kind === 'energy').length > 1 ? 1 : -1) });
            if (!d) break;
            p.discard.push(this.takeFromHand(p, d)); k++;
          }
          L('drew', { n: this.draw(p, 2 * k) });
          break;
        }
        case 'cheryl': {
          let healed = 0;
          for (const x of this.allMons(p).filter((y) => y.card.stage > 0 && y.damage)) {
            const h = await this.heal(x, x.damage);
            if (h) { healed++; p.discard.push(...x.energy.splice(0)); }
          }
          L('cheryl', { n: healed });
          break;
        }
        case 'gordie': {
          const top = p.deck.slice(-7);
          let n = 0;
          for (;;) { // "any number of Energy cards you find there"
            const en = await this.pickCard(p, 'search', top.filter((x) => x.kind === 'energy' && p.deck.includes(x)), 'prompt.q.searchEnergyAny', { c: C(c) }, 'Take an Energy card? (Choose nothing to stop.)', { none: true, unique: false, ai: () => 1 });
            if (!en) break;
            p.deck.splice(p.deck.indexOf(en), 1); p.hand.push(en); n++;
          }
          shuffle(p.deck);
          L('gotN', { n });
          break;
        }
        case 'lady': {
          let n = 0;
          for (let k = 0; k < 4; k++) if (await take(basicEnergy, 'prompt.q.searchEnergy', 'Choose a basic Energy.', { none: true, ai: () => 1 })) n++;
          shuffle(p.deck);
          L('gotN', { n });
          break;
        }
        case 'melony': {
          const done = await this.attachFromDiscard(p, this.allMons(p).filter((x) => isV(x.card)), 1, (x) => x.kind === 'energy' && x.energyType === 'Water', c.name);
          if (done) L('drew', { n: this.draw(p, 3) });
          break;
        }
        case 'elesasSparkle': {
          const fusion = this.allMons(p).filter((x) => tag(x.card, 'Fusion Strike'));
          let n = 0;
          for (let k = 0; k < 2 && fusion.length; k++) {
            const en = p.deck.find((x) => x.special === 'fusionStrike');
            if (!en) break;
            const t = await this.pickMonOrNone(p, 'attachTo', fusion, 'prompt.q.attachTo', { c: C(c) }, 'Attach a Fusion Strike Energy to which Pokémon?', (x) => (x === p.active ? 2 : 0) + (x.card.prizes || 0), k ? 0 : -5);
            if (!t) break;
            fusion.splice(fusion.indexOf(t), 1);
            await this.hooks.onAttach?.({ p: p.idx, mon: t.id, card: en });
            t.energy.push(this.searchDeck(p, en)); n++;
            this.plog(p, 'log.energy', { c: C(en), m: t.name });
          }
          shuffle(p.deck);
          break;
        }
        case 'guzmaHala': {
          // The optional 2 discards are paid first, from the cards in hand when Guzma & Hala was played.
          const paid = p.hand.length >= 2 && p.deck.some((x) => x.ttype === 'tool' || (x.kind === 'energy' && x.special)) &&
            (await this.yesNo(p, 'prompt.q.guzmaHala', { c: C(c) }, 'Discard 2 other cards to also take a Pokémon Tool and a Special Energy?', p.hand.length >= 4 ? 1 : -1));
          if (paid) for (let k = 0; k < 2; k++) await discardOther(k + 1, 2);
          await take((x) => x.ttype === 'stadium', 'prompt.q.searchTrainer', 'Choose a Stadium card.', { none: true, ai: () => 1 });
          if (paid) {
            await take((x) => x.ttype === 'tool', 'prompt.q.searchTrainer', 'Choose a Pokémon Tool.', { none: true, ai: () => 1 });
            await take((x) => x.kind === 'energy' && x.special, 'prompt.q.searchEnergyAny', 'Choose a Special Energy.', { none: true, ai: () => 1 });
          }
          shuffle(p.deck);
          L('played');
          break;
        }
        case 'mallowLana': {
          const old = p.active;
          const t = await this.pickMon(p, 'promote', p.bench, 'prompt.q.switchSelf', { c: C(c) }, 'Choose which Benched Pokémon becomes Active.', (x) => x.hpLeft / 10 + x.energy.length * 5);
          this.swapActive(p, t);
          L('switch', { m: p.active.name });
          await this.becameActive(p);
          if (old.damage && p.hand.length >= 2 && (await this.yesNo(p, 'prompt.q.mallowLana', { c: C(c), m: old.name }, `Discard 2 other cards to heal 120 damage from ${old.name}?`, old.damage >= 60 ? 1 : -1))) {
            for (let k = 0; k < 2; k++) await discardOther(k + 1, 2);
            await this.heal(old, 120);
          }
          break;
        }
        case 'battleVipPass': L('benched', { n: await benchBasics(2) }); break;
        case 'quickBall': { await discardOther(1, 1); const x = await take(isBasic, 'prompt.q.searchPokemon', 'Choose a Basic Pokémon.'); shuffle(p.deck); if (x) L('got', { got: C(x) }); break; }
        case 'levelBall': { const x = await take((y) => y.kind === 'pokemon' && y.hp <= 90, 'prompt.q.searchPokemon', 'Choose a Pokémon with 90 HP or less.'); shuffle(p.deck); if (x) L('got', { got: C(x) }); break; }
        case 'fogCrystal': { const x = await take((y) => ofType('Psychic')(y) || (isBasic(y) && y.type === 'Psychic'), 'prompt.q.searchAny', 'Choose a basic Psychic Energy or a Basic Psychic Pokémon.', { ai: (y) => (y.kind === 'pokemon' ? 2 : 1) }); shuffle(p.deck); if (x) L('got', { got: C(x) }); break; }
        case 'energySpinner': {
          let n = 0;
          for (let k = 0; k < (this.turn === 2 ? 3 : 1); k++) if (await take(basicEnergy, 'prompt.q.searchEnergy', 'Choose a basic Energy.', { none: true, ai: () => 1 })) n++;
          shuffle(p.deck);
          L('gotN', { n });
          break;
        }
        case 'tagCall': {
          let n = 0;
          for (let k = 0; k < 2; k++) if (await take((x) => tag(x, 'TAG TEAM'), 'prompt.q.searchAny', 'Choose a TAG TEAM card.', { none: true, ai: (x) => (x.kind === 'pokemon' ? 2 : 1) })) n++;
          shuffle(p.deck);
          L('gotN', { n });
          break;
        }
        case 'eggIncubator': {
          if (await coin('search')) L('benched', { n: await benchBasics(1) });
          else { p.deck.unshift(this.pullFromDiscard(p, c)); L('eggBottom'); }
          break;
        }
        case 'lureModule': {
          for (const q of [p, o]) {
            const top = q.deck.splice(-3);
            const mons = top.filter((x) => x.kind === 'pokemon');
            q.hand.push(...mons);
            q.deck.push(...top.filter((x) => x.kind !== 'pokemon'));
            shuffle(q.deck);
            this.plog(q, 'log.lureModule', { n: mons.length, list: mons.map((x) => x.name).join(', ') || '—' });
          }
          break;
        }
        case 'cramOMatic': {
          await discardOther(1, 1, (x) => x.ttype === 'item');
          if (await coin('search')) {
            const x = await take(() => true, 'prompt.q.searchAny', 'Choose any card from your deck.', { ai: (y) => (y.ttype === 'supporter' ? 4 : y.kind === 'pokemon' && y.prizes ? 3 : 1) });
            if (x) L('got', { got: SECRET(p, C(x)) });
            shuffle(p.deck);
          } else L('nothing');
          break;
        }
        case 'trekkingShoes': {
          const top = p.deck[p.deck.length - 1];
          const keep = await this.yesNo(p, 'prompt.q.trekking', { c: C(c), x: C(top) }, `Trekking Shoes: the top card is ${top.name}. Put it into your hand? (No: discard it and draw a card.)`, top.kind === 'energy' || top.ttype === 'supporter' || top.kind === 'pokemon' ? 1 : -1);
          if (keep) { p.hand.push(p.deck.pop()); L('trekKeep'); }
          else { p.discard.push(p.deck.pop()); L('trekDiscard', { x: C(top), n: this.draw(p, 1) }); }
          break;
        }
        case 'hisuianHeavyBall': {
          // You look at all your Prize cards (only the Basic Pokémon can be taken); they are shuffled again either way.
          this.plog(p, 'log.peekPrize', { list: SECRET(p, p.prizes.map((y) => y.name).join(', ')), n: p.prizes.length });
          const x = await this.pickCard(p, 'search', p.prizes.filter(isBasic), 'prompt.q.heavyBall', { c: C(c) }, 'You may take a Basic Pokémon from your Prize cards (this card takes its place).', { none: true, unique: false, ai: (y) => y.hp });
          if (x) { p.prizes.splice(p.prizes.indexOf(x), 1); p.hand.push(x); p.prizes.push(this.pullFromDiscard(p, c)); shuffle(p.prizes); L('got', { got: C(x) }); }
          else { shuffle(p.prizes); L('nothing'); }
          break;
        }
        case 'powerTablet': p.flags.powerTablet = (p.flags.powerTablet || 0) + 1; this.plog(p, 'log.boost', { n: 30, t: { $type: 'Colorless' } }); break;
        case 'urnOfVitality': {
          let n = 0;
          for (let k = 0; k < 2; k++) { const en = p.discard.find((x) => x.special === 'singleStrike'); if (!en) break; p.deck.push(this.pullFromDiscard(p, en)); n++; }
          shuffle(p.deck);
          L('shuffledBack', { n });
          break;
        }
        case 'echoingHorn': {
          const x = await this.pickCard(p, 'search', o.discard.filter(isBasic), 'prompt.q.echoingHorn', { c: C(c) }, "Choose a Basic Pokémon from the opponent's discard pile to put onto their Bench.", { ai: (y) => -y.hp + (y.prizes ? 50 : 0) });
          if (x) { const nm = new Mon(this.pullFromDiscard(o, x), this.turn); o.bench.push(nm); this.plog(o, 'log.bench', { c: C(x) }); }
          break;
        }
        case 'fanOfWaves': {
          const pool = this.allMons(o).flatMap((x) => x.energy.filter((en) => en.special).map((en) => [x, en]));
          const t = await this.pickMon(p, 'snipe', [...new Set(pool.map(([x]) => x))], 'prompt.q.fanOfWaves', { c: C(c) }, "Remove a Special Energy from which of the opponent's Pokémon?", (x) => (x === o.active ? 2 : 0) + x.energy.filter((en) => en.special).length);
          const en = await this.chooseEnergy(p, t, t.energy.filter((y) => y.special), 'prompt.q.fanOfWavesWhich', 'Which Special Energy goes to the bottom of their deck?');
          t.energy.splice(t.energy.indexOf(en), 1);
          o.deck.unshift(en);
          this.log('log.energyBottom', { m: t.name, c: C(en) }, 'status');
          break;
        }
        case 'toolScrapper': {
          let n = 0;
          for (let k = 0; k < 2; k++) {
            const holders = this.players.flatMap((q) => this.allMons(q)).filter((x) => x.tools.length);
            const t = await this.pickMonOrNone(p, 'snipe', holders, 'prompt.q.toolScrapper', { c: C(c) }, 'Discard the Pokémon Tool from which Pokémon?', (x) => (this.ownerOf(x) === o ? 3 : -3), k ? 0 : -5);
            if (!t) break;
            const q = this.ownerOf(t);
            q.discard.push(t.tools.shift().card); n++;
            this.log('log.toolsDiscarded', { m: t.name, n: 1 }, 'status');
          }
          break;
        }
        case 'greatCatcher': {
          for (let k = 0; k < 2; k++) await discardOther(k + 1, 2);
          this.swapActive(o, m);
          this.log('log.lure', { m: m.name });
          break;
        }
        case 'scoopUpNet': {
          const cards = this.removeFromPlay(p, m);
          const mons = cards.filter((x) => x.kind === 'pokemon');
          p.hand.push(...mons);
          p.discard.push(...cards.filter((x) => !mons.includes(x)));
          L('scoop', { m: m.name });
          await this.refillActive();
          break;
        }
        case 'switchCart': {
          const old = p.active;
          const t = await this.pickMon(p, 'promote', p.bench, 'prompt.q.switchSelf', { c: C(c) }, 'Choose which Benched Pokémon becomes Active.', (x) => x.hpLeft / 10 + x.energy.length * 5);
          this.swapActive(p, t);
          L('switch', { m: p.active.name });
          await this.becameActive(p);
          await this.heal(old, 30);
          break;
        }
        case 'luckyIcePop': {
          const h = await this.heal(p.active, 20);
          if (h && (await coin('backToHand'))) { p.hand.push(this.pullFromDiscard(p, c)); L('icePop'); }
          break;
        }
        case 'suspiciousFoodTin': {
          const t = await this.pickMon(p, 'heal', this.allMons(p).filter((x) => x.damage && x.energy.some((en) => isType(en.energyType, 'Psychic'))), 'prompt.q.healWhich', { c: C(c), n: 80 }, 'Heal 80 damage from which Pokémon?', (x) => x.damage);
          const h = await this.heal(t, 80);
          if (h) { const en = t.energy.find((y) => isType(y.energyType, 'Psychic')); t.energy.splice(t.energy.indexOf(en), 1); p.discard.push(en); }
          break;
        }
        default: return this.playSmTrainer(p, o, c, act, L);
      }
    },

    // ---------------- Attack effects ----------------
    async swshVPreDamage(p, a, atk, fx) {
      let bonus = 0;
      // Spiral Jet: discard Energy cards from your hand, or the attack does nothing.
      if (fx.discardHandOrFail) {
        const ok = (x) => x.kind === 'energy' && x.energyType === fx.discardHandOrFail.type;
        if (p.hand.filter(ok).length < fx.discardHandOrFail.n) { this.log('log.failed', { atk: atk.name }); return -1e9; }
        for (let k = 0; k < fx.discardHandOrFail.n; k++) p.discard.push(this.takeFromHand(p, p.hand.find(ok)));
        this.plog(p, 'log.handEnergyDiscarded', { n: fx.discardHandOrFail.n, t: { $type: fx.discardHandOrFail.type } });
      }
      if (fx.discardSelfBonus && a.energy.length) {
        const n = await this.pickNumber(p, 'drawN', Math.min(fx.discardSelfBonus.max, a.energy.length), 'prompt.q.discardSelfHowMany', { c: atk.name, n: fx.discardSelfBonus.n }, `How many Energy do you discard from this Pokémon (${fx.discardSelfBonus.n} more damage each)?`, (k) => k);
        p.discard.push(...a.energy.splice(-n || a.energy.length, n));
        bonus += fx.discardSelfBonus.n * n;
      }
      if (fx.discardTypeTimes) {
        const types = fx.discardTypeTimes.types.filter((t) => a.energy.some((en) => !en.special && en.energyType === t));
        if (types.length) {
          const t = types.length === 1 ? types[0] : await this.pick(p, 'type', 'prompt.gen.title', 'prompt.q.whichType', types.map((x) => ({ id: x, label: { key: 'type.' + x }, en: x, ai: a.energy.filter((en) => en.energyType === x).length })), { params: { c: atk.name }, en: 'Discard which type of Energy?' });
          const pool = a.energy.filter((en) => !en.special && en.energyType === (types.includes(t) ? t : types[0]));
          const n = await this.pickNumber(p, 'drawN', Math.min(fx.discardTypeTimes.max, pool.length), 'prompt.q.discardSelfHowMany', { c: atk.name, n: fx.discardTypeTimes.n }, `How many do you discard (${fx.discardTypeTimes.n} more damage each)?`, (k) => k);
          for (const en of pool.slice(0, n)) p.discard.push(...a.energy.splice(a.energy.indexOf(en), 1));
          bonus += fx.discardTypeTimes.n * n;
        }
      }
      return bonus + (await this.smPreDamage(p, a, atk, fx));
    },

    async swshVAfter(p, o, a, d, atk, fx) {
      const inPlay = this.allMons(p).includes(a);
      if (fx.allHeadsShield && this.multiHeads === fx.flipMulti && inPlay) { a.effects.shield = { kind: 'all', expires: this.turn + 1 }; this.log('log.shield.all', { m: a.name }, 'status'); }
      if (fx.alteredCreation) {
        p.until.alteredCreation = 1e9;
        const extra = a.energyTypes.filter((t) => isType(t, fx.alteredCreation.type)).length >= 1 && a.energyTypes.length > atk.cost.length;
        if (extra) p.until.alteredPrize = 1e9;
        this.plog(p, extra ? 'log.alteredCreationPrize' : 'log.alteredCreation', {});
      }
      if (fx.discardAllType) {
        const out = a.energy.filter((en) => isType(en.energyType, fx.discardAllType) && !en.special);
        a.energy = a.energy.filter((en) => !out.includes(en));
        p.discard.push(...out);
        if (out.length) this.log('log.discardedN', { m: a.name, n: out.length }, 'status');
      }
      // Decorate: attach any number of basic Energy from your hand.
      if (fx.attachHandAny) {
        for (let k = 0; k < 20 && p.hand.some(basicEnergy); k++) {
          const en = await this.pickCard(p, 'discard', p.hand.filter(basicEnergy), 'prompt.q.energyFromHand', { c: atk.name }, 'Attach a basic Energy from your hand? (Choose nothing to stop.)', { none: true, unique: false, ai: () => 1 });
          if (!en) break;
          const t = await this.pickMon(p, 'attachTo', this.allMons(p), 'prompt.q.attachTo', { c: atk.name }, `Attach ${en.name} to which Pokémon?`, (x) => -this.energyGap(x) * -1);
          await this.attachHandCard(p, en, t);
        }
      }
      if (fx.attachHandSelf && inPlay) {
        const en = await this.pickCard(p, 'discard', p.hand.filter((x) => x.kind === 'energy' && x.energyType === fx.attachHandSelf.type), 'prompt.q.energyFromHand', { c: atk.name }, `You may attach a ${fx.attachHandSelf.type} Energy from your hand to this Pokémon.`, { none: true, unique: false, ai: () => 1 });
        if (en) await this.attachHandCard(p, en, a);
      }
      if (fx.attachHandBench && p.bench.length) {
        const en = await this.pickCard(p, 'discard', p.hand.filter((x) => x.kind === 'energy' && x.energyType === fx.attachHandBench.type), 'prompt.q.energyFromHand', { c: atk.name }, `You may attach a ${fx.attachHandBench.type} Energy from your hand to a Benched Pokémon.`, { none: true, unique: false, ai: () => 1 });
        if (en) await this.attachHandCard(p, en, await this.pickMon(p, 'attachTo', p.bench, 'prompt.q.attachTo', { c: atk.name }, 'Attach it to which Benched Pokémon?', (x) => -this.energyGap(x) * -1));
      }
      // Ultimate Ray / Call to Muster: basic Energy from the deck, attached to your Pokémon in any way.
      if (fx.searchAttachAny) {
        for (let k = 0; k < fx.searchAttachAny.n; k++) {
          const en = await this.pickCard(p, 'search', p.deck.filter(basicEnergy), 'prompt.q.searchEnergy', { c: atk.name }, 'Choose a basic Energy to attach.', { none: true, ai: () => 1 });
          if (!en) break;
          const t = await this.pickMon(p, 'attachTo', this.allMons(p), 'prompt.q.attachTo', { c: atk.name }, `Attach ${en.name} to which Pokémon?`, (x) => -this.energyGap(x) * -1);
          await this.hooks.onAttach?.({ p: p.idx, mon: t.id, card: en });
          t.energy.push(this.searchDeck(p, en));
          this.plog(p, 'log.energy', { c: C(en), m: t.name });
        }
        shuffle(p.deck);
      }
      // Crescent Glow / Synthesis: Energy of a type from the deck, all onto 1 of your Pokémon.
      if (fx.searchAttachOne) {
        const ok = (x) => x.kind === 'energy' && x.energyType === fx.searchAttachOne.type && !x.special;
        const n = fx.searchAttachOne.firstTurnN && this.turn === 2 ? fx.searchAttachOne.firstTurnN : fx.searchAttachOne.n;
        if (p.deck.some(ok)) {
          const t = await this.pickMon(p, 'attachTo', this.allMons(p), 'prompt.q.attachTo', { c: atk.name }, 'Attach the Energy to which Pokémon?', (x) => -this.energyGap(x) * -1 + (x.card.prizes || 0));
          for (let k = 0; k < n; k++) {
            const en = p.deck.find(ok);
            if (!en) break;
            await this.hooks.onAttach?.({ p: p.idx, mon: t.id, card: en });
            t.energy.push(this.searchDeck(p, en));
            this.plog(p, 'log.energy', { c: C(en), m: t.name });
          }
        }
        shuffle(p.deck);
      }
      if (fx.attachDiscardOne && p.discard.some(ofType(fx.attachDiscardOne.type))) {
        const t = await this.pickMon(p, 'attachTo', this.allMons(p), 'prompt.q.attachTo', { c: atk.name }, 'Attach the Energy to which Pokémon?', (x) => -this.energyGap(x) * -1);
        await this.attachFromDiscard(p, [t], fx.attachDiscardOne.n, ofType(fx.attachDiscardOne.type), atk.name, { upTo: /up to/i.test(atk.text || '') });
      }
      if (fx.benchCounters && o.bench.length) {
        const t = await this.pickMon(p, 'snipe', o.bench.filter((x) => !this.effectsBlocked(x)), 'prompt.q.counters', { c: atk.name, n: fx.benchCounters / 10 }, "Put damage counters on which of the opponent's Benched Pokémon?", (x) => (x.hpLeft <= fx.benchCounters ? 80 : 0) - x.hpLeft / 10);
        if (t) { await this.spread(a, [[t, fx.benchCounters]], { counters: true }); counterLog(this, t, fx.benchCounters); }
      }
      if (fx.countersMulti) {
        const pool = this.allMons(o).filter((x) => !this.effectsBlocked(x));
        const picked = [];
        for (let k = 0; k < fx.countersMulti.count && pool.length; k++) {
          const t = await this.pickMon(p, 'snipe', pool, 'prompt.q.counters', { c: atk.name, n: fx.countersMulti.n / 10 }, `Put ${fx.countersMulti.n / 10} damage counters on which of the opponent's Pokémon?`, (x) => (x.hpLeft <= fx.countersMulti.n ? 80 + (x.card.prizes || 1) * 10 : 0) - x.hpLeft / 10);
          pool.splice(pool.indexOf(t), 1); picked.push(t);
        }
        if (picked.length) {
          await this.spread(a, picked.map((x) => [x, fx.countersMulti.n]), { counters: true });
          this.log('log.counters', { n: fx.countersMulti.n / 10, list: picked.map((x) => x.name).join(', ') }, 'dmg');
        }
      }
      if (fx.healBenchAll) {
        const t = await this.pickMon(p, 'heal', p.bench.filter((x) => x.damage), 'prompt.q.healWhich', { c: atk.name, n: '∞' }, 'Heal all damage from which Benched Pokémon?', (x) => x.damage);
        if (t) await this.heal(t, t.damage);
      }
      if (fx.healAllOwn) for (const x of this.allMons(p)) if (x.damage) await this.heal(x, fx.healAllOwn);
      if (fx.discardHandDraw && p.hand.length) {
        const dc = await this.pickCard(p, 'discard', p.hand, 'prompt.q.discard1', { c: atk.name }, 'Discard a card from your hand to draw 3.', { unique: false, ai: (x) => (x.kind === 'energy' ? 1 : 0) });
        if (dc) { p.discard.push(this.takeFromHand(p, dc)); this.plog(p, 'log.t.drewN', { n: this.draw(p, fx.discardHandDraw) }); }
      }
      if (fx.peekOppTop && o.deck.length) this.plog(p, 'log.peekTop', { x: SECRET(p, C(o.deck[o.deck.length - 1])) });
      if (fx.searchStadium) { // "up to N" (true: 1)
        for (let k = 0; k < (fx.searchStadium === true ? 1 : fx.searchStadium); k++) {
          const x = await this.pickCard(p, 'search', p.deck.filter((y) => y.ttype === 'stadium'), 'prompt.q.searchTrainer', { c: atk.name }, 'Choose a Stadium card.', { none: true, ai: () => 1 });
          if (!x) break;
          p.hand.push(this.searchDeck(p, x)); this.plog(p, 'log.t.got', { c: atk.name, got: C(x) });
        }
        shuffle(p.deck);
      }
      if (fx.shadowMist) { o.until.noSpecialStadium = this.turn + 1; this.plog(o, 'log.shadowMist', {}); }
      if (fx.selfBenchAll && p.bench.length) {
        await this.spread(a, p.bench.map((x) => [x, fx.selfBenchAll]));
        this.log('log.benchSnipe', { n: fx.selfBenchAll, list: p.bench.map((x) => x.name).join(', ') }, 'dmg');
      }
      // Energy Warp: an Energy moves from one of the opponent's Benched Pokémon to their Active Pokémon.
      if (fx.energyWarp && o.active && o.bench.some((x) => x.energy.length)) {
        const t = await this.pickMon(p, 'snipe', o.bench.filter((x) => x.energy.length), 'prompt.q.energyWarp', { c: atk.name }, "Move an Energy from which of the opponent's Benched Pokémon to their Active Pokémon?", (x) => x.energy.length);
        const en = await this.chooseEnergy(p, t, t.energy, 'prompt.q.energyWarpWhich', 'Which Energy moves to their Active Pokémon?');
        t.energy.splice(t.energy.indexOf(en), 1);
        o.active.energy.push(en);
        this.log('log.energyWarp', { a: t.name, b: o.active.name, c: C(en) }, 'status');
      }
      if (fx.shuffleSelfMay && inPlay && p.bench.length &&
        (await this.yesNo(p, 'prompt.q.shuffleSelf', { c: atk.name, m: a.name }, `Shuffle ${a.name} and all attached cards into your deck?`, a.hpLeft <= 60 ? 1 : -1))) {
        p.deck.push(...this.removeFromPlay(p, a));
        shuffle(p.deck);
        this.plog(p, 'log.shuffledSelf', { m: a.name });
        await this.refillActive();
      }
      await this.smAfter(p, o, a, d, atk, fx);
    },
  });
}
