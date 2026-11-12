import { faceText, fitTitle, fitTitleLayout, icon, layoutParagraph } from './flow.js';

const GRID = [245, 342];
const ordinaryInk = {
  title: ['dark', 135, 3], stage: ['dark', 140, 2], evolves: ['dark', 145, 2],
  heading: ['dark', 135, 3], body: ['dark', 162, 3], label: ['dark', 140, 2],
  meta: ['dark', 146, 2], classicMeta: ['dark', 104, 1], flavor: ['dark', 140, 2],
  stamp: ['dark', 155, 2], badge: ['light', 170, 2], power: ['red', 195, 3],
  rule: ['dark', 140, 2], ruleLabel: ['light', 167, 2], special: ['dark', 143, 2],
  specialHeading: ['outlined', 150, 2],
};
const whiteText = ['light', 172, 3];
const outlinedText = ['outlined', 142, 2];
const darkArt = new Set(['Darkness']);
const framed = new Set(['ex', 'mega', 'v', 'vmax']);
const darkFace = new Set(['sv', 'swsh', 'sm', 'ex']);
const darkLabelFrames = new Set(['sv', 'ex']);
const printedBodyFrames = new Set(['sm', 'swsh', 'sv', 'radiant']);
const modernAbilityFrames = new Set(['sv', 'ex', 'mega']);
// These frames share a tab whose right edge extends past the OCR lettering.
const modernAbilityEdge = 77.5;
const inlineMasks = {
  round: ['full', 0, 1],
  ink: ['paper-ink', 24, 2],
  light: ['paper-light', 35, 2],
  outlined: ['outlined', 142, 2],
};

export function sourceInlineIcons(specs = {}) {
  const cutouts = {}, erase = [];
  for (const [type, { box, shape, erase: copies = [] }] of Object.entries(specs)) {
    cutouts['inline_' + type] = { box, shape, mode: 'inline', position: [0, 0] };
    for (const source of [box, ...copies]) erase.push([...source, ...inlineMasks[shape]]);
  }
  return { cutouts, erase };
}

export function drawInlineIcon(specs, type, x, baseline, size) {
  const spec = specs?.[type];
  if (!spec) return icon(type, x, baseline, size);
  const [, , width, height] = spec.box;
  const drawSize = size * 1.12;
  return `<svg x="${x}" y="${baseline - drawSize * 0.86}" width="${drawSize}" height="${drawSize}" viewBox="0 0 ${width} ${height}">{{inline_${type}}}</svg>`;
}

export function spreadAbilityLabel(label) {
  return label === '特性' ? '特\u2009性' : label;
}

export function vmaxFormErase([x, , width]) {
  // Repair the outlined letters within the printed strip.
  return [x - 1.5, 41.4, width + 5, 8.35, 'outlined', 150, 1];
}

export function vmaxFormText(label, x, { fill, outline }) {
  return faceText(label, x - 0.1, 47.5,
    { size: 7.2, weight: 900, skew: -19, fill, outline, outlineWidth: 1.9 });
}
const vRuleRows = [
  { baseline: 317.2, erase: [139.7, 312.7, 92.5, 5.7, 'dark-band', 0, 0] },
  { baseline: 325.75, erase: [92.2, 321.2, 85.1, 5.95, 'band', 0, 0] },
];

