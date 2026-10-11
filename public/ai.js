// Every decision the AI opponent (Gary) makes goes through here. The browser calls the local /api/decide proxy
// (the Node server, or the Rust side in the macOS app), which forwards to the decision model. Prompts are in English.
import { canPay, STAGES } from './engine.js';
import { PRIZES } from './cards.js';
import { api } from './api.js';

// engine: 'cpu' (rule-based, in the browser) or 'model' (a decision model behind /api/decide: local Kev/Laya or hosted Jev).
export const aiConfig = { endpoint: '/api/decide', model: 'kev-latest', engine: 'cpu' }; // 'model' once the chosen engine is ready (ui.js)

export async function askDecider(state, questions) {
  const payload = { model: aiConfig.model, state, questions };
  const res = aiConfig.endpoint.startsWith('/api/') // the game's own backend; a full URL (tests) is called directly
    ? await api(aiConfig.endpoint, { method: 'POST', body: payload })
    : await fetch(aiConfig.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || body.detail?.message || body.detail?.[0]?.msg || `Decision model request failed (${res.status})`);
    err.status = res.status; // 402: the hosted model's account has no credits left
    err.kind = body.detail?.error_type || '';
    throw err;
  }
  return body;
}

const ACTION_INSTRUCTIONS = `You are an expert Pokémon Trading Card Game player. "you" in the state is the player who must act now.
Choose the single best NEXT action from the options.
Good play: attacking ENDS your turn, so first do useful setup — bench Basic Pokémon, evolve, attach your one Energy for the turn, play helpful Trainers — and attack last.
Strongly prefer an attack that Knocks Out the opponent's Active Pokémon. Gust of Wind can drag out a weak or damaged Benched Pokémon to Knock Out. Energy Removal is strong against Pokémon that are close to attacking.
Attach Energy where it soon powers up an attack, usually your Active Pokémon or a Pokémon you are evolving. Exploit Weakness (×2 damage).
Don't end the turn while a useful action remains. Don't retreat or Switch without a good reason. Don't waste healing on undamaged Pokémon.
Play Professor Oak only when the rest of your hand is weak, since it discards your hand.`;

// Modern (Scarlet & Violet / Mega Evolution) games add these rules to the instructions above.
const MODERN_INSTRUCTIONS = `This game uses MODERN rules: only 1 Supporter card per turn (the player going first can't play one on turn 1), any number of Items, 1 Stadium per turn, Pokémon Tools stay attached (1 per Pokémon).
Use Abilities (listed as Pokémon Power actions) and Items before your Supporter when they help, and evolve before attacking (Rare Candy skips Stage 1).
Prize cards: Pokémon ex, V, VSTAR and GX give up 2 when Knocked Out, Mega Evolution Pokémon ex, VMAX and TAG TEAM give up 3 — protect yours and target the opponent's when you can Knock them Out (Boss's Orders pulls one into the Active Spot).
Each player can use only 1 GX attack and 1 VSTAR Power per game: save them for the moment they matter most.
Draw cards when your hand is small, but don't run your deck out: drawing from an empty deck loses the game.`;

const WIN_LEVELS = ['very unlikely to win', 'unlikely to win', 'even game', 'likely to win', 'very likely to win'];

// `game` (when given) supplies what the printed card alone doesn't: copied/Technical Machine attacks, reduced costs, Retreat Cost.
function monInfo(m, game = null) {
  if (!m) return null;
  const owner = game?.ownerOf(m);
  const attacks = game ? game.attacksOf(m) : m.card.attacks;
  return {
    name: m.name, stage: STAGES[m.card.stage], type: m.card.type,
    hp_left: m.hpLeft, max_hp: m.maxHp,
    prize_cards_if_knocked_out: m.card.prizes || 1,
    tags: m.card.tags?.length ? m.card.tags.join(', ') : undefined,
    energy_attached: m.energyTypes,
    attached_trainers: m.tools.map((t) => t.card.name),
    weakness: m.card.weakness || 'none', resistance: m.card.resistance || 'none',
    retreat_cost: owner ? game.retreatCost(owner, m) : m.card.retreat,
    special_conditions: m.conditions(),
    active_effects: Object.keys(m.effects).filter((k) => k !== 'lastHit'),
    [m.card.power?.ability ? 'ability' : 'pokemon_power']: m.card.power ? `${m.card.power.name}: ${m.card.power.text}` : undefined,
    attacks: attacks.map((a) => ({
      name: a.name, cost: a.cost.join('+'), damage: a.damage || '0', text: a.text, has_enough_energy: canPay(m.payTypes, a.cost),
    })),
  };
}

