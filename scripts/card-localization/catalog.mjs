import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { contentName } from '../../public/content-i18n/names.js';
import { STRINGS as es } from '../../public/i18n/es.js';
import { STRINGS as ja } from '../../public/i18n/ja.js';
import { STRINGS as tr } from '../../public/i18n/tr.js';
import { STRINGS as zhHans } from '../../public/i18n/zh-Hans.js';
import { STRINGS as zhHant } from '../../public/i18n/zh-Hant.js';
import { normalizeLanguage } from '../../public/locales.js';
import { escapeXml } from './render.mjs';
import './flow.mjs';
import { materializeFace, modernTrainerBodyTop, modernTrainerCategoryBox } from '../../public/card-image/layout.js';
export { materializeFace } from '../../public/card-image/layout.js';
import { pokemonRecipe, sourceInlineIcons, spreadAbilityLabel, vmaxFormErase, vmaxFormText } from '../../public/card-image/pokemon.js';

const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));
const layouts = readJson(new URL('./data/layouts.json', import.meta.url));
const pokemonLayouts = readJson(new URL('./data/pokemon-layouts.json', import.meta.url));
const scanLayouts = readJson(new URL('./data/scan-layouts.json', import.meta.url));
const effects = readJson(new URL('./data/effects.json', import.meta.url));
const cohorts = readJson(new URL('./data/cohorts.json', import.meta.url));
const cardPacks = new Map();
const publicDir = fileURLToPath(new URL('../../public/', import.meta.url));
const fonts = {
  'zh-Hans': 'PingFang SC, Hiragino Sans GB, sans-serif',
  'zh-Hant': 'PingFang TC, sans-serif',
  ja: 'Hiragino Sans, sans-serif',
};
const languageTags = { 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-TW' };
const trainerColors = { item: '#096dac', supporter: '#d7521d', stadium: '#329737', tool: '#695099' };
const containsHeader = ([x, y, w, h], [hx, hy, hw, hh]) =>
  x >= hx - 2 && x <= hx && y >= hy - 2 && y <= hy && w >= hw && h >= hh;
const trainerRuleEnds = {
  stadium: [[89, 320.9, 106, 5.5]],
  tool: [[89, 320.9, 137.5, 3.8], [89, 324.7, 134.5, 1.8]],
};
const gameLabels = { es, ja, tr, 'zh-Hans': zhHans, 'zh-Hant': zhHant };
const sharedLabels = { ability: 'group.ability', retreat: 'group.retreat', stadium: 'group.stadium', trainer: 'group.trainer' };

class IncompleteCopy extends Error {}

let deckCards;
function cards() {
  if (deckCards) return deckCards;
  const root = join(publicDir, 'data/decks');
  deckCards = new Map();
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const card of readJson(join(root, dir.name, 'cards.json')).cards) {
      if (!deckCards.has(card.id)) deckCards.set(card.id, card);
    }
  }
  return deckCards;
}

