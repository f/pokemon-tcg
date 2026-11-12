// Estimate edge tangents from RGB gradients in the unmasked scan.
// Integral images let each repair pixel sample the surrounding structure.
function gradientSums({ width, height, pixels }, mask) {
  const stride = width + 1;
  const length = stride * (height + 1);
  const xx = new Float64Array(length), yy = new Float64Array(length), xy = new Float64Array(length);
  for (let y = 0; y < height; y++) {
    let rowXX = 0, rowYY = 0, rowXY = 0;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (x > 0 && x + 1 < width && y > 0 && y + 1 < height &&
          !mask[i] && !mask[i - 1] && !mask[i + 1] && !mask[i - width] && !mask[i + width]) {
        for (let c = 0; c < 3; c++) {
          const p = i * 3 + c;
          const dx = pixels[p + 3] - pixels[p - 3];
          const dy = pixels[p + width * 3] - pixels[p - width * 3];
          rowXX += dx * dx;
          rowYY += dy * dy;
          rowXY += dx * dy;
        }
      }
      const s = (y + 1) * stride + x + 1;
      xx[s] = xx[s - stride] + rowXX;
      yy[s] = yy[s - stride] + rowYY;
      xy[s] = xy[s - stride] + rowXY;
    }
  }
  return { xx, yy, xy, stride, width, height };
}

function tangentAt(tensor, x, y, radius) {
  const { stride, width, height } = tensor;
  const left = Math.max(0, x - radius), right = Math.min(width, x + radius + 1);
  const top = Math.max(0, y - radius), bottom = Math.min(height, y + radius + 1);
  const sum = (s) => s[bottom * stride + right] - s[bottom * stride + left] -
    s[top * stride + right] + s[top * stride + left];
  const xx = sum(tensor.xx), yy = sum(tensor.yy), xy = sum(tensor.xy);
  const energy = xx + yy;
  if (energy < 6500) return null;
  const coherence = Math.hypot(xx - yy, 2 * xy) / energy;
  if (coherence < 0.53) return null;
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  return { x: -Math.sin(angle), y: Math.cos(angle), coherence };
}

function donorAlong(image, mask, x, y, dx, dy) {
  const { width, height } = image;
  for (let distance = 1; distance <= 54; distance++) {
    const sx = Math.round(x + dx * distance), sy = Math.round(y + dy * distance);
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) break;
    const index = sy * width + sx;
    if (!mask[index]) return { offset: index * 3, distance };
  }
  return null;
}

function linearSample(width, x, y) {
  const left = Math.floor(x), top = Math.floor(y);
  const offset = (top * width + left) * 3;
  return { offset, x: x - left, y: y - top };
}

function sample(colors, { offset, x, y }, channel, stride) {
  const p = offset + channel;
  const top = colors[p] * (1 - x) + colors[p + 3] * x;
  const bottom = colors[p + stride] * (1 - x) + colors[p + stride + 3] * x;
  return top * (1 - y) + bottom * y;
}

// Coherent regions use colors along the tangent. Areas with conflicting edge
// directions fall back to local averaging.
export function edgeGuides(image, mask, locations, colors) {
  const { width, pixels } = image;
  const tensor = gradientSums(image, mask);
  return locations.map((i) => {
    const x = i % width, y = Math.floor(i / width);
    const tangent = tangentAt(tensor, x, y, 10) ?? tangentAt(tensor, x, y, 20);
    if (!tangent) return null;
    const a = donorAlong(image, mask, x, y, -tangent.x, -tangent.y);
    const b = donorAlong(image, mask, x, y, tangent.x, tangent.y);
    if (!a || !b) return null;
    const mix = a.distance / (a.distance + b.distance);
    const seed = [];
    let difference = 0;
    for (let c = 0; c < 3; c++) {
      const left = pixels[a.offset + c], right = pixels[b.offset + c];
      seed.push(left * (1 - mix) + right * mix);
      difference += Math.abs(left - right);
      colors[i * 3 + c] = seed[c];
    }
    const step = 2;
    return {
      forward: linearSample(width, x + step * tangent.x, y + step * tangent.y),
      back: linearSample(width, x - step * tangent.x, y - step * tangent.y),
      influence: Math.min(0.995, 0.82 + tangent.coherence * 0.18),
      seed,
      // Keep more of the original detail when both ends of the edge agree.
      anchor: (tangent.coherence - 0.53) * Math.max(0, 1 - difference / 150),
    };
  });
}

export function guidedColor(colors, guide, channel, stride, average) {
  const along = (sample(colors, guide.forward, channel, stride) + sample(colors, guide.back, channel, stride)) * 0.5;
  const blended = along * guide.influence + average * (1 - guide.influence);
  return guide.seed[channel] * guide.anchor + blended * (1 - guide.anchor);
}
