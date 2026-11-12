import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { LANGS, normalizeLanguage, chooseLanguage, initialLanguage } from '../public/locales.js';
import { setLang, getLang, t, cardName, attackName, powerName, termName, deckName, resolve, RULES_HTML } from '../public/i18n.js';
import { CARDS, DECKS, loadDeck } from '../public/cards.js';
import { C, Game, Mon } from '../public/engine.js';
import { aiConfig, buildState, rankActions } from '../public/ai.js';
import * as en from '../public/i18n/en.js';
import * as es from '../public/i18n/es.js';
import * as tr from '../public/i18n/tr.js';
import * as ja from '../public/i18n/ja.js';
import * as zhHans from '../public/i18n/zh-Hans.js';
import * as zhHant from '../public/i18n/zh-Hant.js';
import { names as zhHansNames } from '../public/content-i18n/zh-Hans.js';
import { names as zhHantNames } from '../public/content-i18n/zh-Hant.js';
import { names as jaNames, sets as jaSets } from '../public/content-i18n/ja.js';
import { names as esNames, sets as esSets } from '../public/content-i18n/es.js';
import { names as trNames, sets as trSets } from '../public/content-i18n/tr.js';
import { cohortIds, materializeFace, resolveCardFace } from '../scripts/card-localization/catalog.mjs';
import { printedCandidates } from '../scripts/card-localization/printed.mjs';
import { cardImageAsset, cardImageCoverageAsset } from '../scripts/card-localization/runtime-assets.mjs';
import { localizedCardImage } from '../public/card-image/source.js';

let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const params = (s) => [...new Set(s.match(/\{\w+\}/g) || [])].sort();

function validHTML(html, label) {
  const stack = [];
  const voids = new Set(['br', 'img', 'hr', 'input', 'meta', 'link']);
  for (const [, closing, tag] of html.matchAll(/<(\/)?([a-z][\w-]*)\b[^>]*>/gi)) {
    if (voids.has(tag)) continue;
    if (closing) assert.equal(stack.pop(), tag, `${label}: unbalanced </${tag}>`);
    else stack.push(tag);
  }
  assert.deepEqual(stack, [], `${label}: unclosed tags`);
  check(!/<(?:script|iframe|object)\b|\bon\w+\s*=/i.test(html), `${label}: unexpected active HTML`);
}

const keys = Object.keys(en.STRINGS).sort();
for (const lang of LANGS) {
  const dict = await import(`../public/i18n/${lang}.js`);
  assert.deepEqual(Object.keys(dict.STRINGS).sort(), keys, `${lang}: keys must match English`);
  checks++;
  for (const [key, value] of Object.entries(dict.STRINGS)) {
    check(typeof value === 'string', `${lang}.${key}: expected a string`);
    assert.deepEqual(params(value), params(en.STRINGS[key]), `${lang}.${key}: placeholders`);
    checks++;
  }
  check(Boolean(RULES_HTML[lang]), `${lang}: missing rules`);
  check(dict.RULES.includes('{charmanderImage}'), `${lang}: missing rule illustration slot`);
}
validHTML(ja.RULES, 'ja rules');
assert.deepEqual(params(ja.RULES), params(en.RULES), 'ja: rules parameters');

for (const [lang, dict] of [['zh-Hans', zhHans], ['zh-Hant', zhHant]]) {
  for (const [key, value] of Object.entries(dict.STRINGS)) {
    check(en.STRINGS[key] === '' || value.trim().length > 0, `${lang}.${key}: empty translation`);
    if (value.includes('<')) validHTML(value, `${lang}.${key}`);
  }
  assert.deepEqual(params(dict.RULES), params(en.RULES), `${lang}: rules parameters`);
  check(dict.RULES.includes('data-dice-chart'), `${lang}: missing dice chart`);
  validHTML(dict.RULES, `${lang} rules`);
  const simplified = lang === 'zh-Hans';
  for (const name of simplified
    ? ['小火龙（Charmander）', '火恐龙', '妙蛙种子', '喷射火焰', '神奇糖果']
    : ['小火龍（Charmander）', '火恐龍', '妙蛙種子', '噴射火焰', '神奇糖果']) {
    check(dict.RULES.includes(name), `${lang}: include ${name}`);
  }
  check(dict.STRINGS['act.t.professorsResearch'].includes('博士的研究'), `${lang}: Research action label`);
  setLang(lang);
  check(getLang() === lang, `${lang}: selection`);
  check(cardName({kind: 'pokemon', name: 'Charizard ex'}) === (simplified ? '喷火龙ex' : '噴火龍ex'), `${lang}: card name`);
  check(t('ex.hp', {hp: 100, n: 10}).includes('100'), `${lang}: interpolate HP`);
  check(t('log.energy', {P: {$pl: 0}, c: {$card: {kind: 'pokemon', name: 'Pikachu'}}, m: 'Charizard'})
    .includes('皮卡丘'), `${lang}: nested card parameters`);
  check(t('not.a.key') === 'not.a.key', `${lang}: missing-key fallback`);
  check(!setLang('unsupported') && getLang() === lang, `${lang}: invalid selection must not corrupt state`);
}

