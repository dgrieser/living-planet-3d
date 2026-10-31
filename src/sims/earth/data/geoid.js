/**
 * The global geoid: EGM2008 undulations N on a 0.5° grid (public/earth, built by
 * tools/earth-pipeline/build-geoid.mjs). Terrain heights from Mapterhorn and GEBCO are heights above mean
 * sea level; adding N turns them into heights above the WGS84 ellipsoid, the runtime's one height system
 * (docs/earth-sim/02 §8). The shader needs N too – to know where the sea surface is – so the grid also
 * comes as a small half-float texture.
 */
import * as THREE from 'three/webgpu';
import { GLOBAL_GEOID, parseGeoidI16 } from '../geodesy.js';

/** A flat geoid (N = 0 everywhere) – used until the grid has loaded, or when it cannot be loaded. */
const FLAT = { values: new Float32Array(GLOBAL_GEOID.rows * GLOBAL_GEOID.cols) };

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

  const ready = fetch(`${baseUrl}${GLOBAL_GEOID.file}`)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    })
    .then((buffer) => {
      values = parseGeoidI16(buffer).values;
      for (let i = 0; i < values.length; i++) half[i] = THREE.DataUtils.toHalfFloat(values[i]);
      texture.needsUpdate = true;
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
    /** N (m) at a geodetic position in degrees. */
    sample(latDeg, lonDeg) {
      return sampleGlobalGeoid(values, latDeg, lonDeg);
    },
    get values() {
      return values;
    },
    dispose() {
      texture.dispose();
    },
  };
}
