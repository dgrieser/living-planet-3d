/**
 * The streamed globe: land and sea floor heights draped with imagery, from open tile services.
 *
 * 3d-tiles-renderer's `TerrariumMeshPlugin` builds the tile tree from Terrarium-encoded elevation tiles
 * (Mapterhorn) and composes the imagery of each tile (EOX Sentinel-2 cloudless) on a 2D canvas – no
 * shader patching, so it works with WebGPURenderer. What does not carry over is its material: the
 * plugin's Lambert material patches GLSL in `onBeforeCompile`, which node materials ignore. Every tile
 * therefore gets a `MeshBasicNodeMaterial` sharing one TSL graph (render/surface.js). This is the go/no-go
 * spike of docs/earth-sim/01 §1.4 – solved without porting ImageOverlayPlugin.
 *
 * M1 makes the height grids seamless land + sea (docs/earth-sim/02 §1): each decoded Mapterhorn grid gets
 * GEBCO_2026's sea floor where Mapterhorn has sea (data/gebco.js), and the EGM2008 undulation N, so the
 * mesh sits on the WGS84 ellipsoid instead of treating sea level as the ellipsoid (data/geoid.js). A sea
 * mask (which texels are sea, not merely low land) travels with each grid as a second texture.
 *
 * All tiles share the graph, so the renderer compiles one pipeline for the whole planet; per-tile data
 * (imagery, heights, sea mask) reach it through material references and vertex attributes.
 */
import * as THREE from 'three/webgpu';
import { TilesRenderer } from '3d-tiles-renderer';
import { TerrariumMeshPlugin, XYZTilesOverlay, UpdateOnChangePlugin } from '3d-tiles-renderer/plugins';
import { mergeSeaFloor } from '../data/gebco.js';
import { terrainSourceCap, levelCap, usesNrwDop, NRW_DOP_GAIN } from '../regions.js';
import { enlargeTile, gainTables, applyGain } from './resample.js';
import { writeNormals, writeEdgeNormals } from './terrainNormals.js';

// the deepest sea floor (Challenger Deep ≈ −10 935 m) plus margin, below the plugin's fixed −500 m
const MIN_ELEVATION = -11500;
const PLUGIN_MIN_ELEVATION = -500;

/** One material per tile, sharing the colour graph. `seaMask` and `normalGrid` are read by the graph (surface.js). */
function createTerrainMaterial(colorNode, map, seaMask, normalGrid) {
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = colorNode;
  material.map = map;
  material.seaMask = seaMask;
  material.normalGrid = normalGrid;
  material.displacementMap = null;
  material.displacementScale = 1;
  material.displacementBias = 0;
  return material;
}

/** Duplicates the edge texels of a padded grid into its border (until neighbours fill it). */
function fillGridBorder(heights, pw, ph) {
  for (let c = 0; c < pw; c++) {
    const ci = Math.min(Math.max(c, 1), pw - 2);
    heights[c] = heights[pw + ci];
    heights[(ph - 1) * pw + c] = heights[(ph - 2) * pw + ci];
  }
  for (let r = 1; r < ph - 1; r++) {
    heights[r * pw] = heights[r * pw + 1];
    heights[r * pw + pw - 1] = heights[r * pw + pw - 2];
  }
}

let seaLevelBlob = null;
/** A Terrarium-encoded PNG of the given size, every pixel at 0 m. Built once. */
async function seaLevelTile(size) {
  if (!seaLevelBlob) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgb(128, 0, 0)';
    ctx.fillRect(0, 0, size, size);
    seaLevelBlob = canvas.convertToBlob({ type: 'image/png' });
  }
  return seaLevelBlob;
}

// The plugin keeps a tile's x, y and level under module-private symbols; find them by their names.
const tileSymbols = new Map();
function tileKey(tile, name) {
  let sym = tileSymbols.get(name);
  if (!sym) {
    sym = Object.getOwnPropertySymbols(tile).find((s) => s.description === name);
    if (sym) tileSymbols.set(name, sym);
  }
  return sym ? tile[sym] : undefined;
}

