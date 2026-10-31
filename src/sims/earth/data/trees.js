/**
 * Single trees from a canopy height model (milestone M4, docs/earth-sim/06): NRW publishes its normalised
 * surface model (nDOM – height above ground of everything, from the 2023 laser scan and image matching)
 * as a CORS-open WCS, so the trees around the camera are found in the browser:
 *
 *  1. smooth the heights a little (3 × 3), so a single branch does not make a second top;
 *  2. a tree top is a pixel ≥ 3 m that is the unique maximum within a window that grows with its height
 *     (crowns of tall trees are wider – a variable window, Popescu & Wynne 2004);
 *  3. reject flat tops: roofs are plateaus – too many neighbours at the same height – or stay level towards
 *     their inside (ridges, corners), and a crown needs a drop towards its edge (prominence);
 *  4. crown radius: where the heights fall below 60 % of the top, averaged over eight directions.
 *
 * Species group from the leaf-off colour-infrared orthophoto (iDOP, March 2025): in early spring conifers
 * keep their needles and show bright in near infrared, broadleaved trees are bare. Pure functions, checked
 * by scripts/check-earth-trees.mjs.
 */

export const TREE_DETECTION = Object.freeze({ minHeight: 3, maxHeight: 50, plateauShare: 0.45, prominence: 0.6 });

/** 3 × 3 box smoothing (edges clamped). */
export function smooth3(src, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(w - 1, x + 1);
      let s = 0;
      let n = 0;
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const v = src[yy * w + xx];
          if (Number.isFinite(v)) {
            s += v;
            n++;
          }
        }
      }
      out[y * w + x] = n ? s / n : 0;
    }
  }
  return out;
}

/** Search radius (m) for a top of height h: small trees need a small window, tall ones a wide one. */
export const windowRadius = (h) => Math.min(6, Math.max(1.5, 0.8 + 0.09 * h));

/**
 * Tree tops in a canopy height model.
 * @param {Float32Array} chm heights above ground (m), row 0 = north
 * @param {number} w @param {number} h raster size
 * @param {number} res pixel size (m)
 * @returns {Array<{ x: number, y: number, height: number, radius: number }>} x, y in pixels (row 0 north)
 */
export function detectTrees(chm, w, h, res, opts = TREE_DETECTION) {
  const s = smooth3(chm, w, h);
  const trees = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const v = s[y * w + x];
      if (v < opts.minHeight * 0.7 || v > opts.maxHeight) continue;
      // quick reject: not even a 3 × 3 maximum
      if (v < s[y * w + x - 1] || v < s[y * w + x + 1] || v < s[(y - 1) * w + x] || v < s[(y + 1) * w + x]) continue;
      const r = Math.max(1, Math.round(windowRadius(v) / res));
      let isMax = true;
      let same = 0;
      let count = 0;
      let ring = 0;
      let ringN = 0;
      for (let dy = -r; dy <= r && isMax; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 > r * r || (dx === 0 && dy === 0)) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const u = s[yy * w + xx];
          // ties: the first pixel in scan order wins, so a flat top gives one tree at most
          if (u > v || (u === v && (dy < 0 || (dy === 0 && dx < 0)))) {
            isMax = false;
            break;
          }
          count++;
          if (v - u < 0.15) same++;
          if (d2 >= (r - 1) * (r - 1)) {
            ring += u;
            ringN++;
          }
        }
      }
      if (!isMax || count === 0) continue;
      if (same / count > opts.plateauShare) continue; // a roof or a hedge top, not a crown
      if (ringN && v - ring / ringN < opts.prominence) continue;
      // roofs stay level towards their inside (a ridge along it, a corner into two sides); a crown falls off
      // all round: reject tops that are level in two or more of eight directions two metres out
      const step2 = Math.max(1, Math.round(2 / res));
      let level = 0;
      for (let k = 0; k < 8; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + Math.round(Math.cos((k * Math.PI) / 4) * step2)));
        const yy = Math.min(h - 1, Math.max(0, y + Math.round(Math.sin((k * Math.PI) / 4) * step2)));
        if (v - s[yy * w + xx] < 0.25) level++;
      }
      if (level >= 2) continue;
      // crown radius: where the canopy falls below 60 % of the top, in eight directions
      let rs = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        const cx = Math.cos(a);
        const cy = Math.sin(a);
        let d = 1;
        const maxD = Math.round((0.35 * v + 1) / res);
        while (d < maxD) {
          const xx = Math.round(x + cx * d);
          const yy = Math.round(y + cy * d);
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || s[yy * w + xx] < 0.6 * v) break;
          d++;
        }
        rs += d * res;
      }
      // the smoothing lowers small crowns: report the highest raw pixel next to the top
      let top = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const u = chm[(y + dy) * w + x + dx];
          if (u > top) top = u;
        }
      }
      if (top < opts.minHeight) continue;
      trees.push({ x, y, height: top, radius: Math.max(0.8, Math.min(rs / 8, 0.35 * top + 1)) });
    }
  }
  return trees;
}

/**
 * Conifer or broadleaf from a leaf-off colour-infrared pixel (R = near infrared, G = red, B = green):
 * evergreen needles reflect near infrared strongly in March, bare broadleaved crowns do not.
 */
export function isConifer(nir, red) {
  return (nir - red) / Math.max(1, nir + red) > 0.18 && nir > 70;
}
