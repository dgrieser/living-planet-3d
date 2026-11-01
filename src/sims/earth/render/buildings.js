/**
 * Buildings (milestone M3, docs/earth-sim/05 §3):
 *
 *  - **North Rhine-Westphalia**: the state's LoD2 models (dl-de/zero-2.0), streamed live as 3D Tiles 1.1
 *    from `ogc-api.nrw.de/3dg/v1` – roof shapes fitted to the 2023 laser scan, with ALKIS building
 *    function, roof type and surface type per feature (EXT_structural_metadata). The service delivers the
 *    buildings with their ground at the ellipsoid, so each one is set onto our terrain here.
 *  - **Fanø**: OpenStreetMap footprints with generated roofs (data/osmBuildings.js).
 *
 * Every building mesh is rewritten into one common form – float positions relative to the mesh centre,
 * world normals, an albedo per vertex (`bColor`) and `bInfo` (roof flag, windows flag, height above the
 * building's base) – and drawn with one TSL material: sunlight through the atmosphere and the cloud
 * shadows like the terrain, sky light, windows as a facade pattern and, at night, lit windows. Colours
 * are generated from function and type (no facade photos yet – the model card says so).
 *
 * Ground fitting: a building's base goes to the lowest terrain under its footprint, re-checked in small
 * batches every frame so buildings follow as finer terrain tiles arrive.
 */
import * as THREE from 'three/webgpu';
import {
  Fn, vec3, float, attribute, positionWorld, positionView, normalize, dot, max, cross, fract, floor, sin, step,
  smoothstep, mix, length, abs, sign, vertexStage,
} from 'three/tsl';
import { TilesRenderer } from '3d-tiles-renderer';
import { ImplicitTilingPlugin, GLTFExtensionsPlugin, UpdateOnChangePlugin } from '3d-tiles-renderer/plugins';
import { ATMOSPHERE, DETAIL_SCALE } from './atmosphere.js';
import { geodeticLatLon } from './surface.js';
import { skyLight } from './clouds.js';
import { ecefToGeodetic, geodeticToEcef, geodeticToUtm, WGS84, DEG } from '../geodesy.js';

const ALKIS_WFS = 'https://www.wfs.nrw.de/geobasis/wfs_nw_alkis_vereinfacht';
import { decodeOsmBuildings, buildingGeometry, buildingForm, polygonArea } from '../data/osmBuildings.js';

const PI = Math.PI;
const E2 = WGS84.e2;

// ---------- colours (linear albedo), generated from function and type ---------------------------------------
const WALLS = {
  brickRed: [0.16, 0.055, 0.035], brickDark: [0.09, 0.04, 0.03], brickYellow: [0.32, 0.22, 0.1],
  plaster: [0.5, 0.48, 0.42], plasterWarm: [0.45, 0.38, 0.28], woodBlack: [0.035, 0.035, 0.035], grey: [0.22, 0.22, 0.21],
  metal: [0.3, 0.32, 0.33], whitewash: [0.62, 0.6, 0.55],
};
const ROOFS = {
  tileRed: [0.2, 0.05, 0.03], tileBrown: [0.11, 0.05, 0.035], anthracite: [0.04, 0.042, 0.045], black: [0.025, 0.025, 0.027],
  grey: [0.12, 0.12, 0.12], gravel: [0.2, 0.19, 0.17], thatch: [0.16, 0.12, 0.07], green: [0.05, 0.08, 0.03], metal: [0.24, 0.25, 0.26],
};
const hash = (n) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const pick = (list, h) => list[Math.floor(h * list.length) % list.length];

/**
 * NRW building → wall and roof colour, windows. The live 3D Tiles carry the roof type but not the ALKIS
 * function (that comes from the ALKIS WFS when a building is picked), so the style is inferred from the
 * roof type and the height: pitched and low – a house; very low – a garage; tall or flat – the rest.
 */