// Exercise real deck data and the same save/log across English and both Chinese locales.
{
  const decks = ['svl-charizard', 'svl-charizard'];
  await Promise.all(decks.map(loadDeck));
  const events = [];
  let arenaAttack;
  const hooks = { onLog: (event) => events.push(event), onAttack: ({ atk }) => { arenaAttack = atk; } };
  const game = new Game({ decks, controllers: [], hooks });
  const [me, opp] = game.players;
  const take = (p, id) => {
    const i = p.deck.findIndex((c) => c.id === id);
    assert.ok(i >= 0, id);
    return p.deck.splice(i, 1)[0];
  };
  me.active = new Mon(take(me, 'sv3-125'), 1);
  me.active.energy = [take(me, 'sve-2'), take(me, 'sve-2')];
  me.active.tools = [{ card: take(me, 'sv4-178'), expires: 7 }];
  me.bench = [new Mon(take(me, 'sv3-164'), 1)];
  me.hand = [take(me, 'sv1-189')];
  opp.active = new Mon(take(opp, 'sv3-125'), 1);
  for (const player of game.players) player.prizes = player.deck.splice(-6);
  Object.assign(game, { turn: 5, current: me, first: me, phase: 'main' });

  const label = ({ label }) => t(label.key, label.params);
  const snapshot = JSON.stringify(game.serialize());
  setLang('en');
  const englishActions = game.legalActions(me);
  const englishState = buildState(game, me);
  check(englishActions.some((a) => a.kind === 'attack' && label(a).includes('Burning Darkness')), 'English attack action');
  setLang('zh-Hans');
  const actions = game.legalActions(me);
  check(actions.some((a) => a.kind === 'trainer' && label(a).includes('博士的研究')), 'Chinese Trainer action');
  check(actions.some((a) => a.kind === 'power' && label(a).includes('音速搜索') && label(a).includes('大比鸟ex')), 'Chinese Ability action');
  const burn = actions.find((a) => a.kind === 'attack' && label(a).includes('燃烧黑暗'));
  check(Boolean(burn), 'Chinese attack action');
  check(actions.some((a) => a.kind === 'attack' && label(a).endsWith('进化')), 'TM attack uses the Tool printing');
  check(powerName(CARDS['sv3-125'].power) === '烈炎支配', 'Simplified Chinese Charizard Ability title');
  check(cardName(me.hand[0]) === '博士的研究', 'Simplified Chinese Trainer title');
  check(cardName(me.active.energy[0]) === '基本火能量', 'Simplified Chinese Basic Energy title');
  check(deckName(decks[0], DECKS[decks[0]].name) === '喷火龙ex 联盟对战卡组', 'Chinese deck title');
  check(deckName('svl-gardevoir', DECKS['svl-gardevoir'].name) === '沙奈朵ex 联盟对战卡组', 'another League deck title');
  check(deckName('sm-luminous-frost', DECKS['sm-luminous-frost'].name) === '冰霜映辉', 'historical Sun & Moon deck title');
  check(deckName('untranslated', 'Unknown Deck') === 'Unknown Deck', 'missing deck title falls back');
  check(cardName({ id: 'untranslated', name: 'Unknown Card' }) === 'Unknown Card', 'missing card title falls back');
  check(attackName({ name: 'Unknown Attack' }) === 'Unknown Attack', 'missing attack title falls back');
  check(t('pl.1') === '小茂', 'Chinese opponent name');
  assert.deepEqual(actions, englishActions, 'locale must not affect legal actions');
  assert.deepEqual(buildState(game, me), englishState, 'AI state remains English');
  assert.equal(JSON.stringify(game.serialize()), snapshot, 'changing language does not rewrite game state');
  checks += 3;

  setLang('zh-Hant');
  check(powerName(CARDS['sv3-125'].power) === '煉獄支配', 'Taiwan Charizard Ability title');
  check(cardName(CARDS['sv4-178']) === '招式學習器 演進', 'Taiwan Technical Machine card title');
  check(actions.some((a) => a.kind === 'attack' && label(a).endsWith('演進')), 'Traditional TM attack uses the Tool printing');
  assert.deepEqual(game.legalActions(me), englishActions, 'Traditional Chinese preserves legal actions');
  assert.deepEqual(buildState(game, me), englishState, 'Traditional Chinese preserves the AI state');
  assert.equal(JSON.stringify(game.serialize()), snapshot, 'Traditional Chinese preserves the save');
  checks += 3;
  setLang('ja');
  check(cardName(CARDS['sv3-125']) === 'リザードンex', 'Japanese card name');
  check(powerName(CARDS['sv3-125'].power) === 'れんごくしはい', 'Japanese Charizard Ability');
  check(actions.some((a) => a.kind === 'attack' && label(a).includes('バーニングダーク')), 'Japanese attack action');
  check(actions.some((a) => a.kind === 'attack' && label(a).endsWith('エヴォリューション')), 'Japanese TM attack');
  assert.deepEqual(game.legalActions(me), englishActions, 'Japanese preserves legal actions');
  assert.deepEqual(buildState(game, me), englishState, 'Japanese preserves the AI state');
  assert.equal(JSON.stringify(game.serialize()), snapshot, 'Japanese preserves the save');
  checks += 3;
  setLang('es');
  check(cardName(me.hand[0]) === 'Investigación de Profesores (Profesora Albora)', 'Spanish Trainer printing title');
  check(cardName(me.active.energy[0]) === 'Energía Fuego Básica', 'Spanish modern Basic Energy title');
  check(powerName(CARDS['sv3-125'].power) === 'Reino Infernal', 'Spanish Charizard Ability title');
  check(actions.some((a) => a.kind === 'attack' && label(a).includes('Oscuridad Ardiente')), 'Spanish attack action');
  check(actions.some((a) => a.kind === 'attack' && label(a).endsWith('Evolución')), 'Spanish TM attack uses the Tool printing');
  assert.deepEqual(game.legalActions(me), englishActions, 'Spanish preserves legal actions');
  assert.deepEqual(buildState(game, me), englishState, 'Spanish preserves the AI state');
  assert.equal(JSON.stringify(game.serialize()), snapshot, 'Spanish preserves the save');
  checks += 3;
  setLang('tr');
  check(cardName(me.hand[0]) === 'Profesörün Araştırması (Profesör Sada)', 'Turkish Trainer printing title');
  check(powerName(CARDS['sv3-125'].power) === 'Cehennem Hükmü', 'Turkish Charizard Ability title');
  check(actions.some((a) => a.kind === 'attack' && label(a).includes('Yanan Karanlık')), 'Turkish attack action');
  check(actions.some((a) => a.kind === 'attack' && label(a).endsWith('Evrim')), 'Turkish TM attack uses the Tool printing');
  assert.deepEqual(game.legalActions(me), englishActions, 'Turkish preserves legal actions');
  assert.deepEqual(buildState(game, me), englishState, 'Turkish preserves the AI state');
  assert.equal(JSON.stringify(game.serialize()), snapshot, 'Turkish preserves the save');
  checks += 3;

  // Capture the actual model request with a stub so no live service is needed.
  const fetch = globalThis.fetch;
  const config = { ...aiConfig };
  const requests = [];
  try {
    Object.assign(aiConfig, { engine: 'model', endpoint: 'https://example.invalid/decide' });
    globalThis.fetch = async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ answers: { action: {} } }) };
    };
    await rankActions(game, me, actions);
    setLang('en');
    await rankActions(game, me, englishActions);
    assert.deepEqual(requests[0], requests[1], 'decision model receives the same English request');
    check(requests[0].questions.action.criteria[burn.key].includes('Burning Darkness'), 'model sees the printed move name');
  } finally {
    globalThis.fetch = fetch;
    Object.assign(aiConfig, config);
  }

  await game.attack(me, burn.index);
  check(opp.active.damage === 180, 'attack still uses the original damage rule');
  const saved = JSON.parse(JSON.stringify({ game: game.serialize(), log: events }));
  const restored = Game.restore(saved.game, { controllers: [], hooks: {} });
  assert.deepEqual(JSON.parse(JSON.stringify(restored.serialize())), saved.game, 'saved game round trip');
  const attackLog = saved.log.find(({ key }) => key === 'log.attack');
  check(t(attackLog.key, attackLog.params).includes('Charizard ex used Burning Darkness'), 'saved event renders in English');
  setLang('zh-Hans');
  check(resolve(arenaAttack) === '燃烧黑暗', 'arena hook renders in Chinese');
  check(t(attackLog.key, attackLog.params).includes('喷火龙ex 使用 燃烧黑暗'), 'saved event renders in Chinese');
  check(t('log.attack', { P: { $pl: 0 }, m: 'Charizard ex', atk: 'Burning Darkness' }).includes('Burning Darkness'), 'legacy log without references remains readable');
  check(resolve(C(restored.players[0].active)) === '喷火龙ex', 'restored Pokémon resolves by original ID');
  const legacy = structuredClone(saved.game);
  delete legacy.players[0].until.lastAtk.atk.sourceCardId;
  const legacyGame = Game.restore(legacy, { controllers: [], hooks: {} });
  check(legacyGame.players[0].until.lastAtk.atk.name === 'Burning Darkness', 'legacy saved attack restores without printing metadata');
  check(attackName(legacyGame.attacksOf(legacyGame.players[0].active)[0]) === '燃烧黑暗', 'restored card gets printing metadata from the catalog');
  setLang('zh-Hant');
  check(t(attackLog.key, attackLog.params).includes('噴火龍ex 使用 燃燒黑暗'), 'saved event renders in Traditional Chinese');
  check(resolve(C(legacyGame.players[0].active)) === '噴火龍ex', 'legacy save renders Traditional Chinese card names');
  setLang('ja');
  const japaneseLog = t(attackLog.key, attackLog.params);
  check(japaneseLog.includes('リザードンex') && japaneseLog.includes('バーニングダーク'), 'saved event renders in Japanese');
  setLang('es');
  check(t(attackLog.key, attackLog.params).includes('Charizard ex usa Oscuridad Ardiente'), 'saved event renders in Spanish');
  check(attackName(legacyGame.attacksOf(legacyGame.players[0].active)[0]) === 'Oscuridad Ardiente', 'legacy save renders the Spanish attack name');
  setLang('tr');
  check(t(attackLog.key, attackLog.params).includes('Yanan Karanlık'), 'saved event renders in Turkish');
  check(attackName(legacyGame.attacksOf(legacyGame.players[0].active)[0]) === 'Yanan Karanlık', 'legacy save renders the Turkish attack name');
}

