import { Game } from '../public/engine.js';
import { fallbackAction } from '../public/ai.js';
import { DECKS, loadDeck } from '../public/cards.js';
const K=Object.keys(DECKS); await Promise.all(K.map(loadDeck));
const bot = { chooseAction: async (g,p,a)=> Math.random()<0.3 ? a[Math.floor(Math.random()*a.length)] : fallbackAction(g,p,a),
  choose: async (g,p,pr)=>pr.options[Math.floor(Math.random()*pr.options.length)].id, setupBench: async (g,p,b)=>b.map(c=>c.uid) };
let ok=0;
for (let i=0;i<600;i++){
  // play a game, snapshot at a random checkpoint, then restore that snapshot (through JSON) and finish it
  const stopAt = 5 + Math.floor(Math.random()*120); let n=0, snap=null;
  const g = new Game({ decks:(() => { const a = K[i%K.length]; const same = K.filter((k) => (DECKS[k].format||'classic') === (DECKS[a].format||'classic')); return [a, same[(i*7+3)%same.length]]; })(), controllers:[bot,bot], hooks:{ onCheckpoint:(g)=>{ if(++n===stopAt) snap=JSON.stringify(g.serialize()); } } });
  await g.run();
  if(!snap) continue;
  const r = Game.restore(JSON.parse(snap), { controllers:[bot,bot], hooks:{} });
  const count = (g) => g.players.map(p=>p.deck.length+p.hand.length+p.discard.length+p.prizes.length+(p.lost?.length||0)+g.allMons(p).reduce((s,m)=>s+m.allCards().length,0)+(g.stadium?.owner===p.idx?1:0));
  if (count(r).some(c=>c!==60)) throw new Error('restore count '+count(r));
  if (JSON.stringify(r.serialize()) !== snap) throw new Error('round trip mismatch');
  await r.run({ resume: true });
  if (count(r).some(c=>c!==60)) throw new Error('after resume count');
  if (!r.winner) throw new Error('no winner');
  ok++;
}
console.log('restored and finished', ok, 'games');
