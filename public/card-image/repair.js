import { edgeGuides, guidedColor } from './edge-repair.js';

const luminance = (pixels, i) => (54 * pixels[i] + 183 * pixels[i + 1] + 19 * pixels[i + 2]) / 256;
const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));
const isWhiteEdge = (pixels, i) => pixels[i] >= 200 && pixels[i + 1] >= 200 && pixels[i + 2] >= 200;
const isGoldEdge = (pixels, i) => pixels[i] >= 155 && pixels[i + 1] >= 125 &&
  Math.min(pixels[i], pixels[i + 1]) - pixels[i + 2] >= 35;
const OUTLINED_INK = 2;

function isInk(pixels, index, mode, threshold) {
  const [red, green, blue] = pixels.subarray(index, index + 3);
  const light = luminance(pixels, index);
  switch (mode) {
    case 'red': return red > green + 48 && red > blue + 34 && green < threshold;
    case 'blue': return (blue > red + 25 && blue > green + 12 && green < 185) || light > threshold;
    case 'light': return light > threshold;
    case 'dark': return light < threshold;
    case 'full': return true;
    default: throw new Error('Unknown erasure mode: ' + mode);
  }
}

function isOutlinedInk({ width, height, pixels }, x, y, darkThreshold, edge = isWhiteEdge) {
  const index = (y * width + x) * 3;
  const bright = edge(pixels, index);
  if (!bright && luminance(pixels, index) > darkThreshold) return false;

  // Printed dark letters have a white edge within a few source pixels.
  // Checking for both colors keeps isolated dark or bright artwork out of the mask.
  const radius = 4;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const xx = x + dx, yy = y + dy;
      if (dx * dx + dy * dy > radius * radius || xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      const neighbor = (yy * width + xx) * 3;
      if (bright ? luminance(pixels, neighbor) <= darkThreshold : edge(pixels, neighbor)) return true;
    }
  }
  return false;
}

const bandModes = new Set(['band', 'dark-band', 'paper', 'textured']);
const directions = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]];
const donorWeight = (distance) => 1 / (distance + 1) ** 1.5;

function classicRuleRows(image) {
  const { width, height, pixels } = image;
  const rows = new Uint8Array(height);
  const left = Math.floor(width * 0.055), right = Math.ceil(width * 0.95);
  for (let y = Math.floor(height * 0.55); y < height * 0.91; y++) {
    let ink = 0, gaps = 0;
    for (let x = left; x < right; x++) {
      if (luminance(pixels, (y * width + x) * 3) < 100) {
        ink++;
        gaps = 0;
      } else if (++gaps > 3) ink = 0;
      if (ink < width * 0.44) continue;
      rows.fill(1, y - 1, y + 2);
      break;
    }
  }
  return rows;
}

function scanEdges(image, grid, axis, from, to, crossFrom, crossTo) {
  const { width, height, pixels } = image;
  const horizontal = axis === 'y';
  const scale = horizontal ? height / grid[1] : width / grid[0];
  const crossScale = horizontal ? width / grid[0] : height / grid[1];
  const stride = horizontal ? width : 1;
  const crossStride = horizontal ? 1 : width;
  const gap = Math.max(1, Math.round(scale / 2.4));
  const scores = [];
  for (let p = Math.round(from * scale); p <= Math.round(to * scale); p++) {
    const differences = [];
    for (let q = Math.round(crossFrom * crossScale); q < crossTo * crossScale; q += 3) {
      const offset = (p * stride + q * crossStride) * 3;
      const before = offset - gap * stride * 3, after = offset + gap * stride * 3;
      differences.push([0, 1, 2].reduce((sum, c) => sum + Math.abs(pixels[after + c] - pixels[before + c]), 0));
    }
    differences.sort((a, b) => a - b);
    scores.push({ p, score: differences[Math.floor(differences.length / 2)] });
  }
  return scores;
}

function innerFrameEdge(image, grid, axis, from, to, crossFrom, crossTo, inward) {
  const scores = scanEdges(image, grid, axis, from, to, crossFrom, crossTo);
  const peak = scores.reduce((a, b) => a.score >= b.score ? a : b);
  const span = (axis === 'y' ? image.height / grid[1] : image.width / grid[0]) * 2.4;
  const nearby = scores.filter(s => Math.abs(s.p - peak.p) <= span && s.score >= peak.score * 0.55);
  return (inward > 0 ? nearby.at(-1).p : nearby[0].p) + inward;
}

