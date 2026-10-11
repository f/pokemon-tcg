import { DECKS, CARDS, CARD_BACK, PRIZES, DECK_GROUPS, MODERN_GROUPS, loadDeck } from './cards.js';
import { Game, isType } from './engine.js';
import { AIController, rankActions, aiConfig } from './ai.js';
import { RPS_CANCEL, chooseThrow, showdown, rpsReset, rpsClose } from './rps.js';
import { api, inApp, online, webOnly, MAC_DOWNLOAD } from './api.js';

if (inApp) document.documentElement.classList.add('in-app'); // the macOS app (see the in-app rules in style.css)
import { t, setLang, getLang, cardName, CARD_TEXT_TR, RULES_HTML } from './i18n.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (x) => (getLang() === 'tr' ? `%${Math.round(x * 100)}` : `${Math.round(x * 100)}%`);
const stale = () => new Promise(() => {}); // an abandoned game just stops here

let game = null;
let gameId = 0;
let inspectables = new Map(); // element key → card, for the inspector panel
let logEntries = [];
let decision = null;          // current human decision: {actions, ranking, p, pick}
let coachState = { key: 'ui.coachIdle', params: {}, cls: '' };
let oppState = { key: '', params: {}, thinking: false };
let winState = null;
let modalRenderer = null;
let selectedDeck = null;
const lastDamage = new Map(); // mon id → damage at last render, to roll the dice when it changes

// ---------------- Icons ----------------
// Energy symbols use Pokémon type icons; UI icons come from Lucide (both loaded from jsDelivr via style.css).
const icon = (name) => `<i class="ic ic-${name}"></i>`;
const energyIcon = (type) => (type?.includes('|') ? type.split('|').map((x) => energyIcon(x)).join('')
  : `<span class="ei ei-${type}" style="--c:var(--${type})" title="${esc(t('type.' + type))}"><i></i></span>`);
const backImg = () => `<img src="${CARD_BACK}" alt="" draggable="false">`;

// ---------------- Static text ----------------
// Per-turn markers kept in a Pokémon's effects for card rules, not shown as tags.
const HIDDEN_EFFECTS = new Set(['lastHit', 'healedNow', 'evolvedNow', 'movedActive', 'lastAtk']);

function applyStaticText() {
  document.documentElement.lang = getLang();
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  // The welcome text counts the decks, so it stays right as decks are added.
  const counts = { classic: Object.values(DECKS).filter((d) => d.format !== 'modern').length, modern: Object.values(DECKS).filter((d) => d.format === 'modern').length };
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml, counts); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  document.querySelectorAll('.lang button').forEach((b) => b.classList.toggle('on', b.dataset.lang === getLang()));
  $('#rules-body').innerHTML = RULES_HTML[getLang()].replace('{classic}', counts.classic).replace('{modern}', counts.modern); // deck counts stay right as decks are added
  const slot = $('#rules-body [data-dice-chart]');
  if (slot) slot.innerHTML = diceChart();
  $('#dice-label').textContent = t('ui.diceStyle').replace(/\s*[:：]\s*$/, ''); // a row label, not a prompt
  document.querySelectorAll('input[name="dice"]').forEach((r) => { r.checked = r.value === diceStyle; });
}

// ---------------- Board rendering ----------------
function monTile(m, { active = false, owner }) {
  if (game.phase === 'setup' && owner.idx === 1) return `<div class="mon facedown ${active ? 'active' : ''}">${backImg()}</div>`;
  inspectables.set('m' + m.id, m.card);
  const ratio = m.hpLeft / m.maxHp;
  const tags = [
    ...m.conditions().map((s) => `<span class="tag-status">${esc(t('st.' + s))}</span>`),
    ...m.tools.map((x) => `<span class="tag-tool">${esc(x.card.name)}</span>`),
    ...Object.keys(m.effects).filter((k) => !HIDDEN_EFFECTS.has(k)).map((k) => `<span class="tag-fx">${esc(t('tag.' + k))}</span>`),
  ].join('');
  // Attached Energy and Trainer cards sit tucked under the Pokémon with a strip showing, like on a real table.
  // the opponent's side is mirrored so its tucked cards peek out towards the opponent.
  const under = [...m.energy, ...m.tools.map((x) => x.card)];
  const tucked = under.map((c, i) => {
    inspectables.set('u' + c.uid, c);
    const mark = c.kind === 'energy' ? energyIcon(c.energyType) : `<span class="tool-mark">${esc(c.name)}</span>`;
    return `<div class="tucked ${arrivingCards.has(c.uid) ? 'arriving' : ''}" data-cuid="${c.uid}" data-inspect="u${c.uid}" style="--i:${i};z-index:${under.length - i};background-image:url('${c.img}')">${mark}</div>`;
  }).join('');
  return `<div class="mon ${active ? 'active' : ''} ${owner.idx === 1 ? 'up' : ''} ${arena?.ids.has(m.id) ? 'in-arena' : ''}" data-inspect="m${m.id}" data-mon="${m.id}">
    <div class="pile-under" style="--n:${under.length};--pkf:${Math.min(1, 3 / Math.max(1, under.length)).toFixed(3)}">
      ${tucked}
      <div class="top-card ${arrivingCards.has(m.card.uid) ? 'arriving' : ''}" data-cuid="${m.card.uid}">
        <img class="card-img" src="${m.card.img}" alt="${esc(m.name)}" draggable="false">
        ${diceHtml(m)}
        <div class="tags">${tags}</div>
      </div>
    </div>
    <div class="hpbar ${ratio <= 0.3 ? 'low' : ratio <= 0.6 ? 'mid' : ''}"><div style="width:${ratio * 100}%"></div></div>
    <div class="hptext">${m.hpLeft}/${m.maxHp} ${t('ui.hp')}</div>
  </div>`;
}

// Damage counters shown as six-sided dice, the way players track them on a real table: each pip is 10 damage.
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function diceHtml(m) {
  const changed = lastDamage.has(m.id) && lastDamage.get(m.id) !== m.damage;
  lastDamage.set(m.id, m.damage);
  if (!m.damage) return '';
  const dice = [];
  for (let c = m.damage / 10; c > 0; c -= 6) dice.push(Math.min(6, c));
  const roll = changed && $('#opt-anim').checked ? 'roll' : '';
  return `<div class="dice ${roll}" title="${esc(t('ui.diceTitle', { c: m.damage / 10, n: m.damage }))}">
    ${dice.map((v) => dieFace(v)).join('')}
    <span class="dsum">${m.damage}</span></div>`;
}

// A die face in the chosen style: pips (like a classic die) or a printed number (like numbered damage dice).
let diceStyle = 'pips';
try { diceStyle = localStorage.getItem('diceStyle') || 'pips'; } catch { /* storage unavailable */ }
function dieFace(v, style = diceStyle) {
  if (style === 'numbers') return `<div class="die num"><b>${v}</b></div>`;
  return `<div class="die">${Array.from({ length: 9 }, (_, i) => `<span class="${PIPS[v].includes(i) ? 'p' : ''}"></span>`).join('')}</div>`;
}

// Chart for the rules page: every face in both styles and the damage it stands for.
function diceChart() {
  const rows = [1, 2, 3, 4, 5, 6].map((v) => `<div class="dc-col">${dieFace(v, 'pips')}${dieFace(v, 'numbers')}<span>${v * 10}</span></div>`).join('');
  const combo = `<div class="dc-combo">${dieFace(6)}${dieFace(2)}<span>= 60 + 20 = 80</span></div>`;
  return `<div class="dice-chart"><div class="dc-row">${rows}</div><div class="dc-cap">${esc(t('ui.diceChart'))}</div>${combo}</div>`;
}

// ---------------- Attack arena ----------------
// On every attack both Active Pokémon rise from the mat into the middle of the board, face each other and clash.
// Damage is shown as dice tumbling from the attacker onto the defender, with a burst and a floating number.
let arena = null; // { el, cards: Map(monId → wrapper), ids: Set }
const animOn = () => $('#opt-anim').checked;
const monById = (id) => game && game.players.flatMap((p) => game.allMons(p)).find((m) => m.id === id);
const centerOf = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

function arenaCard(m, rect) {
  const w = document.createElement('div');
  w.className = 'arena-card';
  // The mat's (already decoded) image first; the large one swaps in once decoded, never mid-animation.
  w.innerHTML = `<img src="${m.card.img}" alt="${esc(m.name)}"><i class="a-glow"></i><div class="a-dice"></div><div class="a-hp"></div>`;
  const img = w.querySelector('img'), hi = new Image();
  hi.src = m.card.imgLarge;
  hi.decode().then(() => { img.src = hi.src; }).catch(() => {});
  Object.assign(w.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px` });
  updateArenaCard(w, m, m.damage);
  return w;
}
function updateArenaCard(w, m, damage) {
  const dice = [];
  for (let c = damage / 10; c > 0; c -= 6) dice.push(Math.min(6, c));
  w.querySelector('.a-dice').innerHTML = dice.map((v) => dieFace(v)).join('');
  w.querySelector('.a-hp').textContent = `${Math.max(0, m.maxHp - damage)}/${m.maxHp} ${t('ui.hp')}`;
}

// FLIP: the box takes its final place at once and a transform carries it there, so no frame needs layout.
function moveTo(el, rect, duration, easing = 'cubic-bezier(.3,.7,.3,1)') {
  const from = el.getBoundingClientRect();
  Object.assign(el.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px` });
  const s = from.width / rect.width;
  el.animate([
    { transformOrigin: '0 0', transform: `translate(${from.left - rect.left}px, ${from.top - rect.top}px) scale(${s})` },
    { transformOrigin: '0 0', transform: 'none' },
  ], { duration, easing });
  return sleep(duration);
}

async function arenaOpen({ p, from, to, atk, type }) {
  if (!animOn()) return;
  const att = monById(from), def = monById(to);
  const attEl = document.querySelector(`[data-mon="${from}"] .top-card`), defEl = document.querySelector(`[data-mon="${to}"] .top-card`);
  if (!att || !def || !attEl || !defEl) return;
  // The cut-in covers the whole window, so centre the two cards on the window (not on the board),
  // a little below the title, and shrink them if the window is narrow.
  let h = Math.min(innerHeight * 0.56, 440), w = h * 0.716;
  if (w * 2.45 > innerWidth * 0.92) { w = (innerWidth * 0.92) / 2.45; h = w / 0.716; }
  const gap = w * 0.45;
  const cx = innerWidth / 2, top = innerHeight / 2 - h / 2 + innerHeight * 0.04;
  const mine = p === 0 ? att : def, theirs = p === 0 ? def : att;
  const spot = {
    [mine.id]: { left: cx - gap / 2 - w, top, width: w },
    [theirs.id]: { left: cx + gap / 2, top, width: w },
  };
  // Layers: manga speed lines, two slanted panels in each side's type colour, and the attack title.
  const el = document.createElement('div');
  el.className = 'arena anime';
  el.style.setProperty('--ca', `var(--${type})`);
  el.innerHTML = `
    <div class="panel left" style="--c:var(--${mine.card.type})"></div>
    <div class="panel right" style="--c:var(--${theirs.card.type})"></div>
    <div class="speedlines"></div>
    <div class="arena-title" style="--c:var(--${type})"><span>${esc(atk)}</span></div>`;
  document.body.append(el);
  document.body.classList.add('arena-on');
  arena = { el, cards: new Map(), ids: new Set([from, to]), attacker: from, side: p, type };
  for (const [m, src] of [[att, attEl], [def, defEl]]) {
    const card = arenaCard(m, src.getBoundingClientRect());
    el.append(card);
    arena.cards.set(m.id, card);
  }
  render(); // hides the originals on the mat while they are in the arena
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
  await Promise.all([...arena.cards].map(([id, c]) => moveTo(c, spot[id], 480)));
  el.classList.add('cut-in');
  // Title slams in, then the attacker charges up.
  await sleep(380);
  const ac = arena.cards.get(from);
  ac.classList.add('charging');
  ac.style.setProperty('--c', `var(--${type})`);
  chargeParticles(ac.getBoundingClientRect(), type);
  await sleep(520);
}

// Energy particles converging on the attacker while it charges up.
function chargeParticles(r, type) {
  const c = centerOf(r);
  for (let i = 0; i < 14; i++) {
    const d = document.createElement('div');
    d.className = 'particle';
    d.style.setProperty('--c', `var(--${type})`);
    const ang = (i / 14) * Math.PI * 2, dist = 140 + Math.random() * 60;
    Object.assign(d.style, { left: `${c.x}px`, top: `${c.y}px` });
    document.body.append(d);
    d.animate([
      { transform: `translate(-50%,-50%) translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist}px) scale(1.4)`, opacity: 0 },
      { opacity: 1, offset: 0.3 },
      { transform: 'translate(-50%,-50%) translate(0,0) scale(.3)', opacity: 0 },
    ], { duration: 520 + Math.random() * 160, delay: Math.random() * 120, easing: 'cubic-bezier(.5,0,.8,.5)', fill: 'forwards' });
    setTimeout(() => d.remove(), 900);
  }
}

function floatText(rect, html, cls) {
  const f = document.createElement('div');
  f.className = `float-dmg ${cls}`;
  f.innerHTML = html;
  Object.assign(f.style, { left: `${rect.left + rect.width / 2}px`, top: `${rect.top + rect.height * 0.25}px` });
  document.body.append(f);
  f.animate([
    { transform: 'translate(-50%, 0) scale(.6)', opacity: 0 },
    { transform: 'translate(-50%, -20px) scale(1.25)', opacity: 1, offset: 0.25 },
    { transform: 'translate(-50%, -70px) scale(1)', opacity: 0 },
  ], { duration: 1300, easing: 'ease-out', fill: 'forwards' });
  setTimeout(() => f.remove(), 1350);
}

function burst(rect, type) {
  const b = document.createElement('div');
  b.className = 'burst';
  b.style.setProperty('--c', `var(--${type || 'Colorless'})`);
  const c = centerOf(rect);
  Object.assign(b.style, { left: `${c.x}px`, top: `${c.y}px` });
  document.body.append(b);
  b.animate([{ transform: 'translate(-50%,-50%) scale(.2)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(2.2)', opacity: 0 }], { duration: 600, easing: 'ease-out', fill: 'forwards' });
  setTimeout(() => b.remove(), 620);
}

function shake(el) {
  el.animate([
    { transform: 'translateX(0)', filter: 'none' },
    { transform: 'translateX(-10px) rotate(-2deg)', filter: 'brightness(1.6) saturate(1.4)' },
    { transform: 'translateX(9px) rotate(2deg)' },
    { transform: 'translateX(-6px)' },
    { transform: 'translateX(4px)' },
    { transform: 'translateX(0)', filter: 'none' },
  ], { duration: 480, easing: 'ease-out' });
}

