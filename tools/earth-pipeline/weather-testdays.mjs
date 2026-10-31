/**
 * Builds the weather verification fixture for milestone M6 (docs/earth-sim/12 §1.7):
 *
 *   node tools/earth-pipeline/weather-testdays.mjs [--radar-only]
 *
 * For a set of test instants it records, at the two hero stations, what the simulation reads – GFS cloud
 * cover, precipitation rate and 10 m wind (the run and step the sim would pick, decoded with our own GRIB2
 * decoder) and the Meteosat cloud mask / cloud-top height (EUMETView, read back like data/satellite.js) –
 * next to what was observed:
 *
 *   Fanø      DMI Esbjerg Lufthavn (06080): cloud cover, precipitation past hour, wind speed (open data API)
 *   Lübbecke  DWD Bad Salzuflen (04371, 23 km): cloud cover (octas) and wind; DWD Espelkamp-Isenstedt
 *             (03081, 5 km): precipitation; DWD radar composite (Niederschlagsradar WMS, kept ≈ 3 days)
 *
 * Writes scripts/fixtures/weather-testdays-2026.json; scripts/check-earth-weather.mjs scores it with the sim's
 * own fusion, rain gating and terrain correction (data/weatherCodes.js).
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { decodeGrib2 } from '../../src/sims/earth/data/grib2.js';
import { chooseGfsSteps, parseIdx, findMessage, sampleField } from '../../src/sims/earth/data/gfs.js';
import { packSatellite, SATELLITE } from '../../src/sims/earth/data/satellite.js';
import { decodeCloudTop } from '../../src/sims/earth/data/weatherCodes.js';

const H = 3600000;
const BUCKET = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com';
const STATIONS = {
  fanoe: { name: 'Esbjerg Lufthavn (DMI 06080)', latDeg: 55.5281, lonDeg: 8.5626, heightM: 25 },
  luebbecke: { name: 'Bad Salzuflen (DWD 04371)', latDeg: 52.1042, lonDeg: 8.7521, heightM: 135, rain: { name: 'Espelkamp-Isenstedt (DWD 03081)', latDeg: 52.3452, lonDeg: 8.6477 } },
};
// test days across the year (fog, storm, showers, fronts, a cumulus day, quiet days), every three hours
const DAYS = ['2026-01-13', '2026-02-24', '2026-03-18', '2026-04-05', '2026-05-20', '2026-06-09', '2026-07-24', '2026-08-23', '2026-09-04', '2026-10-15'];
const MAIN = DAYS.flatMap((d) => [0, 3, 6, 9, 12, 15, 18, 21].map((h) => Date.parse(`${d}T00:00:00Z`) + h * H));
// the radar keeps about three days: hourly instants of the last ones
const RADAR_FROM = Date.UTC(2026, 9, 29, 1);
const RADAR_TO = Date.UTC(2026, 9, 31, 12);
const RADAR = [];
for (let t = RADAR_FROM; t <= RADAR_TO; t += H) RADAR.push(t);
const FIELDS = [['LCDC', 'low cloud layer'], ['MCDC', 'middle cloud layer'], ['HCDC', 'high cloud layer'], ['PRATE', 'surface'], ['UGRD', '10 m above ground'], ['VGRD', '10 m above ground']];

// --- small decoders ----------------------------------------------------------------------------------------------------
/** Minimal PNG decoder: 8-bit RGBA / RGB / palette (+tRNS), not interlaced → RGBA bytes. */
function decodePng(buf) {
  let o = 8;
  let w = 0;
  let h = 0;
  let type = 0;
  let palette = null;
  let trns = null;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const kind = buf.toString('latin1', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('PNG: only 8-bit, non-interlaced');
      type = data[9];
    } else if (kind === 'PLTE') palette = data;
    else if (kind === 'tRNS') trns = data;
    else if (kind === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = type === 6 ? 4 : type === 2 ? 3 : 1;
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let p = v;
      if (f === 1) p = v + a;
      else if (f === 2) p = v + b;
      else if (f === 3) p = v + ((a + b) >> 1);
      else if (f === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      px[y * stride + x] = p & 255;
    }
  }
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (type === 6) out.set(px.subarray(i * 4, i * 4 + 4), i * 4);
    else if (type === 2) out.set([px[i * 3], px[i * 3 + 1], px[i * 3 + 2], 255], i * 4);
    else {
      const k = px[i];
      out.set([palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2], trns && k < trns.length ? trns[k] : 255], i * 4);
    }
  }
  return { data: out, w, h };
}

