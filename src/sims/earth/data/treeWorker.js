/**
 * Finds the trees of one cell off the main thread: canopy heights (Float32, row 0 north) and the
 * leaf-off colour-infrared image of the same extent in, tree tops with height, crown radius and species
 * group out (positions in metres east/north from the cell's south-west corner).
 */
import { detectTrees, isConifer } from './trees.js';

self.onmessage = (ev) => {
  const { id, chm, w, h, res, cir, cw, ch } = ev.data;
  try {
    const trees = detectTrees(chm, w, h, res);
    const n = trees.length;
    const east = new Float32Array(n);
    const north = new Float32Array(n);
    const height = new Float32Array(n);
    const radius = new Float32Array(n);
    const conifer = new Uint8Array(n);
    trees.forEach((t, i) => {
      east[i] = (t.x + 0.5) * res;
      north[i] = (h - t.y - 0.5) * res;
      height[i] = t.height;
      radius[i] = t.radius;
      if (cir) {
        const cx = Math.min(cw - 1, Math.floor(((t.x + 0.5) / w) * cw));
        const cy = Math.min(ch - 1, Math.floor(((t.y + 0.5) / h) * ch));
        const k = (cy * cw + cx) * 4;
        conifer[i] = isConifer(cir[k], cir[k + 1]) ? 1 : 0;
      }
    });
    self.postMessage({ id, result: { east, north, height, radius, conifer } }, [east.buffer, north.buffer, height.buffer, radius.buffer, conifer.buffer]);
  } catch (err) {
    self.postMessage({ id, error: err?.message ?? String(err) });
  }
};
