/**
 * Builds the global sea floor base grid the Living Earth ships with: one GEBCO_2026 overview level
 * (default level 6: 1350 × 675, 16′ ≈ 30 km), so the globe views never wait for range requests to the
 * COG host (0.3–0.8 s each).
 *
 *   node tools/earth-pipeline/build-gebco-base.mjs [cog-url-or-path] [level] [out]
 *
 * Output (public/earth/gebco2026-16min.bin.gz, ≈ 760 kB): metres above mean sea level as Int16, land set
 * to 0 (the runtime only reads sea texels), rows north → south, columns from −180°, pixel-is-area. Each
 * row is stored as differences to its left neighbour (the first value as is), split into a high-byte plane
 * followed by a low-byte plane, then gzipped – about half the size of plain Int16. Decoded by
 * `decodeGebcoBase` in src/sims/earth/data/gebco.js (layout constant GEBCO_BASE there).
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fromUrl, fromFile } from 'geotiff';

const [src = 'https://data.source.coop/ausantarctic/gebco/GEBCO_2026.tif', levelArg = '6', out = 'public/earth/gebco2026-16min.bin.gz'] = process.argv.slice(2);
const tiff = src.startsWith('http') ? await fromUrl(src) : await fromFile(src);
const image = await tiff.getImage(Number(levelArg));
const width = image.getWidth();
const height = image.getHeight();
console.log(`level ${levelArg}: ${width} × ${height} (${(360 / width) * 60}′)`);
const [data] = await image.readRasters();
const n = width * height;
const planes = Buffer.alloc(n * 2);
let min = Infinity;
for (let r = 0; r < height; r++) {
  let prev = 0;
  for (let c = 0; c < width; c++) {
    const i = r * width + c;
    const v = Math.min(data[i], 0); // land → 0
    min = Math.min(min, v);
    const d = (v - prev) & 0xffff;
    prev = v;
    planes[i] = d >> 8;
    planes[n + i] = d & 0xff;
  }
}
const gz = zlib.gzipSync(planes, { level: 9 });
fs.writeFileSync(out, gz);
console.log(`wrote ${out}: ${width}×${height}, deepest ${min} m, ${n * 2} → ${gz.length} bytes`);