// Check each data key against the shipped decks, including lazy-loaded modern decks.
await Promise.all(Object.keys(DECKS).map(loadDeck));
const contentCards = Object.values(CARDS);
setLang('zh-Hans');
check(deckName('thunderstorm', DECKS.thunderstorm.name) === '雷暴雨', 'Thunderstorm and Tempest are different products');
check(cardName(CARDS['base5-2']) === '邪恶阿柏怪', 'bilingual Team Rocket card entry');
check(t('prompt.search.title') === '电脑通信', 'classic Trainer prompt uses the card name');
check(attackName(CARDS['gym1-40'].attacks.find((a) => a.name === 'Rock Toss')) === '扔岩石', 'Graveler attack matches its printing');
check(attackName(CARDS['gym2-68'].attacks.find((a) => a.name === 'Rock Toss')) === '扔石头', 'Geodude retains its distinct attack name');
check(powerName(CARDS['me2-41'].power) === '钻石膜', 'Traditional printing supplies a Simplified display name');
const nameFields = {
  card: new Set(contentCards.map((card) => card.name)),
  attack: new Set(contentCards.flatMap((card) => (card.attacks ?? []).map((attack) => attack.name))),
  power: new Set(contentCards.flatMap((card) => card.power ? [card.power.name] : [])),
  deck: new Set(Object.keys(DECKS)),
};
const faceLayouts = JSON.parse(await readFile(new URL('../scripts/card-localization/data/layouts.json', import.meta.url), 'utf8'));
for (const layout of Object.values(faceLayouts)) {
  for (const { kind, name } of Object.values(layout.nameRefs ?? {})) nameFields[kind]?.add(name);
}
for (const id of cohortIds('catalog')) {
  const simplified = resolveCardFace(id, 'zh-Hans');
  const traditional = resolveCardFace(id, 'zh-Hant');
  check(simplified.actualLocale === 'zh-Hans', `${id}: complete Simplified Chinese card face`);
  check(traditional.actualLocale === 'zh-Hant' && traditional.shared === simplified.shared,
    `${id}: complete Traditional Chinese card face with the same shared Energy rules`);
  for (const locale of ['ja', 'es', 'tr']) {
    const face = resolveCardFace(id, locale);
    check(face.actualLocale === locale && face.shared === simplified.shared,
      `${id}: complete ${locale} card face with the same shared Energy rules`);
    if (face.recipe) check(Boolean(materializeFace(face).overlay), `${id}: renderable ${locale} card face`);
  }
}
const traditionalSample = cohortIds('zh-Hant-100');
check(traditionalSample.length === 100, '100 Traditional Chinese card face samples');
for (const id of traditionalSample) {
  const face = resolveCardFace(id, 'zh-Hant');
  check(Boolean(face.recipe && materializeFace(face).overlay), `${id}: renderable Traditional Chinese card face`);
}
for (const locale of ['zh-Hans', 'zh-Hant']) {
  const resolved = resolveCardFace('sm12-156', locale);
  const face = materializeFace(resolved);
  check(!face.overlay.includes('[[paragraph.') && face.overlay.split('{{inline_water}}').length === 2 &&
    face.cutouts.inline_water.shape === 'outlined',
  `${locale}: TAG TEAM attack copy flows around the original inline Water symbol`);
  const heading = resolved.recipe.headings.alteredCreation;
  const longer = materializeFace({ ...resolved, recipe: {
    ...resolved.recipe, headings: { alteredCreation: { ...heading, text: heading.text + '甲乙' } },
  } });
  const logo = face.cutouts.gxAttackMark;
  check(face.overlay.includes('</text>{{gxAttackMark}}') && logo.baseline === heading.position[1] &&
    logo.position[0] < logo.box[0] && longer.cutouts.gxAttackMark.position[0] > logo.position[0],
  `${locale}: the original GX mark follows the measured attack heading on its baseline`);
}
const meowthFace = materializeFace(resolveCardFace('me3-62', 'zh-Hans'));
const [meowthAbility] = meowthFace.pokemon.content.moves;
const abilityPosition = meowthFace.overlay.match(new RegExp(`<text x="([\\d.]+)"[^>]*>${meowthAbility.heading}</text>`));
check(Number(abilityPosition?.[1]) >= 80 && meowthFace.erase.some(([x, y]) => x > 77 && y > 183 && y < 187),
  'Meowth ex preserves the full ability tab and places the heading to its right');
