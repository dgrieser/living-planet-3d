// Validates the Living Earth geodesy (src/sims/earth/geodesy.js) against PROJ 9.7.1:
// WGS84 geodetic ↔ ECEF, ENU frames, UTM zone 32N (EPSG:25832) both ways, the time-dependent
// ITRF2020 → ETRF2020 rotation, and bilinear geoid-grid lookups – all within 1 mm.
//
// Reference values (generated 2026-10-31):
//   ECEF:  cs2cs -f %.6f +proj=longlat +ellps=WGS84 +to +proj=geocent +ellps=WGS84
//   UTM:   cs2cs -f %.6f +proj=longlat +ellps=GRS80 +to +proj=utm +zone=32 +ellps=GRS80 (and the inverse)
//   ETRF:  cct -d 5 +proj=helmert +drx=8.6e-05 +dry=0.000519 +drz=-0.000753 +t_epoch=1989
//          +convention=position_vector   (PROJ's "ITRF2020 to ETRF2020 (1)")
//   Geoid: 4×4 patches of PROJ's egm96_15.gtx, values inside them from cct +proj=vgridshift.
//   Global geoid: public/earth/egm2008-0p5.bin vs. the full 2.5′ grid,
//          cct -d 4 +proj=vgridshift +grids=us_nga_egm08_25.tif +multiplier=1
// The official GCG2016 / DKgeoid control points follow in M2, with the national grids.
import fs from 'node:fs';
import * as G from '../src/sims/earth/geodesy.js';

let failed = 0;
const check = (label, actual, expected, tolerance, unit = '') => {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failed++;
  console.log(`${ok ? '✔' : '✖'} ${label}: ${Number(actual.toPrecision(12))}${unit} (expected ${expected}${unit} ± ${tolerance}${unit})`);
};
const assert = (label, condition) => {
  if (!condition) failed++;
  console.log(`${condition ? '✔' : '✖'} ${label}`);
};
const D = G.DEG;
const MM = 0.001;
// 1 mm on the ground expressed in degrees of latitude (and of longitude at 52–70° N, generously)
const MM_DEG = 1e-3 / 111000;

console.log('— WGS84 geodetic → ECEF (cs2cs +proj=geocent) —');
// [lon°, lat°, h m, X, Y, Z]
const ECEF = [
  [8.6176, 52.3069, 60, 3863911.2084, 585575.741108, 5023802.780804],
  [8.399, 55.4446, 5, 3587053.003825, 529625.93245, 5229619.933448],
  [0, 0, 0, 6378137, 0, 0],
  [-122.4194, 37.7749, -30, -2706162.133931, -4261039.472302, 3885707.113198],
  [179.9, -89.99, 2800, -1117.42678, 1.95028, -6359552.216731],
  [45, 89.999, 10000, 79.102984, 79.102984, 6366752.313269],
  [-70, -33, 400000, 1946075.125185, -5346797.463008, -3671814.255184],
  [137, 35, -10900, -3818761.950939, 3561053.129619, 3631614.926222],
];
for (const [lon, lat, h, X, Y, Z] of ECEF) {
  const [x, y, z] = G.geodeticToEcef(lat * D, lon * D, h);
  check(`(${lon}, ${lat}, ${h} m) → ECEF error (mm)`, Math.hypot(x - X, y - Y, z - Z) / MM, 0, 1, ' mm');
}

console.log('— ECEF → geodetic round trip (≤ 1 mm, incl. poles, 400 km up, the deep sea) —');
for (const [lon, lat, h, X, Y, Z] of ECEF) {
  const g = G.ecefToGeodetic(X, Y, Z);
  const [x, y, z] = G.geodeticToEcef(g.lat, g.lon, g.h);
  check(`(${lon}, ${lat}) height (m)`, g.h, h, MM, ' m');
  check(`(${lon}, ${lat}) round-trip position (mm)`, Math.hypot(x - X, y - Y, z - Z) / MM, 0, 1, ' mm');
}
const pole = G.ecefToGeodetic(0, 0, 6356752.314245 + 100);
check('on the axis: latitude (°)', pole.lat / D, 90, 1e-12, '°');
check('on the axis: height above the pole (m)', pole.h, 100, MM, ' m');
const moonDistance = G.ecefToGeodetic(...G.geodeticToEcef(20 * D, 30 * D, 384400e3));
check('384 400 km up: height round trip (m)', moonDistance.h, 384400e3, 0.01, ' m');
check('384 400 km up: latitude round trip (°)', moonDistance.lat / D, 20, 1e-10, '°');

