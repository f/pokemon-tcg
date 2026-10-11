// Every deck pairing, both formats, with a turn cap that reports any game that never ends.
import { Game } from '../public/engine.js';
import { DECKS, loadDeck } from '../public/cards.js';
import { fallbackAction, cpuPick } from '../public/ai.js';
const all = Object.keys(DECKS); await Promise.all(all.map(loadDeck));
const R = Number(process.argv[2] || 0);
const bot = { chooseAction: async (g,p,a)=> Math.random() < R ? a[Math.floor(Math.random()*a.length)] : fallbackAction(g,p,a), choose: async (g,p,pr)=> Math.random() < R ? pr.options[Math.floor(Math.random()*pr.options.length)].id : cpuPick(g,p,pr), setupBench: async (g,p,b)=>b.map(c=>c.uid) };
let long = 0, games = 0, maxTurn = 0;
for (const fmt of ['classic', 'modern']) {
  const keys = all.filter(k => (DECKS[k].format || 'classic') === fmt);
  for (const a of keys) for (const b of keys) for (let r = 0; r < 2; r++) {
    const g = new Game({ decks: [a, b], controllers: [bot, bot], hooks: {} });
    const origStart = g.startTurn.bind(g);
    g.startTurn = async (p) => { if (g.turn > 300) { g.setWinner('draw', 'reason.both'); return; } return origStart(p); };
    await g.run(); games++;
    maxTurn = Math.max(maxTurn, g.turn);
    if (g.turn > 300) { long++; if (long < 6) console.log('NEVER ENDS', fmt, a, b); }
  }
}
console.log({ games, long, maxTurn });
