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
import { sampleGlobalGeoid } from '../data/geoid.js';

// the deepest sea floor (Challenger Deep ≈ −10 935 m) plus margin, below the plugin's fixed −500 m
const MIN_ELEVATION = -11500;
const PLUGIN_MIN_ELEVATION = -500;

/** One material per tile, sharing the colour graph. `seaMask` is read by the graph (surface.js). */
function createTerrainMaterial(colorNode, map, seaMask) {
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = colorNode;
  material.map = map;
  material.seaMask = seaMask;
  material.displacementMap = null;
  material.displacementScale = 1;
  material.displacementBias = 0;
  return material;
}

// bilinear sample of the plugin's padded height grid at padded texture coordinates
function sampleGrid(data, width, height, tu, tv) {
  const fx = Math.min(Math.max(tu * width - 0.5, 0), width - 1);
  const fy = Math.min(Math.max(tv * height - 0.5, 0), height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const h0 = data[y0 * width + x0] * (1 - tx) + data[y0 * width + x1] * tx;
  const h1 = data[y1 * width + x0] * (1 - tx) + data[y1 * width + x1] * tx;
  return h0 * (1 - ty) + h1 * ty;
}

/**
 * Per-vertex terrain normals: displace the surface vertices on the CPU exactly as the GPU will, then take
 * central differences across the vertex grid. Skirt vertices copy their source vertex.
 */
function computeTerrainNormals(geometry, grid, heightScale) {
  const { position, normal, uv } = geometry.attributes;
  const { surfaceVertexCount, skirtSourceIndices } = geometry;
  const cols = Math.round(Math.sqrt(surfaceVertexCount));
  const { data, width, height } = grid.image;
  const displaced = new Float32Array(surfaceVertexCount * 3);
  for (let i = 0; i < surfaceVertexCount; i++) {
    const h = sampleGrid(data, width, height, uv.getX(i), uv.getY(i)) * heightScale;
    displaced[i * 3] = position.getX(i) + normal.getX(i) * h;
    displaced[i * 3 + 1] = position.getY(i) + normal.getY(i) * h;
    displaced[i * 3 + 2] = position.getZ(i) + normal.getZ(i) * h;
  }
  const out = new Float32Array(position.count * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const n = new THREE.Vector3();
  const ref = new THREE.Vector3();
  const at = (r, c, v) => v.fromArray(displaced, (r * cols + c) * 3);
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  for (let r = 0; r < cols; r++) {
    for (let c = 0; c < cols; c++) {
      at(r, Math.min(c + 1, cols - 1), p1);
      at(r, Math.max(c - 1, 0), p0);
      a.subVectors(p1, p0);
      at(Math.min(r + 1, cols - 1), c, p1);
      at(Math.max(r - 1, 0), c, p0);
      b.subVectors(p1, p0);
      n.crossVectors(a, b).normalize();
      const i = r * cols + c;
      ref.fromBufferAttribute(normal, i);
      if (n.dot(ref) < 0) n.negate();
      if (!Number.isFinite(n.x)) n.copy(ref);
      n.toArray(out, i * 3);
    }
  }
  for (let k = 0; k < skirtSourceIndices.length; k++) {
    const src = skirtSourceIndices[k];
    const dst = surfaceVertexCount + k;
    out[dst * 3] = out[src * 3];
    out[dst * 3 + 1] = out[src * 3 + 1];
    out[dst * 3 + 2] = out[src * 3 + 2];
  }
  geometry.setAttribute('terrainNormal', new THREE.BufferAttribute(out, 3));
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

/** Terrarium terrain whose tiles carry our node material, with the sea floor merged in. */
class EarthTerrainPlugin extends TerrariumMeshPlugin {
  constructor(options) {
    super(options);
    this.colorNode = options.colorNode;
    this.placeholder = options.placeholder;
    this.maskPlaceholder = options.maskPlaceholder;
    this.anisotropy = options.anisotropy ?? 8;
    this.bathymetry = options.bathymetry ?? null;
    this.geoid = options.geoid ?? null;
    // sea masks by height grid image (the meshes hold clones of the grid texture that share its image)
    this.seaMasks = new WeakMap();
    const cache = this._gridCache;
    cache.fetchItem = (key, signal) => this.fetchGrid(key, signal);
    cache.disposeItem = (grid) => {
      if (!grid) return;
      this.seaMasks.get(grid.image)?.dispose();
      this.seaMasks.delete(grid.image);
      grid.dispose();
    };
  }

  /** The geoid undulation N (m) at the texel centres of a tile (rows south first), or null. */
  tileUndulation(x, y, level, width, height) {
    const geoid = this.geoid?.values;
    if (!geoid) return null;
    const n = 2 ** level;
    const out = new Float32Array(width * height);
    const lons = new Float32Array(width);
    for (let c = 0; c < width; c++) lons[c] = ((x + (c + 0.5) / width) / n) * 360 - 180;
    for (let r = 0; r < height; r++) {
      const ny = (y + 1 - (r + 0.5) / height) / n;
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * ny))) * 180) / Math.PI;
      for (let c = 0; c < width; c++) out[r * width + c] = sampleGlobalGeoid(geoid, lat, lons[c]);
    }
    return out;
  }

  /**
   * Swaps the detailed sea floor into a grid that started from the base grid: the sea texels get the
   * COG's depths, the textures re-upload (the meshes displace on the GPU), the vertex normals of every
   * mesh on this grid are recomputed and the seams re-stitched.
   */
  refineSeaFloor(grid, mask, undulation, x, y, level) {
    const size = grid.image.width - 2;
    this.bathymetry.readDetail(x, y, level, size).then((sea) => {
      if (!sea || !this.seaMasks.has(grid.image)) return; // no data, or the grid was released meanwhile
      const pw = size + 2;
      const heights = grid.image.data;
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          const i = (r + 1) * pw + c + 1;
          if (!mask[i]) continue;
          const d = sea[r * size + c];
          heights[i] = (Number.isNaN(d) ? -0.5 : Math.min(d, -0.5)) + (undulation ? undulation[r * size + c] : 0);
        }
      }
      fillGridBorder(heights, pw, pw);
      this._gridCache.stitchNeighbors(grid, x, y, level);
      grid.needsUpdate = true;
      this.tiles.forEachLoadedModel((scene) => {
        scene.traverse((mesh) => {
          if (mesh.isMesh && mesh.material?.displacementMap?.image === grid.image) {
            computeTerrainNormals(mesh.geometry, grid, mesh.material.displacementScale);
          }
        });
      });
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
    this._gridCache.stitchNeighbors(grid, x, y, level);
    if (hasSea && this.bathymetry?.wantsDetail(level)) this.refineSeaFloor(grid, mask, undulation, x, y, level);
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
    const mesh = await super.parseToMesh(buffer, tile, extension, url, abortSignal);
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
    const material = createTerrainMaterial(this.colorNode, map, this.seaMasks.get(grid.image) ?? this.maskPlaceholder);
    material.displacementMap = grid;
    material.displacementScale = old.displacementScale;
    computeTerrainNormals(mesh.geometry, grid, old.displacementScale);
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
 * Creates the streamed globe.
 * @param {{ terrain: { url: string, tileDimension: number, maxZoom: number },
 *           imagery: { url: string, tileDimension: number, levels: number },
 *           colorNode: Node, camera: THREE.Camera, renderer: THREE.WebGPURenderer,
 *           bathymetry?: ReturnType<import('../data/gebco.js').createBathymetry>,
 *           geoid?: ReturnType<import('../data/geoid.js').createGeoid>,
 *           errorTarget?: number, anisotropy?: number, cacheBytes?: number }} opts
 */
export function createGlobe({ terrain, imagery, colorNode, camera, renderer, bathymetry = null, geoid = null, errorTarget = 2, anisotropy = 8, cacheBytes = 0.6 * 1024 ** 3 }) {
  // the colour of a tile whose imagery has not arrived: a dark ocean blue
  const placeholder = new THREE.DataTexture(new Uint8Array([22, 36, 56, 255]), 1, 1, THREE.RGBAFormat);
  placeholder.colorSpace = THREE.SRGBColorSpace;
  placeholder.generateMipmaps = true;
  placeholder.minFilter = THREE.LinearMipmapLinearFilter;
  placeholder.needsUpdate = true;
  // the sea mask of a tile without one: all land
  const maskPlaceholder = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
  maskPlaceholder.needsUpdate = true;

  const overlay = new XYZTilesOverlay({ url: imagery.url, tileDimension: imagery.tileDimension, levels: imagery.levels });
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
    },
  };
}