function classicRepairBounds(image, grid, mode) {
  const { width, height } = image;
  if (mode === 'classic-title') {
    const edges = scanEdges(image, grid, 'y', 37.4, 42, 62, 219);
    const edge = edges.reduce((a, b) => a.score >= b.score ? a : b);
    return { left: 1, right: width - 1, top: 1, bottom: edge.p - 1, horizontal: true };
  }
  return {
    left: innerFrameEdge(image, grid, 'x', 16.7, 22, 309, 322, 1),
    right: innerFrameEdge(image, grid, 'x', 223.1, 228.7, 309, 322, -1),
    top: innerFrameEdge(image, grid, 'y', 303.7, 308.5, 29, 215, 1),
    bottom: innerFrameEdge(image, grid, 'y', 323.7, 328, 29, 215, -1),
    horizontal: true,
  };
}

function badgeInterior(image, grid) {
  const { width, height, pixels } = image;
  const sx = width / grid[0], sy = height / grid[1];
  const samples = [24, 25, 26, 67, 68, 69].map(x => Math.round(x * sx));
  const redRow = (y) => samples.filter(x => {
    const i = (y * width + x) * 3;
    return pixels[i] - Math.max(pixels[i + 1], pixels[i + 2]) >= 100;
  }).length >= 4;
  let top = Math.round(190 * sy), bottom = top;
  while (top > Math.round(185 * sy) && redRow(top - 1)) top--;
  while (bottom < Math.round(195 * sy) && redRow(bottom)) bottom++;
  return { left: Math.round(27 * sx), right: Math.round(67 * sx), top, bottom };
}

function localPaperLight(image, quantile) {
  const { width, height, pixels } = image;
  const step = Math.max(6, Math.round(width / 95));
  const columns = Math.ceil(width / step), rows = Math.ceil(height / step);
  const levels = new Uint8Array(columns * rows);
  const ready = new Uint8Array(levels.length);
  return (x, y) => {
    const col = Math.floor(x / step), row = Math.floor(y / step);
    const i = row * columns + col;
    if (ready[i]) return levels[i];
    const centerX = col * step + Math.floor(step / 2), centerY = row * step + Math.floor(step / 2);
    const neighbors = [];
    for (let yy = Math.max(0, centerY - 2 * step); yy < Math.min(height, centerY + 2 * step + 1); yy += 3) {
      for (let xx = Math.max(0, centerX - 2 * step); xx < Math.min(width, centerX + 2 * step + 1); xx += 3) {
        neighbors.push(luminance(pixels, (yy * width + xx) * 3));
      }
    }
    neighbors.sort((a, b) => a - b);
    ready[i] = 1;
    levels[i] = neighbors[Math.floor(neighbors.length * quantile)];
    return levels[i];
  };
}