function inkFor(field, layout, type, future) {
  const { profile } = layout;
  const classic = profile === 'classic' || profile === 'gym';
  if (classic && field === 'title') return ['classic-title', 36, 3];
  if (field === 'badge' && ['sv', 'ex', 'mega'].includes(profile)) return ['badge-interior', 0, 0];
  if (profile === 'sm' && field === 'evolves') return ['paper-ink', 33, 1];
  if (field === 'stage' && !classic) return outlinedText;
  if (layout.outlineText && ['title', 'heading', 'body'].includes(field)) return outlinedText;
  if (future && ['title', 'heading', 'body', 'power', 'label'].includes(field)) return outlinedText;
  if (profile === 'v' || profile === 'vmax') {
    if (field === 'heading' || field === 'body' || (field === 'title' && profile === 'vmax')) return outlinedText;
    if (field === 'rule') return ['paper-ink', 33, 2];
    if (field === 'label') return ['light', 167, 2];
    if (field === 'ruleLabel' && profile === 'v') return ['dark', 140, 2];
    if (field === 'title') return ['dark', 164, 2];
  }
  if (profile === 'mega' && field === 'title') return ['gold-outline', 112, 2];
  if (darkArt.has(type)) {
    if (field === 'power') return ordinaryInk.power;
    const ink = printedBodyFrames.has(profile) ? ['paper-light', 43, 3] : whiteText;
    if (field === 'label' && darkLabelFrames.has(profile)) return ink;
    if (darkFace.has(profile) && ['title', 'heading', 'body', 'flavor'].includes(field)) return ink;
  }
  if (printedBodyFrames.has(profile) && (field === 'body' || field === 'power')) return ['paper-ink', 27, 3];
  return ordinaryInk[field];
}

function maskRegion([x, y, w, h, field], layout, type, future) {
  if ((layout.profile === 'classic' || layout.profile === 'gym') && field === 'label') {
    return [x - 1.2, y - 0.65, w + 2.4, h + 1.3, 'classic-label', 24, 2];
  }
  if (layout.profile === 'sm' && field === 'badge') {
    // The white lettering sits between the printed silver edges of the tab.
    return [x - 0.8, 186.7, w + 1.6, 7.2, 'band', 0, 0];
  }
  if (layout.profile === 'v' && field === 'rule') {
    // Both samples for each repair row sit inside the black frame.
    return vRuleRows[y < 320 ? 0 : 1].erase;
  }
  if (layout.profile === 'vmax' && field === 'specialHeading') {
    return vmaxFormErase([x, y, w, h]);
  }
  // The name ends where the artwork's original ex/V/VMAX mark begins.
  const rightPadding = field === 'title' && layout.mark ? (layout.profile === 'v' ? 2.1 : 0.05) : 1.2;
  const inset = ['rule', 'ruleLabel', 'classicMeta'].includes(field) ? 0.4 : 1.05;
  let [mode, threshold, dilation] = inkFor(field, layout, type, future);
  if (field === 'title' && layout.mark) dilation = Math.min(dilation, 2);
  const afterAbilityTab = field === 'power' && modernAbilityFrames.has(layout.profile) && layout.parts[0].badge;
  const inkLeft = Math.max(0, x - inset);
  const left = afterAbilityTab ? Math.max(inkLeft, modernAbilityEdge + 0.9) : inkLeft;
  const top = Math.max(0, y - inset);
  let bottom = GRID[1];
  if (field === 'evolves' && layout.profile === 'sm') bottom = 37.7;
  if (field === 'title' && mode !== 'classic-title' && layout.profile !== 'vmax' && !layout.outlineText) {
    // Protect the artwork frame beneath the title, including the mask's dilation.
    bottom = 29.7;
  }
  return [left, top, Math.min(GRID[0], inkLeft + w + inset + rightPadding) - left,
    Math.min(bottom - top, h + inset * 2), mode, threshold, dilation];
}