for (const id of ['base1-98', 'sm1-167', 'sm2-168']) {
  const face = resolveCardFace(id, 'zh-Hans');
  check(face.shared && !face.recipe && face.input === resolveCardFace(id, 'en').input, `${id}: shared basic Energy image`);
}
check(Boolean(resolveCardFace('base1-96', 'zh-Hans').recipe), 'Special Energy retains localized rules');
const rattataFace = resolveCardFace('gym1-82', 'zh-Hans').recipe.pokemon;
check(rattataFace.geometry.parts[1].name[1] > 250 &&
  rattataFace.content.moves[0].body.includes('「' + rattataFace.content.moves[1].heading + '」'),
'Rattata renders the second attack in its own row even when mentioned in the first attack');
for (const [id, category] of [['sm8-179', '支援者'], ['sm4-93', '竞技场'], ['swsh1-177', '物品']]) {
  const { scan, erase } = resolveCardFace(id, 'zh-Hans').recipe;
  check(scan.headerCopy.category === category && !scan.headerCopy.trainer && scan.color &&
    !erase.some(([x, y]) => x < 100 && y < 23), `${id}: preserve printed TRAINER and localize the category`);
}
const sealStone = resolveCardFace('swsh12-156', 'zh-Hans').recipe;
check(sealStone.scan.detailCopy.heading === '星耀炼金术' && sealStone.scan.detail.form &&
  sealStone.scan.detail.effect[1] > sealStone.scan.body[1] &&
  sealStone.erase.some(([, y, , , mode]) => y > 260 && mode === 'outlined'),
'Forest Seal Stone keeps the VSTAR permission and outlined ability text in their own regions');
for (const [id, label] of [['swsh5-88', '超极巨化'], ['swsh6-46', '极巨化'], ['swsh12-58', '极巨化']]) {
  check(resolveCardFace(id, 'zh-Hans').recipe?.pokemon?.content.special === label, `${id}: localized VMAX form label`);
}
const moonAltar = resolveCardFace('sm2-117', 'zh-Hans').recipe.scan.effect;
check(moonAltar.includes('双方') && moonAltar.includes('{icon.colorless}{icon.colorless}'), 'Moon Altar reduces both sides’ retreat cost by two');
const futureTool = resolveCardFace('sv4-164', 'zh-Hans').recipe;
check(futureTool.scan.outlineText && futureTool.repeatRows?.period > 0, 'Future tool retains outlined text over the repeating grid');
check(printedCandidates('zh-Hans', 'swsh5-141', 734).length > 1, 'multiple reviewed localized printings for one English ID');
check(printedCandidates('zh-Hans', 'swsh5-88', 2400).length === 0, 'exclude source scans smaller than requested');
check(printedCandidates('tr', 'swsh5-88', 600).length === 0, 'exclude images in a different locale');
const runtimePrinted = JSON.parse(cardImageAsset('zh-Hans', 'printed')).cards;
const runtimeRecipes = JSON.parse(cardImageAsset('zh-Hans', 'recipes')).cards;
const taiwanPrinted = JSON.parse(cardImageAsset('zh-Hant', 'printed')).cards;
check(taiwanPrinted['me3-62']?.[0].url.startsWith('https://asia.pokemon-card.com/tw/card-img/') &&
  taiwanPrinted['sm1-113']?.some((image) => image.url.startsWith('https://media.52poke.com/')) &&
  taiwanPrinted['swsh1-179']?.some((image) => image.site === 'TCGdex' && image.height === 825),
  'Traditional Chinese manifest includes reviewed official, community and TCGdex scans');