const TTYPE = { item: 'Item', supporter: 'Supporter', stadium: 'Stadium', tool: 'Pokémon Tool' };
const cardLabel = (c) => (c.kind === 'trainer' ? `${c.name} (${TTYPE[c.ttype] || 'Trainer'}: ${c.text})` : c.name);

function sideInfo(p, showHand, game) {
  return {
    prizes_left: p.prizes.length,
    deck_count: p.deck.length,
    discard_energy_count: p.discard.filter((c) => c.kind === 'energy').length,
    hand: showHand ? p.hand.map(cardLabel) : `${p.hand.length} hidden cards`,
    active: monInfo(p.active, game),
    bench: p.bench.map((m) => monInfo(m, game)),
  };
}

export function buildState(game, p) {
  const s = game.stadium?.card;
  return {
    game: game.modern
      ? `Pokémon TCG with modern (Scarlet & Violet / Mega Evolution) rules: 60-card decks, ${PRIZES} Prize cards each, 1 Supporter, 1 Stadium and 1 Energy attachment per turn, any number of Items. Win by taking all your Prizes, or if the opponent has no Pokémon in play or can't draw.`
      : `Pokémon TCG with 1999–2000 cards and rules: 60-card decks, ${PRIZES} Prize cards each, any number of Trainers per turn, 1 Energy attachment per turn. Win by taking all your Prizes, or if the opponent has no Pokémon in play or can't draw.`,
    turn_number: game.turn,
    this_turn: {
      energy_already_attached: p.flags.energy, already_retreated: p.flags.retreat, attacking_allowed: game.turn !== 1,
      ...(game.modern ? { supporter_already_played: !!p.flags.supporter, stadium_already_played: !!p.flags.stadiumPlayed } : {}),
    },
    stadium_in_play: s ? `${s.name}: ${s.text}` : 'none',
    you: sideInfo(p, true, game),
    opponent: sideInfo(game.opp(p), false, game),
  };
}

// With few cards left, every card drawn brings the deck-out loss closer: say so at the moment of choosing.
const deckWarning = (p) => (p && p.deck.length <= 10
  ? `\nWARNING: only ${p.deck.length} card(s) left in your deck. If you must draw with an empty deck you LOSE. Avoid moves that draw or search cards you don't need right now; attacking or ending the turn is safer.`
  : '');
const actionQuestion = (actions, game, p) => ({
  type: 'choice',
  instructions: (game?.modern ? `${ACTION_INSTRUCTIONS}\n${MODERN_INSTRUCTIONS}` : ACTION_INSTRUCTIONS) + deckWarning(p),
  criteria: Object.fromEntries(actions.map((a) => [a.key, a.detail])),
});

const winQuestion = {
  type: 'score',
  instructions: 'How likely is "you" to win this game from the current position? Consider Prize cards left, board strength, Energy and hand.',
  criteria: WIN_LEVELS,
};

// Ask the decision model to rank `actions` for player p. Optionally also rate the position.
export async function rankActions(game, p, actions, { withWinChance = false } = {}) {
  if (aiConfig.engine === 'cpu') return { action: cpuRank(game, p, actions), win: withWinChance ? cpuWin(game, p) : undefined, model: 'cpu' };
  const questions = { action: actionQuestion(actions, game, p) };
  if (withWinChance) questions.win = winQuestion;
  const res = await askDecider(buildState(game, p), questions);
  return { action: res.answers.action, win: res.answers.win, model: res.model };
}

const PROMPT_EN = {
  'setup-active': 'Choose your starting Active Pokémon.',
  promote: 'Your Active Pokémon was Knocked Out. Choose a Benched Pokémon to become your new Active Pokémon.',
  ser: 'Super Energy Removal: choose which of YOUR Pokémon discards 1 Energy (pick the one that needs it least).',
  discard: 'Choose a card from your hand to DISCARD (pick the least useful one).',
  search: 'Computer Search: choose the most useful card to take from your deck into your hand.',
  whirlwind: 'Your Pokémon was hit by Whirlwind: choose which of YOUR Benched Pokémon becomes your new Active Pokémon (pick one that can survive or attack).',
  lure: "Lure: choose which of the opponent's Benched Pokémon to pull into their Active Spot (usually one you can Knock Out or that can't retreat easily).",
};

