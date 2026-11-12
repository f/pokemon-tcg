import { escapeXml } from './svg.js';

let context;
const probes = new Map();
function browserMetrics(font, weight) {
  const key = font + ':' + weight;
  if (!probes.has(key)) {
    context ??= document.createElement('canvas').getContext('2d');
    const canvasFont = `${weight} 40px ${font}`;
    const advances = new Map();
    probes.set(key, {
      get(char) {
        if (!advances.has(char)) {
          context.font = canvasFont;
          advances.set(char, context.measureText(char).width / 40);
        }
        return advances.get(char);
      },
    });
  }
  return probes.get(key);
}

let metrics = browserMetrics;
const symbols = {};
export function configureLayout({ fontMetrics, energySymbols }) {
  if (fontMetrics) metrics = fontMetrics;
  if (energySymbols) Object.assign(symbols, energySymbols);
}

const punctuation = new Set('，。；：、）》」』】〗！？％,.!?:;)]'.split(''));
const noEnd = new Set('（《「『【〖(['.split(''));
function widthOf(text, size, advances) {
  return [...text].reduce((sum, char) => {
    const width = advances.get(char) ?? (/\s/u.test(char) ? 0.28 : /[\u2e80-\uffff]/u.test(char) ? advances.get('中') ?? 1 : 0.64);
    return sum + width * size;
  }, 0);
}

export const iconFiles = {
  fire: 'fire', lightning: 'electric', dark: 'dark', water: 'water', fighting: 'fighting',
  psychic: 'psychic', grass: 'grass', metal: 'steel', dragon: 'dragon',
};
symbols.colorless = '<path d="m6 1 1.25 3.1 3.35.3-2.55 2.2.77 3.35L6 8.15 3.18 9.95l.77-3.35L1.4 4.4l3.35-.3Z"/>';
symbols.fairy = '<path d="M6 1.5 9.9 9.8 6 7.4 2.1 9.8Z"/><path d="M6 4.4 6.8 6.1 6 5.6 5.2 6.1Z" fill="#edb6d3"/>';
const colors = {
  colorless: '#dadbdc', fire: '#f29b6e', lightning: '#f5cf67', dark: '#b5c3c6', water: '#95d5ed',
  fighting: '#d99f77', psychic: '#dbb7e7', grass: '#acd18b', metal: '#bdc4ca', dragon: '#d8c679', fairy: '#edb6d3',
};

export function icon(type, x, baseline, size) {
  if (!Object.hasOwn(symbols, type)) throw new Error('Unknown card face icon ' + type);
  const scale = size / 12;
  return `<g transform="translate(${x} ${baseline-size*0.83}) scale(${scale})"><circle cx="6" cy="6" r="5.8" fill="${colors[type]}"/>${symbols[type]}</g>`;
}

export function faceText(text, x, y, {
  size, weight = 500, fill = '#19191a', skew = false, anchor = 'start', outline, outlineWidth = size * 0.19,
}) {
  const angle = skew === true ? -11 : skew;
  const transform = angle ? ` transform="translate(${x} ${y}) skewX(${angle})"` : '';
  const stroke = outline ? ` stroke="${outline}" stroke-width="${outlineWidth}" stroke-linejoin="round" paint-order="stroke fill"` : '';
  return `<text x="${skew ? 0 : x}" y="${skew ? 0 : y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${transform}${stroke}>${escapeXml(text)}</text>`;
}

function tokens(copy, size, advances) {
  const parts = /(?:\d+[只隻张張个個](?:基本|基[础礎]|备战|備戰)?|基本|基[础礎]|备战|備戰|战斗场|戰鬥場|非)?\{icon\.[a-z]+\}(?:[与與或和、]?\{icon\.[a-z]+\})*(?:能量卡?|宝可梦卡?|寶可夢卡?)?|LV\.\d+ #\d+|(?:(?:[这這该該那]|\d+)[只隻])?(?:战斗|戰鬥|备战|備戰|基[础礎])?(?:宝可梦|寶可夢)卡?|\d+(?:[个個][伤傷]害指示物|[点點][伤傷]害|[点點次只隻张張个個])|(?:基本)?能量卡?|[伤傷]害指示物|[\p{Script=Latin}0-9][\p{Script=Latin}\p{Mark}0-9.'’+&-]*|./gu;
  const symbolPattern = /\{icon\.([a-z]+)\}/gu;
  const word = (text) => ({ text, width: widthOf(text, size, advances) });
  return (copy.match(parts) ?? []).map(text => {
    if (!text.includes('{icon.')) return word(text);
    const fragments = text.split(symbolPattern).flatMap((part, index) => {
      if (!part) return [];
      return index % 2 ? [{ symbol: part, width: size * 1.58 }] : [word(part)];
    });
    return { text, fragments, width: fragments.reduce((sum, fragment) => sum + fragment.width, 0) };
  });
}