function nrwStyle(roofType = 0, height = 0, seed = 0) {
  const h = hash(seed);
  const pitched = roofType >= 2100 && roofType < 5000 && roofType !== 3800;
  const garage = height < 3.4;
  const house = pitched && height < 16 && !garage;
  const wall = garage ? pick([WALLS.grey, WALLS.plaster, WALLS.brickRed], h)
    : house ? pick([WALLS.brickRed, WALLS.brickRed, WALLS.brickDark, WALLS.plaster, WALLS.plasterWarm, WALLS.brickYellow], h)
      : pick([WALLS.grey, WALLS.plaster, WALLS.metal, WALLS.brickRed, WALLS.plasterWarm], h);
  const roof = pitched ? pick([ROOFS.tileRed, ROOFS.tileRed, ROOFS.tileBrown, ROOFS.anthracite, ROOFS.anthracite], hash(seed + 1))
    : pick([ROOFS.gravel, ROOFS.grey, ROOFS.black, ROOFS.gravel, ROOFS.grey, ROOFS.green], hash(seed + 1));
  return { wall, roof, windows: !garage };
}

/** OSM building → colours, windows (Danish palette: brick, white-washed, black-tarred summer houses). */
function osmStyle(b, seed) {
  const h = hash(seed);
  const small = new Set(['garage', 'garages', 'shed', 'carport', 'hut', 'bunker', 'greenhouse', 'roof']);
  const summer = b.type === 'bungalow' || b.type === 'cabin' || b.type === 'allotment_house';
  const byMaterial = { brick: WALLS.brickRed, plaster: WALLS.whitewash, wood: WALLS.woodBlack, concrete: WALLS.grey, metal: WALLS.metal };
  const wall = byMaterial[b.wallMaterial] ?? (summer ? pick([WALLS.woodBlack, WALLS.woodBlack, WALLS.brickYellow, WALLS.whitewash], h)
    : b.type === 'industrial' || b.type === 'warehouse' ? pick([WALLS.metal, WALLS.grey], h)
      : pick([WALLS.brickYellow, WALLS.brickRed, WALLS.whitewash, WALLS.brickYellow, WALLS.plaster], h));
  const byRoof = { thatch: ROOFS.thatch, roof_tiles: ROOFS.tileRed, tar_paper: ROOFS.black, metal: ROOFS.metal, grass: ROOFS.green, concrete: ROOFS.grey, eternit: ROOFS.grey };
  const roof = byRoof[b.roofMaterial] ?? (summer ? pick([ROOFS.black, ROOFS.anthracite, ROOFS.grey], hash(seed + 1))
    : pick([ROOFS.tileRed, ROOFS.black, ROOFS.anthracite, ROOFS.tileBrown], hash(seed + 1)));
  return { wall, roof, windows: !small.has(b.type) };
}

// ---------- material ---------------------------------------------------------------------------------------------
function createBuildingMaterial({ u, toSun, sunShadow, nightFloor }) {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  material.colorNode = Fn(() => {
    const p = positionWorld;
    const info = attribute('bInfo', 'vec3'); // x roof, y windows, z height above the base
    const n0 = normalize(attribute('normal', 'vec3')); // world normals: the meshes are translated only
    const V = normalize(u.cameraWorld.sub(p));
    const n = n0.mul(sign(dot(n0, V).add(1e-6))); // face the camera (double-sided walls)
    const up = normalize(p.mul(vec3(1, 1, 1 / (1 - E2))));
    const pKm = p.mul(0.001).mul(vec3(1, 1, ATMOSPHERE.zScale));
    const r = max(length(pKm), ATMOSPHERE.bottomRadius + 0.001);
    const muS = dot(normalize(pKm), u.sunDirectionScaled);
    // sunlight and cloud shadow per vertex: buildings are small against both, and it saves the noise
    const beam = vertexStage(toSun(r, muS));
    const shadow = vertexStage(sunShadow ? sunShadow(geodeticLatLon(positionWorld), positionWorld) : float(1));
    const sunT = beam.mul(shadow);
    // the sky's light (grey under cloud) and the sunlight coming down through the cloud (clouds.js)
    const light = skyLight(muS, shadow);
    const skyIrr = light.sky.add(beam.mul(light.diffuse));

    // windows: a grid on vertical walls – rows every 3 m above the base, columns every 2.6 m along the wall,
    // anchored to the ground through the double-precision camera offset
    const qm = u.detailOrigin.mul(DETAIL_SCALE).add(u.viewToWorld.mul(positionView));
    const along = dot(qm, normalize(cross(up, n).add(vec3(1e-6, 0, 0))));
    const fy = fract(info.z.div(3));
    const fx = fract(along.div(2.6));
    const vertical = step(abs(dot(n, up)), 0.3);
    const isWin = float(1).sub(info.x).mul(info.y).mul(vertical).mul(step(0.35, fy)).mul(step(fy, 0.8)).mul(step(0.25, fx)).mul(step(fx, 0.75)).mul(step(0.9, info.z));
    const albedo = mix(attribute('bColor', 'vec3'), vec3(0.02, 0.025, 0.03), isWin);

    const E = u.sunIlluminance;
    const irr = E.mul(sunT.mul(max(dot(n, u.sunDirection), 0)).add(skyIrr.mul(dot(n, up).mul(0.45).add(0.55)))).add(nightFloor);
    const radiance = albedo.mul(1 / PI).mul(irr).toVar();
    // after dusk about half the windows glow
    const cell = floor(info.z.div(3)).mul(73.13).add(floor(along.div(2.6)).mul(17.31));
    const rnd = fract(sin(cell).mul(43758.5453));
    const night = smoothstep(-0.12, 0.02, muS).oneMinus();
    radiance.addAssign(vec3(1, 0.74, 0.42).mul(0.018).mul(isWin).mul(step(0.5, rnd)).mul(night));
    return radiance;
  })();
  return material;
}