// Dice tumble from the attacker onto the target, showing the damage just dealt.
async function tumbleDice(fromRect, toRect, n) {
  const faces = [];
  for (let c = n / 10; c > 0; c -= 6) faces.push(Math.min(6, c));
  const start = centerOf(fromRect);
  await Promise.all(faces.map((v, i) => {
    const d = document.createElement('div');
    d.className = 'tumble';
    d.innerHTML = dieFace(v);
    Object.assign(d.style, { left: `${start.x}px`, top: `${start.y}px` });
    document.body.append(d);
    const tx = toRect.left + toRect.width * 0.85 - start.x, ty = toRect.top + toRect.height * (0.2 + i * 0.14) - start.y;
    d.animate([
      { transform: 'translate(-50%,-50%) rotate(0deg) scale(.8)' },
      { transform: `translate(calc(-50% + ${tx * 0.5}px), calc(-50% + ${ty * 0.5 - 70}px)) rotate(400deg) scale(1.3)`, offset: 0.5 },
      { transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) rotate(720deg) scale(1)` },
    ], { duration: 650, delay: i * 120, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'forwards' });
    return new Promise((r) => setTimeout(() => { d.remove(); r(); }, 650 + i * 120 + 20));
  }));
}

// ---------- Anime attack effects ----------
const fx = (cls, style = {}) => { const d = document.createElement('div'); d.className = `afx ${cls}`; Object.assign(d.style, style); document.body.append(d); return d; };
const gone = (d, ms) => setTimeout(() => d.remove(), ms);

// A type-specific projectile from attacker to defender; resolves when it reaches the target.
async function projectile(type, a, b, dir) {
  const A = centerOf(a), B = centerOf(b), dx = B.x - A.x, dy = B.y - A.y;
  const len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx) * 180 / Math.PI;
  const travel = (el, dur, delay = 0, extra = '') => el.animate([
    { transform: `translate(-50%,-50%) translate(0,0) ${extra}`, opacity: 0 },
    { opacity: 1, offset: 0.1 },
    { transform: `translate(-50%,-50%) translate(${dx}px, ${dy}px) ${extra}`, opacity: 1 },
  ], { duration: dur, delay, easing: 'cubic-bezier(.45,0,.9,.6)', fill: 'forwards' });
  switch (type) {
    case 'Fire':
      for (let i = 0; i < 3; i++) { const f = fx('fireball', { left: `${A.x}px`, top: `${A.y}px` }); travel(f, 380, i * 90); gone(f, 560); }
      await sleep(560); break;
    case 'Water':
      for (let i = 0; i < 10; i++) {
        const s = 10 + Math.random() * 16, off = (Math.random() - 0.5) * 50;
        const bb = fx('bubble', { left: `${A.x}px`, top: `${A.y + off}px`, width: `${s}px`, height: `${s}px` });
        travel(bb, 420, i * 35); gone(bb, 820);
      }
      await sleep(560); break;
    case 'Grass':
      for (let i = 0; i < 6; i++) {
        const l = fx('leaf', { left: `${A.x}px`, top: `${A.y + (Math.random() - 0.5) * 60}px` });
        l.animate([
          { transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 0 }, { opacity: 1, offset: 0.1 },
          { transform: `translate(-50%,-50%) translate(${dx}px, ${dy + (Math.random() - 0.5) * 40}px) rotate(${720 + i * 60}deg)`, opacity: 1 },
        ], { duration: 460, delay: i * 50, easing: 'cubic-bezier(.4,0,.8,.6)', fill: 'forwards' });
        gone(l, 820);
      }
      await sleep(600); break;
    case 'Lightning': {
      // A jagged bolt drawn from attacker to defender, flickering.
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'afx bolt');
      svg.setAttribute('width', innerWidth); svg.setAttribute('height', innerHeight);
      const pts = [[A.x, A.y]];
      for (let i = 1; i < 9; i++) { const t2 = i / 9; pts.push([A.x + dx * t2 + (Math.random() - 0.5) * 50, A.y + dy * t2 + (Math.random() - 0.5) * 70]); }
      pts.push([B.x, B.y]);
      const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
      svg.innerHTML = `<path d="${d}" class="glow"/><path d="${d}" class="core"/>`;
      document.body.append(svg);
      svg.querySelectorAll('path').forEach((pth) => { const L = pth.getTotalLength(); pth.style.strokeDasharray = L; pth.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' }); });
      svg.animate([{ opacity: 1 }, { opacity: .3 }, { opacity: 1 }, { opacity: .5 }, { opacity: 1 }, { opacity: 0 }], { duration: 640, fill: 'forwards' });
      gone(svg, 660);
      await sleep(260); break;
    }
    case 'Psychic':
      for (let i = 0; i < 4; i++) { const r2 = fx('ring', { left: `${A.x}px`, top: `${A.y}px` }); travel(r2, 520, i * 90, `scale(${1 + i * 0.25})`); gone(r2, 900); }
      await sleep(620); break;
    case 'Fighting':
      await sleep(80); break; // the dash itself is the attack (see the lunge)
    default: {
      const s = fx('slash', { left: `${B.x}px`, top: `${B.y}px`, width: `${b.width * 1.4}px` });
      s.animate([{ transform: 'translate(-50%,-50%) rotate(-28deg) scaleX(0)', opacity: 1 }, { transform: 'translate(-50%,-50%) rotate(-28deg) scaleX(1)', opacity: 1, offset: 0.5 }, { transform: 'translate(-50%,-50%) rotate(-28deg) scaleX(1)', opacity: 0 }], { duration: 360, fill: 'forwards' });
      gone(s, 380);
      await sleep(180);
    }
  }
}

// Impact: hit-stop, white flash, spiky starburst, screen shake and knockback.
async function impact(defEl, type, dir, strong) {
  const r = defEl.getBoundingClientRect(), c = centerOf(r);
  const flash = fx('flash'); flash.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }); gone(flash, 170);
  const star = fx('star', { left: `${c.x}px`, top: `${c.y}px`, '--c': `var(--${type || 'Colorless'})` });
  star.style.setProperty('--c', `var(--${type || 'Colorless'})`);
  star.animate([{ transform: 'translate(-50%,-50%) scale(.2) rotate(0deg)', opacity: 1 }, { transform: `translate(-50%,-50%) scale(${strong ? 1.5 : 1.1}) rotate(25deg)`, opacity: 1, offset: 0.35 }, { transform: `translate(-50%,-50%) scale(${strong ? 1.8 : 1.3}) rotate(35deg)`, opacity: 0 }], { duration: 420, fill: 'forwards' });
  gone(star, 440);
  const ring = fx('shock', { left: `${c.x}px`, top: `${c.y}px` });
  ring.animate([{ transform: 'translate(-50%,-50%) scale(.2)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(2.4)', opacity: 0 }], { duration: 480, easing: 'ease-out', fill: 'forwards' });
  gone(ring, 500);
  // Hit-stop: the defender freezes for a beat, then is knocked back with a red tint.
  defEl.animate([
    { transform: 'none', filter: 'none' },
    { transform: `translateX(${dir * 4}px)`, filter: 'brightness(2.2) saturate(0)', offset: 0.12 },
    { transform: `translateX(${dir * 4}px)`, filter: 'brightness(2.2) saturate(0)', offset: 0.24 },
    { transform: `translateX(${dir * 38}px) rotate(${dir * 7}deg)`, filter: 'sepia(1) saturate(6) hue-rotate(-40deg)', offset: 0.45 },
    { transform: `translateX(${dir * -6}px) rotate(${dir * -2}deg)`, filter: 'none', offset: 0.75 },
    { transform: 'none', filter: 'none' },
  ], { duration: 620, easing: 'ease-out' });
  const shakeEl = arena?.el || $('#board');
  shakeEl.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(-9px,5px)' }, { transform: 'translate(8px,-6px)' }, { transform: 'translate(-6px,-3px)' }, { transform: 'translate(4px,4px)' }, { transform: 'translate(0,0)' }],
    { duration: strong ? 420 : 300, easing: 'linear' });
  await sleep(150);
}

// Dice tumble onto the defender's real dice (rendered first, hidden): each one tracks its die every frame,
// so it lands exactly in place even while the defender is being knocked back, then the real die is revealed.
function tumbleOnto(fromRect, dieEls) {
  const start = centerOf(fromRect);
  return Promise.all(dieEls.map((die, i) => new Promise((resolve) => {
    die.style.visibility = 'hidden';
    const d = document.createElement('div');
    d.className = 'tumble';
    d.innerHTML = die.outerHTML;
    const inner = d.firstChild;
    inner.style.visibility = 'visible';
    const cs = getComputedStyle(die);
    Object.assign(inner.style, { fontSize: cs.fontSize, padding: cs.padding, borderRadius: cs.borderRadius });
    document.body.append(d);
    const D = 650, t0 = performance.now() + i * 120;
    let done = false;
    const finish = () => { if (done) return; done = true; d.remove(); die.style.visibility = ''; resolve(); };
    const frame = (now) => {
      if (done) return;
      const p = Math.min(1, Math.max(0, (now - t0) / D));
      const r = die.getBoundingClientRect(), B = centerOf(r);
      const e = 1 - Math.pow(1 - p, 3), arc = Math.sin(Math.PI * Math.min(1, p * 1.1));
      const x = start.x + (B.x - start.x) * e, y = start.y + (B.y - start.y) * e - 80 * arc;
      Object.assign(inner.style, { width: `${r.width}px`, height: `${r.height}px` });
      d.style.transform = `translate(${x - r.width / 2}px, ${y - r.height / 2}px) rotate(${(1 - e) * 720}deg) scale(${1 + 0.3 * arc})`;
      if (p < 1) requestAnimationFrame(frame); else finish();
    };
    requestAnimationFrame(frame);
    setTimeout(finish, i * 120 + D + 500); // background-tab safety net
  })));
}

// A comic-style stamp (damage numbers, SUPER EFFECTIVE!, MISS!, KO!).
function stamp(rect, html, cls, { dy = 0, dur = 1300 } = {}) {
  const s = fx(`stamp ${cls}`, { left: `${rect.left + rect.width / 2}px`, top: `${rect.top + rect.height * 0.3 + dy}px` });
  s.innerHTML = html;
  s.animate([
    { transform: 'translate(-50%,-50%) scale(2.6) rotate(-14deg)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(.92) rotate(-8deg)', opacity: 1, offset: 0.14 },
    { transform: 'translate(-50%,-50%) scale(1.05) rotate(-8deg)', opacity: 1, offset: 0.24 },
    { transform: 'translate(-50%,-80%) scale(1) rotate(-8deg)', opacity: 1, offset: 0.75 },
    { transform: 'translate(-50%,-110%) scale(.95) rotate(-8deg)', opacity: 0 },
  ], { duration: dur, easing: 'ease-out', fill: 'forwards' });
  gone(s, dur + 20);
}

async function onHit({ from, to, n, notes }) {
  if (!animOn()) return;
  const target = monById(to), source = from != null ? monById(from) : null;
  const inArena = arena?.cards.get(to);
  const targetEl = inArena || document.querySelector(`[data-mon="${to}"] .top-card`);
  if (!target || !targetEl) return;
  const attEl = source && (arena?.cards.get(from) || document.querySelector(`[data-mon="${from}"] .top-card`));
  const type = source?.card.type || 'Colorless';
  const clash = inArena && arena.cards.has(from);
  const a = attEl?.getBoundingClientRect(), b = targetEl.getBoundingClientRect();
  const dir = a ? Math.sign(centerOf(b).x - centerOf(a).x) || 1 : 1;

  if (clash) {
    attEl.classList.remove('charging');
    // Dash: the attacker lunges forward (a long dash for Fighting/Colorless, a short step when firing a projectile).
    const melee = type === 'Fighting' || type === 'Colorless';
    const dx = (centerOf(b).x - centerOf(a).x) * (melee ? 0.55 : 0.18);
    attEl.animate([
      { transform: 'none' },
      { transform: `translateX(${-dx * 0.15}px) scale(.97)`, offset: 0.2 },
      { transform: `translateX(${dx}px) rotate(${dir * 6}deg) scale(1.08)`, offset: 0.55, easing: 'cubic-bezier(.2,.8,.3,1)' },
      { transform: 'none' },
    ], { duration: melee ? 620 : 540, easing: 'ease-in-out' });
    await sleep(melee ? 300 : 160);
    if (!notes.includes('miss')) await projectile(type, attEl.getBoundingClientRect(), targetEl.getBoundingClientRect(), dir);
  }
  const rect = targetEl.getBoundingClientRect();
  if (notes.includes('miss')) {
    targetEl.animate([{ transform: 'none' }, { transform: `translateX(${dir * 26}px) rotate(${dir * 4}deg)`, offset: 0.4 }, { transform: 'none' }], { duration: 420, easing: 'ease-out' });
    stamp(rect, esc(t('anim.miss')), 'miss');
    await sleep(900); return;
  }
  if (n === 0) {
    await impact(targetEl, 'Colorless', dir, false);
    stamp(rect, `${icon('shield')} ${esc(t('anim.blocked'))}`, 'blocked');
    await sleep(900); return;
  }
  const strong = notes.includes('weakness') || n >= 60;
  await impact(targetEl, clash ? type : null, dir, strong);
  const extra = notes.filter((x) => ['resistance', 'defender', 'poison', 'burn'].includes(x)).map((x) => t(x === 'poison' ? 'st.poisoned' : x === 'burn' ? 'st.burned' : 'note.' + x)).join(' · ');
  stamp(rect, `−${n}${extra ? `<small>${esc(extra)}</small>` : ''}`, 'dmg-stamp');
  if (notes.includes('weakness')) stamp(rect, esc(t('anim.superEffective')), 'super', { dy: rect.height * 0.42, dur: 1500 });
  const from2 = attEl ? attEl.getBoundingClientRect() : { left: rect.left + rect.width / 2, top: rect.top - 90, width: 0, height: 0 };
  if (inArena) {
    updateArenaCard(inArena, target, target.damage + n);
    await tumbleOnto(from2, [...inArena.querySelectorAll('.a-dice .die')]);
  } else {
    await tumbleDice(from2, rect, n);
  }
  await sleep(clash ? 350 : 150);
}

// Knock Out: a big stamp over the board.
function koStamp() {
  if (!animOn()) return;
  // Centred on the screen (not the board, which the sidebar pushes to the left), like the attack arena.
  stamp({ left: 0, top: innerHeight / 2, width: innerWidth, height: 0 }, esc(t('anim.ko')), 'ko-stamp', { dur: 1500 });
}

async function arenaClose() {
  if (!arena) return;
  const a = arena;
  await sleep(450);
  a.el.classList.remove('cut-in');
  a.el.querySelector('.arena-title')?.classList.remove('show');
  a.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, fill: 'forwards' });
  const moves = [...a.cards].map(([id, c]) => {
    const home = document.querySelector(`[data-mon="${id}"] .top-card`);
    return home ? moveTo(c, home.getBoundingClientRect(), 420) : Promise.resolve();
  });
  await Promise.all(moves);
  arena = null;
  a.el.remove();
  document.body.classList.remove('arena-on');
  render(); // originals reappear with their updated dice
}

// ---------------- Guided tour ----------------
// Spotlights each part of the table in turn and explains it. Runs before your first move, and from the Tutorial button.
const TOUR = [
  { id: 'welcome' },
  { id: 'active', sel: '#you-active' },
  { id: 'bench', sel: '#you-bench' },
  { id: 'hand', sel: '#hand-wrap' },
  { id: 'prizes', sel: '#you-prizes' },
  { id: 'piles', sel: '#you-piles' },
  { id: 'opp', sel: '.mat.opp' },
  { id: 'midbar', sel: '#midbar' },
  { id: 'moves', sel: '#actions-panel' },
  { id: 'viewer' },
  { id: 'coach', sel: '#btn-settings' },
  { id: 'log', sel: '#log-panel' },
  { id: 'firstTurn' },
];
let tourRunning = false;
const tourDone = () => { try { return localStorage.getItem('tourDone') === '1'; } catch { return false; } };

function runTour() {
  if (tourRunning || $('#table').hidden) return Promise.resolve();
  tourRunning = true;
  return new Promise((resolve) => {
    let i = 0;
    const el = document.createElement('div');
    el.className = 'tour';
    el.innerHTML = '<div class="tour-hole"></div><div class="tour-tip"></div>';
    document.body.append(el);
    const hole = el.querySelector('.tour-hole'), tip = el.querySelector('.tour-tip');
    const finish = () => {
      try { localStorage.setItem('tourDone', '1'); } catch { /* storage unavailable */ }
      el.remove();
      window.removeEventListener('resize', show);
      tourRunning = false;
      resolve();
    };
    function show() {
      const step = TOUR[i], last = i === TOUR.length - 1;
      const target = step.sel && document.querySelector(step.sel);
      el.classList.toggle('no-target', !target);
      tip.innerHTML = `<div class="tour-step">${i + 1} / ${TOUR.length}</div>
        <h3>${esc(t(`tour.${step.id}.t`))}</h3><div class="tour-body">${t(`tour.${step.id}.b`)}</div>
        <div class="row"><button class="ghost" data-a="skip">${esc(t('ui.skip'))}</button>
        <button data-a="back" ${i ? '' : 'disabled'}>${esc(t('ui.back'))}</button>
        <button class="primary" data-a="next">${esc(t(last ? 'ui.letsPlay' : 'ui.next'))}</button></div>`;
      tip.querySelector('[data-a="skip"]').onclick = finish;
      tip.querySelector('[data-a="back"]').onclick = () => { i--; show(); };
      tip.querySelector('[data-a="next"]').onclick = () => { if (last) finish(); else { i++; show(); } };
      if (!target) {
        hole.style.display = 'none';
        Object.assign(tip.style, { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' });
        return;
      }
      const r = target.getBoundingClientRect(), pad = 6;
      Object.assign(hole.style, { display: 'block', left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
      // Place the bubble below, above, left or right of the spotlight, whichever fits.
      tip.style.transform = 'none';
      const tw = tip.offsetWidth, th = tip.offsetHeight, m = 14, W = innerWidth, H = innerHeight;
      let left, top;
      if (r.bottom + m + th < H) { top = r.bottom + m; left = r.left + r.width / 2 - tw / 2; }
      else if (r.top - m - th > 0) { top = r.top - m - th; left = r.left + r.width / 2 - tw / 2; }
      else if (r.left - m - tw > 0) { left = r.left - m - tw; top = r.top + r.height / 2 - th / 2; }
      else { left = r.right + m; top = r.top + r.height / 2 - th / 2; }
      Object.assign(tip.style, { left: `${Math.max(10, Math.min(W - tw - 10, left))}px`, top: `${Math.max(10, Math.min(H - th - 10, top))}px` });
    }
    window.addEventListener('resize', show);
    show();
  });
}

// ---------------- Evolution ----------------
// Anime-style evolution: the Pokémon rises to centre stage, the evolution card merges into it, it turns into a
// glowing silhouette that flickers between the old and new form faster and faster, then a flash reveals the new form.
async function onEvolve({ p, mon, from, to }) {
  if (!animOn()) return;
  const spotEl = document.querySelector(`[data-mon="${mon}"] .top-card`);
  if (!spotEl) return;
  const home = spotEl.getBoundingClientRect();
  const handCard = p === 0 ? document.querySelector(`#hand [data-card="${to.uid}"]`) : document.querySelector('#opp-hand .ocard:last-child img');
  const ov = document.createElement('div');
  ov.className = 'evolve-stage';
  ov.innerHTML = `<div class="ev-rays"></div><div class="ev-glow"></div>
    <div class="ev-card"><img class="ev-old" src="${from.imgLarge}" alt=""><img class="ev-new" src="${to.imgLarge}" alt=""><i class="ev-sil"></i></div>
    <div class="ev-sparkles"></div>`;
  document.body.append(ov);
  document.body.classList.add('arena-on');
  const card = ov.querySelector('.ev-card');
  const h = Math.min(innerHeight * 0.58, 460), w = h * 0.716;
  const target = { left: innerWidth / 2 - w / 2, top: innerHeight / 2 - h / 2, width: w };
  Object.assign(card.style, { left: `${home.left}px`, top: `${home.top}px`, width: `${home.width}px` });
  spotEl.style.visibility = 'hidden';
  ov.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, fill: 'forwards' });
  await moveTo(card, target, 520);
  // The evolution card flies in from the hand and merges into the Pokémon.
  if (handCard) {
    if (p === 0) handCard.style.visibility = 'hidden';
    await fly(handCard, card, { front: p === 0 ? to.img : null });
  }
  ov.classList.add('glowing');
  // Sparkles drifting up around the card.
  const sp = ov.querySelector('.ev-sparkles');
  for (let i = 0; i < 26; i++) {
    const s = document.createElement('i');
    s.style.left = `${innerWidth / 2 + (Math.random() - 0.5) * w * 1.8}px`;
    s.style.top = `${innerHeight / 2 + (Math.random() - 0.2) * h * 0.9}px`;
    s.style.animationDelay = `${Math.random() * 1.6}s`;
    sp.append(s);
  }
  // Flicker between the two silhouettes, accelerating.
  const oldImg = card.querySelector('.ev-old'), newImg = card.querySelector('.ev-new');
  let showNew = false;
  for (const ms of [300, 260, 220, 180, 150, 120, 95, 75, 60, 50, 42, 36, 32]) {
    showNew = !showNew;
    oldImg.style.opacity = showNew ? 0 : 1;
    newImg.style.opacity = showNew ? 1 : 0;
    card.animate([{ transform: 'scale(1)' }, { transform: `scale(${showNew ? 1.06 : 0.97})` }, { transform: 'scale(1)' }], { duration: ms });
    await sleep(ms);
  }
  oldImg.style.opacity = 0;
  newImg.style.opacity = 1;
  // Flash, then the new form in full colour.
  const flash = document.createElement('div');
  flash.className = 'afx flash';
  document.body.append(flash);
  flash.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: 520, fill: 'forwards' });
  setTimeout(() => flash.remove(), 540);
  await sleep(130);
  ov.classList.remove('glowing');
  ov.classList.add('revealed');
  card.animate([{ transform: 'scale(1.15)' }, { transform: 'scale(.97)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 480, easing: 'cubic-bezier(.3,.7,.4,1.4)' });
  stamp({ left: innerWidth / 2 - 10, top: innerHeight / 2 + h * 0.36, width: 20, height: 40 }, `${esc(to.name)}!`, 'evolve-stamp', { dur: 1500 });
  await sleep(1100);
  // Back to its spot on the mat (the engine then re-renders it as the evolved card).
  ov.querySelector('.ev-rays').style.opacity = 0;
  ov.animate([{ background: 'rgba(3,7,20,.82)' }, { background: 'rgba(3,7,20,0)' }], { duration: 420, fill: 'forwards' });
  const back = document.querySelector(`[data-mon="${mon}"] .top-card`)?.getBoundingClientRect() || home;
  await moveTo(card, back, 420);
  ov.remove();
  document.body.classList.remove('arena-on');
  const s2 = document.querySelector(`[data-mon="${mon}"] .top-card`);
  if (s2) s2.style.visibility = '';
}

// ---------------- Playing cards from the hand ----------------
// Benching: the card flies from the hand into its new Bench slot (Gary's turns face up on the way).
function onBench({ p, card }) {
  if (!animOn()) return;
  const from = p === 0 ? document.querySelector(`#hand [data-card="${card.uid}"]`) : document.querySelector('#opp-hand .ocard:last-child img');
  if (!from) return;
  arrivingCards.add(card.uid);
  if (p === 0) from.style.visibility = 'hidden';
  // Until the engine re-renders, the new Bench slot doesn't exist yet; the flight retargets as soon as it does.
  track(fly(from, () => document.querySelector(`[data-cuid="${card.uid}"]`) || from, { front: card.img, faceUp: p === 0 }).then(() => reveal(card.uid)));
}

// Gary's Trainer cards: the card flips face up at centre stage with what it does, then goes to the discard pile.
async function onTrainer({ p, card, label }) {
  if (p !== 1 || !animOn()) return;
  inspect(null);
  const from = document.querySelector('#opp-hand .ocard:last-child img');
  const k = card.stadium || card.tkind;
  const ov = document.createElement('div');
  ov.className = 'trainer-stage';
  ov.innerHTML = `<div class="ts-row"><div class="ts-slot"><img src="${card.imgLarge || card.img}" alt=""></div>
    <div class="ts-text"><small>${icon(card.stadium ? 'landmark' : 'backpack')} ${esc(t('ui.oppTrainer', { P: { $pl: 1 } }))}</small>
      <b>${esc(cardName(card))}</b>${label.params?.m ? `<em>${icon('arrow-right')} ${esc(label.params.m)}</em>` : ''}<p>${esc(t('tr.' + k + '.what'))}</p></div></div>`;
  document.body.append(ov);
  const slot = ov.querySelector('.ts-slot');
  ov.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, fill: 'forwards' });
  if (from) await fly(from, slot, { front: card.img });
  slot.classList.add('shown');
  ov.classList.add('revealed');
  // Stay long enough to read; a click moves on sooner.
  await Promise.race([sleep(2600), new Promise((r) => ov.addEventListener('pointerdown', r, { once: true }))]);
  const pile = document.querySelector('#opp-piles [data-pile="discard"]');
  ov.classList.add('leaving');
  if (pile && !card.stadium && !['plusPower', 'defender'].includes(card.tkind)) {
    slot.style.visibility = 'hidden';
    const done = fly(slot, pile, { front: card.img, faceUp: true });
    ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    await done;
  } else {
    // A hidden page pauses animations, so never wait on one forever (the game would stop until you come back).
    const fade = ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    await Promise.race([fade.finished, sleep(450)]);
  }
  ov.remove();
}

// ---------------- Attaching cards ----------------
// Card animations still playing; Gary waits for them before his next move so a re-render can't cut them off.
const pendingAnims = new Set();
const track = (promise) => { pendingAnims.add(promise); promise.finally(() => pendingAnims.delete(promise)); return promise; };

async function onAttach({ p, mon, card }) {
  if (!animOn()) return;
  const dropped = p === 0 && lastDrop && Date.now() - lastDrop.at < 1500 ? lastDrop.rect : null;
  lastDrop = null;
  const handCard = p === 0 ? document.querySelector(`#hand [data-card="${card.uid}"]`) : document.querySelector('#opp-hand .ocard:last-child img');
  // A card you just dragged starts its flight where you released it, not back in the hand.
  const from = dropped ? { getBoundingClientRect: () => dropped } : handCard;
  const monEl = document.querySelector(`[data-mon="${mon}"]`);
  if (!from || !monEl) return;
  arrivingCards.add(card.uid);
  if (p === 0 && handCard) handCard.style.visibility = 'hidden';
  // Phase 1: fly to just past the Pokémon on the side where the tucked strip shows (below on your side,
  // above on Gary's), so the flying card never covers the Pokémon.
  const dir = p === 0 ? 1 : -1;
  const cardH = monEl.querySelector('.top-card')?.offsetHeight || 120;
  const approach = dir * cardH * 0.85;
  const tucked = () => document.querySelector(`[data-cuid="${card.uid}"]`);
  track(fly(from, () => tucked() || monEl.querySelector('.top-card'), { front: card.img, offsetY: approach }).then(() => {
    // Phase 2: hand over to the real tucked card, which sits behind the Pokémon: the Pokémon lifts a little,
    // the card slides in underneath, then the Pokémon settles back and closes over it.
    const tk = tucked();
    const top = document.querySelector(`[data-mon="${mon}"] .top-card`);
    reveal(card.uid);
    if (!tk) return;
    const base = getComputedStyle(tk).transform;
    const baseT = base === 'none' ? '' : base;
    tk.animate([
      { transform: `${baseT} translateY(${approach}px)`, offset: 0 },
      { transform: `${baseT} translateY(${approach * 0.35}px)`, offset: 0.45, easing: 'cubic-bezier(.3,.6,.3,1)' },
      { transform: baseT || 'none', offset: 1 },
    ], { duration: 520, easing: 'cubic-bezier(.4,0,.2,1)' });
    top?.animate([
      { transform: 'none' },
      { transform: `translateY(${-dir * 7}px) rotate(${dir * -1.2}deg)`, offset: 0.35, easing: 'ease-out' },
      { transform: `translateY(${-dir * 7}px) rotate(${dir * -1.2}deg)`, offset: 0.6, easing: 'ease-in' },
      { transform: `translateY(${dir * 1.5}px)`, offset: 0.88 },
      { transform: 'none' },
    ], { duration: 560 });
    return sleep(580);
  }));
  await sleep(80); // let the flight start from the hand before the hand re-renders
}

// ---------------- Decision engine (Settings) ----------------
// The server owns the engine choice and the local model process; the page polls its state.
let engine = null;
let enginePoll = null;
const GB = (b) => (b / 1e9).toFixed(1);

function engineLabel(e = engine) {
  if (!e) return '…';
  if (e.engine === 'cpu') return t('eng.badge.cpu');
  if (e.engine === 'jev') return t(online() ? 'eng.badge.jev' : 'eng.badge.offline');
  const m = e.models.find((x) => x.id === e.model);
  if (e.local.status === 'ready') return t('eng.badge.local', { m: m?.name });
  return t('eng.badge.loading', { m: m?.name, s: engineStatusText(e) });
}

function engineStatusText(e = engine) {
  const L = e.local;
  if (L.status === 'downloading' && L.totalBytes) return t('eng.status.downloading', { p: `${Math.min(100, Math.round((100 * L.downloadedBytes) / L.totalBytes))}%` });
  if (L.status === 'downloading') return t('eng.status.downloading', { p: `${GB(L.downloadedBytes)} GB` });
  return t('eng.status.' + L.status, { e: L.error });
}

function applyEngine(e) {
  engine = e;
  // Gary uses the model only once it is ready; until then the CPU engine plays.
  // Jev is hosted: offline, the CPU engine plays until the connection is back (local models work offline).
  const usable = e.engine === 'jev' ? e.jevKeySet && online() : e.engine === 'local' ? e.local.status === 'ready' : false;
  aiConfig.engine = usable ? 'model' : 'cpu';
  $('#engine-badge').textContent = engineLabel(e);
  $('#engine-badge').classList.toggle('busy', e.engine === 'local' && e.local.status !== 'ready');
  const m = e.models.find((x) => x.id === e.model);
  const host = $('#start-engine');
  if (!host.querySelector('#start-engine-change')) {
    host.innerHTML = '<small></small><span><b></b> <button class="linkish" id="start-engine-change"></button></span>';
    $('#start-engine-change').onclick = openSettings;
  }
  host.querySelector('small').textContent = t('ui.engineLabel');
  host.querySelector('b').textContent = engineLabel(e);
  $('#start-engine-change').textContent = t('ui.change');
  if (!$('#settings').hidden) renderEngineBox();
  const busy = e.engine === 'local' && ['installing', 'downloading', 'starting'].includes(e.local.status);
  clearTimeout(enginePoll);
  enginePoll = setTimeout(refreshEngine, busy || !$('#settings').hidden ? 1500 : 15000);
}

async function refreshEngine() {
  try { applyEngine(await (await api('/api/engine')).json()); }
  catch { clearTimeout(enginePoll); enginePoll = setTimeout(refreshEngine, 5000); }
}

async function setEngine(body) {
  const r = await api('/api/engine', { method: 'POST', body });
  applyEngine(await r.json());
}

// The engine section of Settings: one engine picked from three words, and only that engine's details below it
// (its key, or the local models as a plain list). Re-rendered while Settings is open (download progress), so a key
// being typed survives, and nothing is redrawn when nothing changed.
let engineBoxHtml = '';
function renderEngineBox() {
  if (!engine) return;
  const e = engine;
  // No internet: Jev can't be chosen. The web version has only the CPU engine; the others come with the macOS app.
  const off = (id) => (webOnly && id !== 'cpu') || (id === 'jev' && !online());
  const split = (s) => { const m = s.match(/^(.*?)\s*[（(](.*)[)）]\s*$/); return m ? [m[1], m[2]] : [s, '']; }; // "CPU (built in)" → name, note
  const tabs = ['cpu', 'jev', 'local'].map((id) => {
    const [name, printed] = split(t(`eng.${id}.t`));
    const note = webOnly && id !== 'cpu' ? t('eng.web.tab') : printed;
    const on = e.engine === id;
    return `<label class="eng-tab${on ? ' on' : ''}${off(id) ? ' off' : ''}"><input type="radio" name="engine" value="${id}" ${on ? 'checked' : ''} ${off(id) ? 'disabled' : ''}>
      <b>${esc(name)}</b>${note ? `<small>${esc(note)}</small>` : ''}</label>`;
  }).join('');
  const desc = t(e.engine !== 'cpu' ? `eng.${e.engine}.d` : inApp ? 'eng.cpu.dApp' : webOnly ? 'eng.cpu.dWeb' : 'eng.cpu.d');
  const notes = [
    !webOnly && !online() && t('eng.offline'),
    e.engine !== 'cpu' && aiConfig.engine === 'cpu' && (e.engine !== 'jev' || (online() && e.jevKeySet)) && t('eng.fallbackNote', { m: engineLabel(e) }),
  ].filter(Boolean).map((n) => `<p class="eng-warn">${esc(n)}</p>`).join('');

  let body = '';
  if (e.engine === 'jev' && online()) {
    body = `<div class="key-row">
        <input type="password" id="jev-key" placeholder="${esc(t('eng.jev.key'))}" aria-label="${esc(t('eng.jev.key'))}" autocomplete="off" spellcheck="false">
        <button type="button" class="primary" id="jev-save">${esc(t('eng.jev.save'))}</button></div>
      <p class="eng-small">${esc(t(e.jevKeySet ? (inApp ? 'eng.jev.savedApp' : 'eng.jev.saved') : 'eng.jev.missing'))}</p>`;
  }
  if (e.engine === 'local') {
    const rows = e.models.map((m) => {
      const active = e.model === m.id;
      const running = e.local.model === m.id;
      const busy = running && ['downloading', 'starting', 'installing'].includes(e.local.status);
      const pctDone = e.local.status === 'starting' ? 100 : running && e.local.totalBytes ? Math.min(100, (100 * e.local.downloadedBytes) / e.local.totalBytes) : 0;
      const status = running ? engineStatusText(e) : t(m.installed ? 'eng.installed' : 'eng.notInstalled');
      const inUse = active && running;
      const side = inUse
        ? `<span class="m-state${e.local.status === 'ready' ? ' ok' : ''}">${esc(e.local.status === 'ready' ? t('eng.active') : status)}</span>`
        : `<button type="button" class="m-act" data-model="${m.id}">${esc(t(m.installed ? 'eng.use' : 'eng.download'))}</button>`;
      const meta = [
        m.accuracy && t('eng.acc', { a: `${Math.round(m.accuracy * 100)}%` }),
        t('eng.speed.' + m.speed),
        m.size && `${GB(m.size)} GB`,
        !inUse && status,
      ].filter(Boolean).map(esc).join(' · ');
      return `<li class="m-row${inUse ? ' on' : ''}">
        <div class="m-head"><b>${esc(m.name)}</b>${m.recommended ? `<em>${esc(t('eng.recommended'))}</em>` : ''}<span class="m-meta">${meta}</span></div>
        <div class="m-side">${side}</div>
        <p>${esc(t('model.' + m.id))}</p>
        ${busy ? `<div class="m-bar"><i style="width:${pctDone}%"></i></div>` : ''}
        ${running && e.local.status === 'error' ? `<p class="m-err">${esc(e.local.error)}</p>` : ''}
      </li>`;
    }).join('');
    body = `<ul class="m-list">${rows}</ul>${e.local.model ? `<button type="button" class="textlink m-stop" id="local-stop">${esc(t('eng.stop'))}</button>` : ''}`;
  }

  if (webOnly) {
    body = `<p class="eng-mac">${esc(t('eng.web.note'))}</p>
      <a class="eng-mac-link" href="${MAC_DOWNLOAD}" target="_top">${esc(t('eng.web.download'))}</a>`;
  }
  const html = `<div class="eng-tabs" role="radiogroup" aria-labelledby="eng-title">${tabs}</div>
    <p class="eng-desc">${esc(desc)}</p>${notes}${body}`;
  if (html === engineBoxHtml) return;
  engineBoxHtml = html;
  const box = $('#engine-box');
  const key = $('#jev-key');
  const keep = key && { value: key.value, focused: document.activeElement === key };
  const focusedEngine = document.activeElement?.name === 'engine' && document.activeElement.value;
  box.innerHTML = html;
  if (keep && $('#jev-key')) { $('#jev-key').value = keep.value; if (keep.focused) $('#jev-key').focus(); }
  if (focusedEngine) box.querySelector(`input[name="engine"][value="${focusedEngine}"]`)?.focus();

  box.querySelectorAll('input[name="engine"]').forEach((r) => (r.onchange = () => setEngine({ engine: r.value })));
  box.querySelectorAll('[data-model]').forEach((b) => (b.onclick = () => setEngine({ engine: 'local', model: b.dataset.model })));
  const save = () => {
    const k = $('#jev-key').value.trim();
    if (k) setEngine({ engine: 'jev', jevKey: k });
  };
  if ($('#jev-save')) {
    $('#jev-save').onclick = save;
    $('#jev-key').onkeydown = (ev) => { if (ev.key === 'Enter') save(); };
  }
  const stop = $('#local-stop');
  if (stop) stop.onclick = () => api('/api/engine/stop', { method: 'POST' }).then((r) => r.json()).then(applyEngine);
}

// Going on- or offline changes what Gary can think with (Jev needs the internet).
for (const ev of ['online', 'offline']) window.addEventListener(ev, () => { if (engine) applyEngine(engine); });

function openSettings() {
  if ($('#settings').hidden) settingsFrom = document.activeElement;
  $('#settings').hidden = false;
  $('#settings .dialog').focus();
  engineBoxHtml = '';
  renderEngineBox();
  refreshEngine();
}

// ---------------- Drag and drop from the hand ----------------
// Picking up a hand card highlights only where it can legally go (from the current list of legal moves);
// dropping it there makes that move, exactly like clicking the move's button.
let drag = null;

function dropZones(card) {
  const acts = decision.actions.filter((a) => a.card && a.card.name === card.name && a.card.kind === card.kind);
  const zones = new Map();
  const add = (el, a) => { if (!el) return; if (!zones.has(el)) zones.set(el, []); zones.get(el).push(a); };
  for (const a of acts) {
    if (a.target) {
      const el = document.querySelector(`[data-mon="${a.target.id}"]`);
      if (el && a.kind === 'energy' && isOffType(a)) el.classList.add('drop-weak');
      add(el, a);
    }
    else if (a.kind === 'bench') add($('#you-bench'), a);
    else if (a.tkind === 'plusPower') add(document.querySelector('#you-active .mon'), a);
    else add(playZone(card), a);
  }
  return [...zones].map(([el, actions]) => ({ el, actions }));
}

function playZone(card) {
  let z = $('#play-zone');
  if (!z) {
    z = document.createElement('div');
    z.id = 'play-zone';
    $('#board').append(z);
  }
  z.innerHTML = `${icon('circle-plus')} ${esc(t('drag.play', { c: { $card: card } }))}`;
  z.hidden = false;
  return z;
}

function startDrag(e) {
  const { el, card } = drag;
  drag.started = true;
  drag.zones = dropZones(card);
  inspect(null);
  document.body.classList.add('dragging');
  el.classList.add('drag-src');
  drag.zones.forEach((z) => z.el.classList.add('drop-ok'));
  const g = document.createElement('div');
  g.className = 'drag-ghost' + (drag.zones.length ? '' : ' no');
  const why = drag.zones.length ? '' : `<div class="why">${icon('lightbulb')} ${esc(t(...whyNot(card, game.players[0])))}</div>`;
  g.innerHTML = `<img src="${card.img}" alt="">${why}`;
  document.body.append(g);
  drag.ghost = g;
  moveDrag(e);
  // Pick-up: start exactly where the card sits in the fan (its rotation and hover scale), then ease to the pointer.
  const src = el.querySelector('img').getBoundingClientRect();
  const dx = src.left + src.width / 2 - e.clientX, dy = src.top + src.height / 2 - e.clientY;
  const gw = g.offsetWidth, gh = g.offsetHeight;
  const rot0 = parseFloat(el.style.getPropertyValue('--rot')) || 0;
  // The ghost's resting transform is translate(-50%, -60%): convert the card centre into that frame.
  const ox = dx, oy = dy + gh * 0.1;
  g.animate([
    { transform: `translate(calc(-50% + ${ox}px), calc(-60% + ${oy}px)) rotate(${rot0}deg) scale(${src.width / gw})` },
    { transform: 'translate(-50%, -60%) rotate(-5deg) scale(1.08)' },
  ], { duration: 180, easing: 'cubic-bezier(.2,.7,.3,1)' });
}

function moveDrag(e) {
  const g = drag.ghost;
  g.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0) translate(-50%, -60%) rotate(-5deg) scale(1.08)`; // compositor only
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  const zone = hit && drag.zones.find((z) => z.el.contains(hit));
  drag.zones.forEach((z) => z.el.classList.toggle('drop-hover', z === zone));
  drag.over = zone || null;
}

// Where the last dropped card was released, so an attach flight can start from there instead of the hand.
let lastDrop = null;

function endDrag(cancel = false) {
  const d = drag;
  drag = null;
  if (!d?.started) return;
  document.body.classList.remove('dragging');
  d.zones.forEach((z) => z.el.classList.remove('drop-ok', 'drop-hover', 'drop-weak'));
  const pz = $('#play-zone');
  const g = d.ghost;
  const placed = !cancel && d.over && decision;
  if (!placed) {
    // Glide back to its place in the fan.
    const home = d.el.querySelector('img').getBoundingClientRect();
    const r = g.getBoundingClientRect();
    const rot = parseFloat(d.el.style.getPropertyValue('--rot')) || 0;
    const tx = home.left + home.width / 2 - (r.left + r.width / 2), ty = home.top + home.height / 2 - (r.top + r.height / 2);
    g.animate([
      { transform: 'translate(-50%, -60%) rotate(-5deg) scale(1.08)' },
      { transform: `translate(calc(-50% + ${tx}px), calc(-60% + ${ty}px)) rotate(${rot}deg) scale(${home.width / g.offsetWidth})` },
    ], { duration: 220, easing: 'cubic-bezier(.3,.6,.3,1)', fill: 'forwards' });
    setTimeout(() => { g.remove(); d.el.classList.remove('drag-src'); if (pz) pz.hidden = true; }, 220);
    return;
  }
  const acts = d.over.actions;
  const attaches = acts.length === 1 && (acts[0].kind === 'energy' || acts[0].tkind === 'plusPower' || acts[0].tkind === 'defender');
  if (attaches) {
    lastDrop = { rect: g.querySelector('img').getBoundingClientRect(), at: Date.now() };
    g.remove();
  } else {
    // Settle into the drop zone and fade.
    const z = d.over.el.getBoundingClientRect(), r = g.getBoundingClientRect();
    const tx = z.left + z.width / 2 - (r.left + r.width / 2), ty = z.top + z.height / 2 - (r.top + r.height / 2);
    g.animate([
      { transform: 'translate(-50%, -60%) rotate(-5deg) scale(1.08)', opacity: 1 },
      { transform: `translate(calc(-50% + ${tx}px), calc(-60% + ${ty}px)) rotate(0deg) scale(.85)`, opacity: 0 },
    ], { duration: 200, easing: 'ease-in', fill: 'forwards' });
    setTimeout(() => g.remove(), 200);
  }
  d.el.classList.remove('drag-src');
  if (pz) pz.hidden = true;
  if (acts.length === 1) decision.pick(acts[0]);
  else chooseFromMenu(acts, d.lastX, d.lastY); // e.g. Energy Removal on a Pokémon with two Energy types
}

function chooseFromMenu(actions, x, y) {
  const m = document.createElement('div');
  m.className = 'drop-menu';
  m.innerHTML = `<div class="dm-title">${esc(t('drag.choose'))}</div>` +
    actions.map((a, i) => `<button data-i="${i}">${esc(t(a.label.key, a.label.params))}</button>`).join('');
  Object.assign(m.style, { left: `${Math.min(x, innerWidth - 280)}px`, top: `${Math.min(y, innerHeight - 60 - 40 * actions.length)}px` });
  document.body.append(m);
  const close = () => { m.remove(); document.removeEventListener('pointerdown', outside, true); };
  const outside = (ev) => { if (!m.contains(ev.target)) close(); };
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  m.querySelectorAll('button').forEach((b) => (b.onclick = () => { close(); decision?.pick(actions[Number(b.dataset.i)]); }));
}

document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('#hand .hcard');
  if (!el || !decision || e.button !== 0) return;
  const card = inspectables.get('c' + el.dataset.card);
  if (!card) return;
  e.preventDefault();
  drag = { el, card, x0: e.clientX, y0: e.clientY, started: false };
});
document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  drag.lastX = e.clientX; drag.lastY = e.clientY;
  if (!drag.started && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 6) startDrag(e);
  else if (drag.started) moveDrag(e);
});
document.addEventListener('pointerup', () => endDrag());
document.addEventListener('pointercancel', () => endDrag(true));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') endDrag(true); });

// ---------------- Coin flips ----------------
const coinFace = (side) => (side === 'h'
  ? '<div class="face heads"><div class="pokeball"></div></div>'
  : `<div class="face tails">${icon('star')}</div>`);

// A coin built in CSS 3D: two faces and a ridged rim made of thin segments arranged in a circle.
const RIM_SEGMENTS = 36;
const coin3d = () => `<div class="coin-shadow"></div><div class="coin-toss"><div class="coin3d">
  ${coinFace('h')}${coinFace('t')}
  <div class="rim">${Array.from({ length: RIM_SEGMENTS }, (_, i) => `<span style="--a:${(360 / RIM_SEGMENTS) * i}deg"></span>`).join('')}</div>
</div></div>`;

// The coin stage: a dark vignette with a big 3D coin resting on a felt spot. Calling heads/tails and the toss
// itself use the same stage, so after you call, the very same coin is tossed.
let callStage = null; // stage element kept open between the call and the first toss

const miniFace = (side) => `<span class="mini-face ${side}">${coinFace(side)}</span>`;

function stageShell(title, sub) {
  const el = document.createElement('div');
  el.className = 'overlay coin-ov stage';
  el.innerHTML = `<div class="coin-stage">
    <div class="cs-title">${icon('coins')} <span>${esc(title)}</span></div>
    <div class="cs-sub">${esc(sub)}</div>
    <div class="cs-row">
      <div class="cs-side h"></div>
      <div class="coin-scene"><div class="rays"></div><div class="felt"></div>${coin3d()}</div>
      <div class="cs-side t"></div>
    </div>
    <div class="coin-result">&nbsp;</div>
    <div class="coin-tally"></div>
    <button class="cs-continue" hidden>${esc(t('ui.continue'))}</button>
  </div>`;
  document.body.append(el);
  return el;
}

function showCoin(ctx) {
  if (!$('#opt-anim').checked) { callStage?.remove(); callStage = null; return Promise.resolve(); }
  return new Promise((resolve) => {
    const title = t('coin.why.' + ctx.why, ctx.params);
    const sub = ctx.why === 'first' ? t('ui.youCalled', { c: ctx.params.call }) : t('ui.coinSub');
    let el = callStage;
    callStage = null;
    if (el) {
      el.querySelector('.cs-title span').textContent = title;
      el.querySelector('.cs-sub').textContent = sub;
      el.classList.remove('calling');
    } else el = stageShell(title, sub);
    const side = (o, cls, label) => (o
      ? `${miniFace(cls)}<div class="cs-label">${esc(label)}</div><div class="cs-out">${esc(t(o.key, o.params))}</div>`
      : `${miniFace(cls)}<div class="cs-label">${esc(label)}</div>`);
    el.querySelector('.cs-side.h').innerHTML = side(ctx.heads, 'h', t('ui.heads'));
    el.querySelector('.cs-side.t').innerHTML = side(ctx.tails, 't', t('ui.tails'));
    el.querySelectorAll('.cs-side').forEach((s) => s.classList.remove('win', 'lose', 'pick'));
    const btn = el.querySelector('.cs-continue');
    let done = false;
    const finish = () => { if (done) return; done = true; el.classList.add('closing'); setTimeout(() => el.remove(), 220); resolve(); };

    // Toss: up and down under gravity, tumbling end over end, then a small bounce and wobble on landing.
    const end = 360 * 6 + (ctx.h ? 0 : 180);
    const height = el.querySelector('.coin-scene').offsetHeight * 0.9;
    const T = 1500;
    const coinEl = el.querySelector('.coin3d');
    coinEl.getAnimations().forEach((a) => a.cancel());
    coinEl.classList.add('spinning');
    el.querySelector('.coin-toss').animate([
      { transform: 'translateY(0)', easing: 'cubic-bezier(.2,.65,.45,1)' },
      { transform: `translateY(${-height}px)`, offset: 0.45, easing: 'cubic-bezier(.55,0,.8,.35)' },
      { transform: 'translateY(0)', offset: 0.86, easing: 'ease-out' },
      { transform: `translateY(${-height * 0.08}px)`, offset: 0.93, easing: 'ease-in' },
      { transform: 'translateY(0)' },
    ], { duration: T, fill: 'forwards' });
    coinEl.animate([
      { transform: 'rotateY(18deg) rotateX(0deg)', easing: 'cubic-bezier(.25,.6,.5,1)' },
      { transform: `rotateY(4deg) rotateX(${end - 8}deg)`, offset: 0.86 },
      { transform: `rotateY(-3deg) rotateX(${end + 6}deg)`, offset: 0.93 },
      { transform: `rotateY(0deg) rotateX(${end}deg)` },
    ], { duration: T, fill: 'forwards' });
    el.querySelector('.coin-shadow').animate([
      { transform: 'translateX(-50%) scale(1)', opacity: 0.55 },
      { transform: 'translateX(-50%) scale(.4)', opacity: 0.15, offset: 0.45 },
      { transform: 'translateX(-50%) scale(1)', opacity: 0.55, offset: 0.86 },
      { transform: 'translateX(-50%) scale(.9)', opacity: 0.45, offset: 0.93 },
      { transform: 'translateX(-50%) scale(1)', opacity: 0.55 },
    ], { duration: T, fill: 'forwards' });
    setTimeout(() => coinEl.classList.remove('spinning'), T * 0.86);
    setTimeout(() => {
      el.classList.add('landed', ctx.h ? 'is-h' : 'is-t');
      const res = el.querySelector('.coin-result');
      res.textContent = t('ui.result', { h: t(ctx.h ? 'ui.heads' : 'ui.tails') });
      res.classList.add(ctx.h ? 'h' : 't');
      el.querySelector(`.cs-side.${ctx.h ? 'h' : 't'}`).classList.add('win');
      el.querySelector(`.cs-side.${ctx.h ? 't' : 'h'}`).classList.add('lose');
      if (ctx.why === 'multi') el.querySelector('.coin-tally').textContent = t('ui.headsSoFar', { n: ctx.params.so + (ctx.h ? 1 : 0) });
      btn.hidden = false;
      btn.onclick = finish;
      el.onclick = (e) => { if (e.target === el) finish(); };
      setTimeout(finish, 2400);
    }, 1550);
  });
}

// Before the game: call heads or tails on the same stage (H / T keys work too).
function callCoinStage() {
  return new Promise((resolve) => {
    const el = stageShell(t('ui.callIt'), t('ui.callText'));
    el.classList.add('calling');
    const pick = (call) => {
      if (!el.isConnected || !el.classList.contains('calling')) return;
      document.removeEventListener('keydown', onKey);
      el.querySelector(`.cs-side.${call === 'heads' ? 'h' : 't'}`).classList.add('pick');
      el.classList.remove('calling');
      callStage = el;
      resolve(call);
    };
    const onKey = (e) => { if (e.key === 'h' || e.key === 'H') pick('heads'); if (e.key === 't' || e.key === 'T') pick('tails'); };
    document.addEventListener('keydown', onKey);
    for (const [cls, call, label] of [['h', 'heads', t('ui.heads')], ['t', 'tails', t('ui.tails')]]) {
      const s = el.querySelector(`.cs-side.${cls}`);
      s.innerHTML = `<button class="call-btn" data-call="${call}">${miniFace(cls)}<span class="cs-label">${esc(label)}</span><span class="cs-key">${call === 'heads' ? 'H' : 'T'}</span></button>`;
      s.querySelector('button').onclick = () => pick(call);
    }
  });
}

function prizesHtml(p) {
  const slots = Array.from({ length: PRIZES }, (_, i) => (i < p.prizes.length ? backImg() : '<div class="slot"></div>')).join('');
  return `${slots}<div class="cap">${esc(t('ui.prizes'))}: ${p.prizes.length}</div>`;
}

function pilesHtml(p) {
  const top = p.discard.at(-1);
  if (top) inspectables.set('d' + p.idx, top);
  // Seen from above: the top card back, a few slightly misaligned cards peeking out from under it,
  // and a shadow that grows with the number of cards left (a thicker deck casts a bigger shadow).
  const under = p.deck.length > 1 ? Math.min(4, 1 + Math.floor(p.deck.length / 15)) : 0;
  const jitter = (i, k) => (Math.sin((p.idx + 1) * 12.9898 + i * 78.233 + k * 37.719) * 43758.5453) % 1;
  const deck = p.deck.length
    ? `<div class="stack deck" style="--sh:${(2 + p.deck.length / 6).toFixed(1)}">${Array.from({ length: under }, (_, i) =>
        `<img class="under" src="${CARD_BACK}" alt="" draggable="false" style="transform: translate(${(jitter(i, 1) * 2.2).toFixed(2)}px, ${(jitter(i, 2) * 2.2).toFixed(2)}px) rotate(${(jitter(i, 3) * 2.6).toFixed(2)}deg)">`).join('')}<img class="top" src="${CARD_BACK}" alt="" draggable="false"></div>`
    : '<div class="empty"></div>';
  const tilt = (c) => ((c.uid * 37) % 15) - 7;
  const discard = top
    ? `<div class="stack discard" data-inspect="d${p.idx}">${p.discard.slice(-3).map((c) =>
        `<img src="${c.img}" alt="" style="transform: rotate(${tilt(c)}deg)">`).join('')}</div>`
    : '<div class="empty"></div>';
  return `<div class="pile" data-pile="deck">${deck}<span class="count">${p.deck.length}</span><div>${esc(t('ui.deck'))}</div></div>
    <div class="pile" data-pile="discard">${discard}<span class="count">${p.discard.length}</span><div>${esc(t('ui.discard'))}</div></div>`;
}

// ---------------- Hand layout and draw animation ----------------
let seenHand = new Set();          // your hand card uids at the last render
let seenPrizes = [new Set(), new Set()];
let seenOppHand = 0;
let animateDraws = false;          // off while restoring a saved game
const arrivingCards = new Set();   // uids still flying into your hand

// Overlap hand cards when they don't fit, instead of scrolling.
function layoutHand() {
  const hand = $('#hand');
  const cards = [...hand.children];
  if (!cards.length) return;
  // Measuring forces a style pass, so setting margin/rotation afterwards would otherwise *transition*
  // every card from 0 into place on each re-render. Lay out instantly; re-enable transitions next frame.
  hand.classList.add('instant');
  requestAnimationFrame(() => requestAnimationFrame(() => hand.classList.remove('instant')));
  const w = cards[0].getBoundingClientRect().width;
  const avail = hand.clientWidth;
  const gap = 8;
  const step = cards.length > 1 ? Math.min(w + gap, (avail - w) / (cards.length - 1)) : 0;
  // Hold the cards in a gentle arc, like a real hand: each card rotates a little and the outer ones sit lower.
  const n = cards.length, mid = (n - 1) / 2, spread = Math.min(3.2, 26 / Math.max(n, 1));
  cards.forEach((el, i) => {
    el.style.marginLeft = i ? `${step - w}px` : '0';
    el.style.zIndex = i;
    const off = i - mid;
    el.style.setProperty('--rot', `${(off * spread).toFixed(2)}deg`);
    el.style.setProperty('--lift', `${(off * off * 0.9).toFixed(1)}px`);
  });
}
window.addEventListener('resize', layoutHand);

// The largest card-shaped box (5:7) centred in a rect, so flights never distort the card image.
function cardBox(r) {
  const ratio = 1.396;
  let w = r.width, h = r.width * ratio;
  if (h > r.height && r.height > 0) { h = r.height; w = h / ratio; }
  return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
}

// A card flies from `from` to `to`. Your cards turn face up on the way; the opponent's stay face down.
// The un-rotated box of an element (its layout size around its on-screen centre), for rotated hand cards.
function layoutBox(el) {
  const r = el.getBoundingClientRect();
  if (!el.offsetWidth) return cardBox(r);
  const w = el.offsetWidth, h = el.offsetHeight, cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  return cardBox({ left: cx - w / 2, top: cy - h / 2, width: w, height: h });
}

// A card flies from `from` to `to` (an element, or a function returning the current target element).
// The flight is driven frame by frame and re-reads the target's position every frame, so if the hand
// re-arranges while the card is in the air (another card played, a card added), it still lands exactly
// on its card. Your cards flip face up on the way; Gary's stay face down.
function fly(from, to, { front = null, delay = 0, rot = 0, offsetY = 0, faceUp = false, spin = 0 } = {}) {
  const getTarget = typeof to === 'function' ? to : () => to;
  let tEl = getTarget();
  if (!from || !tEl) return Promise.resolve();
  const a = cardBox(from.getBoundingClientRect());
  let b = layoutBox(tEl);
  const w = b.width, h = b.height;
  const el = document.createElement('div');
  el.className = 'fly';
  Object.assign(el.style, { left: '0px', top: '0px', width: `${w}px`, height: `${h}px`, transformOrigin: '50% 50%', visibility: 'hidden' });
  el.innerHTML = `<div class="fly-inner ${front ? '' : 'back-only'}">${front ? `<img class="ff" src="${front}" alt="">` : ''}<img class="fb" src="${CARD_BACK}" alt=""></div>`;
  document.body.append(el);
  const inner = el.firstChild;
  const D = 760, s0 = a.width / w;
  const A = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
  const t0 = performance.now() + delay;
  const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; el.remove(); resolve(); };
    const frame = (now) => {
      if (done) return;
      const p = Math.min(1, Math.max(0, (now - t0) / D));
      const cur = getTarget();
      if (cur?.isConnected) { tEl = cur; b = layoutBox(cur); }
      const rotEnd = parseFloat(tEl?.style?.getPropertyValue('--rot')) || rot;
      const B = { x: b.left + b.width / 2, y: b.top + b.height / 2 + offsetY };
      const e = ease(p), arc = Math.sin(Math.PI * e);
      const pickUp = p < 0.14 ? Math.sin((p / 0.14) * Math.PI / 2) : 1; // lifted off the pile first
      const lift = Math.min(70, 30 + Math.abs(B.x - A.x) * 0.08);
      const x = A.x + (B.x - A.x) * e;
      const y = A.y + (B.y - A.y) * e - lift * arc - 10 * pickUp * (1 - e);
      const scale = (s0 + (1 - s0) * e) * (1 + 0.08 * arc);
      const r = rotEnd * e - 7 * arc + spin * (1 - e);
      el.style.visibility = 'visible';
      el.style.transform = `translate(${x - w / 2}px, ${y - h / 2}px) rotate(${r}deg) scale(${scale})`;
      if (front && !faceUp) inner.style.transform = `rotateY(${p < 0.18 ? 180 : p > 0.7 ? 0 : 180 * (1 - (p - 0.18) / 0.52)}deg)`;
      if (p < 1) requestAnimationFrame(frame); else finish();
    };
    requestAnimationFrame(frame);
    // Safety net for background tabs, where animation frames are paused.
    setTimeout(finish, delay + D + 600);
  });
}

// Where a card currently is on screen: in your hand, or on the board (top of a Pokémon or tucked under one).
const cardEl = (uid) => document.querySelector(`#hand [data-card="${uid}"]`) || document.querySelector(`[data-cuid="${uid}"]`);
// Gary's cards still flying into his hand (by position in the fan, 1-based), hidden until they land.
const oppArriving = new Set();

function reveal(uid) {
  arrivingCards.delete(uid);
  document.querySelectorAll(`[data-card="${uid}"], [data-cuid="${uid}"]`).forEach((e) => e.classList.remove('arriving'));
}

function flyNewCards(you, opp, newCards) {
  const anim = animateDraws && $('#opt-anim').checked;
  if (anim) {
    newCards.forEach((c, i) => {
      arrivingCards.add(c.uid);
      const staged = prizeFrom?.uid === c.uid && prizeFrom.el.isConnected ? prizeFrom.el : null;
      const from = staged || (seenPrizes[0].has(c.uid) ? $('#you-prizes img') || $('#you-prizes') : $('#you-piles .deck img.top') || $('#you-piles [data-pile="deck"]'));
      const target = () => cardEl(c.uid);
      if (!from || !target()) { arrivingCards.delete(c.uid); return; }
      const stage = staged && prizeFrom.stage;
      fly(from, target, { front: c.img, delay: i * 120, faceUp: !!staged }).then(() => reveal(c.uid));
      if (stage) closePrizeStage(stage);
    });
    const extra = opp.hand.length - seenOppHand;
    const prizeTaken = seenPrizes[1].size > opp.prizes.length;
    for (let i = 0; i < Math.min(extra, 10); i++) {
      const k = seenOppHand + i + 1;
      oppArriving.add(k);
      document.querySelector(`#opp-hand .ocard:nth-child(${k})`)?.classList.add('arriving');
      const target = () => document.querySelector(`#opp-hand .ocard:nth-child(${k}) img`) || $('#opp-hand .ocard:last-child img');
      // Fly to just below Gary's hand, then the real card slides up into the fan, behind the board's top edge.
      const slide = (target()?.offsetHeight || 60) * 0.7;
      track(fly(prizeTaken ? $('#opp-prizes img') || $('#opp-prizes') : $('#opp-piles .deck img.top') || $('#opp-piles [data-pile="deck"]'),
        target, { delay: i * 120, offsetY: slide, spin: prizeTaken ? -360 : 0 }).then(() => {
        oppArriving.delete(k);
        const oc = document.querySelector(`#opp-hand .ocard:nth-child(${k})`);
        if (!oc) return;
        oc.classList.remove('arriving');
        const base = getComputedStyle(oc).transform;
        const b0 = base === 'none' ? '' : base;
        oc.animate([{ transform: `translateY(${slide}px) ${b0}` }, { transform: b0 || 'none' }], { duration: 320, easing: 'cubic-bezier(.3,.7,.3,1)' });
        return sleep(320);
      }));
    }
  } else {
    newCards.forEach((c) => arrivingCards.delete(c.uid));
    document.querySelectorAll('#hand .arriving').forEach((el) => el.classList.remove('arriving'));
  }
  seenHand = new Set(you.hand.map((c) => c.uid));
  seenPrizes = game.players.map((p) => new Set(p.prizes.map((c) => c.uid)));
  seenOppHand = opp.hand.length;
}

// A zone is rewritten only when its markup changed: unchanged cards keep their (decoded) images and nothing re-lays out.
function put(el, html) {
  if (el._html === html && el.childElementCount) return;
  el._html = html;
  el.innerHTML = html;
}

function render() {
  if (!game) return;
  inspectables = new Map();
  const [you, opp] = game.players;
  for (const [p, key] of [[you, 'you'], [opp, 'opp']]) {
    put($(`#${key}-prizes`), prizesHtml(p));
    put($(`#${key}-piles`), pilesHtml(p));
    put($(`#${key}-active`), p.active ? monTile(p.active, { active: true, owner: p }) : `<div class="empty-slot">${esc(t('ui.activeSpot'))}</div>`);
    const empty = Array.from({ length: 5 - p.bench.length }, () => `<div class="empty-slot">${esc(t('ui.bench'))}</div>`).join('');
    put($(`#${key}-bench`), p.bench.map((m) => monTile(m, { owner: p })).join('') + empty);
  }
  // the opponent's hand: card backs held upside down along the top edge, fanned like a real hand seen from across the table.
  const n = opp.hand.length, mid = (n - 1) / 2;
  $('#opp-hand').innerHTML = `<div class="ofan">${opp.hand.map((_, i) =>
    `<div class="ocard ${oppArriving.has(i + 1) ? 'arriving' : ''}" style=""--r:${((i - mid) * Math.min(4, 24 / Math.max(n, 1))).toFixed(2)}deg;--y:${(Math.abs(i - mid) * 1.5).toFixed(1)}px">${backImg()}</div>`).join('')}</div>
    <span class="ocount" title="${esc(t('ui.handCount'))}">${n}</span>`;

  const newCards = you.hand.filter((c) => !seenHand.has(c.uid));
  $('#hand').innerHTML = you.hand.map((c) => {
    inspectables.set('c' + c.uid, c);
    const arriving = arrivingCards.has(c.uid) || (animateDraws && newCards.includes(c)) ? 'arriving' : '';
    return `<div class="hcard ${arriving}" data-inspect="c${c.uid}" data-card="${c.uid}"><img src="${c.img}" alt="${esc(cardName(c))}" draggable="false"></div>`;
  }).join('');
  layoutHand();
  markPlayable();
  dropStalePreview();
  flyNewCards(you, opp, newCards);

  const cur = game.current;
  $('#turn-info').innerHTML = game.phase === 'setup' ? esc(t('ui.setup'))
    : game.winner ? esc(t('ui.gameOver'))
    : `${esc(t('ui.turn', { n: game.turn }))} · <span class="${cur.idx ? 'opp' : 'you'}">${esc(t(cur.idx ? 'ui.oppTurn' : 'ui.yourTurn'))}</span>${game.modern ? ` <span class="rules-chip" title="${esc(t('format.modern.note.plain'))}">${esc(t('ui.modernBadge'))}</span>` : ''}`;
  // The Stadium in play sits between the two players.
  const st = game.stadium?.card;
  if (st) inspectables.set('s' + st.uid, st);
  $('#stadium').hidden = !st;
  $('#stadium').innerHTML = st ? `<img src="${st.img}" alt="" data-inspect="s${st.uid}"><span><small>${icon('landmark')} ${esc(t('ui.stadium'))}</small><b data-inspect="s${st.uid}">${esc(st.name)}</b></span>` : '';
}

// Hovering a card shows a large floating preview next to it. It never takes space in the layout, so nothing jumps.
function inspect(card, reason = null, anchor = null) {
  const pv = $('#preview');
  previewAnchor = card ? anchor : null;
  if (!card) { pv.hidden = true; return; }
  // Hovering a Pokémon in play also explains its current state.
  const key = anchor?.dataset.inspect || '';
  const mon = key.startsWith('m') ? monById(Number(key.slice(1))) : null;
  const why = reason ? `<div class="why">${icon('lightbulb')} ${esc(t(reason[0], reason[1]))}</div>` : '';
  pv.innerHTML = `<img src="${card.imgLarge}" alt="${esc(cardName(card))}"><div class="explain">${why}${explainCard(card, mon)}</div>`;
  pv.hidden = false;
  if (anchor) placePreview(anchor);
}

// ---------------- Plain-language card explanations ----------------
// Built from how each card works in the engine, so the explanation always matches what the game does.
function costText(cost) {
  const counts = {};
  for (const c of cost) counts[c] = (counts[c] || 0) + 1;
  const parts = Object.entries(counts).filter(([k]) => k !== 'Colorless').map(([k, n]) => `${n} ${energyIcon(k)} ${esc(t('type.' + k))}`);
  if (counts.Colorless) parts.push(`${counts.Colorless} ${energyIcon('Colorless')} ${esc(t('ex.any'))}`);
  return parts.join(' + ');
}

// What still has to be attached before an attack can be used.
function missingEnergy(have, cost) {
  const pool = [...have], missing = [];
  for (const c of cost.filter((x) => x !== 'Colorless')) {
    const i = pool.indexOf(c);
    if (i >= 0) pool.splice(i, 1); else missing.push(c);
  }
  const anyNeeded = cost.filter((x) => x === 'Colorless').length - pool.length;
  for (let i = 0; i < anyNeeded; i++) missing.push('Colorless');
  return missing;
}

const stx = (s) => [].concat(s).map((x) => `<b>${esc(t('st.' + x))}</b> <span class="muted">${esc(t('stx.' + x))}</span>`).join(' + ');

function attackEffects(atk, owner) {
  const fx = atk.fx, out = [];
  if (fx.lure) out.push(t('fx.lure'));
  if (fx.needsDefAsleep) out.push(t('fx.needsDefAsleep'));
  if (fx.flipFail) out.push(t('fx.flipFail'));
  if (fx.flipMulti) out.push(t('fx.flipMulti', { n: fx.flipMulti, per: atk.base, max: atk.base * fx.flipMulti }));
  if (fx.plusDefEnergy) out.push(t('fx.plusDefEnergy'));
  if (fx.plusDefCounters) out.push(t('fx.plusDefCounters'));
  if (fx.minusSelfCounters) out.push(t('fx.minusSelfCounters'));
  if (fx.timesSelfCounters) out.push(fx.timesSelfCounters === 10 ? t('fx.timesSelfCounters') : t('fx.timesSelfCountersN', { n: fx.timesSelfCounters }));
  if (fx.status) out.push(t('fx.status', { s: '\u0000' }).replace('\u0000', stx(fx.status)));
  if (fx.flipStatus) out.push(t('fx.flipStatus', { s: '\u0000' }).replace('\u0000', stx(fx.flipStatus)));
  if (fx.discard) out.push(fx.discard.type ? t('fx.discard', { n: fx.discard.n, t: { $type: fx.discard.type } }) : t('fx.discardAny', { n: fx.discard.n }));
  if (fx.selfDamage) out.push(t('fx.selfDamage', { n: fx.selfDamage }));
  if (fx.flipSelfDamage) out.push(t('fx.flipSelfDamage', { n: fx.flipSelfDamage }));
  if (fx.healAll) out.push(t('fx.healAll'));
  if (fx.healIfDamage) out.push(t('fx.healIfDamage'));
  if (fx.shield === 'all') out.push(t('fx.shieldAll'));
  if (fx.shield === 'harden') out.push(t('fx.harden'));
  if (fx.shield === 'basic') out.push(t('fx.shieldBasic'));
  if (fx.flipShield) out.push(t(fx.flipShield === 'all' ? 'fx.flipShieldAll' : 'fx.flipShield'));
  if (fx.benchAll) out.push(t('fx.benchAll', { n: fx.benchAll }));
  if (fx.oncePerPlay) out.push(t('fx.oncePerPlay'));
  if (fx.destinyBond) out.push(t('fx.destinyBond'));
  if (fx.sandAttack) out.push(t('fx.sandAttack'));
  if (fx.whirlwind) out.push(t('fx.whirlwind'));
  if (fx.mirrorMove) out.push(t('fx.mirrorMove'));
  if (fx.drainHalf) out.push(t('fx.drainHalf'));
  if (fx.benchSnipe) out.push(t(fx.benchSnipe.flip ? 'fx.benchSnipeFlip' : 'fx.benchSnipe', { n: fx.benchSnipe.n, count: fx.benchSnipe.count }));
  if (fx.flipAll) out.push(t('fx.flipAll', { n: fx.flipAll }));
  if (fx.noWR) out.push(t('fx.noWR'));
  if (fx.spiral) out.push(t('fx.spiral', { n: fx.spiral }));
  if (fx.flipBonus) out.push(fx.tailsSelf ? t('fx.flipBonusTails', { n: fx.flipBonus, s: fx.tailsSelf }) : t('fx.flipBonus', { n: fx.flipBonus }));
  if (fx.extraWater) out.push(t('fx.extraWater', { max: fx.extraWater }));
  if (fx.bothHeadsBonus) out.push(t('fx.bothHeadsBonus', { n: fx.bothHeadsBonus }));
  if (fx.flipStatusEither) out.push(t('fx.flipStatusEither', { a: '\u0001', b: '\u0002' }).replace('\u0001', stx(fx.flipStatusEither[0])).replace('\u0002', stx(fx.flipStatusEither[1])));
  if (fx.flipRemoveEnergy) out.push(t('fx.flipRemoveEnergy'));
  if (fx.waterPunch) out.push(t('fx.waterPunch', { n: fx.waterPunch }));
  if (fx.benchNonType) out.push(t('fx.benchNonType', { n: fx.benchNonType.n, t: { $type: fx.benchNonType.type } }));
  if (fx.doubleVs) out.push(t('fx.doubleVs', { t: { $type: fx.doubleVs } }));
  const T = (k, p) => out.push(t('fx.' + k, p));
  const withSt = (k, s, p = {}) => out.push(t('fx.' + k, { ...p, s: '\u0000' }).replace('\u0000', stx(s)));
  if (fx.headsSelf) T('headsSelf', { n: fx.headsSelf });
  if (fx.headsStatus) withSt('headsStatus', fx.headsStatus);
  if (fx.headsBench) T('headsBench', { n: fx.headsBench });
  if (fx.selfStatus) withSt('selfStatus', fx.selfStatus);
  if (fx.toxic) T('toxic');
  if (fx.bothHeadsStatus) withSt('bothHeadsStatus', fx.bothHeadsStatus);
  for (const k of ['amnesia', 'thunderstorm', 'drainAll', 'removeEnergy', 'headache', 'metronome', 'massExplosion', 'noWROnly', 'noRes', 'mirrorShell',
    'shuffleSelf', 'flipShuffleSelf', 'fadeOut', 'flipStatusChoice', 'halfHp', 'bonfire', 'falseCharity', 'helpingHand', 'lifeDrain', 'switchSelf',
    'needsEqualEnergy', 'peekHand', 'flipNoAttack', 'noRetreat', 'flipNoRetreat', 'flipNoEnergy', 'cooldown', 'plusSelfCounters']) if (fx[k]) T(k);
  if (fx.reduce) T('reduce', { n: fx.reduce });
  if (fx.callFamily) T('callFamily', { names: fx.callFamily.names.join(' / ') });
  if (fx.callFriend) T('callFriend', { who: fx.callFriend.who });
  if (fx.draw) T('draw', { n: fx.draw });
  if (fx.flipDraw) T('flipDraw', { n: fx.flipDraw });
  if (fx.flipUntilTails) T('flipUntilTails', { per: atk.base });
  if (fx.flipPerEnergy) T('flipPerEnergy', { per: atk.base });
  if (fx.plusOwnBench) T('plusOwnBench', { n: fx.plusOwnBench });
  if (fx.snipeAny) { T(fx.snipeAny.flip ? 'snipeAnyFlip' : 'snipeAny', { n: fx.snipeAny.n }); if (fx.snipeAny.noPower) T('noPower'); }
  if (fx.oppBenchAll) T('oppBenchAll', { n: fx.oppBenchAll });
  if (fx.handReset) T('handReset', { n: fx.handReset });
  if (fx.heal) T('heal', { n: fx.heal });
  if (fx.flipHeal) T('flipHeal', { n: fx.flipHeal });
  if (fx.benchType) T('benchType', { n: fx.benchType.n, t: { $type: fx.benchType.type } });
  for (const k of ['searchAttach', 'searchEnergy', 'attachFromDiscard', 'needsType', 'flipTailsDiscard']) if (typeof fx[k] === 'string') T(k, { t: { $type: fx[k] } });
  if (fx.flipRecoverEnergy) T('flipRecoverEnergy', { n: fx.flipRecoverEnergy.n, t: { $type: fx.flipRecoverEnergy.type } });
  if (fx.focus) T('focus', { atk: fx.focus });
  if (fx.riskyTails) T('riskyTails', { n: fx.riskyTails });
  if (fx.bonusIfDamaged) T('bonusIfDamaged', { n: fx.bonusIfDamaged });
  if (fx.gustAfter) T(fx.gustAfter.flip ? 'gustAfterFlip' : 'gustAfter');
  if (fx.needsCounters) T('needsCounters', { n: fx.needsCounters });
  if (fx.flipBenchAll) T('benchAll', { n: fx.flipBenchAll });
  // Modern cards
  const ty = (x) => ({ $type: x });
  if (fx.fixedBase) T('fixedBase', { n: fx.fixedBase });
  if (fx.timesPrizeTaken) T('timesPrizeTaken', { n: fx.timesPrizeTaken });
  if (fx.plusPrizeTaken) T('plusPrizeTaken', { n: fx.plusPrizeTaken });
  if (fx.plusSelfEnergy) T('plusSelfEnergy', { n: fx.plusSelfEnergy.n, t: ty(fx.plusSelfEnergy.type) });
  if (fx.timesNamedInPlay) T('timesNamedInPlay', { n: fx.timesNamedInPlay.n });
  if (fx.bonusIfAttachedName) T('bonusIfAttachedName', { n: fx.bonusIfAttachedName.n });
  if (fx.discardBenchEnergyBonus) T('discardBenchEnergyBonus', { n: fx.discardBenchEnergyBonus.n, max: fx.discardBenchEnergyBonus.max });
  if (fx.bonusIfDefEvolved) T('bonusIfDefEvolved', { n: fx.bonusIfDefEvolved });
  if (fx.bonusIfEqualHands) T('bonusIfEqualHands', { n: fx.bonusIfEqualHands });
  if (fx.bonusIfKOLastTurn) T(fx.bonusIfKOLastTurn.status ? 'bonusIfKOLastTurnPara' : 'bonusIfKOLastTurn', { n: fx.bonusIfKOLastTurn.n });
  if (fx.timesHand) T('timesHand', { n: fx.timesHand });
  if (fx.flipUntilTailsBonus) T('flipUntilTailsBonus', { n: fx.flipUntilTailsBonus });
  if (fx.optionalDiscardBonus) T('optionalDiscardBonus', { n: fx.optionalDiscardBonus.n, b: fx.optionalDiscardBonus.bonus });
  if (fx.hailBlade) T('hailBlade', { n: fx.hailBlade.n, t: ty(fx.hailBlade.type) });
  if (fx.callAny) T('callAny', { n: fx.callAny.n });
  if (fx.healAny) T('healAny', { n: fx.healAny });
  if (fx.attachDiscardAny) T(fx.attachDiscardAny.type ? 'attachDiscardType' : 'attachDiscardAny', { n: fx.attachDiscardAny.n, t: fx.attachDiscardAny.type && ty(fx.attachDiscardAny.type) });
  if (fx.attachDiscardBench) T(fx.attachDiscardBench.type ? 'attachDiscardBench' : 'attachDiscardBenchAny', { t: ty(fx.attachDiscardBench.type) });
  if (fx.searchBasicEnergy) T(fx.searchBasicEnergy.type ? 'searchEnergyType' : 'searchBasicEnergy', { n: fx.searchBasicEnergy.n, t: fx.searchBasicEnergy.type && ty(fx.searchBasicEnergy.type) });
  if (typeof fx.searchAttach === 'object') T('searchAttachN', { n: fx.searchAttach.n, t: ty(fx.searchAttach.type) });
  if (fx.searchAttachBench) T(fx.searchAttachBench.type ? 'searchAttachBench' : 'searchAttachBenchAny', { n: fx.searchAttachBench.n, t: ty(fx.searchAttachBench.type) });
  if (fx.placeCounters) T(fx.placeCounters.bench ? 'placeCountersBench' : 'placeCounters', { n: fx.placeCounters.n });
  if (fx.snipeMulti) T('snipeMulti', { n: fx.snipeMulti.n, count: fx.snipeMulti.count });
  if (fx.moveEnergyToBench) T(fx.moveEnergyToBench.may ? 'moveAllEnergyMay' : fx.moveEnergyToBench.all ? 'moveAllEnergyToBench' : fx.moveEnergyToBench.type ? 'moveEnergyToBench' : 'moveAnyEnergyToBench', { n: fx.moveEnergyToBench.n, t: ty(fx.moveEnergyToBench.type) });
  if (fx.discardStadium) T(fx.discardStadium.may ? 'discardStadiumMay' : 'discardStadium');
  for (const k of ['tailsCooldown', 'cureSelf', 'selfToHand', 'coordinatedPack', 'drawToMatch', 'shieldEffects', 'attachFromHand', 'switchSelfMay', 'switchSelfMust',
    'noAttackIfBasic', 'ignoreDefEffects', 'trainerFromDiscard', 'moonglowReverse', 'tmEvolution', 'tmDevolution', 'needsDefTera',
    'lockout', 'selfToHandAll', 'evolveFromDeck', 'discardAllEnergy', 'noWeakness']) if (fx[k]) T(k);
  // Newest decks
  if (fx.needsBenchName) T('needsBenchName', { m: fx.needsBenchName });
  if (fx.healBenchType) T('healBenchType', { n: fx.healBenchType.n, t: ty(fx.healBenchType.type) });
  if (fx.discardSelfTimes) T('discardSelfTimes', { n: fx.discardSelfTimes.n, max: fx.discardSelfTimes.max });
  if (fx.timesOwnInPlay) T('timesOwnInPlay', { n: fx.timesOwnInPlay });
  if (fx.timesAllEnergy) T('timesAllEnergy', { n: fx.timesAllEnergy });
  if (fx.bonusIfTool) T('bonusIfTool', { n: fx.bonusIfTool });
  if (fx.bonusIfSelfCounters) T('bonusIfSelfCounters', { n: fx.bonusIfSelfCounters.n, min: fx.bonusIfSelfCounters.min });
  if (fx.fetchHide) T('fetchHide');
  // Sword & Shield
  if (fx.snipeByCounters) T('snipeByCounters', { n: fx.snipeByCounters });
  if (fx.plusBenchNamed) T('plusBenchNamed', { n: fx.plusBenchNamed.n, m: fx.plusBenchNamed.name });
  if (fx.plusDiscardNamed) T('plusDiscardNamed', { n: fx.plusDiscardNamed.n, m: fx.plusDiscardNamed.name });
  if (fx.millSelf) T('millSelf', { n: fx.millSelf });
  if (fx.tailsDiscard) T('tailsDiscard', { n: fx.tailsDiscard });
  if (fx.optionalDiscardReduce) T('optionalDiscardReduce', { n: fx.optionalDiscardReduce.n, r: fx.optionalDiscardReduce.reduce });
  if (fx.discardDefTools) T('discardDefTools');
  if (fx.discardBenchNamedTimes) T('discardBenchNamedTimes', { n: fx.discardBenchNamedTimes.n, m: fx.discardBenchNamedTimes.name });
  if (fx.bounceDefEnergy) T('bounceDefEnergy', { n: fx.bounceDefEnergy.n });
  if (fx.plusDefRetreat) T('plusDefRetreat', { n: fx.plusDefRetreat });
  if (fx.statusIfPlayed) out.push(t('fx.statusIfPlayed', { m: fx.statusIfPlayed.name, s: '\u0000' }).replace('\u0000', stx(fx.statusIfPlayed.status)));
  if (fx.optionalDiscardTypeAll) T('optionalDiscardTypeAll', { n: fx.optionalDiscardTypeAll.bonus, t: ty(fx.optionalDiscardTypeAll.type) });
  if (fx.boostNext) T(fx.boostNext.atk ? 'boostNext' : 'boostNextAll', { n: fx.boostNext.n, atk: fx.boostNext.atk });
  if (fx.oncePerActive) T('oncePerActive');
  if (fx.flipMultiBonus) T('flipMultiBonus', { n: fx.flipMultiBonus.n, b: fx.flipMultiBonus.bonus });
  if (fx.discardRandomOppHand) T('discardRandomOppHand');
  if (fx.millOpp) T('millOpp');
  if (fx.bonusIfExtraEnergy) T('bonusIfExtraEnergy', { n: fx.bonusIfExtraEnergy });
  if (fx.returnTypeToHand) T('returnTypeToHand', { n: fx.returnTypeToHand.n, t: ty(fx.returnTypeToHand.type) });
  if (fx.weaken) T('weaken', { n: fx.weaken });
  if (fx.flipShuffleDef) T('flipShuffleDef');
  // Sword & Shield V Battle / League Battle Decks
  if (fx.gx) T('gx');
  if (fx.alteredCreation) T('alteredCreation', { t: ty(fx.alteredCreation.type) });
  if (fx.attachHandAny) T('attachHandAny');
  if (fx.searchAttachAny) T('searchAttachAny', { n: fx.searchAttachAny.n });
  if (fx.discardHandOrFail) T('discardHandOrFail', { n: fx.discardHandOrFail.n, t: ty(fx.discardHandOrFail.type) });
  if (fx.bonusIfEqualBench) T('bonusIfEqualBench', { n: fx.bonusIfEqualBench });
  if (fx.flipMetronome) T('flipMetronome');
  if (fx.searchAttachOne) T(fx.searchAttachOne.firstTurnN ? 'searchAttachOneFirst' : 'searchAttachOne', { n: fx.searchAttachOne.n, f: fx.searchAttachOne.firstTurnN, t: ty(fx.searchAttachOne.type) });
  if (fx.attachDiscardOne) T('attachDiscardOne', { n: fx.attachDiscardOne.n, t: ty(fx.attachDiscardOne.type) });
  if (fx.benchCounters) T('benchCounters', { n: fx.benchCounters / 10 });
  if (fx.allHeadsShield) T('allHeadsShield');
  if (fx.bonusIfBenchName) T('bonusIfBenchName', { n: fx.bonusIfBenchName.n, m: fx.bonusIfBenchName.name });
  if (fx.healBenchAll) T('healBenchAll');
  if (fx.discardAllType) T('discardAllType', { t: ty(fx.discardAllType) });
  if (fx.bonusIfHealedThisTurn) T('bonusIfHealedThisTurn', { n: fx.bonusIfHealedThisTurn });
  if (fx.discardSelfBonus) T('discardSelfBonus', { n: fx.discardSelfBonus.n, max: fx.discardSelfBonus.max });
  if (fx.plusOppBench) T('plusOppBench', { n: fx.plusOppBench });
  if (fx.discardHandDraw) T('discardHandDraw', { n: fx.discardHandDraw });
  if (fx.bonusIfEvolvedThisTurn) T('bonusIfEvolvedThisTurn', { n: fx.bonusIfEvolvedThisTurn });
  if (fx.attachHandSelf) T('attachHandSelf', { t: ty(fx.attachHandSelf.type) });
  if (fx.attachHandBench) T('attachHandBench', { t: ty(fx.attachHandBench.type) });
  if (fx.timesAttachedNameAll) T('timesAttachedNameAll', { n: fx.timesAttachedNameAll.n, m: fx.timesAttachedNameAll.name });
  if (fx.shuffleSelfMay) T('shuffleSelfMay');
  if (fx.copyBenchTag) T('copyBenchTag', { tag: fx.copyBenchTag });
  if (fx.healAllOwn) T('healAllOwn', { n: fx.healAllOwn });
  if (fx.peekOppTop) T('peekOppTop');
  if (fx.searchStadium) T(fx.searchStadium > 1 ? 'searchStadiumN' : 'searchStadium', { n: fx.searchStadium });
  if (fx.plusAllBench) T('plusAllBench', { n: fx.plusAllBench });
  if (fx.bonusIfMovedToActive) T('bonusIfMovedToActive', { n: fx.bonusIfMovedToActive });
  if (fx.discardTypeTimes) T('discardTypeTimes', { n: fx.discardTypeTimes.n, max: fx.discardTypeTimes.max });
  if (fx.countersMulti) T('countersMulti', { n: fx.countersMulti.n / 10, k: fx.countersMulti.count });
  if (fx.shadowMist) T('shadowMist');
  if (fx.plusTypeEnergyAll) T('plusTypeEnergyAll', { n: fx.plusTypeEnergyAll.n, t: ty(fx.plusTypeEnergyAll.type) });
  if (fx.selfBenchAll) T('selfBenchAll', { n: fx.selfBenchAll });
  if (fx.bonusIfStadium) T('bonusIfStadium', { n: fx.bonusIfStadium });
  if (fx.timesBothActiveEnergy) T('timesBothActiveEnergy', { n: fx.timesBothActiveEnergy });
  if (fx.energyWarp) T('energyWarp');
  // Sun & Moon
  const st1 = (k, s, extra = {}) => out.push(t('fx.' + k, { ...extra, s: '\u0000' }).replace('\u0000', stx(s)));
  if (fx.plusDiscardEnergyTypes) T('plusDiscardEnergyTypes', { n: fx.plusDiscardEnergyTypes.n, max: fx.plusDiscardEnergyTypes.max });
  if (fx.searchAnyPerBench) T('searchAnyPerBench');
  if (fx.bonusIfDefBasic) T('bonusIfDefBasic', { n: fx.bonusIfDefBasic });
  if (fx.optionalBonusSelfDamage) T('optionalBonusSelfDamage', { n: fx.optionalBonusSelfDamage.bonus, k: fx.optionalBonusSelfDamage.self });
  if (fx.benchSharesType) T('benchSharesType', { n: fx.benchSharesType });
  if (fx.discardAllTypeTimes) T('discardAllTypeTimes', { n: fx.discardAllTypeTimes.n, t: ty(fx.discardAllTypeTimes.type) });
  if (fx.peekPrize) T(fx.peekPrize > 1 ? 'peekPrizes' : 'peekPrize');
  if (fx.tailsStatus) st1('tailsStatus', fx.tailsStatus);
  if (fx.countersAll) T('countersAll', { n: fx.countersAll / 10 });
  if (fx.benchFromDiscard) T('benchFromDiscard');
  if (fx.energyFromDiscard) T('energyFromDiscard', { n: fx.energyFromDiscard });
  if (fx.switchSelfType) T('switchSelfType', { t: ty(fx.switchSelfType) });
  if (fx.timesAllBench) T('timesAllBench', { n: fx.timesAllBench });
  if (fx.eruption) T('eruption', { n: fx.eruption });
  if (fx.setWeakness) T('setWeakness', { t: ty(fx.setWeakness) });
  if (fx.discardDefToolsBonus) T('discardDefToolsBonus', { n: fx.discardDefToolsBonus });
  if (fx.plusOppEnergyAll) T('plusOppEnergyAll', { n: fx.plusOppEnergyAll });
  if (fx.drawToMay) T('drawToMay', { n: fx.drawToMay });
  if (fx.evolveSelfFromDeck) T('evolveSelfFromDeck');
  if (fx.bonusIfPlayed) T('bonusIfPlayed', { n: fx.bonusIfPlayed.n, m: fx.bonusIfPlayed.name });
  if (fx.discardHandTypeTimes) T('discardHandTypeTimes', { n: fx.discardHandTypeTimes.n, max: fx.discardHandTypeTimes.max, t: ty(fx.discardHandTypeTimes.type) });
  if (fx.swimSnipe) T('swimSnipe', { t: ty(fx.swimSnipe.type) });
  if (fx.flipRecoverAny) T('flipRecoverAny', { n: fx.flipRecoverAny });
  if (fx.bonusIfDeckLE) T('bonusIfDeckLE', { n: fx.bonusIfDeckLE.n, max: fx.bonusIfDeckLE.max });
  if (fx.bonusIfMoreHand) T('bonusIfMoreHand', { n: fx.bonusIfMoreHand });
  if (fx.searchAny) T('searchAny', { n: fx.searchAny });
  if (fx.drawPerNamed) T('drawPerNamed', { m: fx.drawPerNamed });
  if (fx.optionalDiscardRemove) T('optionalDiscardRemove');
  if (fx.snipeDamaged) T('snipeDamaged', { n: fx.snipeDamaged });
  if (fx.vulnerable) T('vulnerable', { n: fx.vulnerable });
  if (fx.bonusIfFewerInPlay) T('bonusIfFewerInPlay', { n: fx.bonusIfFewerInPlay });
  if (fx.bonusIfSelfType) T('bonusIfSelfType', { n: fx.bonusIfSelfType.n, t: ty(fx.bonusIfSelfType.type) });
  if (fx.timesSelfType) T('timesSelfType', { n: fx.timesSelfType.n, t: ty(fx.timesSelfType.type) });
  if (fx.moveAllEnergyBenchAny) T('moveAllEnergyBenchAny');
  if (fx.shuffleDiscardEnergyType) T('shuffleDiscardEnergyType', { n: fx.shuffleDiscardEnergyType.n, t: ty(fx.shuffleDiscardEnergyType.type) });
  if (fx.attachHandBenchN) T('attachHandBenchN', { n: fx.attachHandBenchN });
  if (fx.copyLastAttack) T('copyLastAttack');
  if (fx.bonusIfPrizesExactly) T('bonusIfPrizesExactly', { n: fx.bonusIfPrizesExactly.bonus, k: fx.bonusIfPrizesExactly.n });
  if (fx.plusBenchEvolved) T('plusBenchEvolved', { n: fx.plusBenchEvolved });
  if (fx.shuffleDiscardPokemonType) T('shuffleDiscardPokemonType', { n: fx.shuffleDiscardPokemonType.n, t: ty(fx.shuffleDiscardPokemonType.type) });
  if (fx.needsStadium) T('needsStadium');
  if (fx.placeCountersOppDiscard) T('placeCountersOppDiscard');
  if (fx.furyCutter) T('furyCutter');
  if (fx.bounceDefAll) T(fx.bounceFlip ? 'bounceDefAllFlip' : 'bounceDefAll');
  if (fx.flipHeadache) T('flipHeadache');
  if (fx.bonusIfLostType) T('bonusIfLostType', { n: fx.bonusIfLostType.n, t: ty(fx.bonusIfLostType.type) });
  if (fx.switchIfDefEvolved) T('switchIfDefEvolved');
  if (fx.bonusIfDefResist) T('bonusIfDefResist', { n: fx.bonusIfDefResist.n, t: ty(fx.bonusIfDefResist.type) });
  if (fx.removeEnergyType) T('removeEnergyType', { t: ty(fx.removeEnergyType) });
  if (fx.bonusIfDefStatus) st1('bonusIfDefStatus', fx.bonusIfDefStatus.status, { n: fx.bonusIfDefStatus.n });
  if (fx.severePoison) T('severePoison', { n: fx.severePoison });
  if (fx.timesOwnEnergyAll) T('timesOwnEnergyAll', { n: fx.timesOwnEnergyAll });
  if (fx.bonusIfSelfStatus) T('bonusIfSelfStatus', { n: fx.bonusIfSelfStatus.n });
  if (fx.useOppSupporter) T('useOppSupporter');
  if (fx.bonusIfDefType) T('bonusIfDefType', { n: fx.bonusIfDefType.n, t: ty(fx.bonusIfDefType.type) });
  if (fx.supportersFromDiscard) T('supportersFromDiscard', { n: fx.supportersFromDiscard });
  if (fx.timesOwnDamaged) T('timesOwnDamaged', { n: fx.timesOwnDamaged });
  if (fx.ownBenchSnipe) T('ownBenchSnipe', { n: fx.ownBenchSnipe });
  if (fx.bonusIfUsedLastTurn) T('bonusIfUsedLastTurn', { n: fx.bonusIfUsedLastTurn.n, atk: fx.bonusIfUsedLastTurn.atk });
  if (fx.selfNoRetreat) T('selfNoRetreat');
  if (fx.removeSpecialEnergy) T('removeSpecialEnergy');
  if (fx.callAny?.switchAfter) T('callAnySwitch');
  if (fx.timesOppHand) T('timesOppHand', { n: fx.timesOppHand });
  if (fx.timesTagInPlay) T('timesTagInPlay', { n: fx.timesTagInPlay.n, tag: fx.timesTagInPlay.tag });
  if (fx.bonusIfOppPrizesLE) T('bonusIfOppPrizesLE', { n: fx.bonusIfOppPrizesLE.n, max: fx.bonusIfOppPrizesLE.max });
  if (fx.bonusIfBenchStage2Type) T(fx.bonusIfBenchStage2Type.type ? 'bonusIfBenchStage2Type' : 'bonusIfBenchStage2', { n: fx.bonusIfBenchStage2Type.n, t: ty(fx.bonusIfBenchStage2Type.type) });
  if (fx.bonusIfDefEx) T('bonusIfDefEx', { n: fx.bonusIfDefEx });
  if (fx.bonusIfDefExV) T('bonusIfDefExV', { n: fx.bonusIfDefExV });
  if (fx.bonusIfOwnBenchDamaged) T('bonusIfOwnBenchDamaged', { n: fx.bonusIfOwnBenchDamaged });
  if (fx.bonusIfEnergyInPlay) T('bonusIfEnergyInPlay', { n: fx.bonusIfEnergyInPlay.n, min: fx.bonusIfEnergyInPlay.min });
  if (fx.searchPokemonToHand) T(fx.searchPokemonToHand.resistance ? 'searchPokemonResist' : 'searchPokemonToHand', { n: fx.searchPokemonToHand.n, t: fx.searchPokemonToHand.resistance && ty(fx.searchPokemonToHand.resistance) });
  if (fx.returnEnergyBonus) T('returnEnergyBonus', { b: fx.returnEnergyBonus.bonus, t: ty(fx.returnEnergyBonus.type) });
  if (fx.returnEnergyToHand) T('returnEnergyToHand', { n: fx.returnEnergyToHand });
  if (fx.searchAttachTag) T(fx.searchAttachTag.anyEnergy ? 'searchAttachTagAny' : 'searchAttachTag', { n: fx.searchAttachTag.n, tag: fx.searchAttachTag.tag });
  if (fx.benchSnipe?.damagedOnly) T('damagedOnly');
  if (fx.callAny?.prefix) T('callAnyPrefix', { who: fx.callAny.prefix });
  if (fx.callAny?.tag) T('callAnyTag', { tag: fx.callAny.tag });
  return out;
}

function explainCard(card, mon = null) {
  const L = (k, p) => esc(t(k, p));
  if (card.kind === 'energy') {
    if (card.special) return `<h4>${icon('info')} ${L('ex.what')}</h4><p>${t('ex.special.' + card.special)}</p>`;
    return `<h4>${icon('info')} ${L('ex.what')}</h4><p>${t('ex.energy', { t: '\u0000' }).replace(/\u0000/g, `${energyIcon(card.energyType)} <b>${esc(t('type.' + card.energyType))}</b>`)}</p>`;
  }
  if (card.kind === 'trainer') {
    const k = card.stadium || card.tool || card.tkind;
    const kind = card.ttype ? `<p class="ttype">${icon(TTYPE_ICON[card.ttype])} ${t('ttype.' + card.ttype)}</p>` : '';
    const vstar = card.power?.vstar ? `<h4>${icon('star')} ${L('ex.vstar')}: ${esc(card.power.name)}</h4><p>${L('pw.' + card.power.kind)}</p>` : '';
    const tm = card.attacks?.length ? `<h4>${icon('swords')} ${L('ex.tmAttack')}</h4>${card.attacks.map((a) => `<div class="atk-ex"><div class="atk-name"><b>${esc(a.name)}</b></div><div class="atk-cost">${L('ex.cost')} ${costText(a.cost)}</div>${attackEffects(a).map((x) => `<div class="fx">• ${x}</div>`).join('')}</div>`).join('')}` : '';
    return `${kind}<h4>${icon('info')} ${L('ex.what')}</h4><p>${L(`tr.${k}.what`)}</p>${vstar}${tm}
      <h4>${icon('lightbulb')} ${L('ex.when')}</h4><p>${L(`tr.${k}.tip`)}</p>`;
  }
  const facts = [
    card.stage === 0 ? L('ex.basic') : L('ex.stage', { s: t('stage.' + card.stage), from: card.evolvesFrom }),
    ...(card.prizes ? [t('ex.prizes', { n: card.prizes, k: card.tags?.includes('Mega') ? 'Mega ex' : ['TAG TEAM', 'VSTAR', 'VMAX', 'V', 'GX', 'ex'].find((x) => card.tags?.includes(x)) || 'ex' })] : []),
    ...(card.tera ? [t('ex.tera')] : []),
    L('ex.hp', { hp: card.hp, n: card.hp / 10 }),
    card.weakness ? t('ex.weak', { t: '\u0000' }).replace('\u0000', `${energyIcon(card.weakness)} <b>${esc(t('type.' + card.weakness))}</b>`) : L('ex.noWeak'),
    card.resistance ? t('ex.res', { t: '\u0000' }).replace('\u0000', `${energyIcon(card.resistance)} <b>${esc(t('type.' + card.resistance))}</b>`) : L('ex.noRes'),
    card.retreat ? L('ex.retreat', { n: card.retreat }) : L('ex.retreat0'),
  ];
  const attacks = card.attacks.map((a) => {
    const dmg = a.fx.timesSelfCounters || a.fx.flipMulti ? '' : a.base ? L('ex.dmg', { n: a.base }) : L('ex.noDmg');
    const fx = attackEffects(a);
    let ready = '';
    if (mon) {
      const miss = missingEnergy(mon.payTypes, a.cost);
      ready = miss.length
        ? `<div class="ready no">${icon('x')} ${L('now.missing')} ${costText(miss)}</div>`
        : `<div class="ready yes">${icon('circle-check')} ${L('now.ready')}</div>`;
    }
    return `<div class="atk-ex"><div class="atk-name"><b>${esc(a.name)}</b>${a.damage ? `<span class="atk-dmg">${esc(a.damage)}</span>` : ''}</div>
      <div class="atk-cost">${L('ex.cost')} ${costText(a.cost)}</div>
      ${dmg ? `<div>${dmg}</div>` : ''}${fx.map((x) => `<div class="fx">• ${x}</div>`).join('') || (dmg ? '' : '')}
      ${!fx.length ? `<div class="fx muted">${L('ex.noFx')}</div>` : ''}${ready}</div>`;
  }).join('');
  let now = '';
  if (mon) {
    const owner = game.players.find((p) => game.allMons(p).includes(mon));
    const counts = {};
    mon.energyTypes.forEach((e) => { counts[e] = (counts[e] || 0) + 1; });
    const energy = mon.energy.length
      ? L('now.energy') + ' ' + Object.entries(counts).map(([k, n]) => `${n} ${energyIcon(k)} ${esc(t('type.' + k))}`).join(' + ')
      : L('now.noEnergy');
    const conds = mon.conditions().map((s) => stx(s)).join(', ');
    now = `<div class="now"><h4>${icon('info')} ${L(owner?.idx === 1 ? 'now.titleOpp' : 'now.title')}</h4>
      <div>${L('now.hp', { a: mon.hpLeft, b: mon.maxHp })}</div><div>${energy}</div>${conds ? `<div>${L('now.status')} ${conds}</div>` : ''}</div>`;
  }
  const power = card.power
    ? `<h4>${icon('sparkles')} ${L(card.power.vstarPower ? 'ex.vstar' : card.power.ability ? 'ex.ability' : 'ex.power')}: ${esc(card.power.name)}</h4><p>${card.powerKind ? L('pw.' + card.powerKind) : esc(card.power.text)}</p>`
    : '';
  return `${now}<h4>${icon('info')} ${L('ex.what')}</h4><ul class="facts">${facts.map((f) => `<li>${f}</li>`).join('')}</ul>${power}
    <h4>${icon('swords')} ${L('ex.attacks')}</h4>${attacks}`;
}

function placePreview(anchor) {
  const pv = $('#preview'), r = anchor.getBoundingClientRect(), m = 14;
  const w = pv.offsetWidth, h = pv.offsetHeight;
  // Beside the card if there is room (right first), otherwise above it.
  let left = r.right + m, top = r.top + r.height / 2 - h / 2;
  if (left + w > innerWidth - 8) left = r.left - m - w;
  if (left < 8) {
    left = r.left + r.width / 2 - w / 2; top = r.top - m - h;
    if (top < 8) top = r.bottom + m; // no room above: below it, so at worst it covers the card's lower half, not its name
  }
  pv.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, left))}px`;
  pv.style.top = `${Math.max(8, Math.min(innerHeight - h - 8, top))}px`;
}

document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-inspect]');
  if (!el || !inspectables.has(el.dataset.inspect)) return;
  const card = inspectables.get(el.dataset.inspect);
  const reason = el.classList.contains('unplayable') && game ? whyNot(card, game.players[0]) : null;
  inspect(card, reason, el);
  // The image loads asynchronously; re-place once its size is known.
  $('#preview img')?.addEventListener('load', () => !$('#preview').hidden && placePreview(el), { once: true });
});
// Card images show a card-shaped skeleton (reserved at the exact card size) until they load.
document.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') e.target.classList.add('loaded'); }, true);