function wrap(units, width) {
  const lines = [];
  let line = [], advance = 0;
  const push = () => { lines.push(line); line = []; advance = 0; };
  for (const unit of units) {
    if (line.length && advance + unit.width > width && !punctuation.has(unit.text)) {
      const trailing = noEnd.has(line.at(-1).text) ? line.pop() : null;
      if (line.length) push();
      if (trailing) { line.push(trailing); advance += trailing.width; }
    }
    if (line.length || !/^\s$/u.test(unit.text)) { line.push(unit); advance += unit.width; }
  }
  if (line.length) push();
  return lines;
}

export function layoutParagraph(copy, box, font, {
  size, minSize, weight = 500, fill = '#19191a', outline, heading, headingFill = fill, headingSize, headingWeight = 760,
  alignTop = false, alignCenter = false, centerY, skew = false, inlineIcon = icon,
}) {
  const [x, top, width, height] = box;
  const advances = metrics(font, weight);
  const headingAdvances = heading && metrics(font, headingWeight);
  const headingLimit = heading && headingSize
    ? Math.min(headingSize, height / 1.34, (width - 3) / widthOf(heading, 1, headingAdvances))
    : undefined;
  const rowWidth = row => row.reduce((sum, unit) => sum + unit.width, 0);
  let rows, leading, firstSize, blockHeight;
  for (; size + 0.01 >= minSize; size -= 0.25) {
    const units = tokens(copy, size, advances);
    const titleSize = headingLimit ?? size;
    if (heading) {
      units.unshift({ text: heading, weight: headingWeight, size: titleSize, width: widthOf(heading, titleSize, headingAdvances) });
      units.splice(1, 0, { text: ' ', width: size * 0.38 });
    }
    rows = wrap(units, width - 3);
    leading = size * 1.34;
    firstSize = Math.max(size, titleSize);
    blockHeight = firstSize * 1.34 + (rows.length - 1) * leading;
    if (blockHeight <= height && rows.every(row => rowWidth(row) <= width)) break;
  }
  if (size + 0.01 < minSize) throw new Error('Card text overflows its reserved area');
  const center = centerY ?? top + height / 2;
  const start = alignTop ? top : Math.max(top, Math.min(top + height - blockHeight, center - blockHeight / 2));
  const y = start + firstSize;
  return rows.map((row, index) => {
    const baseline = y + index * leading;
    let pos = x + (alignCenter ? (width - rowWidth(row)) / 2 : 0);
    let text = '', textX = pos, svg = '';
    for (const unit of row.flatMap(unit => unit.fragments ?? [unit])) {
      if (unit.symbol || unit.weight) {
        if (text) svg += faceText(text, textX, baseline, { size, weight, fill, outline, skew });
        svg += unit.symbol ? inlineIcon(unit.symbol, pos + size * 0.48, baseline, size * 0.85) :
          faceText(unit.text, pos, baseline, { size: unit.size, weight: unit.weight, fill: headingFill, outline, skew });
        text = '';
        textX = pos + unit.width + (unit.weight ? size * 0.38 : 0);
      } else text += unit.text;
      pos += unit.width;
    }
    return svg + (text ? faceText(text, textX, baseline, { size, weight, fill, outline, skew }) : '');
  }).join('');
}

export function fitTitle(copy, x, y, width, font, size = 15.8, style = {}) {
  return fitTitleLayout(copy, x, y, width, font, size, style).markup;
}

export function fitTitleLayout(copy, x, y, width, font, size, { minSize = 9, weight = 760, ...style } = {}) {
  const advance = widthOf(copy, size, metrics(font, weight));
  const fitted = Math.min(advance, width - 2);
  const fontSize = advance ? size * fitted / advance : size;
  if (fontSize < minSize) throw new Error('Card title overflows its reserved area');
  return { markup: faceText(copy, x, y, { ...style, size: fontSize, weight }), advance: fitted };
}