// Ask the decision model to pick one option of a setup/promotion/search choice.
let lastGame = null; // for describing Pokémon in a choice
export async function pickOption(game, p, prompt) {
  if (prompt.options.length === 1) return prompt.options[0].id;
  lastGame = game;
  const keys = prompt.options.map((_, i) => 'o' + i);
  const criteria = Object.fromEntries(prompt.options.map((o, i) => [keys[i], describeOption(o)]));
  const res = await askDecider(buildState(game, p), {
    pick: { type: 'choice', instructions: `Pokémon TCG decision for "you": ${prompt.en || PROMPT_EN[prompt.kind] || prompt.kind} Choose the option that best helps "you" win.`, criteria },
  });
  return prompt.options[keys.indexOf(res.answers.pick.choice)]?.id ?? prompt.options[0].id;
}

function describeOption(o) {
  if (o.en && !o.mon && !o.card) return o.en;
  if (o.mon) return JSON.stringify(monInfo(o.mon, lastGame));
  const c = o.card;
  if (c.kind === 'pokemon')
    return `${c.name}: ${STAGES[c.stage]} ${c.type} Pokémon, ${c.hp} HP, retreat ${c.retreat}, weakness ${c.weakness || 'none'}, attacks ${c.attacks.map((a) => `${a.name} [${a.cost.join('+')}] ${a.damage || '-'} ${a.text}`).join('; ')}`;
  return cardLabel(c);
}

// ---------------------------------------------------------------- CPU engine
// A rule-based player: scores every legal move with Pokémon TCG know-how, then turns the scores into
// probabilities (softmax), so the coach bars and the win meter work exactly as with a decision model.
// It is also the backup whenever the chosen decision model can't be reached.
function attackOutcome(game, p, idx, attacker = p.active, defender = game.opp(p).active) {
  const atk = game.attacksOf(attacker)[idx];
  const [lo, hi] = game.baseRange(attacker, defender, atk);
  const avg = (lo + hi) / 2;
  const fd = (x) => game.finalDamage(attacker, defender, x, { noWR: atk.fx.noWR, noWROnly: atk.fx.noWROnly, noRes: atk.fx.noRes }).dmg;
  return { atk, min: fd(lo), avg: fd(avg), max: fd(hi) };
}

function bestAttack(game, p, defender = game.opp(p).active) {
  const a = p.active;
  let best = null;
  game.attacksOf(a).forEach((atk, i) => {
    if (!canPay(a.payTypes, atk.cost)) return;
    const o = attackOutcome(game, p, i, a, defender);
    if (!best || o.avg > best.avg) best = o;
  });
  return best;
}

// How close the Energy on `m` gets it to its strongest attack (0 = nothing, 1 = ready).
function energyProgress(m, types = m.payTypes) {
  return Math.max(0, ...m.card.attacks.map((a) => {
    const need = a.cost.length;
    const pool = [...types];
    let got = 0;
    for (const c of a.cost.filter((x) => x !== 'Colorless')) {
      let i = pool.indexOf(c);
      if (i < 0) i = pool.findIndex((t) => t.includes('|') && t.split('|').includes(c)); // Rapid Strike Energy, Aurora Energy…
      if (i >= 0) { pool.splice(i, 1); got++; }
    }
    got += Math.min(pool.length, a.cost.filter((x) => x === 'Colorless').length);
    return (need ? got / need : 1) * (0.5 + a.base / 200); // an attack that costs nothing is always ready
  }));
}