/** Bounds (degrees) of a tile of the plugin's tiling. */
function boundsOf(tiling, x, y, level) {
  const [west, south, east, north] = tiling.getTileBounds(x, y, level);
  const d = 180 / Math.PI;
  return { west: west * d, south: south * d, east: east * d, north: north * d };
}

const EXTRA_LEVELS = 2; // the plugin's texture levels: every second zoom is fetched

/** Terrarium terrain whose tiles carry our node material, with the sea floor merged in. */
class EarthTerrainPlugin extends TerrariumMeshPlugin {
  constructor(options) {
    super(options);
    this.colorNode = options.colorNode;
    this.placeholder = options.placeholder;
    this.maskPlaceholder = options.maskPlaceholder;
    this.normalPlaceholder = options.normalPlaceholder;
    this.anisotropy = options.anisotropy ?? 8;
    this.bathymetry = options.bathymetry ?? null;
    this.geoid = options.geoid ?? null;
    // sea masks and relief normals by height grid image (the meshes hold clones of the grid texture that
    // share its image)
    this.seaMasks = new WeakMap();
    this.normalGrids = new WeakMap();
    const cache = this._gridCache;
    cache.fetchItem = (key, signal) => this.fetchGrid(key, signal);
    cache.disposeItem = (grid) => {
      if (!grid) return;
      this.seaMasks.get(grid.image)?.dispose();
      this.seaMasks.delete(grid.image);
      this.normalGrids.get(grid.image)?.texture.dispose();
      this.normalGrids.delete(grid.image);
      grid.dispose();
    };
    // stitching writes a neighbour's heights into each grid's border: refresh the normals along the edges
    const stitch = cache.stitchNeighbors.bind(cache);
    cache.stitchNeighbors = (grid, x, y, level) => {
      stitch(grid, x, y, level);
      const tiling = this._source.tiling;
      const { tileCountX } = tiling.getLevel(level);
      const yDir = tiling.flipY ? -1 : 1;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nb = cache.get((x + dx + tileCountX) % tileCountX, y + dy * yDir, level);
          if (nb && !(nb instanceof Promise)) this.updateNormals(nb, true);
        }
      }
    };
  }

  /** Writes (or, `edges`, refreshes along the edges) the relief normals of a grid. */
  updateNormals(grid, edges = false) {
    const entry = this.normalGrids.get(grid.image);
    if (!entry) return;
    const { data, width, height } = grid.image;
    const out = entry.texture.image.data;
    if (edges) writeEdgeNormals(out, data, width, height, entry.y, entry.level, this.heightScale);
    else writeNormals(out, data, width, height, entry.y, entry.level, this.heightScale);
    entry.texture.needsUpdate = true;
  }

  /**
   * Regional depth: the tree refines past the global levels only where there is more data – the hero
   * boxes (national terrain) and North Rhine-Westphalia (10 cm orthophotos), see regions.js.
   */
  createChild(x, y, level) {
    if (this._tiling && level > levelCap(boundsOf(this._tiling, x, y, level))) return null;
    return super.createChild(x, y, level);
  }

  /** The terrain texture a tile reads: its region's deepest source level at most. */
  sourceTileOf(x, y, level) {
    const cap = Math.min(this._maxSourceLevel, terrainSourceCap(boundsOf(this._tiling, x, y, level)));
    const sourceLevel = Math.min(EXTRA_LEVELS * Math.floor(level / EXTRA_LEVELS), cap);
    const scale = 2 ** (level - sourceLevel);
    return [Math.floor(x / scale), Math.floor(y / scale), sourceLevel, cap];
  }

  getUrl(x, y, level) {
    const [sx, sy, sl] = this.sourceTileOf(x, y, level);
    return this._source.getUrl(sx, sy, sl);
  }

  /** The geoid undulation N (m) at the texel centres of a tile (rows south first), or null. */
  tileUndulation(x, y, level, width, height) {
    const geoid = this.geoid;
    if (!geoid) return null;
    const n = 2 ** level;
    const out = new Float32Array(width * height);
    const lons = new Float32Array(width);
    for (let c = 0; c < width; c++) lons[c] = ((x + (c + 0.5) / width) / n) * 360 - 180;
    for (let r = 0; r < height; r++) {
      const ny = (y + 1 - (r + 0.5) / height) / n;
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * ny))) * 180) / Math.PI;
      for (let c = 0; c < width; c++) out[r * width + c] = geoid.sample(lat, lons[c]);
    }
    return out;
  }

  /**
   * Swaps the detailed sea floor into a grid that started from the base grid: the sea texels get the
   * COG's depths, the textures re-upload (the meshes displace on the GPU), the relief normals are
   * rewritten and the seams re-stitched.
   */
  refineSeaFloor(grid, mask, maskTexture, zero, undulation, x, y, level) {
    const size = grid.image.width - 2;
    this.bathymetry.readDetail(x, y, level, size).then((res) => {
      if (!res || !this.seaMasks.has(grid.image)) return; // no data, or the grid was released meanwhile
      const sea = res.data;
      const pw = size + 2;
      const heights = grid.image.data;
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          const i = (r + 1) * pw + c + 1;
          const d = sea[r * size + c];
          const n = undulation ? undulation[r * size + c] : 0;
          if (res.intertidal && zero?.[i]) {
            // EMODnet keeps the flats as heights: up to +2.5 m they are sea floor that falls dry at low water
            if (Number.isNaN(d) || d >= 2.5) continue;
            heights[i] = d + n;
            mask[i] = 255;
          } else if (mask[i]) {
            heights[i] = (Number.isNaN(d) ? -0.5 : Math.min(d, -0.5)) + n;
          }
        }
      }
      maskTexture.needsUpdate = true;
      fillGridBorder(heights, pw, pw);
      this._gridCache.stitchNeighbors(grid, x, y, level);
      this.updateNormals(grid);
      grid.needsUpdate = true;
      this.tiles.dispatchEvent({ type: 'needs-render' });
    });
  }

  /**
   * One height grid: the Mapterhorn tile decoded to metres, the sea floor where Mapterhorn has sea (the
   * base grid now, the detailed COG read later), plus the geoid – then stitched to its loaded neighbours
   * like the plugin's own grids.
   */
  async fetchGrid([x, y, level], signal) {
    const size = this.tileDimension;
    const [fetched] = await Promise.all([this._source.fetchItem([x, y, level], signal), this.geoid?.ready]);
    const { image } = fetched;
    const { width, height } = image;
    const canvas = this._gridCache.canvas;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, width, height);
    ctx.clearRect(0, 0, width, height);
    this._source.disposeItem(fetched);

    const pw = width + 2;
    const ph = height + 2;
    const heights = new Float32Array(pw * ph);
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const i = 4 * (r * width + c);
        heights[(r + 1) * pw + c + 1] = data[i] * 256 + data[i + 1] + data[i + 2] / 256 - 32768;
      }
    }
    // only tiles with sea in them need the sea floor (Mapterhorn writes exactly 0 m over the sea)
    let hasSea = false;
    for (let r = 1; r < ph - 1 && !hasSea; r++) {
      for (let c = 1; c < pw - 1; c++) {
        if (heights[r * pw + c] === 0) {
          hasSea = true;
          break;
        }
      }
    }
    // Mapterhorn's sea texels (exactly 0 m) – the detailed read may turn some of them into dry flats
    const zero = hasSea ? new Uint8Array(pw * ph) : null;
    if (zero) for (let i = 0; i < heights.length; i++) zero[i] = heights[i] === 0 ? 1 : 0;
    const sea = hasSea && this.bathymetry && width === size ? await this.bathymetry.readBase(x, y, level, size) : null;
    const mask = mergeSeaFloor(heights, pw, ph, sea);

    // heights above mean sea level → above the ellipsoid
    const undulation = this.tileUndulation(x, y, level, width, height);
    if (undulation) {
      for (let r = 0; r < height; r++) {
        const row = (r + 1) * pw + 1;
        for (let c = 0; c < width; c++) heights[row + c] += undulation[r * width + c];
      }
    }
    fillGridBorder(heights, pw, ph);

    const grid = new THREE.DataTexture(heights, pw, ph, THREE.RedFormat, THREE.FloatType);
    grid.minFilter = THREE.LinearFilter;
    grid.magFilter = THREE.LinearFilter;
    grid.needsUpdate = true;
    const maskTexture = new THREE.DataTexture(mask, pw, ph, THREE.RedFormat, THREE.UnsignedByteType);
    maskTexture.minFilter = THREE.LinearFilter;
    maskTexture.magFilter = THREE.LinearFilter;
    maskTexture.needsUpdate = true;
    this.seaMasks.set(grid.image, maskTexture);
    const normals = new THREE.DataTexture(new Uint8Array(pw * ph * 2), pw, ph, THREE.RGFormat, THREE.UnsignedByteType);
    normals.minFilter = THREE.LinearFilter;
    normals.magFilter = THREE.LinearFilter;
    this.normalGrids.set(grid.image, { texture: normals, y, level });
    this._gridCache.stitchNeighbors(grid, x, y, level);
    this.updateNormals(grid);
    if (hasSea && this.bathymetry?.wantsDetail(level)) this.refineSeaFloor(grid, mask, maskTexture, zero, undulation, x, y, level);
    return grid;
  }

  async loadRootTileset() {
    const tileset = await super.loadRootTileset();
    // Mapterhorn serves no tile where there is only sea (404). Answer those with a flat tile at sea level
    // (Terrarium 0 m = RGB 128, 0, 0) of the same size, so the tree stays whole and neighbours stitch;
    // the sea floor merge then fills it with GEBCO's depths.
    const source = this._source;
    const fetchData = source.fetchData;
    source.fetchData = async (fetchUrl, options) => {
      const res = await fetchData(fetchUrl, options);
      if (res.status === 404) return new Response(await seaLevelTile(this.tileDimension));
      if (!res.ok) throw new Error(`terrain tile ${res.status}: ${fetchUrl}`);
      return res;
    };
    return tileset;
  }

  // the plugin's fixed elevation range ends at −500 m; the sea floor goes down to −11 km
  createBoundingVolume(x, y, level, regionHeight = 0) {
    const volume = super.createBoundingVolume(x, y, level, regionHeight);
    if (volume.region) volume.region[4] += (MIN_ELEVATION - PLUGIN_MIN_ELEVATION) * this.heightScale;
    return volume;
  }

  _updateBoundingVolume(tile) {
    super._updateBoundingVolume(tile);
    // before its heights load, a tile keeps the fixed range – recognisable by its −500 m floor
    const region = tile.boundingVolume?.region;
    const pad = tile.geometricError ?? 0;
    const fixedMin = PLUGIN_MIN_ELEVATION * this.heightScale;
    if (region && (Math.abs(region[4] - (fixedMin - pad)) < 1e-6 || Math.abs(region[4] - fixedMin) < 1e-6)) {
      region[4] += (MIN_ELEVATION - PLUGIN_MIN_ELEVATION) * this.heightScale;
      tile.engineData?.boundingVolume?.setRegionData(this.tiles.ellipsoid, ...region);
    }
  }

  async parseToMesh(buffer, tile, extension, url, abortSignal) {
    // the plugin picks the source level from _maxSourceLevel before its first await: cap it for this tile
    const x = tileKey(tile, 'TILE_X');
    let pending;
    if (x !== undefined) {
      const saved = this._maxSourceLevel;
      this._maxSourceLevel = this.sourceTileOf(x, tileKey(tile, 'TILE_Y'), tileKey(tile, 'TILE_LEVEL'))[3];
      try {
        pending = super.parseToMesh(buffer, tile, extension, url, abortSignal);
      } finally {
        this._maxSourceLevel = saved;
      }
    } else {
      pending = super.parseToMesh(buffer, tile, extension, url, abortSignal);
    }
    const mesh = await pending;
    if (!mesh) return mesh;
    const old = mesh.material;
    let map = this.placeholder;
    if (old.map) {
      map = old.map;
      // The image sources hand out ImageBitmaps decoded with imageOrientation: 'flipY' and leave
      // texture.flipY at true. WebGLRenderer ignores flipY for ImageBitmaps; WebGPURenderer (both of its
      // backends) honours it and would flip them a second time. Composited canvases are unaffected.
      if (typeof ImageBitmap !== 'undefined' && map.image instanceof ImageBitmap) map.flipY = false;
      map.anisotropy = this.anisotropy;
      map.generateMipmaps = true;
      map.minFilter = THREE.LinearMipmapLinearFilter;
      map.needsUpdate = true;
    }
    const grid = old.displacementMap;
    const material = createTerrainMaterial(this.colorNode, map, this.seaMasks.get(grid.image) ?? this.maskPlaceholder, this.normalGrids.get(grid.image)?.texture ?? this.normalPlaceholder);
    material.displacementMap = grid;
    material.displacementScale = old.displacementScale;
    old.map = null;
    old.displacementMap = null;
    old.bumpMap = null;
    old.dispose();
    mesh.material = material;
    mesh.frustumCulled = false; // bounds exclude the GPU displacement; the tile traversal culls
    return mesh;
  }
}

