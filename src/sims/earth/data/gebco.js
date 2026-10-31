/**
 * The sea floor: GEBCO_2026 heights read straight from a cloud-optimised GeoTIFF (docs/earth-sim/02 §2).
 *
 * The COG holds the 15″ global grid (86 400 × 43 200 Int16, metres above mean sea level, land and sea)
 * plus seven overviews, in 512² DEFLATE tiles. geotiff.js fetches only the byte ranges a window needs, so
 * a terrain tile asks for its own patch from the overview that matches its texel size – a zoom-2 tile
 * reads ≈ 1 MB, a zoom-12 tile a few kB. The server (Source Cooperative) answers with CORS headers and
 * byte ranges; the plan mirrors the file to the mittwald server (11 §5).
 *
 * The pure helpers (tile bounds, overview choice, resampling into a Web-Mercator tile) are exported for
 * scripts/check-earth-bathymetry.mjs.
 */

export const GEBCO_NODATA = -32767;

/** Geographic bounds (degrees) of an XYZ Web-Mercator tile (y = 0 at the north edge). */
export function mercatorTileBounds(x, y, z) {
  const n = 2 ** z;
  const lat = (ny) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * ny))) * 180) / Math.PI;
  return { west: (x / n) * 360 - 180, east: ((x + 1) / n) * 360 - 180, north: lat(y / n), south: lat((y + 1) / n) };
}

/**
 * The coarsest level whose pixels are at most as large as the wanted spacing (degrees); level 0 when even
 * the full grid is coarser. `levels` are ordered fine → coarse, each { width, height }.
 */
export function chooseLevel(levels, degPerTexel) {
  let best = 0;
  for (let i = 0; i < levels.length; i++) {
    if (360 / levels[i].width <= degPerTexel * 1.001) best = i;
  }
  return best;
}

/** Pixel window [left, top, right, bottom) of a global lat/lon grid covering the bounds plus a margin. */
export function gridWindow(bounds, width, height, margin = 2) {
  const res = 360 / width;
  const left = Math.max(0, Math.floor((bounds.west + 180) / res - 0.5) - margin);
  const right = Math.min(width, Math.ceil((bounds.east + 180) / res + 0.5) + margin);
  const top = Math.max(0, Math.floor((90 - bounds.north) / res - 0.5) - margin);
  const bottom = Math.min(height, Math.ceil((90 - bounds.south) / res + 0.5) + margin);
  return [left, top, right, bottom];
}

/**
 * Bilinear resampling of a window of a global lat/lon grid (row 0 = north) into the texel centres of a
 * Web-Mercator tile, rows south first (the order of the terrain plugin's height grids). No-data → NaN.
 * @param {ArrayLike<number>} data window values, row-major
 * @param {{ window: number[], width: number }} meta the window and the full grid width (pixels)
 */
export function resampleToMercatorTile(data, meta, x, y, z, size) {
  const [left, top, right, bottom] = meta.window;
  const ww = right - left;
  const wh = bottom - top;
  const res = 360 / meta.width;
  const n = 2 ** z;
  const out = new Float32Array(size * size);
  const colX = new Float32Array(size);
  for (let c = 0; c < size; c++) {
    const lon = ((x + (c + 0.5) / size) / n) * 360 - 180;
    colX[c] = Math.min(Math.max((lon + 180) / res - 0.5 - left, 0), ww - 1);
  }
  const value = (i) => {
    const v = data[i];
    return v <= GEBCO_NODATA ? NaN : v;
  };
  for (let r = 0; r < size; r++) {
    const ny = (y + 1 - (r + 0.5) / size) / n;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * ny))) * 180) / Math.PI;
    const fy = Math.min(Math.max((90 - lat) / res - 0.5 - top, 0), wh - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, wh - 1);
    const ty = fy - y0;
    for (let c = 0; c < size; c++) {
      const fx = colX[c];
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, ww - 1);
      const tx = fx - x0;
      const a = value(y0 * ww + x0) * (1 - tx) + value(y0 * ww + x1) * tx;
      const b = value(y1 * ww + x0) * (1 - tx) + value(y1 * ww + x1) * tx;
      out[r * size + c] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

