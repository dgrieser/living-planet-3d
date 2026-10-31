/**
 * Trees (milestone M4, docs/earth-sim/06): every tree the 2023 laser scan shows in North
 * Rhine-Westphalia, found around the camera in 500 m cells (data/trees.js – NRW's canopy height model
 * from the nDOM WCS, species group from the leaf-off colour-infrared orthophoto), drawn as instanced
 * procedural broadleaf and conifer models with a near and a far level of detail, swaying in the wind and
 * following the season (leaf-out, autumn colour, bare crowns in winter – a simple calendar until the
 * phenology models of M7). Trees stand on the finest loaded terrain and are re-fitted when it refines.
 */
import * as THREE from 'three/webgpu';
import {
  Fn, vec3, float, attribute, positionWorld, positionLocal, normalWorld, normalize, dot, max, mix, length, clamp, smoothstep,
  sin, fract, uniform, vertexStage, screenCoordinate, hash, Discard, If,
} from 'three/tsl';
import { ATMOSPHERE } from './atmosphere.js';
import { geodeticLatLon } from './surface.js';
import { geodeticToUtm, utmToGeodetic, geodeticToEcef, WGS84 } from '../geodesy.js';

const PI = Math.PI;
const E2 = WGS84.e2;
const CELL = 500; // m, UTM 32N
const WCS = 'https://www.wcs.nrw.de/geobasis/wcs_nw_ndom';
const WMS_CIR = 'https://www.wms.nrw.de/geobasis/wms_nw_idop';
export const TREE_RANGE = Object.freeze({ loadM: 900, keepM: 1600, nearM: 600, maxConcurrent: 3, maxAltitudeM: 2500 });

/** Day of year → foliage (0 bare … 1 full) and autumn colour (0 … 1) of broadleaved trees in the lowland. */
export function leafCalendar(doy) {
  const ramp = (a, b, x) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  const foliage = ramp(105, 130, doy) * (1 - ramp(295, 320, doy));
  const autumn = ramp(272, 298, doy);
  return { foliage, autumn };
}

// ---------- unit tree geometries (z up, base 0, top 1, crown radius 1) ------------------------------------------
function part(geometry, isCrown) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const n = g.attributes.position.count;
  const tPart = new Float32Array(n).fill(isCrown ? 1 : 0);
  const tH = new Float32Array(n);
  for (let i = 0; i < n; i++) tH[i] = Math.max(0, Math.min(1, g.attributes.position.getZ(i)));
  g.setAttribute('tPart', new THREE.BufferAttribute(tPart, 1));
  g.setAttribute('tH', new THREE.BufferAttribute(tH, 1));
  g.deleteAttribute('uv');
  return g;
}

function merge(parts) {
  const names = ['position', 'normal', 'tPart', 'tH'];
  const total = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const size = parts[0].attributes[name].itemSize;
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of parts) {
      arr.set(g.attributes[name].array, o);
      o += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  parts.forEach((g) => g.dispose());
  return out;
}

const zUp = (g) => g.rotateX(PI / 2);

function broadleafGeometry(detail) {
  const trunk = zUp(new THREE.CylinderGeometry(0.06, 0.09, 0.5, detail ? 6 : 4, 1, true)).translate(0, 0, 0.25);
  const crown = new THREE.IcosahedronGeometry(1, detail ? 1 : 0).scale(1, 1, 0.42).translate(0, 0, 0.58);
  return merge([part(trunk, false), part(crown, true)]);
}

function coniferGeometry(detail) {
  const trunk = zUp(new THREE.CylinderGeometry(0.05, 0.07, 0.3, detail ? 6 : 4, 1, true)).translate(0, 0, 0.15);
  const parts = [part(trunk, false)];
  if (detail) {
    parts.push(part(zUp(new THREE.ConeGeometry(1, 0.62, 10, 1, true)).translate(0, 0, 0.12 + 0.31), true));
    parts.push(part(zUp(new THREE.ConeGeometry(0.72, 0.5, 10, 1, true)).translate(0, 0, 0.5 + 0.25), true));
  } else {
    parts.push(part(zUp(new THREE.ConeGeometry(1, 0.88, 5, 1, true)).translate(0, 0, 0.12 + 0.44), true));
  }
  return merge(parts);
}