// ---------- the common mesh form and ground fitting ------------------------------------------------------------------
/**
 * Turns building triangles (world positions and normals in double precision) into the common mesh form.
 * @param {{ world: Float64Array, normals: Float32Array, colors: Float32Array, info: Float32Array, vb: Uint32Array,
 *           index?: ArrayLike<number>, extra?: Record<string, THREE.BufferAttribute> }} data
 * @param {Array<{ samples: Float64Array, up: number[], info: object }>} buildings
 */
function makeBuildingMesh(data, buildings, material) {
  const n = data.world.length / 3;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    cx += data.world[i * 3];
    cy += data.world[i * 3 + 1];
    cz += data.world[i * 3 + 2];
  }
  cx /= n;
  cy /= n;
  cz /= n;
  const base = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    base[i * 3] = data.world[i * 3] - cx;
    base[i * 3 + 1] = data.world[i * 3 + 1] - cy;
    base[i * 3 + 2] = data.world[i * 3 + 2] - cz;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute('bColor', new THREE.BufferAttribute(data.colors, 3));
  geometry.setAttribute('bInfo', new THREE.BufferAttribute(data.info, 3));
  for (const [name, attr] of Object.entries(data.extra ?? {})) geometry.setAttribute(name, attr);
  if (data.index) geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(data.index), 1));
  geometry.computeBoundingSphere();
  geometry.boundingSphere.radius += 300; // room for the ground offsets
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(cx, cy, cz);
  mesh.userData.fit = { base, vb: data.vb, buildings, offsets: new Float32Array(buildings.length).fill(NaN) };
  return mesh;
}

/** Sets a mesh's buildings onto the terrain; returns the number of terrain samples taken. */
function fitMesh(mesh, groundHeight) {
  const fit = mesh.userData.fit;
  let changed = false;
  let samples = 0;
  for (let b = 0; b < fit.buildings.length; b++) {
    const s = fit.buildings[b].samples;
    let ground = Infinity;
    for (let k = 0; k < s.length; k += 2) {
      const g = groundHeight(s[k], s[k + 1]);
      samples++;
      if (g !== null && g < ground) ground = g;
    }
    if (ground === Infinity) continue;
    if (!(Math.abs(ground - fit.offsets[b]) < 0.05)) {
      fit.offsets[b] = ground;
      changed = true;
    }
  }
  if (changed) {
    const pos = mesh.geometry.attributes.position.array;
    const { base, vb, buildings, offsets } = fit;
    for (let i = 0; i < vb.length; i++) {
      const b = vb[i];
      const o = Number.isNaN(offsets[b]) ? 0 : offsets[b];
      const upv = buildings[b].up;
      pos[i * 3] = base[i * 3] + upv[0] * o;
      pos[i * 3 + 1] = base[i * 3 + 1] + upv[1] * o;
      pos[i * 3 + 2] = base[i * 3 + 2] + upv[2] * o;
    }
    mesh.geometry.attributes.position.needsUpdate = true;
  }
  return samples;
}

