/**
 * Builds the global geoid grid the Living Earth ships with: EGM2008 undulations N on a 0.5° grid.
 *
 *   node tools/earth-pipeline/build-geoid.mjs <us_nga_egm08_25.tif> [out.bin]
 *
 * Input: PROJ's EGM2008 2.5′ grid (public domain, https://cdn.proj.org/us_nga_egm08_25.tif, 80 MB).
 * Output (public/earth/egm2008-0p5.bin): 361 rows (−90° … +90°, south row first) × 720 columns
 * (−180° … +179.5°), little-endian Int16 in centimetres – 520 kB. The 0.5° nodes are nodes of the 2.5′
 * grid, so they are copied, not interpolated. Read it with geodesy.js `parseGeoidI16`; the runtime
 * interpolates bilinearly (≤ 0.3 m off the full grid in the hero areas, a few metres in high mountains –
 * checked by scripts/check-earth-geodesy.mjs).
 */
import fs from 'node:fs';
import { fromArrayBuffer } from 'geotiff';

const [input, output = 'public/earth/egm2008-0p5.bin'] = process.argv.slice(2);
if (!input) {
  console.error('usage: node tools/earth-pipeline/build-geoid.mjs <us_nga_egm08_25.tif> [out.bin]');
  process.exit(1);
}
const buf = fs.readFileSync(input);
const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const image = await tiff.getImage(0);
const width = image.getWidth();
const height = image.getHeight();
const [originLon, originLat] = image.getOrigin();
const [resLon, resLat] = image.getResolution();
// pixel-is-point vs pixel-is-area: GeoTIFF origins are the outer corner of the first pixel for "area"
const isPoint = image.getGeoKeys().GTRasterTypeGeoKey === 2;
const firstLon = isPoint ? originLon : originLon + resLon / 2;
const firstLat = isPoint ? originLat : originLat + resLat / 2;
console.log({ width, height, firstLon, firstLat, resLon, resLat, isPoint });
const [raster] = await image.readRasters();

const STEP = 0.5;
const ROWS = 361;
const COLS = 720;
const out = new Int16Array(ROWS * COLS);
let maxAbs = 0;
for (let r = 0; r < ROWS; r++) {
  const lat = -90 + r * STEP;
  const py = Math.round((lat - firstLat) / resLat);
  if (py < 0 || py >= height) throw new Error(`row ${lat} outside the grid`);
  for (let c = 0; c < COLS; c++) {
    const lon = -180 + c * STEP;
    let px = Math.round((lon - firstLon) / resLon);
    px = ((px % width) + width) % width;
    const n = raster[py * width + px];
    if (!Number.isFinite(n)) throw new Error(`no value at ${lat}, ${lon}`);
    maxAbs = Math.max(maxAbs, Math.abs(n));
    out[r * COLS + c] = Math.round(n * 100);
  }
}
const bytes = Buffer.alloc(out.length * 2);
for (let i = 0; i < out.length; i++) bytes.writeInt16LE(out[i], i * 2);
fs.writeFileSync(output, bytes);
console.log(`wrote ${output}: ${ROWS}×${COLS}, |N| ≤ ${maxAbs.toFixed(2)} m, ${bytes.length} bytes`);
