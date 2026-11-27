export function meanPixelDifference(previous, current) {
  if (!previous || !current || previous.length !== current.length || !current.length) return Infinity;
  let difference = 0;
  for (let i = 0; i < current.length; i++) difference += Math.abs(current[i] - previous[i]);
  return difference / current.length;
}

export function agreeOnCard(normal, mirrored) {
  if (normal && mirrored && (normal.rank !== mirrored.rank || normal.suit !== mirrored.suit)) return null;
  return normal ?? mirrored;
}

export function cardCornerPose({ rank, suit, rotation: { cos, sin } }) {
  const x = (rank.x + rank.right + suit.x + suit.right) / 4;
  const y = (rank.y + rank.bottom + suit.y + suit.bottom) / 4;
  const dx = (suit.x + suit.right - rank.x - rank.right) / 2;
  const dy = (suit.y + suit.bottom - rank.y - rank.bottom) / 2;
  const span = Math.hypot(dx, dy);
  return {
    x: x * cos - y * sin, y: x * sin + y * cos,
    downX: (dx * cos - dy * sin) / span, downY: (dx * sin + dy * cos) / span, span,
  };
}

export function alignedCornerMotion(previous, current, { width, height }, from, to) {
  if (!from?.span || !to.span || previous?.length !== current.length) return Infinity;
  const shiftLimit = Math.max(9, Math.min(32, from.span * .7));
  const scale = to.span / from.span;
  if (Math.hypot(to.x - from.x, to.y - from.y) > shiftLimit ||
      scale < .77 || scale > 1.30 ||
      from.downX * to.downX + from.downY * to.downY < .95) return Infinity;

  function sample(pixels, pose, across, down) {
    const x = Math.round(pose.x + pose.span * (across * pose.downY + down * pose.downX));
    const y = Math.round(pose.y + pose.span * (down * pose.downY - across * pose.downX));
    return x >= 0 && x < width && y >= 0 && y < height ? pixels[y * width + x] : -1;
  }

  let difference = 0, samples = 0;
  for (let row = -12; row <= 12; row++) {
    for (let col = -7; col <= 7; col++) {
      const first = sample(previous, from, col / 12, row / 12);
      const second = sample(current, to, col / 12, row / 12);
      if (first < 0 || second < 0) continue;
      difference += Math.abs(first - second);
      samples++;
    }
  }
  return samples >= 200 ? difference / samples : Infinity;
}

export function createStableCardGate({ maxMotion = 7, minFrames = 3, minDuration = 200, maxGap = 170 } = {}) {
  let candidateKey = '';
  let candidateSince = 0;
  let candidateFrames = 0;
  let origin;
  let lastSeen;
  let missed;
  let accepted;

  function reset() {
    candidateKey = '';
    candidateSince = 0;
    candidateFrames = 0;
    origin = undefined;
    lastSeen = undefined;
    missed = false;
    accepted = null;
  }

  return {
    update(card, motion, now, { pose, allowMiss = false } = {}) {
      if (!card) {
        if (allowMiss && candidateKey && !missed && now - lastSeen <= maxGap) {
          missed = true;
          return accepted;
        }
        reset();
        return null;
      }
      const key = `${card.rank}${card.suit}`;
      const movedDuringCapture = !accepted && origin && pose &&
        Math.hypot(origin.x - pose.x, origin.y - pose.y) > Math.max(18, Math.min(44, origin.span));
      if (key !== candidateKey || (missed && now - lastSeen > maxGap) ||
          !Number.isFinite(motion) || motion > maxMotion || movedDuringCapture) {
        reset();
        candidateKey = key;
        candidateSince = now;
        origin = pose;
      }
      lastSeen = now;
      missed = false;
      candidateFrames++;
      accepted = candidateFrames >= minFrames && now - candidateSince >= minDuration ? card : null;
      return accepted;
    },
    reset,
  };
}
