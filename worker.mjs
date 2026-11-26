import { defaults, displayCards, solve } from './solver.mjs?v=35';
import { createRouteVerifier } from './route-replay.mjs?v=35';

const cardPositions = entries => entries.map(([slot, token]) => [slot, displayCards(token)[0]]);

self.onmessage = ({ data }) => {
  try {
    const { start, target, options, size, limits } = data;
    const verify = createRouteVerifier({
      size,
      start: Array.isArray(start) ? null : displayCards(start),
      target: Array.isArray(target) ? null : displayCards(target),
      startPositions: Array.isArray(start) ? cardPositions(start) : null,
      targetPositions: Array.isArray(target) ? cardPositions(target) : null,
      options: { ...defaults, ...options },
    });
    const result = solve(start, target, options, limits, message =>
      self.postMessage(message.type === 'candidate' ? verify(message) : message), size);
    self.postMessage(verify(result));
  } catch (error) {
    self.postMessage({ type: 'error', code: error.code, parameters: error.parameters, message: error.message });
  }
};