/** The first file of a zip archive whose name matches. */
function unzip(buf, re) {
  let o = 0;
  while (buf.readUInt32LE(o) === 0x04034b50) {
    const method = buf.readUInt16LE(o + 8);
    const size = buf.readUInt32LE(o + 18);
    const nameLen = buf.readUInt16LE(o + 26);
    const extra = buf.readUInt16LE(o + 28);
    const name = buf.toString('latin1', o + 30, o + 30 + nameLen);
    const start = o + 30 + nameLen + extra;
    if (re.test(name)) {
      const body = buf.subarray(start, start + size);
      return (method === 8 ? zlib.inflateRawSync(body) : body).toString('latin1');
    }
    o = start + size;
  }
  throw new Error('zip entry not found');
}

async function fetchOk(url, opts) {
  for (let k = 0; k < 4; k++) {
    try {
      const res = await fetch(url, opts);
      if (res.ok) return res;
      if (res.status === 404) throw new Error(`404 ${url}`);
    } catch (err) {
      if (String(err.message).startsWith('404') || k === 3) throw err;
    }
    await new Promise((r) => setTimeout(r, 1500 * (k + 1)));
  }
  throw new Error(`failed ${url}`);
}

// --- GFS --------------------------------------------------------------------------------------------------------------
function gfsUrl(run, step) {
  const d = new Date(run);
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  return `${BUCKET}/gfs.${ymd}/${hh}/atmos/gfs.t${hh}z.pgrb2.0p25.f${String(step).padStart(3, '0')}`;
}

async function gfsAt(ms, fields = FIELDS) {
  const c = chooseGfsSteps(ms, { latestRun: Infinity });
  const url = gfsUrl(c.run, c.steps[0]);
  const entries = parseIdx(await (await fetchOk(`${url}.idx`)).text());
  const values = await Promise.all(fields.map(async ([v, level]) => {
    const r = findMessage(entries, v, level);
    const res = await fetchOk(url, { headers: { Range: `bytes=${r.start}-${r.end}` } });
    return decodeGrib2(new Uint8Array(await res.arrayBuffer()));
  }));
  const at = (g, s) => sampleField(g.values, g.ni, g.nj, s.latDeg, s.lonDeg);
  const out = { run: c.run, step: c.steps[0] };
  for (const [id, s] of Object.entries(STATIONS)) {
    const point = {};
    fields.forEach(([v], i) => {
      point[v] = at(values[i], v === 'PRATE' && s.rain ? s.rain : s);
    });
    out[id] = { low: point.LCDC / 100, middle: point.MCDC / 100, high: point.HCDC / 100, precip: point.PRATE * 3600, u10: point.UGRD, v10: point.VGRD };
  }
  return out;
}