check(Boolean(runtimePrinted['sv6-141']?.[0].url) && Boolean(runtimeRecipes['sv6-141']),
  'a card may have both a configured download and a complete generation recipe');
check(!runtimePrinted['sm2-168'] && !runtimeRecipes['sm2-168'], 'shared Energy artwork has no localized work to do');
for (const locale of ['ja', 'es', 'tr']) {
  const recipes = JSON.parse(cardImageAsset(locale, 'recipes')).cards;
  check(Boolean(recipes['me3-62']) && !recipes['sm2-168'], `${locale}: publish generation recipes and omit shared scans`);
}
const coverage = JSON.parse(cardImageCoverageAsset());
const catalog = cohortIds('catalog');
const sharedImages = catalog.filter((id) => resolveCardFace(id, 'en').shared).length;
check(coverage.total === catalog.length && coverage.byLocale.en === coverage.total, 'English card image coverage includes the catalog');
for (const locale of ['ja', 'es', 'tr', 'zh-Hans', 'zh-Hant']) {
  const printed = cardImageAsset(locale, 'printed');
  const count = printed ? Object.keys(JSON.parse(printed).cards).length : 0;
  check(coverage.byLocale[locale] === count + sharedImages, `${locale}: count unique downloaded printings and shared Energy`);
  if (locale === 'ja' || locale === 'es') check(count > 0, `${locale}: publish reviewed original image links`);
}
check(!cardImageAsset('en', 'printed') && !cardImageAsset('en', 'recipes'), 'omit English localization assets');
check(await localizedCardImage({ id: 'sv6-141', source: 'unused' }, {
  locale: 'en', downloads: true, generation: true, signal: new AbortController().signal,
}) === undefined, 'English skips both card image paths even with both preferences enabled');
const deckPickerText = Object.keys(zhHans.STRINGS).filter((key) => /^(?:deck\.|deckgroup\.|format\.)/.test(key));
const untranslatedSeries = /\b(?:Base Set|Jungle|Fossil|Team Rocket|Gym Heroes|Gym Challenge|Mega Evolution|Scarlet & Violet|Sword & Shield|Sun & Moon|Vivid Voltage|Unbroken Bonds|Chaos Rising)\b/;
const untranslatedNames = /\b(?:Golem|Sandslash|Seaking|Dewgong|Muk|Tentacruel|Exeggutor|Dratini|Weezing|Nidorino|Star Portal|Impidimp|Purrloin|Liepard|Scraggy|Scrafty|Skarmory|Carbink)\b/;
for (const [lang, locale, names] of [
  ['zh-Hans', zhHans, zhHansNames], ['zh-Hant', zhHant, zhHantNames],
]) {
  setLang(lang);
  for (const [kind, expected] of Object.entries(nameFields)) {
    for (const [key, value] of Object.entries(names[kind])) {
      check(expected.has(key), `${lang} ${kind}: unused name key ${key}`);
      check(typeof value === 'string' && /\p{Script=Han}/u.test(value), `${lang} ${kind}: expected translated name for ${key}`);
    }
  }
  for (const [id, translations] of Object.entries(names.attackPrinting)) {
    for (const [name, value] of Object.entries(translations)) {
      check(CARDS[id]?.attacks?.some((attack) => attack.name === name), `${lang}: unknown attack ${id} / ${name}`);
      check(/\p{Script=Han}/u.test(value), `${lang}: expected translated attack ${name}`);
    }
  }
  for (const [id, translations] of Object.entries(names.powerPrinting)) {
    for (const [name, value] of Object.entries(translations)) {
      check(CARDS[id]?.power?.name === name, `${lang}: unknown Ability ${id} / ${name}`);
      check(/\p{Script=Han}/u.test(value), `${lang}: expected translated Ability ${name}`);
    }
  }
  for (const [key, value] of Object.entries({ ...locale.STRINGS, ...locale.LANDING, RULES: locale.RULES })) {
    check(!value.includes('undefined'), `${lang}.${key}: unresolved name reference`);
  }
  for (const key of [...deckPickerText, 'ui.welcomeText']) {
    const text = t(key, { classic: 26, modern: 83 });
    check(!untranslatedSeries.test(text) && !untranslatedNames.test(text), `${lang}.${key}: untranslated deck picker text: ${text}`);
  }
  const modern = lang === 'zh-Hans'
    ? '「超级进化」「朱&紫」「剑&盾」「太阳&月亮」卡组，采用现代规则'
    : '「超級進化」「朱＆紫」「劍＆盾」「太陽＆月亮」牌組，採用現代規則';
  check(t('format.modern.sub') === modern, lang + ': modern format subtitle');
  for (const [id, deck] of Object.entries(DECKS)) {
    check(/\p{Script=Han}/u.test(deckName(id, deck.name)), lang + ': missing deck name ' + id);
  }
  for (const card of contentCards) {
    check(/\p{Script=Han}/u.test(cardName(card)), lang + ': missing card name ' + card.id);
    for (const attack of card.attacks ?? []) {
      check(/\p{Script=Han}/u.test(attackName(attack)), lang + ': missing attack ' + card.id + ' / ' + attack.name);
    }
    if (card.power) check(/\p{Script=Han}/u.test(powerName(card.power)), lang + ': missing Ability ' + card.id);
  }
  check(deckName('unknown', 'Unknown Deck') === 'Unknown Deck', lang + ': deck fallback');
  check(cardName({ name: 'Unknown Card' }) === 'Unknown Card', lang + ': card fallback');
  check(attackName({ name: 'Unknown Attack' }) === 'Unknown Attack', lang + ': attack fallback');
  check(powerName({ name: 'Unknown Ability' }) === 'Unknown Ability', lang + ': Ability fallback');
  for (const [deck, card] of [
    ['brock', "Brock's Golem"], ['misty', "Misty's Seaking"], ['gym-misty', "Misty's Tentacruel"],
    ['sv-marnie', "Marnie's Impidimp"], ['sv-steven', "Steven's Skarmory"],
  ]) {
    const printing = Object.keys(DECKS[deck].list).map((id) => CARDS[id]).find((c) => c.name === card);
    check(printing && t('deck.' + deck).includes(cardName(printing)), `${lang} ${deck}: description uses the actual card name`);
  }
}
setLang('zh-Hant');
check(deckName('brushfire', DECKS.brushfire.name) === '叢林之火', 'Traditional classic deck title');
check(powerName(CARDS['swsh10-40'].power) === '星星入口', 'Taiwan VSTAR Power title');
check(attackName(CARDS['gym1-40'].attacks.find((a) => a.name === 'Rock Toss')) === '扔岩石', 'Traditional Graveler move retains the printing name');
check(attackName(CARDS['gym2-68'].attacks.find((a) => a.name === 'Rock Toss')) === '扔石頭', 'Traditional Geodude move retains the printing name');