/**
 * Merges the sea floor into a decoded Mapterhorn height grid (padded by one texel, rows south first).
 * Mapterhorn writes exactly 0 m over the sea (and serves no tile at all over open water); land keeps its
 * own height, including land below sea level (polders, the Dead Sea shore, the Caspian's surface). Sea
 * texels take GEBCO's depth, at least 0.5 m below the surface so the water always covers them; without
 * GEBCO (`sea` null, or a texel without data) they sit 0.5 m below the surface – a flat sea, as in M0.
 * Returns the sea mask (255 = sea) in the same padded layout.
 */
export function mergeSeaFloor(grid, pw, ph, sea) {
  const size = pw - 2;
  const mask = new Uint8Array(pw * ph);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const i = (r + 1) * pw + c + 1;
      const land = grid[i];
      const depth = sea ? sea[r * size + c] : NaN;
      if (land === 0 && !(depth > 0)) {
        grid[i] = Number.isNaN(depth) ? -0.5 : Math.min(depth, -0.5);
        mask[i] = 255;
      }
    }
  }
  // the border duplicates the edge texels until a neighbour fills it
  for (let x = 0; x < pw; x++) {
    const xi = Math.min(Math.max(x, 1), pw - 2);
    mask[x] = mask[pw + xi];
    mask[(ph - 1) * pw + x] = mask[(ph - 2) * pw + xi];
  }
  for (let y = 1; y < ph - 1; y++) {
    mask[y * pw] = mask[y * pw + 1];
    mask[y * pw + pw - 1] = mask[y * pw + pw - 2];
  }
  return mask;
}

/**
 * Bilinear resampling of a georeferenced lat/lon window (row 0 = north) into the texel centres of a
 * Web-Mercator tile, rows south first. No-data (≤ −32767, NaN, |v| > 20 000) → NaN.
 * @param {{ west: number, north: number, resLon: number, resLat: number, w: number, h: number }} g
 */
export function resampleWindowToMercator(data, g, x, y, z, size) {
  const n = 2 ** z;
  const out = new Float32Array(size * size);
  const val = (i) => {
    const v = data[i];
    return v <= GEBCO_NODATA || !(Math.abs(v) < 20000) ? NaN : v;
  };
  for (let r = 0; r < size; r++) {
    const ny = (y + 1 - (r + 0.5) / size) / n;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * ny))) * 180) / Math.PI;
    const fy = Math.min(Math.max((g.north - lat) / g.resLat - 0.5, 0), g.h - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, g.h - 1);
    const ty = fy - y0;
    for (let c = 0; c < size; c++) {
      const lon = ((x + (c + 0.5) / size) / n) * 360 - 180;
      const fx = Math.min(Math.max((lon - g.west) / g.resLon - 0.5, 0), g.w - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, g.w - 1);
      const tx = fx - x0;
      const a = val(y0 * g.w + x0) * (1 - tx) + val(y0 * g.w + x1) * tx;
      const b = val(y1 * g.w + x0) * (1 - tx) + val(y1 * g.w + x1) * tx;
      out[r * size + c] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

/**
 * EMODnet Bathymetry DTM (CC BY 4.0) – 1/16′ (≈ 115 m) over the European seas, with the intertidal flats as
 * heights (Fanø's flats −0.4 … +0.7 m): four times finer than GEBCO there. Read from its WCS (CORS) in
 * 0.5° cells for tiles of zoom ≥ 8 inside its coverage (the service offers no server-side scaling, so the
 * coarser tiles far away keep GEBCO).
 */
export const EMODNET = Object.freeze({
  url: 'https://ows.emodnet-bathymetry.eu/wcs', coverage: 'emodnet__mean', minZoom: 8,
  bounds: { west: -36, east: 43, south: 15, north: 90 },
});

/** Layout of the shipped base grid (tools/earth-pipeline/build-gebco-base.mjs). */
export const GEBCO_BASE = Object.freeze({ file: 'earth/gebco2026-16min.bin.gz', width: 1350, height: 675 });

/** Undoes the base grid's encoding (high-byte plane, low-byte plane, row deltas) → Int16 metres. */
export function decodeGebcoBase(bytes, width = GEBCO_BASE.width, height = GEBCO_BASE.height) {
  const n = width * height;
  if (bytes.length < n * 2) throw new Error(`GEBCO base grid too short: ${bytes.length} bytes`);
  const out = new Int16Array(n);
  for (let r = 0; r < height; r++) {
    let prev = 0;
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      const d = (bytes[i] << 8) | bytes[n + i];
      prev = (prev + d) << 16 >> 16; // wrap to Int16 like the encoder
      out[i] = prev;
    }
  }
  return out;
}

