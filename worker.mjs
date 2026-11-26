import { solve } from './solver.mjs?v=32';

self.onmessage = ({ data }) => {
  try {
    self.postMessage(solve(data.start, data.target, data.options, data.limits, message => self.postMessage(message), data.size));
  } catch (error) {
    self.postMessage({ type: 'error', code: error.code, parameters: error.parameters, message: error.message });
  }
};