export function pokemonRecipe(layout, card, content) {
  const { erase, measure, ...geometry } = layout;
  const classic = layout.profile === 'classic' || layout.profile === 'gym';
  const stage = geometry.stage;
  if (stage && !classic && right(stage) > geometry.title[0] + 3) {
    // OCR sometimes groups the whole first line, including the card name.
    // Use the printed stage tab, which ends just before the name.
    geometry.stage = [stage[0], 16.2, Math.min(34.5, geometry.title[0] - stage[0] - 3), 7.2];
  }
  if (Array.isArray(content.rule)) {
    geometry.ruleRows = erase.filter(box => box[4] === 'rule').map(box => box.slice(0, 4)).sort((a, b) => a[1] - b[1]);
    if (geometry.ruleRows.length !== content.rule.length) throw new Error('Rule rows do not match the printing');
  }
  const future = Boolean(card.tags?.includes('Future'));
  const logo = layout.markBox && [...layout.markBox];
  if (logo) {
    // OCR can include the mark in the last word. Leave room for its
    // leading stroke and let the strip extractor find the silhouette.
    const left = layout.profile === 'v' ? 0.8 : 3.4;
    const right = layout.profile === 'v' ? 4.6 : 1.4;
    logo[0] -= left;
    logo[2] += left + right;
  }
  const { cutouts, erase: inlineErase } = sourceInlineIcons(layout.inlineIcons);
  if (logo) cutouts.titleMark = { box: logo, mode: 'strip', mark: layout.mark, gold: layout.profile === 'mega' };
  const classicFlavor = classic && layout.flavor;
  const bodyRows = new Map();
  if (classic) {
    geometry.parts = geometry.parts.map((part, index) => {
      if (!part.body) return part;
      const [x, y, width, height] = part.body;
      const rows = erase.filter(box => box[4] === 'body' && box[1] >= y - 2 && box[1] < y + height);
      const rightEdge = content.moves[index].hasDamage ? Math.min(x + width, 194) : x + width;
      for (const row of rows) {
        const left = Math.min(row[0], x);
        bodyRows.set(row, [left, row[1], Math.max(right(row), rightEdge) - left, row[3], 'body']);
      }
      const last = Math.min(y + height, Math.max(bottom(part.name), ...rows.map(bottom)));
      return { ...part, centerY: (y + last) / 2 };
    });
  }
  const masks = erase.filter(box => !classicFlavor || !['flavor', 'stamp'].includes(box[4])).map(box => {
    const region = box[4] === 'stage' && geometry.stage !== stage ? [...geometry.stage, 'stage'] : bodyRows.get(box) ?? box;
    return maskRegion(region, layout, card.type, future);
  });
  // Scan the whole interior because OCR can miss individual digits or words.
  // The repair mode clips the ink mask to the measured border on each scan.
  if (classicFlavor) masks.push([16.7, 303.7, 212, 24.3, 'classic-flavor', 33, 2]);
  return {
    grid: GRID, scanAspect: true, erase: [...masks, ...inlineErase],
    preserveRules: classic,
    ...(Object.keys(cutouts).length ? { cutouts } : {}),
    pokemon: { geometry, type: card.type, hasPower: Boolean(card.power), future, content },
  };
}

const bottom = ([, y, , h]) => y + h;
const right = ([x, , w]) => x + w;

