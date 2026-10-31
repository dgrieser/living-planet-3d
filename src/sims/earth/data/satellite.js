/**
 * Where the satellite saw cloud (docs/earth-sim/08 §3.3, satellite–model fusion): EUMETSAT's Meteosat
 * (MSG, 0° position) cloud mask and cloud-top height, every 15 minutes since September 2020, from the
 * EUMETView map service (CORS open). The renderings are read back to values: the mask's three colours,
 * the cloud-top height through its legend (data/weatherCodes.js).
 *
 * One Europe-wide image per 15-minute slot, packed into an RGBA8 texture over the box below:
 *   R cloud (0 / 255) · G cloud-top height (encodeCloudTop) · B valid (inside the disc, data present) · A 255.
 * The clouds (render/clouds.js) keep the model's vertical structure and take the placement from here:
 * satellite clear thins the model's cloud, satellite cloudy fills it in up to the observed top.
 */
import * as THREE from 'three/webgpu';
import { classifyCloudMask, cloudTopHeight, encodeCloudTop, decodeCloudTop } from './weatherCodes.js';

export const SATELLITE = Object.freeze({
  url: 'https://view.eumetsat.int/geoserver/wms',
  mask: 'msg_fes:clm',
  top: 'msg_fes:cth',
  box: Object.freeze({ south: 30, north: 72, west: -30, east: 45 }),
  width: 1500, // 0.05° ≈ the MSG pixel over Europe
  height: 840,
  slotMs: 15 * 60000,
  start: Date.UTC(2020, 8, 1),
  latencyMs: 25 * 60000, // a slot appears on EUMETView ≈ 20 min after its time
  /** the satellite counts fully within ±20 min of its slot and fades out by ±60 min */
  fullMs: 20 * 60000,
  fadeMs: 60 * 60000,
});

/** The slot (ms) that shows an instant, or null outside the archive and before it is published. */
export function satelliteSlot(ms, now = Date.now()) {
  const slot = Math.round(ms / SATELLITE.slotMs) * SATELLITE.slotMs;
  if (slot < SATELLITE.start) return null;
  const latest = Math.floor((now - SATELLITE.latencyMs) / SATELLITE.slotMs) * SATELLITE.slotMs;
  return Math.min(slot, latest);
}

/** Weight of a slot's picture at an instant (1 near the slot, 0 an hour away). */
export function satelliteWeight(slot, ms) {
  const d = Math.abs(ms - slot);
  if (d <= SATELLITE.fullMs) return 1;
  return Math.max(0, 1 - (d - SATELLITE.fullMs) / (SATELLITE.fadeMs - SATELLITE.fullMs));
}

/**
 * Packs the two renderings (RGBA bytes; the top at any size) into the texture bytes.
 * @returns {{ data: Uint8Array, cloudy: number, valid: number }} cloudy / valid = pixel counts
 */
export function packSatellite(mask, mw, mh, top, tw, th) {
  const data = new Uint8Array(mw * mh * 4);
  const memo = new Map();
  let cloudy = 0;
  let valid = 0;
  for (let y = 0; y < mh; y++) {
    const ty = Math.min(th - 1, Math.floor(((y + 0.5) / mh) * th));
    for (let x = 0; x < mw; x++) {
      const i = (y * mw + x) * 4;
      const c = classifyCloudMask(mask[i], mask[i + 1], mask[i + 2], mask[i + 3]);
      data[i + 3] = 255;
      if (c < 0) continue;
      valid++;
      data[i + 2] = 255;
      if (c === 1) {
        cloudy++;
        data[i] = 255;
        if (top) {
          const tx = Math.min(tw - 1, Math.floor(((x + 0.5) / mw) * tw));
          const k = (ty * tw + tx) * 4;
          data[i + 1] = encodeCloudTop(cloudTopHeight(top[k], top[k + 1], top[k + 2], top[k + 3], memo));
        }
      }
    }
  }
  return { data, cloudy, valid };
}