setLang('ja');
for (const [key, value] of Object.entries({ ...ja.STRINGS, RULES: ja.RULES })) {
  check(!value.includes('undefined'), `ja.${key}: unresolved display name`);
}
for (const [kind, expected] of Object.entries(nameFields)) {
  for (const key of Object.keys(jaNames[kind])) check(expected.has(key), `ja ${kind}: unused name key ${key}`);
}
for (const id of Object.keys(jaNames.cardPrinting)) check(Boolean(CARDS[id]), `ja: unknown printing ${id}`);
for (const [id, names] of Object.entries(jaNames.attackPrinting)) {
  for (const name of Object.keys(names)) {
    check(CARDS[id]?.attacks?.some((attack) => attack.name === name), `ja: unknown attack ${id} / ${name}`);
  }
}
const japanese = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
for (const [id, deck] of Object.entries(DECKS)) {
  check(japanese.test(deckName(id, deck.name)), `ja: missing deck name ${id}`);
}
for (const c of contentCards) {
  check(japanese.test(cardName(c)), `ja: missing card name ${c.id}`);
  for (const attack of c.attacks ?? []) {
    check(japanese.test(attackName(attack)), `ja: missing attack ${c.id} / ${attack.name}`);
  }
  if (c.power) check(japanese.test(powerName(c.power)), `ja: missing Ability ${c.id}`);
}
check(attackName(CARDS['gym1-40'].attacks.find((a) => a.name === 'Rock Toss')) === 'いわなげ', 'Japanese Graveler move uses the original printing');
check(attackName(CARDS['gym2-68'].attacks.find((a) => a.name === 'Rock Toss')) === 'いしなげ', 'Japanese Geodude move uses the original printing');
check(attackName(CARDS['base1-54'].attacks.find((a) => a.name === 'Stiffen')) === 'かたまる', 'classic move uses the version with a coin flip');
const energySupport = CARDS['gym2-95'].attacks.find((a) => a.name === 'Energy Support');
check(attackName(energySupport) === 'エナジーサポート' && energySupport.text.includes('put it into your hand'),
  'Japanese Energy Support title preserves the English card effect');
check(attackName(CARDS['sm6-2'].attacks.find((a) => a.name === 'Tropical Shake')) === 'トロピカルシェイク', 'damage ceiling matches the Japanese maximum of five types');
check(t('format.modern.sub').includes('スカーレット＆バイオレット'), 'Japanese modern series subtitle');
check(t('deck.gym-misty').includes('カスミのドククラゲ'), 'Japanese deck description uses the trainer-owned card name');
check(t('deck.swl-palkia').includes('スターポータル'), 'Japanese deck description uses the VSTAR Power name');
check(deckName('sv-steven', DECKS['sv-steven'].name) === 'ダイゴ', 'Japanese trainer deck name');
check(deckName('brushfire', DECKS.brushfire.name) === 'ブラッシュファイア', 'Japanese collector spelling for Brushfire');
check(ja.RULES.includes(jaNames.deck.brushfire), 'Japanese rulebook uses the localized deck title');
check(deckName('sm-mach-strike', DECKS['sm-mach-strike'].name) === 'ガブリアスデッキ（Mach Strike）',
  'Japanese community alias is shown alongside the English product title');
check(deckName('sm-torrential-cannon', DECKS['sm-torrential-cannon'].name) === 'カメックスデッキ（Torrential Cannon）',
  'Japanese community alias for Torrential Cannon');
check(deckName('sm-bright-tide', DECKS['sm-bright-tide'].name) === '輝く潮流（Bright Tide）',
  'Japanese deck translation retains the English product title');
check(deckName('unknown-deck', 'Unknown Deck') === 'Unknown Deck', 'Japanese deck fallback');
check(cardName({name: 'Unknown Card'}) === 'Unknown Card', 'Japanese card fallback');
check(powerName({name: 'Unknown Ability'}) === 'Unknown Ability', 'Japanese Ability fallback');

