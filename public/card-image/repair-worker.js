import { repairImageData } from './repair.js';

self.onmessage = ({ data: { width, height, rgba, recipe } }) => {
  try {
    const result = repairImageData({ width, height, data: rgba }, recipe);
    self.postMessage(result, [result.patch.buffer, ...Object.values(result.emblems).map(({ pixels }) => pixels.buffer)]);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
