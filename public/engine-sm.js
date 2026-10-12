// Cards of the Sun & Moon theme decks (2017–2019), installed on the Game class by engine.js.
// Sun & Moon is played with today's rules; its cards add Ultra Beasts, the Lost Zone and many Abilities and Trainers.
// Reached from the hooks in engine-swsh-v.js (Trainers, Abilities, attack effects, Stadiums) and engine.js (damage, setup, KOs).

export function installSm(Game, { Mon, shuffle, C, SECRET, isBasic, isType, MAX_BENCH }) {
  const basicEnergy = (x) => x.kind === 'energy' && !x.special;
  const ofType = (type) => (x) => basicEnergy(x) && x.energyType === type;
  const tag = (c, t) => !!c?.tags?.includes(t);
  const isGXorEX = (c) => tag(c, 'GX') || tag(c, 'EX');
  const counterLog = (g, t, n) => g.log('log.counters', { n: n / 10, list: t.name }, 'dmg');

  Object.assign(Game.prototype, {
    // ---------------- Damage ----------------
    smAttackBonus(a, q) {
      if (!q) return 0;
      const d = this.opp(q).active, mons = this.allMons(q);
      let n = 0;
      if (mons.some((x) => x.card.powerKind === 'strongCheer' && this.powerOn(x))) n += 30; // only 1 Strong Cheer counts
      if (a.card.type === 'Metal') n += 10 * mons.filter((x) => x.card.powerKind === 'steelworker' && this.powerOn(x)).length;
      if ((a.card.type === 'Darkness' || a.card.type === 'Dragon') && this.stadiumIs('devouredField')) n += 10;
      if (q.flags.kukui) n += 20;
      if (a.card.powerKind === 'resoluteFlame' && this.powerOn(a) && d) n += 30 * this.allMons(this.opp(q)).filter((x) => isGXorEX(x.card)).length;
      return n;
    },
    smDefense(a, d, dmg, notes) {
      let cut = 0;
      if (d.card.powerKind === 'wallOfSand' && this.powerOn(d)) cut += 20;
      const q = this.ownerOf(d);
      // Power of Nature: no damage from Ultra Beasts to Pokémon with Grass Energy.
      if (q && tag(a.card, 'Ultra Beast') && d.energyTypes.some((t) => isType(t, 'Grass')) && this.allMons(q).some((x) => x.card.powerKind === 'powerOfNature' && this.powerOn(x))) { notes.push('shield'); return 0; }
      if (cut && dmg > 0) notes.push('reduce');
      dmg = Math.max(0, dmg - cut);
      if (dmg > 0 && d.effects.vulnerable) dmg += d.effects.vulnerable.n; // Clanging Scales
      return dmg;
    },
    // Luminous Barrier: no damage or effects from attacks of Pokémon-GX / EX.
    smBarrier(a, d) { return d.card.powerKind === 'luminousBarrier' && this.powerOn(d) && isGXorEX(a.card); },
    // The Weakness that applies: Perplexing Eyes changes it, Weakness Policy and Altar of the Sunne remove it.
    weaknessOf(d) {
      if (d.tools.some((t) => t.card.tool === 'weaknessPolicy')) return null;
      if (this.stadiumIs('altarOfTheSunne') && (d.card.type === 'Fire' || d.card.type === 'Metal')) return null;
      return d.effects.weakAs?.type || d.card.weakness;
    },
    smRetreat(p, m, c) {
      if (m.tools.some((t) => t.card.tool === 'escapeBoard')) c -= 1;
      if (this.stadiumIs('altarOfTheMoone') && m.energyTypes.some((t) => isType(t, 'Psychic') || isType(t, 'Darkness'))) c -= 2;
      if (m.card.powerKind === 'surgeSurfer' && this.powerOn(m) && this.stadium) c = 0;
      return c;
    },
    // Escape Board: retreat even while Asleep or Paralyzed.
    canRetreatStuck(m) { return m.tools.some((t) => t.card.tool === 'escapeBoard'); },
    // Roto Motor: with 9 or more Pokémon Tools in the discard pile, attacks cost nothing.
    smAttackCost(m, cost) {
      if (m.card.powerKind !== 'rotoMotor' || !this.powerOn(m)) return cost;
      const q = this.ownerOf(m);
      return q && q.discard.filter((x) => x.ttype === 'tool').length >= 9 ? [] : cost;
    },

    // ---------------- Knock Outs ----------------
    // Energy Grounding and Wishful Baton save Energy from a Knocked Out Pokémon.
    async smOnKO(q, m) {
      // Both need a Knock Out by damage from the opponent's attack (not damage counters).
      if (!this.koBy || this.ownerOf(this.koBy) === q || m.hitTurn !== this.turn) return;
      const alive = (x) => x !== m && x.damage < x.maxHp; // not Knocked Out in the same attack
      // Wishful Baton: up to 3 basic Energy to 1 Benched Pokémon (its owner picks them one by one).
      if (q.active === m && m.tools.some((t) => t.card.tool === 'wishfulBaton') && q.bench.some(alive) && m.energy.some(basicEnergy)) {
        const t = await this.pickMon(q, 'attachTo', q.bench.filter(alive), 'prompt.q.attachTo', { c: 'Wishful Baton' }, 'Wishful Baton: move the basic Energy to which Benched Pokémon?', (x) => -this.energyGap(x) * -1 + (x.card.prizes || 0));
        let n = 0;
        for (let k = 0; k < 3 && m.energy.some(basicEnergy); k++) {
          const en = await this.pickCard(q, 'search', m.energy.filter(basicEnergy), 'prompt.q.batonWhich', { m: t.name }, `Move which basic Energy to ${t.name}?`, { none: true, ai: () => 1 });
          if (!en) break;
          t.energy.push(...m.energy.splice(m.energy.indexOf(en), 1)); n++;
        }
        if (n) this.log('log.energyMovedN', { n, m: t.name }, 'status');
      }
      // Energy Grounding: each Lanturn (Active or Benched) may take a basic Energy from it; its owner picks which.
      for (const g of this.allMons(q).filter((x) => alive(x) && x.card.powerKind === 'energyGrounding' && this.powerOn(x))) {
        if (!m.energy.some(basicEnergy)) break;
        if (!(await this.yesNo(q, 'prompt.q.energyGrounding', { c: g.card.power.name, m: g.name }, `Energy Grounding: move a basic Energy from ${m.name} to ${g.name}?`, 1))) continue;
        const en = await this.chooseEnergy(q, m, m.energy.filter(basicEnergy), 'prompt.q.groundingWhich', `Move which basic Energy to ${g.name}?`);
        g.energy.push(...m.energy.splice(m.energy.indexOf(en), 1));
        this.log('log.grounding', { m: g.name, from: m.name }, 'status');
      }
    },

    // ---------------- Lost Zone ----------------
    toLostZone(p, cards) { (p.lost ||= []).push(...cards); },

    // ---------------- Abilities ----------------
    smAbilityAction(p, o, mon, kind, power, A, usable) {
      const hand = (f) => p.hand.some(f), deck = (f) => p.deck.some(f);
      switch (kind) {
        case 'illuminate': if (usable(mon) && deck((x) => x.kind === 'pokemon' && x.type === 'Grass')) A('take a Grass Pokémon from your deck. Once per turn.'); break;
        case 'magneticCircuit': if (hand((x) => x.kind === 'energy' && x.energyType === 'Lightning')) A('attach a Lightning Energy from your hand to one of your Pokémon. As often as you like.'); break;
        case 'roastReveal': if (usable(mon) && hand((x) => x.kind === 'energy' && x.energyType === 'Fire') && p.deck.length) A('discard a Fire Energy from your hand to draw 3 cards. Once per turn.'); break;
        case 'slushRush': if (usable(mon) && p.deck.length) A('draw a card. Once per turn.'); break;
        case 'weedOut': if (usable(mon) && p.bench.length > 3) A(`keep 3 of your Benched Pokémon and discard the other ${p.bench.length - 3}. Once per turn.`); break;
        case 'precognitiveAura': if (usable(mon) && p.deck.length && this.allMons(p).some((x) => x.name === 'Garchomp')) A('take any card from your deck (you have Garchomp in play). Once per turn.'); break;
        case 'darkInvitation': if (usable(mon) && o.bench.length < MAX_BENCH && o.hand.length) A("look at the opponent's hand: put a Basic Pokémon from it onto their Bench with 3 damage counters. Once per turn."); break;
        case 'psychicRecharge': if (usable(mon) && p.bench.length && p.discard.some((x) => x.kind === 'energy' && x.energyType === 'Psychic')) A('attach a Psychic Energy from your discard pile to one of your Benched Pokémon. Once per turn.'); break;
        case 'powerDraw': if (usable(mon) && p.hand.length && p.deck.length) A('discard a card from your hand to draw 3 cards. Once per turn.'); break;
        case 'smoothOver': if (usable(mon) && p.deck.length) A('search your deck for a card and put it on top of your deck. Once per turn.'); break;
        case 'unseenFlash': if (usable(mon) && p.hand.filter((x) => x.kind === 'energy' && x.energyType === 'Lightning').length >= 2 && o.active) A("put 2 Lightning Energy from your hand in the Lost Zone: the opponent's Active Pokémon is Paralyzed. Once per turn."); break;
        case 'sprint': if (usable(mon) && p.deck.length) A('discard your hand and draw 4 cards. Once per turn.'); break;
        case 'firestarter': if (usable(mon) && p.bench.length && p.discard.some((x) => x.kind === 'energy' && x.energyType === 'Fire')) A('attach a Fire Energy from your discard pile to one of your Benched Pokémon. Once per turn.'); break;
        case 'roaringResolve': if (usable(mon) && mon.hpLeft > 20 && deck((x) => x.kind === 'energy' && x.energyType === 'Fire')) A('put 2 damage counters on this Pokémon to attach up to 2 Fire Energy from your deck to it. Once per turn.'); break;
        case 'queensCall': if (usable(mon) && deck((x) => x.kind === 'pokemon' && !isGXorEX(x))) A('take a Pokémon (not a Pokémon-GX or EX) from your deck. Once per turn.'); break;
        case 'powerfulSquall': if (usable(mon) && p.deck.length) A('look at the top 6 cards of your deck and attach the Water Energy among them to your Pokémon. Once per turn.'); break;
      }
    },
    async smUseAbility(p, o, m, act, power) {
      const pickHand = (text, ok, ai) => this.pickCard(p, 'discard', p.hand.filter(ok), text, { c: power.name }, 'Choose a card from your hand.', { unique: false, ai });
      switch (act.pkind) {
        case 'illuminate': {
          const x = await this.pickCard(p, 'search', p.deck.filter((y) => y.kind === 'pokemon' && y.type === 'Grass'), 'prompt.q.searchPokemon', { c: power.name }, 'Choose a Grass Pokémon.', { ai: (y) => y.stage * 2 + (y.prizes || 0) });
          if (x) { p.hand.push(this.searchDeck(p, x)); this.plog(p, 'log.t.got', { c: power.name, got: C(x) }); }
          shuffle(p.deck);
          break;
        }
        case 'magneticCircuit': {
          p.flags.powers[m.id] = false; // as often as you like
          const en = await pickHand('prompt.q.energyFromHand', (x) => x.kind === 'energy' && x.energyType === 'Lightning', () => 1);
          const t = await this.pickMon(p, 'attachTo', this.allMons(p), 'prompt.q.attachTo', { c: power.name }, `Attach ${en.name} to which Pokémon?`, (x) => (x === p.active ? 2 : 0) - this.energyGap(x) * -1);
          await this.attachHandCard(p, en, t);
          break;
        }
        case 'roastReveal': case 'powerDraw': {
          const ok = act.pkind === 'roastReveal' ? (x) => x.kind === 'energy' && x.energyType === 'Fire' : () => true;
          const d = await pickHand('prompt.q.discard1', ok, (x) => (x.kind === 'energy' ? 1 : 0));
          if (d) { p.discard.push(this.takeFromHand(p, d)); this.plog(p, 'log.t.drewN', { n: this.draw(p, 3) }); }
          break;
        }
        case 'slushRush': this.plog(p, 'log.t.drewN', { n: this.draw(p, 1) }); break;
        case 'weedOut': {
          const keep = [];
          for (let k = 0; k < 3; k++) {
            const t = await this.pickMon(p, 'promote', p.bench.filter((x) => !keep.includes(x)), 'prompt.q.weedOutKeep', { c: power.name, k: k + 1 }, 'Choose a Benched Pokémon to keep.', (x) => x.energy.length * 5 + x.card.stage * 3 + (x.card.prizes || 0) * 4);
            keep.push(t);
          }
          const gone = p.bench.filter((x) => !keep.includes(x));
          for (const x of gone) p.discard.push(...this.removeFromPlay(p, x));
          this.plog(p, 'log.weedOut', { n: gone.length });
          break;
        }
        case 'precognitiveAura': {
          const x = await this.pickCard(p, 'search', p.deck, 'prompt.q.searchAny', { c: power.name }, 'Choose any card from your deck.', { ai: (y) => (y.ttype === 'supporter' ? 4 : y.kind === 'pokemon' && y.stage > 0 ? 3 : 1) });
          if (x) { p.hand.push(this.searchDeck(p, x)); this.plog(p, 'log.t.got', { c: power.name, got: SECRET(p, C(x)) }); }
          shuffle(p.deck);
          break;
        }
        case 'darkInvitation': {
          this.plog(p, 'log.t.sawHand', { list: o.hand.map((x) => x.name).join(', ') || '—', c: power.name });
          const x = await this.pickCard(p, 'search', o.hand.filter(isBasic), 'prompt.q.darkInvitation', { c: power.name }, "Choose a Basic Pokémon from the opponent's hand to put onto their Bench.", { unique: false, ai: (y) => -y.hp });
          if (x) {
            o.hand.splice(o.hand.indexOf(x), 1);
            const nm = new Mon(x, this.turn);
            o.bench.push(nm);
            this.plog(o, 'log.bench', { c: C(x) });
            await this.spread(m, [[nm, 30]], { counters: true });
            counterLog(this, nm, 30);
          }
          break;
        }
        case 'psychicRecharge': await this.attachFromDiscard(p, p.bench, 1, (x) => x.kind === 'energy' && x.energyType === 'Psychic' && !x.special, power.name); break;
        case 'firestarter': await this.attachFromDiscard(p, p.bench, 1, (x) => x.kind === 'energy' && x.energyType === 'Fire' && !x.special, power.name); break;
        case 'smoothOver': {
          const x = await this.pickCard(p, 'search', p.deck, 'prompt.q.searchAny', { c: power.name }, 'Choose a card to put on top of your deck.', { ai: (y) => (y.ttype === 'supporter' ? 4 : y.kind === 'pokemon' && y.stage > 0 ? 3 : 1) });
          if (x) { p.deck.splice(p.deck.indexOf(x), 1); shuffle(p.deck); p.deck.push(x); this.plog(p, 'log.smoothOver', { c: power.name }); }
          break;
        }
        case 'unseenFlash': {
          const out = p.hand.filter((x) => x.kind === 'energy' && x.energyType === 'Lightning').slice(0, 2);
          for (const x of out) p.hand.splice(p.hand.indexOf(x), 1);
          this.toLostZone(p, out);
          this.plog(p, 'log.lostZone', { n: out.length });
          if (o.active && !this.abilityImmune(o.active)) this.applyStatus(o.active, 'paralyzed');
          break;
        }
        case 'sprint': p.discard.push(...p.hand.splice(0)); this.plog(p, 'log.t.newHand', { n: this.draw(p, 4) }); break;
        case 'roaringResolve': {
          await this.spread(m, [[m, 20]], { counters: true });
          counterLog(this, m, 20);
          let n = 0;
          for (let k = 0; k < 2; k++) { // "up to 2"
            const en = await this.pickCard(p, 'search', p.deck.filter((x) => x.kind === 'energy' && x.energyType === 'Fire' && !x.special), 'prompt.q.searchEnergy', { c: power.name }, 'Choose a Fire Energy to attach.', { none: true, ai: () => 1 });
            if (!en) break;
            await this.hooks.onAttach?.({ p: p.idx, mon: m.id, card: en });
            m.energy.push(this.searchDeck(p, en)); n++;
          }
          shuffle(p.deck);
          this.plog(p, 'log.energiesFound', { n });
          break;
        }
        case 'queensCall': {
          const x = await this.pickCard(p, 'search', p.deck.filter((y) => y.kind === 'pokemon' && !isGXorEX(y)), 'prompt.q.searchPokemon', { c: power.name }, 'Choose a Pokémon.', { ai: (y) => y.stage * 2 });
          if (x) { p.hand.push(this.searchDeck(p, x)); this.plog(p, 'log.t.got', { c: power.name, got: C(x) }); }
          shuffle(p.deck);
          break;
        }
        case 'powerfulSquall': {
          const top = p.deck.splice(-6);
          let n = 0;
          for (const en of top.filter((x) => x.kind === 'energy' && x.energyType === 'Water')) { // "any number": each may stay
            const t = await this.pickMonOrNone(p, 'attachTo', this.allMons(p), 'prompt.q.attachToOrKeep', { c: power.name }, `Attach ${en.name} to which Pokémon (or leave it)?`, (x) => (x === p.active ? 2 : 0) - this.energyGap(x) * -1, -5);
            if (!t) continue;
            await this.hooks.onAttach?.({ p: p.idx, mon: t.id, card: en });
            top.splice(top.indexOf(en), 1);
            t.energy.push(en); n++;
          }
          p.deck.push(...top);
          shuffle(p.deck);
          this.plog(p, 'log.energiesFound', { n });
          break;
        }
      }
    },
    // "When you play this Pokémon from your hand to evolve" Abilities. True if handled.
    async smOnEvolve(p, m) {
      const k = m.card.powerKind, o = this.opp(p), pw = m.card.power?.name;
      const say = () => this.plog(p, 'log.ability', { m: m.name, pw });
      const may = (text, en, ai = 1) => this.yesNo(p, text, { c: pw }, en, ai);
      switch (k) {
        case 'treasureHunt': {
          const x = await this.pickCard(p, 'search', p.discard.filter((y) => y.ttype === 'item'), 'prompt.q.fromDiscard', { c: pw }, 'You may put an Item from your discard pile into your hand.', { none: true, unique: false, ai: () => 1 });
          if (x) { say(); p.hand.push(this.pullFromDiscard(p, x)); }
          return true;
        }
        case 'hotPoison':
          if (o.active && !this.abilityImmune(o.active) && (await may('prompt.q.hotPoison', 'Make the opponent’s Active Pokémon Burned and Poisoned?'))) { say(); this.applyStatus(o.active, 'burned'); this.applyStatus(o.active, 'poisoned'); }
          return true;
        case 'topplingWind':
          if (o.deck.length && (await may('prompt.q.topplingWind', "Discard the top 3 cards of the opponent's deck?", o.deck.length <= 6 ? 3 : 1))) {
            say();
            const out = o.deck.splice(-3); o.discard.push(...out);
            this.plog(o, 'log.milled', { n: out.length });
          }
          return true;
        case 'stance':
          if (await may('prompt.q.stance', 'Protect this Pokémon from all effects of attacks until the end of the opponent’s next turn?')) { say(); m.effects.shield = { kind: 'all', expires: this.turn + 1, src: 'ability' }; this.log('log.shield.all', { m: m.name }, 'status'); }
          return true;
        case 'blessingsOfTheFrost': {
          const t = m.card.power.type;
          if (p.discard.some((x) => x.kind === 'energy' && x.energyType === t && !x.special) && (await may('prompt.q.blessingsOfTheFrost', `Attach a ${t} Energy from your discard pile to one of your Pokémon?`))) {
            say();
            await this.attachFromDiscard(p, this.allMons(p), 1, (x) => x.kind === 'energy' && x.energyType === t && !x.special, pw);
          }
          return true;
        }
        case 'searchForFriends': {
          let n = 0;
          for (let i = 0; i < 2; i++) {
            const x = await this.pickCard(p, 'search', p.discard.filter((y) => y.ttype === 'supporter'), 'prompt.q.fromDiscard', { c: pw }, 'You may put a Supporter from your discard pile into your hand.', { none: i === 0, unique: false, ai: () => 1 }); // you may: then 2
            if (!x) break;
            p.hand.push(this.pullFromDiscard(p, x)); n++;
          }
          if (n) say();
          return true;
        }
      }
      return false;
    },
    // "When you play this Pokémon from your hand onto your Bench" Abilities. True if handled.
    async smOnBench(p, m) {
      const k = m.card.powerKind, pw = m.card.power?.name;
      const say = () => this.plog(p, 'log.ability', { m: m.name, pw });
      if (k === 'vitalDance') {
        let n = 0;
        for (let i = 0; i < 2; i++) {
          const x = await this.pickCard(p, 'search', p.deck.filter(basicEnergy), 'prompt.q.searchEnergy', { c: pw }, 'You may take a basic Energy from your deck.', { none: true, ai: () => 1 });
          if (!x) break;
          p.hand.push(this.searchDeck(p, x)); n++;
        }
        if (n) say();
        shuffle(p.deck);
        return true;
      }
      if (k === 'freshSqueezed') {
        let n = 0;
        for (let i = 0; i < 3; i++) {
          const x = await this.pickCard(p, 'search', p.deck.filter(basicEnergy), 'prompt.q.freshSqueezed', { c: pw }, 'You may discard a basic Energy from your deck.', { none: true, ai: () => 1 });
          if (!x) break;
          p.discard.push(this.searchDeck(p, x)); n++;
        }
        if (n) { say(); this.plog(p, 'log.freshSqueezed', { n }); }
        shuffle(p.deck);
        return true;
      }
      return false;
    },
    // Natural Cure: attaching an Energy from the hand to this Pokémon cures its Special Conditions.
    naturalCure(m) {
      if (m.card.powerKind === 'naturalCure' && this.powerOn(m) && m.conditions().length) { m.status = {}; this.log('log.cured', { m: m.name }, 'heal'); }
    },

    // ---------------- Stadiums ----------------
    smStadiumActions(p, S) {
      if (this.stadium?.card.stadium === 'brookletHill' && p.bench.length < MAX_BENCH && p.deck.some((x) => isBasic(x) && (x.type === 'Water' || x.type === 'Fighting')))
        S('brookletHill', 'put a Basic Water or Fighting Pokémon from your deck onto your Bench. Once per turn.');
    },
    async smUseStadium(p, act) {
      if (act.stadium === 'brookletHill') {
        const x = await this.pickCard(p, 'search', p.deck.filter((y) => isBasic(y) && (y.type === 'Water' || y.type === 'Fighting')), 'prompt.q.callFamily', { c: C(this.stadium.card) }, 'Choose a Basic Water or Fighting Pokémon.', { ai: (y) => y.hp });
        if (x) await this.benchFromDeck(p, x);
        shuffle(p.deck);
      }
      return false;
    },

    // ---------------- Trainer cards ----------------
    smTrainerActions(p, o, c, once, T) {
      const mons = this.allMons(p), others = p.hand.length - 1, deckHas = (f) => p.deck.some(f), firstTurn = this.turn === (this.first === p ? 1 : 2);
      switch (c.tkind) {
        case 'acerola': for (const m of mons) if (m.damage && (m !== p.active || p.bench.length) && once('acer' + m.id)) T('acerola', { m: m.name }, `put ${m.name} and all cards on it into your hand.`, { target: m }); break;
        case 'apricornMaker': if (deckHas((x) => x.ttype === 'item' && x.name.includes('Ball')) && once('apri')) T('apricornMaker', {}, 'take up to 2 Item cards with "Ball" in their name from your deck.'); break;
        case 'aquaPatch': if (p.bench.some((x) => x.card.type === 'Water') && p.discard.some(ofType('Water')) && once('aqua')) T('aquaPatch', {}, 'attach a Water Energy from your discard pile to one of your Benched Water Pokémon.'); break;
        case 'bigMalasada': if (p.active && (p.active.damage || p.active.conditions().length) && once('mala')) T('bigMalasada', {}, `heal 20 damage from your Active ${p.active.name} and cure a Special Condition.`); break;
        case 'brocksGrit': if (p.discard.some((x) => x.kind === 'pokemon' || basicEnergy(x)) && once('grit')) T('brocksGrit', {}, 'shuffle 6 Pokémon and basic Energy (or all, if fewer) from your discard pile into your deck.'); break;
        case 'cynthia': if (once('cynthia')) T('cynthia', {}, 'shuffle your hand into your deck and draw 6 cards.'); break;
        case 'energyLoto': if (p.deck.length && once('loto')) T('energyLoto', {}, 'look at the top 7 cards of your deck and take an Energy card from them.'); break;
        case 'fieldBlower': if ((this.stadium || this.players.some((q) => this.allMons(q).some((x) => x.tools.length))) && once('blower')) T('fieldBlower', {}, 'discard up to 2 Pokémon Tools and/or Stadiums in play.'); break;
        case 'fisherman': if (p.discard.some(basicEnergy) && once('fish')) T('fisherman', {}, 'put 4 basic Energy (or all, if fewer) from your discard pile into your hand.'); break;
        case 'guzma': for (const b of o.bench) if (!this.poncho(b) && once('guzma' + b.id)) T('guzma', { m: b.name }, `pull the opponent's Benched ${b.name} into the Active Spot, then switch your own Active Pokémon.`, { target: b }); break;
        case 'hau': if (p.deck.length && once('hau')) T('hau', {}, 'draw 3 cards.'); break;
        case 'kahili': if (p.deck.length && once('kahili')) T('kahili', {}, 'draw 2 cards, then flip a coin: heads, this card goes back to your hand.'); break;
        case 'lana': if (mons.some((x) => x.damage && x.energyTypes.some((t) => isType(t, 'Water'))) && once('lana')) T('lana', {}, 'heal 50 damage from each of your Pokémon with Water Energy.'); break;
        case 'lillie': if (p.deck.length && p.hand.length - 1 < (firstTurn ? 8 : 6) && once('lillie')) T('lillie', {}, `draw until you have ${firstTurn ? 8 : 6} cards in your hand.`); break;
        case 'looker': if (p.deck.length && once('looker')) T('looker', {}, 'draw 3 cards from the bottom of your deck.'); break;
        case 'lureBall': if (p.discard.some((x) => x.kind === 'pokemon' && x.stage > 0) && once('lure')) T('lureBall', {}, 'flip 3 coins: for each heads, put an Evolution Pokémon from your discard pile into your hand.'); break;
        case 'mallow': if (p.deck.length >= 2 && once('mallow')) T('mallow', {}, 'choose 2 cards from your deck and put them on top of it.'); break;
        case 'pokemonFanClub': if (deckHas(isBasic) && once('fanclub')) T('pokemonFanClub', {}, 'take up to 2 Basic Pokémon from your deck.'); break;
        case 'professorKukui': if (once('kukui')) T('professorKukui', {}, 'draw 2 cards; your attacks do 20 more damage this turn.'); break;
        case 'rescueStretcher': if (p.discard.some((x) => x.kind === 'pokemon') && once('stretcher')) T('rescueStretcher', {}, 'put a Pokémon from your discard pile into your hand, or shuffle 3 Pokémon from it into your deck.'); break;
        case 'sightseer': if (p.deck.length && once('sightseer')) T('sightseer', {}, 'discard any number of cards from your hand, then draw until you have 5.'); break;
        case 'sophocles': if (others >= 2 && p.deck.length && once('sophocles')) T('sophocles', {}, 'discard 2 cards from your hand to draw 4.'); break;
        case 'tvReporter': if (p.deck.length && once('tv')) T('tvReporter', {}, 'draw 3 cards, then discard a card from your hand.'); break;
        case 'tateLiza': if (once('tate')) T('tateLiza', {}, 'shuffle your hand into your deck and draw 5, or switch your Active Pokémon with a Benched one.'); break;
        case 'maskedRoyal':
          if (p.hand.some(basicEnergy) && mons.some((x) => x.card.stage === 2 && ['Grass', 'Fire', 'Water'].includes(x.card.type)) && once('royal')) T('maskedRoyal', {}, 'attach a basic Energy from your hand to one of your Stage 2 Grass, Fire or Water Pokémon.');
          break;
        case 'timerBall': if (deckHas((x) => x.kind === 'pokemon' && x.stage > 0) && once('timer')) T('timerBall', {}, 'flip 2 coins: for each heads, take an Evolution Pokémon from your deck.'); break;
        case 'welder': if (p.hand.some((x) => x !== c && x.kind === 'energy' && x.energyType === 'Fire') && once('welder')) T('welder', {}, 'attach up to 2 Fire Energy from your hand to one of your Pokémon, then draw 3 cards.'); break;
      }
    },
    async playSmTrainer(p, o, c, act, L) {
      const take = async (ok, text, en, { none = false, ai = () => 1 } = {}) => {
        const x = await this.pickCard(p, 'search', p.deck.filter(ok), text, { c: C(c) }, en, { none, ai });
        if (x) p.hand.push(p.deck.splice(p.deck.indexOf(x), 1)[0]);
        return x;
      };
      const coin = (heads, params = {}) => this.flip('trainer', { c: C(c) }, [{ key: 'coin.o.' + heads, params }, { key: 'coin.o.nothing', params: {} }]);
      const newHand = (q, n) => { this.shuffleHandIn(q); this.plog(q, 'log.t.newHand', { n: this.draw(q, n) }); };
      const discardOne = async (text = 'prompt.q.discard1', ok = () => true) => {
        const d = await this.pickCard(p, 'discard', p.hand.filter(ok), text, { c: C(c) }, 'Choose a card from your hand to discard.', { unique: false, ai: (x) => (x.kind === 'energy' && p.hand.filter((y) => y.kind === 'energy').length > 1 ? 1 : x.kind === 'trainer' ? 0 : -1) });
        if (d) p.discard.push(this.takeFromHand(p, d));
        return d;
      };
      const m = act.target;
      switch (c.tkind) {
        case 'acerola': {
          const cards = this.removeFromPlay(p, m);
          p.hand.push(...cards);
          L('scoop', { m: m.name });
          await this.refillActive();
          break;
        }
        case 'apricornMaker': {
          let n = 0;
          for (let k = 0; k < 2; k++) if (await take((x) => x.ttype === 'item' && x.name.includes('Ball'), 'prompt.q.searchTrainer', 'Choose an Item with "Ball" in its name.', { none: true })) n++;
          shuffle(p.deck);
          L('gotN', { n });
          break;
        }
        case 'aquaPatch': await this.attachFromDiscard(p, p.bench.filter((x) => x.card.type === 'Water'), 1, ofType('Water'), c.name); break;
        case 'bigMalasada': {
          const a = p.active;
          await this.heal(a, 20);
          const conds = a.conditions();
          if (conds.length) {
            const s = conds.length === 1 ? conds[0] : await this.pick(p, 'status', 'prompt.gen.title', 'prompt.q.cureWhich', conds.map((x) => ({ id: x, label: { key: 'st.' + x }, en: x, ai: { paralyzed: 4, asleep: 3, confused: 2, poisoned: 1, burned: 1 }[x] || 1 })), { params: { c: C(c) }, en: 'Which Special Condition is cured?' });
            const cure = conds.includes(s) ? s : conds[0];
            delete a.status[cure];
            this.log('log.curedOne', { m: a.name, s: { $st: cure } }, 'heal');
          }
          break;
        }
        case 'brocksGrit': {
          let n = 0;
          for (let k = 0; k < 6; k++) {
            const x = await this.pickCard(p, 'search', p.discard.filter((y) => y.kind === 'pokemon' || basicEnergy(y)), 'prompt.q.fromDiscard', { c: C(c) }, 'Choose a card to shuffle back into your deck.', { unique: false, ai: (y) => (y.kind === 'pokemon' ? 2 : 1) }); // 6 cards, or all if fewer
            if (!x) break;
            p.deck.push(this.pullFromDiscard(p, x)); n++;
          }
          shuffle(p.deck);
          L('shuffledBack', { n });
          break;
        }
        case 'cynthia': newHand(p, 6); break;
        case 'energyLoto': {
          const top = p.deck.slice(-7);
          const x = await this.pickCard(p, 'search', top.filter((y) => y.kind === 'energy'), 'prompt.q.searchEnergyAny', { c: C(c) }, 'Choose an Energy card from the top of your deck.', { none: true, unique: false, ai: () => 1 });
          if (x) { p.deck.splice(p.deck.indexOf(x), 1); p.hand.push(x); }
          shuffle(p.deck);
          L(x ? 'got' : 'nothing', { got: x ? C(x) : '' });
          break;
        }
        case 'fieldBlower': {
          let n = 0;
          for (let k = 0; k < 2; k++) {
            const holders = this.players.flatMap((q) => this.allMons(q)).filter((x) => x.tools.length);
            const opts = holders.map((x) => ({ id: 'mon' + x.id, mon: x, ai: this.ownerOf(x) === o ? 3 : -3 }));
            if (this.stadium) opts.push({ id: 'stadium', card: this.stadium.card, ai: this.stadium.owner === p.idx ? -2 : 2 });
            if (!opts.length) break;
            opts.push({ id: 'none', label: { key: 'opt.none' }, en: 'Choose nothing.', ai: k ? 0 : -5 });
            const id = await this.pick(p, 'blower', 'prompt.gen.title', 'prompt.q.fieldBlower', opts, { params: { c: C(c) }, en: 'Discard which Pokémon Tool or Stadium?' });
            if (id === 'stadium' && this.stadium) {
              this.players[this.stadium.owner].discard.push(this.stadium.card);
              this.log('log.stadiumOff', { c: C(this.stadium.card) });
              this.stadium = null; n++;
            } else {
              const t = holders.find((x) => 'mon' + x.id === id);
              if (!t) break;
              this.ownerOf(t).discard.push(t.tools.shift().card); n++;
              this.log('log.toolsDiscarded', { m: t.name, n: 1 }, 'status');
            }
          }
          break;
        }
        case 'fisherman': {
          let n = 0;
          for (let k = 0; k < 4; k++) {
            const x = await this.pickCard(p, 'search', p.discard.filter(basicEnergy), 'prompt.q.fromDiscard', { c: C(c) }, 'Choose a basic Energy from your discard pile.', { unique: false, ai: () => 1 }); // 4, or all if fewer
            if (!x) break;
            p.hand.push(this.pullFromDiscard(p, x)); n++;
          }
          L('gotN', { n });
          break;
        }
        case 'guzma': {
          this.swapActive(o, m);
          this.log('log.lure', { m: m.name });
          if (p.bench.length) {
            const t = await this.pickMon(p, 'promote', p.bench, 'prompt.q.switchSelf', { c: C(c) }, 'Choose which Benched Pokémon becomes Active.', (x) => x.hpLeft / 10 + x.energy.length * 5);
            this.swapActive(p, t);
            L('switch', { m: p.active.name });
            await this.becameActive(p);
          }
          break;
        }
        case 'hau': L('drew', { n: this.draw(p, 3) }); break;
        case 'kahili': {
          const n = this.draw(p, 2);
          if (await coin('backToHand')) { p.hand.push(this.pullFromDiscard(p, c)); L('icePop'); }
          L('drew', { n });
          break;
        }
        case 'lana': for (const x of this.allMons(p)) if (x.damage && x.energyTypes.some((t) => isType(t, 'Water'))) await this.heal(x, 50); break;
        case 'lillie': {
          const first = this.turn === (this.first === p ? 1 : 2);
          L('drew', { n: this.draw(p, Math.max(0, (first ? 8 : 6) - p.hand.length)) });
          break;
        }
        case 'looker': { const out = p.deck.splice(0, Math.min(3, p.deck.length)); p.hand.push(...out); L('drew', { n: out.length }); break; }
        case 'lureBall': {
          let n = 0;
          for (let k = 0; k < 3; k++) {
            if (!(await coin('search'))) continue;
            const x = await this.pickCard(p, 'search', p.discard.filter((y) => y.kind === 'pokemon' && y.stage > 0), 'prompt.q.fromDiscard', { c: C(c) }, 'Choose an Evolution Pokémon from your discard pile.', { unique: false, ai: (y) => y.stage });
            if (x) { p.hand.push(this.pullFromDiscard(p, x)); n++; }
          }
          L('gotN', { n });
          break;
        }
        case 'mallow': {
          const picked = [];
          for (let k = 0; k < 2; k++) {
            const x = await this.pickCard(p, 'search', p.deck.filter((y) => !picked.includes(y)), 'prompt.q.searchAny', { c: C(c) }, 'Choose a card to put on top of your deck.', { unique: false, ai: (y) => (y.ttype === 'supporter' ? 3 : y.kind === 'pokemon' ? 2 : 1) });
            if (x) picked.push(x);
          }
          for (const x of picked) p.deck.splice(p.deck.indexOf(x), 1);
          shuffle(p.deck);
          p.deck.push(...picked.reverse());
          L('cipher', { n: picked.length });
          break;
        }
        case 'pokemonFanClub': {
          let n = 0;
          for (let k = 0; k < 2; k++) if (await take(isBasic, 'prompt.q.searchPokemon', 'Choose a Basic Pokémon.', { none: true, ai: (x) => x.hp })) n++;
          shuffle(p.deck);
          L('gotN', { n });
          break;
        }
        case 'professorKukui': p.flags.kukui = true; L('drew', { n: this.draw(p, 2) }); break;
        case 'rescueStretcher': {
          const mons = p.discard.filter((x) => x.kind === 'pokemon');
          const id = mons.length >= 2 ? await this.pick(p, 'rod', 'prompt.gen.title', 'prompt.q.rescueStretcher', [
            { id: 'hand', label: { key: 'opt.stretcherHand' }, en: 'Put a Pokémon into your hand.', ai: 2 },
            { id: 'deck', label: { key: 'opt.stretcherDeck' }, en: 'Shuffle 3 Pokémon into your deck.', ai: mons.length >= 3 ? 1 : 0 }], { params: { c: C(c) }, en: 'Rescue Stretcher: choose 1.' }) : 'hand';
          if (id === 'deck') {
            let n = 0;
            for (let k = 0; k < 3; k++) { // 3 Pokémon (all, if fewer): the player picks which
              const x = await this.pickCard(p, 'search', p.discard.filter((y) => y.kind === 'pokemon'), 'prompt.q.toDeck', { c: C(c) }, 'Choose a Pokémon to shuffle into your deck.', { unique: false, ai: (y) => y.stage + (y.prizes || 0) });
              if (!x) break;
              p.deck.push(this.pullFromDiscard(p, x)); n++;
            }
            shuffle(p.deck);
            L('shuffledBack', { n });
          } else {
            const x = await this.pickCard(p, 'search', mons, 'prompt.q.fromDiscard', { c: C(c) }, 'Choose a Pokémon from your discard pile.', { unique: false, ai: (y) => y.stage + (y.prizes || 0) });
            if (x) { p.hand.push(this.pullFromDiscard(p, x)); L('got', { got: C(x) }); }
          }
          break;
        }
        case 'sightseer': {
          // Any number; with 5 or more cards left you keep discarding (Sightseer has to draw you at least 1 card).
          while (p.hand.length) {
            const d = await this.pickCard(p, 'discard', p.hand, 'prompt.q.sightseer', { c: C(c) }, 'Discard a card? (Choose nothing to stop.)', { none: p.hand.length < 5, unique: false, ai: (x) => (x.kind === 'energy' && p.hand.filter((y) => y.kind === 'energy').length > 2 ? 0.5 : -1) });
            if (!d) break;
            p.discard.push(this.takeFromHand(p, d));
          }
          L('drew', { n: this.draw(p, Math.max(0, 5 - p.hand.length)) });
          break;
        }
        case 'sophocles': await discardOne('prompt.q.discardK'); await discardOne('prompt.q.discardK'); L('drew', { n: this.draw(p, 4) }); break;
        case 'tvReporter': { const n = this.draw(p, 3); await discardOne(); L('drew', { n }); break; }
        case 'tateLiza': {
          const id = p.bench.length ? await this.pick(p, 'tate', 'prompt.gen.title', 'prompt.q.tateLiza', [
            { id: 'draw', label: { key: 'opt.tateDraw' }, en: 'Shuffle your hand into your deck and draw 5 cards.', ai: p.hand.length <= 3 ? 2 : 0 },
            { id: 'switch', label: { key: 'opt.tateSwitch' }, en: 'Switch your Active Pokémon with a Benched one.', ai: p.active && (p.active.status.asleep || p.active.status.paralyzed || p.active.hpLeft <= 30) ? 3 : 1 }], { params: { c: C(c) }, en: 'Tate & Liza: choose 1.' }) : 'draw';
          if (id === 'switch') {
            const t = await this.pickMon(p, 'promote', p.bench, 'prompt.q.switchSelf', { c: C(c) }, 'Choose which Benched Pokémon becomes Active.', (x) => x.hpLeft / 10 + x.energy.length * 5);
            this.swapActive(p, t);
            L('switch', { m: p.active.name });
            await this.becameActive(p);
          } else newHand(p, 5);
          break;
        }
        case 'maskedRoyal': {
          const en = await this.pickCard(p, 'discard', p.hand.filter(basicEnergy), 'prompt.q.energyFromHand', { c: C(c) }, 'Choose a basic Energy from your hand.', { unique: false, ai: () => 1 });
          const t = await this.pickMon(p, 'attachTo', this.allMons(p).filter((x) => x.card.stage === 2 && ['Grass', 'Fire', 'Water'].includes(x.card.type)), 'prompt.q.attachTo', { c: C(c) }, 'Attach it to which Stage 2 Pokémon?', (x) => (x === p.active ? 2 : 0));
          await this.attachHandCard(p, en, t);
          break;
        }
        case 'timerBall': {
          let n = 0;
          for (let k = 0; k < 2; k++) if ((await coin('search')) && (await take((x) => x.kind === 'pokemon' && x.stage > 0, 'prompt.q.searchPokemon', 'Choose an Evolution Pokémon.', { ai: (x) => x.stage + (this.allMons(p).some((y) => y.name === x.evolvesFrom) ? 5 : 0) }))) n++;
          shuffle(p.deck);
          L('gotN', { n });
          break;
        }
        case 'welder': {
          const t = await this.pickMon(p, 'attachTo', this.allMons(p), 'prompt.q.attachTo', { c: C(c) }, 'Attach the Fire Energy to which Pokémon?', (x) => (x === p.active ? 2 : 0) + (x.card.type === 'Fire' ? 2 : 0) - this.energyGap(x) * -1);
          let n = 0;
          for (let k = 0; k < 2; k++) {
            const en = await this.pickCard(p, 'discard', p.hand.filter((x) => x.kind === 'energy' && x.energyType === 'Fire'), 'prompt.q.energyFromHand', { c: C(c) }, 'Attach a Fire Energy from your hand.', { none: k > 0, unique: false, ai: () => 1 });
            if (!en) break;
            await this.attachHandCard(p, en, t); n++;
          }
          if (n) L('drew', { n: this.draw(p, 3) });
          break;
        }
      }
    },

    // ---------------- Attack effects ----------------
    async smPreDamage(p, a, atk, fx) {
      const o = this.opp(p), d = o.active;
      let bonus = 0;
      if (fx.needsStadium && !this.stadium) { this.log('log.failed', { atk: atk.name }); return -1e9; } // Revelation Dance
      if (fx.discardDefToolsBonus && d?.tools.length && !this.effectsBlocked(d)) {
        const n = d.tools.length;
        o.discard.push(...d.tools.splice(0).map((t) => t.card));
        this.log('log.toolsDiscarded', { m: d.name, n }, 'status');
        bonus += fx.discardDefToolsBonus;
      }
      if (fx.optionalBonusSelfDamage && (await this.yesNo(p, 'prompt.q.superpower', { c: atk.name, b: fx.optionalBonusSelfDamage.bonus, s: fx.optionalBonusSelfDamage.self }, `Do ${fx.optionalBonusSelfDamage.bonus} more damage (and ${fx.optionalBonusSelfDamage.self} to this Pokémon)?`, a.hpLeft > fx.optionalBonusSelfDamage.self + 30 ? 1 : -1))) {
        bonus += fx.optionalBonusSelfDamage.bonus;
        p.flags.selfHit = fx.optionalBonusSelfDamage.self;
      }
      if (fx.discardAllTypeTimes) {
        const out = a.energy.filter((en) => isType(en.energyType, fx.discardAllTypeTimes.type));
        a.energy = a.energy.filter((en) => !out.includes(en));
        p.discard.push(...out); // the damage for them is already in baseRange (counted before this discard)
        if (out.length) this.log('log.discardedN', { m: a.name, n: out.length }, 'status');
      }
      if (fx.discardHandTypeTimes) {
        const pool = p.hand.filter((x) => x.kind === 'energy' && x.energyType === fx.discardHandTypeTimes.type);
        const n = await this.pickNumber(p, 'drawN', Math.min(fx.discardHandTypeTimes.max, pool.length), 'prompt.q.discardHandHowMany', { c: atk.name, t: { $type: fx.discardHandTypeTimes.type }, n: fx.discardHandTypeTimes.n }, `How many ${fx.discardHandTypeTimes.type} Energy do you discard from your hand (${fx.discardHandTypeTimes.n} damage each)?`, (k) => k);
        for (const x of pool.slice(0, n)) p.discard.push(this.takeFromHand(p, x));
        bonus += fx.discardHandTypeTimes.n * n;
      }
      if (fx.furyCutter) {
        let heads = 0;
        for (let k = 0; k < 3; k++) if (await this.flip('multi', { atk: atk.name, i: k + 1, n: 3, so: heads }, [{ key: 'coin.o.plus', params: { n: 0 } }, { key: 'coin.o.nothing', params: {} }])) heads++;
        bonus += [0, 20, 60, 110][heads]; // 3 heads: 120 damage in all
      }
      if (fx.eruption) {
        let n = 0;
        for (const q of [p, o]) if (q.deck.length) { const x = q.deck.pop(); q.discard.push(x); this.plog(q, 'log.milledCard', { c: C(x) }); if (x.kind === 'energy') n++; }
        bonus += fx.eruption * n;
      }
      // Swim: if any of the opponent's Pokémon has Water Energy, the damage may go to a Benched Pokémon instead.
      if (fx.swimSnipe && o.bench.length && this.allMons(o).some((x) => x.energyTypes.some((t) => isType(t, fx.swimSnipe.type)))) {
        const t = await this.pickMonOrNone(p, 'snipe', o.bench.filter((x) => !this.effectsBlocked(x)), 'prompt.q.swim', { c: atk.name, n: atk.base }, `Do ${atk.base} damage to a Benched Pokémon instead of the Active one?`, (x) => (x.hpLeft <= atk.base ? 100 + (x.card.prizes || 1) * 10 : -50), d && d.hpLeft <= atk.base ? 50 : 0);
        if (t) { p.flags.swimTarget = t.id; return -1e9; }
      }
      if (fx.bonusIfOppHandHas) {
        this.plog(p, 'log.t.sawHand', { list: o.hand.map((x) => x.name).join(', ') || '—', c: atk.name });
        if (o.hand.some((x) => x.kind === fx.bonusIfOppHandHas.kind)) bonus += fx.bonusIfOppHandHas.n;
      }
      return bonus;
    },

    async smAfter(p, o, a, d, atk, fx) {
      const inPlay = this.allMons(p).includes(a);
      const dActive = d && o.active === d && !this.effectsBlocked(d);
      if (p.flags.selfHit) { const n = p.flags.selfHit; delete p.flags.selfHit; if (inPlay) { await this.hit(null, a, n); a.damage += n; this.log('log.recoil', { m: a.name, n }, 'dmg'); } }
      if (fx.vulnerable && inPlay) { a.effects.vulnerable = { n: fx.vulnerable, expires: this.turn + 1 }; this.log('log.vulnerable', { m: a.name, n: fx.vulnerable }, 'status'); }
      if (fx.selfNoRetreat && inPlay) { a.effects.noRetreat = { expires: this.turn + 2 }; this.log('log.noRetreat', { m: a.name }, 'status'); }
      if (fx.setWeakness && dActive) { d.effects.weakAs = { type: fx.setWeakness, expires: this.turn + 2 }; this.log('log.weakAs', { m: d.name, t: { $type: fx.setWeakness } }, 'status'); }
      if (fx.severePoison && dActive) { this.applyStatus(d, 'poisoned'); if (d.status.poisoned) { d.status.poisoned = fx.severePoison; this.log('log.severePoison', { m: d.name, n: fx.severePoison }, 'status'); } }
      if (fx.removeEnergyType && dActive) {
        const en = d.energy.find((x) => isType(x.energyType, fx.removeEnergyType));
        if (en) { o.discard.push(...d.energy.splice(d.energy.indexOf(en), 1)); this.log('log.energyRemoved', { m: d.name, c: C(en) }); }
      }
      if (fx.removeSpecialEnergy && dActive) {
        const en = await this.chooseEnergy(p, d, d.energy.filter((x) => x.special), 'prompt.q.removeWhichEnergy', "Which of the opponent's Special Energy do you discard?");
        if (en) { o.discard.push(...d.energy.splice(d.energy.indexOf(en), 1)); this.log('log.energyRemoved', { m: d.name, c: C(en) }); }
      }
      if (fx.flipHeadache && (await this.flip('attack', { atk: atk.name }, [{ key: 'coin.o.headache', params: {} }, { key: 'coin.o.nothing', params: {} }]))) {
        o.until.noTrainers = this.turn + 1;
        this.log('log.headache', { P: { $pl: o.idx } }, 'status');
      }
      if (fx.optionalDiscardRemove && inPlay && a.energy.length && dActive && d.energy.length &&
        (await this.yesNo(p, 'prompt.q.darkDestruction', { c: atk.name, m: d.name }, `Discard an Energy from this Pokémon to discard an Energy from ${d.name}?`, 1))) {
        const mine = await this.chooseEnergy(p, a, a.energy, 'prompt.q.discardWhichEnergy', 'Which Energy do you discard from this Pokémon?');
        p.discard.push(...a.energy.splice(a.energy.indexOf(mine), 1));
        const en = await this.chooseEnergy(p, d, d.energy, 'prompt.q.removeWhichEnergy', "Which of the opponent's Energy do you discard?");
        o.discard.push(...d.energy.splice(d.energy.indexOf(en), 1));
        this.log('log.energyRemoved', { m: d.name, c: C(en) });
      }
      if (fx.bounceDefAll && d && o.active === d && !this.effectsBlocked(d) &&
        (!fx.bounceFlip || (await this.flip('attack', { atk: atk.name }, [{ key: 'coin.o.bounce', params: { m: d.name } }, { key: 'coin.o.nothing', params: {} }])))) {
        const cards = this.removeFromPlay(o, d);
        o.hand.push(...cards);
        this.log('log.bounced', { m: d.name }, 'status');
        await this.refillActive();
      }
      if (fx.switchIfDefEvolved && inPlay && p.bench.length && d && d.card.stage > 0) {
        const t = await this.pickMon(p, 'promote', p.bench, 'prompt.q.switchSelf', { c: atk.name }, 'Switch with which Benched Pokémon?', (x) => x.hpLeft / 10 + x.energy.length * 5);
        this.swapActive(p, t);
        this.plog(p, 'log.t.switched', { m: p.active.name });
      }
      if (fx.switchSelfType && inPlay && p.active === a) {
        const pool = p.bench.filter((x) => x.card.type === fx.switchSelfType);
        if (pool.length) {
          const t = await this.pickMon(p, 'promote', pool, 'prompt.q.switchSelf', { c: atk.name }, 'Switch with which Benched Pokémon?', (x) => x.hpLeft / 10 + x.energy.length * 5);
          this.swapActive(p, t);
          this.plog(p, 'log.t.switched', { m: p.active.name });
        }
      }
      if (fx.callAny?.switchAfter && inPlay && p.active === a && p.bench.length && p.flags.calledNow &&
        (await this.yesNo(p, 'prompt.q.strikeAndRun', { c: atk.name }, 'Switch this Pokémon with one of your Benched Pokémon?', 1))) {
        const t = await this.pickMon(p, 'promote', p.bench, 'prompt.q.switchSelf', { c: atk.name }, 'Switch with which Benched Pokémon?', (x) => x.hpLeft / 10 + x.energy.length * 5);
        this.swapActive(p, t);
        this.plog(p, 'log.t.switched', { m: p.active.name });
      }
      delete p.flags.calledNow;
      if (fx.searchAnyPerBench) {
        let n = 0;
        for (let k = 0; k < p.bench.length; k++) {
          const x = await this.pickCard(p, 'search', p.deck, 'prompt.q.searchAny', { c: atk.name }, 'Choose a card from your deck.', { none: true, ai: (y) => (y.ttype === 'supporter' ? 3 : y.kind === 'pokemon' && y.stage > 0 ? 2 : 1) });
          if (!x) break;
          p.hand.push(this.searchDeck(p, x)); n++;
        }
        shuffle(p.deck);
        this.plog(p, 'log.t.drewN', { n });
      }
      if (fx.searchAny) {
        let n = 0;
        for (let k = 0; k < fx.searchAny; k++) {
          const x = await this.pickCard(p, 'search', p.deck, 'prompt.q.searchAny', { c: atk.name }, 'Choose a card from your deck.', { none: true, ai: (y) => (y.ttype === 'supporter' ? 3 : y.kind === 'pokemon' && y.stage > 0 ? 2 : 1) });
          if (!x) break;
          p.hand.push(this.searchDeck(p, x)); n++;
        }
        shuffle(p.deck);
        this.plog(p, 'log.t.drewN', { n });
      }
      if (fx.benchSharesType) {
        const types = new Set([d?.card.type].filter(Boolean));
        const list = o.bench.filter((x) => types.has(x.card.type));
        if (list.length) { await this.spread(a, list.map((x) => [x, fx.benchSharesType])); this.log('log.benchSnipe', { n: fx.benchSharesType, list: list.map((x) => x.name).join(', ') }, 'dmg'); }
      }
      if (fx.countersAll) {
        const all = this.players.flatMap((q) => this.allMons(q)).filter((x) => this.ownerOf(x) === p || !this.effectsBlocked(x));
        await this.spread(a, all.map((x) => [x, fx.countersAll]), { counters: true });
        this.log('log.countersEach', { n: fx.countersAll / 10 }, 'dmg');
      }
      if (fx.benchFromDiscard && p.bench.length < MAX_BENCH) {
        const x = await this.pickCard(p, 'search', p.discard.filter(isBasic), 'prompt.q.fromDiscard', { c: atk.name }, 'Choose a Basic Pokémon from your discard pile to put onto your Bench.', { unique: false, ai: (y) => y.hp });
        if (x) { const nm = new Mon(this.pullFromDiscard(p, x), this.turn); p.bench.push(nm); this.plog(p, 'log.bench', { c: C(x) }); }
      }
      if (fx.energyFromDiscard) {
        let n = 0;
        for (let k = 0; k < fx.energyFromDiscard; k++) {
          const x = await this.pickCard(p, 'search', p.discard.filter(basicEnergy), 'prompt.q.fromDiscard', { c: atk.name }, 'Choose a basic Energy from your discard pile.', { ai: () => 1 });
          if (!x) break;
          p.hand.push(this.pullFromDiscard(p, x)); n++;
        }
        this.plog(p, 'log.energyToHandN', { n });
      }
      if (fx.drawToMay && p.hand.length < fx.drawToMay && p.deck.length &&
        (await this.yesNo(p, 'prompt.q.drawTo', { c: atk.name, n: fx.drawToMay }, `Draw until you have ${fx.drawToMay} cards in your hand?`, p.deck.length > 8 ? 1 : -1)))
        this.plog(p, 'log.t.drewN', { n: this.draw(p, fx.drawToMay - p.hand.length) });
      if (fx.evolveSelfFromDeck && inPlay) {
        const evo = await this.pickCard(p, 'search', p.deck.filter((y) => y.kind === 'pokemon' && y.evolvesFrom === a.name), 'prompt.q.searchPokemon', { c: atk.name }, 'Choose the card to evolve into.', { ai: (y) => y.hp });
        if (evo) await this.evolveMon(p, a, evo, { fromDeck: true });
        shuffle(p.deck);
      }
      if (p.flags.swimTarget) {
        const t = o.bench.find((x) => x.id === p.flags.swimTarget);
        delete p.flags.swimTarget;
        if (t) { await this.spread(a, [[t, atk.base]]); this.log('log.benchSnipe', { n: atk.base, list: t.name }, 'dmg'); }
      }
      if (fx.flipRecoverAny) {
        let n = 0;
        for (let k = 0; k < fx.flipRecoverAny; k++) {
          if (!(await this.flip('attack', { atk: atk.name }, [{ key: 'coin.o.recover', params: {} }, { key: 'coin.o.nothing', params: {} }]))) continue;
          const x = await this.pickCard(p, 'search', p.discard, 'prompt.q.fromDiscard', { c: atk.name }, 'Choose a card from your discard pile.', { unique: false, ai: (y) => (y.ttype === 'supporter' ? 3 : y.kind === 'pokemon' ? 2 : 1) });
          if (x) { p.hand.push(this.pullFromDiscard(p, x)); n++; }
        }
        this.plog(p, 'log.t.drewN', { n });
      }
      if (fx.drawPerNamed) this.plog(p, 'log.t.drewN', { n: this.draw(p, this.allMons(p).filter((x) => x.name === fx.drawPerNamed).length) });
      if (fx.snipeDamaged) {
        const pool = this.allMons(o).filter((x) => x.damage && !this.effectsBlocked(x));
        const t = await this.pickMon(p, 'snipe', pool, 'prompt.q.snipeDamaged', { c: atk.name, n: fx.snipeDamaged }, `Do ${fx.snipeDamaged} damage to which damaged Pokémon?`, (x) => (x.hpLeft <= fx.snipeDamaged ? 100 + (x.card.prizes || 1) * 10 : 0) - x.hpLeft / 10);
        if (t) {
          const n = t === o.active ? this.finalDamage(a, t, fx.snipeDamaged).dmg : fx.snipeDamaged;
          await this.spread(a, [[t, n]]);
          this.log('log.benchSnipe', { n, list: t.name }, 'dmg');
        }
      }
      if (fx.moveAllEnergyBenchAny && inPlay && p.bench.length && a.energy.length) {
        for (const en of [...a.energy]) {
          const t = await this.pickMon(p, 'attachTo', p.bench, 'prompt.q.attachTo', { c: atk.name }, `Move ${en.name} to which Benched Pokémon?`, (x) => -this.energyGap(x) * -1);
          t.energy.push(...a.energy.splice(a.energy.indexOf(en), 1));
        }
        this.plog(p, 'log.energyMovedN', { n: 0, m: a.name });
      }
      if (fx.shuffleDiscardEnergyType) {
        let n = 0;
        for (let k = 0; k < fx.shuffleDiscardEnergyType.n; k++) { const x = p.discard.find((y) => y.kind === 'energy' && y.energyType === fx.shuffleDiscardEnergyType.type); if (!x) break; p.deck.push(this.pullFromDiscard(p, x)); n++; }
        shuffle(p.deck);
        this.plog(p, 'log.t.shuffledBack', { c: atk.name, n });
      }
      if (fx.shuffleDiscardPokemonType) {
        let n = 0;
        const fits = (y) => y.kind === 'pokemon' && y.type === fx.shuffleDiscardPokemonType.type;
        for (let k = 0; k < fx.shuffleDiscardPokemonType.n; k++) {
          const pool = p.discard.filter(fits);
          const x = pool.length > fx.shuffleDiscardPokemonType.n - k
            ? await this.pickCard(p, 'search', pool, 'prompt.q.toDeck', { c: atk.name }, 'Choose a Pokémon from your discard pile to shuffle into your deck.', { unique: false, ai: (y) => y.stage + (y.prizes || 0) })
            : pool[0];
          if (!x) break;
          p.deck.push(this.pullFromDiscard(p, x)); n++;
        }
        shuffle(p.deck);
        this.plog(p, 'log.t.shuffledBack', { c: atk.name, n });
      }
      if (fx.attachHandBenchN && p.bench.length) {
        const t = await this.pickMonOrNone(p, 'attachTo', p.bench, 'prompt.q.attachTo', { c: atk.name }, 'Attach basic Energy from your hand to which Benched Pokémon?', (x) => -this.energyGap(x) * -1, -5);
        for (let k = 0; t && k < fx.attachHandBenchN; k++) {
          const en = await this.pickCard(p, 'discard', p.hand.filter(basicEnergy), 'prompt.q.energyFromHand', { c: atk.name }, 'Attach a basic Energy from your hand.', { none: true, unique: false, ai: () => 1 });
          if (!en) break;
          await this.attachHandCard(p, en, t);
        }
      }
      if (fx.placeCountersOppDiscard) {
        const n = o.discard.filter((x) => x.kind === 'pokemon').length;
        const pool = this.allMons(o).filter((x) => !this.effectsBlocked(x));
        const plan = new Map();
        for (let k = 0; k < n && pool.length; k++) {
          const left = (x) => x.hpLeft - (plan.get(x) || 0);
          const live = pool.filter((x) => left(x) > 0);
          if (!live.length) break;
          const t = await this.pickMon(p, 'counter', live, 'prompt.q.counterK', { c: atk.name, k: k + 1, n }, `Place damage counter ${k + 1} of ${n}.`, (x) => (left(x) <= 10 ? 100 : 0) - left(x) / 10);
          plan.set(t, (plan.get(t) || 0) + 10);
        }
        if (plan.size) { await this.spread(a, [...plan], { counters: true }); this.log('log.countersMany', { list: [...plan].map(([x, k]) => `${x.name} ×${k / 10}`).join(', ') }, 'dmg'); }
      }
      if (fx.supportersFromDiscard) {
        let n = 0;
        for (let k = 0; k < fx.supportersFromDiscard; k++) {
          const x = await this.pickCard(p, 'search', p.discard.filter((y) => y.ttype === 'supporter'), 'prompt.q.fromDiscard', { c: atk.name }, 'Choose a Supporter from your discard pile.', { ai: () => 1 });
          if (!x) break;
          p.hand.push(this.pullFromDiscard(p, x)); n++;
        }
        this.plog(p, 'log.t.drewN', { n });
      }
      if (fx.ownBenchSnipe && p.bench.length) {
        const t = await this.pickMon(p, 'snipe', p.bench, 'prompt.q.ownBenchSnipe', { c: atk.name, n: fx.ownBenchSnipe }, `Which of your Benched Pokémon takes ${fx.ownBenchSnipe} damage?`, (x) => x.hpLeft);
        await this.spread(a, [[t, fx.ownBenchSnipe]]);
        this.log('log.benchSnipe', { n: fx.ownBenchSnipe, list: t.name }, 'dmg');
      }
      if (fx.peekPrize && p.prizes.length) {
        // The player chooses which face-down Prize card(s) to look at.
        let seen = p.prizes.slice(0, fx.peekPrize);
        if (fx.peekPrize < p.prizes.length) {
          const left = p.prizes.map((c, i) => i);
          seen = [];
          for (let k = 0; k < fx.peekPrize; k++) {
            const id = await this.pick(p, 'peekPrize', 'prompt.gen.title', 'prompt.q.peekPrize', left.map((i) => ({ id: String(i), label: { key: 'opt.prizeN', params: { n: i + 1 } }, en: `Face-down Prize card ${i + 1}.`, ai: 0 })), { params: { c: atk.name }, en: 'Which Prize card do you look at?' });
            const i = left.includes(Number(id)) ? Number(id) : left[0];
            left.splice(left.indexOf(i), 1);
            seen.push(p.prizes[i]);
          }
        }
        this.plog(p, 'log.peekPrize', { list: SECRET(p, seen.map((x) => x.name).join(', ')), n: seen.length });
      }
      if (fx.useOppSupporter) {
        this.plog(p, 'log.t.sawHand', { list: o.hand.map((x) => x.name).join(', ') || '—', c: atk.name });
        const sups = o.hand.filter((x) => x.ttype === 'supporter');
        // The Supporter's effect is used as the attack's effect; the card stays in the opponent's hand.
        const opts = [];
        for (const s of sups) {
          const copy = { ...s, uid: -1 };
          p.hand.push(copy);
          const saved = p.flags.supporter, savedTurn = this.turn;
          p.flags.supporter = false;
          if (this.turn === 1) this.turn = 3; // the first-turn rule doesn't apply to an attack
          for (const a2 of this.legalActions(p)) if (a2.kind === 'trainer' && a2.card === copy) opts.push(a2);
          this.turn = savedTurn; p.flags.supporter = saved;
          p.hand.splice(p.hand.indexOf(copy), 1);
        }
        if (opts.length) {
          const id = await this.pick(p, 'smeargle', 'prompt.gen.title', 'prompt.q.stunningLikeness', [...opts.map((x, i) => ({ id: String(i), label: x.label, en: x.detail, ai: 1 })), { id: 'none', label: { key: 'opt.none' }, en: 'Use nothing.', ai: -1 }], { params: { c: atk.name }, en: "Use the effect of which of the opponent's Supporters?" });
          const pickAct = opts[Number(id)];
          if (pickAct) { this.plog(p, 'log.stunningLikeness', { c: C(pickAct.card) }); await this.playTrainer(p, pickAct); }
        }
      }
    },
  });
}
