// Rock-Paper-Scissors stage for Dan (a shōnen-manga showdown): the choice, the "jan-ken-pon" chant, the impact frame
// and the result. The text comes from the app (ui.js builds it from i18n), so the stage stays language-free.
/* =====================================================================
   Rock-Paper-Scissors stage — "Shōnen battle manga" direction.
   Public API:
     hand(kind, side)                           – SVG string, kind rock|paper|scissors, side you|gary
     chooseThrow(stageEl, text[, {autoPick}])   – resolves 'rock'|'paper'|'scissors'
     showdown(stageEl, {you, gary, result, text[, autoCloseMs]})
                                                – resolves result ('tie' right after the tie beat,
                                                  'win'/'lose' when Continue is pressed or autoCloseMs elapses)
     rpsJudge(you, gary) / rpsReset(stageEl) / rpsClose(stageEl)
   ===================================================================== */

/* katakana accents (decorative, aria-hidden) */
const RPS_KANA = {
  eyebrow: 'ジャンケン', menace: 'ゴ', sparkle: 'キラッ',
  chant: ['ジャン', 'ケン', 'ポン!'], impact: 'ドン!',
  pick: { rock: 'グー', paper: 'パー', scissors: 'チョキ' },
  result: { win: 'ヤッタ!', lose: 'ガーン!', tie: 'あいこでしょ!' }
};
const RPS_KINDS = ['rock', 'paper', 'scissors'];
const RPS_BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const RPS_CANCEL = { rpsCancel: true };
const RPS_EASE = { back: 'cubic-bezier(.34,1.56,.64,1)', out: 'cubic-bezier(.2,.8,.3,1)', in: 'cubic-bezier(.6,0,.9,.4)' };

function rpsJudge(you, gary) {
  if (you === gary) return 'tie';
  return RPS_BEATS[you] === gary ? 'win' : 'lose';
}

/* ============================ HAND ART ============================ */
const RPS_INK = '#12142a';
const RPS_SKIN = { base: '#ffd8b8', shade: '#f0a284', hi: '#fff6ee', crease: '#c46f52', nail: '#ffeae0' };
const RPS_SIDES = {
  you:  { sleeve: '#2a75bb', sleeveSh: '#174a82', cuff: '#f4f7ff', cuffSh: '#c3cde6', stripe: '#2a75bb' },
  gary: { sleeve: '#d33b3b', sleeveSh: '#8f2121', cuff: '#f4f7ff', cuffSh: '#c3cde6', stripe: '#d33b3b' }
};
let rpsUid = 0;

/* finger = capsule standing on base point (bx,by), width w, length L, tilted ang° */
function rpsFinger(bx, by, w, L, ang) {
  return { t: 'rect', a: { x: -w / 2, y: -L, width: w, height: L + 18, rx: w / 2 },
           tf: 'translate(' + bx + ' ' + by + ') rotate(' + ang + ')', w: w, L: L };
}
function rpsBox(x, y, w, h, r) { return { t: 'rect', a: { x: x, y: y, width: w, height: h, rx: r } }; }
function rpsHiStroke(d, tf) {
  return '<path d="' + d + '" stroke="' + RPS_SKIN.hi + '" stroke-width="4.5" stroke-linecap="round" fill="none"' + (tf ? ' transform="' + tf + '"' : '') + '/>';
}

/* Poses are drawn pointing UP (palm side to viewer), wrist at y≈200, in a 200×260 box.
   parts: [shape, shadowDx, shadowDy] drawn in z-order with a cel shadow on their lower-right. */
const RPS_POSES = {
  rock: function () {
    const palm = { t: 'path', a: { d: 'M50 110 Q50 92 68 92 L136 92 Q153 92 153 110 L153 158 Q153 190 128 200 L74 200 Q50 190 50 160 Z' } };
    const thenar = { t: 'ellipse', a: { cx: 61, cy: 162, rx: 22, ry: 31 } };
    const f1 = rpsBox(47, 62, 30, 66, 15), f2 = rpsBox(75, 55, 30, 72, 15), f3 = rpsBox(103, 59, 28, 68, 14), f4 = rpsBox(129, 70, 25, 58, 12.5);
    const thumb = { t: 'rect', a: { x: 34, y: 119, width: 92, height: 31, rx: 15.5 }, tf: 'rotate(-7 50 135)' };
    const nail = { t: 'rect', a: { x: 104, y: 125, width: 16, height: 17, rx: 6 }, tf: 'rotate(-7 50 135)' };
    return {
      parts: [[palm, 9, 7], [thenar, 6, 6], [f1, 6, 6], [f2, 6, 6], [f3, 6, 6], [f4, 5, 6], [thumb, 3, 7]],
      silhouette: [palm, thenar, f1, f2, f3, f4, thumb],
      lines: ['M76.5 72 Q75.6 98 77 120', 'M103.5 68 Q102.6 95 104 119', 'M130 80 Q129.2 100 130.5 120'],
      outlined: [thumb], nails: [nail],
      creases: ['M70 172 Q78 182 76 194'],
      hi: [
        '<ellipse cx="57" cy="76" rx="3.6" ry="8"/>', '<ellipse cx="85" cy="70" rx="3.6" ry="8.5"/>',
        '<ellipse cx="112" cy="73" rx="3.4" ry="8"/>', '<ellipse cx="137" cy="83" rx="3" ry="6.5"/>',
        rpsHiStroke('M50 127 L88 122', 'rotate(-7 50 135)')
      ]
    };
  },
  paper: function () {
    const palm = { t: 'path', a: { d: 'M52 118 Q52 98 70 96 L134 96 Q151 98 151 118 L149 162 Q147 190 126 200 L74 200 Q55 190 54 164 Z' } };
    const thumb = rpsFinger(66, 166, 28, 54, -52);
    const f1 = rpsFinger(73, 108, 24, 80, -13), f2 = rpsFinger(97, 102, 25, 88, -3), f3 = rpsFinger(120, 105, 24, 80, 8), f4 = rpsFinger(141, 116, 21, 60, 20);
    const hi = [f1, f2, f3, f4].map(function (f) {
      return '<ellipse cx="' + (-f.w / 2 + 6.5) + '" cy="' + (-f.L + f.w / 2 + 3) + '" rx="3" ry="7" transform="' + f.tf + '"/>';
    });
    hi.push('<ellipse cx="-7" cy="-38" rx="3.2" ry="7" transform="' + thumb.tf + '"/>');
    hi.push(rpsHiStroke('M63 112 Q60 126 63 138'));
    return {
      parts: [[thumb, 4, 7], [f4, 5, 5], [f3, 6, 5], [f2, 6, 5], [f1, 6, 5], [palm, 9, 8]],
      silhouette: [thumb, f1, f2, f3, f4, palm],
      lines: [], outlined: [], nails: [],
      creases: ['M141 130 Q118 124 100 140', 'M82 124 Q94 152 87 188', 'M120 150 Q110 160 112 174'],
      hi: hi
    };
  },
  scissors: function () {
    const palm = { t: 'path', a: { d: 'M51 116 Q51 98 68 98 L136 98 Q153 98 153 114 L153 160 Q153 190 128 200 L74 200 Q51 190 51 162 Z' } };
    const thenar = { t: 'ellipse', a: { cx: 61, cy: 165, rx: 22, ry: 30 } };
    const idx = rpsFinger(78, 118, 26, 98, -16), mid = rpsFinger(104, 114, 26, 100, 14);
    const ring = rpsBox(114, 86, 26, 60, 13), pinky = rpsBox(136, 97, 22, 50, 11);
    const thumb = { t: 'rect', a: { x: 36, y: 133, width: 96, height: 31, rx: 15.5 }, tf: 'rotate(-6 52 148)' };
    const nail = { t: 'rect', a: { x: 110, y: 139, width: 16, height: 17, rx: 6 }, tf: 'rotate(-6 52 148)' };
    const hi = [idx, mid].map(function (f) {
      return '<ellipse cx="' + (-f.w / 2 + 7) + '" cy="' + (-f.L + f.w / 2 + 3) + '" rx="3.2" ry="8" transform="' + f.tf + '"/>';
    });
    hi.push('<ellipse cx="122" cy="98" rx="3.2" ry="7"/>', '<ellipse cx="143" cy="107" rx="2.8" ry="6"/>');
    hi.push(rpsHiStroke('M52 141 L90 137', 'rotate(-6 52 148)'));
    return {
      parts: [[idx, 6, 5], [mid, 6, 5], [palm, 9, 7], [thenar, 6, 6], [ring, 6, 6], [pinky, 5, 6], [thumb, 3, 7]],
      silhouette: [idx, mid, palm, thenar, ring, pinky, thumb],
      lines: ['M115.5 96 Q114.4 118 116 136', 'M137.5 106 Q136.6 122 138 138'],
      outlined: [thumb], nails: [nail],
      creases: ['M70 176 Q78 184 76 195'],
      hi: hi
    };
  }
};