export function cpuScore(game, p, a) {
  const o = game.opp(p), me = p.active, them = o.active;
  switch (a.kind) {
    case 'attack': {
      const r = attackOutcome(game, p, a.index);
      const fx = r.atk.fx;
      if (them.effects.shield?.kind === 'all' && !(fx.ignoreDefEffects || (game.modern && fx.noWR))) return 5; // these still hit a shielded Pokémon
      let sc = r.min >= them.hpLeft ? 62 : r.avg >= them.hpLeft ? 48 : 30 + r.avg / 4;
      if ((fx.selfDamage || 0) >= me.hpLeft) sc -= 40;
      if (fx.status || fx.flipStatus || fx.flipStatusEither) sc += 6;
      if (fx.discard) sc -= 4;
      if (fx.shield || fx.flipShield) sc += me.damage > me.maxHp / 2 ? 12 : 2;
      if (fx.healAll) sc = me.damage >= 30 ? 40 + me.damage / 5 : 8;
      return sc;
    }
    case 'evolve': return 82 + (a.card.hp - a.target.maxHp) / 10;
    case 'bench': return p.bench.length < 2 ? 80 : p.bench.length < 4 ? 55 : 20;
    case 'energy': {
      const m = a.target, before = energyProgress(m), after = energyProgress(m, [...m.payTypes, a.card.energyType]);
      const gain = after - before;
      const enablesNow = m === me && m.card.attacks.some((x) => !canPay(m.payTypes, x.cost) && canPay([...m.payTypes, a.card.energyType], x.cost));
      return (enablesNow ? 92 : 45) + gain * 40 + (m === me ? 6 : 0);
    }
    case 'retreat': {
      const stuck = me.status.asleep || me.status.paralyzed || me.status.confused;
      const target = a.target;
      const better = energyProgress(target) > energyProgress(me) || target.hpLeft > me.hpLeft * 1.5;
      return (stuck || me.hpLeft <= 20) && better ? 50 : 1;
    }
    case 'trainer': {
      const t = a.tkind, m = a.target;
      const ba = bestAttack(game, p);
      switch (t) {
        case 'potion': return m.damage >= 20 && m.hpLeft <= 40 ? 60 : m.damage >= 20 ? 30 : 4;
        case 'superPotion': return m.damage >= 40 && m.energy.length > 1 ? 50 : 4;
        case 'switch': return (me.status.asleep || me.status.paralyzed || me.hpLeft <= 20) && m.hpLeft > 30 ? 55 : 3;
        case 'gust': {
          if (!ba && !p.hand.some((c) => c.kind === 'energy')) return 4;
          const r = bestAttack(game, p, m);
          return r && r.min >= m.hpLeft ? 90 : m.hpLeft <= 30 ? 30 : 6;
        }
        case 'energyRemoval': return m.energy.length ? 58 + (m === them ? 10 : 0) : 0;
        case 'superEnergyRemoval': return m.energy.length >= 2 ? 52 : 6;
        case 'plusPower': return ba && ba.min < them.hpLeft && ba.min + 10 >= them.hpLeft ? 88 : 4;
        case 'defender': return m.hpLeft <= 40 ? 35 : 5;
        case 'bill': return 70;
        case 'professorOak': return p.hand.length <= 3 ? 65 : 6;
        case 'lass': return o.hand.length >= 5 ? 20 : 2;
        case 'energyRetrieval': return p.discard.some((c) => c.kind === 'energy') && !p.hand.some((c) => c.kind === 'energy') ? 45 : 5;
        case 'computerSearch': return 18;
        // Modern Trainers
        case 'rareCandy': return 90;
        case 'nestBall': case 'buddyPoffin': return p.bench.length < 3 ? 72 : p.bench.length < 5 ? 30 : 0;
        case 'ultraBall': case 'greatBall': case 'pokeBall': case 'jacq': case 'clavell': case 'trProton': return 45;
        case 'arven': case 'trPetrel': case 'trTransceiver': case 'pokegear': case 'hilda': return 50;
        case 'rosasEncouragement': return 55;
        // Sword & Shield Trainers
        case 'pokeKid': case 'evolutionIncense': case 'sonia': return 45;
        case 'bede': case 'metalSaucer': case 'turboPatch': return 48;
        case 'capaciousBucket': return p.hand.some((c) => c.kind === 'energy') ? 12 : 35;
        case 'birdKeeper': return p.deck.length <= 10 ? 1 : (me.status.asleep || me.status.paralyzed || me.hpLeft <= 30) ? 60 : p.hand.length <= 3 ? 40 : 10;
        case 'leon': return ba && ba.min < them.hpLeft && ba.min + 30 >= them.hpLeft ? 85 : 5;
        case 'nessa': case 'ordinaryRod': return 20;
        case 'pokemonCenterLady': return game.allMons(p).some((x) => x.damage >= 60 || x.conditions().length) ? 40 : 6;
        // Sword & Shield V Battle / League Battle Decks
        case 'copycat': return p.deck.length <= 10 ? 1 : o.hand.length >= p.hand.length + 3 ? 55 : 4;
        case 'marnie': return p.deck.length <= 10 ? 1 : o.hand.length >= 6 || p.hand.length <= 2 ? 55 : 14;
        case 'roxanne': return p.deck.length <= 10 ? 1 : 60;
        case 'quickBall': case 'levelBall': case 'fogCrystal': case 'tagCall': return 45;
        case 'battleVipPass': case 'eggIncubator': return p.bench.length < 3 ? 70 : p.bench.length < 5 ? 25 : 0;
        case 'lady': case 'gordie': case 'energySpinner': return p.hand.some((c) => c.kind === 'energy') ? 10 : 40;
        case 'elesasSparkle': case 'melony': return 55;
        case 'guzmaHala': return 30;
        case 'lureModule': case 'trekkingShoes': return 20;
        case 'cramOMatic': return 25;
        case 'hisuianHeavyBall': return 12;
        case 'urnOfVitality': return 8;
        case 'cheryl': return game.allMons(p).some((x) => x.card.stage > 0 && x.damage >= 80) ? 50 : 3;
        case 'luckyIcePop': return me?.damage >= 20 ? 30 : 2;
        case 'suspiciousFoodTin': return game.allMons(p).some((x) => x.damage >= 60) ? 40 : 4;
        case 'switchCart': return (me.status.asleep || me.status.paralyzed || me.hpLeft <= 30) ? 55 : 3;
        case 'mallowLana': return me && me.damage >= 60 && me.hpLeft <= 60 ? 45 : 4;
        case 'greatCatcher': return ba && m && m.hpLeft <= ba.min ? 88 : 6;
        case 'echoingHorn': return 6;
        case 'fanOfWaves': return 40;
        case 'toolScrapper': return game.allMons(o).some((x) => x.tools.length) ? 40 : 0;
        case 'scoopUpNet': return game.allMons(p).some((x) => x.damage && x.hpLeft <= 30 && !x.card.prizes) ? 35 : 2;
        case 'powerTablet': return ba && ba.min < them.hpLeft && ba.min + 30 >= them.hpLeft ? 85 : 5;
        // Sun & Moon
        case 'professorKukui': return p.deck.length <= 10 ? 1 : ba && ba.min < them.hpLeft && ba.min + 20 >= them.hpLeft ? 80 : p.hand.length <= 3 ? 45 : 12;
        case 'acerola': return m && m.hpLeft <= 30 && m.damage >= 60 ? 45 : 2;
        case 'apricornMaker': case 'pokemonFanClub': case 'timerBall': return 40;
        case 'aquaPatch': case 'maskedRoyal': return 48;
        case 'welder': return 60;
        case 'bigMalasada': return me && (me.status.asleep || me.status.paralyzed || me.status.confused) ? 50 : me?.damage ? 15 : 2;
        case 'brocksGrit': return p.deck.length <= 15 ? 35 : 3;
        case 'energyLoto': return p.hand.some((c) => c.kind === 'energy') ? 8 : 30;
        case 'fieldBlower': return game.allMons(o).some((x) => x.tools.length) || (game.stadium && game.stadium.owner !== p.idx) ? 35 : 0;
        case 'fisherman': return p.hand.some((c) => c.kind === 'energy') ? 6 : 35;
        case 'lana': return game.allMons(p).filter((x) => x.damage >= 50).length >= 2 ? 45 : 5;
        case 'lureBall': case 'rescueStretcher': return 18;
        case 'mallow': return p.hand.length <= 2 ? 30 : 6;
        // Draw cards: great with a small hand, but they run the deck out (losing the game) when overused.
        case 'nemona': case 'professorsResearch': case 'youngster': case 'trAriana': case 'rika': case 'roark': case 'lilliesDetermination':
        case 'judge': case 'zisu': case 'irisFightingSpirit': case 'drayton': case 'explorersGuidance': case 'hop': case 'dan':
        case 'barry': case 'shauna': case 'bugCatcher': case 'gymTrainer': case 'bruno': case 'korrinasFocus': case 'milo':
        case 'cynthia': case 'hau': case 'kahili': case 'lillie': case 'looker': case 'sightseer': case 'sophocles': case 'tvReporter': case 'tateLiza':
          return p.deck.length <= 10 ? 1 : p.hand.length <= 3 ? 62 : p.hand.length <= 5 ? 22 : 2;
        case 'iono': return o.hand.length >= 6 || p.hand.length <= 2 ? 55 : 12;
        case 'bossOrders': case 'counterCatcher': case 'primeCatcher': case 'trGiovanni': case 'pokemonCatcher': case 'guzma': {
          if (!ba || !m) return ba ? 30 : 4;
          return m.hpLeft <= ba.min ? 92 : m.card.prizes > 1 && m.hpLeft <= ba.max ? 60 : 8;
        }
        case 'potion30': return m.damage >= 30 && m.hpLeft <= 60 ? 55 : 4;
        case 'scrambleSwitch': return (me.status.asleep || me.status.paralyzed || me.hpLeft <= 30) && m.hpLeft > 40 ? 55 : 3;
        case 'tool': return a.card.tool?.startsWith('tm') ? (a.card.tool === 'tmEvolution' && p.bench.length ? 40 : 3) : 45;
        case 'stadium': return 35;
        case 'energyRetrievalM': case 'superRod': case 'nightStretcher': case 'palPad': return 20;
        case 'electricGenerator': case 'energySticker': case 'earthenVessel': return 48;
        case 'energySwitch': return 15;
        case 'mela': case 'unfairStamp': case 'trArcher': return 50;
        case 'turoScenario': return m.damage >= 60 && m !== me ? 30 : 2;
        default: return 5;
      }
    }
    case 'end': return 3;
    // Pokémon Powers / Abilities and Stadium actions are almost always worth using before attacking.
    case 'power':
      if (['rumblingEngine', 'concealedCards', 'refinement', 'restart', 'industriousIncisors', 'flipTheScript', 'lunarCycle', 'reconDirective', 'flaringMagic', 'makeDo', 'fusionStrikeSystem', 'shiningArcana', 'intrepidSword'].includes(a.pkind) && p.deck.length <= 8) return 1;
      // Intrepid Sword ends the turn: only when there is no attack, and after everything else.
      if (a.pkind === 'intrepidSword') return bestAttack(game, p) && game.turn !== 1 ? 0 : 4;
      if (a.pkind === 'stellarWish') return 40;
      if (a.pkind === 'witchRondo') return 12;
      if (a.pkind === 'primateWisdom') return 8;
      if (a.pkind === 'evolutionRoar') return p.hand.length >= 4 ? 30 : 3;
      if (['powerDraw', 'sprint', 'slushRush', 'roastReveal'].includes(a.pkind) && p.deck.length <= 8) return 1;
      if (a.pkind === 'weedOut') return 2;
      if (a.pkind === 'roaringResolve') return a.target && a.target.hpLeft > 60 ? 55 : 2;
      if (a.pkind === 'smoothOver') return 20;
      if (a.pkind === 'starPortal') return p.discard.filter((c) => c.kind === 'energy' && c.energyType === 'Water').length >= 2 ? 70 : 5;
      return a.pkind === 'psychicEmbrace' ? (a.target && p.hand.length >= 0 ? 34 : 0) : a.pkind === 'pollenStench' || a.pkind === 'longDistanceHypnosis' ? 25 : 58;
    case 'stadium':
      // Jubilife Village ends the turn: only worth it when there is no attack and the hand is poor.
      if (a.stadium === 'jubilifeVillage') return bestAttack(game, p) && game.turn !== 1 ? 0 : p.hand.length <= 3 ? 12 : 1;
      return 40;
    default: return 0;
  }
}

