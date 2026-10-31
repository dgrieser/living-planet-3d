/**
 * The streamed globe: terrain heights draped with imagery, from open XYZ tile services.
 *
 * 3d-tiles-renderer's `TerrariumMeshPlugin` builds the tile tree from Terrarium-encoded elevation tiles
 * (Mapterhorn) and composes the imagery of each tile (EOX Sentinel-2 cloudless) on a 2D canvas – no
 * shader patching, so it works with WebGPURenderer. What does not carry over is its material: the
 * plugin's Lambert material patches GLSL in `onBeforeCompile`, which node materials ignore. Every tile
 * therefore gets a `MeshBasicNodeMaterial` sharing one TSL graph (`createTerrainColorNode`): imagery as
 * albedo, a terrain normal per vertex, sunlight through the atmosphere and a little sky light. This is
 * the go/no-go spike of docs/earth-sim/01 §1.4 – solved without porting ImageOverlayPlugin.
 *
 * All tiles share the graph, so the renderer compiles one pipeline for the whole planet; per-tile data
 * (imagery, heights, height scale) reach it through material references and vertex attributes.
 */
import * as THREE from 'three/webgpu';
import { Fn, vec3, vec4, max, normalize, dot, smoothstep, length, clamp, attribute, materialColor, modelWorldMatrix, positionWorld } from 'three/tsl';
import { TilesRenderer } from '3d-tiles-renderer';
import { TerrariumMeshPlugin, XYZTilesOverlay, UpdateOnChangePlugin } from '3d-tiles-renderer/plugins';
import { ATMOSPHERE } from './atmosphere.js';

const PI = Math.PI;

/**
 * The surface radiance of a terrain fragment (linear, before the atmosphere pass).
 * @param {ReturnType<import('./atmosphere.js').createAtmosphereUniforms>} u
 * @param {Function} toSun transmittance-to-Sun TSL function from atmosphere.js
 * @param {{ nightFloor: Node<float> }} opts nightFloor: a faint ambient so the night side keeps its shape
 */
export function createTerrainColorNode(u, toSun, { nightFloor }) {
  return Fn(() => {
    const albedo = materialColor.rgb; // the tile's imagery (sRGB decoded to linear by the sampler)
    // terrain normal written per vertex on the CPU (tiles are only translated, never rotated)
    const n = normalize(modelWorldMatrix.mul(vec4(attribute('terrainNormal', 'vec3'), 0)).xyz);
    // sunlight reaching the ground: the transmittance table at the fragment's radius and solar zenith
    const pKm = positionWorld.mul(0.001).mul(vec3(1, 1, ATMOSPHERE.zScale));
    const r = max(length(pKm), ATMOSPHERE.bottomRadius + 0.001);
    const up = normalize(pKm);
    const muS = dot(up, u.sunDirectionScaled);
    const sunT = toSun(r, muS);
    const direct = sunT.mul(max(dot(n, u.sunDirection), 0));
    // sky light: a blue-white hemisphere whose brightness follows the Sun's elevation
    const sky = vec3(0.45, 0.6, 1.0).mul(smoothstep(-0.2, 0.25, muS).mul(0.18)).mul(clamp(muS.add(0.6), 0.25, 1));
    const irradiance = u.sunIlluminance.mul(direct.add(sky)).add(nightFloor);
    return albedo.mul(1 / PI).mul(irradiance);
  })();
}

/** One material per tile, sharing the colour graph. */
function createTerrainMaterial(colorNode, map) {
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = colorNode;
  material.map = map;
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

/** Terrarium terrain whose tiles carry our node material. */
class EarthTerrainPlugin extends TerrariumMeshPlugin {
  constructor(options) {
    super(options);
    this.colorNode = options.colorNode;
    this.placeholder = options.placeholder;
    this.anisotropy = options.anisotropy ?? 8;
  }

  async loadRootTileset() {
    const tileset = await super.loadRootTileset();
    // Mapterhorn serves no tile where there is only sea (404). Answer those with a flat tile at sea level
    // (Terrarium 0 m = RGB 128, 0, 0) of the same size, so the tree stays whole and neighbours stitch.
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
    const material = createTerrainMaterial(this.colorNode, map);
    material.displacementMap = old.displacementMap;
    material.displacementScale = old.displacementScale;
    computeTerrainNormals(mesh.geometry, old.displacementMap, old.displacementScale);
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
 *           errorTarget?: number, anisotropy?: number, cacheBytes?: number }} opts
 */
export function createGlobe({ terrain, imagery, colorNode, camera, renderer, errorTarget = 2, anisotropy = 8, cacheBytes = 0.6 * 1024 ** 3 }) {
  // the colour of a tile whose imagery has not arrived: a dark ocean blue
  const placeholder = new THREE.DataTexture(new Uint8Array([22, 36, 56, 255]), 1, 1, THREE.RGBAFormat);
  placeholder.colorSpace = THREE.SRGBColorSpace;
  placeholder.generateMipmaps = true;
  placeholder.minFilter = THREE.LinearMipmapLinearFilter;
  placeholder.needsUpdate = true;

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
    anisotropy,
  });
  tiles.registerPlugin(plugin);
  tiles.registerPlugin(new UpdateOnChangePlugin());
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
    /** Elevation (m, terrain datum) under a point from the finest loaded tile; null if none is loaded. */
    sampleElevation(latRad, lonRad) {
      return plugin.sampleCartographicElevation(latRad, lonRad);
    },
    dispose() {
      tiles.dispose();
      placeholder.dispose();
    },
  };
}

