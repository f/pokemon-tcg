export function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

const svgImage = (x, y, width, height, uri) =>
  `<image x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="none" href="${uri}"/>`;

export function composeCardSvg(prepared, recipe, { width = 600, font = 'PingFang SC, Hiragino Sans GB, sans-serif' } = {}) {
  const [gridWidth, gridHeight] = recipe.grid;
  const overlay = recipe.overlay.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    const emblem = prepared.emblems[name];
    if (!emblem && recipe.cutouts?.[name]?.mode === 'strip') return '';
    if (!emblem) throw new Error('No prepared emblem named ' + name);
    const [x, y] = recipe.cutouts[name].position ?? [];
    return svgImage(x ?? emblem.x, y ?? emblem.y, emblem.width, emblem.height, emblem.uri);
  });
  const aspect = recipe.scanAspect ? prepared.aspect : gridHeight / gridWidth;
  const height = Math.round(width * aspect);
  const scale = recipe.scanAspect ? ' preserveAspectRatio="none"' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${gridWidth} ${gridHeight}"${scale}>` +
    `<defs><g id="original">${svgImage(0, 0, gridWidth, gridHeight, prepared.source)}</g></defs>` +
    '<use href="#original"/>' + svgImage(0, 0, gridWidth, gridHeight, prepared.patch) +
    `<g font-family="${escapeXml(font)}" xml:lang="${escapeXml(recipe.locale ?? 'zh-CN')}">${overlay}</g></svg>`;
}
