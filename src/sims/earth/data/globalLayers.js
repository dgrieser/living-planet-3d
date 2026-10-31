/**
 * Date-driven global layers: whole-Earth textures in plate carrée (equirectangular, row 0 = north) that
 * the surface shader samples by latitude and longitude (docs/earth-sim/02 §3, §6, §7):
 *
 *  - **seasonal imagery** – NASA Blue Marble Next Generation, one composite per month (2004, 500 m,
 *    loaded at 4096 × 2048); the far view blends the two months around the date;
 *  - **snow** – MODIS/Terra monthly average snow cover (%) of the date's month, 2000 → now (NASA GIBS);
 *  - **sea ice** – AMSR-E / AMSR2 daily sea-ice concentration (%) of the date, 2002 → 2025 (NASA GIBS);
 *  - **night lights** – VIIRS Black Marble 2016 (NASA GIBS).
 *
 * GIBS serves colour-mapped PNG tiles; the colour maps (XML, also from GIBS) turn each colour back into
 * its value. Dates outside a product's record fall back to the same calendar month/day of the nearest
 * covered year – a climatology the model card owns up to.
 */
import * as THREE from 'three/webgpu';

const GIBS = 'https://gibs.earthdata.nasa.gov';
const BMNG = 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export const GLOBAL_LAYERS = Object.freeze({
  snow: {
    layer: 'MODIS_Terra_L3_Snow_Cover_Monthly_Average_Pct', matrixSet: '2km', level: 3, colormap: 'MODIS_NDSI_Snow_Cover',
    cadence: 'month', ranges: [['2000-03-01', '2026-09-01']],
  },
  seaIce: {
    layer: 'AMSRU2_Sea_Ice_Concentration_12km', matrixSet: '2km', level: 2, colormap: 'AMSR_Sea_Ice_Concentration',
    cadence: 'day', ranges: [['2002-06-01', '2011-10-04'], ['2012-07-02', '2025-09-01']],
  },
  lights: { layer: 'VIIRS_Black_Marble', matrixSet: '500m', level: 3, time: '2016-01-01' },
});

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * The product date to show for a simulated instant: the month's first day (monthly products) or the day,
 * moved into the covered record by whole years when the instant lies outside it.
 * @returns {{ date: string, climatology: boolean }}
 */
export function productDate(ms, { cadence, ranges }) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = cadence === 'month' ? 1 : d.getUTCDate();
  const inRange = (t) => ranges.some(([a, b]) => t >= Date.parse(a) && t <= Date.parse(b));
  const at = (year) => Date.UTC(year, m, Math.min(day, new Date(Date.UTC(year, m + 1, 0)).getUTCDate()));
  if (inRange(at(y))) return { date: iso(at(y)), climatology: false };
  for (let k = 1; k < 80; k++) {
    for (const year of [y - k, y + k]) {
      if (inRange(at(year))) return { date: iso(at(year)), climatology: true };
    }
  }
  return { date: ranges.at(-1)[1], climatology: true };
}

/** The two Blue Marble months around an instant and the blend between them (mid-month = pure). */
export function blueMarbleMonths(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const mid = (yy, mm) => Date.UTC(yy, mm, 15);
  let a = m;
  let aY = y;
  if (ms < mid(y, m)) {
    a = (m + 11) % 12;
    aY = m === 0 ? y - 1 : y;
  }
  const b = (a + 1) % 12;
  const t0 = mid(aY, a);
  const t1 = mid(a === 11 ? aY + 1 : aY, b);
  return { a, b, mix: Math.min(1, Math.max(0, (ms - t0) / (t1 - t0))) };
}

