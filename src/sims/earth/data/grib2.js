/**
 * A small GRIB2 decoder for the fields the Living Earth reads from NOAA's GFS (docs/earth-sim/08 §3):
 * one message at a time, regular latitude/longitude grids (template 3.0), simple packing (5.0) and
 * complex packing with spatial differencing (5.2 / 5.3 – what GFS uses), without bitmap or with the
 * all-points-present indicator. Everything else throws, so a format change is loud, not wrong.
 *
 * Reference: WMO Manual on Codes, FM 92 GRIB edition 2; NCEP g2clib `comunpack.c` for the order of the
 * spatial differencing steps. Checked against ecCodes by scripts/check-earth-grib.mjs.
 */

/** Reads unsigned big-endian integers of any width (≤ 32 bits) from a bit position. */
class BitReader {
  constructor(bytes, byteOffset) {
    this.bytes = bytes;
    this.pos = byteOffset * 8;
  }

  read(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.bytes[this.pos >> 3];
      v = v * 2 + ((byte >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v;
  }

  /** Reads `count` values of `n` bits into `out` starting at `offset` (fast path for n ≤ 24). */
  readMany(n, count, out, offset) {
    if (n === 0) {
      for (let i = 0; i < count; i++) out[offset + i] = 0;
      return;
    }
    const { bytes } = this;
    let pos = this.pos;
    for (let i = 0; i < count; i++) {
      let v = 0;
      let need = n;
      while (need > 0) {
        const bit = pos & 7;
        const avail = 8 - bit;
        const take = Math.min(avail, need);
        const chunk = (bytes[pos >> 3] >> (avail - take)) & ((1 << take) - 1);
        v = v * (1 << take) + chunk;
        need -= take;
        pos += take;
      }
      out[offset + i] = v;
    }
    this.pos = pos;
  }

  alignByte() {
    this.pos = Math.ceil(this.pos / 8) * 8;
  }
}

const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
/** GRIB2 signed integers are sign and magnitude, not two's complement. */
const s16 = (b, o) => {
  const v = u16(b, o);
  return v & 0x8000 ? -(v & 0x7fff) : v;
};
const s32 = (b, o) => {
  const v = u32(b, o);
  return v & 0x80000000 ? -(v & 0x7fffffff) : v;
};
const f32 = (b, o) => new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0, false);
/** Sign-and-magnitude integer of `n` octets. */
const sn = (b, o, n) => {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + b[o + i];
  const signBit = 2 ** (8 * n - 1);
  return v >= signBit ? -(v - signBit) : v;
};

/**
 * Decodes the first GRIB2 message in `bytes`.
 * @param {Uint8Array} bytes
 * @returns {{ ni: number, nj: number, la1: number, lo1: number, la2: number, lo2: number, di: number, dj: number,
 *             scanMode: number, refTime: Date, forecast: number, discipline: number, category: number,
 *             parameter: number, values: Float32Array }}
 */
export function decodeGrib2(bytes) {
  if (bytes[0] !== 0x47 || bytes[1] !== 0x52 || bytes[2] !== 0x49 || bytes[3] !== 0x42) throw new Error('not a GRIB message');
  if (bytes[7] !== 2) throw new Error(`GRIB edition ${bytes[7]} not supported`);
  const discipline = bytes[6];
  let o = 16;
  const msg = { discipline };
  let grid = null;
  let drs = null;
  let dataOffset = -1;
  let dataLength = 0;
  while (o < bytes.length - 4) {
    if (bytes[o] === 0x37 && bytes[o + 1] === 0x37 && bytes[o + 2] === 0x37 && bytes[o + 3] === 0x37) break;
    const len = u32(bytes, o);
    const num = bytes[o + 4];
    if (num === 1) {
      msg.refTime = new Date(Date.UTC(u16(bytes, o + 12), bytes[o + 14] - 1, bytes[o + 15], bytes[o + 16], bytes[o + 17], bytes[o + 18]));
    } else if (num === 3) {
      const template = u16(bytes, o + 12);
      if (template !== 0) throw new Error(`grid template 3.${template} not supported`);
      const t = o + 14; // template starts at octet 15
      grid = {
        npts: u32(bytes, o + 6),
        ni: u32(bytes, t + 16),
        nj: u32(bytes, t + 20),
        la1: s32(bytes, t + 32) / 1e6,
        lo1: s32(bytes, t + 36) / 1e6,
        la2: s32(bytes, t + 41) / 1e6,
        lo2: s32(bytes, t + 45) / 1e6,
        di: s32(bytes, t + 49) / 1e6,
        dj: s32(bytes, t + 53) / 1e6,
        scanMode: bytes[t + 57],
      };
    } else if (num === 4) {
      const template = u16(bytes, o + 7);
      msg.category = bytes[o + 9];
      msg.parameter = bytes[o + 10];
      if (template === 0 || template === 8) {
        const unit = bytes[o + 17];
        const value = s32(bytes, o + 18);
        const hours = { 0: 1 / 60, 1: 1, 2: 24, 10: 3, 11: 6, 12: 12, 13: 1 / 3600 }[unit] ?? NaN;
        msg.forecast = value * hours;
      }
    } else if (num === 5) {
      const template = u16(bytes, o + 9);
      drs = {
        n: u32(bytes, o + 5),
        template,
        R: f32(bytes, o + 11),
        E: s16(bytes, o + 15),
        D: s16(bytes, o + 17),
        nbits: bytes[o + 19],
      };
      if (template === 2 || template === 3) {
        Object.assign(drs, {
          splitting: bytes[o + 21],
          missingMgmt: bytes[o + 22],
          ng: u32(bytes, o + 31),
          widthRef: bytes[o + 35],
          widthBits: bytes[o + 36],
          lengthRef: u32(bytes, o + 37),
          lengthInc: bytes[o + 41],
          lastLength: u32(bytes, o + 42),
          lengthBits: bytes[o + 46],
          order: template === 3 ? bytes[o + 47] : 0,
          extraOctets: template === 3 ? bytes[o + 48] : 0,
        });
      } else if (template !== 0) {
        throw new Error(`data representation template 5.${template} not supported`);
      }
    } else if (num === 6) {
      if (bytes[o + 5] !== 255) throw new Error('GRIB bitmaps are not supported');
    } else if (num === 7) {
      dataOffset = o + 5;
      dataLength = len - 5;
    }
    o += len;
  }
  if (!grid || !drs || dataOffset < 0) throw new Error('incomplete GRIB message');
  const ints = drs.template === 0 ? unpackSimple(bytes, dataOffset, drs) : unpackComplex(bytes, dataOffset, dataLength, drs);
  const scale2 = 2 ** drs.E;
  const scale10 = 10 ** -drs.D;
  const values = new Float32Array(drs.n);
  for (let i = 0; i < drs.n; i++) {
    const v = ints[i];
    values[i] = Number.isNaN(v) ? NaN : (drs.R + v * scale2) * scale10;
  }
  return { ...grid, ...msg, values };
}

function unpackSimple(bytes, offset, drs) {
  const out = new Float64Array(drs.n);
  if (drs.nbits === 0) return out;
  new BitReader(bytes, offset).readMany(drs.nbits, drs.n, out, 0);
  return out;
}

function unpackComplex(bytes, offset, length, drs) {
  const { n, ng, nbits, order, extraOctets, missingMgmt } = drs;
  if (missingMgmt > 1) throw new Error('secondary missing values are not supported');
  let o = offset;
  let h1 = 0;
  let h2 = 0;
  let minsd = 0;
  if (order > 0) {
    h1 = sn(bytes, o, extraOctets);
    o += extraOctets;
    if (order === 2) {
      h2 = sn(bytes, o, extraOctets);
      o += extraOctets;
    }
    minsd = sn(bytes, o, extraOctets);
    o += extraOctets;
  }
  const br = new BitReader(bytes, o);
  const refs = new Float64Array(ng);
  br.readMany(nbits, ng, refs, 0);
  br.alignByte();
  const widths = new Float64Array(ng);
  br.readMany(drs.widthBits, ng, widths, 0);
  br.alignByte();
  const lengths = new Float64Array(ng);
  br.readMany(drs.lengthBits, ng, lengths, 0);
  br.alignByte();
  for (let g = 0; g < ng; g++) {
    widths[g] += drs.widthRef;
    lengths[g] = drs.lengthRef + lengths[g] * drs.lengthInc;
  }
  lengths[ng - 1] = drs.lastLength;

  const out = new Float64Array(n);
  const missingRef = nbits > 0 ? 2 ** nbits - 1 : -1;
  let k = 0;
  for (let g = 0; g < ng; g++) {
    const len = lengths[g];
    const w = widths[g];
    const ref = refs[g];
    if (w === 0) {
      const v = missingMgmt === 1 && ref === missingRef ? NaN : ref;
      for (let i = 0; i < len; i++) out[k + i] = v;
    } else {
      br.readMany(w, len, out, k);
      const missing = 2 ** w - 1;
      for (let i = 0; i < len; i++) {
        const v = out[k + i];
        out[k + i] = missingMgmt === 1 && v === missing ? NaN : v + ref;
      }
    }
    k += len;
  }
  if (k !== n) throw new Error(`GRIB group lengths add up to ${k}, expected ${n}`);
  if (br.pos > (offset + length) * 8) throw new Error('GRIB data section overrun');

  if (order > 0) {
    // spatial differencing, undone over the non-missing values in order (g2clib comunpack)
    const idx = [];
    for (let i = 0; i < n; i++) if (!Number.isNaN(out[i])) idx.push(i);
    for (let j = order; j < idx.length; j++) out[idx[j]] += minsd;
    if (order === 1) {
      if (idx.length) out[idx[0]] = h1;
      for (let j = 1; j < idx.length; j++) out[idx[j]] += out[idx[j - 1]];
    } else {
      if (idx.length) out[idx[0]] = h1;
      if (idx.length > 1) out[idx[1]] = h2;
      for (let j = 2; j < idx.length; j++) out[idx[j]] += 2 * out[idx[j - 1]] - out[idx[j - 2]];
    }
  }
  return out;
}
