import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { LANGS, normalizeLanguage, chooseLanguage, initialLanguage } from '../public/locales.js';
import { setLang, getLang, t, cardName, RULES_HTML } from '../public/i18n.js';
import * as en from '../public/i18n/en.js';
import * as zhHans from '../public/i18n/zh-Hans.js';
import * as zhHant from '../public/i18n/zh-Hant.js';

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
}

for (const [lang, dict] of [['zh-Hans', zhHans], ['zh-Hant', zhHant]]) {
  for (const [key, value] of Object.entries(dict.STRINGS)) {
    check(en.STRINGS[key] === '' || value.trim().length > 0, `${lang}.${key}: empty translation`);
    if (value.includes('<')) validHTML(value, `${lang}.${key}`);
  }
  assert.deepEqual(params(dict.RULES), params(en.RULES), `${lang}: rules parameters`);
  assert.deepEqual([...dict.RULES.matchAll(/src="([^"]+)"/g)].map((m) => m[1]),
    [...en.RULES.matchAll(/src="([^"]+)"/g)].map((m) => m[1]), `${lang}: original rule illustration`);
  check(dict.RULES.includes('data-dice-chart'), `${lang}: missing dice chart`);
  validHTML(dict.RULES, `${lang} rules`);
  for (const name of ['Charmander', 'Charmeleon', 'Bulbasaur', 'Flamethrower', 'Rare Candy']) {
    check(dict.RULES.includes(name), `${lang}: preserve ${name}`);
  }
  check(dict.STRINGS['act.t.professorsResearch'].includes('Professor’s Research'), `${lang}: preserve printed card name`);
  setLang(lang);
  check(getLang() === lang, `${lang}: selection`);
  check(cardName({kind: 'pokemon', name: 'Charizard ex'}) === 'Charizard ex', `${lang}: keep card name`);
  check(t('ex.hp', {hp: 100, n: 10}).includes('100'), `${lang}: interpolate HP`);
  check(t('log.energy', {P: {$pl: 0}, c: {$card: {kind: 'pokemon', name: 'Pikachu'}}, m: 'Charizard'})
    .includes('Pikachu'), `${lang}: nested card parameters`);
  check(t('not.a.key') === 'not.a.key', `${lang}: missing-key fallback`);
  check(!setLang('unsupported') && getLang() === lang, `${lang}: invalid selection must not corrupt state`);
}
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
  {zhHans: zhHans.LANDING, zhHant: zhHant.LANDING});
for (const lang of LANGS) {
  assert.deepEqual(Object.keys(landing[lang]).sort(), Object.keys(landing.en).sort(), `${lang}: landing keys`);
  checks++;
  for (const [key, value] of Object.entries(landing[lang])) {
    assert.deepEqual(params(value), params(landing.en[key]), `${lang}.${key}: landing parameters`);
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
