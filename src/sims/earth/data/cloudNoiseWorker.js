/** Builds the tileable cloud noise volume (render/cloudNoise.js) off the main thread – about half a second. */
import { generateCloudNoise } from '../render/cloudNoise.js';

self.onmessage = (ev) => {
  const { size = 64 } = ev.data ?? {};
  const data = generateCloudNoise(size);
  self.postMessage({ data, size }, [data.buffer]);
};