// ---------- material -------------------------------------------------------------------------------------------------
function createTreeMaterial({ u, toSun, sunShadow, nightFloor, season, time, conifer }) {
  const material = new THREE.MeshBasicNodeMaterial();
  const seed = attribute('tSeed', 'float');
  const size = attribute('tSize', 'vec2'); // height, crown radius (m)
  const tH = attribute('tH', 'float');
  // wind: the crown sways along a fixed westerly, more at the top, each tree in its own rhythm
  const sway = sin(time.mul(1.6).add(seed.mul(6.283))).mul(0.6).add(sin(time.mul(0.7).add(seed.mul(17.0))).mul(0.4));
  material.positionNode = positionLocal.add(vec3(0.6, 0.8, 0).mul(sway.mul(size.x).mul(0.012).mul(tH.mul(tH))));
  material.colorNode = Fn(() => {
    const crown = attribute('tPart', 'float');
    const p = positionWorld;
    // broadleaved crowns thin out to bare twigs in winter (dithered, so no sorting of transparency)
    if (!conifer) {
      const keep = mix(float(0.5), float(1), season.foliage);
      If(crown.greaterThan(0.5).and(hash(screenCoordinate.xy.floor()).greaterThan(keep)), () => {
        Discard();
      });
    }
    const n = normalize(normalWorld);
    const up = normalize(p.mul(vec3(1, 1, 1 / (1 - E2))));
    const pKm = p.mul(0.001).mul(vec3(1, 1, ATMOSPHERE.zScale));
    const r = max(length(pKm), ATMOSPHERE.bottomRadius + 0.001);
    const muS = dot(normalize(pKm), u.sunDirectionScaled);
    const sunT = vertexStage(toSun(r, muS).mul(sunShadow ? sunShadow(geodeticLatLon(positionWorld), positionWorld) : float(1)));
    const skyIrr = vec3(0.45, 0.6, 1.0).mul(smoothstep(-0.2, 0.25, muS).mul(0.18)).mul(clamp(muS.add(0.6), 0.25, 1));
    const v = fract(seed.mul(7.13)).sub(0.5).mul(0.35).add(1); // per-tree brightness
    let leaf;
    if (conifer) {
      leaf = vec3(0.014, 0.03, 0.016);
    } else {
      const summer = vec3(0.028, 0.056, 0.017);
      const autumn = mix(vec3(0.12, 0.05, 0.012), vec3(0.1, 0.075, 0.016), fract(seed.mul(3.7)));
      const bare = vec3(0.035, 0.031, 0.028); // grey-brown twigs
      // each tree turns in its own week or two
      const turn = clamp(season.autumn.mul(1.6).sub(fract(seed.mul(5.3)).mul(0.6)), 0, 1);
      leaf = mix(bare, mix(summer, autumn, turn), smoothstep(0.15, 0.6, season.foliage));
    }
    const trunk = vec3(0.045, 0.038, 0.03);
    const albedo = mix(trunk, leaf.mul(v), crown);
    // crowns: light wraps round (foliage scatters), the inside is darker towards the trunk
    const wrap = max(dot(n, u.sunDirection).mul(0.6).add(0.4), 0);
    const irr = u.sunIlluminance.mul(sunT.mul(wrap).add(skyIrr.mul(dot(n, up).mul(0.35).add(0.65)))).add(nightFloor);
    return albedo.mul(1 / PI).mul(irr).mul(mix(float(1), attribute('tH', 'float').mul(0.5).add(0.6), crown));
  })();
  return material;
}

// ---------- cells ------------------------------------------------------------------------------------------------------
async function decodeFloatTiff(buffer) {
  const { fromArrayBuffer } = await import('geotiff');
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const [data] = await image.readRasters();
  return { data: data instanceof Float32Array ? data : Float32Array.from(data), w: image.getWidth(), h: image.getHeight() };
}

/**
 * @param {{ u: object, toSun: Function, sunShadow?: Function, nightFloor: Node, camera: THREE.Camera,
 *           groundHeight: (latRad: number, lonRad: number) => number|null, onChange: () => void }} opts
 */
