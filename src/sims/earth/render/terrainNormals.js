/**
 * Relief normals of the terrain's height grids (render/globe.js), written per texel so the lighting follows
 * the grid and never the mesh's triangles (surface.js decodes them). Pure functions, checked by
 * scripts/check-earth-hero.mjs.
 */

export const EARTH_RADIUS = 6378137; // m (WGS84 a – the Web-Mercator tiling's sphere)

/**
 * Relief normals of a padded height grid (rows south → north, like the plugin's grids), per texel: central
 * differences in metres – a Web-Mercator texel is (2πa / 2^level / size) · cos φ wide in both directions –
 * as the unit normal's east and north components, companded (sign · √|n|, so gentle slopes keep their
 * precision in 8 bits) into an RG8 texture that surface.js decodes. Shading from the grid itself has no
 * facets: the mesh's 33 × 33 vertices only carry the shape. Writes rows r0…r1 and columns c0…c1.
 */
export function writeNormals(out, heights, pw, ph, y, level, heightScale, r0 = 0, r1 = ph - 1, c0 = 0, c1 = pw - 1) {
  const n = 2 ** level;
  const size = pw - 2;
  const texel = (2 * Math.PI * EARTH_RADIUS) / n / size;
  for (let r = r0; r <= r1; r++) {
    const ny = Math.min(Math.max((y + 1 - (r - 0.5) / size) / n, 0), 1);
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * ny)));
    const m = texel * Math.max(Math.cos(lat), 1e-3);
    const rd = r > 0 ? r - 1 : r;
    const ru = r < ph - 1 ? r + 1 : r;
    const sy = heightScale / ((ru - rd) * m);
    for (let c = c0; c <= c1; c++) {
      const cl = c > 0 ? c - 1 : c;
      const cr = c < pw - 1 ? c + 1 : c;
      const gx = ((heights[r * pw + cr] - heights[r * pw + cl]) * heightScale) / ((cr - cl) * m);
      const gy = (heights[ru * pw + c] - heights[rd * pw + c]) * sy;
      const inv = 1 / Math.sqrt(1 + gx * gx + gy * gy);
      const ex = -gx * inv;
      const ey = -gy * inv;
      const i = (r * pw + c) * 2;
      out[i] = Math.round(127.5 + 127.5 * Math.sign(ex) * Math.sqrt(Math.abs(ex)));
      out[i + 1] = Math.round(127.5 + 127.5 * Math.sign(ey) * Math.sqrt(Math.abs(ey)));
    }
  }
}

/** Rewrites the normals along the four edges of a grid (after its border took a neighbour's heights). */
export function writeEdgeNormals(out, heights, pw, ph, y, level, heightScale) {
  const d = 2;
  writeNormals(out, heights, pw, ph, y, level, heightScale, 0, d, 0, pw - 1);
  writeNormals(out, heights, pw, ph, y, level, heightScale, ph - 1 - d, ph - 1, 0, pw - 1);
  writeNormals(out, heights, pw, ph, y, level, heightScale, 0, ph - 1, 0, d);
  writeNormals(out, heights, pw, ph, y, level, heightScale, 0, ph - 1, pw - 1 - d, pw - 1);
}
