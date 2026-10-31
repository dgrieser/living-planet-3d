/**
 * The global geoid: EGM2008 undulations N on a 0.5° grid (public/earth, built by
 * tools/earth-pipeline/build-geoid.mjs). Terrain heights from Mapterhorn and GEBCO are heights above mean
 * sea level; adding N turns them into heights above the WGS84 ellipsoid, the runtime's one height system
 * (docs/earth-sim/02 §8). The shader needs N too – to know where the sea surface is – so the grid also
 * comes as a small half-float texture.
 *
 * In the hero areas Mapterhorn carries the national heights (DHHN2016 in Lübbecke, DVR90 on Fanø), whose
 * references differ from EGM2008 by 0.2–0.3 m – on Fanø's flats that would move the waterline by hundreds
 * of metres. There the national grids (data/heroGeoids.js) take over, blended in over the box edge
 * (regions.js `heroWeight`); they travel as residuals to EGM2008, small enough for half floats.
 */
import * as THREE from 'three/webgpu';
import { GLOBAL_GEOID, parseGeoidI16 } from '../geodesy.js';
import { HERO_GEOIDS, HERO_GEOIDS_FILE } from './heroGeoids.js';
import { HERO_BOXES } from '../places.js';
import { heroWeight } from '../regions.js';

/** A flat geoid (N = 0 everywhere) – used until the grid has loaded, or when it cannot be loaded. */
const FLAT = { values: new Float32Array(GLOBAL_GEOID.rows * GLOBAL_GEOID.cols) };

/** Bilinear value of a small node grid (south row first), clamped at its edges. */
function sampleNodes(g, values, latDeg, lonDeg) {
  const fx = Math.min(Math.max((lonDeg - g.lon0) / g.dLon, 0), g.cols - 1);
  const fy = Math.min(Math.max((latDeg - g.lat0) / g.dLat, 0), g.rows - 1);
  const x0 = Math.min(Math.floor(fx), g.cols - 2);
  const y0 = Math.min(Math.floor(fy), g.rows - 2);
  const tx = fx - x0;
  const ty = fy - y0;
  const i = y0 * g.cols + x0;
  return (values[i] * (1 - tx) + values[i + 1] * tx) * (1 - ty) + (values[i + g.cols] * (1 - tx) + values[i + g.cols + 1] * tx) * ty;
}

/** Fast bilinear N (m) on the global grid, without allocations (called once per terrain texel). */
export function sampleGlobalGeoid(values, latDeg, lonDeg) {
  const { rows, cols, dLat, dLon, lat0, lon0 } = GLOBAL_GEOID;
  let fx = (lonDeg - lon0) / dLon;
  fx -= Math.floor(fx / cols) * cols;
  const fy = Math.min(Math.max((latDeg - lat0) / dLat, 0), rows - 1);
  const x0 = Math.floor(fx) % cols;
  const x1 = (x0 + 1) % cols;
  const y0 = Math.min(Math.floor(fy), rows - 2);
  const tx = fx - Math.floor(fx);
  const ty = fy - y0;
  const r0 = y0 * cols;
  const r1 = r0 + cols;
  return (values[r0 + x0] * (1 - tx) + values[r0 + x1] * tx) * (1 - ty) + (values[r1 + x0] * (1 - tx) + values[r1 + x1] * tx) * ty;
}

/**
 * Loads the grid. `ready` resolves when it is in (or failed – then N stays 0, as in M0); `sample` and the
 * texture work from the start.
 */
export function createGeoid({ baseUrl }) {
  let values = FLAT.values;
  const half = new Uint16Array(GLOBAL_GEOID.rows * GLOBAL_GEOID.cols);
  const texture = new THREE.DataTexture(half, GLOBAL_GEOID.cols, GLOBAL_GEOID.rows, THREE.RedFormat, THREE.HalfFloatType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  let failed = false;
  const heroes = HERO_GEOIDS.map((g) => {
    const residual = new Float32Array(g.rows * g.cols);
    const nodeValues = null; // filled from public/earth/hero-geoids.json
    const tex = new THREE.DataTexture(new Uint16Array(g.rows * g.cols), g.cols, g.rows, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return { ...g, box: HERO_BOXES[g.id], values: nodeValues, residual, texture: tex };
  });
  // national value − global value at every node of a hero grid (valid once the global grid is in)
  const buildResiduals = () => {
    for (const h of heroes) {
      if (!h.values || h.values.length !== h.rows * h.cols) continue;
      for (let r = 0; r < h.rows; r++) {
        for (let c = 0; c < h.cols; c++) {
          const i = r * h.cols + c;
          h.residual[i] = h.values[i] - sampleGlobalGeoid(values, h.lat0 + r * h.dLat, h.lon0 + c * h.dLon);
          h.texture.image.data[i] = THREE.DataUtils.toHalfFloat(h.residual[i]);
        }
      }
      h.texture.needsUpdate = true;
    }
  };

  const heroValues = fetch(`${baseUrl}${HERO_GEOIDS_FILE}`)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((json) => {
      for (const h of heroes) h.values = json[h.id] ?? null;
    })
    .catch((err) => console.warn('[earth] national height references unavailable, EGM2008 everywhere:', err?.message ?? err));
  const ready = Promise.all([
    fetch(`${baseUrl}${GLOBAL_GEOID.file}`).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    }),
    heroValues,
  ])
    .then(([buffer]) => {
      values = parseGeoidI16(buffer).values;
      for (let i = 0; i < values.length; i++) half[i] = THREE.DataUtils.toHalfFloat(values[i]);
      texture.needsUpdate = true;
      buildResiduals();
    })
    .catch((err) => {
      failed = true;
      console.warn('[earth] geoid grid unavailable, heights stay above sea level:', err?.message ?? err);
    });

  return {
    ready,
    texture,
    get failed() {
      return failed;
    },
    heroes,
    /** N (m) at a geodetic position in degrees – the national reference inside the hero boxes. */
    sample(latDeg, lonDeg) {
      let n = sampleGlobalGeoid(values, latDeg, lonDeg);
      if (failed) return n;
      for (const h of heroes) {
        if (latDeg < h.lat0 || lonDeg < h.lon0 || latDeg > h.lat0 + (h.rows - 1) * h.dLat || lonDeg > h.lon0 + (h.cols - 1) * h.dLon) continue;
        const w = heroWeight(h.box, latDeg, lonDeg);
        if (w > 0) n += w * sampleNodes(h, h.residual, latDeg, lonDeg);
      }
      return n;
    },
    get values() {
      return values;
    },
    dispose() {
      texture.dispose();
      for (const h of heroes) h.texture.dispose();
    },
  };
}