/**
 * Regional imagery inside the global imagery source: tiles over North Rhine-Westphalia (zoom ≥ 10) come
 * from the state's orthophoto WMTS (10 cm, 7.5 cm per pixel at z21), drawn over EOX where the state's
 * tiles are transparent (outside its border); EOX tiles past its last level (z15) are cut from their z15
 * ancestor. Every image is flipped like the plugin's own (imageOrientation 'flipY').
 */
function useRegionalImagery(source, imagery, hero) {
  const eoxMax = imagery.levels - 1;
  const opts = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
  const fetchBitmap = async (url, signal) => {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`imagery ${res.status}`);
    const blob = await res.blob();
    return { bitmap: await createImageBitmap(blob, opts), type: res.headers.get('content-type') ?? '' };
  };
  // the pixels of the last EOX tiles that deeper tiles were cut from (a z15 tile serves 4 + 16 of them)
  const parents = new Map();
  const parentPixels = (url) => {
    let entry = parents.get(url);
    if (!entry) {
      entry = fetchBitmap(url).then(({ bitmap }) => {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
      });
      entry.catch(() => parents.delete(url));
      parents.set(url, entry);
      if (parents.size > 24) parents.delete(parents.keys().next().value);
    }
    return entry;
  };
  const eox = async (x, y, z, signal) => {
    if (z <= eoxMax) return fetchBitmap(source.getUrl(x, y, z), signal);
    const d = z - eoxMax;
    const ax = x >> d;
    const ay = y >> d;
    const parent = await parentPixels(source.getUrl(ax, ay, eoxMax));
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const span = parent.width / 2 ** d;
    const pixels = enlargeTile(parent.data, parent.width, parent.height, (x - ax * 2 ** d) * span, (y - ay * 2 ** d) * span, span, 256);
    return { bitmap: await createImageBitmap(new ImageData(pixels, 256, 256), opts), type: 'image/png' };
  };
  const toTexture = async (bitmap) => {
    const flipped = await createImageBitmap(bitmap, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    bitmap.close();
    const texture = new THREE.Texture(flipped);
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  };
  // the orthophotos brought onto the colour scale of the EOX mosaic (regions.js NRW_DOP_GAIN)
  const dopTables = gainTables(NRW_DOP_GAIN);
  const calibrate = async (bitmap) => {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applyGain(image.data, dopTables);
    return createImageBitmap(image, opts);
  };
  source.fetchItem = async ([x, y, z], signal) => {
    if (usesNrwDop(x, y, z)) {
      try {
        const fetched = await fetchBitmap(hero.url.replace('{m}', String(z - 5).padStart(2, '0')).replace('{x}', x).replace('{y}', y), signal);
        const dop = await calibrate(fetched.bitmap);
        if (fetched.type.includes('jpeg')) return toTexture(dop); // fully inside the state
        const base = await eox(x, y, z, signal).catch(() => null);
        const canvas = new OffscreenCanvas(256, 256);
        const ctx = canvas.getContext('2d');
        if (base) {
          ctx.drawImage(base.bitmap, 0, 0, 256, 256);
          base.bitmap.close();
        }
        ctx.drawImage(dop, 0, 0, 256, 256);
        dop.close();
        return toTexture(await createImageBitmap(canvas));
      } catch (err) {
        if (signal?.aborted) throw err;
        // fall through to EOX
      }
    }
    return toTexture((await eox(x, y, z, signal)).bitmap);
  };
}