console.log('— ENU frames —');
const frame = G.createEnuFrame(52.3069 * D, 8.6176 * D, 60);
const east100 = frame.toEcef(100, 0, 0);
const back = frame.toEnu(...east100);
check('ENU → ECEF → ENU (east 100 m)', Math.hypot(back[0] - 100, back[1], back[2]), 0, 1e-9, ' m');
const up = frame.toEnu(...G.geodeticToEcef(52.3069 * D, 8.6176 * D, 1060));
check('1 km straight up is (0, 0, 1000) in ENU: up (m)', up[2], 1000, 1e-6, ' m');
check('1 km straight up: horizontal drift (m)', Math.hypot(up[0], up[1]), 0, 1e-6, ' m');
const north = frame.toEnu(...G.geodeticToEcef((52.3069 + 0.001) * D, 8.6176 * D, 60));
assert(`0.001° north lies north (n = ${north[1].toFixed(3)} m, e = ${north[0].toExponential(1)} m)`, north[1] > 111 && north[1] < 112 && Math.abs(north[0]) < 1e-6);
const m = frame.matrix();
check('matrix column 3 is the origin (X)', m[12], frame.origin[0], 0, ' m');

console.log('— UTM zone 32N, ETRS89/GRS80 (EPSG:25832) —');
// [lon°, lat°, E, N]
const UTM_FWD = [
  [8.6176, 52.3069, 473927.982042, 5795242.244246],
  [8.399, 55.4446, 461981.434643, 6144432.101779],
  [8.53277, 52.26621, 468115.108112, 5790750.336689],
  [8.7286, 52.34368, 481511.278743, 5799299.068205],
  [8.2, 55.28, 449182.741641, 6126241.872386],
  [8.56, 55.55, 472240.2583, 6156085.546017],
  [3.0, 47.0, 43904.927283, 5222660.65251],
  [12.0, 60.0, 667294.821127, 6655205.483512],
  [15.5, 70.0, 747705.241774, 7779093.915815],
  [9.0, 0.5, 500000, 55265.037141],
];
for (const [lon, lat, E, N] of UTM_FWD) {
  const u = G.geodeticToUtm(lat * D, lon * D, 32);
  check(`(${lon}, ${lat}) → UTM32 error (mm)`, Math.hypot(u.easting - E, u.northing - N) / MM, 0, 1, ' mm');
}
// [E, N, lon°, lat°]
const UTM_INV = [
  [468155, 5790735, 8.5333559882, 52.2660744309],
  [481499, 5799356, 8.7284166237, 52.3441914215],
  [449183, 6126242, 8.2000040438, 55.2800011733],
  [472240, 6156086, 8.5599958604, 55.5500040645],
  [500000, 0, 9.0, 0.0],
  [300000, 7000000, 5.0396479967, 63.0739966040],
];
for (const [E, N, lon, lat] of UTM_INV) {
  const g = G.utmToGeodetic(E, N, 32);
  check(`UTM32 (${E}, ${N}) → latitude (°)`, g.lat / D, lat, MM_DEG, '°');
  check(`UTM32 (${E}, ${N}) → longitude (°)`, g.lon / D, lon, 3 * MM_DEG, '°');
}
const scaleCM = G.geodeticToUtm(52 * D, 9 * D, 32).scale;
check('point scale on the central meridian', scaleCM, 0.9996, 1e-12);
const conv = G.geodeticToUtm(52.3069 * D, 8.6176 * D, 32).convergence / D;
// γ ≈ Δλ · sin φ for small Δλ
check('meridian convergence in Lübbecke (°)', conv, (8.6176 - 9) * Math.sin(52.3069 * D), 0.001, '°');
const rt = G.utmToGeodetic(...Object.values(G.geodeticToUtm(55.4446 * D, 8.399 * D, 32)).slice(0, 2), 32);
check('UTM round trip in Fanø (latitude, °)', rt.lat / D, 55.4446, 1e-11, '°');

console.log('— ITRF2020 ↔ ETRF2020 (EUREF plate rotation since 1989.0) —');
// [X, Y, Z (ITRF2020), epoch, X, Y, Z (ETRF2020)]
const ETRF = [
  [3826645.1, 579701.9, 5025230.3, 2026.83, 3826645.6584, 579701.29226, 5025229.9449],
  [3618367.6, 534743.3, 5226935.2, 2026.83, 3618368.17139, 534742.71785, 5226934.86401],
  [3618367.6, 534743.3, 5226935.2, 2000.0, 3618367.76614, 534743.13072, 5226935.1023],
];
for (const [x, y, z, t, X, Y, Z] of ETRF) {
  const e = G.itrf2020ToEtrf2020(x, y, z, t);
  check(`ITRF2020 → ETRF2020 at ${t} error (mm)`, Math.hypot(e[0] - X, e[1] - Y, e[2] - Z) / MM, 0, 1, ' mm');
  const i = G.etrf2020ToItrf2020(X, Y, Z, t);
  check(`ETRF2020 → ITRF2020 at ${t} round trip (mm)`, Math.hypot(i[0] - x, i[1] - y, i[2] - z) / MM, 0, 1, ' mm');
}
const [ex, ey, ez] = G.itrf2020ToEtrf2020(3863911.2084, 585575.741108, 5023802.780804, 2026.83);
const shift = Math.hypot(ex - 3863911.2084, ey - 585575.741108, ez - 5023802.780804);
assert(`the frames are ≈ 0.9–1.0 m apart in Lübbecke in 2026 (${shift.toFixed(3)} m)`, shift > 0.9 && shift < 1.0);
check('decimal year of 2026-10-31 00:00 UTC', G.decimalYear(new Date(Date.UTC(2026, 9, 31))), 2026 + 303 / 365, 1e-9);

