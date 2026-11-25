import { solve } from './solver.mjs';

self.onmessage = ({ data }) => {
  try {
    self.postMessage(solve(data.start, data.target, data.options, data.limits, message => self.postMessage(message)));
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};