// The preview must never outlive the card it belongs to: hide it on any click, when the page loses the mouse,
// and whenever the hovered card is re-rendered or removed (e.g. a choice window closing).
let previewAnchor = null;
document.addEventListener('pointerdown', () => inspect(null), true);
document.addEventListener('mouseleave', () => inspect(null));
window.addEventListener('blur', () => inspect(null));
function dropStalePreview() { if (previewAnchor && !previewAnchor.isConnected) inspect(null); }
document.addEventListener('mouseout', (e) => {
  const el = e.target.closest('[data-inspect]');
  if (el && !el.contains(e.relatedTarget)) inspect(null);
});

// ---------------- Log, status, coach ----------------
function logLine(e) {
  const el = document.createElement('div');
  el.className = e.kind;
  el.textContent = t(e.key, e.params);
  return el;
}
function log(e) {
  if (e.kind === 'ko' && e.key === 'log.ko') koStamp();
  logEntries.push(e);
  $('#log').append(logLine(e));
  $('#log').scrollTop = $('#log').scrollHeight;
}
function renderLog() {
  $('#log').replaceChildren(...logEntries.map(logLine));
  $('#log').scrollTop = $('#log').scrollHeight;
}

function oppStatus(key = '', params = {}, thinking = false) {
  oppState = { key, params, thinking };
  renderOppStatus();
}
function renderOppStatus() {
  $('#opp-status').innerHTML = oppState.key ? (oppState.key === 'ui.aiError' ? icon('triangle-alert') : '') + esc(t(oppState.key, oppState.params)) : '';
  $('#opp-status').classList.toggle('thinking', oppState.thinking);
}