function createMask(image, grid, regions) {
  const { width, height, pixels } = image;
  const [gridWidth, gridHeight] = grid;
  const scaleX = width / gridWidth, scaleY = height / gridHeight;
  const mask = new Uint8Array(width * height);
  const bands = [];
  const repairBounds = new Map();
  const labelBounds = [];
  const paperLight = localPaperLight(image, 0.78);
  const paperDark = localPaperLight(image, 0.22);

  for (const [x, y, w, h, mode = 'dark', threshold = 128, dilation = 2, textureSource] of regions) {
    let left = Math.round(x * scaleX), right = Math.round((x + w) * scaleX);
    let top = Math.round(y * scaleY), bottom = Math.round((y + h) * scaleY);
    const isBand = bandModes.has(mode) || mode === 'badge-interior';
    const outline = mode === 'outlined' || mode === 'gold-outline';
    if (left < 0 || top < 0 || right > width || bottom > height || right <= left || bottom <= top) {
      throw new Error('Erasure box is outside the card: ' + [x, y, w, h].join(', '));
    }
    if (!Number.isInteger(dilation) || dilation < 0 || dilation > 8) {
      throw new Error('Erasure dilation must be a whole number from 0 to 8');
    }
    if (mode === 'classic-title' || mode === 'classic-flavor') {
      if (!repairBounds.has(mode)) repairBounds.set(mode, classicRepairBounds(image, grid, mode));
    }
    if (mode === 'badge-interior') repairBounds.set(mode, badgeInterior(image, grid));
    const bounds = mode === 'classic-label' ? { left, right, top, bottom } : repairBounds.get(mode);
    if (mode === 'classic-label') labelBounds.push(bounds);
    if (bounds) {
      left = Math.max(left, bounds.left); right = Math.min(right, bounds.right);
      top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom);
    }
    if (isBand) {
      const sampleX = textureSource && Math.round(textureSource[0] * scaleX);
      const sampleWidth = textureSource && Math.round(textureSource[1] * scaleX);
      if (mode === 'textured' && (!(sampleWidth > 0) || sampleX < 2 || sampleX + sampleWidth > width - 2)) {
        throw new Error('Textured erasures need a clean [x, width] sample inside the card');
      }
      bands.push({ left, right, top, bottom, mode: mode === 'badge-interior' ? 'band' : mode, sampleX, sampleWidth });
    }
    for (let yy = top; yy < bottom; yy++) {
      for (let xx = left; xx < right; xx++) {
        if (!isBand) {
          const index = (yy * width + xx) * 3;
          let marked;
          if (outline) marked = isOutlinedInk(image, xx, yy, threshold, mode === 'gold-outline' ? isGoldEdge : isWhiteEdge);
          else if (mode === 'paper-ink' || bounds) {
            const light = luminance(pixels, index);
            marked = light < Math.min(175, paperLight(xx, yy) - threshold);
          } else if (mode === 'paper-light') {
            marked = luminance(pixels, index) > Math.max(threshold * 2, paperDark(xx, yy) + threshold);
          } else marked = isInk(pixels, index, mode, threshold);
          if (!marked) continue;
        }
        for (let dy = -dilation; dy <= dilation; dy++) {
          for (let dx = -dilation; dx <= dilation; dx++) {
            if (dx * dx + dy * dy > dilation * dilation) continue;
            const px = xx + dx, py = yy + dy;
            if (px >= 0 && px < width && py >= 0 && py < height) {
              if (bounds && (px < bounds.left || px >= bounds.right || py < bounds.top || py >= bounds.bottom)) continue;
              const index = py * width + px;
              if (outline) mask[index] ||= OUTLINED_INK;
              else mask[index] = 1;
            }
          }
        }
      }
    }
  }
  return { mask, bands, repairBounds, labelBounds };
}

function bandPixel(image, mask, band, x, y, channel) {
  const { pixels, width, height } = image;
  const { left, top, right, bottom, mode, sampleX, sampleWidth } = band;
  const pixel = (xx, yy) => pixels[(Math.max(0, Math.min(height - 1, yy)) * width +
    Math.max(0, Math.min(width - 1, xx))) * 3 + channel];
  const mixX = (x - left) / (right - left), mixY = (y - top) / (bottom - top);
  const mix = (a, b, ratio) => a * (1 - ratio) + b * ratio;
  const localGrain = (((x * 739397) ^ (y * 12347)) >>> 0) % 5 - 2;

  if (mode === 'textured') {
    const blur = (xx, yy) => {
      let sum = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) sum += pixel(xx + dx, yy + dy);
      }
      return sum / 25;
    };
    const sample = sampleX + (x - left) % sampleWidth;
    const grain = Math.max(-8, Math.min(8, pixel(sample, y) - blur(sample, y)));
    return mix(blur(x, top - 3), blur(x, bottom + 3), mixY) + grain + localGrain;
  }

  let a = Math.max(0, left - 1), b = Math.min(width - 1, right);
  while (a > 0 && mask[y * width + a]) a--;
  while (b < width - 1 && mask[y * width + b]) b++;
  const l = pixel(a, y), r = pixel(b, y);
  if (mode === 'band') return mix(l, r, mixX) + localGrain;
  if (mode === 'dark-band') {
    // The white lettering can brighten the neighboring pixels on the black strip.
    const darken = (value, xx) => value * Math.min(1, 14 / Math.max(1, luminance(pixels, (y * width + xx) * 3)));
    return mix(darken(l, a), darken(r, b), mixX) + localGrain;
  }

  const vertical = (xx) => mix(pixel(xx, top - 2), pixel(xx, bottom + 2), mixY);
  const grain = Math.max(-8, Math.min(8, mix(l - vertical(a), r - vertical(b), mixX)));
  return vertical(x) + grain + localGrain;
}

