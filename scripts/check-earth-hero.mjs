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

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