function rpsTag(p, extra) {
  const a = Object.assign({}, p.a, extra || {});
  if (p.tf) a.transform = p.tf;
  let s = '<' + p.t;
  for (const k in a) s += ' ' + k + '="' + a[k] + '"';
  return s + '/>';
}

/* hand(kind, side) → SVG string. Sticker technique: every shape is first drawn with a thick
   ink stroke, then fill-only on top, so overlapping fingers merge into one bold outline.
   Each part gets a flat base + one cel-shadow tone (clip + offset), then ink detail lines + highlights.
   Points UP with the sleeve below (sleeve runs far past the box: show it with overflow:visible).
   Gary's hand is the same drawing mirrored, with a red sleeve. */
function hand(kind, side) {
  const pose = (RPS_POSES[kind] || RPS_POSES.rock)();
  const c = RPS_SIDES[side] || RPS_SIDES.you;
  const id = 'rpsh' + (++rpsUid);
  const sleeve = { t: 'path', a: { d: 'M47 206 L153 206 L182 660 L18 660 Z' } };
  const cuff = rpsBox(39, 181, 122, 36, 12);
  let defs = '', body = '', n = 0;
  function shade(p, base, shadow, dx, dy) {
    const cid = id + 'c' + (n++);
    defs += '<clipPath id="' + cid + '">' + rpsTag(p) + '</clipPath>';
    return '<g clip-path="url(#' + cid + ')">' + rpsTag(p, { fill: shadow }) +
      '<g transform="translate(' + (-dx) + ' ' + (-dy) + ')">' + rpsTag(p, { fill: base }) + '</g></g>';
  }
  const outline = '<g fill="' + RPS_INK + '" stroke="' + RPS_INK + '" stroke-width="14" stroke-linejoin="round">' +
    [sleeve, cuff].concat(pose.silhouette).map(function (p) { return rpsTag(p); }).join('') + '</g>';
  body += shade(sleeve, c.sleeve, c.sleeveSh, 16, 0);
  body += '<g fill="none" stroke="' + RPS_INK + '" stroke-width="4" stroke-linecap="round" opacity=".55">' +
    '<path d="M68 236 Q76 252 72 272"/><path d="M128 246 Q122 260 126 278"/></g>';
  pose.parts.forEach(function (pp) { body += shade(pp[0], RPS_SKIN.base, RPS_SKIN.shade, pp[1], pp[2]); });
  pose.nails.forEach(function (p) { body += rpsTag(p, { fill: RPS_SKIN.nail, stroke: RPS_SKIN.crease, 'stroke-width': 2.6 }); });
  body += '<g fill="none" stroke="' + RPS_SKIN.crease + '" stroke-width="3.2" stroke-linecap="round">' +
    pose.creases.map(function (d) { return '<path d="' + d + '"/>'; }).join('') + '</g>';
  body += '<g fill="none" stroke="' + RPS_INK + '" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round">' +
    pose.lines.map(function (d) { return '<path d="' + d + '"/>'; }).join('') +
    pose.outlined.map(function (p) { return rpsTag(p); }).join('') + '</g>';
  body += '<g fill="' + RPS_SKIN.hi + '">' + pose.hi.join('') + '</g>';
  body += shade(cuff, c.cuff, c.cuffSh, 10, 6);
  body += '<rect x="39" y="196" width="122" height="9" fill="' + c.stripe + '"/>';
  body += rpsTag(cuff, { fill: 'none', stroke: RPS_INK, 'stroke-width': 4.5 });
  body += '<path d="M48 190 L80 190" stroke="#fff" stroke-width="4" stroke-linecap="round"/>';
  const flip = side === 'gary' ? ' transform="translate(200 0) scale(-1 1)"' : '';
  return '<svg class="rps-hand rps-hand-' + kind + ' rps-hand-' + (side === 'gary' ? 'gary' : 'you') + '" viewBox="0 0 200 260" aria-hidden="true" focusable="false">' +
    '<defs>' + defs + '</defs><g' + flip + '>' + outline + body + '</g></svg>';
}

/* ============================ SMALL HELPERS ============================ */
function rpsEsc(s) {
  return String(s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; });
}
/* inked "sticker" text, always decorative (aria-hidden) */
function rpsInk(text, cls, style) {
  const t = rpsEsc(text);
  return '<span class="rps-ink ' + (cls || '') + '"' + (style ? ' style="' + style + '"' : '') + ' data-text="' + t + '" aria-hidden="true">' + t + '</span>';
}
function rpsRand(seed) { /* mulberry32 */
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rpsReduced(stageEl) {
  return stageEl.classList.contains('rps-reduced') ||
    !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
/* every WAAPI animation goes through here so a reset can cancel the whole stage */
function rpsAnim(stageEl, el, kf, opt) {
  if (!el || !el.animate) return null;
  const a = el.animate(kf, opt);
  (stageEl._rpsAnims || (stageEl._rpsAnims = new Set())).add(a);
  return a;
}
function rpsStopAnims(stageEl) {
  if (!stageEl._rpsAnims) return;
  stageEl._rpsAnims.forEach(function (a) { try { a.cancel(); } catch (e) { /* ignore */ } });
  stageEl._rpsAnims.clear();
}
function rpsWait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function rpsGuard(stageEl, tok) { if (stageEl._rpsTok !== tok) throw RPS_CANCEL; }

/* jagged star points (for sparks, bursts, aura) */
function rpsStarPts(n, ro, ri, rnd, sx, sy, jit) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = i / (n * 2) * Math.PI * 2 - Math.PI / 2;
    let r = i % 2 ? ri : ro;
    if (jit) r *= 1 - jit + rnd() * jit * 2;
    pts.push((Math.cos(a) * r * (sx || 1)).toFixed(1) + ',' + (Math.sin(a) * r * (sy || 1)).toFixed(1));
  }
  return pts.join(' ');
}
/* radial speed lines: thin wedges from an inner radius out past the corners */
function rpsLinesSvg(cls, seed, n, r0a, r0b, wa, wb) {
  const rnd = rpsRand(seed), R = 580;
  let d = '';
  const p = function (r, t) { return (r * Math.cos(t)).toFixed(1) + ' ' + (r * Math.sin(t)).toFixed(1); };
  for (let i = 0; i < n; i++) {
    const a = (i + rnd() * .9) / n * Math.PI * 2;
    const r0 = r0a + rnd() * (r0b - r0a);
    const hw = (wa + rnd() * (wb - wa)) / R;
    d += 'M' + p(r0, a) + 'L' + p(R, a + hw) + 'L' + p(R, a - hw) + 'Z';
  }
  return '<svg class="' + cls + '" viewBox="-400 -400 800 800" aria-hidden="true" focusable="false"><path fill="#fff" d="' + d + '"/></svg>';
}
const RPS_STAR = '<svg viewBox="-12 -12 24 24" aria-hidden="true" focusable="false"><path d="M0 -11 Q1.8 -1.8 11 0 Q1.8 1.8 0 11 Q-1.8 1.8 -11 0 Q-1.8 -1.8 0 -11Z" fill="#fff6b0" stroke="#12142a" stroke-width="1.6" stroke-linejoin="round"/></svg>';

