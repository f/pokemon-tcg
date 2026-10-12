// The lobby language: localStorage 'lang', else navigator.language, else English. One store shared by the layout
// and every page, so the header switch re-renders everything.
import { useEffect, useState } from "preact/hooks";

import { isLang, langFromTag, translate, type Lang, type MsgKey } from "../shared/i18n";

function detect(): Lang {
  try {
    const saved = localStorage.getItem("lang");
    if (isLang(saved)) return saved;
  } catch {
    // Storage can be blocked; fall through to the browser language.
  }
  return typeof navigator === "undefined" ? "en" : langFromTag(navigator.language);
}

let current: Lang = typeof window === "undefined" ? "en" : detect();
const listeners = new Set<(lang: Lang) => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang) {
  if (!isLang(lang) || lang === current) return;
  current = lang;
  try {
    localStorage.setItem("lang", lang);
  } catch {
    // Not remembered; still switches for this page.
  }
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  for (const listener of listeners) listener(lang);
}

export type T = (key: MsgKey, vars?: Record<string, string>) => string;

/** The current language and its translate function; re-renders when the language changes. */
export function useLang(): { lang: Lang; t: T } {
  const [lang, setState] = useState<Lang>(current);
  useEffect(() => {
    const listener = (next: Lang) => setState(next);
    listeners.add(listener);
    if (current !== lang) setState(current);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return { lang, t: (key, vars) => translate(lang, key, vars) };
}
