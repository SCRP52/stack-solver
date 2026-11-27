function centerOf(corner) {
  const { rank, suit, rotation: { cos, sin } } = corner;
  const x = (rank.x + rank.right + suit.x + suit.right) / 4;
  const y = (rank.y + rank.bottom + suit.y + suit.bottom) / 4;
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

function nearby(a, b) {
  const size = Math.max(a.rank.h, b.rank.h);
  const smaller = Math.min(a.rank.h, b.rank.h);
  if (smaller < size * .62) return false;
  const first = centerOf(a), second = centerOf(b);
  return Math.hypot(first.x - second.x, first.y - second.y) <= size * 2;
}

// A clear seam inside the visible face of a card means another card covers it.
export function hasCoveringEdge({ gray, width, height }, corner) {
  const { rank, suit, rotation: { cos, sin } } = corner;
  const left = Math.min(rank.x, suit.x), right = Math.max(rank.right, suit.right);
  const size = rank.h;
  if (size < 8) return false;

  function grayAt(x, y) {
    const u = Math.round(x * cos - y * sin), v = Math.round(x * sin + y * cos);
    return u >= 0 && u < width && v >= 0 && v < height ? gray[v * width + u] : -1;
  }

  const trim = Math.max(2, Math.round(size * .15));
  const reach = Math.max(trim + 2, Math.round(size * .76));
  const verticalStart = rank.y - Math.round(size * .55);
  const verticalEnd = suit.bottom + Math.round(size * .21);
  const aboveRank = rank.y - 1;
  const across = (side, at) => {
    const outer = side > 0 ? left : right;
    return side * (at - outer) < -1;
  };

  // Check both sides when a symmetric glyph does not say whether the camera is mirrored.
  const directions = corner.mirrored === null ? [1, -1] : [corner.mirrored ? -1 : 1];
  for (const side of directions) {
    const inner = side > 0 ? right : left;
    if (corner.mirrored !== null &&
        hasSeam(grayAt, true, inner, side, trim, reach, verticalStart, verticalEnd, value => value <= aboveRank)) {
      return true;
    }
    const horizontalStart = left - Math.round(size * (side > 0 ? .52 : 1.24));
    const horizontalEnd = right + Math.round(size * (side > 0 ? 1.24 : .52));
    if (hasSeam(grayAt, false, suit.bottom, 1, trim, reach, horizontalStart, horizontalEnd, value => across(side, value))) {
      return true;
    }
  }
  return false;
}

function hasSeam(grayAt, vertical, origin, direction, trim, reach, start, end, isBlankMargin) {
  const middle = (start + end) / 2;
  const sample = vertical ? grayAt : (along, cross) => grayAt(cross, along);
  for (let offset = trim; offset <= reach; offset++) {
    for (const slope of [0, -.16, .16]) {
      let hits = 0, available = 0, lightPairs = 0, marginHits = 0, marginAvailable = 0;
      for (let cross = start; cross <= end; cross += 2) {
        const line = origin + direction * offset + (cross - middle) * slope;
        const left = sample(line - 3, cross), right = sample(line + 3, cross);
        const edge = Math.min(sample(line - 1, cross), sample(line, cross), sample(line + 1, cross));
        if (left < 0 || right < 0 || edge < 0) continue;
        available++;
        if (Math.min(left, right) < 108) continue;
        lightPairs++;
        const blankMargin = isBlankMargin(cross);
        if (blankMargin) marginAvailable++;
        // Accept a thin shadow or a brightness step between two light pieces of card.
        const contrast = Math.min(left, right) - edge;
        const step = Math.abs(left - right);
        if (contrast < 15 && step < 17) continue;
        hits++;
        if (blankMargin) marginHits++;
      }
      if (available >= 8 && lightPairs >= available * .7 &&
          marginAvailable >= 2 && hits >= lightPairs * .78 && marginHits >= marginAvailable * .70) {
        return true;
      }
    }
  }
  return false;
}

export function choosePacketFace(reads, frame) {
  const ordered = [...reads].sort((a, b) => b.score - a.score);
  const visible = [], covered = [];
  for (const read of ordered) {
    const group = hasCoveringEdge(frame, read.corner) ? covered : visible;
    group.push(read);
  }
  const best = visible[0];
  if (!best) return { best: null, ambiguous: covered.length > 0 };
  const competes = visible.some(read => (
    (read.card.rank !== best.card.rank || read.card.suit !== best.card.suit) &&
    nearby(read.corner, best.corner)
  ));
  return { best: competes ? null : best, ambiguous: competes };
}
