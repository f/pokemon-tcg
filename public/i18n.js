// Translation lookup. The strings live in one file per language under i18n/.
// Templates use {param}; special params ($card, $pl, …) are resolved here in t().
// Card, attack, Ability and deck names stay as printed on the (English) card images in every language.

import * as en from './i18n/en.js';
import * as tr from './i18n/tr.js';
import * as ja from './i18n/ja.js';
import * as es from './i18n/es.js';
import * as zhHans from './i18n/zh-Hans.js';
import * as zhHant from './i18n/zh-Hant.js';
import { LANGS, initialLanguage, normalizeLanguage } from './locales.js';
export { LANGS };

const EN = en.STRINGS;
export const CARD_TEXT_TR = tr.CARD_TEXT;
export const RULES_HTML = { en: en.RULES, tr: tr.RULES, ja: ja.RULES, es: es.RULES, 'zh-Hans': zhHans.RULES, 'zh-Hant': zhHant.RULES };

const DICT = { en: EN, tr: tr.STRINGS, ja: ja.STRINGS, es: es.STRINGS, 'zh-Hans': zhHans.STRINGS, 'zh-Hant': zhHant.STRINGS };
// The saved choice, else the system language when we have it, else English.
let lang = initialLanguage();

export const getLang = () => lang;
export function setLang(l) {
  const supported = normalizeLanguage(l);
  if (!supported) return false;
  lang = supported;
  try { localStorage.setItem('lang', supported); } catch { /* storage unavailable */ }
  return true;
}

export function cardName(c) {
  if (c.kind === 'energy' && !c.special) return t('energy', { t: t('type.' + c.energyType) });
  return c.name;
}

function resolve(v) {
  if (v == null) return '';
  if (typeof v !== 'object') return v;
  if (v.$t) return t(v.$t.key, v.$t.params);
  if (v.$card) return cardName(v.$card);
  if ('$pl' in v) return t('pl.' + v.$pl);
  if (v.$st) return t('st.' + v.$st);
  if ('$coin' in v) return t(v.$coin ? 'coin.h' : 'coin.t');
  if (v.$type) return t('type.' + v.$type);
  if (v.$slot) return t('slot.' + v.$slot[0], { n: v.$slot[1] });
  if (v.$hidden) return t('hidden');
  if (Array.isArray(v)) return v.length ? ` (${v.map((n) => t('note.' + n.$note)).join(', ')})` : '';
  return String(v);
}

// Spanish Energy names agree with "Energía" (feminine), unlike the type names on their own ("tipo Psíquico").
const ENERGY_ES = [[/Energía Psíquico/g, 'Energía Psíquica'], [/Energía Oscuridad/g, 'Energía Oscura'], [/Energía Metal\b/g, 'Energía Metálica'], [/Energía Incoloro/g, 'Energía Incolora']];

export function t(key, params = {}) {
  const s = (DICT[lang]?.[key] ?? EN[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => resolve(params[k]));
  return lang === 'es' ? ENERGY_ES.reduce((x, [re, to]) => x.replace(re, to), s) : s;
}
