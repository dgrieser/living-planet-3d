/**
 * Decodes GFS messages off the main thread (data/gfs.js). Rows run north → south, columns east from 0° –
 * the GFS grid as it comes (scan mode 0).
 *
 *  - kind 'cover': low, middle and high cloud cover → one RGBA8 image (R low, G middle, B high,
 *    0–100 % → 0–255; A = 255);
 *  - kind 'local': the weather near the ground → one RGBA8 image (R precipitation rate, G snow fraction,
 *    B cloud ceiling, A convective cloud cover; encodings in data/weatherCodes.js) plus the surface fields
 *    the frame loop samples on the CPU (10 m wind, 2 m temperature, visibility, model ground height),
 *    thinned to 0.5°.
 */
import { decodeGrib2 } from './grib2.js';
import { encodePrecip, encodeCeiling, snowFraction } from './weatherCodes.js';

const clamp255 = (x) => (x < 0 ? 0 : x > 255 ? 255 : x);

function decodeAll(buffers) {
  const fields = buffers.map((b) => (b ? decodeGrib2(new Uint8Array(b)) : null));
  const first = fields.find(Boolean);
  if (!first) throw new Error('no GFS fields');
  if (first.scanMode !== 0) throw new Error(`unexpected GFS scan mode ${first.scanMode}`);
  return { fields, ni: first.ni, nj: first.nj };
}

function cover(buffers) {
  const { fields, ni, nj } = decodeAll(buffers);
  const rgba = new Uint8Array(ni * nj * 4);
  for (let c = 0; c < 3; c++) {
    const v = fields[c].values;
    for (let i = 0; i < v.length; i++) {
      const x = v[i];
      rgba[i * 4 + c] = Number.isFinite(x) ? Math.round(Math.min(100, Math.max(0, x)) * 2.55) : 0;
    }
  }
  for (let i = 0; i < ni * nj; i++) rgba[i * 4 + 3] = 255;
  return { result: { rgba, width: ni, height: nj }, transfer: [rgba.buffer] };
}

// order of the 'local' buffers (data/gfs.js LOCAL_FIELDS)
const L = { prate: 0, rain: 1, snow: 2, freezing: 3, pellets: 4, ceiling: 5, conv: 6, u10: 7, v10: 8, t2: 9, vis: 10, oro: 11 };

function local(buffers) {
  const { fields, ni, nj } = decodeAll(buffers);
  const val = (k) => fields[L[k]]?.values ?? null;
  const prate = val('prate');
  const rain = val('rain');
  const snow = val('snow');
  const freezing = val('freezing');
  const pellets = val('pellets');
  const ceiling = val('ceiling');
  const conv = val('conv');
  const n = ni * nj;
  const rgba = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const mmh = prate ? prate[i] * 3600 : 0; // kg m⁻² s⁻¹ → mm/h
    rgba[i * 4] = encodePrecip(mmh);
    rgba[i * 4 + 1] = Math.round(255 * snowFraction(rain?.[i] ?? 0, snow?.[i] ?? 0, freezing?.[i] ?? 0, pellets?.[i] ?? 0));
    rgba[i * 4 + 2] = encodeCeiling(ceiling ? ceiling[i] : NaN);
    rgba[i * 4 + 3] = conv && Number.isFinite(conv[i]) ? clamp255(Math.round(conv[i] * 2.55)) : 0;
  }
  // surface fields at 0.5° (every second node) – the CPU only needs them at the camera
  const sw = Math.ceil(ni / 2);
  const sh = Math.ceil(nj / 2);
  const thin = (v, fallback) => {
    const out = new Float32Array(sw * sh);
    for (let j = 0; j < sh; j++) {
      for (let i = 0; i < sw; i++) {
        const x = v ? v[j * 2 * ni + i * 2] : fallback;
        out[j * sw + i] = Number.isFinite(x) ? x : fallback;
      }
    }
    return out;
  };
  const surface = { u10: thin(val('u10'), 0), v10: thin(val('v10'), 0), t2: thin(val('t2'), NaN), vis: thin(val('vis'), NaN), oro: thin(val('oro'), 0) };
  return {
    result: { rgba, width: ni, height: nj, surface, surfaceWidth: sw, surfaceHeight: sh },
    transfer: [rgba.buffer, ...Object.values(surface).map((a) => a.buffer)],
  };
}

self.onmessage = (ev) => {
  const { id, kind = 'cover', buffers } = ev.data;
  try {
    const { result, transfer } = kind === 'local' ? local(buffers) : cover(buffers);
    self.postMessage({ id, result }, transfer);
  } catch (err) {
    self.postMessage({ id, error: err?.message ?? String(err) });
  }
};