setLang('es');
for (const [key, value] of Object.entries({ ...es.STRINGS, RULES: es.RULES })) {
  check(!value.includes('undefined'), `es.${key}: unresolved display name`);
}
for (const [kind, expected] of Object.entries(nameFields)) {
  for (const key of Object.keys(esNames[kind])) check(expected.has(key), `es ${kind}: unused name key ${key}`);
}
for (const id of Object.keys(esNames.cardPrinting)) check(Boolean(CARDS[id]), `es: unknown printing ${id}`);
for (const [id, names] of Object.entries(esNames.attackPrinting)) {
  for (const name of Object.keys(names)) {
    check(CARDS[id]?.attacks?.some((attack) => attack.name === name), `es: unknown attack ${id} / ${name}`);
  }
}
check(attackName(CARDS['gym1-40'].attacks.find((a) => a.name === 'Rock Toss')) === 'Lanzamiento de Roca', 'Spanish Graveler attack uses its own printing');
check(attackName(CARDS['gym2-68'].attacks.find((a) => a.name === 'Rock Toss')) === 'Embestida Roca', 'Spanish Geodude attack retains its distinct name');
check(cardName(CARDS['base1-90']) === 'Super Poción' && cardName(CARDS['base4-117']) === 'La Superpoción', 'Spanish Trainer names can differ between printings');
check(deckName('sm-torrential-cannon', DECKS['sm-torrential-cannon'].name) === 'Cañón Torrencial', 'Spanish Sun & Moon deck name');
check(deckName('sv-marnie', DECKS['sv-marnie'].name) === 'Roxy', 'Spanish Trainer deck name');
check(t('deck.sv-marnie').includes(cardName(CARDS['sv10-136'])), 'Spanish deck summary uses the card name');
check(t('deck.swl-palkia').includes(powerName(CARDS['swsh10-40'].power)), 'Spanish deck summary uses the VSTAR Power name');
check(t('deck.gym-brock').includes(cardName(CARDS['gym1-115'])), 'Spanish deck summary uses the Gym name');
check(t('ui.welcomeText').includes(esSets.base) && es.RULES.includes(esNames.deck.brushfire), 'Spanish welcome and rulebook use the localized titles');
check(deckName('thunderstorm', DECKS.thunderstorm.name) === 'Tormenta Eléctrica (Thunderstorm)', 'Spanish project deck title includes the original');
check(deckName('sm-let-s-play-pikachu', DECKS['sm-let-s-play-pikachu'].name) === "¡A jugar, Pikachu! (Let's Play, Pikachu!)", 'Spanish Pikachu deck translation');
check(deckName('sm-let-s-play-eevee', DECKS['sm-let-s-play-eevee'].name) === "¡A jugar, Eevee! (Let's Play, Eevee!)", 'Spanish Eevee deck translation');
check(cardName(CARDS['base5-36']) === 'Gloom Oscuro', 'Spanish project translation of Dark Gloom');
check(cardName(CARDS['gym1-81']) === 'Pikachu del Teniente Surge', 'Spanish project translation uses the Trainer name');
check(t('deck.devastation').includes(cardName(CARDS['base5-36'])), 'Spanish deck summary uses the project translation');
check(t('deck.lt-surge').includes(cardName(CARDS['gym1-81'])), 'Spanish Gym deck summary uses the Trainer-owned card name');
check(attackName(CARDS['gym1-87'].attacks.find((a) => a.name === 'Tail Rap')) === 'Golpe de Cola', 'Spanish project translation of Tail Rap');
check(powerName(CARDS['gym1-2'].power) === 'Protección de la Banca', 'Spanish project translation of Bench Guard');
check(t('prompt.q.benchGuard', { m: 'Pikachu' }).includes(powerName(CARDS['gym1-2'].power)), 'Spanish Bench Guard prompt uses the project translation');
check(t('deckgroup.gym1').includes('Héroes de Gimnasio') && es.RULES.includes('Edición Básica 2'), 'Spanish classic expansion translations');
check(attackName({name: 'Unknown Attack'}) === 'Unknown Attack', 'Spanish fallback for a missing catalog entry');

setLang('tr');
validHTML(tr.RULES, 'tr rules');
assert.deepEqual(params(tr.RULES), params(en.RULES), 'tr: rules parameters');
for (const [key, value] of Object.entries({ ...tr.STRINGS, RULES: tr.RULES })) {
  check(!value.includes('undefined'), `tr.${key}: unresolved display name`);
}
for (const [kind, expected] of Object.entries(nameFields)) {
  for (const key of Object.keys(trNames[kind])) check(expected.has(key), `tr ${kind}: unused name key ${key}`);
}
for (const c of contentCards) {
  for (const move of c.attacks ?? []) {
    check(attackName(move) !== move.name, `tr: missing attack title ${c.id} / ${move.name}`);
  }
  if (c.power) check(Object.hasOwn(trNames.power, c.power.name), `tr: missing Ability title ${c.id}`);
}
for (const [id, deck] of Object.entries(DECKS)) {
  const original = ` (${deck.name})`;
  const title = deckName(id, deck.name);
  check(title.endsWith(original) && title.length > original.length, `tr: localized deck title with original ${id}`);
  check(Boolean(tr.STRINGS['deck.' + id]), `tr: missing deck description ${id}`);
}
check(cardName(CARDS['gym1-69']) === 'Brock’a Ait Onix', 'Turkish Trainer-owned Pokémon title');
check(t('deck.gym-brock').includes(cardName(CARDS['gym1-69'])), 'Turkish deck summary uses the Trainer-owned card name');
check(t('deck.swl-palkia').includes(powerName(CARDS['swsh10-40'].power)), 'Turkish deck summary uses the VSTAR Power name');
check(cardName(CARDS['base1-94']) === 'İksir', 'Turkish uses the published item name');
check(attackName(CARDS['base1-24'].attacks.find((a) => a.name === 'Flamethrower')) === 'Alev Püskürtücü', 'Turkish uses the published move name');
check(attackName(CARDS['gym1-40'].attacks.find((a) => a.name === 'Rock Toss')) === 'Kaya Fırlatma', 'Turkish Graveler attack uses the appropriate printing');
check(attackName(CARDS['gym2-68'].attacks.find((a) => a.name === 'Rock Toss')) === 'Taş Fırlatma', 'Turkish Geodude attack retains its distinct name');
check(t('ui.welcomeText').includes(trSets.base) && t('format.modern.sub').includes(trSets.swsh), 'Turkish interface uses series titles');
check(termName("Steven's") === 'Steven’a Ait' && termName('Rapid Strike') === 'Hızlı Vuruş', 'Turkish effect preview uses localized name filters');

