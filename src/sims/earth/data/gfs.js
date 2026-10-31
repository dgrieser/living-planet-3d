/**
 * Global clouds from NOAA's GFS (docs/earth-sim/08 §3.1): low, middle and high cloud cover (%), read
 * straight from the NOAA Open Data bucket on AWS (CORS open, byte ranges). Each GFS file comes with an
 * index (.idx) of byte offsets, so a time step costs three range requests of ≈ 0.8 MB each at 0.25°.
 *
 * Which run and step show an instant:
 *  - the past (from Jan 2021, the start of the bucket): the run 1–6 h before the instant – the freshest
 *    short forecast, closest to what the satellites saw;
 *  - the future: the latest complete run, hourly to +120 h, three-hourly to +384 h;
 *  - between two steps the two fields are blended in the shader.
 * Two sets per step (M6):
 *  - **cover** (always): low, middle and high cloud cover – the global cloud layer and the volumetric clouds;
 *  - **local** (only while the camera is low, ≈ 6 MB a step): precipitation rate and type, cloud ceiling,
 *    convective cloud cover, 10 m wind, 2 m temperature, visibility and the model's ground height – rain
 *    shafts, wet ground, cloud bases, fog, the wind in the trees and on the water, and the weather readout.
 * Server-side baking (an archive beyond the bucket, 3D cloud fields) stays pipeline work (docs/earth-sim/11).
 */
import * as THREE from 'three/webgpu';

const BUCKET = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com';
const H = 3600000;
/** First run in the bucket. */
export const GFS_START = Date.UTC(2021, 0, 1);
/** GFS v16 (22 Mar 2021, 12 UTC) moved the files into an `atmos/` folder. */
const ATMOS_FOLDER_FROM = Date.UTC(2021, 2, 22, 12);
export const CLOUD_FIELDS = Object.freeze([
  ['LCDC', 'low cloud layer'],
  ['MCDC', 'middle cloud layer'],
  ['HCDC', 'high cloud layer'],
]);
/** The weather near the ground, in the order data/gfsWorker.js expects; missing messages are tolerated. */
export const LOCAL_FIELDS = Object.freeze([
  ['PRATE', 'surface'],
  ['CRAIN', 'surface'],
  ['CSNOW', 'surface'],
  ['CFRZR', 'surface'],
  ['CICEP', 'surface'],
  ['HGT', 'cloud ceiling'],
  ['TCDC', 'convective cloud layer'],
  ['UGRD', '10 m above ground'],
  ['VGRD', '10 m above ground'],
  ['TMP', '2 m above ground'],
  ['VIS', 'surface'],
  ['HGT', 'surface'], // the model's own (smooth) ground height – for the terrain correction of wind and temperature
]);

/**
 * The run and the two steps (hours) that bracket an instant, with the blend between them; null outside
 * the archive and the forecast range.
 */
export function chooseGfsSteps(ms, { latestRun }) {
  if (ms < GFS_START + H) return null;
  let run = Math.floor((ms - H) / (6 * H)) * 6 * H;
  if (run > latestRun) run = latestRun;
  const f = (ms - run) / H;
  let s0;
  let s1;
  if (f < 120) {
    s0 = Math.floor(f);
    s1 = s0 + 1;
  } else {
    s0 = Math.floor(f / 3) * 3;
    s1 = s0 + 3;
  }
  if (s1 > 384) {
    if (f > 384) return null;
    s1 = 384;
    s0 = 381;
  }
  return { run, steps: [s0, s1], mix: Math.min(1, Math.max(0, (f - s0) / (s1 - s0))) };
}

/** Parses a GFS .idx file into [{ start, variable, level, time }] in file order. */
export function parseIdx(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [, start, , variable, level, time] = line.split(':');
      return { start: Number(start), variable, level, time: time ?? '' };
    });
}

/** Byte range of the instantaneous (not time-averaged) message of a variable at a level. */
export function findMessage(entries, variable, level) {
  const i = entries.findIndex((e) => e.variable === variable && e.level === level && !/ave|acc/.test(e.time));
  if (i < 0) return null;
  return { start: entries[i].start, end: i + 1 < entries.length ? entries[i + 1].start - 1 : null };
}

