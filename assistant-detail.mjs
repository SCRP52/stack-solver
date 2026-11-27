export function cardFrameLuminance({ data, width, height }) {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (data[p] * 3 + data[p + 1] * 6 + data[p + 2]) / 10;
  }
  return gray;
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