// Official area definitions, checked 2026-11-10:
// https://www.pokemon.cn/tcg-rules-howtoplay?pageName=basic_rules03/
// https://asia.pokemon-card.com/tw/rules/howtoplay/basic_rules03/
// A constructed deck is 卡组 / 牌組; the in-play draw pile is 牌库 / 牌庫.
check(zhHans.STRINGS['ui.deck'] === '牌库' && zhHant.STRINGS['ui.deck'] === '牌庫', 'in-play deck label');
const pileKeys = [
  'why.deckEmpty', 'tour.piles.t', 'tour.piles.b', 'tour.prizes.b', 'tour.opp.b',
  'rule.draw', 'rule.prizes', 'tr.bill.what', 'tr.computerSearch.what',
  'tr.iono.what', 'tr.looker.what', 'tr.ordinaryRod.what', 'tr.ordinaryRod.tip',
  'tr.mistysWrath.tip', 'tr.energyRecycler.tip', 'prompt.q.searchAny',
  'pw.quickSearch', 'fx.searchAny', 'coin.o.search', 'act.s.artazon',
];
const constructedKeys = [
  'ui.pickDeck', 'ui.pickFirst', 'ui.oppRandom', 'ui.loadingDeck', 'ui.welcomeText',
  'deckgroup.trainer', 'log.decks', 'tr.primeCatcher.tip', 'tr.fervor.tip',
  'tr.trFactory.tip', 'tr.towerOfDarkness.tip',
];
for (const [lang, dict, deck, library] of [
  ['zh-Hans', zhHans, '卡组', '牌库'], ['zh-Hant', zhHant, '牌組', '牌庫'],
]) {
  for (const key of pileKeys) {
    check(dict.STRINGS[key].includes(library) && !dict.STRINGS[key].includes(deck), `${lang}.${key}: in-play draw pile`);
  }
  for (const key of constructedKeys) {
    check(dict.STRINGS[key].includes(deck) && !dict.STRINGS[key].includes(library), `${lang}.${key}: constructed deck`);
  }
  check(dict.RULES.includes(`<dt>${deck}</dt>`) && dict.RULES.includes(`<dt>${library}</dt>`), `${lang}: guide explains both deck meanings`);
}
check(zhHans.STRINGS['note.resistance'] === '抗性 −30' && zhHant.STRINGS['note.resistance'] === '抵抗力 −30', 'regional Resistance terminology');

for (const [input, expected] of Object.entries({
  'zh': 'zh-Hans', 'zh-CN': 'zh-Hans', 'zh-SG': 'zh-Hans', 'zh-Hans': 'zh-Hans',
  'zh-TW': 'zh-Hant', 'zh-HK': 'zh-Hant', 'zh-MO': 'zh-Hant', 'zh-Hant': 'zh-Hant',
  'ZH_hant_TW': 'zh-Hant', 'zh-Hans-HK': 'zh-Hans', 'zh-Hant-CN': 'zh-Hant',
  'en-US': 'en', 'es-MX': 'es', 'ja-JP': 'ja', 'tr-TR': 'tr',
})) check(normalizeLanguage(input) === expected, `normalize ${input}`);
for (const invalid of [undefined, null, 42, '', 'fr', 'english', 'xx-zh']) {
  check(normalizeLanguage(invalid) === null, `reject invalid locale ${invalid}`);
}
check(chooseLanguage('zh-Hant', ['zh-CN']) === 'zh-Hant', 'saved choice wins');
check(chooseLanguage('ja', ['zh-CN']) === 'ja', 'saved original language wins');
check(chooseLanguage('invalid', ['fr-FR', 'zh-TW', 'en']) === 'zh-Hant', 'scan preferred languages');
check(chooseLanguage(null, []) === 'en', 'English fallback');

const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
try {
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() { throw new Error('blocked'); }});
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {languages: ['fr', 'zh-HK'], language: 'en-US'}});
  check(initialLanguage() === 'zh-Hant', 'system language still works with blocked storage');
  check(setLang('zh-CN') && getLang() === 'zh-Hans', 'selection works with blocked storage');
} finally {
  if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else delete globalThis.localStorage;
  if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else delete globalThis.navigator;
}

const landingSource = await readFile(new URL('../web/landing.js', import.meta.url), 'utf8');
const landing = vm.runInNewContext(landingSource.slice(landingSource.indexOf('const STRINGS ='), landingSource.indexOf('const store =')) + '\nSTRINGS',
  {esSets, jaNames, jaSets, trNames, trSets, zhHans: zhHans.LANDING, zhHant: zhHant.LANDING});
check(landing.es['decks.classic.text'].includes(esSets.jungle) && landing.es['decks.modern.text'].includes(esSets.celebration),
  'Spanish landing uses localized series names');
check(landing.tr['decks.classic.text'].includes(trSets.fossil) && landing.tr['decks.modern.text'].includes(trSets.sv),
  'Turkish landing uses localized series names');
for (const lang of LANGS) {
  assert.deepEqual(Object.keys(landing[lang]).sort(), Object.keys(landing.en).sort(), `${lang}: landing keys`);
  checks++;
  for (const [key, value] of Object.entries(landing[lang])) {
    assert.deepEqual(params(value), params(landing.en[key]), `${lang}.${key}: landing parameters`);
    check(!value.includes('undefined'), `${lang}.${key}: unresolved landing name`);
    checks++;
  }
}
for (const path of ['../public/index.html', '../web/index.html']) {
  const html = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const lang of LANGS) {
    check(html.split(`data-lang="${lang}"`).length - 1 === (path.includes('public') ? 2 : 1), `${path}: ${lang} buttons`);
  }
}
setLang('en');
console.log(`i18n checks: ${checks} passed; 6 languages, 2,122 game keys and 60 landing keys per language`);