const upAt = (latRad, lonRad) => [Math.cos(latRad) * Math.cos(lonRad), Math.cos(latRad) * Math.sin(lonRad), Math.sin(latRad)];

// ---------- NRW LoD2 (3D Tiles) --------------------------------------------------------------------------------------
function adoptNrwScene(scene, material) {
  const meta = scene.userData.structuralMetadata;
  scene.updateMatrixWorld(true);
  const meshes = [];
  scene.traverse((m) => {
    if (m.isMesh) meshes.push(m);
  });
  const v = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const fid = g.getAttribute('_feature_id_0');
    if (!pos || !fid) continue;
    const count = pos.count;
    nm.getNormalMatrix(mesh.matrixWorld);
    const world = new Float64Array(count * 3);
    const normals = new Float32Array(count * 3);
    const heights = new Float64Array(count);
    const lats = new Float64Array(count);
    const lons = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      world[i * 3] = v.x;
      world[i * 3 + 1] = v.y;
      world[i * 3 + 2] = v.z;
      const geo = ecefToGeodetic(v.x, v.y, v.z);
      heights[i] = geo.h;
      lats[i] = geo.lat;
      lons[i] = geo.lon;
      if (nor) {
        nrm.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        normals[i * 3] = nrm.x;
        normals[i * 3 + 1] = nrm.y;
        normals[i * 3 + 2] = nrm.z;
      }
    }
    // features → buildings (the surfaces of one building share its ALKIS id)
    const features = new Map();
    const buildingOf = new Map();
    const buildings = [];
    const featureData = (id) => {
      if (!features.has(id)) {
        let d;
        try {
          d = meta ? meta.getPropertyTableData(0, id) : {};
        } catch {
          d = {}; // a feature without a table row: plain grey building
        }
        features.set(id, { ...d });
      }
      return features.get(id);
    };
    const vb = new Uint32Array(count);
    const colors = new Float32Array(count * 3);
    const info = new Float32Array(count * 3);
    const isRoof = new Uint8Array(count);
    const ground = new Map(); // building → ground ring vertex indices
    // pass 1: vertices → buildings; a building's name, function and roof type sit on some of its surfaces
    for (let i = 0; i < count; i++) {
      const f = featureData(fid.getX(i));
      const key = f.gml_id ?? `f${fid.getX(i)}`;
      let b = buildingOf.get(key);
      if (b === undefined) {
        b = buildings.length;
        buildingOf.set(key, b);
        buildings.push({ samples: null, up: null, info: { source: 'nrw', id: key, name: '', function: '', roofType: 0, height: 0 } });
        ground.set(b, []);
      }
      const bi = buildings[b].info;
      if (!bi.name && f.name) bi.name = f.name;
      if (!bi.function && f.function) bi.function = f.function;
      const rt = roofTypeCode(f.roofType);
      if (!bi.roofType && rt) bi.roofType = rt;
      vb[i] = b;
      isRoof[i] = surfaceIsRoof(f.surfaceType) ? 1 : 0;
      bi.height = Math.max(bi.height, heights[i]);
      if (heights[i] < 0.5) ground.get(b).push(i);
    }
    // pass 2: colours from the merged attributes
    const styles = buildings.map((b) => nrwStyle(b.info.roofType, b.info.height, hashString(b.info.id)));
    for (let i = 0; i < count; i++) {
      const st = styles[vb[i]];
      colors.set(isRoof[i] ? st.roof : st.wall, i * 3);
      info[i * 3] = isRoof[i];
      info[i * 3 + 1] = st.windows ? 1 : 0;
      info[i * 3 + 2] = heights[i];
    }
    for (let b = 0; b < buildings.length; b++) {
      const ring = ground.get(b);
      const pickN = Math.min(4, ring.length);
      const samples = new Float64Array((pickN + 1) * 2);
      let la = 0;
      let lo = 0;
      for (let k = 0; k < pickN; k++) {
        const i = ring[Math.floor((k * ring.length) / pickN)];
        samples[k * 2] = lats[i];
        samples[k * 2 + 1] = lons[i];
        la += lats[i];
        lo += lons[i];
      }
      if (pickN) {
        samples[pickN * 2] = la / pickN;
        samples[pickN * 2 + 1] = lo / pickN;
      }
      buildings[b].samples = pickN ? samples : new Float64Array(0);
      buildings[b].up = upAt(pickN ? la / pickN : lats[0], pickN ? lo / pickN : lons[0]);
    }
    const replacement = makeBuildingMesh({ world, normals, colors, info, vb, index: g.index?.array, extra: { _feature_id_0: fid } }, buildings, material);
    // swap the content: the tile keeps its scene, our mesh replaces the original under the same parent
    const parent = mesh.parent;
    parent.updateMatrixWorld(true);
    const inv = parent.matrixWorld.clone().invert();
    replacement.applyMatrix4(inv); // world position → the parent's frame
    replacement.updateMatrix();
    parent.add(replacement);
    parent.remove(mesh);
    g.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
    else mesh.material?.dispose();
  }
}

