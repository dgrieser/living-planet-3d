/**
 * Cutting an imagery tile out of its parent when the source has no deeper level (EOX ends at z15, the hero
 * relief goes to z17). Each child takes its square of the parent and enlarges it with a separable
 * Catmull–Rom filter that reads the parent's pixels across the child's edges – cropping first and
 * enlarging the crop (what createImageBitmap's resize does) leaves a visible seam between neighbouring
 * children, because neither side can see the other's pixels. Pure function (scripts/check-earth-hero.mjs).
 */

function catmullRom(t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    (-t3 + 2 * t2 - t) / 2,
    (3 * t3 - 5 * t2 + 2) / 2,
    (-3 * t3 + 4 * t2 + t) / 2,
    (t3 - t2) / 2,
  ];
}

/**
 * Taps along one axis: for each of `out` output pixels the four source indices (clamped to the parent) and
 * their weights, for the output square starting at source pixel `origin` and `span` source pixels wide.
 */
function taps(origin, span, out, limit) {
  const idx = new Int32Array(out * 4);
  const w = new Float32Array(out * 4);
  for (let i = 0; i < out; i++) {
    const s = origin + ((i + 0.5) * span) / out - 0.5;
    const s0 = Math.floor(s);
    const k = catmullRom(s - s0);
    for (let j = 0; j < 4; j++) {
      idx[i * 4 + j] = Math.min(limit - 1, Math.max(0, s0 - 1 + j));
      w[i * 4 + j] = k[j];
    }
  }
  return { idx, w };
}

/**
 * @param {Uint8ClampedArray|Uint8Array} src parent RGBA pixels (width × height)
 * @param {number} ox,oy,span the child's square in parent pixels
 * @param {number} out output size (pixels per side)
 * @returns {Uint8ClampedArray} out × out RGBA
 */
export function enlargeTile(src, width, height, ox, oy, span, out = 256) {
  const tx = taps(ox, span, out, width);
  const ty = taps(oy, span, out, height);
  // the parent rows the vertical taps read
  const r0 = ty.idx.reduce((a, b) => Math.min(a, b), height);
  const r1 = ty.idx.reduce((a, b) => Math.max(a, b), 0);
  const rows = r1 - r0 + 1;
  // horizontal pass: those rows at the output's width
  const mid = new Float32Array(rows * out * 4);
  for (let r = 0; r < rows; r++) {
    const row = (r0 + r) * width * 4;
    for (let i = 0; i < out; i++) {
      let a = 0;
      let b = 0;
      let c = 0;
      let d = 0;
      for (let j = 0; j < 4; j++) {
        const p = row + tx.idx[i * 4 + j] * 4;
        const k = tx.w[i * 4 + j];
        a += src[p] * k;
        b += src[p + 1] * k;
        c += src[p + 2] * k;
        d += src[p + 3] * k;
      }
      const m = (r * out + i) * 4;
      mid[m] = a;
      mid[m + 1] = b;
      mid[m + 2] = c;
      mid[m + 3] = d;
    }
  }
  // vertical pass
  const dst = new Uint8ClampedArray(out * out * 4);
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      let a = 0;
      let b = 0;
      let c = 0;
      let d = 0;
      for (let j = 0; j < 4; j++) {
        const m = ((ty.idx[y * 4 + j] - r0) * out + x) * 4;
        const k = ty.w[y * 4 + j];
        a += mid[m] * k;
        b += mid[m + 1] * k;
        c += mid[m + 2] * k;
        d += mid[m + 3] * k;
      }
      const o = (y * out + x) * 4;
      dst[o] = a;
      dst[o + 1] = b;
      dst[o + 2] = c;
      dst[o + 3] = d;
    }
  }
  return dst;
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/**
 * Lookup tables (one per channel, sRGB byte → sRGB byte) that scale the linear colour by `gains` – the
 * colour calibration of one imagery source against another (regions.js NRW_DOP_GAIN).
 */
export function gainTables(gains) {
  return gains.map((g) => {
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.round(255 * toSrgb(Math.min(1, toLinear(v / 255) * g)));
    return lut;
  });
}

/** Applies `gainTables` to RGBA pixels in place (alpha untouched). */
export function applyGain(pixels, tables) {
  const [r, g, b] = tables;
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = r[pixels[i]];
    pixels[i + 1] = g[pixels[i + 1]];
    pixels[i + 2] = b[pixels[i + 2]];
  }
  return pixels;
}