console.log('— geoid grid lookups (EGM96 15′ patches vs. PROJ) —');
const PATCHES = {
  luebbecke: { lat0: 52.0, lon0: 8.25, dLat: 0.25, dLon: 0.25, rows: 4, cols: 4, values: [44.6485, 44.7851, 44.8645, 44.8533, 44.0138, 44.0563, 44.0314, 43.9211, 43.202, 43.1491, 43.0381, 42.87, 42.1152, 42.0199, 41.904, 41.7797] },
  nordby: { lat0: 55.0, lon0: 8.0, dLat: 0.25, dLon: 0.25, rows: 4, cols: 4, values: [40.6258, 40.6257, 40.5642, 40.4706, 41.0132, 40.9916, 40.9085, 40.7915, 41.1183, 41.0918, 41.0142, 40.8976, 41.0051, 40.9656, 40.8945, 40.7868] },
};
// [patch, lon°, lat°, N m] – PROJ: cct +proj=vgridshift +grids=egm96_15.gtx +multiplier=1 (input h = 0 → N)
const GEOID_POINTS = [
  ['luebbecke', 8.6176, 52.3069, 43.828858],
  ['luebbecke', 8.55, 52.41, 43.459667],
  ['luebbecke', 8.75, 52.5, 43.038074],
  ['luebbecke', 8.5, 52.25, 44.056252],
  ['nordby', 8.399, 55.4446, 41.022586],
  ['nordby', 8.3, 55.41, 41.039778],
  ['nordby', 8.5, 55.5, 41.014172],
  ['nordby', 8.25, 55.25, 40.991573],
];
for (const [patch, lon, lat, expected] of GEOID_POINTS) {
  const grid = G.createGeoidGrid({ ...PATCHES[patch], values: Float32Array.from(PATCHES[patch].values) });
  const n = G.sampleGeoidGrid(grid, lat, lon);
  check(`N at (${lon}, ${lat}) (m)`, n, expected, MM, ' m');
}
const g4 = G.createGeoidGrid({ ...PATCHES.luebbecke, values: Float32Array.from(PATCHES.luebbecke.values) });
assert('outside the grid → null', G.sampleGeoidGrid(g4, 53.5, 8.5) === null);

console.log('— global geoid (shipped EGM2008 0.5° grid vs. the full 2.5′ grid in PROJ) —');
const geoidFile = fs.readFileSync(new URL(`../public/${G.GLOBAL_GEOID.file}`, import.meta.url));
const globalGeoid = G.parseGeoidI16(geoidFile.buffer.slice(geoidFile.byteOffset, geoidFile.byteOffset + geoidFile.byteLength));
// [label, lon°, lat°, N m, tolerance m] – 0.3 m in the hero areas, 0.5 m elsewhere (bilinear on 0.5°)
const EGM2008 = [
  ['Lübbecke', 8.6183, 52.3028, 43.9162, 0.3],
  ['Fanø', 8.41, 55.4, 41.0671, 0.3],
  ['New Guinea high', 147, -5, 73.8842, 0.5],
  ['Indian Ocean low', 78, 5, -104.557, 0.5],
  ['Andes', -70, -15, 48.8031, 0.5],
  ['0°, 0°', 0, 0, 17.2251, 0.5],
  ['Iceland', -19, 64.5, 67.467, 0.5],
  ['Everest', 86.92, 27.99, -28.4253, 0.5],
];
for (const [label, lon, lat, expected, tol] of EGM2008) {
  check(`N ${label} (m)`, G.sampleGeoidGrid(globalGeoid, lat, lon), expected, tol, ' m');
}
check('N wraps across the antimeridian (179.9° vs −180.1°)', G.sampleGeoidGrid(globalGeoid, 10, 179.9), G.sampleGeoidGrid(globalGeoid, 10, -180.1), 1e-6, ' m');

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