/**
 * Creates the streamed globe.
 * @param {{ terrain: { url: string, tileDimension: number, maxZoom: number },
 *           imagery: { url: string, tileDimension: number, levels: number },
 *           hero?: { url: string, levels: number } (regional imagery – the NRW orthophoto WMTS, z = matrix + 5),
 *           colorNode: Node, camera: THREE.Camera, renderer: THREE.WebGPURenderer,
 *           bathymetry?: ReturnType<import('../data/gebco.js').createBathymetry>,
 *           geoid?: ReturnType<import('../data/geoid.js').createGeoid>,
 *           errorTarget?: number, anisotropy?: number, cacheBytes?: number }} opts
 */
export function createGlobe({ terrain, imagery, hero = null, colorNode, camera, renderer, bathymetry = null, geoid = null, errorTarget = 2, anisotropy = 8, cacheBytes = 0.6 * 1024 ** 3 }) {
  // the colour of a tile whose imagery has not arrived: a dark ocean blue
  const placeholder = new THREE.DataTexture(new Uint8Array([22, 36, 56, 255]), 1, 1, THREE.RGBAFormat);
  placeholder.colorSpace = THREE.SRGBColorSpace;
  placeholder.generateMipmaps = true;
  placeholder.minFilter = THREE.LinearMipmapLinearFilter;
  placeholder.needsUpdate = true;
  // the sea mask of a tile without one: all land
  const maskPlaceholder = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
  maskPlaceholder.needsUpdate = true;
  // the relief normals of a tile without its own: flat (east and north components 0)
  const normalPlaceholder = new THREE.DataTexture(new Uint8Array([128, 128]), 1, 1, THREE.RGFormat, THREE.UnsignedByteType);
  normalPlaceholder.needsUpdate = true;

  const overlay = new XYZTilesOverlay({ url: imagery.url, tileDimension: imagery.tileDimension, levels: Math.max(imagery.levels, (hero?.levels ?? 0)) });
  if (hero) useRegionalImagery(overlay.imageSource, imagery, hero);
  const tiles = new TilesRenderer();
  const plugin = new EarthTerrainPlugin({
    url: terrain.url,
    tileDimension: terrain.tileDimension,
    maxZoom: terrain.maxZoom,
    overlay,
    applyOverlayTexture: true,
    colorNode,
    placeholder,
    maskPlaceholder,
    normalPlaceholder,
    anisotropy,
    bathymetry,
    geoid,
  });
  tiles.registerPlugin(plugin);
  tiles.registerPlugin(new UpdateOnChangePlugin());
  // a tile's "parse" includes its downloads (the plugin fetches heights itself) – and coastal tiles wait
  // for GEBCO's slow range requests – so allow more of them in flight than the default five
  tiles.parseQueue.maxJobs = 12;
  // The plugin recommends 1 px of elevation error. The imagery tile has half the elevation tile's
  // pixels per side, so 2 px keeps the imagery at 1:1 on screen while the relief stays within 2 px.
  tiles.errorTarget = errorTarget;
  tiles.lruCache.maxBytesSize = cacheBytes;
  tiles.lruCache.minBytesSize = cacheBytes / 2;
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);

  return {
    tiles,
    plugin,
    overlay,
    /** Ellipsoidal height (m) of the ground under a point from the finest loaded tile; null if none. */
    sampleElevation(latRad, lonRad) {
      return plugin.sampleCartographicElevation(latRad, lonRad);
    },
    dispose() {
      tiles.dispose();
      placeholder.dispose();
      maskPlaceholder.dispose();
      normalPlaceholder.dispose();
    },
  };
}

