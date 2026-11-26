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
    if (Math.max(r, g, b) - Math.min(r, g, b) <= 65 && brightness >= 90) {
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
  let warmBias = 0, brightSamples = 0;
  for (let i = 0; i < gray.length; i++) {
    if (!paper[i] || gray[i] < highlight * .88) continue;
    warmBias += data[i * 4] - data[i * 4 + 1];
    brightSamples++;
  }
  const redLimit = Math.max(18, warmBias / Math.max(1, brightSamples) + 23);
  const ink = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    red[i] = Number(r - g > redLimit && r > b * 1.13 && g < 170);
    ink[i] = Number(gray[i] < darkLimit || red[i]);
    if (gray[i] < lightLimit || red[i]) paper[i] = 0;
  }

  const glyphs = findGlyphs(ink.slice(), red, width, height);
  const corners = new Map();
  for (const rotation of searchRotations) {
    const viewGlyphs = glyphs.map(glyph => projectGlyph(glyph, width, rotation));
    for (const corner of findUprightCorners(viewGlyphs, paper, width, height, rotation)) {
      const key = `${corner.rank.id}/${corner.suit.id}`;
      if (!corners.has(key) || corner.quality > corners.get(key).quality) corners.set(key, corner);
    }
  }
  const ordered = [...corners.values()].sort((a, b) => b.quality - a.quality);
  return { corners: ordered.slice(0, 12), paper: true, gray, ink };
}

export function cardRotation(angle) {
  return { angle, cos: Math.cos(angle), sin: Math.sin(angle) };
}

const searchRotations = Array.from({ length: 16 }, (_, index) => cardRotation(index * Math.PI / 8));

export function projectGlyph(glyph, frameWidth, { cos, sin }) {
  if (sin === 0 && cos === 1 && !glyph.parts) return glyph;
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const part of glyph.parts ?? [glyph]) {
    for (const i of part.pixels) {
      const sourceX = i % frameWidth, sourceY = (i / frameWidth) | 0;
      const viewX = Math.round(sourceX * cos + sourceY * sin);
      const viewY = Math.round(-sourceX * sin + sourceY * cos);
      x = Math.min(x, viewX);
      y = Math.min(y, viewY);
      right = Math.max(right, viewX);
      bottom = Math.max(bottom, viewY);
    }
  }
  return { ...glyph, x, y, right, bottom, w: right - x + 1, h: bottom - y + 1 };
}

function findUprightCorners(glyphs, paper, width, height, rotation) {
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
      doubleRanks.push({
        id: `${one.id}+${zero.id}`, parts: [one, zero],
        x, y, right, bottom, w, h, red: one.red, double: true,
      });
      if (one.w < one.h * .29) {
        digitParts.add(one);
        digitParts.add(zero);
      }
    }
  }

  const ranks = [...doubleRanks, ...glyphs.filter(glyph => !digitParts.has(glyph) && glyph.w >= glyph.h * .25)];
  const corners = [];
  const frameX = (width - 1) / 2, frameY = (height - 1) / 2;
  const { cos, sin } = rotation;
  const lightAt = (x0, y0, x1, y1) => lightFraction(paper, width, height, rotation, x0, y0, x1, y1);
  for (const rank of ranks) for (const suit of glyphs) {
    if (rank.id === suit.id || suit.w < suit.h * .43 || suit.w > suit.h * 1.5) continue;
    const gap = suit.y - rank.bottom - 1;
    if (gap < -rank.h * .1 || gap > rank.h * .83 || suit.h < rank.h * .39 || suit.h > rank.h * 1.13) continue;
    const dx = Math.abs((rank.x + rank.right - suit.x - suit.right) / 2);
    if (dx > rank.h * (rank.double ? .54 : .43)) continue;

    const left = Math.min(rank.x, suit.x), right = Math.max(rank.right, suit.right);
    const x = (left + right) / 2, y = (rank.y + suit.bottom) / 2;
    const centerDistance = Math.hypot((x * cos - y * sin - frameX) / width, (x * sin + y * cos - frameY) / height);
    const margin = Math.max(2, Math.round(rank.h * .21));
    const sides = [
      lightAt(left - margin, rank.y, left, suit.bottom + 1),
      lightAt(right + 1, rank.y, right + margin + 1, suit.bottom + 1),
      lightAt(left, rank.y - margin, right + 1, rank.y),
      lightAt(left, suit.bottom + 1, right + 1, suit.bottom + margin + 1),
    ];
    const light = sides.reduce((sum, fraction) => sum + fraction, 0) / sides.length;
    if (light < .68 || Math.min(sides[0], sides[1]) < .38) continue;

    const edgeOffset = Math.max(4, Math.round(rank.h * .85));
    const edgeWidths = Math.max(2, Math.round(rank.h * .3));
    const leftEdge = lightAt(left - edgeOffset - edgeWidths, rank.y, left - edgeOffset, suit.bottom + 1);
    const rightEdge = lightAt(right + edgeOffset + 1, rank.y, right + edgeOffset + edgeWidths + 1, suit.bottom + 1);
    const upperEdge = lightAt(left, rank.y - edgeOffset - edgeWidths, right + 1, rank.y - edgeOffset);
    // Prefer the printed index near an outer edge, ahead of a similar shape in face artwork.
    const quality = light * .36 - centerDistance * .4 - dx / rank.h * .44 +
      (1 - Math.min(leftEdge, rightEdge)) * .19 + (1 - upperEdge) * .07 +
      (rank.double ? .04 : 0) - (rank.red !== suit.red ? .085 : 0);
    corners.push({ rank, suit, rotation, quality, leftEdge, rightEdge, upperEdge });
  }
  return corners;
}

function lightFraction(paper, width, height, { cos, sin }, x0, y0, x1, y1) {
  let light = 0, total = 0;
  const stride = (x1 - x0) * (y1 - y0) > 120 ? 2 : 1;
  for (let y = y0; y < y1; y += stride) {
    for (let x = x0; x < x1; x += stride) {
      const sourceX = Math.round(x * cos - y * sin);
      const sourceY = Math.round(x * sin + y * cos);
      if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height) continue;
      light += paper[sourceY * width + sourceX];
      total++;
    }
  }
  return total ? light / total : 0;
}

function findGlyphs(ink, red, width, height) {
  const queue = new Int32Array(ink.length);
  const maxSide = Math.min(width, height) * .33;
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
    const long = Math.max(w, h), short = Math.min(w, h);
    if (long < 6 || long > maxSide || (short === 1 && long < 9) || tail < h * w * .12) continue;
    if (left === 0 || right === width - 1 || top === 0 || bottom === height - 1) continue;
    result.push({ id: start, x: left, y: top, right, bottom, w, h, red: redCount > tail * .35, pixels: queue.slice(0, tail) });
  }
  // Busy backgrounds can contain hundreds of small components. Keep the clearest sizes first.
  return result.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h)).slice(0, 80);
}
