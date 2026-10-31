// Checks the generated buildings of the Living Earth (milestone M3, data/osmBuildings.js): the baked
// OpenStreetMap footprints of Fanø decode, the minimum bounding rectangle and polygon area are right, the
// height/roof defaults follow the building type, and the walls and roofs come out closed, outward and up.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { decodeOsmBuildings, polygonArea, minAreaRect, buildingForm, buildingGeometry } from '../src/sims/earth/data/osmBuildings.js';

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

console.log('— baked footprints (public/earth/fanoe-buildings.bin.gz) —');
const bytes = new Uint8Array(zlib.gunzipSync(fs.readFileSync(new URL('../public/earth/fanoe-buildings.bin.gz', import.meta.url))));
const { header, buildings } = decodeOsmBuildings(bytes);
assert(`${header.count} buildings decode (${header.licence})`, buildings.length === header.count && header.count > 15000);
let inBox = 0;
let vertices = 0;
for (const b of buildings) {
  vertices += b.latLon.length / 2;
  const lat = b.latLon[0];
  const lon = b.latLon[1];
  if (lat > 55.33 && lat < 55.49 && lon > 8.31 && lon < 8.5) inBox++;
}
assert(`every footprint lies in the Fanø box (${inBox}/${buildings.length})`, inBox === buildings.length);
assert(`vertex count matches the header (${vertices})`, vertices === header.vertices);
assert('building types decode', buildings.filter((b) => b.type === 'bungalow').length > 2000);

console.log('— footprint geometry —');
// a 12 × 8 m house turned by 30°
const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
const house = [[-6, -4], [6, -4], [6, 4], [-6, 4]].flatMap(([x, y]) => rot(x, y, Math.PI / 6));
check('area of the 12 × 8 m rectangle', polygonArea(house), 96, 1e-9, ' m²');
const rect = minAreaRect(house);
check('bounding rectangle length', rect.length, 12, 1e-9, ' m');
check('bounding rectangle width', rect.width, 8, 1e-9, ' m');
check('ridge direction (long side)', ((rect.angle % Math.PI) + Math.PI) % Math.PI, Math.PI / 6, 1e-9, ' rad');
const reversed = [];
for (let i = house.length / 2 - 1; i >= 0; i--) reversed.push(house[i * 2], house[i * 2 + 1]);
check('clockwise footprints have negative area', polygonArea(reversed), -96, 1e-9, ' m²');

console.log('— forms —');
const bungalow = buildingForm({ type: 'bungalow', levels: 0, roof: '', roofMaterial: '', height: 0 }, 96);
assert(`a small summer house gets a gable roof over one storey (${bungalow.roof}, eaves ${bungalow.eaves} m)`, bungalow.roof === 'gabled' && bungalow.eaves === 2.8);
const shed = buildingForm({ type: 'garage', levels: 0, roof: '', roofMaterial: '', height: 0 }, 20);
assert(`a garage is flat and low (${shed.roof}, ${shed.eaves} m)`, shed.roof === 'flat' && shed.eaves < 2.6);
const flats = buildingForm({ type: 'apartments', levels: 4, roof: '', roofMaterial: '', height: 0 }, 600);
check('four levels → eaves', flats.eaves, 4 * 2.8 + 0.2, 1e-9, ' m');
const thatch = buildingForm({ type: 'house', levels: 0, roof: 'gabled', roofMaterial: 'thatch', height: 0 }, 120);
assert('thatched roofs are steeper', thatch.pitchDeg > bungalow.pitchDeg);

console.log('— walls and roofs —');
const g = buildingGeometry(house, bungalow);
const tris = g.positions.length / 9;
assert(`gabled house: 4 walls (8 triangles) + 2 gables + 2 roof planes (4) = 14 triangles (got ${tris})`, tris === 14);
let zMax = 0;
for (let i = 2; i < g.positions.length; i += 3) zMax = Math.max(zMax, g.positions[i]);
check('ridge height = eaves + half width × tan 40°', zMax, 2.8 + 4 * Math.tan((40 * Math.PI) / 180), 1e-9, ' m');
let roofUp = true;
let wallsOut = true;
for (let t = 0; t < tris; t++) {
  const i = t * 9;
  const nz = g.normals[i + 2];
  const cx = (g.positions[i] + g.positions[i + 3] + g.positions[i + 6]) / 3;
  const cy = (g.positions[i + 1] + g.positions[i + 4] + g.positions[i + 7]) / 3;
  if (g.roof[t * 3] === 1 && nz <= 0) roofUp = false;
  if (g.roof[t * 3] === 0 && cx * g.normals[i] + cy * g.normals[i + 1] <= 0) wallsOut = false;
}
assert('roof normals point up', roofUp);
assert('wall normals point outward', wallsOut);
const lShape = [0, 0, 10, 0, 10, 4, 4, 4, 4, 10, 0, 10];
const gl = buildingGeometry(lShape, buildingForm({ type: 'house', levels: 0, roof: 'gabled', roofMaterial: '', height: 0 }, polygonArea(lShape)));
let flatTop = true;
for (let t = 0; t < gl.positions.length / 9; t++) if (gl.roof[t * 3] === 1 && gl.normals[t * 9 + 2] < 0.999) flatTop = false;
assert('an L-shaped house is extruded with a flat roof (no rectangle to put a ridge on)', flatTop && gl.positions.length > 0);
assert('a sliver below 2 m² is skipped', buildingGeometry([0, 0, 1, 0, 1, 1, 0, 1], bungalow).positions.length === 0);
const hip = buildingGeometry(house, { ...bungalow, roof: 'hipped' });
assert(`hipped house: 4 walls + 2 roof planes + 2 hips = 14 triangles (got ${hip.positions.length / 9})`, hip.positions.length / 9 === 14);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