function findDonors(width, height, mask, x, y, limit = 54, protectedRows, bounds) {
  const donors = [];
  for (const [dx, dy] of directions) {
    for (let distance = 1; distance < limit; distance++) {
      const xx = x + dx * distance, yy = y + dy * distance;
      if (xx < 1 || xx >= width - 1 || yy < 1 || yy >= height - 1) break;
      if (bounds && (xx < bounds.left || xx >= bounds.right || yy < bounds.top || yy >= bounds.bottom)) break;
      const i = yy * width + xx;
      if (!mask[i] && !protectedRows?.[yy]) {
        const bias = bounds?.horizontal && !dy ? 0.60 : dx && dy ? 1.42 : 1;
        donors.push({ i, distance: distance * bias });
        break;
      }
    }
  }
  return donors.sort((a, b) => a.distance - b.distance).slice(0, 4);
}

function blendOutlinedRepairs(image, mask, patch) {
  const { width, pixels } = image;
  if (!mask.includes(OUTLINED_INK)) return;
  const locations = [];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === OUTLINED_INK && patch[i * 4 + 3]) locations.push(i);
  }
  if (!locations.length) return;

  // Seed from nearby colors, then follow coherent edges through the repair.
  const colors = Float32Array.from(pixels);
  for (let i = 0; i < mask.length; i++) {
    if (!patch[i * 4 + 3]) continue;
    for (let c = 0; c < 3; c++) colors[i * 3 + c] = patch[i * 4 + c];
  }
  const guides = edgeGuides(image, mask, locations, colors);
  const stride = width * 3;
  for (let pass = 0; pass < 32; pass++) {
    for (let index = 0; index < locations.length; index++) {
      const i = locations[index], guide = guides[index];
      for (let c = 0; c < 3; c++) {
        const p = i * 3 + c;
        const average = (colors[p - 3] + colors[p + 3] + colors[p - stride] + colors[p + stride] +
          0.5 * (colors[p - stride - 3] + colors[p - stride + 3] +
            colors[p + stride - 3] + colors[p + stride + 3])) / 6;
        colors[p] = guide ? guidedColor(colors, guide, c, stride, average) : average;
      }
    }
  }
  for (const i of locations) {
    const grain = ((i * 739397) >>> 0) % 5 - 2;
    for (let c = 0; c < 3; c++) patch[i * 4 + c] = clampByte(colors[i * 3 + c] + grain);
  }
}

function repeatedRowDonors(mask, width, x, y, { top, bottom, period }) {
  const find = direction => {
    for (let step = 1; step * period < bottom - top; step++) {
      const sample = y + direction * step * period;
      const lower = Math.floor(sample), upper = Math.ceil(sample);
      if (lower < top || upper >= bottom) break;
      const a = lower * width + x, b = upper * width + x;
      if (!mask[a] && !mask[b]) return { a, b, fraction: sample - lower, weight: 1 / step };
    }
    return null;
  };
  return [find(-1), find(1)].filter(Boolean);
}