function fileUrl(run, step, res) {
  const d = new Date(run);
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const folder = run >= ATMOS_FOLDER_FROM ? `${hh}/atmos` : hh;
  return `${BUCKET}/gfs.${ymd}/${folder}/gfs.t${hh}z.pgrb2.${res}.f${String(step).padStart(3, '0')}`;
}

/**
 * Bilinear sample of an RGBA8 global grid (rows from 90° N, node-centred, columns east from 0°, wrapping)
 * at a latitude/longitude in degrees; channel c → 0…255.
 */
export function sampleGrid(data, width, height, latDeg, lonDeg, c) {
  const x = ((((lonDeg % 360) + 360) % 360) / 360) * width;
  const y = Math.min(height - 1, Math.max(0, ((90 - latDeg) / 180) * (height - 1)));
  const x0 = Math.floor(x) % width;
  const x1 = (x0 + 1) % width;
  const y0 = Math.floor(y);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = x - Math.floor(x);
  const fy = y - y0;
  const at = (i, j) => data[(j * width + i) * 4 + c];
  return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
}

/** Bilinear sample of a single-channel global grid (same layout). */
export function sampleField(data, width, height, latDeg, lonDeg) {
  const x = ((((lonDeg % 360) + 360) % 360) / 360) * width;
  const y = Math.min(height - 1, Math.max(0, ((90 - latDeg) / 180) * (height - 1)));
  const x0 = Math.floor(x) % width;
  const x1 = (x0 + 1) % width;
  const y0 = Math.floor(y);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = x - Math.floor(x);
  const fy = y - y0;
  const at = (i, j) => data[j * width + i];
  return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
}

/** Size of the 0.25° grid and the layers of the weather texture. */
export const GFS_GRID = Object.freeze({ width: 1440, height: 721 });
export const WEATHER_LAYERS = Object.freeze({ a: 0, b: 1, la: 2, lb: 3 });

/**
 * The GFS loader. `weather` is one 2D array texture (a single binding – the terrain shader is near the
 * 16-texture limit) with four RGBA8 layers: the cover of the two bracketing steps (0, 1: R low, G middle,
 * B high) and their local weather (2, 3: R precipitation, G snow fraction, B ceiling, A convective cover –
 * data/weatherCodes.js); `state.mix` blends the steps.
 * @param {{ onChange: () => void }} opts
 */
