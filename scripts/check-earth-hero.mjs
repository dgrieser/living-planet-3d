// Checks the hero-area plumbing of the Living Earth (milestone M2): which tiles refine past the global
// levels (regions.js), where the NRW orthophotos are read, the blend weight of the national height
// references, and the cropped national grids (data/heroGeoids.js) against PROJ 9.7:
//   cct -d 4 +proj=vgridshift +grids=de_bkg_gcg2016.tif +multiplier=1     (Lübbecke, GCG2016 ζ)
//   cct -d 4 +proj=vgridshift +grids=dk_sdfi_dvr90_2023.tif +multiplier=1 (Fanø, DVR90(2023) N)
// The heights themselves were checked against the source with tools/earth-pipeline/verify_hero_heights.py
// (Mapterhorn z16 vs NRW DGM1 via WCS, 400 points: mean 0.001 m, 5–95 % within ±0.03 m).
import * as G from '../src/sims/earth/geodesy.js';
import fs from 'node:fs';
import { HERO_GEOIDS, HERO_GEOIDS_FILE } from '../src/sims/earth/data/heroGeoids.js';
import { xyzBounds, levelCap, terrainSourceCap, usesNrwDop, heroWeight, LEVEL_MAX, TERRAIN_SOURCE_MAX, HERO_FEATHER_DEG } from '../src/sims/earth/regions.js';
import { HERO_BOXES } from '../src/sims/earth/places.js';
import { enlargeTile, gainTables, applyGain } from '../src/sims/earth/render/resample.js';
import { writeNormals, writeEdgeNormals, EARTH_RADIUS } from '../src/sims/earth/render/terrainNormals.js';
import { NRW_DOP_GAIN } from '../src/sims/earth/regions.js';

let failed = 0;
const check = (label, actual, expected, tolerance, unit = '') => {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failed++;
  console.log(`${ok ? '✔' : '✖'} ${label}: ${Number(actual.toPrecision(10))}${unit} (expected ${expected}${unit} ± ${tolerance}${unit})`);
};
const assert = (label, condition) => {
  if (!condition) failed++;
  console.log(`${condition ? '✔' : '✖'} ${label}`);
};
const tileAt = (lat, lon, z) => {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  return [x, y, z];
};

console.log('— regional depth —');
const markt = xyzBounds(...tileAt(52.3028, 8.6183, 18));
const nordby = xyzBounds(...tileAt(55.4446, 8.399, 16));
const paris = xyzBounds(...tileAt(48.8566, 2.3522, 14));
const cologne = xyzBounds(...tileAt(50.9375, 6.9603, 16));
assert(`Lübbecke refines to z${LEVEL_MAX.nrw} (NRW orthophotos) and reads terrain z${TERRAIN_SOURCE_MAX.hero}`, levelCap(markt) === LEVEL_MAX.nrw && terrainSourceCap(markt) === TERRAIN_SOURCE_MAX.hero);
assert(`Fanø refines to z${LEVEL_MAX.hero} on terrain z${TERRAIN_SOURCE_MAX.hero}`, levelCap(nordby) === LEVEL_MAX.hero && terrainSourceCap(nordby) === TERRAIN_SOURCE_MAX.hero);
assert(`Paris stops at z${LEVEL_MAX.global} on terrain z${TERRAIN_SOURCE_MAX.global}`, levelCap(paris) === LEVEL_MAX.global && terrainSourceCap(paris) === TERRAIN_SOURCE_MAX.global);
assert('Cologne (NRW, outside the hero boxes): orthophotos to z21, global terrain', levelCap(cologne) === LEVEL_MAX.nrw && terrainSourceCap(cologne) === TERRAIN_SOURCE_MAX.global);
assert('NRW orthophoto tiles: Lübbecke at z19 yes, at z9 no, Paris no, Fanø no',
  usesNrwDop(...tileAt(52.3028, 8.6183, 19)) && !usesNrwDop(...tileAt(52.3028, 8.6183, 9)) && !usesNrwDop(...tileAt(48.8566, 2.3522, 19)) && !usesNrwDop(...tileAt(55.4446, 8.399, 17)));

console.log('— national height reference blend —');
const L = HERO_BOXES.luebbecke;
check('weight in the middle of the Lübbecke box', heroWeight(L, 52.3, 8.62), 1, 1e-12);
check('weight on the box edge', heroWeight(L, L.north, 8.62), 0.5, 1e-12);
check('weight 0.05° outside', heroWeight(L, L.north + 0.05, 8.62), 0, 1e-12);
assert('the blend rises monotonically across the edge', heroWeight(L, L.north + 0.01, 8.62) < heroWeight(L, L.north - 0.01, 8.62));