function buildPatch(image, grid, regions, preserveRules, logoPixels, repeatRows) {
  const { width, height, pixels } = image;
  const { mask, bands, repairBounds, labelBounds } = createMask(image, grid, regions);
  const classicTitle = repairBounds.get('classic-title');
  const classicFlavor = repairBounds.get('classic-flavor');
  for (const index of logoPixels) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) mask[index + dy * width + dx] = 1;
    }
  }
  const protectedRows = preserveRules ? classicRuleRows(image) : undefined;
  const repeated = repeatRows && {
    left: repeatRows.x * width / grid[0],
    top: Math.ceil(repeatRows.top * height / grid[1]),
    bottom: Math.floor(repeatRows.bottom * height / grid[1]),
    period: repeatRows.period * height / grid[1],
  };
  if (repeated && (!Object.values(repeated).every(Number.isFinite) ||
      repeated.period < 1 || repeated.top < 0 || repeated.bottom > height || repeated.top >= repeated.bottom)) {
    throw new Error('Invalid repeating row texture');
  }
  const output = new Uint8Array(width * height * 4);
  // The PNG is transparent except where an English glyph is repaired.
  for (let y = 3; y < height - 3; y++) {
    for (let x = 3; x < width - 3; x++) {
      const i = y * width + x;
      if (!mask[i] || protectedRows?.[y]) continue;
      const band = bands.find(({ left, top, right, bottom }) => x >= left && x < right && y >= top && y < bottom);
      const repeatedDonors = repeated && x >= repeated.left && y >= repeated.top && y < repeated.bottom &&
        repeatedRowDonors(mask, width, x, y, repeated);
      if (repeatedDonors?.length) {
        const weight = repeatedDonors.reduce((sum, donor) => sum + donor.weight, 0);
        for (let c = 0; c < 3; c++) {
          const total = repeatedDonors.reduce((sum, { a, b, fraction, weight }) =>
            sum + weight * (pixels[a * 3 + c] * (1 - fraction) + pixels[b * 3 + c] * fraction), 0);
          output[i * 4 + c] = clampByte(total / weight);
        }
        // These pixels already have an in-phase sample. Diffusion would blur the grid.
        mask[i] = 1;
      } else if (band) {
        for (let c = 0; c < 3; c++) output[i * 4 + c] = clampByte(bandPixel(image, mask, band, x, y, c));
      } else {
        const label = labelBounds.find(box => x >= box.left && x < box.right && y >= box.top && y < box.bottom);
        // Stay on the label row so the round symbols below it cannot tint the repair.
        const bounds = label ? { left: label.left - 3, right: label.right + 3, top: y, bottom: y + 1 } :
          y < classicTitle?.bottom ? classicTitle : y >= classicFlavor?.top ? classicFlavor : undefined;
        let donors = findDonors(width, height, mask, x, y, 54, protectedRows, bounds);
        if (!donors.length && mask[i] === OUTLINED_INK) {
          // Dense outlines can join into a region larger than the local search.
          // Seed these pixels from farther away so no English strokes show through.
          donors = findDonors(width, height, mask, x, y, Math.max(width, height), protectedRows);
        }
        if (!donors.length) continue;
        const weights = donors.map(({ distance }) => donorWeight(distance));
        const weight = weights.reduce((a, b) => a + b);
        const grain = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 7 - 3;
        for (let c = 0; c < 3; c++) {
          const average = donors.reduce((sum, { i: sample }, n) => sum + weights[n] * pixels[sample * 3 + c], 0) / weight;
          output[i * 4 + c] = clampByte(0.70 * average + 0.30 * pixels[donors[0].i * 3 + c] + grain);
        }
      }
      output[i * 4 + 3] = 255;
    }
  }
  blendOutlinedRepairs(image, mask, output);
  return output;
}

function extractEmblem(image, grid, { box, minLuma = 96 }) {
  const { width, height, pixels } = image;
  const scaleX = width / grid[0], scaleY = height / grid[1];
  const [x, y, w, h] = box;
  const x0 = Math.floor(x * scaleX), y0 = Math.floor(y * scaleY);
  const bw = Math.ceil((x + w) * scaleX) - x0, bh = Math.ceil((y + h) * scaleY) - y0;
  if (x0 < 0 || y0 < 0 || bw < 1 || bh < 1 || x0 + bw > width || y0 + bh > height) {
    throw new Error('Emblem box is outside the card');
  }
  const data = new Uint8Array(bw * bh * 4);
  const marks = new Uint8Array(bw * bh);
  const sourceIndex = (xx, yy) => ((yy + y0) * width + xx + x0) * 3;
  for (let yy = 0; yy < bh; yy++) {
    for (let xx = 0; xx < bw; xx++) {
      const i = sourceIndex(xx, yy);
      if (luminance(pixels, i) > minLuma || (pixels[i] > 45 && pixels[i] + 11 > pixels[i + 1])) {
        marks[yy * bw + xx] = 1;
      }
    }
  }
  for (let yy = 0; yy < bh; yy++) {
    for (let xx = 0; xx < bw; xx++) {
      let alpha = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = xx + dx, ny = yy + dy, distance = dx * dx + dy * dy;
          if (nx >= 0 && nx < bw && ny >= 0 && ny < bh && distance <= 4 && marks[ny * bw + nx]) {
            alpha = Math.max(alpha, distance < 2 ? 255 : 155);
          }
        }
      }
      const dest = (yy * bw + xx) * 4, from = sourceIndex(xx, yy);
      data.set(pixels.subarray(from, from + 3), dest);
      data[dest + 3] = alpha;
    }
  }
  return { x: x0 / scaleX, y: y0 / scaleY, width: bw / scaleX, height: bh / scaleY, pixels: data, pixelWidth: bw, pixelHeight: bh };
}

