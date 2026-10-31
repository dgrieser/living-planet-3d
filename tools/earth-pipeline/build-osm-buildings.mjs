/**
 * Bakes OpenStreetMap building footprints of a hero area into the compact asset the Living Earth reads
 * (docs/earth-sim/04 §6 – until the planned LoD2 reconstruction from the DHM point cloud exists):
 *
 *   node tools/earth-pipeline/build-osm-buildings.mjs <overpass.json> [out.bin.gz]
 *
 * Input: an Overpass API answer (`[out:json];way["building"](S,W,N,E);out tags geom;`). Output
 * (public/earth/fanoe-buildings.bin.gz): gzip of
 *   u32 header length · header JSON (codes, reference point, counts) · per building 8 bytes
 *   (type, levels, roof shape, roof material, wall material: u8; height in dm: u16; reserved u8)
 *   · u16 vertex count per building · i32 lat/lon in 1e-7° (first vertex relative to the reference,
 *   the rest as differences to the previous vertex; the closing vertex dropped).
 * Data © OpenStreetMap contributors, ODbL 1.0 – the asset is a derived database under the same licence.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const [input, out = 'public/earth/fanoe-buildings.bin.gz'] = process.argv.slice(2);
if (!input) {
  console.error('usage: node tools/earth-pipeline/build-osm-buildings.mjs <overpass.json> [out.bin.gz]');
  process.exit(1);
}
const { elements, osm3s } = JSON.parse(fs.readFileSync(input, 'utf8'));
const ways = elements.filter((e) => e.type === 'way' && e.geometry?.length >= 4);

const TYPES = ['yes', 'house', 'detached', 'bungalow', 'semidetached_house', 'terrace', 'apartments', 'residential', 'farm', 'cabin',
  'allotment_house', 'hut', 'garage', 'garages', 'shed', 'barn', 'farm_auxiliary', 'greenhouse', 'industrial', 'warehouse',
  'commercial', 'retail', 'office', 'church', 'chapel', 'school', 'kindergarten', 'hotel', 'public', 'civic', 'service',
  'bunker', 'ruins', 'roof', 'carport', 'boathouse', 'windmill', 'other'];
const ROOFS = ['', 'gabled', 'hipped', 'half-hipped', 'flat', 'skillion', 'pyramidal', 'mansard', 'gambrel', 'round', 'many', 'other'];
const MATERIALS = ['', 'thatch', 'roof_tiles', 'tar_paper', 'metal', 'concrete', 'glass', 'grass', 'slate', 'eternit', 'brick',
  'plaster', 'wood', 'stone', 'timber_framing', 'other'];
const code = (list, v) => (v === undefined ? 0 : list.indexOf(v) >= 0 ? list.indexOf(v) : list.length - 1);

let lat0 = 0;
let lon0 = 0;
for (const w of ways) {
  lat0 += w.geometry[0].lat;
  lon0 += w.geometry[0].lon;
}
lat0 = Math.round((lat0 / ways.length) * 1e4) / 1e4;
lon0 = Math.round((lon0 / ways.length) * 1e4) / 1e4;

const attrs = Buffer.alloc(ways.length * 8);
const counts = Buffer.alloc(ways.length * 2);
const coords = [];
ways.forEach((w, i) => {
  const t = w.tags ?? {};
  const levels = Math.min(255, Math.max(0, Math.round(Number(t['building:levels']) || 0)));
  const height = Math.min(65535, Math.max(0, Math.round((parseFloat(t.height) || 0) * 10)));
  attrs[i * 8] = code(TYPES, t.building);
  attrs[i * 8 + 1] = levels;
  attrs[i * 8 + 2] = code(ROOFS, t['roof:shape']);
  attrs[i * 8 + 3] = code(MATERIALS, t['roof:material']);
  attrs[i * 8 + 4] = code(MATERIALS, t['building:material']);
  attrs.writeUInt16LE(height, i * 8 + 5);
  let pts = w.geometry;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first.lat === last.lat && first.lon === last.lon) pts = pts.slice(0, -1);
  counts.writeUInt16LE(pts.length, i * 2);
  let pl = Math.round(lat0 * 1e7);
  let pn = Math.round(lon0 * 1e7);
  for (const p of pts) {
    const la = Math.round(p.lat * 1e7);
    const lo = Math.round(p.lon * 1e7);
    coords.push(la - pl, lo - pn);
    pl = la;
    pn = lo;
  }
});
const coordBuf = Buffer.alloc(coords.length * 4);
coords.forEach((v, i) => coordBuf.writeInt32LE(v, i * 4));
const header = Buffer.from(JSON.stringify({
  version: 1, count: ways.length, vertices: coords.length / 2, ref: [lat0, lon0], types: TYPES, roofs: ROOFS, materials: MATERIALS,
  osmBase: osm3s?.timestamp_osm_base ?? null, licence: 'ODbL 1.0, © OpenStreetMap contributors',
}));
const len = Buffer.alloc(4);
len.writeUInt32LE(header.length);
const body = Buffer.concat([len, header, attrs, counts, coordBuf]);
const gz = zlib.gzipSync(body, { level: 9 });
fs.writeFileSync(out, gz);
console.log(`wrote ${out}: ${ways.length} buildings, ${coords.length / 2} vertices, ${body.length} → ${gz.length} bytes (OSM ${osm3s?.timestamp_osm_base})`);
