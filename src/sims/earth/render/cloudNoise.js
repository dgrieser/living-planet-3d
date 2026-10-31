/**
 * Tileable 3D noise for the volumetric clouds (docs/earth-sim/08 §4, after Schneider 2015, *The real-time
 * volumetric cloudscapes of Horizon Zero Dawn*): one RGBA8 volume of size³ voxels that repeats seamlessly.
 *
 *  R  Perlin–Worley: low-frequency Perlin fBm dilated by inverted Worley cells – billowy cloud bodies –,
 *     histogram-equalised (a cover c thresholds it at 1 − c and makes the fraction c cloud);
 *  G  inverted Worley fBm at 4 cells per tile (cauliflower turrets);
 *  B  inverted Worley fBm at 8 cells per tile;
 *  A  inverted Worley fBm at 16 cells per tile (the finest erosion at the cloud edges).
 *
 * Pure function (built in a worker at start-up, checked by scripts/check-earth-weather.mjs for seamless
 * tiling and range).
 */

function hash(i, j, k, seed) {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x1b873593) ^ Math.imul(seed, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const mod = (a, n) => ((a % n) + n) % n;
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const GRAD = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1],
  [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

/** Gradient noise with period p lattice cells on every axis; about −1…1. */
function perlin(x, y, z, p, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const dot = (i, j, k) => {
    const g = GRAD[Math.floor(hash(mod(xi + i, p), mod(yi + j, p), mod(zi + k, p), seed) * 12)];
    return g[0] * (fx - i) + g[1] * (fy - j) + g[2] * (fz - k);
  };
  const u = fade(fx);
  const v = fade(fy);
  const w = fade(fz);
  const lerp = (a, b, t) => a + (b - a) * t;
  return lerp(
    lerp(lerp(dot(0, 0, 0), dot(1, 0, 0), u), lerp(dot(0, 1, 0), dot(1, 1, 0), u), v),
    lerp(lerp(dot(0, 0, 1), dot(1, 0, 1), u), lerp(dot(0, 1, 1), dot(1, 1, 1), u), v),
    w,
  );
}

/** Inverted cellular noise: 1 at a feature point, 0 a cell width away; n cells per tile, wrapping. */
function worley(x, y, z, n, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  let best = 9;
  for (let k = -1; k <= 1; k++) {
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = xi + i;
        const cy = yi + j;
        const cz = zi + k;
        const wx = mod(cx, n);
        const wy = mod(cy, n);
        const wz = mod(cz, n);
        const px = cx + hash(wx, wy, wz, seed) - x;
        const py = cy + hash(wx, wy, wz, seed + 1) - y;
        const pz = cz + hash(wx, wy, wz, seed + 2) - z;
        const d = px * px + py * py + pz * pz;
        if (d < best) best = d;
      }
    }
  }
  return Math.max(0, 1 - Math.sqrt(best));
}

function worleyFbm(u, v, w, cells, seed) {
  return worley(u * cells, v * cells, w * cells, cells, seed) * 0.625
    + worley(u * cells * 2, v * cells * 2, w * cells * 2, cells * 2, seed + 7) * 0.25
    + worley(u * cells * 4, v * cells * 4, w * cells * 4, cells * 4, seed + 13) * 0.125;
}

const remap = (x, a, b, c, d) => c + ((x - a) * (d - c)) / (b - a);
const sat = (x) => Math.min(1, Math.max(0, x));

/** @returns {Uint8Array} size³ × RGBA, x fastest, then y, then z */
export function generateCloudNoise(size = 64, seed = 1) {
  const out = new Uint8Array(size * size * size * 4);
  for (let z = 0; z < size; z++) {
    const w = (z + 0.5) / size;
    for (let y = 0; y < size; y++) {
      const v = (y + 0.5) / size;
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size;
        // Perlin fBm, 3 octaves from 4 cells per tile, mapped to 0…1
        let p = 0;
        let amp = 1;
        let norm = 0;
        for (let o = 0; o < 3; o++) {
          const f = 4 << o;
          p += perlin(u * f, v * f, w * f, f, seed + o) * amp;
          norm += amp;
          amp *= 0.5;
        }
        p = sat(p / norm * 0.85 + 0.5);
        const w4 = worleyFbm(u, v, w, 4, seed + 20);
        // dilate the Perlin field by the cells: billows where both agree
        const pw = sat(remap(p, w4 - 1, 1, 0, 1));
        const i = ((z * size + y) * size + x) * 4;
        out[i] = Math.round(255 * sat(remap(pw, 0.35, 0.95, 0, 1)));
        out[i + 1] = Math.round(255 * w4);
        out[i + 2] = Math.round(255 * worleyFbm(u, v, w, 8, seed + 40));
        out[i + 3] = Math.round(255 * worleyFbm(u, v, w, 16, seed + 60));
      }
    }
  }
  equalize(out, 0);
  return out;
}

/**
 * Histogram-equalises one channel in place, so its values are spread evenly over 0…255: then a cover c
 * thresholding the noise at 1 − c makes exactly the fraction c of a layer cloud.
 */
export function equalize(data, channel) {
  const hist = new Float64Array(256);
  for (let i = channel; i < data.length; i += 4) hist[data[i]]++;
  const lut = new Uint8Array(256);
  const n = data.length / 4;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    // the middle of the bin's share of the distribution
    lut[v] = Math.round(255 * Math.min(1, (acc + hist[v] / 2) / n));
    acc += hist[v];
  }
  for (let i = channel; i < data.length; i += 4) data[i] = lut[data[i]];
}