function extractInlineIcon(image, grid, { box, shape }) {
  if (!['round', 'ink', 'light', 'outlined'].includes(shape)) throw new Error('Unknown inline icon shape: ' + shape);
  const { width, height, pixels } = image;
  const scaleX = width / grid[0], scaleY = height / grid[1];
  const [x, y, w, h] = box;
  const x0 = Math.round(x * scaleX), y0 = Math.round(y * scaleY);
  const bw = Math.round(w * scaleX), bh = Math.round(h * scaleY);
  if (x0 < 0 || y0 < 0 || bw < 1 || bh < 1 || x0 + bw > width || y0 + bh > height) {
    throw new Error('Inline icon box is outside the card');
  }
  const sourceIndex = (xx, yy) => ((yy + y0) * width + xx + x0) * 3;
  const tone = shape === 'light' ? index => 255 - luminance(pixels, index) : index => luminance(pixels, index);
  const samples = [];
  if (shape === 'ink' || shape === 'light') {
    for (let yy = 0; yy < bh; yy++) {
      for (let xx = 0; xx < bw; xx++) {
        const index = sourceIndex(xx, yy);
        samples.push({ index, light: tone(index) });
      }
    }
    samples.sort((a, b) => a.light - b.light);
  }
  const ink = samples[Math.floor(samples.length * 0.10)];
  const paper = (samples[Math.floor(samples.length * 0.86)]?.light ?? 0) - 8;
  const data = new Uint8Array(bw * bh * 4);
  for (let yy = 0; yy < bh; yy++) {
    for (let xx = 0; xx < bw; xx++) {
      const from = sourceIndex(xx, yy);
      const to = (yy * bw + xx) * 4;
      if (shape === 'round') {
        const distance = Math.hypot((xx + 0.5) / bw - 0.5, (yy + 0.5) / bh - 0.5);
        data.set(pixels.subarray(from, from + 3), to);
        data[to + 3] = clampByte((0.51 - distance) * Math.min(bw, bh) * 255);
      } else if (shape === 'outlined') {
        data.set(pixels.subarray(from, from + 3), to);
        if (isOutlinedInk(image, xx + x0, yy + y0, 118)) data[to + 3] = 255;
      } else {
        // Estimate the ink and paper from this scan to preserve the
        // printed silhouette without carrying the old background along.
        data.set(pixels.subarray(ink.index, ink.index + 3), to);
        data[to + 3] = clampByte((paper - tone(from)) * 255 / Math.max(32, paper - ink.light));
      }
    }
  }
  return { x, y, width: w, height: h, pixels: data, pixelWidth: bw, pixelHeight: bh };
}

function visitNeighbors(index, width, height, visit) {
  const x = index % width, y = Math.floor(index / width);
  if (x > 0) visit(index - 1);
  if (x + 1 < width) visit(index + 1);
  if (y > 0) visit(index - width);
  if (y + 1 < height) visit(index + width);
}

function connectedRegions(seeds, width, height) {
  const regions = [];
  for (let i = 0; i < seeds.length; i++) {
    if (!seeds[i]) continue;
    seeds[i] = 0;
    const queue = [i];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      visitNeighbors(queue[cursor], width, height, (n) => {
        if (!seeds[n]) return;
        seeds[n] = 0;
        queue.push(n);
      });
    }
    regions.push(queue);
  }
  return regions.sort((a, b) => b.length - a.length);
}

