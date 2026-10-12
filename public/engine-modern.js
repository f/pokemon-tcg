// Modern rules (Scarlet & Violet era), installed on the Game class by engine.js.
// Supporters (1 per turn), Items, Pokémon Tools that stay attached, Stadiums (1 per turn), Abilities,
// Pokémon ex / V / VMAX (2 or 3 Prize cards), Tera Pokémon, Rare Candy and the VSTAR Power of Forest Seal Stone.
// Everything here only runs when `game.modern` is true (both players use modern decks).

export function installModern(Game, { Mon, shuffle, C, PL, SECRET, isBasic, MAX_BENCH, evolvesFromOf }) {
  const TOOL_FOREVER = 1e9;
  const isTR = (m) => m.name.startsWith("Team Rocket's");
  const tool = (m, k) => m.tools.some((t) => t.card.tool === k);
  const basicEnergy = (x) => x.kind === 'energy' && !x.special;
  const ruleBox = (c) => !!c.ruleBox;
  const typeOf = (en) => en.energyType;

  Object.assign(Game.prototype, {
    prizesTaken(p) { return 6 - p.prizes.length; },
    // Leafy Camo Poncho: a Pokémon VSTAR or VMAX wearing it ignores the effects of the opponent's Supporters.
    poncho(m) { return !!m && tool(m, 'leafyCamoPoncho') && (m.card.tags?.includes('VMAX') || m.card.tags?.includes('VSTAR')); },
    koLastTurn(p) { return p.koTurn === this.turn - 1; },
    hasTool(m, k) { return tool(m, k); },

    // Attack effects can't touch this Pokémon (Flare Veil, Repelling Veil, Oracle Press, and Agility / Detect / Stance:
    // "prevent all effects of attacks, including damage"). Abilities are not attacks: they check abilityImmune instead.
    effectsBlocked(m) {
      if (!m) return false;
      if (m.effects.shield?.kind === 'all') return true;
      if (!this.modern) return false;
      if (m.effects.noEffects) return true;
      if (m.card.powerKind === 'flareVeil' && this.powerOn(m)) return true;
      const q = this.ownerOf(m);
      return !!(q && m.card.stage === 0 && isTR(m) && this.allMons(q).some((x) => x.card.powerKind === 'repellingVeil' && this.powerOn(x)));
    },

    modernRetreat(p, m, c) {
      if (this.stadiumIs('beachCourt') && m.card.stage === 0) c--;
      if (tool(m, 'rescueBoard')) c = m.hpLeft <= 30 ? 0 : c - 1;
      if (m.card.powerKind === 'flareFloat' && m.energyTypes.includes('Fire')) c = 0;
      if (m.card.powerKind === 'hungryHurry' && !m.energy.length) c = 0;
      return this.megaRetreat(p, m, c);
    },

    // Damage bonuses of the attacker (before Weakness and Resistance), only against the Defending Pokémon.
    modernAttackBonus(a) {
      const q = this.ownerOf(a), o = q && this.opp(q);
      let n = 0;
      if (tool(a, 'vitalityBand')) n += 10;
      if (tool(a, 'defianceBand') && o && q.prizes.length > o.prizes.length) n += 30;
      if (q && a.card.stage === 0 && a.card.type === 'Lightning' && this.allMons(q).some((x) => x.card.powerKind === 'transistor' && this.powerOn(x))) n += 30;
      return n + this.megaAttackBonus(a, q);
    },
    // Damage reductions of the Defending Pokémon (after Weakness and Resistance).
    modernDefense(a, d, dmg, notes) {
      if (d.card.powerKind === 'bouffer' && this.powerOn(d)) { dmg -= 20; notes.push('reduce'); }
      if (d.card.powerKind === 'thicketBody' && this.powerOn(d)) { dmg -= 30; notes.push('reduce'); }
      if (d.effects.shield?.kind === 'basic' && a.card.stage === 0) { dmg = 0; notes.push('shield'); }
      return this.megaDefense(a, d, Math.max(0, dmg), notes);
    },

    // ---------------- Trainer cards ----------------
    modernTrainerActions(p, o, c, once, T, monEn) {
      const mons = this.allMons(p), others = p.hand.length - 1;
      const tt = c.ttype;
      if (tt === 'supporter') {
        if (p.flags.supporter) return;
        const firstTurn = this.turn === 1;
        if (firstTurn && c.tkind !== 'trProton') return; // the player who goes first can't play a Supporter on their first turn
      }
      if (tt === 'stadium' && (p.flags.stadiumPlayed || this.stadium?.card.name === c.name || p.until.noSpecialStadium === this.turn)) return; // Shadow Mist
      const deckHas = (f) => p.deck.some(f);
      const bench = p.bench.length < MAX_BENCH;
      switch (c.tkind) {
        case 'tool':
          for (const m of mons) if (!m.tools.length && once('tool' + c.name + m.id)) {
            if (c.tool === 'forestSealStone' && !m.card.tags?.includes('V')) continue;
            T('tool', { m: m.name }, `attach the Pokémon Tool ${c.name} to ${monEn(m)}: ${c.text}`, { target: m });
          }
          break;
        case 'stadium': if (once('std' + c.name)) T('stadium', {}, `put this Stadium into play: ${c.text}`); break;
        case 'potion30': for (const m of mons) if (m.damage && once('p30' + m.id)) T('potion30', { m: m.name }, `heal 30 damage from ${monEn(m)}.`, { target: m }); break;
        case 'energyRetrievalM': if (p.discard.some(basicEnergy) && once('erm')) T('energyRetrievalM', {}, 'put up to 2 basic Energy cards from your discard pile into your hand.'); break;
        case 'energySwitch':
          if (mons.length > 1 && mons.some((m) => m.energy.some(basicEnergy)) && once('esw')) T('energySwitch', {}, 'move a basic Energy from one of your Pokémon to another.');
          break;
        case 'nestBall': if (bench && deckHas(isBasic) && once('nest')) T('nestBall', {}, 'put a Basic Pokémon from your deck onto your Bench.'); break;
        case 'buddyPoffin': if (bench && deckHas((x) => isBasic(x) && x.hp <= 70) && once('poffin')) T('buddyPoffin', {}, 'put up to 2 Basic Pokémon with 70 HP or less from your deck onto your Bench.'); break;
        case 'ultraBall': if (others >= 2 && deckHas((x) => x.kind === 'pokemon') && once('ultra')) T('ultraBall', {}, 'discard 2 other cards from your hand to search your deck for any Pokémon.'); break;
        case 'greatBall': if (p.deck.length && once('great')) T('greatBall', {}, 'look at the top 7 cards of your deck and take a Pokémon from them.'); break;
        case 'pokeBall': if (deckHas((x) => x.kind === 'pokemon') && once('pb')) T('pokeBall', {}, 'flip a coin: heads, search your deck for any Pokémon.'); break;
        case 'pokegear': if (p.deck.length && once('gear')) T('pokegear', {}, 'look at the top 7 cards of your deck and take a Supporter from them.'); break;
        case 'palPad': if (p.discard.some((x) => x.ttype === 'supporter') && once('pal')) T('palPad', {}, 'shuffle up to 2 Supporter cards from your discard pile into your deck.'); break;
        case 'superRod': if (p.discard.some((x) => x.kind === 'pokemon' || basicEnergy(x)) && once('rod')) T('superRod', {}, 'shuffle up to 3 Pokémon and basic Energy cards from your discard pile into your deck.'); break;
        case 'nightStretcher': if (p.discard.some((x) => x.kind === 'pokemon' || basicEnergy(x)) && once('ns')) T('nightStretcher', {}, 'put a Pokémon or a basic Energy card from your discard pile into your hand.'); break;
        case 'energySticker': if (p.bench.length && p.discard.some(basicEnergy) && once('sticker')) T('energySticker', {}, 'flip a coin: heads, attach a basic Energy from your discard pile to one of your Benched Pokémon.'); break;
        case 'earthenVessel': if (others >= 1 && deckHas(basicEnergy) && once('vessel')) T('earthenVessel', {}, 'discard another card from your hand to take up to 2 basic Energy cards from your deck.'); break;
        case 'electricGenerator': if (p.bench.some((m) => m.card.type === 'Lightning') && p.deck.length && once('gen')) T('electricGenerator', {}, 'look at the top 5 cards of your deck and attach up to 2 basic Lightning Energy from them to your Benched Lightning Pokémon.'); break;
        case 'switch': if (p.bench.length) for (const b of p.bench) if (once('sw' + b.id)) T('switch', { m: b.name }, `switch your Active ${p.active.name} with ${monEn(b)}.`, { target: b }); break;
        case 'scrambleSwitch': if (p.bench.length) for (const b of p.bench) if (once('scr' + b.id)) T('scrambleSwitch', { m: b.name }, `switch your Active ${p.active.name} with ${monEn(b)} and move its Energy onto the new Active Pokémon.`, { target: b }); break;
        case 'counterCatcher': if (p.prizes.length > o.prizes.length) for (const b of o.bench) if (once('cc' + b.id)) T('counterCatcher', { m: b.name }, `pull the opponent's Benched ${monEn(b)} into the Active Spot.`, { target: b }); break;
        case 'primeCatcher': for (const b of o.bench) if (once('pc' + b.id)) T('primeCatcher', { m: b.name }, `pull the opponent's Benched ${monEn(b)} into the Active Spot, then switch your own Active Pokémon.`, { target: b }); break;
        case 'bossOrders': for (const b of o.bench) if (!this.poncho(b) && once('boss' + b.id)) T('bossOrders', { m: b.name }, `pull the opponent's Benched ${monEn(b)} into the Active Spot.`, { target: b }); break;
        case 'rareCandy':
          if (this.turn > 2)
            for (const m of mons) if (m.card.stage === 0 && m.playedTurn < this.turn)
              for (const s2 of p.hand.filter((x) => x.stage === 2 && evolvesFromOf(x.evolvesFrom) === m.name))
                if (once('candy' + m.id + s2.name)) T('rareCandy', { m: m.name, to: s2.name }, `evolve ${monEn(m)} straight into the Stage 2 ${s2.name}, skipping Stage 1.`, { target: m, evo: s2 });
          break;
        case 'unfairStamp': if (this.koLastTurn(p) && once('stamp')) T('unfairStamp', {}, 'both players shuffle their hands into their decks; you draw 5 cards, the opponent draws 2.'); break;
        case 'trTransceiver': if (deckHas((x) => x.ttype === 'supporter' && x.name.includes('Team Rocket')) && once('trt')) T('trTransceiver', {}, "search your deck for a Team Rocket's Supporter card."); break;
        // Supporters
        case 'arven': if (once('arven')) T('arven', {}, 'search your deck for an Item card and a Pokémon Tool card.'); break;
        case 'jacq': if (once('jacq')) T('jacq', {}, 'search your deck for up to 2 Evolution Pokémon.'); break;
        case 'nemona': if (p.deck.length && once('nemona')) T('nemona', {}, 'draw 3 cards.'); break;
        case 'professorsResearch': if (p.deck.length && once('pr')) T('professorsResearch', { n: others }, `discard your hand (${others} other cards) and draw 7 cards.`); break;
        case 'youngster': if (once('young')) T('youngster', {}, 'shuffle your hand into your deck and draw 5 cards.'); break;
        case 'clavell': if (once('clavell')) T('clavell', {}, 'search your deck for up to 3 Basic Pokémon with 120 HP or less.'); break;
        case 'iono': if (once('iono')) T('iono', {}, `both players put their hand on the bottom of their deck and draw a card for each of their remaining Prize cards (you ${p.prizes.length}, opponent ${o.prizes.length}).`); break;
        case 'ryme': if (once('ryme')) T('ryme', {}, `draw 3 cards and switch the opponent's Active ${o.active.name} to their Bench (they choose the new one).`); break;
        case 'mela': if (this.koLastTurn(p) && p.discard.some((x) => basicEnergy(x) && x.energyType === 'Fire') && once('mela')) T('mela', {}, 'attach a basic Fire Energy from your discard pile to one of your Pokémon and draw until you have 6 cards.'); break;
        case 'turoScenario': for (const m of mons) if (mons.length > 1 && once('turo' + m.id)) T('turoScenario', { m: m.name }, `put ${monEn(m)} back into your hand (its attached cards are discarded).`, { target: m }); break;
        case 'rika': if (p.deck.length && once('rika')) T('rika', {}, 'look at the top 4 cards of your deck and put 2 of them into your hand.'); break;
        case 'roark': if (once('roark')) T('roark', {}, 'draw 2 cards and put a basic Energy from your discard pile into your hand.'); break;
        case 'trArcher': if (this.koLastTurn(p) && once('archer')) T('trArcher', {}, 'both players shuffle their hands into their decks; you draw 5, the opponent draws 3.'); break;
        case 'trAriana': if (once('ariana')) T('trAriana', {}, 'draw until you have 5 cards in hand (8 if all your Pokémon are Team Rocket’s).'); break;
        case 'trGiovanni': if (isTR(p.active) && p.bench.some(isTR) && o.bench.length && once('trg')) T('trGiovanni', {}, "switch your Active Team Rocket's Pokémon with a Benched one, then pull one of the opponent's Benched Pokémon into the Active Spot."); break;
        case 'trPetrel': if (deckHas((x) => x.kind === 'trainer') && once('petrel')) T('trPetrel', {}, 'search your deck for any Trainer card.'); break;
        case 'trProton': if (once('proton')) T('trProton', {}, "search your deck for up to 3 Basic Team Rocket's Pokémon."); break;
        default: this.megaTrainerActions(p, o, c, once, T, monEn);
      }
    },

    async playModernTrainer(p, o, c, act, L) {
      const m = act.target;
      const hide = (x) => SECRET(p, C(x));
      const pokeAi = (x) => (x.stage > 0 && this.allMons(p).some((y) => y.name === x.evolvesFrom) ? 10 : 0) + (x.prizes ? 6 : 0) + (x.stage === 0 && p.bench.length < MAX_BENCH ? 3 : 0);
      const toHand = (x) => { p.hand.push(this.searchDeck(p, x)); };
      const benchFromDeck = (x) => this.benchFromDeck(p, x);
      if (c.ttype === 'supporter') {
        p.flags.supporter = true;
        this.learn('supporter');
        if (c.name.includes('Team Rocket')) p.flags.trSupporter = true;
      }
      switch (c.tkind) {
        case 'tool':
          await this.hooks.onAttach?.({ p: p.idx, mon: m.id, card: c });
          m.tools.push({ card: this.pullFromDiscard(p, c), expires: c.tool.startsWith('tm') ? this.turn : TOOL_FOREVER });
          L('attach', { m: m.name });
          if (this.statusImmune(m) && m.conditions().length) { m.status = {}; this.log('log.cured', { m: m.name }, 'heal'); }
          this.learn('modernTool');
          break;
        case 'stadium':
          if (this.stadium) { this.players[this.stadium.owner].discard.push(this.stadium.card); this.log('log.stadiumOff', { c: C(this.stadium.card) }); }
          this.stadium = { card: this.pullFromDiscard(p, c), owner: p.idx };
          p.flags.stadiumPlayed = true;
          L('stadium');
          this.learn('stadium');
          break;
        case 'potion30': L('heal', { m: m.name, n: await this.heal(m, 30) }); break;
        case 'energyRetrievalM': {
          let n = 0;
          for (let k = 0; k < 2; k++) {
            const en = await this.pickCard(p, 'search', p.discard.filter(basicEnergy), 'prompt.q.fromDiscard', { c: C(c) }, 'Choose a basic Energy from your discard pile to put into your hand.', { none: k > 0, ai: () => 1 });
            if (!en) break;
            p.hand.push(this.pullFromDiscard(p, en)); n++;
          }
          L('retrievedN', { n });
          break;
        }
        case 'energySwitch': {
          const from = await this.pickMon(p, 'chargeFrom', this.allMons(p).filter((x) => x.energy.some(basicEnergy)), 'prompt.q.moveFrom', { c: C(c) }, 'Move a basic Energy away from which Pokémon?', (x) => (x === p.active ? -1 : 1));
          const to = await this.pickMon(p, 'sabrinaTo', this.allMons(p).filter((x) => x !== from), 'prompt.q.moveTo', { c: C(c) }, 'Move it onto which Pokémon?', (x) => (x === p.active ? 5 : 0));
          const i = from.energy.findIndex(basicEnergy);
          to.energy.push(...from.energy.splice(i, 1));
          this.log('log.energyMoved', { a: from.name, b: to.name, t: { $type: typeOf(to.energy.at(-1)) } });
          break;
        }
        case 'nestBall': {
          const x = await this.pickCard(p, 'search', p.deck.filter(isBasic), 'prompt.q.callFamily', { c: C(c) }, 'Choose a Basic Pokémon from your deck to put onto your Bench.', { ai: pokeAi });
          if (x) await benchFromDeck(x); else shuffle(p.deck);
          break;
        }
        case 'buddyPoffin':
          for (let k = 0; k < 2 && p.bench.length < MAX_BENCH; k++) {
            const x = await this.pickCard(p, 'search', p.deck.filter((y) => isBasic(y) && y.hp <= 70), 'prompt.q.callFamily', { c: C(c) }, 'Choose a Basic Pokémon (70 HP or less) to put onto your Bench.', { none: true, ai: pokeAi });
            if (!x) break;
            await benchFromDeck(x);
          }
          shuffle(p.deck);
          break;
        case 'ultraBall': {
          for (let k = 0; k < 2; k++) {
            const d = await this.pickCard(p, 'discard', p.hand, 'prompt.q.discardK', { c: C(c), k: k + 1, n: 2 }, 'Choose a card from your hand to discard.', { unique: false, ai: (x) => (x.kind === 'energy' ? 1 : x.ttype === 'stadium' ? 2 : 0) });
            if (d) p.discard.push(this.takeFromHand(p, d));
          }
          const x = await this.pickCard(p, 'search', p.deck.filter((y) => y.kind === 'pokemon'), 'prompt.q.searchPokemon', { c: C(c) }, 'Choose a Pokémon from your deck to put into your hand.', { ai: pokeAi });
          if (x) { toHand(x); L('got', { got: hide(x) }); }
          break;
        }
        case 'greatBall': case 'pokegear': {
          const top = p.deck.slice(-7).reverse();
          const ok = c.tkind === 'greatBall' ? (x) => x.kind === 'pokemon' : (x) => x.ttype === 'supporter';
          const x = await this.pickCard(p, 'search', top.filter(ok), c.tkind === 'greatBall' ? 'prompt.q.searchPokemon' : 'prompt.q.searchSupporter', { c: C(c) }, 'Choose a card from the top of your deck to put into your hand.', { none: true, unique: false, ai: pokeAi });
          if (x) { p.deck.splice(p.deck.indexOf(x), 1); p.hand.push(x); L('got', { got: hide(x) }); } else L('nothing');
          shuffle(p.deck);
          break;
        }
        case 'palPad': case 'superRod': {
          const max = c.tkind === 'palPad' ? 2 : 3;
          const ok = c.tkind === 'palPad' ? (x) => x.ttype === 'supporter' : (x) => x.kind === 'pokemon' || basicEnergy(x);
          let n = 0;
          for (let k = 0; k < max; k++) {
            const x = await this.pickCard(p, 'search', p.discard.filter(ok), 'prompt.q.toDeck', { c: C(c) }, 'Choose a card from your discard pile to shuffle into your deck.', { none: k > 0, unique: false, ai: (y) => (y.kind === 'pokemon' ? 2 : 1) });
            if (!x) break;
            p.deck.push(this.pullFromDiscard(p, x)); n++;
          }
          shuffle(p.deck);
          L('shuffledBack', { n });
          break;
        }
        case 'nightStretcher': {
          const x = await this.pickCard(p, 'search', p.discard.filter((y) => y.kind === 'pokemon' || basicEnergy(y)), 'prompt.q.fromDiscard', { c: C(c) }, 'Choose a Pokémon or basic Energy from your discard pile to put into your hand.', { unique: false, ai: (y) => (y.kind === 'pokemon' ? 2 + (y.prizes ? 3 : 0) : 1) });
          if (x) { p.hand.push(this.pullFromDiscard(p, x)); L('got', { got: C(x) }); }
          break;
        }
        case 'energySticker': {
          if (!(await this.flip('trainer', { c: C(c) }, [{ key: 'coin.o.attachEnergy', params: {} }, { key: 'coin.o.nothing', params: {} }]))) { L('nothing'); break; }
          await this.attachFromDiscard(p, p.bench, 1, basicEnergy, c.name);
          break;
        }
        case 'earthenVessel': {
          const d = await this.pickCard(p, 'discard', p.hand, 'prompt.q.discard1', { c: C(c) }, 'Choose 1 card from your hand to discard.', { unique: false, ai: (x) => (x.kind === 'energy' ? 1 : 0) });
          if (d) p.discard.push(this.takeFromHand(p, d));
          let n = 0;
          for (let k = 0; k < 2; k++) {
            const x = await this.pickCard(p, 'search', p.deck.filter(basicEnergy), 'prompt.q.searchEnergy', { c: C(c) }, 'Choose a basic Energy from your deck.', { none: true, ai: () => 1 });
            if (!x) break;
            p.hand.push(p.deck.splice(p.deck.indexOf(x), 1)[0]); n++;
          }
          shuffle(p.deck);
          L('energiesN', { n });
          break;
        }
        case 'electricGenerator': {
          const top = p.deck.splice(-5);
          const targets = p.bench.filter((x) => x.card.type === 'Lightning');
          let n = 0;
          for (const en of top.filter((x) => basicEnergy(x) && x.energyType === 'Lightning').slice(0, 2)) {
            const t = await this.pickMon(p, 'attachTo', targets, 'prompt.q.attachTo', { c: C(c) }, 'Attach this Lightning Energy to which Benched Pokémon?', (x) => -this.energyGap(x));
            await this.hooks.onAttach?.({ p: p.idx, mon: t.id, card: en });
            top.splice(top.indexOf(en), 1);
            t.energy.push(en); n++;
          }
          p.deck.push(...top);
          shuffle(p.deck);
          L('energiesN', { n });
          break;
        }
        case 'switch': this.swapActive(p, m); L('switch', { m: p.active.name }); await this.becameActive(p); break;
        case 'scrambleSwitch': {
          const old = p.active;
          this.swapActive(p, m);
          const n = await this.pickNumber(p, 'drawN', old.energy.length, 'prompt.q.moveHowMany', { c: C(c), m: old.name }, `Move how many Energy from ${old.name} to ${m.name}?`, (k) => k);
          m.energy.push(...old.energy.splice(-n || old.energy.length, n));
          L('scramble', { m: m.name, n });
          await this.becameActive(p);
          break;
        }
        case 'counterCatcher': case 'bossOrders': this.swapActive(o, m); L('gust', { m: o.active.name }); break;
        case 'primeCatcher':
          this.swapActive(o, m);
          L('gust', { m: o.active.name });
          if (p.bench.length) {
            const t = await this.pickMon(p, 'promote', p.bench, 'prompt.q.switchSelf', { c: C(c) }, 'Choose which of your Benched Pokémon becomes Active.', (x) => x.hpLeft / 10 + x.energy.length * 5);
            this.swapActive(p, t);
            this.plog(p, 'log.t.switched', { m: p.active.name });
            await this.becameActive(p);
          }
          break;
        case 'rareCandy': await this.evolveMon(p, m, act.evo, { candy: true }); break;
        case 'unfairStamp': case 'trArcher': {
          const [mine, theirs] = c.tkind === 'unfairStamp' ? [5, 2] : [5, 3];
          this.shuffleHandIn(p); this.shuffleHandIn(o);
          this.plog(p, 'log.t.newHand', { n: this.draw(p, mine) });
          this.plog(o, 'log.t.newHand', { n: this.draw(o, theirs) });
          break;
        }
        case 'trTransceiver': case 'trPetrel': case 'arven': {
          const want = c.tkind === 'arven' ? [['item', (x) => x.ttype === 'item'], ['tool', (x) => x.ttype === 'tool']]
            : c.tkind === 'trPetrel' ? [['trainer', (x) => x.kind === 'trainer']] : [['supporter', (x) => x.ttype === 'supporter' && x.name.includes('Team Rocket')]];
          for (const [, ok] of want) {
            const x = await this.pickCard(p, 'search', p.deck.filter(ok), 'prompt.q.searchTrainer', { c: C(c) }, 'Choose a Trainer card from your deck to put into your hand.', { ai: (y) => (y.tkind === 'rareCandy' ? 3 : y.tkind === 'ultraBall' ? 2 : 1) });
            if (x) { toHand(x); L('got', { got: C(x) }); }
          }
          shuffle(p.deck);
          break;
        }
        case 'jacq': case 'clavell': case 'trProton': {
          const [n, ok] = c.tkind === 'jacq' ? [2, (x) => x.kind === 'pokemon' && x.stage > 0]
            : c.tkind === 'clavell' ? [3, (x) => isBasic(x) && x.hp <= 120] : [3, (x) => isBasic(x) && isTR(x)];
          let got = 0;
          for (let k = 0; k < n; k++) {
            const x = await this.pickCard(p, 'search', p.deck.filter(ok), 'prompt.q.searchPokemon', { c: C(c) }, 'Choose a Pokémon from your deck to put into your hand.', { none: true, ai: pokeAi });
            if (!x) break;
            p.hand.push(p.deck.splice(p.deck.indexOf(x), 1)[0]); got++;
          }
          shuffle(p.deck);
          L('gotN', { n: got });
          break;
        }
        case 'nemona': L('drew', { n: this.draw(p, 3) }); break;
        case 'professorsResearch': p.discard.push(...p.hand); p.hand = []; L('oak', { n: this.draw(p, 7) }); break;
        case 'youngster': this.shuffleHandIn(p); L('drew', { n: this.draw(p, 5) }); break;
        case 'iono':
          for (const q of [p, o]) {
            shuffle(q.hand);
            q.deck.unshift(...q.hand); // the bottom of the deck
            q.hand = [];
            this.plog(q, 'log.t.newHand', { n: this.draw(q, q.prizes.length) });
          }
          break;
        case 'ryme': {
          L('drew', { n: this.draw(p, 3) });
          if (o.bench.length && !this.poncho(o.active)) {
            const t = await this.pickMon(o, 'whirlwind', o.bench, 'prompt.whirlwind.text', {}, 'Your Active Pokémon is sent to the Bench: choose which Benched Pokémon becomes Active.', (x) => x.hpLeft / 10);
            this.swapActive(o, t);
            this.plog(o, 'log.t.switched', { m: o.active.name });
          }
          break;
        }
        case 'mela':
          await this.attachFromDiscard(p, this.allMons(p), 1, (x) => basicEnergy(x) && x.energyType === 'Fire', c.name);
          L('drew', { n: this.draw(p, Math.max(0, 6 - p.hand.length)) });
          break;
        case 'turoScenario': {
          const tools = m.tools.map((x) => x.card), energy = [...m.energy];
          const stack = [...m.stack];
          this.removeFromPlay(p, m);
          p.hand.push(...stack);
          p.discard.push(...energy, ...tools);
          L('turo', { m: m.name });
          await this.refillActive();
          break;
        }
        case 'rika': {
          const top = p.deck.splice(-4).reverse();
          for (let k = 0; k < 2 && top.length; k++) {
            const x = (await this.pickCard(p, 'search', top, 'prompt.q.keepK', { c: C(c), k: k + 1, n: 2 }, 'Choose a card to put into your hand.', { unique: false, ai: pokeAi })) || top[0];
            top.splice(top.indexOf(x), 1);
            p.hand.push(x);
          }
          shuffle(top);
          p.deck.unshift(...top);
          L('rika');
          break;
        }
        case 'roark': {
          L('drew', { n: this.draw(p, 2) });
          const en = p.discard.findLast(basicEnergy);
          if (en) { p.hand.push(this.pullFromDiscard(p, en)); L('got', { got: C(en) }); }
          break;
        }
        case 'trAriana': {
          const all = this.allMons(p).every(isTR);
          L('drew', { n: this.draw(p, Math.max(0, (all ? 8 : 5) - p.hand.length)) });
          break;
        }
        case 'trGiovanni': {
          const t = await this.pickMon(p, 'promote', p.bench.filter(isTR), 'prompt.q.switchSelf', { c: C(c) }, "Choose which Benched Team Rocket's Pokémon becomes Active.", (x) => x.hpLeft / 10 + x.energy.length * 5);
          this.swapActive(p, t);
          const g = await this.pickMon(p, 'lure', o.bench.filter((x) => !this.poncho(x)), 'prompt.lure.text', {}, "Choose one of the opponent's Benched Pokémon to pull into the Active Spot.", (x) => -x.hpLeft);
          if (g) { this.swapActive(o, g); L('gust', { m: o.active.name }); }
          await this.becameActive(p);
          break;
        }
        default: await this.playMegaTrainer(p, o, c, act, L);
      }
    },

    // How far a Pokémon is from its strongest attack (for the AI's choices).
    energyGap(m) { return Math.max(0, ...m.card.attacks.map((a) => a.cost.length)) - m.energyTypes.length; },

    // Attach N (or "up to N": the player may stop) Energy from the discard pile; the player picks which when they differ.
    async attachFromDiscard(p, targets, n, ok, source, { upTo = false } = {}) {
      let done = 0;
      for (let k = 0; k < n; k++) {
        const pool = p.discard.filter(ok);
        if (!pool.length || !targets.length) break;
        const en = upTo || new Set(pool.map((x) => x.name)).size > 1
          ? await this.pickCard(p, 'search', pool, 'prompt.q.attachWhichEnergy', { c: source }, 'Which Energy from your discard pile do you attach?', { none: upTo, ai: () => 1 })
          : pool.at(-1);
        if (!en) break;
        const t = await this.pickMon(p, 'attachTo', targets, 'prompt.q.attachTo', { c: source }, `Attach ${en.name} from your discard pile to which Pokémon?`, (x) => (x === p.active ? 2 : 0) - this.energyGap(x) * -1);
        await this.hooks.onAttach?.({ p: p.idx, mon: t.id, card: en });
        t.energy.push(this.pullFromDiscard(p, en));
        this.plog(p, 'log.energy', { c: C(en), m: t.name });
        done++;
      }
      return done;
    },

    // Evolving (from the hand, with Rare Candy, or straight from the deck), with the "when you evolve" Abilities.
    async evolveMon(p, m, card, { candy = false, fromDeck = false } = {}) {
      if (!card || !(fromDeck ? p.deck : p.hand).includes(card)) return; // nothing (left) to evolve into
      await this.hooks.onEvolve?.({ p: p.idx, mon: m.id, from: m.card, to: card });
      const from = m.name;
      m.stack.push(fromDeck ? this.searchDeck(p, card) : this.takeFromHand(p, card));
      m.playedTurn = this.turn;
      m.status = {};
      // Evolving ends the effects of attacks; an Ability's (Stance) and "moved to the Active Spot this turn" (Gale Thrust) stay.
      const kept = Object.entries(m.effects).filter(([k, v]) => v?.src === 'ability' || k === 'movedActive');
      m.effects = { ...Object.fromEntries(kept), evolvedNow: { expires: this.turn } }; // Raid: "if this Pokémon evolved during this turn"
      this.plog(p, candy ? 'log.candy' : 'log.evolve', { from, to: m.name });
      this.learn(candy ? 'rareCandy' : 'evolve');
      if (!fromDeck) await this.onEvolveAbility(p, m);
    },

    async onEvolveAbility(p, m) {
      const k = m.card.powerKind, o = this.opp(p);
      if (!k || !this.powerOn(m)) return;
      if (await this.megaOnEvolve(p, m)) return;
      const say = () => this.plog(p, 'log.ability', { m: m.name, pw: m.card.power.name });
      const counters = async (targets, n) => {
        await this.spread(m, targets.map((x) => [x, n]), { counters: true });
        this.log('log.counters', { n: n / 10, list: targets.map((x) => x.name).join(', ') }, 'dmg');
      };
      switch (k) {
        case 'enrichingOil': {
          const hurt = this.allMons(p).filter((x) => x.damage);
          if (!hurt.length) return;
          say();
          const t = await this.pickMon(p, 'heal', hurt, 'prompt.q.healAll', { c: m.card.power.name }, 'Heal all damage from which Pokémon?', (x) => x.damage);
          await this.heal(t, t.damage);
          break;
        }
        case 'sneakyBite': {
          say();
          const t = await this.pickMon(p, 'snipe', this.allMons(o).filter((x) => !this.abilityImmune(x)), 'prompt.q.counters', { c: m.card.power.name, n: 2 }, 'Put 2 damage counters on which of the opponent’s Pokémon?', (x) => (x.hpLeft <= 20 ? 50 : 0) - x.hpLeft / 10);
          if (t) await counters([t], 20);
          break;
        }
        case 'bitingSpree': {
          say();
          const pool = this.allMons(o).filter((x) => !this.abilityImmune(x)), picked = [];
          for (let i = 0; i < 2 && pool.length; i++) {
            const t = await this.pickMon(p, 'snipe', pool, 'prompt.q.counters', { c: m.card.power.name, n: 2 }, 'Put 2 damage counters on which of the opponent’s Pokémon?', (x) => (x.hpLeft <= 20 ? 50 : 0) - x.hpLeft / 10);
            pool.splice(pool.indexOf(t), 1);
            picked.push(t);
          }
          if (picked.length) await counters(picked, 20);
          break;
        }
        case 'infernalReign': {
          const fires = p.deck.filter((x) => basicEnergy(x) && x.energyType === 'Fire').slice(0, 3);
          if (!fires.length) return;
          say();
          for (const en of fires) {
            const t = await this.pickMon(p, 'attachTo', this.allMons(p), 'prompt.q.attachTo', { c: m.card.power.name }, 'Attach a Fire Energy from your deck to which Pokémon?', (x) => (x === m ? 3 : 0) + (x.card.type === 'Fire' ? 2 : 0));
            await this.hooks.onAttach?.({ p: p.idx, mon: t.id, card: en });
            t.energy.push(p.deck.splice(p.deck.indexOf(en), 1)[0]);
          }
          shuffle(p.deck);
          this.plog(p, 'log.energiesFound', { n: fires.length });
          break;
        }
        case 'fullyBlooming': {
          const top = p.deck.splice(-8);
          const found = top.filter(basicEnergy);
          say();
          for (const en of found) {
            const t = await this.pickMon(p, 'attachTo', this.allMons(p), 'prompt.q.attachTo', { c: m.card.power.name }, `Attach ${en.name} to which Pokémon?`, (x) => (x === p.active ? 2 : 0) + (x.card.attacks.some((a) => a.cost.includes(en.energyType)) ? 2 : 0));
            await this.hooks.onAttach?.({ p: p.idx, mon: t.id, card: en });
            top.splice(top.indexOf(en), 1);
            t.energy.push(en);
          }
          p.deck.push(...top);
          shuffle(p.deck);
          this.plog(p, 'log.energiesFound', { n: found.length });
          break;
        }
      }
    },

    async onBenchAbility(p, m) {
      const k = m.card.powerKind;
      if (!k || !this.powerOn(m)) return;
      if (await this.megaOnBench(p, m)) return;
      if (k === 'rapidVernier' && p.active) {
        const id = await this.pick(p, 'yesno', 'prompt.gen.title', 'prompt.q.rapidVernier', [
          { id: 'yes', label: { key: 'opt.yes' }, en: `Switch ${m.name} into the Active Spot and move Energy onto it.`, ai: 2 },
          { id: 'no', label: { key: 'opt.no' }, en: 'Leave it on the Bench.', ai: 0 }], { params: { c: m.card.power.name }, en: 'Use Rapid Vernier?' });
        if (id !== 'yes') return;
        this.plog(p, 'log.ability', { m: m.name, pw: m.card.power.name });
        this.swapActive(p, m);
        let moved = 0;
        for (const x of this.allMons(p)) if (x !== m && x.energy.length) {
          const n = await this.pickNumber(p, 'drawN', x.energy.length, 'prompt.q.moveHowMany', { c: m.card.power.name, m: x.name }, `Move how many Energy from ${x.name} to ${m.name}?`, (k) => k);
          moved += n;
          m.energy.push(...x.energy.splice(-n || x.energy.length, n));
        }
        if (moved) this.plog(p, 'log.energyMovedN', { n: moved, m: m.name });
      }
      if (k === 'luminousSign') {
        const x = await this.pickCard(p, 'search', p.deck.filter((y) => y.ttype === 'supporter'), 'prompt.q.searchSupporter', { c: m.card.power.name }, 'Choose a Supporter card from your deck.', { none: true, ai: (y) => (y.tkind === 'bossOrders' ? 3 : y.tkind === 'arven' ? 2 : 1) });
        if (x) { p.hand.push(this.searchDeck(p, x)); this.plog(p, 'log.ability', { m: m.name, pw: m.card.power.name }); }
      }
    },

    // ---------------- Abilities used as an action ----------------
    abilityActions(p, o, add, lbl, monEn) {
      const usable = (m) => !p.flags.powers[m.id];
      for (const m of this.allMons(p)) {
        const k = m.card.powerKind;
        const sources = [[m, k, m.card.power]];
        // Forest Seal Stone gives a Pokémon V the VSTAR Power Star Alchemy (once per game).
        for (const tl of m.tools) if (tl.card.power?.vstar) sources.push([m, tl.card.power.kind, tl.card.power]);
        for (const [mon, kind, power] of sources) {
          if (!kind || !this.powerOn(mon)) continue;
          const A = (detail, extra = {}) => add('power', lbl('ability', { m: mon.name, pw: power.name }), `Ability ${power.name} of ${mon.name}: ${detail}`, { target: mon, pkind: kind, ...extra });
          const handEnergy = (type) => p.hand.some((x) => basicEnergy(x) && (!type || x.energyType === type));
          switch (kind) {
            case 'rumblingEngine': if (usable(mon) && handEnergy() && p.hand.length - 1 < 6 && p.deck.length) A('discard an Energy card from your hand, then draw until you have 6 cards. Once per turn.'); break;
            case 'energyCarnival': if (usable(mon) && handEnergy()) A('attach a basic Energy from your hand to one of your Pokémon. Once per turn.'); break;
            case 'tandemUnit': if (usable(mon) && p.bench.length < MAX_BENCH && p.deck.some((x) => isBasic(x) && x.type === 'Lightning')) A('put up to 2 Basic Lightning Pokémon from your deck onto your Bench. Once per turn.'); break;
            case 'psychicEmbrace': if (p.discard.some((x) => basicEnergy(x) && x.energyType === 'Psychic') && this.allMons(p).some((x) => x.card.type === 'Psychic' && x.hpLeft > 20)) A('attach a basic Psychic Energy from your discard pile to one of your Psychic Pokémon and put 2 damage counters on it. As often as you like.'); break;
            case 'chargingUp': if (usable(mon) && p.discard.some(basicEnergy)) A('attach a basic Energy from your discard pile to this Pokémon. Once per turn.'); break;
            case 'superCold': if (handEnergy('Water')) A('attach a basic Water Energy from your hand to one of your Pokémon. As often as you like.'); break;
            case 'quickSearch': if (usable(mon) && !p.flags.quickSearch && p.deck.length) A('search your deck for any card and put it into your hand. Once per turn.'); break;
            case 'restart': if (usable(mon) && p.hand.length < 3 && p.deck.length) A('draw until you have 3 cards in your hand. Once per turn.'); break;
            case 'clairvoyantSense': if (usable(mon) && p.bench.length && handEnergy('Psychic')) A('attach a basic Psychic Energy from your hand to one of your Benched Pokémon, then draw 2 cards. Once per turn.'); break;
            case 'reconDirective': if (usable(mon) && p.deck.length) A('look at the top 2 cards of your deck, put 1 into your hand and the other on the bottom. Once per turn.'); break;
            case 'attractCustomers': if (usable(mon) && p.active === mon && p.deck.length) A('look at the top 6 cards of your deck and take a Supporter from them. Once per turn, only while Active.'); break;
            case 'flipTheScript': if (usable(mon) && !p.flags.flipScript && this.koLastTurn(p) && p.deck.length) A('draw 3 cards (one of your Pokémon was Knocked Out last turn). Once per turn.'); break;
            case 'shiveryChill': if (usable(mon) && p.active === mon && p.deck.some((x) => basicEnergy(x) && x.energyType === 'Water')) A('take up to 2 basic Water Energy from your deck into your hand. Once per turn, only while Active.'); break;
            case 'concealedCards': if (usable(mon) && handEnergy() && p.deck.length) A('discard an Energy card from your hand to draw 2 cards. Once per turn.'); break;
            case 'refinement': if (usable(mon) && p.hand.length && p.deck.length) A('discard a card from your hand to draw 2 cards. Once per turn.'); break;
            case 'industriousIncisors': if (usable(mon) && p.hand.length < 5 && p.deck.length) A('draw until you have 5 cards in your hand. Once per turn.'); break;
            case 'starAlchemy': if (!p.vstarUsed && p.deck.length) A('VSTAR Power: search your deck for any card and put it into your hand. Only once per game.', { vstar: true }); break;
            default: this.megaAbilityAction(p, o, mon, kind, power, A, usable);
          }
        }
      }
    },

    async useAbility(p, act) {
      const m = act.target, o = this.opp(p);
      const power = act.vstar ? m.tools.find((x) => x.card.power?.vstar).card.power : m.card.power;
      p.flags.powers[m.id] = true;
      this.plog(p, 'log.ability', { m: m.name, pw: power.name });
      this.learn('ability');
      const pickHand = (text, ok, ai) => this.pickCard(p, 'discard', p.hand.filter(ok), text, { c: power.name }, 'Choose a card from your hand.', { unique: false, ai });
      const attachFromHand = async (type, targets) => {
        const en = await pickHand('prompt.q.energyFromHand', (x) => basicEnergy(x) && (!type || x.energyType === type), () => 1);
        const t = await this.pickMon(p, 'attachTo', targets, 'prompt.q.attachTo', { c: power.name }, `Attach ${en.name} to which Pokémon?`, (x) => (x === p.active ? 2 : 0) + (x.card.attacks.some((a) => a.cost.includes(en.energyType)) ? 2 : 0) - (x.energyTypes.length > 4 ? 3 : 0));
        await this.hooks.onAttach?.({ p: p.idx, mon: t.id, card: en });
        t.energy.push(this.takeFromHand(p, en));
        this.plog(p, 'log.energy', { c: C(en), m: t.name });
        await this.oldCemetery(t);
      };
      const anyCard = async (kind) => {
        const x = await this.pickCard(p, 'search', p.deck, 'prompt.q.searchAny', { c: power.name }, 'Choose any card from your deck to put into your hand.', { ai: (y) => (y.tkind === 'rareCandy' ? 5 : y.ttype === 'supporter' ? 4 : y.kind === 'pokemon' && y.stage > 0 ? 3 : 1) });
        if (x) { p.hand.push(this.searchDeck(p, x)); this.plog(p, 'log.t.got', { c: power.name, got: SECRET(p, C(x)) }); }
      };
      switch (act.pkind) {
        case 'rumblingEngine': case 'concealedCards': case 'refinement': {
          const ok = act.pkind === 'refinement' ? () => true : basicEnergy;
          const d = await pickHand('prompt.q.discard1', ok, (x) => (x.kind === 'energy' ? 1 : 0));
          if (d) p.discard.push(this.takeFromHand(p, d));
          const n = act.pkind === 'rumblingEngine' ? Math.max(0, 6 - p.hand.length) : 2;
          this.plog(p, 'log.t.drewN', { n: this.draw(p, n) });
          break;
        }
        case 'energyCarnival': await attachFromHand(null, this.allMons(p)); break;
        case 'superCold': await attachFromHand('Water', this.allMons(p)); p.flags.powers[m.id] = false; break;
        case 'clairvoyantSense': await attachFromHand('Psychic', p.bench); this.plog(p, 'log.t.drewN', { n: this.draw(p, 2) }); break;
        case 'tandemUnit':
          for (let k = 0; k < 2 && p.bench.length < MAX_BENCH; k++) {
            const x = await this.pickCard(p, 'search', p.deck.filter((y) => isBasic(y) && y.type === 'Lightning'), 'prompt.q.callFamily', { c: power.name }, 'Choose a Basic Lightning Pokémon to put onto your Bench.', { none: true, ai: (y) => y.hp });
            if (!x) break;
            p.bench.push(new Mon(this.searchDeck(p, x), this.turn));
            this.plog(p, 'log.bench', { c: C(x) });
          }
          shuffle(p.deck);
          break;
        case 'psychicEmbrace': {
          const en = p.discard.findLast((x) => basicEnergy(x) && x.energyType === 'Psychic');
          const t = await this.pickMon(p, 'attachTo', this.allMons(p).filter((x) => x.card.type === 'Psychic' && x.hpLeft > 20), 'prompt.q.attachTo', { c: power.name }, 'Attach a Psychic Energy from your discard pile to which Psychic Pokémon (it takes 2 damage counters)?', (x) => (x.card.name.includes('Gardevoir') ? 3 : 0) + (x === p.active ? 2 : 0) + x.hpLeft / 100);
          await this.hooks.onAttach?.({ p: p.idx, mon: t.id, card: en });
          t.energy.push(this.pullFromDiscard(p, en));
          await this.spread(m, [[t, 20]], { counters: true });
          this.log('log.counters', { n: 2, list: t.name }, 'dmg');
          p.flags.powers[m.id] = false; // as often as you like
          break;
        }
        case 'chargingUp': await this.attachFromDiscard(p, [m], 1, basicEnergy, power.name); break;
        case 'quickSearch': p.flags.quickSearch = true; await anyCard(); break;
        case 'starAlchemy': p.vstarUsed = true; await anyCard(); break;
        case 'restart': this.plog(p, 'log.t.drewN', { n: this.draw(p, Math.max(0, 3 - p.hand.length)) }); break;
        case 'industriousIncisors': this.plog(p, 'log.t.drewN', { n: this.draw(p, Math.max(0, 5 - p.hand.length)) }); break;
        case 'flipTheScript': p.flags.flipScript = true; this.plog(p, 'log.t.drewN', { n: this.draw(p, 3) }); break;
        case 'reconDirective': {
          const top = p.deck.splice(-2).reverse();
          const x = (await this.pickCard(p, 'search', top, 'prompt.q.keepOne', { c: power.name }, 'Choose the card to put into your hand; the other goes to the bottom of your deck.', { unique: false, ai: (y) => (y.kind === 'trainer' ? 2 : 1) })) || top[0];
          p.hand.push(x);
          p.deck.unshift(...top.filter((y) => y !== x));
          this.plog(p, 'log.t.drewN', { n: 1 });
          break;
        }
        case 'attractCustomers': {
          const top = p.deck.slice(-6);
          const x = await this.pickCard(p, 'search', top.filter((y) => y.ttype === 'supporter'), 'prompt.q.searchSupporter', { c: power.name }, 'Choose a Supporter from the top of your deck.', { none: true, unique: false, ai: () => 1 });
          if (x) { p.deck.splice(p.deck.indexOf(x), 1); p.hand.push(x); this.plog(p, 'log.t.got', { c: power.name, got: C(x) }); }
          shuffle(p.deck);
          break;
        }
        case 'shiveryChill': {
          let n = 0;
          for (let k = 0; k < 2; k++) {
            const en = p.deck.find((x) => basicEnergy(x) && x.energyType === 'Water');
            if (!en) break;
            p.hand.push(p.deck.splice(p.deck.indexOf(en), 1)[0]); n++;
          }
          shuffle(p.deck);
          this.plog(p, 'log.energiesFound', { n });
          break;
        }
        default: return this.megaUseAbility(p, o, m, act, power, { pickHand });
      }
    },

    // Stadium actions (Artazon, Team Rocket's Factory).
    modernStadiumActions(p, add, lbl) {
      const s = this.stadium?.card;
      if (!s || p.flags.stadiumUsed) return;
      const S = (key, detail) => add('stadium', lbl('s.' + key, { c: C(s) }), `Stadium ${s.name}: ${detail}`, { stadium: key });
      if (s.stadium === 'artazon' && p.bench.length < MAX_BENCH && p.deck.some((x) => isBasic(x) && !ruleBox(x))) S('artazon', 'put a Basic Pokémon without a Rule Box from your deck onto your Bench. Once per turn.');
      if (s.stadium === 'trFactory' && p.flags.trSupporter && p.deck.length) S('trFactory', "draw 2 cards (you played a Team Rocket's Supporter this turn). Once per turn.");
      this.megaStadiumActions(p, S);
    },
    async useModernStadium(p, act) {
      const s = this.stadium.card;
      p.flags.stadiumUsed = true;
      if (act.stadium === 'artazon') {
        const x = await this.pickCard(p, 'search', p.deck.filter((y) => isBasic(y) && !ruleBox(y)), 'prompt.q.callFamily', { c: C(s) }, 'Choose a Basic Pokémon to put onto your Bench.', { ai: (y) => y.hp });
        if (x) { p.bench.push(new Mon(this.searchDeck(p, x), this.turn)); this.plog(p, 'log.bench', { c: C(x) }); }
        else shuffle(p.deck);
      }
      if (act.stadium === 'trFactory') this.plog(p, 'log.t.drewN', { n: this.draw(p, 2) });
      return this.megaUseStadium(p, act); // true when the Stadium ends the turn (Jubilife Village)
    },

    // ---------------- Attack effects of modern cards ----------------
    // Choices made before the damage (they add to it).
    async modernPreDamage(p, a, atk, fx) {
      let bonus = 0;
      if (fx.optionalDiscardBonus && a.energy.length >= fx.optionalDiscardBonus.n) {
        const id = await this.pick(p, 'yesno', 'prompt.gen.title', 'prompt.q.discardForBonus', [
          { id: 'yes', label: { key: 'opt.yes' }, en: `Discard ${fx.optionalDiscardBonus.n} Energy for +${fx.optionalDiscardBonus.bonus} damage.`, ai: 1 },
          { id: 'no', label: { key: 'opt.no' }, en: 'Keep the Energy.', ai: 0 }], { params: { c: atk.name, n: fx.optionalDiscardBonus.n, b: fx.optionalDiscardBonus.bonus }, en: 'Discard Energy for more damage?' });
        if (id === 'yes') { p.discard.push(...a.energy.splice(-fx.optionalDiscardBonus.n)); bonus += fx.optionalDiscardBonus.bonus; }
      }
      if (fx.hailBlade) {
        const all = this.allMons(p).flatMap((m) => m.energy.filter((en) => en.energyType === fx.hailBlade.type).map((en) => [m, en]));
        const n = await this.pickNumber(p, 'drawN', all.length, 'prompt.q.discardHowMany', { c: atk.name, t: { $type: fx.hailBlade.type } }, `How many ${fx.hailBlade.type} Energy do you discard (${fx.hailBlade.n} damage each)?`, (k) => k);
        // The player picks where each one comes from (the AI takes them from the Bench first, keeping the attacker's).
        for (let k = 0; k < n; k++) {
          const from = this.allMons(p).filter((m) => m.energy.some((en) => en.energyType === fx.hailBlade.type));
          const m = await this.pickMon(p, 'discardFrom', from, 'prompt.q.discardFromWhich', { c: atk.name, t: { $type: fx.hailBlade.type } }, `Discard a ${fx.hailBlade.type} Energy from which Pokémon?`, (x) => (x === a ? 0 : 2) + x.energy.length / 10);
          if (!m) break;
          const en = m.energy.findLast((y) => y.energyType === fx.hailBlade.type);
          p.discard.push(...m.energy.splice(m.energy.indexOf(en), 1));
        }
        bonus += fx.hailBlade.n * n;
      }
      if (fx.discardBenchEnergyBonus) {
        const all = p.bench.flatMap((m) => m.energy.map((en) => [m, en]));
        const n = await this.pickNumber(p, 'drawN', Math.min(fx.discardBenchEnergyBonus.max, all.length), 'prompt.q.discardHowManyBench', { c: atk.name }, `How many Energy from your Benched Pokémon do you discard (+${fx.discardBenchEnergyBonus.n} damage each)?`, (k) => k);
        for (const [m, en] of all.slice(0, n)) p.discard.push(...m.energy.splice(m.energy.indexOf(en), 1));
        bonus += fx.discardBenchEnergyBonus.n * n;
      }
      if (fx.flipUntilTailsBonus) {
        let heads = 0;
        while (heads < 20 && (await this.flip('untilTails', { atk: atk.name, so: heads }, [{ key: 'coin.o.plus', params: { n: fx.flipUntilTailsBonus } }, { key: 'coin.o.stop', params: {} }]))) heads++;
        bonus += fx.flipUntilTailsBonus * heads;
      }
      bonus += await this.megaPreDamage(p, a, atk, fx);
      return bonus;
    },

    // Everything after the damage.
    async modernAfter(p, o, a, d, atk, fx, dealt) {
      const names = (l) => l.map((x) => x.name).join(', ');
      if (fx.cureSelf && a.conditions().length) { a.status = {}; this.log('log.cured', { m: a.name }, 'heal'); }
      if (fx.tailsCooldown && !(await this.flip('attack', { atk: atk.name }, [{ key: 'coin.o.nothing', params: {} }, { key: 'coin.o.cooldown', params: {} }]))) {
        a.effects.cooldownAll = { expires: this.turn + 2 };
        this.log('log.cooldownAll', { m: a.name }, 'status');
      }
      if (fx.bonusIfKOLastTurn?.status && this.koLastTurn(p) && d && o.active === d && !this.effectsBlocked(d)) this.applyStatus(d, fx.bonusIfKOLastTurn.status);
      if (fx.noAttackIfBasic && d && this.allMons(o).includes(d) && d.card.stage === 0 && !this.effectsBlocked(d)) { d.effects.noAttackAll = { expires: this.turn + 1 }; this.log('log.noAttackAll', { m: d.name }, 'status'); }
      if (fx.shieldEffects) { a.effects.noEffects = { expires: this.turn + 1 }; this.log('log.noEffectsOn', { m: a.name }, 'status'); }
      if (fx.callAny && p.bench.length < MAX_BENCH) {
        for (let k = 0; k < fx.callAny.n && p.bench.length < MAX_BENCH; k++) {
          const ok = (y) => isBasic(y) && (!fx.callAny.prefix || y.name.startsWith(fx.callAny.prefix)) && (!fx.callAny.tag || y.tags?.includes(fx.callAny.tag)); // Summoning Sign: Steven's Pokémon only; Keep Calling: Rapid Strike
          const x = await this.pickCard(p, 'search', p.deck.filter(ok), 'prompt.q.callFamily', { c: atk.name }, 'Choose a Basic Pokémon to put onto your Bench.', { none: true, ai: (y) => y.hp + (y.prizes ? 50 : 0) });
          if (!x) break;
          await this.benchFromDeck(p, x);
          p.flags.calledNow = true; // Strike and Run: switch only if Pokémon were benched
        }
        shuffle(p.deck);
      }
      if (fx.healAny) {
        const hurt = this.allMons(p).filter((x) => x.damage);
        const t = await this.pickMon(p, 'heal', hurt, 'prompt.q.healWhich', { c: atk.name, n: fx.healAny }, `Heal ${fx.healAny} damage from which Pokémon?`, (x) => x.damage);
        if (t) await this.heal(t, fx.healAny);
      }
      if (fx.attachDiscardAny) await this.attachFromDiscard(p, this.allMons(p), fx.attachDiscardAny.n, (x) => basicEnergy(x) && (!fx.attachDiscardAny.type || x.energyType === fx.attachDiscardAny.type), atk.name, { upTo: /up to/i.test(atk.text || '') });
      if (fx.attachDiscardBench && p.bench.length) await this.attachFromDiscard(p, p.bench, 1, (x) => basicEnergy(x) && (!fx.attachDiscardBench.type || x.energyType === fx.attachDiscardBench.type), atk.name);
      if (fx.searchBasicEnergy) {
        let n = 0;
        for (let k = 0; k < fx.searchBasicEnergy.n; k++) {
          const ok = fx.searchBasicEnergy.type ? (x) => x.kind === 'energy' && x.energyType === fx.searchBasicEnergy.type : basicEnergy; // Water Reserve: "Water Energy cards"
          const en = await this.pickCard(p, 'search', p.deck.filter(ok), 'prompt.q.searchEnergy', { c: atk.name }, 'Choose a basic Energy from your deck.', { none: true, ai: () => 1 });
          if (!en) break;
          p.hand.push(p.deck.splice(p.deck.indexOf(en), 1)[0]); n++;
        }
        shuffle(p.deck);
        this.plog(p, 'log.energiesFound', { n });
      }
      if (fx.searchAttach && typeof fx.searchAttach === 'object') {
        let n = 0;
        for (let k = 0; k < fx.searchAttach.n; k++) {
          const en = await this.pickCard(p, 'search', p.deck.filter((x) => basicEnergy(x) && x.energyType === fx.searchAttach.type), 'prompt.q.searchEnergy', { c: atk.name }, 'Choose a basic Energy to attach.', { none: true, ai: () => 1 });
          if (!en) break;
          await this.hooks.onAttach?.({ p: p.idx, mon: a.id, card: en });
          a.energy.push(this.searchDeck(p, en)); n++;
        }
        this.plog(p, 'log.energiesFound', { n });
      }
      if (fx.searchAttachBench && p.bench.length) {
        for (let k = 0; k < fx.searchAttachBench.n; k++) {
          // Helping Hand: any basic Energy (the player chooses which).
          const en = fx.searchAttachBench.type ? p.deck.find((x) => basicEnergy(x) && x.energyType === fx.searchAttachBench.type)
            : await this.pickCard(p, 'search', p.deck.filter(basicEnergy), 'prompt.q.searchEnergy', { c: atk.name }, 'Choose a basic Energy to attach.', { ai: () => 1 });
          if (!en) break;
          const t = await this.pickMon(p, 'attachTo', p.bench, 'prompt.q.attachTo', { c: atk.name }, 'Attach the Energy to which Benched Pokémon?', (x) => -this.energyGap(x) * -1);
          await this.hooks.onAttach?.({ p: p.idx, mon: t.id, card: en });
          t.energy.push(this.searchDeck(p, en));
        }
      }
      if (fx.coordinatedPack) {
        for (const b of p.bench.filter((x) => x.name === 'Houndour')) {
          const en = p.deck.find((x) => basicEnergy(x) && x.energyType === 'Darkness');
          if (!en) break;
          await this.hooks.onAttach?.({ p: p.idx, mon: b.id, card: en });
          b.energy.push(this.searchDeck(p, en));
        }
        shuffle(p.deck);
      }
      if (fx.moveEnergyToBench && p.bench.length && this.allMons(p).includes(a)) {
        const pick = fx.moveEnergyToBench.all ? [...a.energy] : a.energy.filter((en) => !fx.moveEnergyToBench.type || en.energyType === fx.moveEnergyToBench.type).slice(0, fx.moveEnergyToBench.n);
        // Energy Slap: "you may move all Energy" — keep them when the attacker should stay powered up.
        const move = pick.length && (!fx.moveEnergyToBench.may || (await this.yesNo(p, 'prompt.q.moveAllEnergy', { c: atk.name, m: a.name }, `Move all Energy from ${a.name} to one of your Benched Pokémon?`, a.hpLeft <= 60 ? 1 : -1)));
        if (move) {
          const t = await this.pickMon(p, 'attachTo', p.bench, 'prompt.q.attachTo', { c: atk.name }, 'Move the Energy onto which Benched Pokémon?', (x) => -this.energyGap(x) * -1);
          for (const en of pick) a.energy.splice(a.energy.indexOf(en), 1);
          t.energy.push(...pick);
          this.plog(p, 'log.energyMovedN', { n: pick.length, m: t.name });
        }
      }
      if (fx.attachFromHand && p.hand.some((x) => x.kind === 'energy')) {
        const en = await this.pickCard(p, 'discard', p.hand.filter((x) => x.kind === 'energy'), 'prompt.q.energyFromHand', { c: atk.name }, 'Choose an Energy card from your hand to attach.', { unique: false, ai: () => 1 });
        const t = await this.pickMon(p, 'attachTo', this.allMons(p), 'prompt.q.attachTo', { c: atk.name }, 'Attach it to which Pokémon?', (x) => -this.energyGap(x) * -1);
        await this.hooks.onAttach?.({ p: p.idx, mon: t.id, card: en });
        t.energy.push(this.takeFromHand(p, en));
        await this.oldCemetery(t);
      }
      if (fx.drawToMatch) this.plog(p, 'log.t.drewN', { n: this.draw(p, Math.max(0, o.hand.length - p.hand.length)) });
      if (fx.trainerFromDiscard) {
        const x = await this.pickCard(p, 'search', p.discard.filter((y) => y.kind === 'trainer'), 'prompt.q.fromDiscard', { c: atk.name }, 'Choose a Trainer card from your discard pile.', { ai: (y) => (y.ttype === 'supporter' ? 2 : 1) });
        if (x) { p.hand.push(this.pullFromDiscard(p, x)); this.plog(p, 'log.t.got', { c: atk.name, got: C(x) }); }
      }
      if (fx.discardStadium && this.stadium) {
        const mine = this.stadium.owner === p.idx;
        let go = !fx.discardStadium.may;
        if (!go) {
          const id = await this.pick(p, 'yesno', 'prompt.gen.title', 'prompt.q.discardStadium', [
            { id: 'yes', label: { key: 'opt.yes' }, en: 'Discard the Stadium in play.', ai: mine ? 0 : 1 },
            { id: 'no', label: { key: 'opt.no' }, en: 'Keep it.', ai: mine ? 1 : 0 }], { params: { c: C(this.stadium.card) }, en: 'Discard the Stadium in play?' });
          go = id === 'yes';
        }
        if (go) { this.players[this.stadium.owner].discard.push(this.stadium.card); this.log('log.stadiumOff', { c: C(this.stadium.card) }); this.stadium = null; }
      }
      if (fx.placeCounters) {
        const pool = (fx.placeCounters.bench ? o.bench : this.allMons(o)).filter((x) => !this.effectsBlocked(x));
        const plan = new Map();
        for (let k = 0; k < fx.placeCounters.n && pool.length; k++) {
          const left = (x) => x.hpLeft - (plan.get(x) || 0);
          const live = pool.filter((x) => left(x) > 0);
          if (!live.length) break;
          const t = await this.pickMon(p, 'counter', live, 'prompt.q.counterK', { c: atk.name, k: k + 1, n: fx.placeCounters.n }, `Place damage counter ${k + 1} of ${fx.placeCounters.n} on which of the opponent's Pokémon?`,
            (x) => (left(x) <= 10 ? 100 : 0) + (x.card.prizes ? 20 : 0) - left(x) / 10);
          plan.set(t, (plan.get(t) || 0) + 10);
        }
        if (plan.size) {
          await this.spread(a, [...plan], { counters: true });
          this.log('log.countersMany', { list: [...plan].map(([x, n]) => `${x.name} ×${n / 10}`).join(', ') }, 'dmg');
        }
      }
      if (fx.snipeMulti) {
        const pool = [...this.allMons(o)], picked = [];
        for (let k = 0; k < fx.snipeMulti.count && pool.length; k++) {
          const t = await this.pickMon(p, 'snipe', pool, 'prompt.q.snipeAny', { c: atk.name, n: fx.snipeMulti.n }, `Choose an opponent's Pokémon to take ${fx.snipeMulti.n} damage.`, (x) => (x.hpLeft <= fx.snipeMulti.n ? 60 : 0) + (x.card.prizes ? 10 : 0) - x.hpLeft / 10);
          pool.splice(pool.indexOf(t), 1);
          picked.push(t);
        }
        await this.spread(a, picked.map((x) => [x, x === o.active ? this.finalDamage(a, x, fx.snipeMulti.n).dmg : fx.snipeMulti.n]));
        this.log('log.benchSnipe', { n: fx.snipeMulti.n, list: names(picked) }, 'dmg');
      }
      if (fx.moonglowReverse) {
        const mine = this.allMons(p).filter((x) => x.damage);
        const t = await this.pickMon(p, 'snipe', this.allMons(o).filter((x) => !this.effectsBlocked(x)), 'prompt.q.counters', { c: atk.name, n: 2 * mine.length }, "Move the damage counters onto which of the opponent's Pokémon?", (x) => -x.hpLeft);
        let n = 0;
        for (const x of mine) { const k = Math.min(20, x.damage); x.damage -= k; n += k; }
        if (t && n) { await this.spread(a, [[t, n]], { counters: true }); this.log('log.counters', { n: n / 10, list: t.name }, 'dmg'); }
      }
      if (fx.tmEvolution) {
        // Up to 2 Benched Pokémon evolve straight from the deck.
        const done = new Set();
        for (let k = 0; k < 2; k++) {
          // Recomputed each time: the first evolution may have used the only matching card in the deck.
          const pool = p.bench.filter((x) => !done.has(x) && p.deck.some((y) => y.kind === 'pokemon' && y.evolvesFrom === x.name));
          if (!pool.length) break;
          const b = await this.pickMonOrNone(p, 'evolveWhich', pool, 'prompt.q.evolveWhich', { c: atk.name }, 'Which Benched Pokémon evolves from your deck?', (x) => x.card.stage + 2);
          if (!b) break;
          done.add(b);
          const options = p.deck.filter((x) => x.kind === 'pokemon' && x.evolvesFrom === b.name);
          const evo = options.length > 1 ? await this.pickCard(p, 'search', options, 'prompt.q.searchPokemon', { c: atk.name }, 'Choose the Evolution card.', { ai: (y) => y.hp }) : options[0];
          await this.evolveMon(p, b, evo, { fromDeck: true });
        }
        shuffle(p.deck);
      }
      if (fx.tmDevolution) {
        for (const x of this.allMons(o)) {
          if (x.stack.length < 2 || this.effectsBlocked(x)) continue;
          const top = x.stack.pop();
          o.hand.push(top);
          x.status = {};
          this.log('log.devolved', { m: top.name, to: x.name }, 'status');
        }
      }
      if (fx.switchSelfMay || fx.switchSelfMust) {
        if (p.bench.length && p.active === a) {
          let go = !!fx.switchSelfMust;
          if (!go) {
            const id = await this.pick(p, 'yesno', 'prompt.gen.title', 'prompt.q.switchMay', [
              { id: 'yes', label: { key: 'opt.yes' }, en: 'Switch with a Benched Pokémon.', ai: a.hpLeft < 60 ? 2 : 0 },
              { id: 'no', label: { key: 'opt.no' }, en: 'Stay Active.', ai: 1 }], { params: { c: atk.name }, en: 'Switch this Pokémon with one of your Benched Pokémon?' });
            go = id === 'yes';
          }
          if (go) {
            const t = await this.pickMon(p, 'promote', p.bench, 'prompt.q.switchSelf', { c: atk.name }, 'Choose which Benched Pokémon switches in.', (x) => x.hpLeft / 10 + x.energy.length * 5);
            this.swapActive(p, t);
            this.plog(p, 'log.t.switched', { m: p.active.name });
            await this.becameActive(p);
          }
        }
      }
      if (fx.selfToHand && this.allMons(p).includes(a) && p.bench.length) {
        const id = await this.pick(p, 'yesno', 'prompt.gen.title', 'prompt.q.selfToHand', [
          { id: 'yes', label: { key: 'opt.yes' }, en: 'Put this Pokémon into your hand.', ai: a.damage > 60 ? 2 : 0 },
          { id: 'no', label: { key: 'opt.no' }, en: 'Leave it in play.', ai: 1 }], { params: { c: atk.name, m: a.name }, en: 'Put this Pokémon back into your hand (its attached cards are discarded)?' });
        if (id === 'yes') {
          const stack = [...a.stack], rest = [...a.energy, ...a.tools.map((x) => x.card)];
          this.removeFromPlay(p, a);
          p.hand.push(...stack);
          p.discard.push(...rest);
          this.plog(p, 'log.toHand', { m: a.name });
        }
      }
      await this.megaAfter(p, o, a, d, atk, fx, dealt);
    },

    // When a Pokémon is Knocked Out by an attack: Electrical Grounding.
    async modernOnKO(q, m) {
      this.megaOnKO(q, m);
      await this.smOnKO(q, m); // Wishful Baton, Energy Grounding
      if (!m.energy.some((en) => en.energyType === 'Lightning')) return;
      const r = q.bench.find((x) => x !== m && x.card.powerKind === 'electricalGrounding' && this.powerOn(x));
      if (!r) return;
      const i = m.energy.findIndex((en) => en.energyType === 'Lightning');
      r.energy.push(...m.energy.splice(i, 1));
      this.log('log.grounding', { m: r.name, from: m.name }, 'status');
    },
  });
}