async function gunzip(buffer) {
  const head = new Uint8Array(buffer, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return new Uint8Array(buffer); // a server already decoded it
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The GEBCO reader, in two steps because every range request to the COG host costs 0.3–0.8 s before
 * the first byte:
 *  - `readBase` resamples the shipped 16′ (≈ 30 km) grid – instant once its 750 kB have loaded; every
 *    tile with sea starts from it, so the globe never waits for the host;
 *  - `readDetail` reads the tile's own window from the full COG (15″ and overviews) for zoom ≥ 3; the
 *    globe swaps it in when it arrives.
 * Both resolve to the sea floor (m, NaN = no data) at the texel centres of an XYZ tile, rows south first,
 * or null when the data cannot be read (the globe then keeps a flat sea, as in M0).
 * @param {{ url: string, baseUrl: string, detailMinZoom?: number }} opts
 */
export function createBathymetry({ url, baseUrl, detailMinZoom = 3 }) {
  let opening = null;
  let pool = null;
  let failed = false;

  const base = fetch(`${baseUrl}${GEBCO_BASE.file}`)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    })
    .then(gunzip)
    .then((bytes) => decodeGebcoBase(bytes))
    .catch((err) => {
      console.warn('[earth] GEBCO base grid unavailable:', err?.message ?? err);
      return null;
    });

  function open() {
    opening ??= (async () => {
      // geotiff.js (≈ 300 kB) loads with the first detailed read – the globe views never need it
      const { fromUrl, Pool } = await import('geotiff');
      pool = typeof Worker !== 'undefined' ? new Pool(Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) - 2))) : null;
      const tiff = await fromUrl(url, { cacheSize: 256, blockSize: 65536 });
      const count = await tiff.getImageCount();
      const levels = [];
      for (let i = 0; i < count; i++) {
        const image = await tiff.getImage(i);
        levels.push({ image, width: image.getWidth(), height: image.getHeight() });
      }
      return levels;
    })().catch((err) => {
      failed = true;
      console.warn('[earth] GEBCO sea floor unavailable:', err?.message ?? err);
      return null;
    });
    return opening;
  }

  // EMODnet in 0.5° cells at its native 1/16′ (≈ 480 × 480 values, ≈ 0.9 MB each), shared by every tile in
  // them: a handful of requests instead of one per tile, and neighbouring tiles agree exactly
  const emodnetCells = new Map();
  function emodnetCell(ix, iy) {
    const key = `${ix}|${iy}`;
    if (!emodnetCells.has(key)) {
      const pad = 2 / 960; // two values of overlap, so bilinear samples never fall off a cell
      const w = ix * 0.5 - pad;
      const s0 = iy * 0.5 - pad;
      const url = `${EMODNET.url}?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=${EMODNET.coverage}&FORMAT=image/tiff`
        + `&SUBSET=Lat(${s0.toFixed(6)},${(s0 + 0.5 + 2 * pad).toFixed(6)})&SUBSET=Long(${w.toFixed(6)},${(w + 0.5 + 2 * pad).toFixed(6)})`;
      const p = fetch(url)
        .then(async (res) => {
          if (!res.ok || !(res.headers.get('content-type') ?? '').includes('tiff')) throw new Error(`EMODnet ${res.status}`);
          const { fromArrayBuffer } = await import('geotiff');
          const tiff = await fromArrayBuffer(await res.arrayBuffer());
          const image = await tiff.getImage();
          const [data] = await image.readRasters();
          const [west, north] = image.getOrigin();
          const [resLon, resLat] = image.getResolution();
          return { data, g: { west, north, resLon: Math.abs(resLon), resLat: Math.abs(resLat), w: image.getWidth(), h: image.getHeight() } };
        })
        .catch((err) => {
          console.warn('[earth] EMODnet cell unavailable:', key, err?.message ?? err);
          return null;
        });
      emodnetCells.set(key, p);
    }
    return emodnetCells.get(key);
  }

  async function readEmodnet(b, x, y, z, size) {
    const ix0 = Math.floor(b.west / 0.5);
    const ix1 = Math.floor((b.east - 1e-9) / 0.5);
    const iy0 = Math.floor(b.south / 0.5);
    const iy1 = Math.floor((b.north - 1e-9) / 0.5);
    if ((ix1 - ix0 + 1) * (iy1 - iy0 + 1) > 12) return null; // a tile too large for the cell cache
    const cells = new Map();
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        const c = await emodnetCell(ix, iy);
        if (!c) return null; // one missing cell: keep GEBCO for the whole tile (no seams inside it)
        cells.set(`${ix}|${iy}`, c);
      }
    }
    const n = 2 ** z;
    const out = new Float32Array(size * size);
    const val = (c, i) => {
      const v = c.data[i];
      return v <= GEBCO_NODATA || !(Math.abs(v) < 20000) ? NaN : v;
    };
    for (let r = 0; r < size; r++) {
      const ny = (y + 1 - (r + 0.5) / size) / n;
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * ny))) * 180) / Math.PI;
      const iy = Math.min(iy1, Math.max(iy0, Math.floor(lat / 0.5)));
      for (let col = 0; col < size; col++) {
        const lon = ((x + (col + 0.5) / size) / n) * 360 - 180;
        const ix = Math.min(ix1, Math.max(ix0, Math.floor(lon / 0.5)));
        const { data, g } = cells.get(`${ix}|${iy}`);
        const fx = Math.min(Math.max((lon - g.west) / g.resLon - 0.5, 0), g.w - 1);
        const fy = Math.min(Math.max((g.north - lat) / g.resLat - 0.5, 0), g.h - 1);
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const x1 = Math.min(x0 + 1, g.w - 1);
        const y1 = Math.min(y0 + 1, g.h - 1);
        const tx = fx - x0;
        const ty = fy - y0;
        const c = { data };
        const a = val(c, y0 * g.w + x0) * (1 - tx) + val(c, y0 * g.w + x1) * tx;
        const bb = val(c, y1 * g.w + x0) * (1 - tx) + val(c, y1 * g.w + x1) * tx;
        out[r * size + col] = a * (1 - ty) + bb * ty;
      }
    }
    return out;
  }

  /** A tile's window of the GEBCO COG (15″ and overviews), or null. */
  async function readGebco(x, y, z, size, signal) {
    const levels = await open();
    if (!levels) return null;
    const bounds = mercatorTileBounds(x, y, z);
    const level = levels[chooseLevel(levels, (bounds.east - bounds.west) / size)];
    const window = gridWindow(bounds, level.width, level.height);
    try {
      const [data] = await level.image.readRasters({ window, pool, signal });
      return resampleToMercatorTile(data, { window, width: level.width }, x, y, z, size);
    } catch (err) {
      if (signal?.aborted || err?.name === 'AbortError') return null;
      console.warn('[earth] GEBCO tile failed:', z, x, y, err?.message ?? err);
      return null;
    }
  }

  return {
    get failed() {
      return failed;
    },
    base,
    /** Whether a tile at this zoom gets a detailed read after the base. */
    wantsDetail(z) {
      return z >= detailMinZoom && !failed;
    },
    async readBase(x, y, z, size) {
      const data = await base;
      if (!data) return null;
      return resampleToMercatorTile(data, { window: [0, 0, GEBCO_BASE.width, GEBCO_BASE.height], width: GEBCO_BASE.width }, x, y, z, size);
    },
    /**
     * The tile's own sea floor: EMODnet in the European seas from zoom 8 (`intertidal: true` – positive values
     * are flats that fall dry), else the GEBCO COG. Resolves to { data, intertidal } or null.
     */
    async readDetail(x, y, z, size, signal) {
      const b = mercatorTileBounds(x, y, z);
      const e = EMODNET.bounds;
      if (z >= EMODNET.minZoom && b.west >= e.west && b.east <= e.east && b.south >= e.south && b.north <= e.north) {
        const data = await readEmodnet(b, x, y, z, size);
        if (data) return { data, intertidal: true };
      }
      const gebco = await readGebco(x, y, z, size, signal);
      return gebco ? { data: gebco, intertidal: false } : null;
    },
    dispose() {
      pool?.destroy();
      pool = null;
    },
  };
}