export function cpuRank(game, p, actions) {
  const scores = actions.map((a) => cpuScore(game, p, a));
  const max = Math.max(...scores);
  const exps = scores.map((x) => Math.exp((x - max) / 8));
  const sum = exps.reduce((s, x) => s + x, 0);
  const probabilities = Object.fromEntries(actions.map((a, i) => [a.key, exps[i] / sum]));
  const best = actions[scores.indexOf(max)];
  return { type: 'choice', choice: best.key, confidence: probabilities[best.key], probabilities };
}

// Win estimate (0–4, like the model's score question): Prize race, board strength and Energy in play.
export function cpuWin(game, p) {
  const o = game.opp(p);
  const board = (q) => game.allMons(q).reduce((s, m) => s + m.hpLeft + 15 * m.energy.length + 20 * m.card.stage, 0);
  const prizeLead = o.prizes.length - p.prizes.length; // positive: we have taken more
  const boardLead = (board(p) - board(o)) / Math.max(150, board(p) + board(o));
  const x = 0.55 * prizeLead + 2.2 * boardLead;
  const score = Math.max(0, Math.min(4, 2 + x));
  const legend = Object.fromEntries(WIN_LEVELS.map((l, i) => [String(i), l]));
  const probabilities = Object.fromEntries(WIN_LEVELS.map((_, i) => [String(i), Math.exp(-((i - score) ** 2))]));
  const z = Object.values(probabilities).reduce((s, v) => s + v, 0);
  for (const k in probabilities) probabilities[k] /= z;
  return { type: 'score', score, confidence: 0.5, legend, probabilities };
}