/** Parses a GIBS colour map (XML) into rgb-key → value (non-transparent entries with a single value). */
export function parseColormap(xml) {
  const map = new Map();
  const re = /<ColorMapEntry\s+([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    if (attrs.transparent === 'true' || !attrs.rgb || !attrs.value) continue;
    const v = Number(attrs.value.replace(/[[\]()]/g, '').split(',')[0]);
    if (!Number.isFinite(v)) continue;
    const [r, g, b] = attrs.rgb.split(',').map(Number);
    map.set((r << 16) | (g << 8) | b, v);
  }
  return map;
}

/** Tile layout of a GIBS EPSG:4326 level: 512 px tiles, 0.5625° per pixel at level 0. */
export function gibsLevel(level) {
  const res = 0.5625 / 2 ** level;
  const width = Math.round(360 / res);
  const height = Math.round(180 / res);
  return { res, width, height, cols: Math.ceil(width / 512), rows: Math.ceil(height / 512) };
}

/** 2 × 2 box-filtered mip chain of a single-channel image (level 0 included), down to 1 × 1. */
export function buildMips(data, width, height) {
  const levels = [{ data, width, height }];
  let src = data;
  let w = width;
  let h = height;
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1);
    const nh = Math.max(1, h >> 1);
    const dst = new Uint8Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      const y0 = Math.min(2 * y, h - 1) * w;
      const y1 = Math.min(2 * y + 1, h - 1) * w;
      for (let x = 0; x < nw; x++) {
        const x0 = Math.min(2 * x, w - 1);
        const x1 = Math.min(2 * x + 1, w - 1);
        dst[y * nw + x] = (src[y0 + x0] + src[y0 + x1] + src[y1 + x0] + src[y1 + x1] + 2) >> 2;
      }
    }
    levels.push({ data: dst, width: nw, height: nh });
    src = dst;
    w = nw;
    h = nh;
  }
  return levels;
}

