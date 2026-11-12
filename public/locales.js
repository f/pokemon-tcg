// Shared locale selection for the game and landing page. No browser globals at import time.
export const LANGS = ['en', 'tr', 'ja', 'es', 'zh-Hans', 'zh-Hant'];

export function normalizeLanguage(value) {
  if (typeof value !== 'string') return null;
  const parts = value.trim().replaceAll('_', '-').toLowerCase().split('-');
  const [base] = parts;
  if (['en', 'tr', 'ja', 'es'].includes(base)) return base;
  if (base !== 'zh') return null;
  // An explicit script takes precedence over region: zh-Hans-HK is Simplified.
  if (parts.includes('hans')) return 'zh-Hans';
  if (parts.includes('hant')) return 'zh-Hant';
  return parts.some((part) => ['tw', 'hk', 'mo'].includes(part)) ? 'zh-Hant' : 'zh-Hans';
}

export function chooseLanguage(saved, preferred = []) {
  const explicit = normalizeLanguage(saved);
  if (explicit) return explicit;
  for (const language of preferred) {
    const supported = normalizeLanguage(language);
    if (supported) return supported;
  }
  return 'en';
}

export function initialLanguage() {
  let saved;
  try { saved = globalThis.localStorage?.getItem('lang'); } catch { /* storage unavailable */ }
  const browser = globalThis.navigator;
  return chooseLanguage(saved, browser?.languages?.length ? browser.languages : [browser?.language]);
}
