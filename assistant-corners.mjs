// Find rank and suit shapes by their spacing, without assuming a fixed card size.
export function findCardCorners({ data, width, height }) {
  const gray = new Uint8Array(width * height);
  const red = new Uint8Array(gray.length);
  const paper = new Uint8Array(gray.length);
  const histogram = new Uint32Array(256);
  let neutralCount = 0;
  for (let index = 0; index < gray.length; index++) {
    const i = index * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const brightness = (r * 3 + g * 6 + b) / 10;
    gray[index] = brightness;
    if (r > g * 1.26 && r > b * 1.16 && g < 170) {
      red[index] = 1;
    } else if (Math.max(r, g, b) - Math.min(r, g, b) <= 55 && brightness >= 90) {
      paper[index] = 1;
      histogram[gray[index]]++;
      neutralCount++;
    }
  }
  if (neutralCount < 45) return { corners: [], paper: false, gray, ink: null };

  let highlight = 255;
  let samples = 0;
  for (; highlight > 90; highlight--) {
    samples += histogram[highlight];
    if (samples >= neutralCount * .18) break;
  }
  const darkLimit = Math.round(highlight * .66);
  const lightLimit = Math.max(90, Math.round(highlight * .69));
  const ink = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    ink[i] = Number(gray[i] < darkLimit || red[i]);
    if (gray[i] < lightLimit) paper[i] = 0;
  }

  const glyphs = findGlyphs(ink.slice(), red, width, height);
  const doubleRanks = [];
  const digitParts = new Set();
  // A printed 10 often consists of two disconnected glyphs.
  for (const one of glyphs) {
    if (one.w > one.h * .66) continue;
    for (const zero of glyphs) {
      if (one.w >= zero.w || one.red !== zero.red) continue;
      const gap = Math.max(one.x, zero.x) - Math.min(one.right, zero.right) - 1;
      if (gap < 0 || gap > one.h * .42 || zero.h < one.h * .78 || zero.h > one.h * 1.23) continue;
      if (Math.abs(one.y - zero.y) > one.h * .19 || Math.abs(one.bottom - zero.bottom) > one.h * .19) continue;
      const x = Math.min(one.x, zero.x), y = Math.min(one.y, zero.y);
      const right = Math.max(one.right, zero.right), bottom = Math.max(one.bottom, zero.bottom);
      const w = right - x + 1, h = bottom - y + 1;
      if (w < h * .48 || w > h * 1.6) continue;
      doubleRanks.push({ x, y, right, bottom, w, h, red: one.red, double: true });
      if (one.w < one.h * .29) {
        digitParts.add(one);
        digitParts.add(zero);
      }
    }
  }

  const ranks = [...doubleRanks, ...glyphs.filter(glyph => !digitParts.has(glyph) && glyph.w >= glyph.h * .25)];
  const corners = [];
  const centerX = (width - 1) / 2, centerY = (height - 1) / 2;
  for (const rank of ranks) for (const suit of glyphs) {
    if (rank.red !== suit.red || suit.w < suit.h * .43 || suit.w > suit.h * 1.5) continue;
    const gap = suit.y - rank.bottom - 1;
    if (gap < 0 || gap > rank.h * .83 || suit.h < rank.h * .39 || suit.h > rank.h * 1.13) continue;
    const dx = Math.abs((rank.x + rank.right - suit.x - suit.right) / 2);
    if (dx > rank.h * (rank.double ? .52 : .37)) continue;

    const left = Math.min(rank.x, suit.x), right = Math.max(rank.right, suit.right);
    const centerDistance = Math.hypot(((left + right) / 2 - centerX) / width, ((rank.y + suit.bottom) / 2 - centerY) / height);
    const margin = Math.max(2, Math.round(rank.h * .21));
    const sides = [
      lightFraction(paper, width, height, left - margin, rank.y, left, suit.bottom + 1),
      lightFraction(paper, width, height, right + 1, rank.y, right + margin + 1, suit.bottom + 1),
      lightFraction(paper, width, height, left, rank.y - margin, right + 1, rank.y),
      lightFraction(paper, width, height, left, suit.bottom + 1, right + 1, suit.bottom + margin + 1),
    ];
    const light = sides.reduce((sum, fraction) => sum + fraction, 0) / sides.length;
    if (light < .68 || Math.min(sides[0], sides[1]) < .38) continue;

    const edgeOffset = Math.max(4, Math.round(rank.h * .85));
    const edgeWidths = Math.max(2, Math.round(rank.h * .3));
    const leftEdge = lightFraction(paper, width, height, left - edgeOffset - edgeWidths, rank.y, left - edgeOffset, suit.bottom + 1);
    const rightEdge = lightFraction(paper, width, height, right + edgeOffset + 1, rank.y, right + edgeOffset + edgeWidths + 1, suit.bottom + 1);
    const upperEdge = lightFraction(paper, width, height, left, rank.y - edgeOffset - edgeWidths, right + 1, rank.y - edgeOffset);
    // Prefer the printed index near an outer edge, ahead of a similar shape in face artwork.
    const quality = light * .36 - centerDistance * .4 - dx / rank.h * .26 +
      (1 - Math.min(leftEdge, rightEdge)) * .19 + (1 - upperEdge) * .07 + (rank.double ? .04 : 0);
    corners.push({ rank, suit, quality, leftEdge, rightEdge, upperEdge });
  }
  corners.sort((a, b) => b.quality - a.quality);
  return { corners: corners.slice(0, 10), paper: true, gray, ink };
}

function lightFraction(paper, width, height, x0, y0, x1, y1) {
  let light = 0, total = 0;
  for (let y = Math.max(0, y0); y < Math.min(y1, height); y++) {
    for (let x = Math.max(0, x0); x < Math.min(x1, width); x++) {
      light += paper[y * width + x];
      total++;
    }
  }
  return total ? light / total : 0;
}

function findGlyphs(ink, red, width, height) {
  const queue = new Int32Array(ink.length);
  const maxHeight = Math.min(width, height) * .27;
  const result = [];
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start]) continue;
    let left = width, top = height, right = -1, bottom = -1, redCount = 0;
    let tail = 1;
    queue[0] = start;
    ink[start] = 0;
    for (let head = 0; head < tail; head++) {
      const i = queue[head];
      const x = i % width, y = (i / width) | 0;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      redCount += red[i];
      for (let dy = -1; dy <= 1; dy++) {
        if (y + dy < 0 || y + dy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (x + dx < 0 || x + dx >= width) continue;
          const next = i + dy * width + dx;
          if (!ink[next]) continue;
          ink[next] = 0;
          queue[tail++] = next;
        }
      }
    }
    const w = right - left + 1, h = bottom - top + 1;
    if (h < 6 || h > maxHeight || (w === 1 && h < 9) || w > h * 1.6 || tail < h * w * .12) continue;
    if (left === 0 || right === width - 1 || top === 0 || bottom === height - 1) continue;
    result.push({ x: left, y: top, right, bottom, w, h, red: redCount > tail * .35 });
  }
  // Busy backgrounds can contain hundreds of small components. Keep the clearest sizes first.
  return result.sort((a, b) => b.h - a.h).slice(0, 100);
}