// CPU answers for setup, promotion and search prompts.
export function cpuPick(game, p, prompt) {
  const opts = prompt.options;
  const by = (f) => [...opts].sort((x, y) => f(y) - f(x))[0].id;
  // New prompts carry the engine's own hint for each option.
  if (opts.some((o) => o.ai != null)) return by((o) => o.ai ?? 0);
  switch (prompt.kind) {
    case 'setup-active': return by((o) => o.card.hp + (o.card.retreat ? 0 : 10));
    case 'promote': case 'whirlwind': return by((o) => o.mon.hpLeft / 10 + energyProgress(o.mon) * 10);
    case 'lure': return by((o) => -o.mon.hpLeft);
    case 'ser': return by((o) => -energyProgress(o.mon));
    case 'discard': return by((o) => (o.card.kind === 'energy' ? 1 : o.card.kind === 'trainer' ? 2 : 0) * -1);
    case 'search': return by((o) => (o.card.stage > 0 && game.allMons(p).some((m) => m.name === o.card.evolvesFrom) ? 10 : 0) + (o.card.kind === 'energy' ? 2 : 0));
    default: return opts[0].id;
  }
}

export function fallbackAction(game, p, actions) {
  const r = cpuRank(game, p, actions);
  return actions.find((a) => a.key === r.choice);
}