// the service returns enum names, not codes (schema: roofType UINT16, surfaceType INT8)
const ROOF_TYPE_CODES = {
  'No data': 0, Flachdach: 1000, Pultdach: 2100, 'Versetztes Pultdach': 2200, Satteldach: 3100, Walmdach: 3200, Krüppelwalmdach: 3300,
  Mansardendach: 3400, Zeltdach: 3500, Kegeldach: 3600, Kuppeldach: 3700, Sheddach: 3800, Bogendach: 3900, Turmdach: 4000, Mischform: 5000, Sonstiges: 9999,
};
const roofTypeCode = (v) => (typeof v === 'number' ? v : (ROOF_TYPE_CODES[v] ?? (Number(v) || 0)));
const surfaceIsRoof = (v) => v === 'roof' || v === 0;

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

// ---------- OSM buildings (Fanø) ---------------------------------------------------------------------------------------
const CELL_DEG = 0.02;

function buildOsmChunk(list, material) {
  let triCount = 0;
  const geos = list.map(({ b, seed }) => {
    const n = b.latLon.length / 2;
    let la = 0;
    let lo = 0;
    for (let k = 0; k < n; k++) {
      la += b.latLon[k * 2];
      lo += b.latLon[k * 2 + 1];
    }
    la /= n;
    lo /= n;
    const phi = la * DEG;
    const lam = lo * DEG;
    const sinp = Math.sin(phi);
    const w = Math.sqrt(1 - E2 * sinp * sinp);
    const rn = WGS84.a / w; // prime vertical
    const rm = (WGS84.a * (1 - E2)) / (w * w * w); // meridian
    const xy = new Array(n * 2);
    for (let k = 0; k < n; k++) {
      xy[k * 2] = (b.latLon[k * 2 + 1] - lo) * DEG * rn * Math.cos(phi);
      xy[k * 2 + 1] = (b.latLon[k * 2] - la) * DEG * rm;
    }
    const area = Math.abs(polygonArea(xy));
    const form = buildingForm(b, area);
    const geo = buildingGeometry(xy, form);
    triCount += geo.positions.length / 9;
    return { b, seed, geo, phi, lam, n, form };
  });
  const vCount = triCount * 3;
  const world = new Float64Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const colors = new Float32Array(vCount * 3);
  const info = new Float32Array(vCount * 3);
  const vb = new Uint32Array(vCount);
  const buildings = [];
  let o = 0;
  for (const { b, seed, geo, phi, lam, n, form } of geos) {
    if (!geo.positions.length) continue;
    const bi = buildings.length;
    const style = osmStyle(b, seed);
    const up = upAt(phi, lam);
    const east = [-Math.sin(lam), Math.cos(lam), 0];
    const north = [-Math.sin(phi) * Math.cos(lam), -Math.sin(phi) * Math.sin(lam), Math.cos(phi)];
    const origin = geodeticToEcef(phi, lam, 0);
    const vn = geo.positions.length / 3;
    let top = 0;
    for (let k = 0; k < vn; k++) {
      const x = geo.positions[k * 3];
      const y = geo.positions[k * 3 + 1];
      const z = geo.positions[k * 3 + 2];
      for (let c = 0; c < 3; c++) {
        world[o * 3 + c] = origin[c] + east[c] * x + north[c] * y + up[c] * z;
        normals[o * 3 + c] = east[c] * geo.normals[k * 3] + north[c] * geo.normals[k * 3 + 1] + up[c] * geo.normals[k * 3 + 2];
      }
      const isRoof = geo.roof[k] === 1;
      colors.set(isRoof ? style.roof : style.wall, o * 3);
      info[o * 3] = isRoof ? 1 : 0;
      info[o * 3 + 1] = style.windows ? 1 : 0;
      info[o * 3 + 2] = z;
      top = Math.max(top, z);
      vb[o] = bi;
      o++;
    }
    const sn = Math.min(4, n);
    const samples = new Float64Array((sn + 1) * 2);
    for (let k = 0; k < sn; k++) {
      const i = Math.floor((k * n) / sn);
      samples[k * 2] = b.latLon[i * 2] * DEG;
      samples[k * 2 + 1] = b.latLon[i * 2 + 1] * DEG;
    }
    samples[sn * 2] = phi;
    samples[sn * 2 + 1] = lam;
    buildings.push({
      samples, up,
      info: { source: 'osm', type: b.type, levels: b.levels, roof: form.roof, roofMaterial: b.roofMaterial, height: Math.round(top * 10) / 10, tagged: b.height > 0 || b.levels > 0 },
    });
  }
  if (!buildings.length) return null;
  return makeBuildingMesh({ world: world.subarray(0, o * 3), normals: normals.subarray(0, o * 3), colors: colors.subarray(0, o * 3), info: info.subarray(0, o * 3), vb: vb.subarray(0, o) }, buildings, material);
}