console.log('— cropped national grids vs PROJ —');
const heroValues = JSON.parse(fs.readFileSync(new URL(`../public/${HERO_GEOIDS_FILE}`, import.meta.url), 'utf8'));
for (const g of HERO_GEOIDS) assert(`${g.id}: ${g.rows} × ${g.cols} values shipped`, heroValues[g.id]?.length === g.rows * g.cols);
const grids = Object.fromEntries(HERO_GEOIDS.map((g) => [g.id, G.createGeoidGrid({ ...g, values: Float32Array.from(heroValues[g.id]) })]));
// [grid, lon°, lat°, N or ζ (m)]
const REF = [
  ['luebbecke', 8.6183, 52.3028, 43.7167],
  ['luebbecke', 8.61, 52.283, 43.8122],
  ['fanoe', 8.41, 55.4, 40.8036],
  ['fanoe', 8.399, 55.4446, 40.7933],
  ['fanoe', 8.3, 55.3, 40.874],
  ['fanoe', 8.5, 55.5, 40.77],
];
for (const [id, lon, lat, expected] of REF) check(`${id} at (${lon}, ${lat})`, G.sampleGeoidGrid(grids[id], lat, lon), expected, 0.001, ' m');
for (const g of HERO_GEOIDS) {
  const box = HERO_BOXES[g.id];
  const margin = 2 * HERO_FEATHER_DEG; // the blend reaches one feather width past the edge, plus slack
  assert(`${g.id} grid covers its box plus the blend margin`,
    g.lat0 <= box.south - margin && g.lon0 <= box.west - margin && g.lat0 + (g.rows - 1) * g.dLat >= box.north + margin && g.lon0 + (g.cols - 1) * g.dLon >= box.east + margin);
}

console.log('— imagery past its last level, colour calibration —');
{
  // a parent with a smooth diagonal ramp: children cut from it must meet without a step at their shared edge
  const W = 256;
  const parent = new Uint8ClampedArray(W * W * 4);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) parent.set([x, (x + y) >> 1, y, 255], (y * W + x) * 4);
  const left = enlargeTile(parent, W, W, 64, 64, 64, 256);
  const right = enlargeTile(parent, W, W, 128, 64, 64, 256);
  let seam = 0;
  let inside = 0;
  for (let y = 0; y < 256; y++) {
    seam = Math.max(seam, Math.abs(right[(y * 256) * 4] - left[(y * 256 + 255) * 4]));
    inside = Math.max(inside, Math.abs(left[(y * 256 + 128) * 4] - left[(y * 256 + 127) * 4]));
  }
  // the ramp rises 64 levels over 256 output pixels: a step across the seam no larger than inside a child
  assert(`neighbouring children meet seamlessly (step across the seam ${seam} ≤ step inside ${inside} + 1)`, seam <= inside + 1);
  check('enlarged ramp keeps its values (pixel 0 of the child at parent x 64)', left[0], 64, 1);
  const identity = gainTables([1, 1, 1]);
  assert('a gain of 1 leaves every byte as it is', identity.every((t) => t.every((v, i) => v === i)));
  const dop = gainTables(NRW_DOP_GAIN);
  assert('the orthophoto calibration darkens and keeps the order of values', dop.every((t) => t.every((v, i) => v <= i && (i === 0 || v >= t[i - 1]))));
  const px = applyGain(Uint8ClampedArray.from([188, 188, 188, 7]), dop);
  // sRGB 188 ≈ linear 0.5 → × gain → back to sRGB
  check('calibrated mid grey, red', px[0], Math.round(255 * (1.055 * (0.5029 * NRW_DOP_GAIN[0]) ** (1 / 2.4) - 0.055)), 1);
  assert('alpha untouched', px[3] === 7);
}

console.log('— relief normals of the height grids —');
{
  // a plane rising 1 m per 10 m to the east and 1 m per 20 m to the north, at z14 around 52° N
  const size = 16;
  const pw = size + 2;
  const level = 14;
  const [, y] = tileAt(52.3, 8.6, level);
  const texelAt = (r) => {
    const ny = (y + 1 - (r - 0.5) / size) / 2 ** level;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * ny)));
    return ((2 * Math.PI * EARTH_RADIUS) / 2 ** level / size) * Math.cos(lat);
  };
  const heights = new Float32Array(pw * pw);
  for (let r = 0; r < pw; r++) {
    for (let c = 0; c < pw; c++) {
      // integrate the row's texel width so the slope is exact in metres
      heights[r * pw + c] = (c * texelAt(r)) / 10 + (r * texelAt(r)) / 20;
    }
  }
  const out = new Uint8Array(pw * pw * 2);
  writeNormals(out, heights, pw, pw, y, level, 1);
  const decode = (b) => {
    const e = b / 127.5 - 1;
    return e * Math.abs(e);
  };
  const i = (8 * pw + 8) * 2;
  const n = [-0.1, -0.05, 1];
  const len = Math.hypot(...n);
  check('east component of a 1:10 slope rising east', decode(out[i]), n[0] / len, 0.006);
  check('north component of a 1:20 slope rising north', decode(out[i + 1]), n[1] / len, 0.01);
  const flat = new Uint8Array(pw * pw * 2);
  writeNormals(flat, new Float32Array(pw * pw).fill(37), pw, pw, y, level, 1);
  assert('a flat grid stores level normals (128, 128)', flat.every((v) => v === 128));
  const edges = new Uint8Array(pw * pw * 2);
  writeEdgeNormals(edges, heights, pw, pw, y, level, 1);
  assert('the edge refresh writes the border strips and leaves the middle alone', edges[i] === 0 && edges[0] === out[0] && edges[(pw * pw - 1) * 2] === out[(pw * pw - 1) * 2]);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