function coachMsg(key, params = {}, cls = '') {
  coachState = { key, params, cls };
  renderCoach();
}
function renderCoach() {
  const ic = { good: 'circle-check', meh: 'thumbs-up', bad: 'lightbulb' }[coachState.cls];
  // The Professor (your coach) speaks here; Gary is only the opponent.
  $('#coach-msg').innerHTML = `<b class="coach-who">${esc(t('ui.coachName'))}</b> ` + (ic ? icon(ic) : '') + esc(t(coachState.key, coachState.params));
  $('#coach-msg').className = coachState.cls;
}

function showWin(win) {
  winState = win;
  $('#win-meter').hidden = false;
  $('#win-fill').style.width = `${(win.score / 4) * 100}%`;
  $('#win-label').textContent = t('win.' + Math.max(0, Math.min(4, Math.round(win.score))));
}

// ---------------- Human player ----------------
function turnTips(p, actions) {
  const kinds = new Set(actions.map((a) => a.kind));
  // The situation first (only the first tip shows until the list is unfolded), then what you can do, then how.
  const tips = [];
  if (game.turn === 1) tips.push(['tip.firstTurn']);
  if (p.active?.status.confused) tips.push(['tip.confused', { m: p.active.name }]);
  if (!kinds.has('attack') && game.turn !== 1 && p.active) {
    const st = p.active.conditions().find((s) => s === 'asleep' || s === 'paralyzed');
    tips.push(st ? ['tip.cantStatus', { m: p.active.name, s: { $st: st } }] : ['tip.noEnergy', { m: p.active.name }]);
  }
  if (onlyEndLeft(actions)) tips.push(['tip.onlyEnd']);
  if (kinds.has('attack')) tips.push(['tip.attack']);
  if (kinds.has('bench')) tips.push(['tip.bench']);
  if (kinds.has('evolve')) tips.push(['tip.evolve']);
  if (kinds.has('energy')) tips.push(['tip.energy']);
  if (!onlyEndLeft(actions)) {
    if (actions.some((a) => a.card)) tips.push(['tip.drag']);
    else if (game.turn !== 1 || kinds.size > 1) tips.push(['tip.hoverHand']);
  }
  return tips;
}

