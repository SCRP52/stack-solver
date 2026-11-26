export function meanPixelDifference(previous, current) {
  if (!previous || !current || previous.length !== current.length || !current.length) return Infinity;
  let difference = 0;
  for (let i = 0; i < current.length; i++) difference += Math.abs(current[i] - previous[i]);
  return difference / current.length;
}

export function createStableCardGate({ maxMotion = 7, minFrames = 3, minDuration = 500 } = {}) {
  let candidateKey = '';
  let candidateSince = 0;
  let candidateFrames = 0;

  function reset() {
    candidateKey = '';
    candidateSince = 0;
    candidateFrames = 0;
  }

  return {
    update(card, motion, now) {
      if (!card || !Number.isFinite(motion) || motion > maxMotion) {
        reset();
        return null;
      }
      const key = `${card.rank}${card.suit}`;
      if (key !== candidateKey) {
        candidateKey = key;
        candidateSince = now;
        candidateFrames = 1;
      } else candidateFrames++;
      return candidateFrames >= minFrames && now - candidateSince >= minDuration ? card : null;
    },
    reset,
  };
}