// The small ex and V marks sit on a colored strip. Compare against the
// clean strip to the right on each scan row, so its gradient stays intact.
function extractStripEmblem(image, grid, { box, mark, gold }) {
  const { width, height, pixels } = image;
  const scaleX = width / grid[0], scaleY = height / grid[1];
  const [x, y, w, h] = box;
  const x0 = Math.floor(x * scaleX), y0 = Math.floor(y * scaleY);
  const bw = Math.ceil((x + w) * scaleX) - x0, bh = Math.ceil((y + h) * scaleY) - y0;
  if (x0 < 2 || y0 < 2 || bw < 4 || bh < 4 || x0 + bw + 6 >= width || y0 + bh + 2 >= height) return null;

  const count = bw * bh;
  const contrast = new Uint8Array(count), seeds = new Uint8Array(count), pigment = new Uint8Array(count);
  const sample = (xx, yy, c) => pixels[((y0 + yy) * width + x0 + xx) * 3 + c];
  const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const stripEdges = mark === 'ex' && Array.from({ length: bw }, (_, xx) =>
    [0, 1, 2].map(c => [
      median([-1, 0, 1].map(yy => sample(xx, yy, c))),
      median([bh - 2, bh - 1, bh].map(yy => sample(xx, yy, c))),
    ]));
  for (let yy = 0; yy < bh; yy++) {
    const row = (yy + y0) * width + x0;
    const background = !stripEdges && [0, 1, 2].map(c =>
      median([2, 3, 4, 5, 6].map(offset => sample(bw + offset, yy, c))));
    const fraction = yy / (bh - 1);
    for (let xx = 0; xx < bw; xx++) {
      const from = (row + xx) * 3, i = yy * bw + xx;
      const expected = stripEdges ? stripEdges[xx].map(([a, b]) => a * (1 - fraction) + b * fraction) : background;
      contrast[i] = Math.max(...expected.map((value, c) => Math.abs(pixels[from + c] - value)));
      seeds[i] = contrast[i] > 48 ? 1 : 0;
      if (stripEdges && contrast[i] > 36) {
        const [r, g, b] = pixels.subarray(from, from + 3);
        pigment[i] = gold ? Number(isGoldEdge(pixels, from)) :
          Number(g > r + 5 && b > r + 5 && b > g * 0.84 && luminance(pixels, from) > 107);
      }
    }
  }
  const components = connectedRegions(seeds, bw, bh);
  if (!components.length || components[0].length < count * 0.08 || components[0].length > count * 0.80) return null;
  const selected = new Uint8Array(count);
  for (const part of components) {
    if (mark === 'V' && part !== components[0]) break;
    if (part.length < components[0].length * 0.13) break;
    if (part !== components[0] && part.some(i => i % bw === 0 || i % bw === bw - 1)) continue;
    for (const i of part) selected[i] = 1;
  }
  if (mark === 'V') {
    const firstOutline = [];
    for (let yy = 0; yy < bh; yy++) {
      for (let xx = 0; xx < bw; xx++) {
        const i = yy * bw + xx;
        const from = ((y0 + yy) * width + x0 + xx) * 3;
        if (!selected[i] || contrast[i] < 32 || !isWhiteEdge(pixels, from)) continue;
        firstOutline.push([yy, xx]);
        break;
      }
    }
    // The V has a white outline. An English stroke to its left can fall
    // into the same OCR word and occasionally touches the extracted region.
    if (firstOutline.length >= bh * 0.45) {
      for (const [yy, xx] of firstOutline) selected.fill(0, yy * bw, yy * bw + Math.max(0, xx - 2));
    }
  }
  if (stripEdges) {
    // Remove contrasting ornament or title fragments that don't belong to
    // the metallic cyan (or gold) logo. The nearby black/white rim is retained.
    const edgePigment = [];
    const discardEdge = (i) => {
      if (!pigment[i]) return;
      pigment[i] = 0;
      edgePigment.push(i);
    };
    for (let yy = 0; yy < bh; yy++) {
      discardEdge(yy * bw);
      discardEdge((yy + 1) * bw - 1);
    }
    for (let cursor = 0; cursor < edgePigment.length; cursor++) {
      visitNeighbors(edgePigment[cursor], bw, bh, discardEdge);
    }
    const nearPigment = new Uint8Array(count);
    let frontier = [];
    for (let i = 0; i < count; i++) {
      if (!pigment[i] || !selected[i]) continue;
      nearPigment[i] = 1;
      frontier.push(i);
    }
    if (frontier.length >= count * 0.035) {
      for (let distance = 0; distance < Math.ceil(scaleX * 2.5); distance++) {
        const next = [];
        for (const index of frontier) visitNeighbors(index, bw, bh, n => {
          if (nearPigment[n]) return;
          nearPigment[n] = 1;
          next.push(n);
        });
        frontier = next;
      }
      for (let i = 0; i < count; i++) selected[i] &= nearPigment[i];
    }
    const [main] = connectedRegions(selected.slice(), bw, bh);
    if (main) {
      const xs = main.map(i => i % bw);
      if (Math.max(...xs) - Math.min(...xs) > bw * 0.59) {
        selected.fill(0);
        for (const i of main) selected[i] = 1;
      }
    }
  }
  const outside = new Uint8Array(count), queue = [];
  const flood = (i) => {
    if (outside[i] || selected[i]) return;
    outside[i] = 1;
    queue.push(i);
  };
  for (let yy = 0; yy < bh; yy++) { flood(yy * bw); flood((yy + 1) * bw - 1); }
  for (let xx = 0; xx < bw; xx++) { flood(xx); flood((bh - 1) * bw + xx); }
  for (let cursor = 0; cursor < queue.length; cursor++) visitNeighbors(queue[cursor], bw, bh, flood);

  const data = new Uint8Array(count * 4), sourcePixels = [];
  let firstX = bw, lastX = -1, firstY = bh, lastY = -1;
  for (let i = 0; i < count; i++) {
    let alpha = outside[i] ? 0 : 255;
    if (!alpha && contrast[i] > 20) {
      visitNeighbors(i, bw, bh, n => {
        if (!outside[n]) alpha = clampByte((contrast[i] - 20) * 8);
      });
    }
    if (!alpha) continue;
    const xx = i % bw, yy = Math.floor(i / bw);
    const sourceIndex = (y0 + yy) * width + x0 + xx;
    firstX = Math.min(firstX, xx); lastX = Math.max(lastX, xx);
    firstY = Math.min(firstY, yy); lastY = Math.max(lastY, yy);
    data.set(pixels.subarray(sourceIndex * 3, sourceIndex * 3 + 3), i * 4);
    data[i * 4 + 3] = alpha;
    sourcePixels.push(sourceIndex);
  }
  const trimWidth = lastX - firstX + 1, trimHeight = lastY - firstY + 1;
  if (trimWidth < bw * 0.54 || trimHeight < bh * 0.50 || sourcePixels.length > count * 0.84) return null;
  const trimmed = new Uint8Array(trimWidth * trimHeight * 4);
  for (let yy = 0; yy < trimHeight; yy++) {
    const start = ((yy + firstY) * bw + firstX) * 4;
    trimmed.set(data.subarray(start, start + trimWidth * 4), yy * trimWidth * 4);
  }
  return { sourcePixels, emblem: {
    x: (x0 + firstX) / scaleX, y: (y0 + firstY) / scaleY, width: trimWidth / scaleX, height: trimHeight / scaleY,
    pixels: trimmed, pixelWidth: trimWidth, pixelHeight: trimHeight,
  } };
}

// Repair the scan and extract original emblems at its source resolution.
export function repairCard(image, recipe) {
  const emblems = {}, logoPixels = [];
  for (const [name, spec] of Object.entries(recipe.cutouts ?? {})) {
    if (spec.mode === 'strip') {
      const cutout = extractStripEmblem(image, recipe.grid, spec);
      if (!cutout) continue;
      emblems[name] = cutout.emblem;
      for (const index of cutout.sourcePixels) logoPixels.push(index);
    } else if (spec.mode === 'inline') {
      emblems[name] = extractInlineIcon(image, recipe.grid, spec);
    } else {
      emblems[name] = extractEmblem(image, recipe.grid, spec);
    }
  }
  return {
    patch: buildPatch(image, recipe.grid, recipe.erase, recipe.preserveRules, logoPixels, recipe.repeatRows),
    emblems,
  };
}

export function repairImageData({ width, height, data }, recipe) {
  const pixels = new Uint8Array(width * height * 3);
  for (let from = 0, to = 0; from < data.length; from += 4, to += 3) {
    pixels[to] = data[from];
    pixels[to + 1] = data[from + 1];
    pixels[to + 2] = data[from + 2];
  }
  return repairCard({ width, height, pixels }, recipe);
}
