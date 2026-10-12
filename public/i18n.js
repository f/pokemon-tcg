// Translation lookup. The strings live in one file per language: i18n/en.js, tr.js, ja.js and es.js.
// Templates use {param}; special params ($card, $pl, …) are resolved here in t().
// Card, attack, Ability and deck names stay as printed on the (English) card images in every language.

import * as en from './i18n/en.js';
import * as tr from './i18n/tr.js';
import * as ja from './i18n/ja.js';
import * as es from './i18n/es.js';

const EN = en.STRINGS;
export const LANGS = ['en', 'tr', 'ja', 'es'];
export const CARD_TEXT_TR = tr.CARD_TEXT;
export const RULES_HTML = { en: en.RULES, tr: tr.RULES, ja: ja.RULES, es: es.RULES };

const DICT = { en: EN, tr: tr.STRINGS, ja: ja.STRINGS, es: es.STRINGS };
// The saved choice, else the system language when we have it, else English.
let lang = 'en';
try {
  const saved = localStorage.getItem('lang');
  lang = LANGS.includes(saved) ? saved : LANGS.find((l) => navigator.language?.toLowerCase().startsWith(l)) || 'en';
} catch { /* storage unavailable */ }

export const getLang = () => lang;
export function setLang(l) {
  lang = l;
  try { localStorage.setItem('lang', l); } catch { /* storage unavailable */ }
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
  if (v.$secret) return v.$secret.vis === 0 ? resolve(v.$secret.v) : t('hidden'); // only seat 0 (this screen's player) sees it
  if (v.$hidden) return t('hidden');
  if (Array.isArray(v)) return v.length ? ` (${v.map((n) => t('note.' + n.$note)).join(', ')})` : '';
  return String(v);
}

// Spanish Energy names agree with "Energía" (feminine), unlike the type names on their own ("tipo Psíquico").
const ENERGY_ES = [[/Energía Psíquico/g, 'Energía Psíquica'], [/Energía Oscuridad/g, 'Energía Oscura'], [/Energía Metal\b/g, 'Energía Metálica'], [/Energía Incoloro/g, 'Energía Incolora']];

// In a two-player game the opponent is a person: their nickname replaces "Gary" everywhere. Nicknames are letters,
// digits, spaces and . _ - only (the lobby enforces it too), so they are safe in text and markup.
let oppName = '';
const GARY = { en: /Gary/g, tr: /Gary/g, es: /Gary/g, ja: /ゲイリー/g };
export function setOpponentName(name) { oppName = typeof name === 'string' ? name.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 24) : ''; }

export function t(key, params = {}) {
  let s = (DICT[lang][key] ?? EN[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => resolve(params[k]));
  if (oppName) s = s.replace(GARY[lang] || GARY.en, oppName);
  return lang === 'es' ? ENERGY_ES.reduce((x, [re, to]) => x.replace(re, to), s) : s;
}