export function createGfsWeather({ onChange, resolution = '0p25' }) {
  const { width: GW, height: GH } = GFS_GRID;
  const layerBytes = GW * GH * 4;
  const bytes = new Uint8Array(layerBytes * 4);
  // no cloud; no precipitation, no snow, ceiling "none" (255), no convection
  for (let i = layerBytes * 2 + 2; i < bytes.length; i += 4) bytes[i] = 255;
  const weather = new THREE.DataArrayTexture(bytes, GW, GH, 4);
  weather.wrapS = THREE.RepeatWrapping;
  weather.wrapT = THREE.ClampToEdgeWrapping;
  weather.magFilter = THREE.LinearFilter;
  weather.minFilter = THREE.LinearFilter;
  weather.generateMipmaps = false;
  weather.needsUpdate = true;
  const layers = { a: null, b: null, la: null, lb: null }; // CPU copies for point samples
  const state = {
    run: null, steps: null, mix: 0, available: false, latestRun: null, loading: false,
    localAvailable: false, localLoading: false,
  };
  const listeners = new Set();
  const cache = new Map(); // `${kind}|${run}|${step}` → Promise<{ data, width, height, surface? }|null>
  const indexCache = new Map(); // `${run}|${step}` → Promise<{ base, entries }>
  let worker = null;
  let jobId = 0;
  const pending = new Map();
  let latestRunPromise = null;
  let latestRunProbed = 0;
  let wanted = '';
  let wantedLocal = '';
  let localKey = ''; // the steps the local layers show
  let localRetry = { key: '', at: 0 };
  let disposed = false;

  function decode(kind, buffers) {
    worker ??= new Worker(new URL('./gfsWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const { id, result, error } = ev.data;
      const p = pending.get(id);
      pending.delete(id);
      if (p) (error ? p.reject(new Error(error)) : p.resolve(result));
    };
    const id = ++jobId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, kind, buffers }, buffers.filter(Boolean));
    });
  }

  /** The most recent run whose last step is published (probes the last few runs; again after 30 min). */
  function latestRun() {
    if (latestRunPromise && performance.now() - latestRunProbed > 30 * 60000) latestRunPromise = null;
    latestRunPromise ??= (async () => {
      latestRunProbed = performance.now();
      const now = Date.now();
      // a run is complete about 5 h after its nominal time; start there to spare the server 404s
      let run = Math.floor((now - 5 * H) / (6 * H)) * 6 * H;
      for (let k = 0; k < 6; k++, run -= 6 * H) {
        try {
          // the bucket allows GET only (no HEAD in its CORS rules): ask for one byte
          const res = await fetch(`${fileUrl(run, 384, resolution)}.idx`, { headers: { Range: 'bytes=0-0' } });
          if (res.ok) return run;
        } catch {
          // keep looking
        }
      }
      return Math.floor(now / (6 * H)) * 6 * H - 24 * H;
    })();
    return latestRunPromise;
  }

  function stepIndex(run, step) {
    const key = `${run}|${step}`;
    if (!indexCache.has(key)) {
      const p = (async () => {
        const url = fileUrl(run, step, resolution);
        let idxRes = await fetch(`${url}.idx`);
        let base = url;
        if (!idxRes.ok && run < ATMOS_FOLDER_FROM + 7 * 24 * H) {
          // around the folder change, try the other layout
          const d = new Date(run);
          const hh = String(d.getUTCHours()).padStart(2, '0');
          base = url.includes('/atmos/') ? url.replace(`/${hh}/atmos/`, `/${hh}/`) : url.replace(`/${hh}/gfs.`, `/${hh}/atmos/gfs.`);
          idxRes = await fetch(`${base}.idx`);
        }
        if (!idxRes.ok) throw new Error(`no GFS index (${idxRes.status})`);
        return { base, entries: parseIdx(await idxRes.text()) };
      })();
      p.catch(() => indexCache.delete(key));
      indexCache.set(key, p);
      while (indexCache.size > 16) indexCache.delete(indexCache.keys().next().value);
    }
    return indexCache.get(key);
  }

  async function loadStep(kind, run, step) {
    const { base, entries } = await stepIndex(run, step);
    const fields = kind === 'local' ? LOCAL_FIELDS : CLOUD_FIELDS;
    const ranges = fields.map(([v, level]) => findMessage(entries, v, level));
    if (kind === 'cover' && ranges.some((r) => !r || r.end === null)) throw new Error('cloud fields missing from the GFS index');
    if (kind === 'local' && ranges.every((r) => !r)) throw new Error('weather fields missing from the GFS index');
    const buffers = await Promise.all(
      ranges.map((r) => (!r || r.end === null ? null : fetch(base, { headers: { Range: `bytes=${r.start}-${r.end}` } }).then((res) => {
        if (!res.ok) throw new Error(`GFS range ${res.status}`);
        return res.arrayBuffer();
      }))),
    );
    const out = await decode(kind, buffers);
    if (out.width !== GW || out.height !== GH) throw new Error(`unexpected GFS grid ${out.width}×${out.height}`);
    return { data: out.rgba, width: out.width, height: out.height, surface: out.surface ? { ...out.surface, width: out.surfaceWidth, height: out.surfaceHeight } : null };
  }

  function step(kind, run, s) {
    const key = `${kind}|${run}|${s}`;
    if (!cache.has(key)) {
      const p = loadStep(kind, run, s).catch((err) => {
        console.warn(`[earth] GFS ${kind} unavailable:`, err?.message ?? err);
        cache.delete(key);
        return null;
      });
      cache.set(key, p);
      // keep the last six steps of each kind (4 MB each)
      const ofKind = [...cache.keys()].filter((k) => k.startsWith(`${kind}|`));
      for (let i = 0; i < ofKind.length - 6; i++) cache.delete(ofKind[i]);
    }
    return cache.get(key);
  }

  /** Copies loaded steps into their layers (one upload for all of them). */
  function swap(entries) {
    if (disposed) return;
    for (const [slot, step] of entries) {
      if (!step) continue;
      layers[slot] = step;
      bytes.set(step.data, WEATHER_LAYERS[slot] * layerBytes);
    }
    weather.needsUpdate = true;
    for (const fn of listeners) fn();
    onChange?.();
  }

  async function loadLocal(choice) {
    const key = `${choice.run}|${choice.steps.join(',')}`;
    if (key === wantedLocal || (key === localRetry.key && performance.now() < localRetry.at)) return;
    wantedLocal = key;
    state.localLoading = true;
    const [a, b] = await Promise.all(choice.steps.map((s) => step('local', choice.run, s)));
    if (wantedLocal !== key || disposed) return;
    state.localLoading = false;
    if (!(a && b)) {
      // try again in half a minute (not every frame)
      wantedLocal = '';
      localRetry = { key, at: performance.now() + 30000 };
      return;
    }
    localKey = key;
    state.localAvailable = true;
    swap([['la', a], ['lb', b]]);
  }

  /** Point values at a latitude/longitude (degrees), blended between the two steps; null before the data. */
  function sample(latDeg, lonDeg) {
    if (!state.available || !layers.a || !layers.b) return null;
    const m = state.mix;
    const blend = (A, B, c) => sampleGrid(A.data, A.width, A.height, latDeg, lonDeg, c) * (1 - m) + sampleGrid(B.data, B.width, B.height, latDeg, lonDeg, c) * m;
    const out = {
      low: blend(layers.a, layers.b, 0) / 255,
      middle: blend(layers.a, layers.b, 1) / 255,
      high: blend(layers.a, layers.b, 2) / 255,
      local: false,
    };
    const la = layers.la;
    const lb = layers.lb;
    if (state.localAvailable && localKey === wanted && la?.surface && lb?.surface) {
      const sa = la.surface;
      const sb = lb.surface;
      const f = (k) => sampleField(sa[k], sa.width, sa.height, latDeg, lonDeg) * (1 - m) + sampleField(sb[k], sb.width, sb.height, latDeg, lonDeg) * m;
      Object.assign(out, {
        local: true,
        precipCode: blend(la, lb, 0),
        snow: blend(la, lb, 1) / 255,
        ceilingCode: blend(la, lb, 2),
        convective: blend(la, lb, 3) / 255,
        u10: f('u10'),
        v10: f('v10'),
        t2: f('t2') - 273.15,
        visibility: f('vis'),
        modelHeight: f('oro'),
      });
    }
    return out;
  }

  return {
    weather,
    state,
    sample,
    /** True when the local textures show the current steps. */
    get localCurrent() {
      return state.localAvailable && localKey === wanted;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /**
     * Brings the weather to an instant; loads run in the background, the blend updates at once.
     * `local` asks for the near-ground set too (the camera is low enough to see it).
     */
    async update(ms, { local = false } = {}) {
      if (disposed) return;
      const latest = await latestRun();
      state.latestRun = latest;
      const choice = chooseGfsSteps(ms, { latestRun: latest });
      if (!choice) {
        state.available = false;
        state.localAvailable = false;
        state.run = null;
        return;
      }
      state.mix = choice.mix;
      const key = `${choice.run}|${choice.steps.join(',')}`;
      if (local) loadLocal(choice);
      if (key === wanted) return;
      wanted = key;
      state.loading = true;
      const [a, b] = await Promise.all(choice.steps.map((s) => step('cover', choice.run, s)));
      if (wanted !== key || disposed) return;
      state.loading = false;
      state.available = !!(a && b);
      state.run = choice.run;
      state.steps = choice.steps;
      swap([['a', a], ['b', b]]);
    },
    dispose() {
      disposed = true;
      worker?.terminate();
      listeners.clear();
      cache.clear();
      weather.dispose();
    },
  };
}
