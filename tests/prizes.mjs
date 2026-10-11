import { Game } from '../public/engine.js';
import { DECKS, loadDeck } from '../public/cards.js';
import { fallbackAction, cpuPick } from '../public/ai.js';
const keys = Object.keys(DECKS).filter(k => DECKS[k].format === 'modern'); await Promise.all(keys.map(loadDeck));
const bot = { chooseAction: async (g,p,a)=> fallbackAction(g,p,a), choose: async (g,p,pr)=> cpuPick(g,p,pr), setupBench: async (g,p,b)=>b.map(c=>c.uid) };
const seen = {}; let checked = 0, bad = 0;
for (let i = 0; i < 400; i++) {
  const d = [keys[i % keys.length], ['me-gengar','mel-lucario','mel-greninja','me-diancie'][i % 4]];
  const g = new Game({ decks: d, controllers: [bot, bot], hooks: {} });
  // Wrap handleKOs: compare Prize cards taken with what each Knock Out should give.
  const orig = g.handleKOs.bind(g);
  g.handleKOs = async (attacker) => {
    const before = g.players.map(p => p.prizes.length);
    const ko = g.players.flatMap(p => g.allMons(p).filter(m => m.damage >= m.maxHp).map(m => ({ owner: p.idx, m, mega: m.card.tags?.includes('Mega'), gengar: g.allMons(p).some(x => x.card.powerKind === 'shadowyConcealment') && m.card.type === 'Darkness' && g.koBy?.card.tags?.includes('ex'),
      // Altered Creation-GX (with an extra Water Energy): Knock Outs of the Active Pokémon by the taker's attacks give 1 more
      altered: !!(g.koBy && g.players[1 - p.idx].until.alteredPrize && g.allMons(g.players[1 - p.idx]).includes(g.koBy) && p.active === m) })));
    await orig(attacker);
    for (const k of ko) {
      const taker = 1 - k.owner, got = before[taker] - g.players[taker].prizes.length;
      if (ko.filter(x => x.owner === k.owner).length !== 1) continue; // one Knock Out at a time keeps the count unambiguous
      const want = Math.min(before[taker], Math.max(0, (k.m.card.prizes || 1) - (k.gengar ? 1 : 0)) + (k.altered ? 1 : 0));
      const key = (k.mega ? 'mega' : k.m.card.prizes === 3 ? 'vmax/tagteam' : k.m.card.prizes === 2 ? 'ex/v' : 'normal') + (k.gengar ? '+concealment' : '') + (k.altered ? '+alteredCreation' : '');
      seen[key] = (seen[key] || 0) + 1; checked++;
      if (got !== want) { bad++; if (bad < 5) console.log('MISMATCH', k.m.name, 'got', got, 'want', want); }
    }
  };
  await g.run();
}
console.log({ checked, bad, seen });
process.exit(bad ? 1 : 0);