async function fetchRgba(url) {
  const res = await fetch(url);
  if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) throw new Error(`EUMETView ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const out = { data, w: bmp.width, h: bmp.height };
  bmp.close();
  return out;
}

function mapUrl(layer, slot, w, h) {
  const b = SATELLITE.box;
  const time = new Date(slot).toISOString();
  return `${SATELLITE.url}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}&STYLES=&CRS=EPSG:4326`
    + `&BBOX=${b.south},${b.west},${b.north},${b.east}&WIDTH=${w}&HEIGHT=${h}&FORMAT=image/png&TRANSPARENT=true&TIME=${time}`;
}

/**
 * The satellite loader: `texture` (swapped when a slot arrives), `state.slot` / `state.weight`.
 * @param {{ onChange: () => void }} opts
 */
export function createSatellite({ onChange }) {
  const make = (data, w, h) => {
    const t = new THREE.DataTexture(data, w, h);
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.flipY = false;
    t.needsUpdate = true;
    return t;
  };
  const placeholder = make(new Uint8Array([0, 0, 0, 255]), 1, 1);
  const state = { slot: null, shownSlot: null, weight: 0, loading: false, failed: 0, cloudy: 0 };
  const cache = new Map(); // slot → Promise<{ texture, cloudy }|null>
  const listeners = new Set();
  let texture = placeholder;
  let shown = null; // the packed bytes of the shown picture (CPU samples)
  let orphan = null; // the shown picture after it fell out of the cache: freed when replaced
  let wanted = null;
  let disposed = false;

  async function load(slot) {
    const S = SATELLITE;
    const [mask, top] = await Promise.all([
      fetchRgba(mapUrl(S.mask, slot, S.width, S.height)),
      // the top only sets heights: half resolution is plenty (and the slower of the two layers)
      fetchRgba(mapUrl(S.top, slot, S.width >> 1, S.height >> 1)).catch(() => null),
    ]);
    const packed = packSatellite(mask.data, mask.w, mask.h, top?.data ?? null, top?.w ?? 0, top?.h ?? 0);
    if (packed.valid === 0) throw new Error('empty satellite picture');
    return { texture: make(packed.data, mask.w, mask.h), cloudy: packed.cloudy / packed.valid, data: packed.data, w: mask.w, h: mask.h };
  }

  function get(slot) {
    if (!cache.has(slot)) {
      const p = load(slot).catch((err) => {
        console.warn('[earth] satellite clouds unavailable:', err?.message ?? err);
        state.failed++;
        setTimeout(() => cache.delete(slot), 60000); // ask again in a minute
        return null;
      });
      cache.set(slot, p);
      while (cache.size > 6) {
        const [k, old] = cache.entries().next().value;
        cache.delete(k);
        old.then((r) => {
          if (!r) return;
          if (r.texture === texture) orphan = r.texture;
          else r.texture.dispose();
        });
      }
    }
    return cache.get(slot);
  }

  return {
    get texture() {
      return texture;
    },
    state,
    /** Bilinear sample of the shown picture: { cloud 0…1, topM (m or null), valid 0…1 }, or null outside it. */
    sample(latDeg, lonDeg) {
      if (!shown) return null;
      const b = SATELLITE.box;
      const x = ((lonDeg - b.west) / (b.east - b.west)) * shown.w - 0.5;
      const y = ((b.north - latDeg) / (b.north - b.south)) * shown.h - 0.5;
      if (x < 0 || y < 0 || x > shown.w - 1 || y > shown.h - 1) return null;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      const at = (i, j, c) => shown.data[((y0 + j) * shown.w + x0 + i) * 4 + c];
      const bil = (c) => (at(0, 0, c) * (1 - fx) + at(1, 0, c) * fx) * (1 - fy) + (at(0, 1, c) * (1 - fx) + at(1, 1, c) * fx) * fy;
      const topCode = Math.max(at(0, 0, 1), at(1, 0, 1), at(0, 1, 1), at(1, 1, 1));
      return { cloud: bil(0) / 255, topM: decodeCloudTop(topCode), valid: bil(2) / 255 };
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Brings the picture to an instant; `allowFetch` false keeps what is loaded (a racing clock). */
    update(ms, { allowFetch = true } = {}) {
      if (disposed) return;
      const slot = satelliteSlot(ms);
      state.slot = slot;
      state.weight = state.shownSlot === null ? 0 : satelliteWeight(state.shownSlot, ms);
      if (slot === null || slot === wanted || !allowFetch) return;
      wanted = slot;
      state.loading = true;
      get(slot).then((r) => {
        if (disposed || wanted !== slot) return;
        state.loading = false;
        if (!r) return;
        const old = texture;
        texture = r.texture;
        shown = r;
        state.shownSlot = slot;
        state.cloudy = r.cloudy;
        state.weight = satelliteWeight(slot, ms);
        for (const fn of listeners) fn(texture);
        // the previous picture stays in the cache – unless it already fell out of it
        if (old === orphan) {
          old.dispose();
          orphan = null;
        }
        onChange?.();
      });
    },
    dispose() {
      disposed = true;
      listeners.clear();
      for (const p of cache.values()) p.then((r) => r?.texture.dispose());
      cache.clear();
      placeholder.dispose();
    },
  };
}