function packFor(locale) {
  if (!cardPacks.has(locale)) {
    let pack;
    try { pack = readJson(new URL('./data/locales/' + locale + '.json', import.meta.url)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    cardPacks.set(locale, pack);
  }
  return cardPacks.get(locale);
}

function required(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new IncompleteCopy('Missing ' + field);
  return value;
}

function localizedName(locale, kind, reference) {
  const sameSpelling = locale === 'es' || locale === 'tr';
  return required(contentName(locale, kind, reference, sameSpelling ? reference.name : ''),
    'name.' + (reference.name ?? reference.id));
}

function labelsFor(locale, pack) {
  const shared = Object.fromEntries(Object.entries(sharedLabels).map(([key, value]) => [key, gameLabels[locale]?.[value]]));
  return { ...shared, ...pack.labels };
}

function interpolate(template, values) {
  return template.replace(/\{([\w.]+)\}/g, (token, key) => {
    if (key.startsWith('icon.')) return token;
    if (!Object.hasOwn(values, key) || values[key] == null) throw new IncompleteCopy('Missing value ' + key);
    return values[key];
  });
}

function stripMark(name, mark) {
  return mark && name.endsWith(mark) ? name.slice(0, -mark.length).replace(/[\s\-]+$/u, '') : name;
}

function namesFor(card, locale, layout) {
  const localized = (kind, name) => localizedName(locale, kind, { sourceCardId: card.id, name });
  const title = stripMark(localized('card', card.name), layout.titleMark);
  const power = card.power && localized('power', card.power.name);
  const team = title.split(/\s*[&＆]\s*/u);
  const conjunction = locale === 'es' ? ' y ' : locale === 'tr' ? ' ve ' : '';
  const last = conjunction ? title.lastIndexOf(conjunction) : -1;
  const teamHead = last > 0 ? title.slice(0, last) : team.slice(0, 2).join('＆');
  const teamTail = last > 0 ? title.slice(last + 1) : team.length > 2 ? '＆' + team.slice(2).join('＆') : '';
  return (path, labels) => {
    const [key, value] = path.split('.');
    switch (key) {
      case 'card':
        if (value === 'teamHead') return teamHead;
        if (value === 'teamTail') return teamTail;
        return title;
      case 'power': return value === 'classic' ? required(labels.power, 'label.power') + '　' + power : power;
      case 'attack': {
        const attack = card.attacks?.[Number(value)];
        return attack && stripMark(localized('attack', attack.name), layout.attackMarks?.[value]);
      }
      case 'evolves': return interpolate(required(labels.evolves, 'label.evolves'), {
        name: localizedName(locale, 'card', { name: card.evolvesFrom }),
      });
      case 'person': return localizedName(locale, 'person', { id: value });
      default: throw new Error('Unknown name reference ' + path);
    }
  };
}

function bindLegacy(card, layout, pack, locale) {
  const copy = pack.printings?.[card.id];
  if (!copy) throw new IncompleteCopy('No card face copy for ' + card.id);
  const labels = labelsFor(locale, pack);
  const name = namesFor(card, locale, layout);
  const values = {
    ...layout.values, cardName: name('card', labels), powerName: name('power', labels),
    ...Object.fromEntries(Object.entries(layout.nameRefs ?? {}).map(([key, { kind, ...reference }]) =>
      [key, localizedName(locale, kind, reference)])),
  };
  const used = new Set();
  const paragraphs = {};
  const headings = {};
  const overlay = layout.overlay.replace(/\[\[([\w.]+)\]\]/g, (_, ref) => {
    const [kind, ...segments] = ref.split('.');
    const key = segments.join('.');
    used.add(ref);
    let value;
    switch (kind) {
      case 'label':
        value = key === 'ability' && /^(sv|me)/.test(card.set) ? spreadAbilityLabel(labels[key]) : labels[key];
        break;
      case 'copy': value = interpolate(required(copy[key], ref), values); break;
      case 'paragraph': {
        const spec = layout.paragraphs[key];
        paragraphs[key] = { ...spec, text: interpolate(required(copy[key], ref), values) };
        return '[[' + ref + ']]';
      }
      case 'heading': {
        const spec = layout.headings[key];
        headings[key] = { ...spec, text: required(name(spec.name, labels), ref) };
        return '[[' + ref + ']]';
      }
      case 'value': value = layout.values?.[key]; break;
      case 'name': value = name(key, labels); break;
      case 'badge': {
        if (key !== 'vmaxForm' || !layout.vmaxForm) throw new Error('Unknown card face badge ' + key);
        const form = layout.vmaxForm;
        return vmaxFormText(required(labels[form.label], ref), form.box[0], form);
      }
      case 'meta': {
        if (key !== 'species' || !layout.measure) throw new Error('Unknown card face fact ' + key);
        const { heightIn, weightLb, dex } = layout.measure;
        const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
        const measure = interpolate(required(labels.measure, 'label.measure'), {
          height: format.format(heightIn * 0.0254), weight: format.format(weightLb * 0.45359237),
        });
        value = [dex && interpolate(required(labels.catalogNo, 'label.catalogNo'), { dex }),
          required(copy.species, 'species'), measure].filter(Boolean).join('　');
        break;
      }
      default: throw new Error('Unknown card face reference ' + ref);
    }
    return escapeXml(required(value, ref));
  });
  if (!used.size) throw new Error('No text bindings for ' + card.id);
  const inline = sourceInlineIcons(layout.inlineIcons);
  return {
    ...layout, overlay,
    erase: [...layout.erase, ...(layout.vmaxForm ? [vmaxFormErase(layout.vmaxForm.box)] : []), ...inline.erase],
    ...(layout.inlineIcons && { cutouts: { ...layout.cutouts, ...inline.cutouts } }),
    ...(layout.paragraphs && { paragraphs }),
    ...(layout.headings && { headings }),
  };
}

function trainerBody(card, layout, pack) {
  const printing = pack.scan?.[card.id]?.body;
  if (printing) return printing;
  const effect = effects[layout.effect];
  if (!effect) throw new Error('Unknown effect ' + layout.effect);
  const copy = required(pack.effects?.[layout.effect], 'effect.' + layout.effect);
  const tokens = [...copy.matchAll(/\{([\w.]+)\}/g)].map((match) => match[1]);
  const values = { ...effect.values, ...layout.values };
  const icons = tokens.filter(key => key.startsWith('icon.')).map(key => key.slice(5)).sort();
  if (Object.keys(values).some(key => !tokens.includes(key)) ||
      JSON.stringify(icons) !== JSON.stringify([...(effect.icons ?? [])].sort())) {
    throw new IncompleteCopy('Effect tokens do not match ' + layout.effect);
  }
  return interpolate(copy, values);
}

function bindTrainer(card, layout, pack, locale) {
  const labels = labelsFor(locale, pack);
  const label = (key) => required(labels[key], 'label.' + key);
  const rule = interpolate(required(pack.rules?.[card.ttype], 'rule.' + card.ttype), { once: 1 });
  const body = trainerBody(card, layout, pack);
  const name = localizedName(locale, 'card', card);
  const title = layout.subtitle ? name.replace(/\s*[（(][^()（）]+[）)]$/u, '') : name;
  const subtitle = layout.subtitle ? localizedName(locale, 'person', { id: layout.subtitle }) : '';
  const category = label(card.ttype), trainer = label('trainer');
  return {
    grid: [245, 342],
    erase: [
      [...modernTrainerCategoryBox, 'band', 0, 0],
      [153, 10, 80, 11.5, 'band', 0, 0],
      [14, 26.8, 216, 17.5, 'band', 0, 0],
      [15.8, 190, 211.6, 90, 'dark', 195, 4],
      [89, 302.5, 141.5, 18.4, 'dark', 159, 2],
      // Only Stadium and Tool rules have a third English line.
      // Narrow the mask to stay inside the lower corner of the rule panel.
      ...(trainerRuleEnds[card.ttype] ?? []).map(box => [...box, 'dark', 159, 2]),
    ],
    content: { title, subtitle, category, trainer, body, rule, color: trainerColors[card.ttype] },
  };
}

function bindEnergy(pack) {
  const label = (key) => required(pack.labels?.[key], 'label.' + key);
  return {
    grid: [245, 342],
    erase: [[11.5, 10, 77, 10.3], [154, 10, 78, 11], [14, 26, 40, 17.8], [73, 26, 54, 17.8]]
      .map((box) => [...box, 'band', 0, 0]),
    content: { basicEnergy: label('basicEnergy'), energy: label('energy'), basic: label('basicPrefix'), suffix: label('energySuffix') },
  };
}

function bindScan(card, layout, pack, locale) {
  const { profile, erase, title, titleIcon, body, rule, family, inlineIcons, outlineText, detail } = layout;
  const headers = { ...layout.headers };
  const labels = labelsFor(locale, pack);
  const label = key => required(labels[key], 'label.' + key);
  const trainer = profile === 'scanTrainer';
  const earlyModernTrainer = trainer && ['sm', 'swsh'].includes(family);
  if (earlyModernTrainer) delete headers.trainer;
  const category = earlyModernTrainer && card.ttype === 'tool' ? 'item' : card.ttype;
  const copy = pack.scan?.[card.id];
  const headerCopy = {
    trainer: () => label('trainer'),
    category: () => label(category ?? 'item'),
    energy: () => label('energy'),
    energyCategory: () => label(card.special ? 'specialEnergy' : 'basicEnergy'),
    tool: () => label('tool'),
  };
  const inline = sourceInlineIcons(inlineIcons);
  const modernTrainer = trainer && family === 'sv';
  const categoryBox = (modernTrainer || earlyModernTrainer) && headers.category;
  const masks = erase.filter(box => !(categoryBox && containsHeader(box, categoryBox)) &&
    !(earlyModernTrainer && containsHeader(box, layout.headers.trainer)) &&
    !(headers.tool && containsHeader(box, headers.tool)));
  if (categoryBox) {
    const [x, y, w, h] = categoryBox;
    // The divider on the Sun & Moon tab can be included in the OCR span.
    const left = family === 'sm' ? Math.max(171.2, x - 1.2) : x - 1.2;
    const band = earlyModernTrainer ? [left, y - 1.25, x + w + 1.2 - left, h + 2.5] : modernTrainerCategoryBox;
    masks.push([...band, 'band', 0, 0]);
  }
  if (headers.tool) {
    const [x, y, w, h] = headers.tool;
    masks.push([x - 0.9, y - 0.65, w + 1.8, h + 1.3, 'band', 0, 0]);
  }
  const toolIntro = headers.tool && [
    required(pack.rules?.toolAttach, 'rule.toolAttach'), required(pack.rules?.toolLimit, 'rule.toolLimit'),
  ];
  let effectBox = body;
  let centerEffect = false;
  if (trainer && body) {
    let [x, y, w, h] = body;
    if (family === 'classic') {
      const firstLine = erase.find(box => box[1] >= y - 1);
      if (firstLine) {
        const center = firstLine[0] + firstLine[2] / 2;
        centerEffect = firstLine[0] > 44 && Math.abs(center - 122.5) < 20;
        x = centerEffect ? Math.max(22, 2 * center - 223) : firstLine[0] + 0.65;
        w = centerEffect ? 2 * (center - x) : 223 - x;
      }
    }
    const top = family === 'classic' ? 214 : headers.tool ? 208 : modernTrainerBodyTop;
    const bottom = Math.max(y + h, family === 'classic' ? 308 : Math.min(285, (rule?.[1] ?? 294) - 9));
    effectBox = detail ? body : [x, top, w, bottom - top];
  }
  return {
    grid: [245, 342], scanAspect: true, erase: [...masks, ...inline.erase], repeatRows: layout.repeatRows,
    ...(inlineIcons ? { cutouts: inline.cutouts } : {}),
    scan: {
      title, titleIcon, headers, body: effectBox, rule, family, inlineIcons, outlineText, trainer, centerEffect, toolIntro, detail,
      detailCopy: detail && {
        heading: copy?.detail?.heading ?? localizedName(locale, card.power ? 'power' : 'attack', {
          sourceCardId: card.id, name: card.power?.name ?? card.attacks?.[0]?.name,
        }),
        effect: required(copy?.detail?.effect, 'scan.detail.effect.' + card.id),
        ability: detail.ability && label('ability'),
        form: detail.form && label('vstarPower'),
      },
      color: categoryBox ? trainerColors[category] : undefined,
      heading: title && localizedName(locale, 'card', card),
      headerCopy: Object.fromEntries(Object.keys(headers).map(key => [key, headerCopy[key]()])),
      effect: body && required(copy?.body, 'scan.body.' + card.id),
      ruleCopy: rule && interpolate(required(copy?.rule ?? pack.rules?.[category], 'scan.rule.' + card.id), { once: 1 }),
    },
  };
}

function bindPokemon(card, layout, pack, locale) {
  const copy = pack.pokemon?.[card.id];
  if (!copy) throw new IncompleteCopy('No Pokémon card face copy for ' + card.id);
  const labels = labelsFor(locale, pack);
  const label = (key) => required(labels[key], 'label.' + key);
  const names = namesFor(card, locale, { titleMark: layout.mark });
  const title = names('card', labels);
  const items = [...(card.power ? [card.power] : []), ...card.attacks];
  const attackNames = card.attacks.map((_, index) => names('attack.' + index, labels));
  const powerName = card.power && names('power', labels);
  const values = { cardName: title, powerName, ...Object.fromEntries(attackNames.map((name, i) => ['attack' + i, name])) };
  const moves = items.map((item, i) => {
    const heading = card.power && i === 0 ? powerName : attackNames[i - Number(Boolean(card.power))];
    const digits = Object.fromEntries((item.text?.match(/\d+/g) ?? []).map((n, j) => ['n' + j, n]));
    const body = item.text ? interpolate(required(copy.moves?.[i], 'move.' + i), { ...values, ...digits }) : '';
    return { heading, body, hasDamage: Boolean(item.damage) };
  });
  const classic = layout.profile === 'classic' || layout.profile === 'gym';
  const stage = layout.stage && label(card.stage ? 'stage' + card.stage : classic ? 'basicPokemon' : 'basic');
  const evolves = layout.evolves && names('evolves', labels);
  const evolutionRule = card.stage === 2 ? 'classicEvolveStage1' : 'classicEvolve';
  const extra = layout.extra && required(pack.pokemonRules?.[evolutionRule], 'rule.' + evolutionRule);
  const ruleCopy = pack.pokemonRules?.[layout.profile];
  const ruleLine = (copy) => interpolate(required(copy, 'rule.' + layout.profile), { prizes: card.prizes });
  const rule = layout.rule && (Array.isArray(ruleCopy) ? ruleCopy.map(ruleLine) : ruleLine(ruleCopy));
  const ruleLabel = layout.rule && label(layout.profile + 'Rule');
  const specialKind = card.tags?.includes('Tera') ? 'tera' : layout.profile === 'mega' ? 'megaForm' : layout.profile;
  let special;
  if (layout.special) {
    special = specialKind === 'vmax' ? label(required(layout.vmaxForm?.label, 'vmaxForm.label')) :
      interpolate(required(pack.pokemonRules?.[specialKind], 'rule.' + specialKind), { name: title.replace(/^超[级級]/u, '') });
  }
  let measure;
  if (layout.measure) {
    const { heightIn, weightLb, dex } = layout.measure;
    const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    measure = [
      dex && interpolate(label('catalogNo'), { dex }),
      (labels.speciesPrefix ?? '') + required(copy.species, 'species') + (labels.speciesSuffix ?? ''),
      interpolate(label('measure'), { height: format.format(heightIn * 0.0254), weight: format.format(weightLb * 0.45359237) }),
    ].filter(Boolean).join('　');
  }
  return pokemonRecipe(layout, card, {
    title, stage, evolves, extra, measure, rule, ruleLabel, special, specialKind, moves,
    powerLabel: card.power && label(classic ? 'power' : 'ability'),
    specialLabel: specialKind === 'tera' ? label('tera') : specialKind === 'radiant' ? label('radiantRule') : null,
    flavor: layout.flavor && required(copy.flavor, 'flavor'),
    labels: Object.fromEntries(Object.keys(layout.labels).map(key => [key, label(key)])),
  });
}

export function cohortIds(cohort = 'all') {
  if (cohort === 'all') return Object.values(cohorts).flat();
  if (cohort === 'catalog') return [...cards().keys()];
  if (cohort === 'zh-Hant-100') {
    return Object.keys(readJson(new URL('./data/reviews/zh-Hant-100.json', import.meta.url)).cards);
  }
  if (!Object.hasOwn(cohorts, cohort)) throw new Error('Unknown card sample group ' + cohort);
  return cohorts[cohort];
}

// Resolving a face binds the canonical display names and local resources. It
// performs no font measurement, image processing, or network access.
export function resolveCardFace(id, language = 'zh-Hans') {
  const locale = normalizeLanguage(language);
  if (!locale) throw new Error('Unsupported card image language ' + language);
  const card = cards().get(id);
  if (!card) throw new Error('Unknown card ID ' + id);
  let name = contentName(locale, 'card', card);
  const ui = gameLabels[locale];
  if (name === card.name && card.kind === 'energy' && !card.special && ui?.energy && ui['type.' + card.energyType]) {
    name = interpolate(ui.energy, { t: ui['type.' + card.energyType] });
  }
  const scan = card.imgLarge ?? card.img;
  const input = join(publicDir, scan.replace(/\.webp$/i, '.png'));
  const fallback = (reason) => ({ id, name, input, requestedLocale: locale, actualLocale: 'en', reason });
  const scanLayout = scanLayouts[id];
  if (scanLayout?.profile === 'scanEnergy' && ['classic', 'sm'].includes(scanLayout.family) && !card.special) {
    return { id, name, input, requestedLocale: locale, actualLocale: locale, shared: true };
  }
  if (locale === 'en') return fallback('original');

  const pokemon = pokemonLayouts[id];
  const layout = pokemon ?? layouts[id] ?? scanLayouts[id], pack = packFor(locale);
  if (!layout) return fallback('no-layout');
  if (!pack) return fallback('no-language-pack');

  try {
    const face = pokemon ? bindPokemon(card, layout, pack, locale) : layout.profile === 'modernTrainer' ? bindTrainer(card, layout, pack, locale) :
      layout.profile === 'sveEnergy' ? bindEnergy(pack) : scanLayouts[id] === layout ? bindScan(card, layout, pack, locale) : bindLegacy(card, layout, pack, locale);
    return {
      id, name, input, scan, requestedLocale: locale, actualLocale: locale,
      font: fonts[locale] ?? 'Arial, sans-serif',
      recipe: { ...face, id, locale: languageTags[locale] ?? locale, profile: layout.profile },
    };
  } catch (error) {
    if (error instanceof IncompleteCopy) return fallback(error.message);
    throw error;
  }
}

export function materializeCohort(cohort) {
  return cohortIds(cohort).map(id => {
    const face = resolveCardFace(id);
    return { ...materializeFace(face), name: face.name };
  });
}