// Controller for the AI opponent.
export class AIController {
  constructor({ onThinking = () => {}, onDecision = () => {}, onError = () => {} } = {}) {
    Object.assign(this, { onThinking, onDecision, onError });
  }

  async chooseAction(game, p, actions) {
    if (actions.length === 1) return actions[0];
    if (aiConfig.engine === 'cpu') {
      const r = cpuRank(game, p, actions);
      const pick = actions.find((a) => a.key === r.choice);
      this.onDecision(pick, r);
      return pick;
    }
    this.onThinking(true);
    try {
      const { action } = await rankActions(game, p, actions);
      const pick = actions.find((a) => a.key === action.choice) || actions.at(-1);
      this.onDecision(pick, action);
      return pick;
    } catch (err) {
      this.onError(err);
      return fallbackAction(game, p, actions);
    } finally {
      this.onThinking(false);
    }
  }

  async choose(game, p, prompt) {
    // Face-down Prize cards and Rock-Paper-Scissors throws: a random pick is the right play (and costs no model call).
    if (prompt.kind === 'prize' || prompt.kind === 'rps') return prompt.options[Math.floor(Math.random() * prompt.options.length)].id;
    if (aiConfig.engine === 'cpu') return cpuPick(game, p, prompt);
    this.onThinking(true);
    try {
      return await pickOption(game, p, prompt);
    } catch (err) {
      this.onError(err);
      return cpuPick(game, p, prompt);
    } finally {
      this.onThinking(false);
    }
  }

  async setupBench(game, p, basics) {
    return basics.map((c) => c.uid); // benching every Basic at setup is standard practice
  }
}
