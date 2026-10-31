// Checks the data plumbing of the Living Earth's M1 layers – everything that can be checked without the
// network: Web-Mercator tile bounds, the GEBCO overview choice and resampling, the land/sea merge, the
// shipped GEBCO base grid (decode of its delta/byte-plane encoding, and spot depths against GEBCO_2026),
// the product-date and Blue Marble month logic, GIBS colour maps and tile layout, CPU mip chains.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { mercatorTileBounds, chooseLevel, gridWindow, resampleToMercatorTile, mergeSeaFloor, decodeGebcoBase, GEBCO_BASE } from '../src/sims/earth/data/gebco.js';
import { productDate, blueMarbleMonths, parseColormap, gibsLevel, buildMips, GLOBAL_LAYERS } from '../src/sims/earth/data/globalLayers.js';

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

console.log('— Web-Mercator tiles —');
const t0 = mercatorTileBounds(0, 0, 0);
check('zoom 0 reaches 85.0511° N', t0.north, 85.05112877980659, 1e-9, '°');
check('zoom 0 reaches 85.0511° S', t0.south, -85.05112877980659, 1e-9, '°');
const t = mercatorTileBounds(133, 81, 8); // over the Wadden Sea
check('tile 8/133/81 west', t.west, 7.03125, 1e-9, '°');
check('tile 8/133/81 north', t.north, 54.97761367069626, 1e-9, '°');

console.log('— GEBCO overview choice and windows —');
const levels = [86400, 43200, 21600, 10800, 5400, 2700, 1350, 675].map((w) => ({ width: w, height: w / 2 }));
assert('a zoom-12 tile reads the full 15″ grid (level 0)', chooseLevel(levels, (360 / 4096) / 512) === 0);
assert('a zoom-6 tile reads level 1 (30″)', chooseLevel(levels, (360 / 64) / 512) === 1);
assert('a zoom-0 tile reads the coarsest level', chooseLevel(levels, 360 / 512) === 7);
const w = gridWindow(mercatorTileBounds(33, 22, 6), 43200, 21600);
assert(`zoom-6 window of 681 × 466 px at level 1 (got ${w[2] - w[0]} × ${w[3] - w[1]})`, w[2] - w[0] === 681 && w[3] - w[1] === 466);

console.log('— resampling into a Mercator tile —');
// a synthetic global grid whose value is its latitude: resampled rows must give the texel-centre latitudes
const gw = 360;
const gh = 180;
const grid = new Float32Array(gw * gh);
for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) grid[r * gw + c] = 90 - (r + 0.5);
const size = 8;
const res = resampleToMercatorTile(grid, { window: [0, 0, gw, gh], width: gw }, 1, 0, 1, size);
const ny = (1 - 0.5 / size) / 2;
const latBottom = (Math.atan(Math.sinh(Math.PI * (1 - 2 * ny))) * 180) / Math.PI;
check('row 0 is the southern edge row (texel-centre latitude)', res[0], latBottom, 1e-4, '°');
assert('rows run south → north', res[(size - 1) * size] > res[0]);
assert('no-data (−32767) becomes NaN', Number.isNaN(resampleToMercatorTile(new Int16Array(4).fill(-32767), { window: [0, 0, 2, 2], width: 2 }, 0, 0, 0, 2)[0]));

console.log('— land / sea merge —');
// 4 × 4 interior: one land row (12 m), polder (−3 m), Mapterhorn sea (0 m)
const pw = 6;
const heights = new Float32Array(pw * pw);
const set = (r, c, v) => { heights[(r + 1) * pw + c + 1] = v; };
for (let c = 0; c < 4; c++) { set(0, c, 0); set(1, c, 0); set(2, c, -3); set(3, c, 12); }
const sea = new Float32Array(16).fill(-35);
sea[1] = 4; // GEBCO thinks land here
const mask = mergeSeaFloor(heights, pw, pw, sea);
assert('Mapterhorn sea takes GEBCO depth', heights[1 * pw + 1] === -35 && mask[1 * pw + 1] === 255);
assert('sea where GEBCO says land stays land at 0 m', heights[1 * pw + 2] === 0 && mask[1 * pw + 2] === 0);
assert('a polder below sea level stays land', heights[3 * pw + 1] === -3 && mask[3 * pw + 1] === 0);
assert('land keeps its height', heights[4 * pw + 1] === 12 && mask[4 * pw + 1] === 0);
const flat = new Float32Array(pw * pw);
const flatMask = mergeSeaFloor(flat, pw, pw, null);
assert('without GEBCO the sea sits 0.5 m below the surface', flat[pw + 1] === -0.5 && flatMask[pw + 1] === 255);
assert('the mask border duplicates its edge', flatMask[0] === flatMask[pw + 1]);

