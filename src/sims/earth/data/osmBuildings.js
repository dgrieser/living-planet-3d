/**
 * Buildings from OpenStreetMap footprints (Fanø, milestone M3 – until the LoD2 reconstruction from the
 * DHM point cloud of docs/earth-sim/04 §6 exists). The footprints come baked into
 * public/earth/fanoe-buildings.bin.gz (tools/earth-pipeline/build-osm-buildings.mjs, ODbL); this module
 * decodes them and turns each one into walls and a roof:
 *
 *  - near-rectangular houses (footprint ≥ 80 % of its minimum bounding rectangle) with a sloped roof –
 *    tagged, or the default for small residential buildings – get a gabled, hipped or pyramidal roof over
 *    that rectangle, the ridge along its long side;
 *  - everything else is extruded with a flat roof.
 * Heights from `height`, else `building:levels` × 2.8 m, else a typical value per building type. The
 * shapes are generated – the model card says so; L-shaped houses come out flat-roofed.
 *
 * Geometry is produced in a local east/north/up frame (metres) with the ground at 0; render/buildings.js
 * places it on the terrain. Pure functions, checked by scripts/check-earth-buildings.mjs.
 */
import { ShapeUtils, Vector2 } from 'three/webgpu';

export const SLOPED_ROOFS = new Set(['gabled', 'hipped', 'half-hipped', 'pyramidal', 'mansard', 'gambrel']);
const SMALL_RESIDENTIAL = new Set(['yes', 'house', 'detached', 'bungalow', 'semidetached_house', 'terrace', 'cabin', 'allotment_house', 'farm', 'barn', 'farm_auxiliary', 'hut', 'church', 'chapel']);
const DEFAULT_EAVES = {
  apartments: 8.6, residential: 5.8, hotel: 8.6, office: 8.6, school: 6, kindergarten: 3.2,
  industrial: 6, warehouse: 6, commercial: 5, retail: 4.5, church: 8, chapel: 5, barn: 4.5, farm_auxiliary: 4,
  garage: 2.4, garages: 2.4, shed: 2.3, carport: 2.3, hut: 2.3, allotment_house: 2.4, bunker: 2.6, greenhouse: 2.6,
  roof: 3, boathouse: 2.8, windmill: 8,
};
const FLAT_TYPES = new Set(['garage', 'garages', 'shed', 'carport', 'industrial', 'warehouse', 'commercial', 'retail', 'bunker', 'greenhouse', 'roof', 'ruins', 'service']);

/** Decodes the baked asset (already gunzipped bytes). */
export function decodeOsmBuildings(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = view.getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLen)));
  const { count, ref, types, roofs, materials } = header;
  let o = 4 + headerLen;
  const attrsAt = o;
  o += count * 8;
  const countsAt = o;
  o += count * 2;
  const buildings = new Array(count);
  for (let i = 0; i < count; i++) {
    const a = attrsAt + i * 8;
    const n = view.getUint16(countsAt + i * 2, true);
    const pts = new Float64Array(n * 2);
    // each footprint's differences start again from the reference point
    let lat = Math.round(ref[0] * 1e7);
    let lon = Math.round(ref[1] * 1e7);
    for (let k = 0; k < n; k++) {
      lat += view.getInt32(o, true);
      lon += view.getInt32(o + 4, true);
      o += 8;
      pts[k * 2] = lat / 1e7;
      pts[k * 2 + 1] = lon / 1e7;
    }
    buildings[i] = {
      type: types[view.getUint8(a)],
      levels: view.getUint8(a + 1),
      roof: roofs[view.getUint8(a + 2)] || '',
      roofMaterial: materials[view.getUint8(a + 3)] || '',
      wallMaterial: materials[view.getUint8(a + 4)] || '',
      height: view.getUint16(a + 5, true) / 10,
      latLon: pts,
    };
  }
  return { header, buildings };
}

/** Signed area (m², counter-clockwise positive) of a polygon given as [x0, y0, x1, y1, …]. */
export function polygonArea(xy) {
  let a = 0;
  const n = xy.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += xy[i * 2] * xy[j * 2 + 1] - xy[j * 2] * xy[i * 2 + 1];
  }
  return a / 2;
}

/**
 * Minimum-area bounding rectangle, tried along every edge direction (footprints are small).
 * @returns {{ cx: number, cy: number, angle: number, length: number, width: number, area: number }}
 *   centre, direction of the long side (radians from +x), long and short side
 */
export function minAreaRect(xy) {
  const n = xy.length / 2;
  let best = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ang = Math.atan2(xy[j * 2 + 1] - xy[i * 2 + 1], xy[j * 2] - xy[i * 2]);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const u = xy[k * 2] * c + xy[k * 2 + 1] * s;
      const v = -xy[k * 2] * s + xy[k * 2 + 1] * c;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) {
      const uc = (u0 + u1) / 2;
      const vc = (v0 + v1) / 2;
      const long = u1 - u0 >= v1 - v0;
      best = {
        cx: uc * c - vc * s, cy: uc * s + vc * c, area,
        angle: long ? ang : ang + Math.PI / 2,
        length: Math.max(u1 - u0, v1 - v0), width: Math.min(u1 - u0, v1 - v0),
      };
    }
  }
  return best;
}

