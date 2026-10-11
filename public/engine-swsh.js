// Cards of the Sword & Shield decks (2019–2022 theme decks), installed on the Game class by engine.js
// on top of the modern rules: they are played with today's rules (Pokémon V give up 2 Prize cards, VMAX 3).
// The hooks here are reached from engine-mega.js (Trainers, Abilities, attack effects) and engine.js (damage).

export function installSwsh(Game, { Mon, shuffle, C, isBasic, MAX_BENCH }) {
  const basicEnergy = (x) => x.kind === 'energy' && !x.special;
  const ofType = (type) => (x) => basicEnergy(x) && x.energyType === type;
  const evolution = (x) => x.kind === 'pokemon' && x.stage > 0;
  const RPS = ['rock', 'paper', 'scissors'];
  const beats = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

  Object.assign(Game.prototype, {
    // Leon: +30 to the opponent's Active Pokémon this turn (before Weakness and Resistance).
    swshAttackBonus(a, q) { return (q?.flags.leon ? 30 : 0) + this.swshVAttackBonus(a, q); },

    // ---------------- Trainer cards ----------------
    swshTrainerActions(p, o, c, once, T) {
      const mons = this.allMons(p), deckHas = (f) => p.deck.some(f);
      switch (c.tkind) {
        case 'bede': if (p.bench.length && p.hand.some(basicEnergy) && once('bede')) T('bede', {}, 'attach a basic Energy from your hand to one of your Benched Pokémon.'); break;
        case 'birdKeeper': if (p.bench.length && once('bird')) T('birdKeeper', {}, 'switch your Active Pokémon with a Benched one, then draw 3 cards.'); break;
        case 'capaciousBucket': if (deckHas((x) => x.kind === 'energy' && x.energyType === 'Water') && once('bucket')) T('capaciousBucket', {}, 'take up to 2 Water Energy cards from your deck.'); break;
        case 'dan': if (p.deck.length && once('dan')) T('dan', {}, 'draw 2 cards, then play Rock-Paper-Scissors with the opponent: if you win, draw 2 more.'); break;
        case 'evolutionIncense': if (deckHas(evolution) && once('incense')) T('evolutionIncense', {}, 'take an Evolution Pokémon from your deck.'); break;
        case 'hop': if (p.deck.length && once('hop')) T('hop', {}, 'draw 3 cards.'); break;
        case 'leon': if (!p.flags.leon && once('leon')) T('leon', {}, "your Pokémon's attacks do 30 more damage to the opponent's Active Pokémon this turn."); break;
        case 'metalSaucer':
          if (p.bench.some((x) => x.card.type === 'Metal') && p.discard.some(ofType('Metal')) && once('saucer')) T('metalSaucer', {}, 'attach a basic Metal Energy from your discard pile to one of your Benched Metal Pokémon.');
          break;
        case 'nessa': if (p.discard.some((x) => (x.kind === 'pokemon' && x.type === 'Water') || (x.kind === 'energy' && x.energyType === 'Water')) && once('nessa')) T('nessa', {}, 'put up to 4 Water Pokémon and/or Water Energy cards from your discard pile into your hand.'); break;
        case 'ordinaryRod': if (p.discard.some((x) => x.kind === 'pokemon' || basicEnergy(x)) && once('rod')) T('ordinaryRod', {}, 'shuffle up to 2 Pokémon and/or up to 2 basic Energy from your discard pile into your deck.'); break;
        case 'pokeKid': if (deckHas((x) => x.kind === 'pokemon') && once('kid')) T('pokeKid', {}, 'take a Pokémon from your deck.'); break;
        case 'pokemonCatcher': if (o.bench.length && once('catcher')) T('pokemonCatcher', {}, "flip a coin: if heads, switch one of the opponent's Benched Pokémon into the Active Spot."); break;
        case 'pokemonCenterLady': if (mons.some((x) => x.damage || x.conditions().length) && once('pcl')) T('pokemonCenterLady', {}, 'heal 60 damage from one of your Pokémon and cure its Special Conditions.'); break;
        case 'sonia': if (deckHas((x) => isBasic(x) || basicEnergy(x)) && once('sonia')) T('sonia', {}, 'take up to 2 Basic Pokémon, or up to 2 basic Energy, from your deck.'); break;
        case 'turboPatch':
          if (p.discard.some(basicEnergy) && mons.some((x) => x.card.stage === 0 && !x.card.tags?.includes('GX')) && once('turbo')) T('turboPatch', {}, 'flip a coin: if heads, attach a basic Energy from your discard pile to one of your Basic Pokémon.');
          break;
        default: this.swshVTrainerActions(p, o, c, once, T);
      }
    },

    async playSwshTrainer(p, o, c, act, L) {
      const pokeAi = (x) => (x.stage > 0 && this.allMons(p).some((y) => y.name === x.evolvesFrom) ? 10 : 0) + (x.prizes ? 6 : 0) + (x.stage === 0 && p.bench.length < MAX_BENCH ? 3 : 0);
      const take = async (ok, text, en, { none = false, ai = pokeAi } = {}) => {
        const x = await this.pickCard(p, 'search', p.deck.filter(ok), text, { c: C(c) }, en, { none, ai });
        if (x) p.hand.push(p.deck.splice(p.deck.indexOf(x), 1)[0]);
        return x;
      };
      const coin = (heads) => this.flip('trainer', { c: C(c) }, [{ key: 'coin.o.' + heads, params: {} }, { key: 'coin.o.nothing', params: {} }]);
      const shuffleBack = async (ok, max) => {
        let n = 0;
        for (let k = 0; k < max; k++) {
          const x = await this.pickCard(p, 'search', p.discard.filter(ok), 'prompt.q.fromDiscard', { c: C(c) }, 'Choose a card from your discard pile to shuffle into your deck.', { none: k > 0, unique: false, ai: (y) => (y.kind === 'pokemon' ? y.stage + 1 : 1) });
          if (!x) break;
          p.deck.push(this.pullFromDiscard(p, x)); n++;
        }
        return n;
      };
      switch (c.tkind) {
        case 'bede': {
          const en = await this.pickCard(p, 'discard', p.hand.filter(basicEnergy), 'prompt.q.energyFromHand', { c: C(c) }, 'Choose a basic Energy from your hand.', { unique: false, ai: () => 1 });
          const t = await this.pickMon(p, 'attachTo', p.bench, 'prompt.q.attachTo', { c: C(c) }, `Attach ${en.name} to which Benched Pokémon?`, (x) => (x.card.attacks.some((a) => a.cost.includes(en.energyType)) ? 2 : 0) + x.card.stage);
          await this.attachHandCard(p, en, t); // Old Cemetery, Natural Cure
          break;
        }
        case 'birdKeeper': {
          const t = await this.pickMon(p, 'promote', p.bench, 'prompt.q.switchSelf', { c: C(c) }, 'Choose which Benched Pokémon becomes Active.', (x) => x.hpLeft / 10 + x.energy.length * 5);
          this.swapActive(p, t);
          L('switch', { m: p.active.name });
          await this.becameActive(p);
          this.plog(p, 'log.t.drewN', { n: this.draw(p, 3) });
          break;
        }
        case 'capaciousBucket': {
          let n = 0;
          for (let k = 0; k < 2; k++) if (await take((y) => y.kind === 'energy' && y.energyType === 'Water', 'prompt.q.searchEnergyAny', 'Choose a Water Energy card.', { none: true, ai: () => 1 })) n++;
          shuffle(p.deck);
          L('gotN', { n });
          break;
        }
        case 'dan': {
          let n = this.draw(p, 2);
          let mine, theirs;
          for (let round = 0; round < 10; round++) {
            const throwOf = (q, who) => this.pick(q, 'rps', 'prompt.gen.title', 'prompt.q.rps', RPS.map((x) => ({ id: x, label: { key: 'opt.' + x }, en: x, ai: Math.random() })),
              { params: { c: C(c), by: p.idx }, en: `Rock-Paper-Scissors (${who}): choose rock, paper or scissors.` }); // by: who played Dan
            mine = await throwOf(p, 'your throw');
            theirs = await throwOf(o, "the opponent's throw");
            if (!RPS.includes(mine)) mine = 'rock';
            if (!RPS.includes(theirs)) theirs = 'rock';
            this.log('log.rps', { P: { $pl: p.idx }, a: { $t: { key: 'opt.' + mine } }, b: { $t: { key: 'opt.' + theirs } } });
            // The UI shows both throws together (the showdown); a tie means another round.
            await this.hooks.onRps?.({ p: p.idx, a: mine, b: theirs, round, last: mine !== theirs || round === 9, result: mine === theirs ? 'tie' : beats[mine] === theirs ? 'win' : 'lose', c: C(c) });
            if (mine !== theirs) break;
          }
          if (beats[mine] === theirs) n += this.draw(p, 2);
          L('dan', { n, won: beats[mine] === theirs ? 1 : 0 });
          break;
        }
        case 'evolutionIncense': { const x = await take(evolution, 'prompt.q.searchPokemon', 'Choose an Evolution Pokémon.'); shuffle(p.deck); if (x) L('got', { got: C(x) }); break; }
        case 'hop': L('drew', { n: this.draw(p, 3) }); break;
        case 'leon': p.flags.leon = true; this.plog(p, 'log.leon', { c: C(c) }); break;
        case 'metalSaucer': await this.attachFromDiscard(p, p.bench.filter((x) => x.card.type === 'Metal'), 1, ofType('Metal'), c.name); break;
        case 'nessa': {
          let n = 0;
          const ok = (x) => (x.kind === 'pokemon' && x.type === 'Water') || (x.kind === 'energy' && x.energyType === 'Water');
          for (let k = 0; k < 4; k++) {
            const x = await this.pickCard(p, 'search', p.discard.filter(ok), 'prompt.q.fromDiscard', { c: C(c) }, 'Choose a Water Pokémon or Water Energy card from your discard pile.', { none: k > 0, unique: false, ai: (y) => (y.kind === 'pokemon' ? 2 : 1) });
            if (!x) break;
            p.hand.push(this.pullFromDiscard(p, x)); n++;
          }
          L('gotN', { n });
          break;
        }
        case 'ordinaryRod': {
          const hasMon = p.discard.some((x) => x.kind === 'pokemon'), hasEn = p.discard.some(basicEnergy);
          const opts = [];
          if (hasMon) opts.push({ id: 'pokemon', label: { key: 'opt.rodPokemon' }, en: 'Shuffle up to 2 Pokémon back.', ai: 1 });
          if (hasEn) opts.push({ id: 'energy', label: { key: 'opt.rodEnergy' }, en: 'Shuffle up to 2 basic Energy back.', ai: 1 });
          if (hasMon && hasEn) opts.push({ id: 'both', label: { key: 'opt.rodBoth' }, en: 'Both.', ai: 2 });
          const id = opts.length > 1 ? await this.pick(p, 'rod', 'prompt.gen.title', 'prompt.q.rod', opts, { params: { c: C(c) }, en: 'Ordinary Rod: choose 1 or both.' }) : opts[0].id;
          let n = 0;
          if (id === 'pokemon' || id === 'both') n += await shuffleBack((x) => x.kind === 'pokemon', 2);
          if (id === 'energy' || id === 'both') n += await shuffleBack(basicEnergy, 2);
          shuffle(p.deck);
          L('shuffledBack', { n });
          break;
        }
        case 'pokeKid': { const x = await take((y) => y.kind === 'pokemon', 'prompt.q.searchPokemon', 'Choose a Pokémon.'); shuffle(p.deck); if (x) L('got', { got: C(x) }); break; }
        case 'pokemonCatcher': {
          if (!(await coin('gust'))) { L('nothing'); break; }
          const t = await this.pickMon(p, 'lure', o.bench, 'prompt.lure.text', {}, "Choose one of the opponent's Benched Pokémon to switch into the Active Spot.", (x) => -x.hpLeft / 10 + (x.card.prizes ? 40 : 0));
          this.swapActive(o, t);
          this.log('log.lure', { m: t.name });
          break;
        }
        case 'pokemonCenterLady': {
          const t = await this.pickMon(p, 'heal', this.allMons(p).filter((x) => x.damage || x.conditions().length), 'prompt.q.healWhich', { c: C(c), n: 60 }, 'Heal 60 damage from which Pokémon?', (x) => x.damage + x.conditions().length * 20);
          const h = await this.heal(t, 60);
          if (t.conditions().length) { t.status = {}; this.log('log.cured', { m: t.name }, 'heal'); }
          L('heal', { m: t.name, n: h });
          break;
        }
        case 'sonia': {
          const hasMon = p.deck.some(isBasic), hasEn = p.deck.some(basicEnergy);
          const id = hasMon && hasEn
            ? await this.pick(p, 'sonia', 'prompt.gen.title', 'prompt.q.sonia', [
              { id: 'pokemon', label: { key: 'opt.soniaPokemon' }, en: 'Up to 2 Basic Pokémon.', ai: p.bench.length < 3 ? 2 : 1 },
              { id: 'energy', label: { key: 'opt.soniaEnergy' }, en: 'Up to 2 basic Energy.', ai: p.hand.some(basicEnergy) ? 0 : 1.5 }], { params: { c: C(c) }, en: 'Sonia: Basic Pokémon or basic Energy?' })
            : hasMon ? 'pokemon' : 'energy';
          let n = 0;
          for (let k = 0; k < 2; k++) if (await take(id === 'pokemon' ? isBasic : basicEnergy, id === 'pokemon' ? 'prompt.q.searchPokemon' : 'prompt.q.searchEnergy', 'Choose a card.', { none: true, ai: id === 'pokemon' ? pokeAi : () => 1 })) n++;
          shuffle(p.deck);
          L('gotN', { n });
          break;
        }
        case 'turboPatch': {
          if (!(await coin('attachEnergy'))) { L('nothing'); break; }
          await this.attachFromDiscard(p, this.allMons(p).filter((x) => x.card.stage === 0 && !x.card.tags?.includes('GX')), 1, basicEnergy, c.name);
          break;
        }
        default: return this.playSwshVTrainer(p, o, c, act, L);
      }
    },

    // ---------------- Abilities ----------------
    swshAbilityAction(p, o, mon, kind, power, A, usable) {
      switch (kind) {
        case 'battleSense': if (usable(mon) && p.deck.length) A('look at the top 3 cards of your deck, put 1 into your hand and discard the others. Once per turn.'); break;
        default: this.swshVAbilityAction(p, o, mon, kind, power, A, usable);
      }
    },
    async swshUseAbility(p, o, m, act, power) {
      switch (act.pkind) {
        case 'battleSense': {
          const top = p.deck.splice(-3).reverse();
          const x = await this.pickCard(p, 'search', top, 'prompt.q.keepK', { c: power.name, k: 1, n: 1 }, 'Choose the card to keep; the others are discarded.', { unique: false, ai: (y) => (y.tkind === 'rareCandy' ? 5 : y.ttype === 'supporter' ? 4 : y.kind === 'pokemon' && y.stage > 0 ? 3 : y.kind === 'energy' ? 2 : 1) }) || top[0];
          top.splice(top.indexOf(x), 1);
          p.hand.push(x);
          p.discard.push(...top);
          this.plog(p, 'log.battleSense', { c: power.name, n: top.length });
          break;
        }
        default: return this.swshVUseAbility(p, o, m, act, power);
      }
    },

    // ---------------- Attack effects ----------------
    // Choices made before the damage (they add to it).
    async swshPreDamage(p, a, atk, fx) {
      const o = this.opp(p), d = o.active;
      let bonus = 0;
      // Pluck: discard the Defending Pokémon's Tools before doing damage.
      if (fx.discardDefTools && d?.tools.length && !this.effectsBlocked(d)) {
        const n = d.tools.length;
        o.discard.push(...d.tools.splice(0).map((t) => t.card));
        this.log('log.toolsDiscarded', { m: d.name, n }, 'status');
      }
      if (fx.optionalDiscardReduce && a.energy.length >= fx.optionalDiscardReduce.n &&
        (await this.yesNo(p, 'prompt.q.discardForShield', { c: atk.name, n: fx.optionalDiscardReduce.n, r: fx.optionalDiscardReduce.reduce }, `Discard ${fx.optionalDiscardReduce.n} Energy so this Pokémon takes ${fx.optionalDiscardReduce.reduce} less damage next turn?`, a.hpLeft <= 150 ? 1 : -1))) {
        p.discard.push(...a.energy.splice(-fx.optionalDiscardReduce.n));
        a.effects.reduce = { n: fx.optionalDiscardReduce.reduce, expires: this.turn + 1 };
        this.log('log.reduce', { m: a.name, n: fx.optionalDiscardReduce.reduce }, 'status');
      }
      // Continuous Gulp Missile: discard any number of a named Pokémon from your Bench, damage for each.
      if (fx.discardBenchNamedTimes) {
        const pool = p.bench.filter((x) => x.name === fx.discardBenchNamedTimes.name);
        const n = await this.pickNumber(p, 'drawN', pool.length, 'prompt.q.discardBenchNamed', { c: atk.name, m: fx.discardBenchNamedTimes.name, n: fx.discardBenchNamedTimes.n }, `How many ${fx.discardBenchNamedTimes.name} do you discard from your Bench (${fx.discardBenchNamedTimes.n} damage each)?`, (k) => k);
        for (const m of pool.slice(0, n)) p.discard.push(...this.removeFromPlay(p, m));
        if (n) this.plog(p, 'log.benchDiscarded', { n, m: fx.discardBenchNamedTimes.name });
        bonus += fx.discardBenchNamedTimes.n * n;
      }
      // Frozen Heat: you may discard all Energy of a type from this Pokémon for more damage.
      if (fx.optionalDiscardTypeAll && a.energy.some((en) => en.energyType === fx.optionalDiscardTypeAll.type)) {
        const t = fx.optionalDiscardTypeAll.type;
        if (await this.yesNo(p, 'prompt.q.discardTypeForBonus', { c: atk.name, t: { $type: t }, b: fx.optionalDiscardTypeAll.bonus }, `Discard all ${t} Energy from this Pokémon for +${fx.optionalDiscardTypeAll.bonus} damage?`, 1)) {
          const out = a.energy.filter((en) => en.energyType === t);
          a.energy = a.energy.filter((en) => !out.includes(en));
          p.discard.push(...out);
          bonus += fx.optionalDiscardTypeAll.bonus;
        }
      }
      if (fx.flipMultiBonus) {
        let heads = 0;
        for (let k = 0; k < fx.flipMultiBonus.n; k++)
          if (await this.flip('multi', { atk: atk.name, i: k + 1, n: fx.flipMultiBonus.n, so: heads }, [{ key: 'coin.o.plus', params: { n: fx.flipMultiBonus.bonus } }, { key: 'coin.o.nothing', params: {} }])) heads++;
        bonus += fx.flipMultiBonus.bonus * heads;
      }
      return bonus + (await this.swshVPreDamage(p, a, atk, fx));
    },

    async swshAfter(p, o, a, d, atk, fx) {
      const dActive = d && o.active === d && !this.effectsBlocked(d);
      if (fx.oncePerActive) a.effects.usedActive = { atk: atk.name, expires: 1e9 }; // cleared when it leaves the Active Spot
      if (fx.boostNext) { a.effects.boost = { atk: fx.boostNext.atk, n: fx.boostNext.n, expires: this.turn + 2 }; this.log('log.boostNext', { m: a.name, atk: fx.boostNext.atk, n: fx.boostNext.n }, 'status'); }
      if (fx.weaken && dActive) { d.effects.weaken = { n: fx.weaken, expires: this.turn + 1 }; this.log('log.weaken', { m: d.name, n: fx.weaken }, 'status'); }
      if (fx.statusIfPlayed && dActive && p.flags.played?.includes(fx.statusIfPlayed.name)) this.applyStatus(d, fx.statusIfPlayed.status);
      // Aqua Wash / Hydro Snipe: you may return Energy from the Defending Pokémon to its owner's hand.
      if (fx.bounceDefEnergy && dActive && d.energy.length &&
        (!fx.bounceDefEnergy.may || (await this.yesNo(p, 'prompt.q.bounceEnergy', { c: atk.name, m: d.name, n: fx.bounceDefEnergy.n }, `Put up to ${fx.bounceDefEnergy.n} Energy attached to ${d.name} into the opponent's hand?`, 1)))) {
        let n = 0;
        for (let k = 0; k < fx.bounceDefEnergy.n && d.energy.length; k++) {
          const en = await this.pickCard(p, 'discard', d.energy, 'prompt.q.bounceWhich', { c: atk.name, m: d.name }, 'Choose an Energy to return to the opponent’s hand.', { none: k > 0, unique: false, ai: (x) => (x.special ? 2 : 1) });
          if (!en) break;
          o.hand.push(...d.energy.splice(d.energy.indexOf(en), 1)); n++;
        }
        if (n) this.log('log.energyBounced', { m: d.name, n }, 'status');
      }
      // Targeted Skewer: damage to a Benched Pokémon for each damage counter on it.
      if (fx.snipeByCounters && o.bench.length) {
        const t = await this.pickMon(p, 'snipe', o.bench.filter((x) => !this.effectsBlocked(x)), 'prompt.q.snipeByCounters', { c: atk.name, n: fx.snipeByCounters }, `Which Benched Pokémon takes ${fx.snipeByCounters} damage for each damage counter on it?`, (x) => (x.counters * fx.snipeByCounters >= x.hpLeft ? 100 : 0) + x.counters);
        const n = t ? fx.snipeByCounters * t.counters : 0;
        if (n) { await this.spread(a, [[t, n]]); this.log('log.benchSnipe', { n, list: t.name }, 'dmg'); }
      }
      if (fx.millSelf && p.deck.length) { const out = p.deck.splice(-fx.millSelf); p.discard.push(...out); this.plog(p, 'log.milled', { n: out.length }); }
      if (fx.millOpp && o.deck.length) for (const x of o.deck.splice(-fx.millOpp)) { o.discard.push(x); this.plog(o, 'log.milledCard', { c: C(x) }); }
      if (fx.discardRandomOppHand && o.hand.length) {
        const x = o.hand.splice(Math.floor(Math.random() * o.hand.length), 1)[0];
        o.discard.push(x);
        this.plog(o, 'log.randomDiscard', { c: C(x) });
      }
      if (fx.tailsDiscard && a.energy.length && !(await this.flip('attack', { atk: atk.name }, [{ key: 'coin.o.nothing', params: {} }, { key: 'coin.o.discardN', params: { n: fx.tailsDiscard } }]))) {
        const out = a.energy.splice(-fx.tailsDiscard);
        p.discard.push(...out);
        this.log('log.discardedN', { m: a.name, n: out.length }, 'status');
      }
      if (fx.returnTypeToHand) {
        const out = a.energy.filter((en) => en.energyType === fx.returnTypeToHand.type).slice(0, fx.returnTypeToHand.n);
        a.energy = a.energy.filter((en) => !out.includes(en));
        p.hand.push(...out);
        if (out.length) this.plog(p, 'log.energyToHand', { m: a.name, n: out.length });
      }
      // Cotton Ride: on heads the opponent shuffles their Active Pokémon and everything on it into their deck.
      if (fx.flipShuffleDef && dActive && (await this.flip('attack', { atk: atk.name }, [{ key: 'coin.o.shuffleIn', params: { m: d.name } }, { key: 'coin.o.nothing', params: {} }]))) {
        o.deck.push(...this.removeFromPlay(o, d));
        shuffle(o.deck);
        this.log('log.shuffledIntoDeck', { m: d.name }, 'status');
        await this.refillActive();
      }
      await this.swshVAfter(p, o, a, d, atk, fx);
    },
  });
}