export function createTrees({ u, toSun, sunShadow, nightFloor, camera, groundHeight, onChange }) {
  const season = { foliage: uniform(1), autumn: uniform(0) };
  const time = uniform(0);
  const materials = [false, true].map((conifer) => createTreeMaterial({ u, toSun, sunShadow, nightFloor, season, time, conifer }));
  const geometries = {
    near: [broadleafGeometry(true), coniferGeometry(true)],
    far: [broadleafGeometry(false), coniferGeometry(false)],
  };
  const group = new THREE.Group();
  group.name = 'trees';
  const cells = new Map(); // "e|n" → cell
  let loading = 0;
  let worker = null;
  let jobId = 0;
  const pending = new Map();
  let refit = false;

  function detect(payload, transfer) {
    worker ??= new Worker(new URL('../data/treeWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const p = pending.get(ev.data.id);
      pending.delete(ev.data.id);
      if (p) (ev.data.error ? p.reject(new Error(ev.data.error)) : p.resolve(ev.data.result));
    };
    const id = ++jobId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, ...payload }, transfer);
    });
  }

  async function loadCell(cell) {
    const { e0, n0 } = cell;
    const chmUrl = `${WCS}?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=nw_ndom&FORMAT=image/tiff&SUBSET=x(${e0},${e0 + CELL})&SUBSET=y(${n0},${n0 + CELL})&SCALESIZE=x(${CELL}),y(${CELL})`;
    const cirUrl = `${WMS_CIR}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=nw_idop_cir&STYLES=&CRS=EPSG:25832&BBOX=${e0},${n0},${e0 + CELL},${n0 + CELL}&WIDTH=250&HEIGHT=250&FORMAT=image/png`;
    const [chmRes, cirRes] = await Promise.all([fetch(chmUrl), fetch(cirUrl).catch(() => null)]);
    if (!chmRes.ok) throw new Error(`nDOM ${chmRes.status}`);
    const chm = await decodeFloatTiff(await chmRes.arrayBuffer());
    let cir = null;
    if (cirRes?.ok) {
      const bmp = await createImageBitmap(await cirRes.blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      cir = { data: ctx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height };
      bmp.close();
    }
    const found = await detect(
      { chm: chm.data, w: chm.w, h: chm.h, res: CELL / chm.w, cir: cir?.data ?? null, cw: cir?.w ?? 0, ch: cir?.h ?? 0 },
      [chm.data.buffer, ...(cir ? [cir.data.buffer] : [])],
    );
    if (cell.disposed) return;
    buildCell(cell, found);
  }

  function buildCell(cell, f) {
    const n = f.height.length;
    // the cell centre (h = 0) anchors the meshes; instances are placed relative to it
    const c = utmToGeodetic(cell.e0 + CELL / 2, cell.n0 + CELL / 2, 32);
    const center = geodeticToEcef(c.lat, c.lon, 0);
    cell.center = center;
    const trees = { lat: new Float64Array(n), lon: new Float64Array(n), height: f.height, radius: f.radius, conifer: f.conifer, ground: new Float32Array(n).fill(NaN) };
    for (let i = 0; i < n; i++) {
      const g = utmToGeodetic(cell.e0 + f.east[i], cell.n0 + f.north[i], 32);
      trees.lat[i] = g.lat;
      trees.lon[i] = g.lon;
    }
    cell.trees = trees;
    cell.meshes = [0, 1].map((species) => {
      const idx = [];
      for (let i = 0; i < n; i++) if (trees.conifer[i] === species) idx.push(i);
      const mesh = new THREE.InstancedMesh(geometries.near[species], materials[species], Math.max(1, idx.length));
      mesh.count = idx.length;
      mesh.position.set(center[0], center[1], center[2]);
      mesh.frustumCulled = false;
      const seeds = new Float32Array(idx.length);
      const sizes = new Float32Array(idx.length * 2);
      idx.forEach((i, k) => {
        seeds[k] = ((i * 0.618034) % 1 + (cell.e0 + cell.n0) * 1e-5) % 1;
        sizes[k * 2] = trees.height[i];
        sizes[k * 2 + 1] = trees.radius[i];
      });
      mesh.geometry = geometries.near[species];
      mesh.userData.instances = idx;
      mesh.userData.attrs = { tSeed: new THREE.InstancedBufferAttribute(seeds, 1), tSize: new THREE.InstancedBufferAttribute(sizes, 2) };
      attachInstanceAttributes(mesh, geometries.near[species]);
      group.add(mesh);
      return mesh;
    });
    cell.lod = 'near';
    placeCell(cell);
    cell.status = 'ready';
    onChange();
  }

  // instanced attributes live on a per-mesh geometry clone that shares the unit tree's vertex buffers
  function attachInstanceAttributes(mesh, unit) {
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(unit.attributes)) g.setAttribute(name, attr);
    g.setAttribute('tSeed', mesh.userData.attrs.tSeed);
    g.setAttribute('tSize', mesh.userData.attrs.tSize);
    if (mesh.userData.ownGeometry) mesh.userData.ownGeometry.dispose();
    mesh.geometry = g;
    mesh.userData.ownGeometry = g;
  }

  const _m = new THREE.Matrix4();
  /** Instance matrices: base on the ground, axes east/north scaled by the crown radius, up by the height. */
  function placeCell(cell) {
    const t = cell.trees;
    let changed = false;
    for (let i = 0; i < t.height.length; i++) {
      const g = groundHeight(t.lat[i], t.lon[i]);
      if (g !== null && !(Math.abs(g - t.ground[i]) < 0.05)) {
        t.ground[i] = g;
        changed = true;
      }
    }
    if (!changed && cell.placed) return;
    cell.placed = true;
    for (const mesh of cell.meshes) {
      mesh.userData.instances.forEach((i, k) => {
        const lat = t.lat[i];
        const lon = t.lon[i];
        const cl = Math.cos(lat);
        const sl = Math.sin(lat);
        const co = Math.cos(lon);
        const so = Math.sin(lon);
        const up = [cl * co, cl * so, sl];
        const east = [-so, co, 0];
        const north = [-sl * co, -sl * so, cl];
        const base = geodeticToEcef(lat, lon, Number.isNaN(t.ground[i]) ? 0 : t.ground[i] - 0.3);
        const r = t.radius[i];
        const h = t.height[i];
        _m.set(
          east[0] * r, north[0] * r, up[0] * h, base[0] - cell.center[0],
          east[1] * r, north[1] * r, up[1] * h, base[1] - cell.center[1],
          east[2] * r, north[2] * r, up[2] * h, base[2] - cell.center[2],
          0, 0, 0, 1,
        );
        mesh.setMatrixAt(k, _m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function disposeCell(cell) {
    cell.disposed = true;
    for (const mesh of cell.meshes ?? []) {
      group.remove(mesh);
      mesh.userData.ownGeometry?.dispose();
      mesh.dispose();
    }
  }

  let lastStats = { cells: 0, trees: 0 };
  return {
    group,
    season,
    terrainChanged() {
      refit = true;
    },
    /**
     * Per frame: load the cells around the view centre, drop far ones, switch levels of detail, sway.
     * @param {{ active: boolean, latDeg: number, lonDeg: number, doy: number, seconds: number }} s
     */
    update({ active, latDeg, lonDeg, camLatDeg = latDeg, camLonDeg = lonDeg, doy, seconds }) {
      group.visible = active;
      time.value = seconds;
      const leaf = leafCalendar(doy);
      season.foliage.value = leaf.foliage;
      season.autumn.value = leaf.autumn;
      if (!active) return false;
      const { easting: E, northing: N } = geodeticToUtm(latDeg * (PI / 180), lonDeg * (PI / 180), 32);
      const cam = geodeticToUtm(camLatDeg * (PI / 180), camLonDeg * (PI / 180), 32);
      // cells within reach of the camera's foot point and of the centre of the view, nearest first
      const want = [];
      const seen = new Set();
      const r = TREE_RANGE.loadM;
      const near = Math.hypot(E - cam.easting, N - cam.northing) < 2500;
      for (const [pe, pn] of near ? [[cam.easting, cam.northing], [E, N]] : [[cam.easting, cam.northing]]) {
        for (let e = Math.floor((pe - r) / CELL) * CELL; e <= pe + r; e += CELL) {
          for (let n = Math.floor((pn - r) / CELL) * CELL; n <= pn + r; n += CELL) {
            const d = Math.hypot(e + CELL / 2 - cam.easting, n + CELL / 2 - cam.northing);
            const dp = Math.hypot(e + CELL / 2 - pe, n + CELL / 2 - pn);
            if (dp <= r + CELL * 0.7 && !seen.has(`${e}|${n}`)) {
              seen.add(`${e}|${n}`);
              want.push({ e, n, d });
            }
          }
        }
      }
      want.sort((a, b) => a.d - b.d);
      for (const { e, n } of want) {
        const key = `${e}|${n}`;
        if (cells.has(key) || loading >= TREE_RANGE.maxConcurrent) continue;
        const cell = { e0: e, n0: n, status: 'loading' };
        cells.set(key, cell);
        loading++;
        loadCell(cell).catch((err) => {
          cell.status = 'failed';
          console.warn('[earth] tree cell failed:', key, err?.message ?? err);
        }).finally(() => {
          loading--;
          onChange();
        });
      }
      // drop far cells, switch detail by distance to the camera
      const camPos = camera.position;
      let trees = 0;
      for (const [key, cell] of cells) {
        const d = Math.min(Math.hypot(cell.e0 + CELL / 2 - E, cell.n0 + CELL / 2 - N), Math.hypot(cell.e0 + CELL / 2 - cam.easting, cell.n0 + CELL / 2 - cam.northing));
        if (d > TREE_RANGE.keepM) {
          disposeCell(cell);
          cells.delete(key);
          continue;
        }
        if (cell.status !== 'ready') continue;
        const dc = Math.hypot(cell.center[0] - camPos.x, cell.center[1] - camPos.y, cell.center[2] - camPos.z);
        const lod = dc < TREE_RANGE.nearM + CELL * 0.7 ? 'near' : 'far';
        if (lod !== cell.lod) {
          cell.lod = lod;
          cell.meshes.forEach((m, species) => attachInstanceAttributes(m, geometries[lod][species]));
        }
        trees += cell.trees.height.length;
      }
      if (refit) {
        refit = false;
        for (const cell of cells.values()) if (cell.status === 'ready') placeCell(cell);
      }
      lastStats = { cells: cells.size, trees };
      return loading > 0;
    },
    get stats() {
      return lastStats;
    },
    dispose() {
      for (const cell of cells.values()) disposeCell(cell);
      cells.clear();
      worker?.terminate();
      materials.forEach((m) => m.dispose());
      Object.values(geometries).flat().forEach((g) => g.dispose());
    },
  };
}