// ---------- the manager ------------------------------------------------------------------------------------------------
/**
 * @param {{ u: object, toSun: Function, sunShadow?: Function, nightFloor: Node, camera: THREE.Camera,
 *           renderer: THREE.WebGPURenderer, groundHeight: (latRad: number, lonRad: number) => number|null,
 *           baseUrl: string, nrwUrl: string, osm: { file: string, box: object }, onChange: () => void }} opts
 */
export function createBuildings({ u, toSun, sunShadow, nightFloor, camera, renderer, groundHeight, baseUrl, nrwUrl, osm, onChange }) {
  const material = createBuildingMaterial({ u, toSun, sunShadow, nightFloor });
  const group = new THREE.Group();
  group.name = 'buildings';

  // NRW LoD2 as 3D Tiles 1.1 (implicit quadtree, glTF with EXT_mesh_features + EXT_structural_metadata)
  const tiles = new TilesRenderer(nrwUrl);
  tiles.registerPlugin(new ImplicitTilingPlugin());
  tiles.registerPlugin(new GLTFExtensionsPlugin({ metadata: true }));
  tiles.registerPlugin(new UpdateOnChangePlugin()); // no traversal while the camera rests
  tiles.errorTarget = 16; // buildings load near the camera; far ones are a few pixels anyway
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);
  group.add(tiles.group);
  const fitList = new Set();
  const collect = (scene) => scene.traverse((m) => {
    if (m.userData?.fit) {
      fitList.add(m);
      fitMesh(m, groundHeight);
    }
  });
  const onLoad = ({ scene }) => {
    try {
      adoptNrwScene(scene, material);
      collect(scene);
    } catch (err) {
      console.warn('[earth] NRW building tile could not be prepared:', err?.message ?? err);
    }
    onChange();
  };
  const onDispose = ({ scene }) => scene.traverse((m) => fitList.delete(m));
  tiles.addEventListener('load-model', onLoad);
  tiles.addEventListener('dispose-model', onDispose);
  tiles.addEventListener('needs-render', onChange);

  // Fanø: OSM footprints, built in batches once the camera comes near
  const osmGroup = new THREE.Group();
  osmGroup.name = 'osm-buildings';
  group.add(osmGroup);
  let osmState = 'idle'; // idle → loading → building → done | failed
  let osmQueue = [];
  const loadOsm = async () => {
    osmState = 'loading';
    try {
      const res = await fetch(`${baseUrl}${osm.file}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      }
      const { buildings } = decodeOsmBuildings(bytes);
      const cells = new Map();
      buildings.forEach((b, i) => {
        const key = `${Math.floor(b.latLon[0] / CELL_DEG)}|${Math.floor(b.latLon[1] / CELL_DEG)}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push({ b, seed: i * 1.618 });
      });
      osmQueue = [...cells.values()];
      osmState = 'building';
    } catch (err) {
      osmState = 'failed';
      console.warn('[earth] OSM buildings unavailable:', err?.message ?? err);
    }
  };

  let cursor = [];
  let fitDirty = true;
  const raycaster = new THREE.Raycaster();
  return {
    group,
    tiles,
    /** Call when terrain tiles arrived: the buildings are fitted to the ground again. */
    terrainChanged() {
      fitDirty = true;
    },
    /** Per frame: stream NRW tiles, build Fanø chunks, fit a batch of buildings to the terrain. */
    update({ active, nearOsm }) {
      group.visible = active;
      if (!active) return false;
      tiles.setResolutionFromRenderer(camera, renderer);
      tiles.update();
      if (nearOsm && osmState === 'idle') loadOsm();
      let busy = osmState === 'loading';
      if (osmState === 'building') {
        const chunk = osmQueue.shift();
        if (chunk) {
          try {
            const mesh = buildOsmChunk(chunk, material);
            if (mesh) {
              osmGroup.add(mesh);
              fitList.add(mesh);
              fitMesh(mesh, groundHeight);
            }
          } catch (err) {
            console.warn('[earth] OSM building chunk skipped:', err?.message ?? err);
          }
          busy = true;
        } else {
          osmState = 'done';
        }
      }
      // ground fitting: after the terrain changed, a budget of terrain samples per frame over the meshes
      if (fitDirty && !cursor.length) {
        cursor = [...fitList];
        fitDirty = false;
      }
      let budget = 2500;
      while (budget > 0 && cursor.length) {
        const m = cursor.pop();
        if (fitList.has(m) && m.parent) budget -= fitMesh(m, groundHeight);
      }
      const stats = tiles.stats;
      return busy || stats.downloading + stats.parsing > 0;
    },
    /** The building under a screen point (normalised device coordinates), or null. */
    pick(ndc) {
      if (!group.visible) return null;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(group, true);
      for (const hit of hits) {
        const fit = hit.object.userData?.fit;
        if (!fit || !hit.face) continue;
        return { ...fit.buildings[fit.vb[hit.face.a]].info, point: hit.point.clone() };
      }
      return null;
    },
    /**
     * ALKIS details of an NRW building (function, name, address) from the state's simplified ALKIS WFS
     * (dl-de/zero-2.0, CORS): the building whose footprint holds the picked point.
     */
    async alkis(info) {
      if (info.source !== 'nrw' || !info.point) return null;
      const g = ecefToGeodetic(info.point.x, info.point.y, info.point.z);
      const { easting: e, northing: n } = geodeticToUtm(g.lat, g.lon, 32);
      const bbox = `${(e - 0.5).toFixed(2)},${(n - 0.5).toFixed(2)},${(e + 0.5).toFixed(2)},${(n + 0.5).toFixed(2)},urn:ogc:def:crs:EPSG::25832`;
      const url = `${ALKIS_WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=ave:GebaeudeBauwerk&COUNT=5&BBOX=${bbox}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`ALKIS WFS ${res.status}`);
      const xml = new DOMParser().parseFromString(await res.text(), 'application/xml');
      const members = [...xml.getElementsByTagNameNS('*', 'GebaeudeBauwerk')];
      const text = (el, tag) => el.getElementsByTagNameNS('*', tag)[0]?.textContent?.trim() ?? '';
      const match = members.find((m) => text(m, 'oid').startsWith(info.id)) ?? members[0];
      if (!match) return null;
      return { code: text(match, 'gfkzshh'), functionText: text(match, 'funktion'), name: text(match, 'name'), address: text(match, 'lagebeztxt'), updated: text(match, 'aktualit').replace(/Z$/, '') };
    },
    get osmState() {
      return osmState;
    },
    dispose() {
      tiles.removeEventListener('load-model', onLoad);
      tiles.removeEventListener('dispose-model', onDispose);
      tiles.removeEventListener('needs-render', onChange);
      tiles.dispose();
      for (const m of osmGroup.children) m.geometry.dispose();
      material.dispose();
    },
  };
}