// --- satellite --------------------------------------------------------------------------------------------------------
const SAT_BOX = { south: 51.5, north: 56.5, west: 7.5, east: 9.75 }; // both hero areas, 0.05° pixels
async function satelliteAt(ms) {
  const slot = Math.round(ms / SATELLITE.slotMs) * SATELLITE.slotMs;
  const w = Math.round((SAT_BOX.east - SAT_BOX.west) / 0.05);
  const h = Math.round((SAT_BOX.north - SAT_BOX.south) / 0.05);
  const url = (layer) => `${SATELLITE.url}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}&STYLES=&CRS=EPSG:4326&BBOX=${SAT_BOX.south},${SAT_BOX.west},${SAT_BOX.north},${SAT_BOX.east}&WIDTH=${w}&HEIGHT=${h}&FORMAT=image/png&TRANSPARENT=true&TIME=${new Date(slot).toISOString()}`;
  const [mask, top] = await Promise.all([SATELLITE.mask, SATELLITE.top].map(async (l) => decodePng(Buffer.from(await (await fetchOk(url(l))).arrayBuffer()))));
  const packed = packSatellite(mask.data, mask.w, mask.h, top.data, top.w, top.h);
  const out = {};
  for (const [id, s] of Object.entries(STATIONS)) {
    const px = Math.floor(((s.lonDeg - SAT_BOX.west) / (SAT_BOX.east - SAT_BOX.west)) * w);
    const py = Math.floor(((SAT_BOX.north - s.latDeg) / (SAT_BOX.north - SAT_BOX.south)) * h);
    const i = (py * w + px) * 4;
    // the cloudy share within ≈ 15 km (what a station's sky sees)
    let n = 0;
    let cloudy = 0;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const k = ((py + dy) * w + px + dx) * 4;
        if (packed.data[k + 2] > 0) {
          n++;
          if (packed.data[k] > 0) cloudy++;
        }
      }
    }
    out[id] = { cloud: packed.data[i] / 255, topM: decodeCloudTop(packed.data[i + 1]), valid: packed.data[i + 2] / 255, frac: n ? cloudy / n : null };
  }
  return out;
}

// --- radar (DWD Niederschlagsradar: transparent inside the coverage = dry, colours = echo, grey = no coverage) ----------
async function radarAt(ms) {
  const s = STATIONS.luebbecke.rain;
  const b = { south: s.latDeg - 0.08, north: s.latDeg + 0.08, west: s.lonDeg - 0.13, east: s.lonDeg + 0.13 };
  const url = `https://maps.dwd.de/geoserver/dwd/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=dwd:Niederschlagsradar&STYLES=&CRS=EPSG:4326&BBOX=${b.south},${b.west},${b.north},${b.east}&WIDTH=18&HEIGHT=18&FORMAT=image/png&TRANSPARENT=true&TIME=${new Date(ms).toISOString()}`;
  const res = await fetchOk(url);
  if (!(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
  const png = decodePng(Buffer.from(await res.arrayBuffer()));
  let wet = 0;
  let n = 0;
  for (let i = 0; i < png.w * png.h; i++) {
    const [r, g, bl, a] = png.data.subarray(i * 4, i * 4 + 4);
    const grey = a >= 128 && Math.abs(r - g) < 10 && Math.abs(g - bl) < 10 && r > 150;
    if (grey) continue; // outside the coverage
    n++;
    if (a >= 128) wet++;
  }
  return n ? wet / n : null;
}

// --- stations ----------------------------------------------------------------------------------------------------------
async function dmi(param, from, to) {
  const res = await fetchOk(`https://opendataapi.dmi.dk/v2/metObs/collections/observation/items?stationId=06080&parameterId=${param}&datetime=${new Date(from).toISOString().slice(0, 19)}Z/${new Date(to).toISOString().slice(0, 19)}Z&limit=300000`);
  const map = new Map();
  for (const f of (await res.json()).features) map.set(Date.parse(f.properties.observed), f.properties.value);
  return map;
}

async function dwd(kind, prefix, station, column) {
  const url = `https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/hourly/${kind}/recent/stundenwerte_${prefix}_${station}_akt.zip`;
  const text = unzip(Buffer.from(await (await fetchOk(url)).arrayBuffer()), /^produkt/);
  const [head, ...rows] = text.trim().split(/\r?\n/);
  const cols = head.split(';').map((c) => c.trim());
  const ti = cols.indexOf('MESS_DATUM');
  const vi = cols.indexOf(column);
  const map = new Map();
  for (const r of rows) {
    const c = r.split(';');
    const d = c[ti].trim();
    const v = Number(c[vi]);
    // DWD hours are UTC and mark the end of the hour (MESS_DATUM yyyymmddhh)
    if (v > -999) map.set(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(8, 10)), v);
  }
  return map;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i], i);
      } catch (err) {
        console.warn(`  ${new Date(items[i]).toISOString()}: ${err.message}`);
        out[i] = null;
      }
    }
  }));
  return out;
}