export function pokemonOverlay(recipe, font) {
  const { pokemon } = recipe;
  const { geometry: g, content: c, type, hasPower, future } = pokemon;
  const classic = g.profile === 'classic' || g.profile === 'gym';
  const art = framed.has(g.profile);
  const dark = darkArt.has(type) && darkFace.has(g.profile) && !g.outlineText;
  const outline = g.profile === 'v' || g.profile === 'vmax' || future || g.outlineText ? '#f9f9f5' : undefined;
  const ink = dark ? '#fafafa' : '#161617';
  const lightLabels = (outline && !future) || (dark && darkLabelFrames.has(g.profile));
  const inlineIcon = (type, x, baseline, size) => drawInlineIcon(g.inlineIcons, type, x, baseline, size);
  const bodyStyle = { fill: ink, outline, alignTop: true, inlineIcon };
  const plain = (text, box, style = {}) => {
    const [x, y, , h] = box;
    return faceText(text, x, y + h * 0.90, { size: Math.max(3.6, h * 0.90), ...style });
  };
  const paragraph = (text, box, size, style = {}) =>
    layoutParagraph(text, box, font, { size, minSize: 3.4, ...bodyStyle, ...style });
  const badgeCenter = ([, y, , h]) => y + h * 0.43;
  const badgeText = (text, box, size, fill, style = {}) => faceText(text, box[0] + box[2] / 2, badgeCenter(box) + size * 0.30,
    { size, fill, weight: 760, skew: true, anchor: 'middle', ...style });
  const titleStyle = {
    fill: g.profile === 'mega' ? '#ffe351' : ink,
    outline: g.profile === 'mega' ? '#252222' : g.profile === 'vmax' || future || g.outlineText ? outline : undefined,
  };
  const titleEnd = g.mark ? right(g.title) + 0.3 : (classic ? 164 : 169);
  const baseline = classic ? Math.min(34.3, bottom(g.title) - 0.7) :
    g.profile === 'v' ? 26.1 : g.profile === 'vmax' ? 27.9 : 27.4;
  const title = fitTitleLayout(c.title, g.title[0], baseline, titleEnd - g.title[0], font, classic ? 15.1 : 14.1,
    { minSize: 3.6, ...titleStyle });
  let svg = title.markup;
  let cutouts = recipe.cutouts;
  if (cutouts?.titleMark) {
    cutouts = { ...cutouts, titleMark: { ...cutouts.titleMark, position: [g.title[0] + title.advance + 2.1] } };
    svg += '{{titleMark}}';
  }
  if (g.stage) svg += classic ? plain(c.stage, g.stage, { fill: '#28282a', size: 5.9, weight: 760 }) :
    badgeText(c.stage, g.stage, 6.3, '#333537',
      { weight: 820, skew: -14, outline: '#fcfcfa', outlineWidth: 1.05 });
  if (g.evolves) {
    const box = g.profile === 'sm' ? [g.evolves[0], g.evolves[1] - 0.7, ...g.evolves.slice(2)] : g.evolves;
    svg += plain(c.evolves, box, { fill: '#262628', weight: 680, skew: true });
  }
  if (g.extra) svg += plain(c.extra, [right(g.extra), ...g.extra.slice(1)], { fill: '#282828', weight: 620, anchor: 'end' });
  if (g.meta) {
    const size = classic ? 6.1 : 4.7;
    const baseline = g.meta[1] + g.meta[3] * 0.38 + size * 0.27;
    svg += fitTitle(c.measure, 122.5, baseline, g.meta[2], font, size, {
      minSize: 3.4, weight: 620, anchor: 'middle', fill: '#19191a', skew: classic,
    });
  }
  if (classic && g.catalog) {
    const stamp = 'LV.' + g.catalog.level + ' #' + g.catalog.dex;
    if (g.flavor) {
      svg += paragraph(c.flavor + ' ' + stamp, [g.flavor[0], 309, 226 - g.flavor[0], 15], 5.65,
        { fill: ink, skew: true, weight: 640, alignTop: false });
    } else {
      svg += plain(stamp, g.stamp, { size: 5.65, fill: ink, skew: true, weight: 680 });
    }
  } else if (g.flavor) {
    svg += paragraph(c.flavor, g.flavor, 5.45, { fill: ink, outline: undefined, alignTop: false, skew: true });
  }
  for (const [key, box] of Object.entries(g.labels)) {
    if (classic) {
      const [x, y, w, h] = box;
      svg += faceText(c.labels[key], x + w / 2, y + h / 2 + 2.15,
        { size: 6.1, anchor: 'middle', weight: 760 });
    } else {
      svg += plain(c.labels[key], box, { size: 4.65, fill: lightLabels ? '#fafafa' : '#19191a',
        outline: future ? outline : undefined, weight: 720 });
    }
  }
  for (const [index, part] of g.parts.entries()) {
    const { heading, body, hasDamage } = c.moves[index];
    const power = hasPower && index === 0;
    if (part.badge) {
      svg += modernAbilityFrames.has(g.profile)
        ? badgeText(spreadAbilityLabel(c.powerLabel), part.badge, 7.6, '#fff', { weight: 850, skew: -14 })
        : badgeText(c.powerLabel, part.badge, 6.15, '#fff');
    }
    const name = classic && power ? c.powerLabel + '　' + heading : heading;
    if (classic && body) {
      const box = [...part.body];
      if (hasDamage) box[2] = Math.min(box[2], 193.5 - box[0]);
      svg += paragraph(body, box, power ? 8 : 8.6, {
        heading: name, headingSize: power ? 10.4 : 11.5, headingWeight: 810, headingFill: power ? '#a12a2c' : ink,
        alignTop: false, centerY: part.centerY,
      });
    } else {
      const size = classic ? 11.3 : 10.8;
      const style = { fill: power ? (dark ? '#ff8a83' : '#a92425') : ink, outline, ...(classic && { weight: 810 }) };
      const [nameX, top, w, h] = part.name;
      const x = part.badge && modernAbilityFrames.has(g.profile) ? Math.max(nameX, modernAbilityEdge + 2.5) : nameX;
      // English descenders extend the detected box below the printed baseline.
      const baseline = classic ? top + h / 2 + size * 0.34 :
        part.badge ? badgeCenter(part.badge) + size * 0.36 : top + size * 0.86;
      if (classic && x > 65) {
        const center = x + w / 2;
        const fitted = fitTitleLayout(name, 0, baseline, 2 * Math.min(center - 46, 199 - center), font, size,
          { minSize: 3.6, ...style });
        svg += `<g transform="translate(${center - fitted.advance / 2} 0)">${fitted.markup}</g>`;
      } else {
        svg += fitTitle(name, x, baseline, 199 - x, font, size, { minSize: 3.6, ...style });
      }
      if (body) svg += paragraph(body, part.body, art ? 7.7 : 7.6);
    }
  }
  if (g.rule) {
    const inverted = g.profile === 'v';
    const [labelX, labelTop, labelWidth, labelHeight] = g.ruleLabel ?? [g.rule[0] + 3, g.rule[1], 82, 6];
    const labelBaseline = inverted ? vRuleRows[0].baseline : labelTop + labelHeight * 0.90;
    svg += fitTitle(c.ruleLabel, labelX, labelBaseline, Math.max(labelWidth, 72), font, 5.7, {
      minSize: 3.4, weight: 760, fill: inverted ? '#222' : g.profile === 'mega' ? '#ffe36a' : '#fff', skew: true,
    });
    const fill = inverted ? '#fff' : '#222';
    if (g.ruleRows) {
      for (const [i, row] of g.ruleRows.entries()) {
        const baseline = inverted ? vRuleRows[i].baseline : bottom(row) - 0.35;
        svg += fitTitle(c.rule[i], row[0], baseline, row[2], font, 5.25, { minSize: 3.0, fill });
      }
    } else {
      const top = Math.max(labelBaseline + 0.4, bottom(g.rule) - 10);
      svg += paragraph(c.rule, [g.rule[0] + 3, top, 229 - g.rule[0], Math.max(8, bottom(g.rule) + 1 - top)], 5.6,
        { fill, outline: undefined, alignTop: false });
    }
  }
  if (g.special) {
    if (c.specialKind === 'vmax') {
      svg += vmaxFormText(c.special, g.special[0], g.vmaxForm);
    } else if (c.specialKind === 'megaForm') {
      svg += plain(c.special, g.special, { size: 5.8, weight: 690 });
    } else {
      const y = g.special[1];
      const tera = c.specialKind === 'tera';
      svg += plain(c.specialLabel, [tera ? 174 : 24, y, 35, 7], { size: 6.2, weight: 760, skew: true });
      svg += paragraph(c.special, [tera ? 54 : 23, y + 7.5, tera ? 160 : 190, tera ? 14.5 : 10], 5.5,
        { fill: '#202020', outline: undefined, alignTop: true });
    }
  }
  return { ...recipe, cutouts, overlay: svg };
}