// Nothing useful left: only ending the turn (or an optional retreat) remains.
const onlyEndLeft = (actions) => actions.every((a) => a.kind === 'end' || a.kind === 'retreat');

// Why a hand card has no legal play right now — shown when hovering a dimmed card.
function whyNot(c, p) {
  const o = game.opp(p), mons = game.allMons(p);
  if (game.current !== p || game.phase !== 'main') return ['why.notYourTurn'];
  if (c.kind === 'energy') return ['why.energyUsed'];
  if (c.kind === 'pokemon') {
    if (c.stage === 0) return ['why.benchFull'];
    if (game.turn <= 2) return ['why.firstTurns'];
    const base = mons.filter((m) => m.name === c.evolvesFrom);
    if (!base.length) return ['why.noBase', { from: c.evolvesFrom }];
    return ['why.justPlayed', { from: c.evolvesFrom }];
  }
  if (game.modern && c.kind === 'trainer') {
    if (c.ttype === 'supporter' && p.flags.supporter) return ['why.supporterUsed'];
    if (c.ttype === 'supporter' && game.turn === 1) return ['why.firstSupporter'];
    if (c.ttype === 'stadium') return [game.stadium?.card.name === c.name ? 'why.stadiumSame' : 'why.stadiumUsed'];
    if (c.ttype === 'tool') return ['why.toolNoTarget'];
    if (c.tkind === 'rareCandy') return [game.turn <= 2 ? 'why.firstTurns' : 'why.rareCandy'];
    return ['why.generic'];
  }
  switch (c.tkind) {
    case 'potion': case 'superPotion':
      return mons.some((m) => m.damage) ? ['why.needEnergyToHeal'] : ['why.noDamage'];
    case 'switch': return ['why.noBench'];
    case 'gust': return ['why.noOppBench'];
    case 'energyRemoval': return ['why.noOppEnergy'];
    case 'superEnergyRemoval': return ['why.serNeeds'];
    case 'energyRetrieval': return ['why.retrieval'];
    case 'computerSearch': return ['why.computerSearch'];
    case 'bill': case 'professorOak': return ['why.deckEmpty'];
    default: return ['why.generic'];
  }
}