console.log('— shipped GEBCO base grid —');
const gz = fs.readFileSync(new URL(`../public/${GEBCO_BASE.file}`, import.meta.url));
const base = decodeGebcoBase(new Uint8Array(zlib.gunzipSync(gz)));
assert(`decodes to ${GEBCO_BASE.width} × ${GEBCO_BASE.height}`, base.length === GEBCO_BASE.width * GEBCO_BASE.height);
const at = (lat, lon) => base[Math.floor(((90 - lat) / 180) * GEBCO_BASE.height) * GEBCO_BASE.width + Math.floor(((lon + 180) / 360) * GEBCO_BASE.width)];
let max = -Infinity;
let min = Infinity;
for (const v of base) { max = Math.max(max, v); min = Math.min(min, v); }
assert('land is stored as 0', max === 0);
assert(`deepest cell below −9000 m (Mariana Trench at 16′; got ${min} m)`, min < -9000);
assert(`the abyssal plain west of the Canaries is 4–6 km deep (got ${at(27, -25)} m)`, at(27, -25) < -4000 && at(27, -25) > -6500);
assert(`the Dogger Bank is shallower than 60 m (got ${at(54.8, 2.3)} m)`, at(54.8, 2.3) > -60 && at(54.8, 2.3) < 0);
assert(`the Norwegian Trench off Lista is deeper than 200 m (got ${at(57.5, 7.5)} m)`, at(57.5, 7.5) < -200);

console.log('— product dates —');
const snow = GLOBAL_LAYERS.snow;
const ice = GLOBAL_LAYERS.seaIce;
const p1 = productDate(Date.UTC(2010, 6, 17, 13), snow);
assert(`July 2010 snow → 2010-07-01, measured (got ${p1.date}, ${p1.climatology})`, p1.date === '2010-07-01' && !p1.climatology);
const p2 = productDate(Date.UTC(2026, 9, 31), snow);
assert(`October 2026 snow (not yet published) → October 2025, climatology (got ${p2.date}, ${p2.climatology})`, p2.date === '2025-10-01' && p2.climatology);
const p3 = productDate(Date.UTC(1990, 1, 10), snow);
assert(`February 1990 snow → February 2001, climatology (got ${p3.date})`, p3.date === '2001-02-01' && p3.climatology);
const p4 = productDate(Date.UTC(2012, 0, 15), ice);
assert(`sea ice in the AMSR gap (Jan 2012) → Jan 2011 (got ${p4.date})`, p4.date === '2011-01-15' && p4.climatology);
const p5 = productDate(Date.UTC(2020, 1, 29), ice);
assert(`29 Feb 2020 sea ice → that day (got ${p5.date})`, p5.date === '2020-02-29' && !p5.climatology);

console.log('— Blue Marble months —');
const b1 = blueMarbleMonths(Date.UTC(2024, 0, 15));
assert(`15 January → January pure (got ${b1.a}/${b1.b}, ${b1.mix})`, b1.a === 0 && b1.mix === 0);
const b2 = blueMarbleMonths(Date.UTC(2024, 0, 31));
check('31 January → half way to February', b2.mix, 16 / 31, 1e-9);
const b3 = blueMarbleMonths(Date.UTC(2024, 0, 3));
assert(`3 January → December → January (got ${b3.a}/${b3.b})`, b3.a === 11 && b3.b === 0 && b3.mix > 0.5);

console.log('— GIBS colour maps and tiles —');
const cmap = parseColormap(`<ColorMap><ColorMapEntry rgb="0,255,0" transparent="true" sourceValue="[0]" value="[0]" ref="0"/>
  <ColorMapEntry rgb="240,240,128" transparent="false" sourceValue="[1]" value="[1]" ref="1"/>
  <ColorMapEntry rgb="255,255,255" transparent="false" sourceValue="[100]" value="[100]" ref="100"/>
  <ColorMapEntry rgb="255,255,255" transparent="true" sourceValue="[255]" nodata="true" ref="108"/></ColorMap>`);
assert('transparent entries are skipped, values read', cmap.size === 2 && cmap.get((240 << 16) | (240 << 8) | 128) === 1 && cmap.get(0xffffff) === 100);
const l3 = gibsLevel(3);
assert(`GIBS level 3: 5120 × 2560 px in 10 × 5 tiles (got ${l3.width} × ${l3.height}, ${l3.cols} × ${l3.rows})`, l3.width === 5120 && l3.height === 2560 && l3.cols === 10 && l3.rows === 5);

console.log('— mip chains —');
const mips = buildMips(new Uint8Array([0, 255, 255, 0, 10, 10, 10, 10]), 4, 2);
assert(`4 × 2 → 2 × 1 → 1 × 1 (got ${mips.map((m) => `${m.width}×${m.height}`).join(' → ')})`, mips.length === 3 && mips[2].width === 1);
check('box filter', mips[1].data[0], (0 + 255 + 10 + 10 + 2) >> 2, 0);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
