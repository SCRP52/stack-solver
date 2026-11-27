export function cardFrameLuminance({ data, width, height }) {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (data[p] * 3 + data[p + 1] * 6 + data[p + 2]) / 10;
  }
  return gray;
}

// Estimate paper brightness in overlapping neighborhoods rather than from the room.
export function brightenCardShadows({ data, width, height }, gray) {
  const tile = 48;
  const columns = Math.ceil(width / tile), rows = Math.ceil(height / tile);
  const gains = new Float32Array(columns * rows).fill(1);
  const histogram = new Uint16Array(32);
  let needed = false;
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    histogram.fill(0);
    let neutral = 0;
    const centerX = (col + .5) * tile, centerY = (row + .5) * tile;
    for (let y = Math.max(0, centerY - 32); y < Math.min(height, centerY + 32); y += 3) {
      for (let x = Math.max(0, centerX - 32); x < Math.min(width, centerX + 32); x += 3) {
        const index = y * width + x;
        const luma = gray[index], p = index * 4;
        if (luma < 43) continue;
        const r = data[p], g = data[p + 1], b = data[p + 2];
        if (Math.max(r, g, b) - Math.min(r, g, b) > Math.min(60, 12 + luma * .27)) continue;
        histogram[luma >> 3]++;
        neutral++;
      }
    }
    if (neutral < 12) continue;
    let level = 31, pixels = histogram[level];
    while (level > 0 && pixels < neutral * .19) pixels += histogram[--level];
    // A small shadowed face can share a neighborhood with a much brighter background.
    for (let dark = Math.min(20, level - 6); dark >= 8; dark--) {
      const cluster = histogram[dark - 1] + histogram[dark] + histogram[dark + 1];
      if (cluster >= Math.max(14, neutral * .18)) {
        level = histogram[dark + 1] > histogram[dark] ? dark + 1 : dark;
        break;
      }
    }
    const gain = Math.max(1, Math.min(3, 207 / (level * 8 + 4)));
    gains[row * columns + col] = gain;
    if (gain > 1.15) needed = true;
  }
  if (!needed) return null;

  const brightened = new Uint8ClampedArray(data);
  for (let y = 0; y < height; y++) {
    const row = Math.max(0, Math.min(rows - 1, y / tile - .5));
    const top = Math.floor(row), bottom = Math.min(top + 1, rows - 1);
    const v = row - top;
    for (let x = 0; x < width; x++) {
      const col = Math.max(0, Math.min(columns - 1, x / tile - .5));
      const left = Math.floor(col), right = Math.min(left + 1, columns - 1);
      const u = col - left;
      const a = gains[top * columns + left] * (1 - u) + gains[top * columns + right] * u;
      const b = gains[bottom * columns + left] * (1 - u) + gains[bottom * columns + right] * u;
      const gain = a * (1 - v) + b * v;
      const p = (y * width + x) * 4;
      brightened[p] *= gain;
      brightened[p + 1] *= gain;
      brightened[p + 2] *= gain;
    }
  }
  return { data: brightened, width, height };
}

// Boost existing ink edges without changing the color relationships used for suits.
export function sharpenCardFrame({ data, width, height }, gray) {
  const stride = width + 1;
  const integral = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let sum = 0;
    const row = y * width;
    const above = y * stride;
    for (let x = 0; x < width; x++) {
      sum += gray[row + x];
      integral[above + stride + x + 1] = integral[above + x + 1] + sum;
    }
  }

  const sharpened = new Uint8ClampedArray(data);
  const radius = 9;
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height, y + radius + 1);
    const above = top * stride, below = bottom * stride;
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const sum = integral[below + right] - integral[below + left] - integral[above + right] + integral[above + left];
      const point = y * width + x;
      const detail = gray[point] - sum / ((right - left) * (bottom - top));
      // Leave low-contrast texture alone and cap amplification at strong edges.
      if (Math.abs(detail) < 5) continue;
      const correction = Math.max(-108, Math.min(48, detail * 3.2));
      const channel = point * 4;
      sharpened[channel] += correction;
      sharpened[channel + 1] += correction;
      sharpened[channel + 2] += correction;
    }
  }
  return { data: sharpened, width, height };
}

// A restored silhouette needs some ink contrast in the original frame.
export function sourceSuitContrast(gray, width, height, { suit, rotation: { cos, sin } }) {
  const margin = Math.max(3, Math.round(suit.h * .45));
  let paper = 0;
  for (let y = suit.y - margin; y <= suit.bottom + margin; y += 2) {
    for (let x = suit.x - margin; x <= suit.right + margin; x += 2) {
      const px = Math.round(x * cos - y * sin), py = Math.round(x * sin + y * cos);
      if (px >= 0 && px < width && py >= 0 && py < height) paper = Math.max(paper, gray[py * width + px]);
    }
  }
  const ink = suit.pixels.reduce((sum, pixel) => sum + gray[pixel], 0) / suit.pixels.length;
  return paper > 0 ? (paper - ink) / paper : 0;
}