// Single-channel layers bring their own mip chain, built on the CPU (a few ms), so the data texture and
// its placeholder are set up identically.
function makeR8(data, width, height) {
  const tex = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  // placeholders (1 × 1) get the same mipmapped sampler: a texture node keeps the sampler it was built
  // with when its texture is swapped
  tex.mipmaps = buildMips(data, width, height);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Loads and swaps the layers as the date changes. `nodes` are TSL texture nodes whose `.value` is
 * replaced when a newer texture is ready, so the shader graph never changes.
 * @param {{ onChange: () => void }} opts
 */
export function createGlobalLayers({ onChange }) {
  // one placeholder per layer: texture nodes built on the same texture object end up sharing a binding,
  // and swapping one layer would then swap them all
  const grey = () => {
    const t = new THREE.DataTexture(new Uint8Array([40, 60, 90, 255]), 1, 1);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  const placeholders = [makeR8(new Uint8Array([0]), 1, 1), makeR8(new Uint8Array([0]), 1, 1), makeR8(new Uint8Array([0]), 1, 1), grey(), grey()];
  const [snow0, ice0, lights0, bmngA0, bmngB0] = placeholders;
  const textures = { snow: snow0, seaIce: ice0, lights: lights0, bmngA: bmngA0, bmngB: bmngB0 };
  const state = { snow: null, seaIce: null, bmngA: null, bmngB: null, bmngMix: 0, climatology: { snow: false, seaIce: false } };
  const colormaps = new Map();
  const listeners = new Set();
  let disposed = false;
  const owned = new Set();

  function swap(key, tex) {
    if (disposed) {
      tex.dispose();
      return;
    }
    const old = textures[key];
    textures[key] = tex;
    owned.add(tex);
    if (old && owned.has(old) && !Object.values(textures).includes(old)) {
      owned.delete(old);
      old.dispose();
    }
    for (const fn of listeners) fn(key, tex);
    onChange?.();
  }

  async function colormap(name) {
    if (!colormaps.has(name)) {
      colormaps.set(name, fetch(`${GIBS}/colormaps/v1.3/${name}.xml`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))).then(parseColormap));
    }
    return colormaps.get(name);
  }

  /** Fetches a whole GIBS level into one canvas and returns its pixels. */
  async function fetchGibs(spec, date) {
    const { width, height, cols, rows } = gibsLevel(spec.level);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const jobs = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const url = `${GIBS}/wmts/epsg4326/best/${spec.layer}/default/${date}/${spec.matrixSet}/${spec.level}/${r}/${c}.png`;
        jobs.push(
          fetch(url)
            .then((res) => (res.ok ? res.blob() : null))
            .then((blob) => (blob ? createImageBitmap(blob) : null))
            .then((bmp) => {
              if (!bmp) return;
              ctx.drawImage(bmp, c * 512, r * 512);
              bmp.close();
            })
            .catch(() => {}),
        );
      }
    }
    await Promise.all(jobs);
    return { data: ctx.getImageData(0, 0, width, height).data, width, height };
  }

  async function loadValueLayer(key, date) {
    const spec = GLOBAL_LAYERS[key];
    const [cmap, img] = await Promise.all([colormap(spec.colormap), fetchGibs(spec, date)]);
    const { data, width, height } = img;
    const out = new Uint8Array(width * height);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) {
      if (data[j + 3] < 128) continue;
      const v = cmap.get((data[j] << 16) | (data[j + 1] << 8) | data[j + 2]);
      if (v !== undefined) out[i] = Math.round(Math.min(100, Math.max(0, v)) * 2.55);
    }
    return makeR8(out, width, height);
  }

  async function loadLights() {
    const spec = GLOBAL_LAYERS.lights;
    const { data, width, height } = await fetchGibs(spec, spec.time);
    const out = new Uint8Array(width * height);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = Math.max(data[j], data[j + 1], data[j + 2]);
    return makeR8(out, width, height);
  }

  async function loadBlueMarble(month) {
    const mm = String(month + 1).padStart(2, '0');
    const res = await fetch(`${BMNG}/${MONTHS[month]}/world.2004${mm}.3x5400x2700.jpg`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bmp = await createImageBitmap(await res.blob(), { resizeWidth: 4096, resizeHeight: 2048, resizeQuality: 'high' });
    const tex = new THREE.Texture(bmp);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false; // row 0 = north at v = 0 on both backends
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }

  const warn = (what) => (err) => console.warn(`[earth] ${what} unavailable:`, err?.message ?? err);
  let lightsStarted = false;
  const bmngCache = new Map(); // month → Promise<Texture>

  function blueMarble(month) {
    if (!bmngCache.has(month)) {
      const p = loadBlueMarble(month);
      p.then((tex) => owned.add(tex)).catch(() => bmngCache.delete(month));
      bmngCache.set(month, p);
    }
    return bmngCache.get(month);
  }

  return {
    textures,
    state,
    /** Calls fn(key, texture) whenever a layer's texture is replaced. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Brings the layers to the date (cheap when nothing changes; loads run in the background). */
    update(ms) {
      if (!lightsStarted) {
        lightsStarted = true;
        loadLights().then((t) => swap('lights', t), warn('night lights'));
      }
      for (const key of ['snow', 'seaIce']) {
        const { date, climatology } = productDate(ms, GLOBAL_LAYERS[key]);
        if (state[key] === date) continue;
        state[key] = date;
        state.climatology[key] = climatology;
        loadValueLayer(key, date).then((t) => {
          if (state[key] === date) swap(key, t);
          else t.dispose();
        }, warn(key));
      }
      const { a, b, mix } = blueMarbleMonths(ms);
      state.bmngMix = mix;
      if (state.bmngA !== a || state.bmngB !== b) {
        state.bmngA = a;
        state.bmngB = b;
        blueMarble(a).then((t) => state.bmngA === a && swap('bmngA', t), warn('Blue Marble'));
        blueMarble(b).then((t) => state.bmngB === b && swap('bmngB', t), warn('Blue Marble'));
        // keep at most the two months in use plus the next one in memory
        for (const [month, p] of bmngCache) {
          if (month !== a && month !== b && month !== (b + 1) % 12) {
            bmngCache.delete(month);
            p.then((t) => {
              if (!Object.values(textures).includes(t)) {
                owned.delete(t);
                t.dispose();
              }
            }, () => {});
          }
        }
      }
    },
    dispose() {
      disposed = true;
      listeners.clear();
      for (const t of owned) t.dispose();
      owned.clear();
      for (const t of placeholders) t.dispose();
    },
  };
}

