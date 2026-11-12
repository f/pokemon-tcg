import { names as es } from './es.js';
import { names as ja } from './ja.js';
import { names as tr } from './tr.js';
import { names as zhHans } from './zh-Hans.js';
import { names as zhHant } from './zh-Hant.js';

const dictionaries = { es, ja, tr, 'zh-Hans': zhHans, 'zh-Hant': zhHant };
const lookup = (map, key) => map && Object.hasOwn(map, key) ? map[key] : undefined;

export function contentName(lang, kind, { id, sourceCardId, name }, fallback = name ?? '') {
  const dict = lookup(dictionaries, lang);
  const byPrinting = lookup(dict?.[kind + 'Printing'], sourceCardId ?? id);
  const exact = typeof byPrinting === 'string' ? byPrinting : lookup(byPrinting, name);
  return exact ?? lookup(dict?.[kind], kind === 'deck' || kind === 'person' ? id : name) ?? fallback;
}
