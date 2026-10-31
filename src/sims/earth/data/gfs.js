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
 * This is the "2D first" cloud layer of the plan: the server-side weather baker (3D cloud fields, satellite
 * correction) is milestone M6.
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
 * The cloud loader. `textures.a` / `textures.b` hold the two bracketing steps as RGBA8 (R low, G middle,
 * B high cover, rows north → south from 90°, columns east from 0°); `mix` blends them.
 * @param {{ onChange: () => void, resolution?: '0p25' | '0p50' | '1p00' }} opts
 */
export function createGfsClouds({ onChange, resolution = '0p25' }) {
  // placeholders carry the same sampler settings as the real textures: a texture node keeps the sampler
  // it was built with when its texture is swapped
  const empty = () => {
    const t = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  const placeholders = [empty(), empty()];
  const textures = { a: placeholders[0], b: placeholders[1] };
  const state = { run: null, steps: null, mix: 0, available: false, latestRun: null, loading: false };
  const listeners = new Set();
  const cache = new Map(); // `${run}|${step}` → Promise<DataTexture|null>
  let worker = null;
  let jobId = 0;
  const pending = new Map();
  let latestRunPromise = null;
  let wanted = '';
  let disposed = false;

  function decode(buffers) {
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
      worker.postMessage({ id, buffers }, buffers);
    });
  }

  /** The most recent run whose last step is published (probes the last few runs). */
  function latestRun() {
    latestRunPromise ??= (async () => {
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

  async function loadStep(run, step) {
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
    const entries = parseIdx(await idxRes.text());
    const ranges = CLOUD_FIELDS.map(([v, level]) => findMessage(entries, v, level));
    if (ranges.some((r) => !r || r.end === null)) throw new Error('cloud fields missing from the GFS index');
    const buffers = await Promise.all(
      ranges.map((r) => fetch(base, { headers: { Range: `bytes=${r.start}-${r.end}` } }).then((res) => {
        if (!res.ok) throw new Error(`GFS range ${res.status}`);
        return res.arrayBuffer();
      })),
    );
    const { rgba, width, height } = await decode(buffers);
    const tex = new THREE.DataTexture(rgba, width, height);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  function step(run, s) {
    const key = `${run}|${s}`;
    if (!cache.has(key)) {
      const p = loadStep(run, s).catch((err) => {
        console.warn('[earth] GFS clouds unavailable:', err?.message ?? err);
        cache.delete(key);
        return null;
      });
      cache.set(key, p);
      // keep the last eight steps
      while (cache.size > 8) {
        const [oldKey, oldP] = cache.entries().next().value;
        cache.delete(oldKey);
        oldP.then((t) => t && !Object.values(textures).includes(t) && t.dispose());
      }
    }
    return cache.get(key);
  }

  function swap(slot, tex) {
    if (disposed || !tex) return;
    textures[slot] = tex;
    for (const fn of listeners) fn(slot, tex);
    onChange?.();
  }

  return {
    textures,
    state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Brings the clouds to an instant; loads run in the background, the blend updates at once. */
    async update(ms) {
      if (disposed) return;
      const latest = state.latestRun ?? (await latestRun());
      state.latestRun = latest;
      const choice = chooseGfsSteps(ms, { latestRun: latest });
      if (!choice) {
        state.available = false;
        state.run = null;
        return;
      }
      state.mix = choice.mix;
      const key = `${choice.run}|${choice.steps.join(',')}`;
      if (key === wanted) return;
      wanted = key;
      state.loading = true;
      const [a, b] = await Promise.all(choice.steps.map((s) => step(choice.run, s)));
      if (wanted !== key || disposed) return;
      state.loading = false;
      state.available = !!(a && b);
      state.run = choice.run;
      state.steps = choice.steps;
      swap('a', a);
      swap('b', b);
    },
    dispose() {
      disposed = true;
      worker?.terminate();
      listeners.clear();
      for (const p of cache.values()) p.then((t) => t?.dispose());
      cache.clear();
      for (const t of placeholders) t.dispose();
    },
  };
}