// Dim hand cards that have no legal play in the current decision.
function markPlayable() {
  const playable = new Set(decision ? decision.actions.filter((a) => a.card).map((a) => a.card.uid) : []);
  document.querySelectorAll('#hand .hcard').forEach((el) => el.classList.toggle('unplayable', !!decision && !playable.has(Number(el.dataset.card))));
  document.querySelector('#end-slot .k-end')?.classList.toggle('go', !!decision && onlyEndLeft(decision.actions));
}

function highlight(act, on) {
  const sels = [];
  if (act.card) sels.push(`[data-card="${act.card.uid}"]`);
  if (act.target) sels.push(`[data-mon="${act.target.id}"]`);
  if (act.kind === 'attack' || act.kind === 'retreat') sels.push('#you-active .mon');
  for (const sel of sels) document.querySelectorAll(sel).forEach((el) => el.classList.toggle('hl', on));
}

let tipsOpen = false;
function renderDecision() {
  if (!decision) return;
  const { actions, ranking, p } = decision;
  // The most relevant tip shows; the rest fold away so the moves keep the room.
  const tips = turnTips(p, actions);
  $('#tips').classList.toggle('open', tipsOpen);
  const more = () => t(tipsOpen ? 'ui.lessTips' : tips.length === 2 ? 'ui.moreTip' : 'ui.moreTips', { n: tips.length - 1 });
  $('#tips').innerHTML = tips.map(([k, prm]) => `<li>${esc(t(k, prm))}</li>`).join('')
    + (tips.length > 1 ? `<li class="tips-more"><button class="linkish" aria-controls="tips" aria-expanded="${tipsOpen}">${esc(more())}</button></li>` : '');
  const tb = $('#tips .tips-more button');
  tb?.addEventListener('click', () => {
    tipsOpen = !tipsOpen;
    $('#tips').classList.toggle('open', tipsOpen);
    tb.setAttribute('aria-expanded', String(tipsOpen));
    tb.textContent = more();
  });
  const box = $('#actions');
  box.innerHTML = '';
  $('#end-slot').innerHTML = '';
  const button = (a) => {
    const b = document.createElement('button');
    b.className = `act k-${a.kind}`;
    const prob = ranking && $('#opt-hints').checked ? ranking.probabilities[a.key] ?? 0 : null;
    const best = prob != null && a.key === ranking.choice;
    if (best) b.classList.add('best');
    const offType = a.kind === 'energy' && isOffType(a);
    const note = offType ? `<span class="note" title="${esc(t('tip.offType'))}">${esc(t('ui.onlyColorless'))}</span>` : '';
    const rate = prob != null ? `<span class="pct">${pct(prob)}</span><span class="track"><i style="width:${Math.round(prob * 100)}%"></i></span>` : '';
    const pick = best ? `<span class="pick">${esc(t('ui.profPick'))}</span>` : '';
    b.innerHTML = `${actLead(a, p)}<span class="lbl"><span class="txt">${esc(t(a.label.key, a.label.params))}</span>${note}${pick}</span>${rate}`;
    b.onmouseenter = () => highlight(a, true);
    b.onmouseleave = () => highlight(a, false);
    b.onclick = () => decision.pick(a);
    return b;
  };
  for (const kind of KIND_ORDER) {
    const group = actions.filter((a) => a.kind === kind);
    if (!group.length) continue;
    const g = document.createElement('div');
    g.className = 'act-group';
    g.innerHTML = `<div class="act-head">${esc(t(kind === 'power' && game.modern ? 'group.ability' : 'group.' + kind))}</div>`;
    group.forEach((a) => g.append(button(a)));
    box.append(g);
  }
  const end = actions.find((a) => a.kind === 'end');
  $('#end-slot').insertAdjacentHTML('beforeend', undoButton());
  $('#undo-btn')?.addEventListener('click', undoLast);
  if (end) $('#end-slot').append(button(end));
  markPlayable();
}

