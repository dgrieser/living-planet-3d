/**
 * Decodes the three GFS cloud-cover messages off the main thread and packs them into one RGBA8 image
 * (R low, G middle, B high cover, 0–100 % → 0–255; A = 255). Rows run north → south, columns east from
 * 0° – the GFS grid as it comes (scan mode 0).
 */
import { decodeGrib2 } from './grib2.js';

self.onmessage = (ev) => {
  const { id, buffers } = ev.data;
  try {
    const fields = buffers.map((b) => decodeGrib2(new Uint8Array(b)));
    const { ni, nj, scanMode } = fields[0];
    if (scanMode !== 0) throw new Error(`unexpected GFS scan mode ${scanMode}`);
    const rgba = new Uint8Array(ni * nj * 4);
    for (let c = 0; c < 3; c++) {
      const v = fields[c].values;
      for (let i = 0; i < v.length; i++) {
        const x = v[i];
        rgba[i * 4 + c] = Number.isFinite(x) ? Math.round(Math.min(100, Math.max(0, x)) * 2.55) : 0;
      }
    }
    for (let i = 0; i < ni * nj; i++) rgba[i * 4 + 3] = 255;
    self.postMessage({ id, result: { rgba, width: ni, height: nj } }, [rgba.buffer]);
  } catch (err) {
    self.postMessage({ id, error: err?.message ?? String(err) });
  }
};