/* ============================ STAGE SKELETON ============================ */
function rpsSkeleton(stageEl) {
  if (stageEl._rps && stageEl._rps.world.isConnected) return stageEl._rps;
  stageEl.classList.add('rps-stage');
  if (!stageEl.hasAttribute('role')) stageEl.setAttribute('role', 'dialog');
  stageEl.setAttribute('aria-modal', 'true');
  stageEl.innerHTML =
    '<div class="rps-world">' +
      '<div class="rps-tone"></div>' +
      '<div class="rps-cam"><div class="rps-shake">' +
        '<div class="rps-lines rps-focus">' + rpsLinesSvg('rps-la', 11, 90, 150, 240, 1.4, 5) + rpsLinesSvg('rps-lb', 23, 90, 150, 240, 1.4, 5) + '</div>' +
        '<div class="rps-lines rps-burst">' + rpsLinesSvg('rps-ba', 37, 70, 96, 150, 3, 12) + rpsLinesSvg('rps-bb', 41, 70, 96, 150, 3, 12) + '</div>' +
        '<div class="rps-view"></div>' +
      '</div></div>' +
      '<div class="rps-bar rps-bar-top"></div><div class="rps-bar rps-bar-bot"></div>' +
      '<div class="rps-fxl"></div>' +
      '<div class="rps-hud"></div>' +
    '</div>' +
    '<div class="rps-flash"></div>' +
    '<div class="rps-live" role="status" aria-live="polite" aria-atomic="true"></div>';
  const q = function (s) { return stageEl.querySelector(s); };
  stageEl._rps = {
    world: q('.rps-world'), tone: q('.rps-tone'), cam: q('.rps-cam'), shake: q('.rps-shake'),
    focus: q('.rps-focus'), burst: q('.rps-burst'), burstA: q('.rps-ba'), burstB: q('.rps-bb'),
    view: q('.rps-view'), bars: [q('.rps-bar-top'), q('.rps-bar-bot')], fxl: q('.rps-fxl'), hud: q('.rps-hud'),
    flash: q('.rps-flash'), live: q('.rps-live')
  };
  return stageEl._rps;
}

/* While the stage is open the rest of the page is inert (no Tab or clicks behind the dialog);
   focus goes back where it was when it closes. */
function rpsModal(stageEl, on) {
  if (on && !stageEl._rpsInert) {
    stageEl._rpsReturn = document.activeElement;
    stageEl._rpsInert = Array.prototype.filter.call(document.body.children, function (x) { return x !== stageEl && !x.inert; });
    stageEl._rpsInert.forEach(function (x) { x.inert = true; });
  } else if (!on && stageEl._rpsInert) {
    stageEl._rpsInert.forEach(function (x) { x.inert = false; });
    stageEl._rpsInert = null;
    const back = stageEl._rpsReturn;
    stageEl._rpsReturn = null;
    if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
  }
}

/* cancel everything in flight; any pending chooseThrow/showdown on this stage rejects with RPS_CANCEL */
function rpsReset(stageEl) {
  const S = rpsSkeleton(stageEl);
  stageEl._rpsTok = (stageEl._rpsTok || 0) + 1;
  rpsStopAnims(stageEl);
  S.view.innerHTML = ''; S.hud.innerHTML = ''; S.fxl.innerHTML = ''; S.live.textContent = '';
  stageEl.classList.remove('rps-fighting');
  rpsModal(stageEl, false);
}