// What leads each move: the Energy symbol, the attacker's type, or a small picture of the card the move is about.
function actLead(a, p) {
  if (a.kind === 'energy' && !a.card.energyType.includes('|')) return `<span class="lead">${energyIcon(a.card.energyType)}</span>`;
  if (a.kind === 'attack') return `<span class="lead">${energyIcon(p.active?.card.type || 'Colorless')}</span>`;
  const c = a.card || (a.kind === 'stadium' ? game.stadium?.card : a.kind === 'power' || a.kind === 'retreat' ? a.target?.card : null);
  return c?.img ? `<span class="lead thumb"><img src="${c.img}" alt="" loading="lazy"></span>` : '<span class="lead"></span>';
}

// An Energy that none of the target's attacks asks for by type: legal, but it only pays for ★ (Colorless) costs.
const isOffType = (a) => a.card.energyType !== 'Colorless' && !a.target.card.attacks.some((x) => x.cost.some((c) => isType(a.card.energyType, c)));

const TTYPE_ICON = { item: 'backpack', supporter: 'user', stadium: 'landmark', tool: 'wrench' };
const KIND_ORDER = ['attack', 'energy', 'evolve', 'bench', 'power', 'trainer', 'stadium', 'retreat'];
const KIND_ICON = { attack: 'swords', energy: 'zap', evolve: 'chevrons-up', bench: 'circle-plus', trainer: 'backpack', retreat: 'arrow-left-right', end: 'skip-forward', power: 'sparkles', stadium: 'landmark' };

function clearActions(html = '') {
  $('#actions').innerHTML = html;
  $('#end-slot').innerHTML = '';
}

class HumanController {
  constructor(myGame) { this.myGame = myGame; this.n = 0; this.lastWinTurn = -1; }

  async chooseAction(g, p, actions) {
    if (this.myGame !== gameId) return stale();
    if (!tourDone()) await runTour();
    const id = ++this.n;
    return new Promise((resolve) => {
      decision = {
        actions, p, ranking: null,
        pick: (a) => {
          highlight(a, false);
          rememberForUndo(g, a);
          const ranking = decision.ranking;
          decision = null;
          if (drag) endDrag(true);
          markPlayable();
          this.n++;
          clearActions('<div class="waiting">…</div>');
          $('#tips').innerHTML = '';
          if ($('#opt-coach').checked) this.feedback(a, actions, ranking);
          resolve(a);
        },
      };
      renderDecision();

      if (!$('#opt-coach').checked && !$('#opt-hints').checked) return;
      const withWin = this.lastWinTurn !== g.turn;
      coachMsg('coach.thinking');
      rankActions(g, p, actions, { withWinChance: withWin }).then((r) => {
        if (id !== this.n || this.myGame !== gameId || !decision) return;
        if (withWin && r.win) { this.lastWinTurn = g.turn; showWin(r.win); }
        decision.ranking = r.action;
        renderDecision();
        if ($('#opt-hints').checked) {
          const best = actions.find((a) => a.key === r.action.choice);
          coachMsg('coach.suggests', { a: { $t: best.label }, p: pct(r.action.probabilities[r.action.choice] ?? 0) });
        } else coachMsg('coach.ready');
      }).catch((err) => coachMsg('coach.unavailable', { e: err.message }, 'bad'));
    });
  }

  feedback(chosen, actions, ranking) {
    if (!ranking) return coachMsg('coach.tooFast');
    const best = actions.find((a) => a.key === ranking.choice);
    const pc = ranking.probabilities[chosen.key] ?? 0, pb = ranking.probabilities[ranking.choice] ?? 0;
    let key, cls;
    if (chosen.key === ranking.choice) { key = 'coach.agree'; cls = 'good'; }
    else if (pc >= pb * 0.5) { key = 'coach.ok'; cls = 'meh'; }
    else { key = 'coach.bad'; cls = 'bad'; }
    const params = { a: { $t: chosen.label }, b: { $t: best.label }, pb: pct(pb), pc: pct(pc) };
    coachMsg(key, params, cls);
    log({ key: 'coach.prefix', params: { m: { $t: { key, params } } }, kind: 'coach' });
  }

  choose(g, p, prompt) {
    if (this.myGame !== gameId) return stale();
    if (prompt.kind === 'prize') return choosePrize(prompt);
    if (prompt.kind === 'rps') return chooseRps(prompt);
    if (prompt.kind === 'setup-active' && prompt.options.every((o) => o.card)) return chooseActiveStage(prompt);
    return new Promise((resolve) => {
      openModal(() => {
        const small = prompt.kind === 'prize' || prompt.options.length > 8;
        prompt.options.forEach((o) => o.card && inspectables.set('c' + o.card.uid, o.card));
        // Cards and Pokémon are shown as themselves; word answers ("Yes", "Nothing / done", a number) are buttons.
        const pictured = prompt.options.filter((o) => !o.label);
        const words = prompt.options.filter((o) => o.label);
        const pic = (o) => {
          if (o.back) return `<button data-id="${o.id}" class="pick-card">${backImg()}</button>`;
          if (o.mon) return `<button data-id="${o.id}" class="pick-card"><img src="${o.mon.card.img}" alt="${esc(o.mon.name)}"><span class="sub">${o.mon.hpLeft}/${o.mon.maxHp} ${t('ui.hp')}</span></button>`;
          return `<button data-id="${o.id}" class="pick-card" data-inspect="c${o.card.uid}"><img src="${o.card.img}" alt="${esc(cardName(o.card))}"></button>`;
        };
        // Alone, word answers are the choice itself (Yes / No, a number); next to cards, they are the way out ("Nothing").
        const word = (o) => `<button data-id="${o.id}" class="${pictured.length ? 'textlink' : o.id === 'yes' ? 'primary' : 'opt-word'}">${esc(t(o.label.key, o.label.params))}</button>`;
        return `<h2>${esc(t(prompt.title, prompt.params))}</h2><p>${esc(t(prompt.text, prompt.params))}</p>
          ${pictured.length ? `<div class="choice-grid ${small ? 'small' : ''}">${pictured.map(pic).join('')}</div>` : ''}
          ${words.length ? `<div class="choice-words ${pictured.length ? 'aside' : ''}">${words.map(word).join('')}</div>` : ''}`;
      }, (body) => body.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => { closeModal(); resolve(b.dataset.id); })), 'sheet');
    });
  }

  callCoin() {
    if (this.myGame !== gameId) return stale();
    return callCoinStage();
  }

  setupBench(g, p, basics) {
    if (this.myGame !== gameId) return stale();
    return chooseBenchStage(basics);
  }
}

function openModal(html, bind, cls = '') {
  inspect(null);
  modalRenderer = { html, bind };
  $('#modal-body').className = `dialog ${cls}`.trim(); // 'sheet': a choice in the game, drawn like the card stages
  $('#modal-body').innerHTML = html();
  bind?.($('#modal-body'));
  $('#modal').hidden = false;
}
function closeModal() {
  inspect(null);
  modalRenderer = null;
  $('#modal').hidden = true;
}

// ---------------- Prize cards ----------------
// The prize stage: your face-down Prize cards fan out, you pick one, it rises to the centre, spins and flips
// to reveal itself, then glides into your hand (flyNewCards picks it up from here).
let prizeStage = null, prizeFrom = null;

function choosePrize(prompt) {
  inspect(null);
  prizeStage?.remove();
  const el = prizeStage = document.createElement('div');
  el.className = 'overlay prize-ov';
  const n = prompt.options.length;
  el.innerHTML = `<div class="prize-stage">
    <div class="cs-title">${icon('trophy')} <span>${esc(t('prompt.prize.title'))}</span></div>
    <div class="cs-sub">${esc(t('prompt.prize.text'))}</div>
    <div class="pz-row" style="--n:${n}">${prompt.options.map((o, i) => `<button class="pz-card" data-id="${o.id}" style="--i:${i};--o:${(i - (n - 1) / 2).toFixed(2)}">
      <span class="pz-flip"><img class="pz-back" src="${CARD_BACK}" alt=""><img class="pz-front" alt=""></span></button>`).join('')}</div>
    <div class="pz-caption"><b class="pz-name"></b><span class="pz-note"></span></div>
    <div class="pz-left">${esc(t('ui.prizesLeft', { n }))}</div>
  </div>`;
  document.body.append(el);
  return new Promise((resolve) => {
    el.querySelectorAll('.pz-card').forEach((b) => (b.onclick = () => {
      if (el.classList.contains('picked')) return;
      el.classList.add('picked');
      b.classList.add('chosen');
      resolve(b.dataset.id);
    }));
  });
}

async function onPrize(p, card) {
  if (p.idx !== 0) return;
  const el = prizeStage, c = el?.querySelector('.pz-card.chosen');
  if (!c) return;
  const front = c.querySelector('.pz-front');
  front.src = card.imgLarge || card.img;
  await Promise.race([front.decode?.().catch(() => {}), sleep(1200)]);
  const anim = animOn();
  // Lift the chosen card out of the row to the centre of the screen, bigger.
  // Measure the card's untransformed layout box (offsets ignore its fan rotation / hover lift).
  const st = c.offsetParent.getBoundingClientRect();
  const cx = st.left + c.offsetLeft + c.offsetWidth / 2, cy = st.top + c.offsetTop + c.offsetHeight / 2;
  const h = Math.min(innerHeight * 0.5, 400), w = h * 0.716;
  const dx = innerWidth / 2 - cx, dy = innerHeight * 0.47 - cy, s = w / c.offsetWidth;
  const flip = c.querySelector('.pz-flip');
  if (anim) {
    c.animate([{ transform: c.style.transform || getComputedStyle(c).transform }, { transform: `translate(${dx}px, ${dy}px) scale(${s})` }],
      { duration: 520, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' });
    await sleep(380);
    el.classList.add('revealing');
    // Spin while flipping face up, settling with a little overshoot.
    flip.animate([
      { transform: 'rotateY(0) rotateZ(0)' },
      { transform: 'rotateY(-200deg) rotateZ(-8deg)', offset: 0.75 },
      { transform: 'rotateY(-180deg) rotateZ(0)' },
    ], { duration: 900, easing: 'cubic-bezier(.4,.1,.3,1)', fill: 'forwards' });
    await sleep(820);
  } else {
    c.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
    flip.style.transform = 'rotateY(-180deg)';
  }
  el.classList.add('revealed');
  el.querySelector('.pz-name').textContent = cardName(card);
  el.querySelector('.pz-note').textContent = `${t('ui.prizeToHand')} · ${t('ui.prizesLeft', { n: p.prizes.length })}`;
  await sleep(anim ? 1500 : 900);
  // The engine re-renders next; the card then flies from here into your hand.
  prizeFrom = { uid: card.uid, el: front, stage: el };
  setTimeout(() => closePrizeStage(el), 1200); // in case nothing picks it up (animations off)
}

// ---------------- Rock-Paper-Scissors (Dan) ----------------
// A manga showdown (rps.js). The stage stays open from your throw through the reveal, and through ties; its words
// depend on who played Dan (`by` on the prompt, `p` on the round).
let rpsStage = null, rpsAgain = false; // rpsAgain: the last round was a tie
function rpsEl() {
  if (!rpsStage?.isConnected) {
    rpsStage = document.createElement('div');
    rpsStage.hidden = true;
    document.body.append(rpsStage);
  }
  rpsStage.classList.toggle('rps-reduced', !animOn()); // animations off: quick fades only
  return rpsStage;
}
function rpsText(by) {
  const mine = by === 0; // you played Dan
  return {
    dialog: t('rps.dialog'), title: t('rps.title'), sub: t(mine ? 'rps.subYou' : 'rps.subGary'), hint: t('rps.hint'),
    names: { rock: t('opt.rock'), paper: t('opt.paper'), scissors: t('opt.scissors') },
    chant: [t('rps.chant1'), t('rps.chant2'), t('rps.chant3')],
    you: t('rps.you'), gary: t('rps.gary'), youLabel: t('rps.youLabel'),
    win: t('rps.win'), winSub: t(mine ? 'rps.winSubYou' : 'rps.winSubGary'),
    lose: t('rps.lose'), loseSub: t(mine ? 'rps.loseSubYou' : 'rps.loseSubGary'),
    tie: t('rps.tie'), tieSub: t('rps.tieSub'), cont: t('ui.continue'),
  };
}
async function chooseRps(prompt) {
  inspect(null);
  try {
    const text = rpsText(prompt.params?.by ?? 0);
    if (rpsAgain) text.sub = t('rps.again');
    rpsAgain = false;
    return await chooseThrow(rpsEl(), text);
  } catch (e) {
    if (e === RPS_CANCEL) return stale();
    throw e;
  }
}
// Both throws are known: the chant, the impact, and the result from your side of the table.
async function showRps(ctx) {
  const el = rpsEl();
  const mine = ctx.p === 0;
  const result = mine ? ctx.result : { win: 'lose', lose: 'win', tie: 'tie' }[ctx.result];
  try {
    const r = await showdown(el, { you: mine ? ctx.a : ctx.b, gary: mine ? ctx.b : ctx.a, result, text: rpsText(ctx.p), autoCloseMs: 3200 });
    // A decided round, or the 10th tie in a row (the engine stops there with no winner), closes the stage.
    rpsAgain = !ctx.last;
    if (ctx.last) await rpsClose(el);
  } catch (e) {
    if (e !== RPS_CANCEL) throw e;
  }
}

// ---------------- Setup: your Active Pokémon and your Bench ----------------
// The same stage as the Prize cards: your Basic Pokémon fan out face up. The Active Pokémon you pick rises to
// the centre and lights up; Bench picks lift out of the fan and fly up when you confirm.
function setupStage(mode, title, sub, cards, extra = '') {
  inspect(null);
  const el = document.createElement('div');
  el.className = `overlay prize-ov setup-ov st-${mode}`;
  const n = cards.length;
  el.innerHTML = `<div class="prize-stage">
    <div class="cs-title">${icon(mode === 'bench' ? 'layers' : 'user')} <span>${esc(title)}</span></div>
    <div class="cs-sub">${esc(sub)}</div>
    <div class="pz-row" style="--n:${n}">${cards.map((c, i) => `<button class="pz-card st-card" data-uid="${c.uid}" style="--i:${i};--o:${(i - (n - 1) / 2).toFixed(2)}" aria-label="${esc(cardName(c))}">
      <img src="${c.img}" alt="" draggable="false"><span class="st-check">${icon('circle-check')}</span></button>`).join('')}</div>
    <div class="st-info">${esc(t(matchMedia('(hover: none)').matches ? (mode === 'bench' ? 'ui.setupTapBench' : 'ui.setupTap') : 'ui.setupHover'))}</div>${extra}
    <div class="pz-caption"><b class="pz-name"></b><span class="pz-note"></span></div>
  </div>`;
  document.body.append(el);
  // Each card shows what it does (HP, Weakness, attacks…) in the same tooltip as the cards on the board.
  const live = () => !el.classList.contains('picked') && !el.classList.contains('done');
  el.querySelectorAll('.st-card').forEach((b) => {
    const c = cards.find((x) => String(x.uid) === b.dataset.uid);
    b.showInfo = () => {
      if (!live()) return;
      inspect(c, null, b);
      // The stage's tooltip has no big card picture (the card is right there), so it names the card.
      $('#preview .explain')?.insertAdjacentHTML('afterbegin', `<h3 class="pv-name">${esc(cardName(c))}</h3>`);
      placePreview(b);
    };
    b.onmouseenter = b.showInfo;
    b.onfocus = () => b.matches(':focus-visible') && b.showInfo();
    b.onmouseleave = b.onblur = () => inspect(null);
    b.addEventListener('pointerdown', (e) => { b.touched = e.pointerType !== 'mouse'; });
  });
  return el;
}

// Lift a card out of its fan to the centre of the screen, bigger (as a revealed Prize card does).
function liftToCentre(c, anim) {
  const st = c.offsetParent.getBoundingClientRect();
  const cx = st.left + c.offsetLeft + c.offsetWidth / 2, cy = st.top + c.offsetTop + c.offsetHeight / 2;
  const h = Math.min(innerHeight * 0.5, 400), w = h * 0.716;
  const to = `translate(${innerWidth / 2 - cx}px, ${innerHeight * 0.47 - cy}px) scale(${w / c.offsetWidth})`;
  if (anim) c.animate([{ transform: getComputedStyle(c).transform }, { transform: to }], { duration: 520, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' });
  else c.style.transform = to;
}

function chooseActiveStage(prompt) {
  const cards = prompt.options.map((o) => o.card);
  const el = setupStage('active', t(prompt.title, prompt.params), t(prompt.text, prompt.params), cards);
  return new Promise((resolve) => {
    el.querySelectorAll('.st-card').forEach((b) => (b.onclick = async () => {
      if (el.classList.contains('picked')) return;
      if (b.touched && !b.classList.contains('armed')) {
        el.querySelectorAll('.armed').forEach((x) => x.classList.remove('armed'));
        b.classList.add('armed');
        b.showInfo();
        return;
      }
      inspect(null);
      const card = cards.find((x) => String(x.uid) === b.dataset.uid);
      const anim = animOn();
      el.classList.add('picked');
      b.classList.add('chosen');
      const img = b.querySelector('img');
      if (card.imgLarge) img.src = card.imgLarge;
      liftToCentre(b, anim);
      await sleep(anim ? 420 : 0);
      el.classList.add('revealing', 'revealed');
      el.querySelector('.pz-name').textContent = cardName(card);
      el.querySelector('.pz-note').textContent = t('ui.activeNote');
      await sleep(anim ? 1300 : 500);
      closePrizeStage(el);
      resolve(prompt.options.find((o) => o.card === card).id);
    }));
  });
}

function chooseBenchStage(basics) {
  const picked = new Set(basics.slice(0, 5).map((c) => c.uid));
  const el = setupStage('bench', t('ui.benchTitle'), t('ui.benchText'), basics,
    `<div class="st-actions"><span class="st-count"></span><button class="primary st-ok">${icon('circle-check')} ${esc(t('ui.confirm'))}</button></div>`);
  const count = () => { el.querySelector('.st-count').textContent = t('ui.benchCount', { n: picked.size }); };
  el.querySelectorAll('.st-card').forEach((b) => {
    b.classList.toggle('sel', picked.has(Number(b.dataset.uid)));
    b.onclick = () => {
      const uid = Number(b.dataset.uid);
      if (picked.has(uid)) picked.delete(uid);
      else if (picked.size < 5) picked.add(uid);
      b.classList.toggle('sel', picked.has(uid));
      count();
      b.showInfo(); // a click hides the tooltip; keep showing the card it was about
    };
  });
  count();
  return new Promise((resolve) => {
    el.querySelector('.st-ok').onclick = async () => {
      if (el.classList.contains('done')) return;
      el.classList.add('done');
      inspect(null);
      await sleep(animOn() ? 520 : 0);
      closePrizeStage(el);
      resolve([...picked]);
    };
  });
}

// Close one particular prize stage. With several Prize cards to take, the next stage may already be open,
// and a late close for the previous card must never close it (that left the pick unanswered and froze the game).
function closePrizeStage(el) {
  if (!el || el.classList.contains('closing')) return;
  if (prizeStage === el) prizeStage = null;
  if (prizeFrom?.stage === el) prizeFrom = null;
  el.classList.add('closing');
  setTimeout(() => el.remove(), 260);
}

// ---------------- Game lifecycle ----------------
function makeAIController(myGame) {
  const ai = new AIController({
    onThinking: (on) => {
      if (myGame !== gameId) return;
      if (on) oppStatus('ui.thinking', {}, true);
      else if (oppState.thinking) oppStatus();
    },
    onDecision: (act, ans) => { if (myGame === gameId) oppStatus('ui.oppChose', { a: { $t: act.label }, p: pct(ans.confidence) }); },
    onError: (err) => {
      if (myGame !== gameId) return;
      // Say which engine failed and why: no credits (402) is something the user can fix in the Jev account.
      const key = err.status === 402 || err.kind === 'billing_error' ? 'ui.aiCredits' : engine?.engine === 'jev' ? 'ui.aiErrorJev' : 'ui.aiError';
      const short = String(err.message).slice(0, 120);
      oppStatus(key, { e: short });
      log({ key, params: { e: short }, kind: 'warn' });
    },
  });
  const choose = ai.chooseAction.bind(ai);
  ai.chooseAction = async (...args) => {
    if (myGame !== gameId) return stale();
    clearActions(`<div class="waiting">${esc(t('ui.waitingOpp'))}</div>`);
    if (pendingAnims.size) await Promise.all([...pendingAnims]);
    $('#tips').innerHTML = '';
    await sleep(450);
    const act = await choose(...args);
    await sleep(550);
    return myGame === gameId ? act : stale();
  };
  return ai;
}

// ---------------- Saved game (localStorage) ----------------
// The game is saved before every decision, so a reload resumes at the latest move.
const SAVE_KEY = 'tcg-academy-save-v2'; // v2: cards are stored by set id
function saveGame(g) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      game: g.serialize(), log: logEntries.filter((e) => e.key !== 'ui.restored').slice(-400), coach: coachState, win: winState, model: aiConfig.model,
    }));
  } catch { /* storage full or unavailable: keep playing without saving */ }
}
function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; }
}

