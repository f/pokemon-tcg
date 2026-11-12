import { faceText, fitTitle, fitTitleLayout, layoutParagraph } from './flow.js';
import { drawInlineIcon, pokemonOverlay, spreadAbilityLabel } from './pokemon.js';

export const modernTrainerBodyTop = 188;
export const modernTrainerCategoryBox = [13, 9.8, 91, 11.5];
const modernTrainerCategory = (text, fill, right = false) => faceText(text, right ? 230.7 : 15, 18.85, {
  size: 9.65, weight: 820, fill, skew: -14, anchor: right ? 'end' : 'start', outline: '#fcfcfb', outlineWidth: 1.45,
});

function scanOverlay(recipe, font) {
  const { title, titleIcon, headers, body, rule, family, color, heading, headerCopy, effect, ruleCopy,
    inlineIcons, outlineText, trainer, centerEffect, toolIntro, detail, detailCopy } = recipe.scan;
  const inlineIcon = (type, x, baseline, size) => drawInlineIcon(inlineIcons, type, x, baseline, size);
  let overlay = '';
  for (const [key, [x, y, w, h]] of Object.entries(headers)) {
    if (key === 'category' && color) {
      overlay += modernTrainerCategory(headerCopy[key], color, family !== 'sv');
      continue;
    }
    if (key === 'tool') {
      overlay += faceText(headerCopy[key], x, y + h * 0.78, {
        size: 7.5, weight: 820, skew: -14, fill: '#11648e', outline: '#fcfcfb', outlineWidth: 1.15,
      });
      overlay += fitTitle(toolIntro[0], 100, 190.15, 123, font, 6.15, { minSize: 3.8, weight: 540 });
      overlay += fitTitle(toolIntro[1], 21, 198.95, 202, font, 6.15, { minSize: 3.8, weight: 540 });
      continue;
    }
    const size = Math.min(11, h * 1.05);
    const right = ['category', 'energy', 'energyCategory'].includes(key) && x > 120 ||
      key === 'trainer' && family === 'sv';
    const anchor = right ? 'end' : 'start';
    overlay += faceText(headerCopy[key], x + (right ? w : 0), y + h * 0.84,
      { size, weight: 760, fill: '#353536', skew: family !== 'classic', anchor });
  }
  if (title) {
    const [x, y, , h] = title;
    const size = family === 'classic' ? 12.6 : 15.3;
    const baseline = y + Math.min(h, family === 'classic' ? 11.5 : 12.3);
    overlay += titleIcon ? layoutParagraph(heading.replace(/【[^】]+】/u, '{icon.' + titleIcon + '}'),
      [x, baseline - size, 229 - x, size * 1.34], font, { size, minSize: 6, weight: 760, alignTop: true, inlineIcon }) :
      fitTitle(heading, x, baseline, 229 - x, font, size, { minSize: 6 });
  }
  if (body) overlay += layoutParagraph(effect, body, font, {
    size: detail ? (detail.form ? 6.85 : 8.1) :
      centerEffect ? 12.2 : trainer && family === 'classic' ? 10.3 : family === 'classic' ? 9.1 : 8.8,
    minSize: 4.3, inlineIcon, weight: centerEffect ? 760 : 500, alignCenter: centerEffect,
    outline: outlineText || detail?.form ? '#f9f9f5' : undefined, alignTop: trainer || outlineText,
  });
  if (detail) {
    if (detail.form) {
      overlay += faceText(detailCopy.form, ...detail.form, {
        size: 9.1, weight: 850, fill: '#635321', skew: -14, anchor: 'middle', outline: '#fcfcf9', outlineWidth: 1.2,
      });
    }
    if (detail.ability) {
      overlay += faceText(spreadAbilityLabel(detailCopy.ability), ...detail.ability, {
        size: 7.6, weight: 850, fill: '#fff', skew: -14, anchor: 'middle',
      });
    }
    overlay += faceText(detailCopy.heading, ...detail.heading, {
      size: 10.8, weight: 800, fill: detail.ability ? '#a92425' : '#19191a', anchor: detail.ability ? 'start' : 'middle',
    });
    overlay += layoutParagraph(detailCopy.effect, detail.effect, font, {
      size: detail.form ? 6.65 : 7.6, minSize: 5.8, alignTop: true, outline: detail.form ? '#fcfcfb' : undefined,
    });
  }
  if (rule) overlay += layoutParagraph(ruleCopy, rule, font, { size: 6.5, minSize: 4.1 });
  return { ...recipe, overlay };
}

export function materializeFace({ recipe, font }) {
  if (recipe.paragraphs || recipe.headings) {
    const cutouts = { ...recipe.cutouts };
    const inlineIcon = (type, x, baseline, size) => drawInlineIcon(recipe.inlineIcons, type, x, baseline, size);
    const overlay = recipe.overlay.replace(/\[\[(paragraph|heading)\.(\w+)\]\]/g, (_, kind, key) => {
      if (kind === 'paragraph') {
        const { text, box, ...style } = recipe.paragraphs[key];
        return layoutParagraph(text, box, font, { ...style, inlineIcon });
      }
      const { text, position: [x, baseline], width, size, emblem, ...style } = recipe.headings[key];
      const source = cutouts[emblem];
      const gap = 2.5;
      const heading = fitTitleLayout(text, x, baseline, width - source.box[2] - gap, font, size, style);
      cutouts[emblem] = { ...source, position: [x + heading.advance + gap], baseline };
      return heading.markup + '{{' + emblem + '}}';
    });
    return { ...recipe, overlay, cutouts };
  }
  if (recipe.overlay !== undefined) return recipe;
  if (recipe.pokemon) return pokemonOverlay(recipe, font);
  if (recipe.scan) return scanOverlay(recipe, font);
  const c = recipe.content;
  let overlay;
  if (recipe.profile === 'modernTrainer') {
    const subtitle = c.subtitle && fitTitleLayout(c.subtitle, 229, 38.5, 76, font, 7.7,
      { minSize: 5, weight: 550, skew: true, anchor: 'end' });
    const titleWidth = subtitle ? 209 - subtitle.advance : 214;
    overlay = modernTrainerCategory(c.category, c.color) +
      faceText(c.trainer, 229, 19.4, { size: 9.7, weight: 760, fill: '#454548', skew: true, anchor: 'end' }) +
      fitTitle(c.title, 15, 40, titleWidth, font, 15.8, { minSize: 7.4 }) +
      (subtitle ? subtitle.markup : '') +
      layoutParagraph(c.body, [19, modernTrainerBodyTop, 208, 97], font, { size: 9.4, minSize: 5.3, alignTop: true }) +
      layoutParagraph(c.rule, [93, 302, 136, 25], font, { size: 6.8, minSize: 4.1 });
  } else if (recipe.profile === 'sveEnergy') {
    overlay = faceText(c.basicEnergy, 15, 18.7, { size: 8.1, fill: '#373638', weight: 760, skew: true }) +
      faceText(c.energy, 222, 19.1, { size: 10.5, fill: '#373638', weight: 780, anchor: 'end', skew: true }) +
      faceText(c.basic, 18, 40, { size: 15, weight: 760 }) +
      faceText(c.suffix, 74, 40, { size: 15, weight: 760 });
  } else throw new Error('Unknown card layout profile ' + recipe.profile);
  return { ...recipe, overlay };
}