// --- main ----------------------------------------------------------------------------------------------------------------
const FIXTURE = new URL('../../scripts/fixtures/weather-testdays-2026.json', import.meta.url);
if (process.argv.includes('--radar-only')) {
  // refresh only the radar of an existing fixture (the radar archive is short)
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  for (const r of fx.records) if (r.set === 'radar') r.radar = await radarAt(Date.parse(r.t)).catch(() => null);
  fs.writeFileSync(FIXTURE, JSON.stringify(fx, null, 1) + '\n');
  console.log(`radar: ${fx.records.filter((r) => r.set === 'radar' && r.radar !== null).length} instants`);
  process.exit(0);
}
const all = [...MAIN, ...RADAR];
const from = Math.min(...all) - 2 * H;
const to = Math.max(...all) + 2 * H;
console.log(`stations…`);
const [dCloud, dRain, dWind, wCloud, wWind, wRain] = await Promise.all([
  dmi('cloud_cover', from, to), dmi('precip_past1h', from, to), dmi('wind_speed', from, to),
  dwd('cloudiness', 'N', '04371', 'V_N'), dwd('wind', 'FF', '04371', 'F'), dwd('precipitation', 'RR', '03081', 'R1'),
]);
console.log(`model heights…`);
const oro = await (async () => {
  const c = chooseGfsSteps(MAIN[0], { latestRun: Infinity });
  const url = gfsUrl(c.run, c.steps[0]);
  const entries = parseIdx(await (await fetchOk(`${url}.idx`)).text());
  const r = findMessage(entries, 'HGT', 'surface');
  const g = decodeGrib2(new Uint8Array(await (await fetchOk(url, { headers: { Range: `bytes=${r.start}-${r.end}` } })).arrayBuffer()));
  return Object.fromEntries(Object.entries(STATIONS).map(([id, s]) => [id, sampleField(g.values, g.ni, g.nj, s.latDeg, s.lonDeg)]));
})();
console.log(`GFS and satellite at ${all.length} instants…`);
let done = 0;
const records = await pool(all, 4, async (t) => {
  const [gfs, sat] = await Promise.all([gfsAt(t), satelliteAt(t).catch(() => null)]);
  const radar = t >= RADAR_FROM ? await radarAt(t).catch(() => null) : undefined;
  if (++done % 10 === 0) console.log(`  ${done}/${all.length}`);
  // precipitation: the hours ending at t and at t + 1 h (the model's rate is instantaneous)
  const pair = (m) => [m.get(t) ?? null, m.get(t + H) ?? null];
  const dc = dCloud.get(t);
  const obs = {
    fanoe: { cloud: dc !== undefined && dc <= 100 ? dc : null, precip: pair(dRain), wind: dWind.get(t) ?? null },
    luebbecke: { cloud: wCloud.has(t) && wCloud.get(t) <= 8 ? (wCloud.get(t) / 8) * 100 : null, precip: pair(wRain), wind: wWind.get(t) ?? null },
  };
  return { t: new Date(t).toISOString(), set: t >= RADAR_FROM ? 'radar' : 'main', run: new Date(gfs.run).toISOString(), step: gfs.step, gfs: { fanoe: gfs.fanoe, luebbecke: gfs.luebbecke }, sat, radar, obs };
});
const out = {
  note: 'M6 weather verification – built by tools/earth-pipeline/weather-testdays.mjs; GFS (NOAA), Meteosat cloud mask/top (© EUMETSAT, CC BY 4.0), DMI (CC BY 4.0) and DWD (CC BY 4.0) observations',
  stations: Object.fromEntries(Object.entries(STATIONS).map(([id, s]) => [id, { ...s, modelHeight: oro[id] }])),
  records: records.filter(Boolean),
};
fs.writeFileSync(FIXTURE, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${out.records.length} records`);