/** Eaves height, roof shape and pitch for a building (heights in metres). */
export function buildingForm(b, footprintArea) {
  let roof = b.roof;
  if (!roof || roof === 'other' || roof === 'many') {
    roof = SMALL_RESIDENTIAL.has(b.type) && footprintArea < 260 && !FLAT_TYPES.has(b.type) ? 'gabled' : 'flat';
  }
  const pitchDeg = b.roofMaterial === 'thatch' ? 50 : 40;
  let eaves;
  if (b.levels > 0) eaves = b.levels * 2.8 + 0.2;
  else eaves = DEFAULT_EAVES[b.type] ?? (footprintArea > 400 ? 5 : 2.8);
  return { roof, pitchDeg, eaves, height: b.height };
}

/**
 * Walls and roof of one building in a local frame (x east, y north, z up; ground at z = 0).
 * @param {number[]} xy footprint, metres (any orientation; the closing vertex not repeated)
 * @returns {{ positions: number[], normals: number[], roof: number[] }} per-vertex arrays (triangles);
 *   roof[i] = 1 for roof vertices, 0 for walls
 */
export function buildingGeometry(xy, form) {
  const out = { positions: [], normals: [], roof: [] };
  let pts = xy;
  if (polygonArea(pts) < 0) {
    pts = [];
    for (let i = xy.length / 2 - 1; i >= 0; i--) pts.push(xy[i * 2], xy[i * 2 + 1]);
  }
  const area = polygonArea(pts);
  if (area < 2) return out;
  const rect = minAreaRect(pts);
  const sloped = SLOPED_ROOFS.has(form.roof) && area / rect.area >= 0.8 && rect.width >= 2.5;
  const tri = (a, b0, c0, isRoof) => {
    let b = b0;
    let c = c0;
    // roofs face up whatever order the triangulation returned
    if (isRoof && (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0) [b, c] = [c, b];
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (const p of [a, b, c]) {
      out.positions.push(p[0], p[1], p[2]);
      out.normals.push(nx, ny, nz);
      out.roof.push(isRoof ? 1 : 0);
    }
  };
  const quad = (a, b, c, d, isRoof) => {
    tri(a, b, c, isRoof);
    tri(a, c, d, isRoof);
  };

  if (!sloped) {
    const top = form.height > 0 ? form.height : form.eaves;
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      quad([pts[i * 2], pts[i * 2 + 1], 0], [pts[j * 2], pts[j * 2 + 1], 0], [pts[j * 2], pts[j * 2 + 1], top], [pts[i * 2], pts[i * 2 + 1], top], false);
    }
    const contour = [];
    for (let i = 0; i < n; i++) contour.push(new Vector2(pts[i * 2], pts[i * 2 + 1]));
    for (const [a, b, c] of ShapeUtils.triangulateShape(contour, [])) {
      tri([contour[a].x, contour[a].y, top], [contour[b].x, contour[b].y, top], [contour[c].x, contour[c].y, top], true);
    }
    return out;
  }

  // a house over its bounding rectangle: corners in the long-side frame (u along the ridge)
  const c = Math.cos(rect.angle);
  const s = Math.sin(rect.angle);
  const hl = rect.length / 2;
  const hw = rect.width / 2;
  const at = (u, v, z) => [rect.cx + u * c - v * s, rect.cy + u * s + v * c, z];
  const rise = Math.min(hw * Math.tan((form.pitchDeg * Math.PI) / 180), 9);
  let eaves = form.eaves;
  if (form.height > 0) eaves = Math.max(2.2, form.height - rise);
  const ridge = eaves + rise;
  const A = at(-hl, -hw, 0);
  const B = at(hl, -hw, 0);
  const C = at(hl, hw, 0);
  const D = at(-hl, hw, 0);
  const Ae = at(-hl, -hw, eaves);
  const Be = at(hl, -hw, eaves);
  const Ce = at(hl, hw, eaves);
  const De = at(-hl, hw, eaves);
  quad(A, B, Be, Ae, false);
  quad(B, C, Ce, Be, false);
  quad(C, D, De, Ce, false);
  quad(D, A, Ae, De, false);
  if (form.roof === 'pyramidal' || (form.roof !== 'gabled' && rect.length - rect.width < 0.5)) {
    const apex = at(0, 0, ridge);
    tri(Ae, Be, apex, true);
    tri(Be, Ce, apex, true);
    tri(Ce, De, apex, true);
    tri(De, Ae, apex, true);
    return out;
  }
  if (form.roof === 'gabled' || form.roof === 'mansard' || form.roof === 'gambrel') {
    const R0 = at(-hl, 0, ridge);
    const R1 = at(hl, 0, ridge);
    quad(Ae, Be, R1, R0, true);
    quad(Ce, De, R0, R1, true);
    tri(Be, Ce, R1, false); // gable ends are wall
    tri(De, Ae, R0, false);
    return out;
  }
  // hipped (half-hipped drawn as hipped): the ridge stops short by the half width at each end
  const inset = Math.min(hw * (form.roof === 'half-hipped' ? 0.5 : 1), hl);
  const R0 = at(-hl + inset, 0, ridge);
  const R1 = at(hl - inset, 0, ridge);
  quad(Ae, Be, R1, R0, true);
  quad(Ce, De, R0, R1, true);
  tri(Be, Ce, R1, true);
  tri(De, Ae, R0, true);
  return out;
}