async function rpsClose(stageEl) {
  const S = rpsSkeleton(stageEl), tok = stageEl._rpsTok;
  const ms = rpsReduced(stageEl) ? 160 : 240;
  rpsAnim(stageEl, S.world, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(1.03)' }], { duration: ms, easing: 'ease-in', fill: 'forwards' });
  await rpsWait(ms);
  rpsGuard(stageEl, tok);
  rpsStopAnims(stageEl);
  S.view.innerHTML = ''; S.hud.innerHTML = ''; S.fxl.innerHTML = '';
  stageEl.classList.remove('rps-fighting');
  stageEl.hidden = true;
  rpsModal(stageEl, false);
}

/* sparkle burst (pick feedback) in the fx layer, px coords relative to the stage */
function rpsSparkles(stageEl, layer, x, y, size, n, kana) {
  const ring = document.createElement('div');
  ring.className = 'rps-spk-ring';
  ring.style.cssText = 'left:' + (x - size / 2) + 'px;top:' + (y - size / 2) + 'px;width:' + size + 'px;height:' + size + 'px';
  layer.appendChild(ring);
  const ra = rpsAnim(stageEl, ring, [{ transform: 'scale(.2)', opacity: 1 }, { transform: 'scale(1.5)', opacity: 0 }], { duration: 520, easing: RPS_EASE.out, fill: 'forwards' });
  if (ra) ra.onfinish = function () { ring.remove(); };
  for (let i = 0; i < n; i++) {
    const s = size * (.13 + Math.random() * .11);
    const el = document.createElement('div');
    el.className = 'rps-spk';
    el.style.cssText = 'left:' + (x - s / 2) + 'px;top:' + (y - s / 2) + 'px;width:' + s + 'px;height:' + s + 'px';
    el.innerHTML = RPS_STAR;
    layer.appendChild(el);
    const ang = i / n * Math.PI * 2 + Math.random() * .5;
    const d = size * (.5 + Math.random() * .45);
    const dx = Math.cos(ang) * d, dy = Math.sin(ang) * d;
    const a = rpsAnim(stageEl, el, [
      { transform: 'translate(0,0) scale(.2) rotate(0deg)', opacity: 1 },
      { transform: 'translate(' + dx * .75 + 'px,' + dy * .75 + 'px) scale(1.15) rotate(70deg)', opacity: 1, offset: .55 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(0) rotate(160deg)', opacity: 0 }
    ], { duration: 560 + Math.random() * 200, delay: Math.random() * 60, easing: RPS_EASE.out, fill: 'both' });
    if (a) a.onfinish = function () { el.remove(); };
  }
  if (kana) {
    const k = document.createElement('div');
    k.className = 'rps-spk-kana';
    k.style.cssText = 'left:' + (x + size * .42) + 'px;top:' + (y - size * .38) + 'px';
    k.innerHTML = rpsInk(kana, 'rps-kana');
    layer.appendChild(k);
    const ka = rpsAnim(stageEl, k, [
      { transform: 'scale(0) rotate(30deg)', opacity: 0 },
      { transform: 'scale(1.25) rotate(8deg)', opacity: 1, offset: .35 },
      { transform: 'scale(1) rotate(10deg)', opacity: 1, offset: .75 },
      { transform: 'scale(1.05) rotate(10deg) translateY(-20%)', opacity: 0 }
    ], { duration: 700, easing: RPS_EASE.out, fill: 'forwards' });
    if (ka) ka.onfinish = function () { k.remove(); };
  }
}

/* ============================ 1. CHOOSE ============================ */
function rpsChooseHTML(T) {
  const picks = RPS_KINDS.map(function (k, i) {
    return '<button type="button" class="rps-pick" data-kind="' + k + '" style="--i:' + i + '" aria-label="' + rpsEsc(T.names[k]) + '" aria-keyshortcuts="' + (i + 1) + '">' +
      '<span class="rps-pick-card">' +
        '<span class="rps-pick-bg"></span>' +
        '<span class="rps-pick-clip"><span class="rps-pick-art">' + hand(k, 'you') + '</span></span>' +
        '<span class="rps-pick-glow"></span>' +
        '<span class="rps-pick-key" aria-hidden="true">' + (i + 1) + '</span>' +
        rpsInk(RPS_KANA.pick[k], 'rps-kana rps-pick-kana') +
      '</span>' +
      '<span class="rps-pick-label" aria-hidden="true">' + rpsEsc(T.names[k]) + '</span>' +
    '</button>';
  }).join('');
  const gogo = rpsInk(RPS_KANA.menace, 'rps-kana');
  return '<div class="rps-choose">' +
    '<div class="rps-gogo rps-gogo-l" aria-hidden="true">' + gogo + gogo + gogo + '</div>' +
    '<div class="rps-gogo rps-gogo-r" aria-hidden="true">' + gogo + gogo + gogo + '</div>' +
    rpsInk(RPS_KANA.eyebrow, 'rps-kana rps-eyebrow') +
    '<h2 class="rps-title" id="rps-title">' + rpsEsc(T.title) + '</h2>' +
    '<p class="rps-sub">' + rpsEsc(T.sub) + '</p>' +
    '<div class="rps-picks" role="group" aria-labelledby="rps-title">' + picks + '</div>' +
    '<p class="rps-hint" aria-hidden="true">' + rpsEsc(T.hint) + '</p>' +
  '</div>';
}

async function chooseThrow(stageEl, text, opts) {
  opts = opts || {};
  const T = text;
  const S = rpsSkeleton(stageEl);
  const tok = stageEl._rpsTok;
  const reduced = rpsReduced(stageEl);
  const anim = function (el, kf, o) { return rpsAnim(stageEl, el, kf, o); };
  const wasHidden = stageEl.hidden;

  rpsStopAnims(stageEl);
  stageEl.classList.remove('rps-fighting');
  stageEl.setAttribute('aria-label', T.dialog);
  stageEl.hidden = false;
  rpsModal(stageEl, true);
  S.hud.innerHTML = ''; S.fxl.innerHTML = '';
  S.view.innerHTML = rpsChooseHTML(T);
  const root = S.view.firstElementChild;
  const btns = Array.prototype.slice.call(root.querySelectorAll('.rps-pick'));

  // faint ambient focus lines behind the panels
  anim(S.focus, [{ opacity: 0, transform: 'scale(1.3)' }, { opacity: .1, transform: 'scale(1.2)' }], { duration: 400, fill: 'forwards' });
  if (wasHidden) anim(S.world, [{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? 160 : 260, easing: 'ease-out' });
  if (reduced) {
    anim(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
  } else {
    anim(root.querySelector('.rps-title'), [{ opacity: 0, transform: 'scale(1.5) rotate(-3deg)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: RPS_EASE.back, fill: 'backwards' });
    anim(root.querySelector('.rps-eyebrow'), [{ opacity: 0, transform: 'translateY(60%) rotate(-4deg)' }, { opacity: 1, transform: 'rotate(-4deg)' }], { duration: 300, delay: 60, easing: RPS_EASE.out, fill: 'backwards' });
    anim(root.querySelector('.rps-sub'), [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 120, fill: 'backwards' });
    btns.forEach(function (b, i) {
      anim(b, [{ opacity: 0, transform: 'translateY(35%) scale(.7)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 140 + i * 80, easing: RPS_EASE.back, fill: 'backwards' });
    });
  }
  if (!opts.autoPick) btns[0].focus({ preventScroll: true }); // the dialog owns the focus (:focus-visible keeps it quiet for mouse users)

  const btn = await new Promise(function (resolve) {
    let done = false;
    function finish(b, viaKey) {
      if (done || !b) return;
      done = true;
      document.removeEventListener('keydown', onKey);
      stageEl._rpsKbd = !!viaKey;
      resolve(b);
    }
    function onKey(e) {
      if (!root.isConnected) { document.removeEventListener('keydown', onKey); return; }
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const idx = { '1': 0, '2': 1, '3': 2 }[e.key];
      if (idx !== undefined) { e.preventDefault(); finish(btns[idx], true); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const cur = btns.indexOf(document.activeElement);
        const dir = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 1;
        btns[cur < 0 ? (dir > 0 ? 0 : 2) : (cur + dir + 3) % 3].focus({ preventScroll: true });
      }
    }
    btns.forEach(function (b) { b.addEventListener('click', function (e) { finish(b, e.detail === 0); }); });
    document.addEventListener('keydown', onKey);
    if (opts.autoPick) setTimeout(function () { finish(btns[Math.max(0, RPS_KINDS.indexOf(opts.autoPick))], false); }, opts.autoDelay || 700);
  });
  rpsGuard(stageEl, tok);

  const kind = btn.getAttribute('data-kind');
  root.classList.add('rps-locked');
  const others = btns.filter(function (b) { return b !== btn; });
  const art = btn.querySelector('.rps-pick-art svg');
  const glow = btn.querySelector('.rps-pick-glow');
  const fade = [root.querySelector('.rps-title'), root.querySelector('.rps-sub'), root.querySelector('.rps-hint'), root.querySelector('.rps-eyebrow')];

  if (reduced) {
    anim(glow, [{ opacity: 0 }, { opacity: 1 }], { duration: 150, fill: 'forwards' });
    others.forEach(function (b) { anim(b, [{ opacity: 1 }, { opacity: .15 }], { duration: 200, fill: 'forwards' }); });
    await rpsWait(380); rpsGuard(stageEl, tok);
    anim(root, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
    await rpsWait(160); rpsGuard(stageEl, tok);
    return kind;
  }

  anim(art, [
    { transform: 'translateY(0) scale(1) rotate(0deg)' },
    { transform: 'translateY(-12%) scale(1.2) rotate(-6deg)', offset: .45 },
    { transform: 'translateY(-9%) scale(1.14) rotate(0deg)' }
  ], { duration: 460, easing: 'cubic-bezier(.2,.9,.3,1.25)', fill: 'forwards' });
  anim(glow, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, fill: 'forwards' });
  anim(btn.querySelector('.rps-pick-bg'), [{ transform: 'scale(1)' }, { transform: 'scale(1.07)', offset: .4 }, { transform: 'scale(1.03)' }], { duration: 380, easing: RPS_EASE.out, fill: 'forwards' });
  anim(btn.querySelector('.rps-pick-label'), [{ transform: 'scale(1)' }, { transform: 'scale(1.3)', offset: .4 }, { transform: 'scale(1.15)' }], { duration: 380, easing: RPS_EASE.out, fill: 'forwards' });
  others.forEach(function (b) {
    anim(b, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(12%) scale(.8)' }], { duration: 260, easing: 'ease-in', fill: 'forwards' });
  });
  fade.forEach(function (el) { anim(el, [{ opacity: 0 }], { duration: 220, delay: 120, fill: 'forwards' }); });
  const lr = S.fxl.getBoundingClientRect(), ar = btn.querySelector('.rps-pick-card').getBoundingClientRect();
  rpsSparkles(stageEl, S.fxl, ar.left + ar.width / 2 - lr.left, ar.top + ar.height * .38 - lr.top, ar.width * 1.05, 10, RPS_KANA.sparkle);

  await rpsWait(560); rpsGuard(stageEl, tok);
  anim(root, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(1.08)' }], { duration: 200, easing: 'ease-in', fill: 'forwards' });
  await rpsWait(200); rpsGuard(stageEl, tok);
  return kind;
}

/* ============================ 2-5. SHOWDOWN ============================ */
function rpsFighterHTML(side, kind, seed) {
  const rnd = rpsRand(seed);
  let rise = '';
  for (let i = 0; i < 8; i++) rise += '<i style="left:' + (8 + rnd() * 80).toFixed(1) + '%"></i>';
  const aura = '<svg class="rps-aura-spikes" viewBox="-100 -100 200 200" aria-hidden="true" focusable="false">' +
    '<polygon points="' + rpsStarPts(17, 99, 66, rnd, 1, 1, .2) + '" fill="#ffcb05" opacity=".78"/>' +
    '<polygon points="' + rpsStarPts(13, 82, 58, rnd, 1, 1, .18) + '" fill="#fff6c4" opacity=".85"/></svg>';
  const sweat = '<svg class="rps-sweat" viewBox="-22 -36 44 62" aria-hidden="true" focusable="false">' +
    '<path d="M0 -32 C7 -17 19 -3 19 9 A19 19 0 0 1 -19 9 C-19 -3 -7 -17 0 -32Z" fill="#8fd3ff" stroke="#12142a" stroke-width="4" stroke-linejoin="round"/>' +
    '<ellipse cx="-7" cy="6" rx="3.5" ry="7" fill="#fff" transform="rotate(20 -7 6)"/></svg>';
  return '<div class="rps-fighter rps-' + side + '">' +
    '<div class="rps-act">' +
      '<div class="rps-gloom"></div>' +
      '<div class="rps-pump"><div class="rps-rot"><div class="rps-pop">' +
        '<div class="rps-aura"><div class="rps-aura-glow"></div>' + aura + '</div>' +
        '<div class="rps-h rps-h-fist">' + hand('rock', side) + '</div>' +
        '<div class="rps-h rps-h-throw">' + hand(kind, side) + '</div>' +
        '<div class="rps-h rps-h-gray">' + hand(kind, side) + '</div>' +
      '</div></div></div>' +
      '<div class="rps-rise">' + rise + '</div>' +
      sweat +
    '</div></div>';
}

const RPS_WORD_POS = [{ x: 27, y: 27, r: -9, k: 1 }, { x: 73, y: 25, r: 8, k: 1.16 }, { x: 50, y: 21, r: -4, k: 1.38 }];
const RPS_WORD_KANA_FILL = ['#ff6161', '#6fb2ff', '#ffcb05'];

function rpsArenaHTML(you, gary, T) {
  const rnd = rpsRand(7);
  let shards = '';
  for (let i = 0; i < 14; i++) shards += '<i></i>';
  const spark = '<svg class="rps-spark" viewBox="-100 -100 200 200" aria-hidden="true" focusable="false">' +
    '<polygon points="' + rpsStarPts(12, 98, 36, rnd, 1, 1, .28) + '" fill="#fff" stroke="#12142a" stroke-width="5" stroke-linejoin="miter"/>' +
    '<polygon points="' + rpsStarPts(12, 66, 27, rnd, 1, 1, .22) + '" fill="#ffcb05"/>' +
    '<circle r="19" fill="#fff"/></svg>';
  const words = RPS_WORD_POS.map(function (w, i) {
    return '<div class="rps-word" style="left:' + w.x + '%;top:' + w.y + '%">' +
      '<div class="rps-word-in" style="--k:' + w.k + '">' +
        rpsInk(RPS_KANA.chant[i], 'rps-kana', '--fill:' + RPS_WORD_KANA_FILL[i]) +
        rpsInk(T.chant[i], 'rps-word-text', '--fill:' + (i === 2 ? '#ffcb05' : '#fff')) +
      '</div></div>';
  }).join('');
  return '<div class="rps-arena">' +
    '<div class="rps-clash-back"><div class="rps-beam rps-beam-you"></div><div class="rps-beam rps-beam-gary"></div></div>' +
    rpsFighterHTML('you', you, 101) + rpsFighterHTML('gary', gary, 202) +
    '<div class="rps-clash"><div class="rps-ring"></div>' + spark + '<div class="rps-shards">' + shards + '</div>' +
      '<div class="rps-don">' + rpsInk(RPS_KANA.impact, 'rps-kana') + '</div></div>' +
    '<div class="rps-words">' + words + '</div>' +
  '</div>';
}

function rpsHudHTML(result, T) {
  const rnd = rpsRand(result.length * 31 + 5);
  const burst = '<svg class="rps-banner-burst" viewBox="-300 -120 600 240" aria-hidden="true" focusable="false">' +
    '<polygon class="o" points="' + rpsStarPts(22, 296, 228, rnd, 1, .4, .12) + '"/>' +
    '<polygon class="i" points="' + rpsStarPts(22, 250, 205, rnd, 1, .37, .08) + '"/></svg>';
  return '<div class="rps-plate rps-plate-you" aria-hidden="true"><div class="rps-plate-in"><span>' + rpsEsc(T.you) + '</span></div></div>' +
    '<div class="rps-plate rps-plate-gary" aria-hidden="true"><div class="rps-plate-in"><span>' + rpsEsc(T.gary) + '</span></div></div>' +
    '<div class="rps-banner rps-' + result + '" aria-hidden="true">' +
      '<div class="rps-banner-in">' + burst +
        rpsInk(RPS_KANA.result[result], 'rps-kana rps-banner-kana') +
        rpsInk(T[result], 'rps-banner-text') +
      '</div>' +
      '<div class="rps-banner-sub">' + rpsEsc(T[result + 'Sub']) + '</div>' +
    '</div>' +
    (result === 'tie' ? '' : '<div class="rps-cta"><button type="button" class="rps-btn">' + rpsEsc(T.cont) + '</button></div>');
}

function rpsFighterRefs(root) {
  const q = function (s) { return root.querySelector(s); };
  return {
    root: root, act: q('.rps-act'), pump: q('.rps-pump'), pop: q('.rps-pop'),
    fist: q('.rps-h-fist'), thr: q('.rps-h-throw'), gray: q('.rps-h-gray'),
    aura: q('.rps-aura'), auraGlow: q('.rps-aura-glow'), auraSpikes: q('.rps-aura-spikes'),
    sweat: q('.rps-sweat'), gloom: q('.rps-gloom'), rise: Array.prototype.slice.call(root.querySelectorAll('.rps-rise i'))
  };
}

async function showdown(stageEl, opts) {
  const you = RPS_KINDS.indexOf(opts.you) >= 0 ? opts.you : 'rock';
  const gary = RPS_KINDS.indexOf(opts.gary) >= 0 ? opts.gary : 'rock';
  const result = opts.result || rpsJudge(you, gary);
  const T = opts.text;
  const S = rpsSkeleton(stageEl);
  const tok = stageEl._rpsTok;
  const reduced = rpsReduced(stageEl);
  const anim = function (el, kf, o) { return rpsAnim(stageEl, el, kf, o); };

  rpsStopAnims(stageEl);
  stageEl.hidden = false;
  rpsModal(stageEl, true);
  stageEl.setAttribute('aria-label', T.dialog);
  S.fxl.innerHTML = ''; S.live.textContent = '';
  S.view.innerHTML = rpsArenaHTML(you, gary, T);
  S.hud.innerHTML = rpsHudHTML(result, T);
  const A = S.view.firstElementChild;
  const F = { you: rpsFighterRefs(A.querySelector('.rps-you')), gary: rpsFighterRefs(A.querySelector('.rps-gary')) };
  const SIGN = { you: 1, gary: -1 };               // +1 = "toward the centre" for that side
  const winner = result === 'win' ? 'you' : result === 'lose' ? 'gary' : null;
  const loser = winner === 'you' ? 'gary' : winner === 'gary' ? 'you' : null;
  if (winner) F[winner].root.style.zIndex = 2;
  const wordsIn = Array.prototype.slice.call(A.querySelectorAll('.rps-word-in'));
  const plates = Array.prototype.slice.call(S.hud.querySelectorAll('.rps-plate'));
  const don = A.querySelector('.rps-don');
  const bannerIn = S.hud.querySelector('.rps-banner-in');
  const bannerKana = S.hud.querySelector('.rps-banner-kana');
  const bannerSub = S.hud.querySelector('.rps-banner-sub');
  const cta = S.hud.querySelector('.rps-cta');
  const hsPx = F.you.root.getBoundingClientRect().width || 200;
  const cs = getComputedStyle(stageEl);
  const sa = parseFloat(cs.getPropertyValue('--sa')) || .95, ca = parseFloat(cs.getPropertyValue('--ca')) || .31;
  /* translate along the arm axis: d in hand-widths (+ = toward the centre), dy = extra drop in % of hand width */
  const along = function (k, d, dy) {
    return 'translate(' + (d * k * sa * 100).toFixed(2) + '%, ' + ((-d * ca * 100 + (dy || 0)) / 1.3).toFixed(2) + '%)';
  };
  const CH = .1;                                    // fists lean in during the chant
  const announce = T[result] + ' ' + T.youLabel + ': ' + T.names[you] + ', Gary: ' + T.names[gary] + '. ' + T[result + 'Sub'];
  const sides = ['you', 'gary'];
  const t0 = performance.now();
  const until = function (t) { return rpsWait(Math.max(0, t - (performance.now() - t0))); };
  let ctaAt, endAt;

  if (reduced) {
    /* ---- calm path: no shake / flash / speed lines / zoom — just quick cross-fades ---- */
    anim(A, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    wordsIn.forEach(function (w, i) {
      w.style.transform = 'rotate(' + RPS_WORD_POS[i].r + 'deg)';
      anim(w, [{ opacity: 0 }, { opacity: 1 }], { duration: 140, delay: 150 + i * 230, fill: 'both' });
      if (i < 2) anim(w, [{ opacity: .35 }], { duration: 120, delay: 150 + (i + 1) * 230, fill: 'forwards' });
    });
    const REV = 860, RES = 1180;
    sides.forEach(function (s) {
      anim(F[s].fist, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, delay: REV, fill: 'forwards' });
      anim(F[s].thr, [{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: REV, fill: 'forwards' });
    });
    wordsIn.concat(plates).forEach(function (el) { anim(el, [{ opacity: 0 }], { duration: 200, delay: RES, fill: 'forwards' }); });
    if (winner) {
      anim(F[winner].aura, [{ opacity: 0 }, { opacity: .9 }], { duration: 300, delay: RES, fill: 'forwards' });
      anim(F[loser].gray, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: RES, fill: 'forwards' });
      anim(F[loser].sweat, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: RES + 100, fill: 'forwards' });
      anim(F[loser].gloom, [{ opacity: 0 }, { opacity: .8 }], { duration: 300, delay: RES + 100, fill: 'forwards' });
    }
    bannerIn.style.transform = 'rotate(-4deg)';
    anim(bannerIn, [{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: RES, fill: 'both' });
    anim(bannerSub, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: RES + 140, fill: 'both' });
    await until(RES); rpsGuard(stageEl, tok);
    S.live.textContent = announce;
    ctaAt = RES + 300; endAt = RES + 1300;
  } else {
    /* ---- full shōnen timeline (ms from start) ----
       0      enter (hands whoosh in, letterbox, focus lines)
       330    beat 1  TAŞ!/ジャン    hit @622
       760    beat 2  KÂĞIT!/ケン    hit @1025
       1150   beat 3  MAKAS!/ポン!   wind-up, slam → IMPACT @1510 (flash, inverted frame, ドン!, spark, shake)
       1980   result: winner pushes + aura, loser recoils/droops/sweats
       2040   banner slam · 2330 sub · 2520 Continue                                             */
    stageEl.classList.add('rps-fighting');
    const B = [330, 760, 1150], D = [430, 390, 360];
    const HIT = [B[0] + D[0] * .68, B[1] + D[1] * .68, B[2] + D[2]];
    const I = HIT[2], R = 1980, BAN = 2040, SUB = 2330;
    ctaAt = 2520; endAt = 3230;

    // enter: whoosh in along the arm, settle leaning in
    sides.forEach(function (s) {
      const k = SIGN[s];
      anim(F[s].act, [
        { transform: along(k, -.95) + ' rotate(' + (-14 * k) + 'deg)', opacity: 0 },
        { transform: along(k, CH + .05) + ' rotate(' + (2 * k) + 'deg)', opacity: 1, offset: .7 },
        { transform: along(k, CH) + ' rotate(0deg)', opacity: 1 }
      ], { duration: 330, easing: RPS_EASE.out, fill: 'forwards' });
    });
    plates.forEach(function (p, i) {
      anim(p, [{ opacity: 0, transform: 'translateX(' + (i ? 60 : -60) + '%)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 80, easing: RPS_EASE.back, fill: 'backwards' });
      anim(p, [{ opacity: 0 }], { duration: 200, delay: R, fill: 'forwards' });
    });
    S.bars.forEach(function (b) {
      anim(b, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 280, easing: RPS_EASE.out, fill: 'forwards' });
      anim(b, [{ transform: 'scaleY(0)' }], { duration: 320, delay: R + 120, easing: 'ease-in', fill: 'forwards' });
    });
    anim(S.tone, [{ opacity: .55 }, { opacity: .95 }], { duration: 1400, easing: 'ease-in', fill: 'forwards' });
    anim(S.tone, [{ opacity: .6 }], { duration: 400, delay: R, fill: 'forwards' });

    // focus lines tighten each beat (flicker comes from CSS)
    anim(S.focus, [{ opacity: 0, transform: 'scale(1.35)' }, { opacity: .2, transform: 'scale(1.25)' }], { duration: 300, fill: 'forwards' });
    [[.32, 1.12], [.45, 1], [.6, .88]].forEach(function (v, i) {
      anim(S.focus, [{ opacity: v[0], transform: 'scale(' + v[1] + ')' }], { duration: 160, delay: HIT[i] - 40, easing: RPS_EASE.out, fill: 'forwards' });
    });
    anim(S.focus, [{ opacity: 0 }], { duration: 60, delay: I + 10, fill: 'forwards' });
    anim(S.focus, [{ opacity: .22, transform: 'scale(1.05)' }], { duration: 500, delay: R, fill: 'forwards' });

    // camera: creeping zoom per beat, punch on impact
    [[1.035, -.6], [1.075, .7]].forEach(function (z, i) {
      anim(S.cam, [{ transform: 'scale(' + z[0] + ') rotate(' + z[1] + 'deg)' }], { duration: 220, delay: HIT[i], easing: RPS_EASE.out, fill: 'forwards' });
    });
    anim(S.cam, [{ transform: 'scale(1.11) rotate(0deg)' }], { duration: D[2] * .62, delay: B[2], easing: 'ease-in', fill: 'forwards' });
    anim(S.cam, [{ transform: 'scale(1.22)' }, { transform: 'scale(1.06)' }], { duration: 560, delay: I, easing: 'cubic-bezier(.15,.9,.3,1)', fill: 'forwards' });

    // pumps (in sync), each beat bigger
    for (let i = 0; i < 3; i++) {
      const amp = [1, 1.18, 1.5][i];
      sides.forEach(function (s) {
        const k = SIGN[s];
        const up = 'translate(' + (-3 * k * amp) + '%, ' + (-12 * amp) + '%) rotate(' + (-10 * k * amp) + 'deg)';
        const hit = 'translate(' + (2.5 * k) + '%, 3%) rotate(' + (3 * k) + 'deg)';
        const kf = i < 2 ? [
          { offset: 0, transform: 'none', easing: 'cubic-bezier(.25,.8,.35,1)' },
          { offset: .52, transform: up, easing: RPS_EASE.in },
          { offset: .68, transform: hit, easing: 'cubic-bezier(.3,.6,.4,1)' },
          { offset: 1, transform: 'none' }
        ] : [
          { offset: 0, transform: 'none', easing: 'cubic-bezier(.25,.8,.35,1)' },
          { offset: .62, transform: up, easing: 'cubic-bezier(.8,0,1,.5)' },
          { offset: 1, transform: hit }
        ];
        anim(F[s].pump, kf, { duration: D[i], delay: B[i], fill: i === 2 ? 'forwards' : 'none' });
      });
    }

    // SFX words slam on each hit, previous ones dim
    wordsIn.forEach(function (w, i) {
      const r = RPS_WORD_POS[i].r;
      anim(w, [
        { opacity: 0, transform: 'scale(2.8) rotate(' + r * 2.5 + 'deg)' },
        { opacity: 1, transform: 'scale(.88) rotate(' + r + 'deg)', offset: .6 },
        { opacity: 1, transform: 'scale(1) rotate(' + r + 'deg)' }
      ], { duration: 190, delay: HIT[i] - 114, easing: 'cubic-bezier(.5,0,.6,1)', fill: 'both' });
      const kana = w.querySelector('.rps-kana');
      anim(kana, [{ opacity: 0, transform: 'scale(0) rotate(-30deg)' }, { opacity: 1, transform: 'scale(1.2) rotate(-6deg)', offset: .6 }, { opacity: 1, transform: 'scale(1) rotate(-8deg)' }],
        { duration: 220, delay: HIT[i] - 20, easing: RPS_EASE.out, fill: 'both' });
      if (i < 2) anim(w, [{ opacity: .3, transform: 'scale(.84) rotate(' + r + 'deg)' }], { duration: 150, delay: HIT[i + 1] - 90, fill: 'forwards' });
      anim(w, [{ opacity: 0, transform: 'scale(.7) rotate(' + r + 'deg)' }], { duration: 200, delay: R, easing: 'ease-in', fill: 'forwards' });
    });

    /* ---------- IMPACT ---------- */
    sides.forEach(function (s) {
      anim(F[s].fist, [{ opacity: 0 }, { opacity: 0 }], { duration: 1, delay: I, fill: 'forwards' });
      anim(F[s].thr, [{ opacity: 1 }, { opacity: 1 }], { duration: 1, delay: I, fill: 'forwards' });
      anim(F[s].pop, [{ transform: 'scale(1.32)' }, { transform: 'scale(.94)', offset: .55 }, { transform: 'scale(1)' }], { duration: 260, delay: I, easing: RPS_EASE.out, fill: 'forwards' });
      anim(F[s].pump, [{ transform: 'none' }], { duration: 200, delay: I + 60, easing: RPS_EASE.out, fill: 'forwards' });
      // the clash knocks both arms back to their marks while the fingers snap out
      anim(F[s].act, [
        { transform: along(SIGN[s], CH) + ' rotate(0deg)' },
        { transform: along(SIGN[s], -.07) + ' rotate(' + (-3 * SIGN[s]) + 'deg)', offset: .3 },
        { transform: along(SIGN[s], 0) + ' rotate(0deg)' }
      ], { duration: 320, delay: I, easing: RPS_EASE.out, fill: 'forwards' });
      // power struggle: both hands grind against each other
      const k = SIGN[s];
      anim(F[s].pump, [
        { transform: 'translate(0,0)' }, { transform: 'translate(' + 1.6 * k + '%, -.6%)' }, { transform: 'translate(' + -.8 * k + '%, .5%)' },
        { transform: 'translate(' + 1.4 * k + '%, .2%)' }, { transform: 'translate(' + -.6 * k + '%, -.4%)' }, { transform: 'translate(' + 1 * k + '%, 0)' }, { transform: 'translate(0,0)' }
      ], { duration: 300, delay: I + 230 });
    });
    // 1–2 frame white flash, then a black-and-white inverted manga frame
    anim(S.flash, [{ opacity: 1 }, { opacity: 1 }], { duration: 42, delay: I - 8 });
    anim(S.world, [{ filter: 'invert(1) grayscale(1) contrast(1.7)' }, { filter: 'invert(1) grayscale(1) contrast(1.7)' }], { duration: 112, delay: I + 34 });
    anim(S.flash, [{ opacity: .5 }, { opacity: 0 }], { duration: 170, delay: I + 146 });
    // speed-line burst (two sets flickering)
    anim(S.burst, [
      { opacity: 1, transform: 'scale(.72) rotate(0deg)' },
      { opacity: 1, transform: 'scale(1.04) rotate(1.5deg)', offset: .45 },
      { opacity: 0, transform: 'scale(1.2) rotate(3deg)' }
    ], { duration: 580, delay: I, easing: 'cubic-bezier(.1,.7,.3,1)' });
    const flick = function (on) {
      const kf = [];
      for (let j = 0; j <= 8; j++) kf.push({ offset: j / 8, opacity: ((j % 2 === 0) === on) ? 1 : 0, easing: 'steps(1, end)' });
      return kf;
    };
    anim(S.burstA, flick(true), { duration: 580, delay: I });
    anim(S.burstB, flick(false), { duration: 580, delay: I });
    // camera shake
    const m = Math.max(6, hsPx * .055);
    const shakeKF = function (mm) {
      return [
        { transform: 'translate(0,0)' }, { transform: 'translate(' + -mm + 'px,' + mm * .6 + 'px)' }, { transform: 'translate(' + mm * .85 + 'px,' + -mm * .7 + 'px)' },
        { transform: 'translate(' + -mm * .6 + 'px,' + mm * .45 + 'px)' }, { transform: 'translate(' + mm * .4 + 'px,' + -mm * .3 + 'px)' },
        { transform: 'translate(' + -mm * .2 + 'px,' + mm * .15 + 'px)' }, { transform: 'translate(0,0)' }
      ];
    };
    anim(S.shake, shakeKF(m), { duration: 400, delay: I + 20 });
    // clash: two energy cones collide, white spark, shockwave ring, shards, ドン!
    const beams = A.querySelectorAll('.rps-beam');
    for (let j = 0; j < beams.length; j++) {
      anim(beams[j], [
        { opacity: 0, transform: 'scaleX(0)' }, { opacity: 1, transform: 'scaleX(1)', offset: .18 },
        { opacity: .9, transform: 'scaleX(1.05)', offset: .5 }, { opacity: 0, transform: 'scaleX(1.1) scaleY(.3)' }
      ], { duration: 500, delay: I - 50, easing: 'ease-out' });
    }
    anim(A.querySelector('.rps-spark'), [
      { opacity: 1, transform: 'scale(.15) rotate(-20deg)' }, { opacity: 1, transform: 'scale(1.3) rotate(0deg)', offset: .16 },
      { opacity: 1, transform: 'scale(1) rotate(8deg)', offset: .45 }, { opacity: 0, transform: 'scale(.45) rotate(28deg)' }
    ], { duration: 580, delay: I, easing: RPS_EASE.out });
    anim(A.querySelector('.rps-ring'), [{ opacity: 1, transform: 'scale(.2)' }, { opacity: 0, transform: 'scale(2.6)' }], { duration: 480, delay: I + 20, easing: RPS_EASE.out });
    const shardEls = A.querySelectorAll('.rps-shards i');
    for (let j = 0; j < shardEls.length; j++) {
      const ang = j / shardEls.length * 360 + Math.random() * 20;
      const dist = hsPx * (.75 + Math.random() * .7);
      anim(shardEls[j], [
        { opacity: 1, transform: 'rotate(' + (ang + 90) + 'deg) translateY(0) scale(1)' },
        { opacity: 0, transform: 'rotate(' + (ang + 90) + 'deg) translateY(' + -dist + 'px) scale(.3)' }
      ], { duration: 420 + Math.random() * 180, delay: I + 10, easing: 'cubic-bezier(.1,.8,.3,1)' });
    }
    anim(don, [
      { opacity: 0, transform: 'scale(3.2) rotate(-26deg)' }, { opacity: 1, transform: 'scale(.9) rotate(-10deg)', offset: .55 },
      { opacity: 1, transform: 'scale(1) rotate(-12deg)' }
    ], { duration: 220, delay: I + 30, easing: 'cubic-bezier(.5,0,.5,1)', fill: 'both' });
    anim(don, [{ opacity: 0, transform: 'scale(1.3) rotate(-12deg)' }], { duration: 200, delay: R, fill: 'forwards' });

    /* ---------- RESULT ---------- */
    if (winner) {
      const w = SIGN[winner], l = SIGN[loser];
      anim(F[winner].act, [
        { transform: along(w, 0) + ' rotate(0deg) scale(1)' },
        { transform: along(w, .12, -3) + ' rotate(' + -7 * w + 'deg) scale(1.12)', offset: .4 },
        { transform: along(w, .05, -3) + ' rotate(' + -4 * w + 'deg) scale(1.07)' }
      ], { duration: 400, delay: R, easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'forwards' });
      anim(F[winner].aura, [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'scale(1.12)', offset: .5 }, { opacity: 1, transform: 'scale(1)' }], { duration: 420, delay: R, easing: RPS_EASE.out, fill: 'forwards' });
      anim(F[winner].auraSpikes, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 6000, delay: R, iterations: Infinity });
      anim(F[winner].auraGlow, [{ transform: 'scale(.96)', opacity: .8 }, { transform: 'scale(1.1)', opacity: 1 }], { duration: 380, delay: R + 400, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
      F[winner].rise.forEach(function (el, j) {
        anim(el, [
          { opacity: 0, transform: 'translateY(0) scale(.4)' }, { opacity: 1, transform: 'translateY(' + -hsPx * .25 + 'px) scale(1)', offset: .3 },
          { opacity: 0, transform: 'translateY(' + -hsPx * .75 + 'px) scale(.6)' }
        ], { duration: 900 + j * 37, delay: R + 120 + j * 130, iterations: Infinity, easing: 'ease-out', fill: 'backwards' });
      });
      // loser: knocked back, then droops; greys out; trembles; sweat drop + gloom lines
      anim(F[loser].act, [
        { transform: along(l, 0) + ' rotate(0deg)' },
        { transform: along(l, -.26) + ' rotate(' + -9 * l + 'deg)', offset: .22 },
        { transform: along(l, -.07, 6) + ' rotate(' + 12 * l + 'deg)' }
      ], { duration: 560, delay: R + 30, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' });
      anim(F[loser].gray, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: R + 100, fill: 'forwards' });
      anim(F[loser].pump, [
        { transform: 'translate(0,0)' }, { transform: 'translate(1.5%,0)' }, { transform: 'translate(-1.5%,.5%)' }, { transform: 'translate(1.2%,0)' },
        { transform: 'translate(-1%,.4%)' }, { transform: 'translate(.8%,0)' }, { transform: 'translate(-.5%,0)' }, { transform: 'translate(0,0)' }
      ], { duration: 420, delay: R + 560 });
      anim(F[loser].sweat, [
        { opacity: 0, transform: 'translateY(0) scale(0) rotate(-20deg)' }, { opacity: 1, transform: 'translateY(0) scale(1.3) rotate(5deg)', offset: .3 },
        { opacity: 1, transform: 'translateY(0) scale(1) rotate(0deg)', offset: .5 }, { opacity: 1, transform: 'translateY(35%) scale(1) rotate(0deg)' }
      ], { duration: 1100, delay: R + 360, easing: RPS_EASE.out, fill: 'both' });
      anim(F[loser].gloom, [{ opacity: 0, transform: 'scaleY(0)' }, { opacity: .85, transform: 'scaleY(1)' }], { duration: 420, delay: R + 300, easing: RPS_EASE.out, fill: 'both' });
    } else {
      // tie: both blown back from the clash, a second spark
      sides.forEach(function (s) {
        const k = SIGN[s];
        anim(F[s].act, [
          { transform: along(k, 0) + ' rotate(0deg)' }, { transform: along(k, -.2) + ' rotate(' + -7 * k + 'deg)', offset: .35 },
          { transform: along(k, -.08) + ' rotate(' + -2 * k + 'deg)' }
        ], { duration: 480, delay: R, easing: RPS_EASE.out, fill: 'forwards' });
      });
      anim(A.querySelector('.rps-ring'), [{ opacity: 1, transform: 'scale(.3)' }, { opacity: 0, transform: 'scale(2)' }], { duration: 420, delay: R, easing: RPS_EASE.out });
    }
    // banner slams in with its own little quake
    anim(bannerIn, [
      { opacity: 0, transform: 'scale(2.7) rotate(-12deg)' }, { opacity: 1, transform: 'scale(.92) rotate(-3deg)', offset: .55 },
      { opacity: 1, transform: 'scale(1.04) rotate(-4deg)', offset: .8 }, { opacity: 1, transform: 'scale(1) rotate(-4deg)' }
    ], { duration: 400, delay: BAN, easing: 'cubic-bezier(.45,0,.55,1)', fill: 'both' });
    anim(bannerKana, [
      { opacity: 0, transform: 'scale(0) rotate(40deg)' }, { opacity: 1, transform: 'scale(1.25) rotate(6deg)', offset: .6 },
      { opacity: 1, transform: 'scale(1) rotate(10deg)' }
    ], { duration: 300, delay: BAN + 200, easing: RPS_EASE.out, fill: 'both' });
    anim(S.shake, shakeKF(m * .45), { duration: 260, delay: BAN + 220 });
    anim(bannerSub, [{ opacity: 0, transform: 'translateY(50%) scale(.8)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: SUB, easing: RPS_EASE.back, fill: 'both' });

    await until(BAN + 200); rpsGuard(stageEl, tok);
    S.live.textContent = announce;
  }

  if (result === 'tie') {
    await until(endAt); rpsGuard(stageEl, tok);
    anim(A, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
    anim(S.hud, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
    await rpsWait(220); rpsGuard(stageEl, tok);
    S.hud.innerHTML = '';
    return 'tie';
  }

  // Continue button
  await until(ctaAt); rpsGuard(stageEl, tok);
  cta.style.visibility = 'visible';
  anim(cta, reduced ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(40%) scale(.7)' }, { opacity: 1, transform: 'none' }],
    { duration: reduced ? 200 : 280, easing: RPS_EASE.back, fill: 'both' });
  const btn = cta.querySelector('.rps-btn');
  // Focusing Continue would cut the result announcement short, so the button carries it as its description.
  if (!S.live.id) S.live.id = 'rps-live-' + (++rpsUid);
  btn.setAttribute('aria-describedby', S.live.id);
  btn.focus({ preventScroll: true });
  await new Promise(function (resolve) {
    btn.addEventListener('click', resolve, { once: true });
    if (opts.autoCloseMs) setTimeout(resolve, opts.autoCloseMs);
  });
  rpsGuard(stageEl, tok);
  return result;
}

export { RPS_CANCEL, chooseThrow, showdown, rpsReset, rpsClose, rpsJudge };