function resetTable() {
  lastDamage.clear();
  arrivingCards.clear();
  seenHand = new Set();
  seenPrizes = [new Set(), new Set()];
  seenOppHand = 0;
  decision = null;
  winState = null;
  $('#win-meter').hidden = true;
  $('#start').hidden = true;
  $('#table').hidden = false;
  coachMsg('ui.coachIdle');
  oppStatus();
  inspect(null);
}

function gameHooks(myGame) {
  return {
    onLog: (e) => myGame === gameId && log(e),
    onUpdate: () => myGame === gameId && render(),
    pause: (ms) => sleep(ms),
    onCoin: (ctx) => (myGame === gameId ? showCoin(ctx) : stale()),
    onRps: (ctx) => (myGame === gameId ? showRps(ctx) : stale()),
    onAttack: (info) => (myGame === gameId ? arenaOpen(info) : stale()),
    onAttach: (info) => (myGame === gameId ? onAttach(info) : stale()),
    onEvolve: (info) => (myGame === gameId ? onEvolve(info) : stale()),
    onBench: (info) => (myGame === gameId ? onBench(info) : undefined),
    onTrainer: (info) => (myGame === gameId ? onTrainer(info) : stale()),
    onHit: (info) => (myGame === gameId ? onHit(info) : stale()),
    onAttackEnd: () => (myGame === gameId ? arenaClose() : stale()),
    onPrize: (p, card) => (myGame === gameId ? onPrize(p, card) : stale()),
    onCheckpoint: (g) => myGame === gameId && saveGame(g),
    onGameOver: (g) => { if (myGame === gameId) { clearSave(); gameOver(g); } },
  };
}

async function startGame(deckKey) {
  const myGame = ++gameId;
  const others = Object.keys(DECKS).filter((k) => k !== deckKey && formatOf(k) === formatOf(deckKey));
  const oppDeck = oppChoice !== 'random' && oppChoice !== deckKey && formatOf(oppChoice) === formatOf(deckKey) ? oppChoice : others[Math.floor(Math.random() * others.length)];
  await Promise.all([loadDeck(deckKey), loadDeck(oppDeck)]);
  if (myGame !== gameId) return;
  clearSave();
  undoStack = [];
  logEntries = [];
  renderLog();
  resetTable();
  animateDraws = true;

  game = new Game({ decks: [deckKey, oppDeck], controllers: [new HumanController(myGame), makeAIController(myGame)], hooks: gameHooks(myGame) });
  log({ key: 'log.decks', params: { a: DECKS[deckKey].name, b: DECKS[oppDeck].name }, kind: 'sys' });
  render();
  await game.run();
}

async function resumeGame(save, { note = { key: 'ui.restored', params: {} } } = {}) {
  const myGame = ++gameId;
  await Promise.all(save.game.players.map((p) => loadDeck(p.deckKey)));
  logEntries = (save.log || []).filter((e) => e.key !== 'ui.restored');
  resetTable();
  game = Game.restore(save.game, { controllers: [new HumanController(myGame), makeAIController(myGame)], hooks: gameHooks(myGame) });
  log({ ...note, kind: 'sys' });
  renderLog();
  if (save.coach) coachMsg(save.coach.key, save.coach.params, save.coach.cls);
  if (save.win) showWin(save.win);
  render();            // restored hand appears in place, without the draw animation
  animateDraws = true;
  await game.run({ resume: true });
}

// ---------------- Undo ----------------
// A learning aid (real games have no take-backs): you can undo your own moves within the current turn,
// as long as they revealed nothing new — no cards drawn or searched, no coin flipped.
const UNDOABLE_TRAINERS = new Set(['potion', 'superPotion', 'switch', 'gust', 'plusPower', 'defender', 'energyRemoval', 'superEnergyRemoval']);
let undoStack = [];

function rememberForUndo(g, a) {
  const undoable = ['energy', 'bench', 'evolve', 'retreat'].includes(a.kind) || (a.kind === 'trainer' && UNDOABLE_TRAINERS.has(a.tkind));
  if (!undoable) { undoStack = []; return; }
  if (undoStack.length && undoStack.at(-1).turn !== g.turn) undoStack = [];
  undoStack.push({ snap: JSON.stringify(g.serialize()), logLen: logEntries.length, label: a.label, turn: g.turn, coach: coachState, win: winState });
}

function undoLast() {
  const u = undoStack.pop();
  if (!u || !game || game.current?.idx !== 0) return;
  resumeGame({ game: JSON.parse(u.snap), log: logEntries.slice(0, u.logLen), coach: u.coach, win: u.win },
    { note: { key: 'log.undo', params: { a: { $t: u.label } } } });
}

function undoButton() {
  const u = undoStack.at(-1);
  if (!u || !game || u.turn !== game.turn || game.current?.idx !== 0) return '';
  return `<button class="undo-btn" id="undo-btn" title="${esc(t('tip.undo'))}">${icon('rotate-ccw')} ${esc(t('ui.undo', { a: { $t: u.label } }))}</button>`;
}

function gameOver(g) {
  decision = null;
  clearActions();
  $('#tips').innerHTML = '';
  oppStatus();
  openModal(() => {
    const [ic, title] = g.winner === 'draw' ? ['handshake', t('ui.drawGame')] : g.winner.idx === 0 ? ['trophy', t('ui.youWin')] : ['frown', t('ui.oppWins')];
    return `<p class="over-title">${icon(ic)} ${esc(title)}</p><p>${esc(t(g.winReason.key, g.winReason.params))}</p>
      <p>${esc(t('ui.overText'))}</p>
      <div class="row"><button id="over-close">${esc(t('ui.lookBoard'))}</button><button class="primary" id="over-new">${esc(t('ui.new'))}</button></div>`;
  }, () => {
    $('#over-close').onclick = closeModal;
    $('#over-new').onclick = () => { closeModal(); openStart(); };
  });
}

// Deck chooser: uniform tiles with the deck's colours, its featured cards, a short description and its make-up.
let oppChoice = 'random';

function deckStats(d) {
  if (d.lazy) return d.counts;
  const n = { pokemon: 0, trainer: 0, energy: 0 };
  for (const [id, c] of Object.entries(d.list)) n[CARDS[id].kind] += c;
  return n;
}

function deckTile(k, d) {
  const s = deckStats(d);
  const [c1, c2 = c1] = d.types;
  const chips = d.types.map((x) => `<span class="chip">${energyIcon(x)}${esc(t('type.' + x))}</span>`).join('');
  return `<button class="deck ${k === selectedDeck ? 'sel' : ''}" data-deck="${k}" aria-pressed="${k === selectedDeck}" style="--c1:var(--${c1});--c2:var(--${c2})">
    <div class="deck-art"><div class="fan">${d.featured.map((n, i) => `<img src="${d.featuredImgs?.[i] || CARDS[n].img}" alt="" loading="lazy">`).join('')}</div></div>
    <div class="deck-body">
      <div class="d-name">${esc(d.name)}</div>
      <div class="d-sub">${esc(t('deck.' + k))}</div>
      <div class="d-types">${chips}</div>
      <div class="d-stats"><span><b>${s.pokemon}</b> Pokémon</span><span><b>${s.trainer}</b> ${esc(t('ui.trainers'))}</span><span><b>${s.energy}</b> ${esc(t('ui.energies'))}</span></div>
    </div>
  </button>`;
}

// Classic (1999–2000 rules) or Modern (Scarlet & Violet rules) decks; the choice is remembered.
let deckFormat = (() => { try { return localStorage.getItem('tcg-format') || 'classic'; } catch { return 'classic'; } })();
const formatOf = (k) => DECKS[k]?.format || 'classic';

// The rules that change between the two eras, as numbers you can read at a glance (the full text is on the rules page).
const FORMAT_RULES = {
  classic: ['trainers', 'prizeEach', 'powers'],
  modern: ['supporter', 'stadium', 'items', 'prize2', 'prize3', 'gx', 'abilities'],
};
// Three cards of the first deck of each era stand for it on its tab.
function eraCards(f) {
  const groups = f === 'modern' ? MODERN_GROUPS : DECK_GROUPS;
  const d = Object.values(DECKS).find((x) => x.group === groups[0]);
  return d ? d.featured.slice(0, 3).map((n, i) => d.featuredImgs?.[i] || CARDS[n]?.img).filter(Boolean) : [];
}

function renderDeckChoices() {
  if (selectedDeck && formatOf(selectedDeck) !== deckFormat) selectedDeck = null;
  const groups = deckFormat === 'modern' ? MODERN_GROUPS : DECK_GROUPS;
  const tabs = `<div class="format-tabs" role="group" aria-label="${esc(t('ui.formatPick'))}">${['classic', 'modern'].map((f) => `
    <button class="ftab ${f === deckFormat ? 'on' : ''}" data-format="${f}" aria-pressed="${f === deckFormat}">
      <span class="era-fan" aria-hidden="true">${eraCards(f).map((src) => `<img src="${src}" alt="" loading="lazy">`).join('')}</span>
      <span class="era-text"><b>${esc(t('format.' + f))}</b><small>${esc(t('format.' + f + '.sub'))}</small></span></button>`).join('')}</div>
    <ul class="rule-strip" aria-label="${esc(t('format.' + deckFormat + '.rulesTitle'))}">${FORMAT_RULES[deckFormat].map((k) => {
      const n = t(`fr.${k}.n`);
      return `<li class="rule${n ? '' : ' wide'}">${n ? `<b>${esc(n)}</b>` : ''}<span>${esc(t(`fr.${k}.t`))}</span></li>`;
    }).join('')}</ul>`;
  $('#deck-choices').innerHTML = tabs + groups.map((g) => `
    <section class="deck-section">
      <div class="deck-group"><span>${esc(t('deckgroup.' + g))}</span><small>${esc(t('deckgroup.' + g + '.sub'))}</small></div>
      <div class="deck-grid ${g}">${Object.entries(DECKS).filter(([, d]) => d.group === g).map(([k, d]) => deckTile(k, d)).join('')}</div>
    </section>`).join('');
  document.querySelectorAll('.ftab').forEach((b) => (b.onclick = () => {
    if (b.dataset.format === deckFormat) return;
    deckFormat = b.dataset.format;
    try { localStorage.setItem('tcg-format', deckFormat); } catch { /* storage unavailable */ }
    oppChoice = 'random';
    renderDeckChoices();
    document.querySelector(`.ftab[data-format="${deckFormat}"]`)?.focus(); // the buttons were rebuilt
  }));
  document.querySelectorAll('.deck').forEach((b) => (b.onclick = async () => {
    const key = b.dataset.deck;
    selectedDeck = key;
    document.querySelectorAll('.deck').forEach((x) => { x.classList.toggle('sel', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    if (DECKS[key].lazy) {
      // Modern decks are downloaded when picked.
      b.classList.add('loading');
      deckLoading = true;
      renderStartBar();
      try { await loadDeck(key); } finally { b.classList.remove('loading'); deckLoading = false; }
      if (selectedDeck !== key) return;
    }
    renderStartBar();
  }));
  renderStartBar();
}

let deckLoading = false;
function renderStartBar() {
  if (oppChoice === selectedDeck) oppChoice = 'random';
  // Gary's decks grouped like the deck chooser (same group names and order), so same-named decks are told apart.
  const eligible = Object.entries(DECKS).filter(([k]) => k !== selectedDeck && formatOf(k) === deckFormat);
  const groups = deckFormat === 'modern' ? MODERN_GROUPS : DECK_GROUPS;
  const byGroup = groups.map((g) => [g, eligible.filter(([, d]) => d.group === g)]);
  const rest = eligible.filter(([, d]) => !groups.includes(d.group));
  if (rest.length) byGroup.push([null, rest]);
  const option = (v, l) => `<option value="${v}" ${v === oppChoice ? 'selected' : ''}>${esc(l)}</option>`;
  $('#opt-opp').innerHTML = option('random', t('ui.oppRandom')) + byGroup.filter(([, l]) => l.length)
    .map(([g, l]) => `<optgroup label="${esc(g ? t('deckgroup.' + g) : t('ui.otherDecks'))}">${l.map(([k, d]) => option(k, d.name)).join('')}</optgroup>`).join('');
  const mine = selectedDeck ? DECKS[selectedDeck].name : t('ui.pickFirst');
  const theirs = oppChoice === 'random' ? t('ui.oppRandom') : DECKS[oppChoice].name;
  // Gary's side of the matchup is the deck picker itself.
  $('#match-you').innerHTML = `<small>${esc(t('pl.0'))}</small><b>${esc(mine)}</b>`;
  $('#match-you').classList.toggle('empty', !selectedDeck);
  $('#opt-opp').title = theirs;
  $('#btn-start').disabled = !selectedDeck || deckLoading;
  $('#btn-start').innerHTML = deckLoading ? `${icon('loader')} ${esc(t('ui.loadingDeck'))}` : selectedDeck ? esc(t('ui.start')) : esc(t('ui.pickFirst'));
}

function openStart() {
  renderDeckChoices();
  $('#start').hidden = false;
}

function switchLanguage(lang) {
  setLang(lang);
  applyStaticText();
  renderDeckChoices();
  render();
  renderLog();
  renderDecision();
  renderCoach();
  renderOppStatus();
  if (winState) showWin(winState);
  if (engine) applyEngine(engine);
  if (modalRenderer) { $('#modal-body').innerHTML = modalRenderer.html(); modalRenderer.bind?.($('#modal-body')); }
  inspect(null);
}

document.querySelectorAll('.lang button').forEach((b) => (b.onclick = () => switchLanguage(b.dataset.lang)));
$('#opt-hints').onchange = renderDecision;
document.querySelectorAll('.dice-pick .die-slot').forEach((el) => { el.innerHTML = dieFace(5, el.dataset.die); });
document.querySelectorAll('input[name="dice"]').forEach((r) => (r.onchange = () => {
  diceStyle = r.value;
  try { localStorage.setItem('diceStyle', diceStyle); } catch { /* storage unavailable */ }
  render();
  applyStaticText();
}));
$('#btn-start').onclick = () => startGame(selectedDeck);
$('#opt-opp').onchange = (e) => { oppChoice = e.target.value; renderStartBar(); };
$('#btn-new').onclick = () => {
  const inProgress = game && !game.winner && !$('#table').hidden;
  if (!inProgress) { closeModal(); openStart(); return; }
  openModal(() => `<h2>${icon('rotate-ccw')} ${esc(t('ui.newConfirm.title'))}</h2><p>${esc(t('ui.newConfirm.text'))}</p>
    <div class="row"><button id="new-cancel">${esc(t('ui.cancel'))}</button><button class="primary danger" id="new-ok">${esc(t('ui.newConfirm.ok'))}</button></div>`,
  () => {
    $('#new-cancel').onclick = closeModal;
    $('#new-ok').onclick = abandonGame;
  });
};

// Cancel the current game: its async turn loop goes stale, overlays close and the saved state is deleted.
function abandonGame() {
  gameId++;
  game = null;
  decision = null;
  undoStack = [];
  if (drag) endDrag(true);
  callStage?.remove();
  callStage = null;
  document.querySelectorAll('.coin-ov, .arena, .fly, .tumble, .float-dmg, .burst, .drop-menu').forEach((x) => x.remove());
  if (rpsStage) { rpsReset(rpsStage); rpsStage.remove(); rpsStage = null; }
  rpsAgain = false;
  arena = null;
  document.body.classList.remove('arena-on');
  clearSave();
  closeModal();
  clearActions();
  oppStatus();
  $('#table').hidden = true;
  openStart();
}
$('#btn-tour').onclick = () => runTour();
$('#btn-settings').onclick = openSettings;
$('#engine-badge').onclick = openSettings;
let settingsFrom = null; // where focus goes back to when Settings closes
function closeSettings() {
  $('#settings').hidden = true;
  settingsFrom?.focus?.();
  settingsFrom = null;
}
$('#settings-close').onclick = closeSettings;
$('#settings').onclick = (e) => { if (e.target.id === 'settings') closeSettings(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#settings').hidden) closeSettings(); });
// Remember the settings between visits.
for (const id of ['opt-coach', 'opt-hints', 'opt-anim']) {
  try { const v = localStorage.getItem(id); if (v != null) $('#' + id).checked = v === '1'; } catch { /* storage unavailable */ }
  $('#' + id).addEventListener('change', (e) => { try { localStorage.setItem(id, e.target.checked ? '1' : '0'); } catch { /* ignore */ } });
}
// The rules page highlights the rules you are playing with (or the tab picked on the start screen).
$('#btn-rules').onclick = $('#start-rules').onclick = () => {
  const fmt = game && $('#start').hidden ? (game.modern ? 'modern' : 'classic') : deckFormat;
  $('#rules-body').dataset.format = fmt;
  document.querySelectorAll('#rules-body thead th[class]').forEach((th) => { th.dataset.you = th.classList.contains('c-' + fmt) ? t('rules.youPlay') : ''; });
  $('#rules').hidden = false;
};
$('#rules-close').onclick = () => { $('#rules').hidden = true; };
$('#rules').onclick = (e) => { if (e.target.id === 'rules') $('#rules').hidden = true; };
applyStaticText();
inspect(null);
// Know which engine Gary uses before a saved game picks up again (until then he and the Professor use the CPU engine).
await Promise.race([refreshEngine(), new Promise((r) => setTimeout(r, 1500))]);
const saved = loadSave();
if (saved?.game) resumeGame(saved).catch(() => { clearSave(); openStart(); });
else openStart();
