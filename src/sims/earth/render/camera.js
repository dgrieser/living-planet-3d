/**
 * Camera poses on the globe and flights between them.
 *
 * A pose is geodetic: where the camera is (latitude, longitude, height above the ellipsoid) and where it
 * looks (heading clockwise from north, pitch above the horizon – negative looks down). `applyPose()` puts
 * a Three.js camera there in ECEF; `createFlight()` eases from the current camera to a pose along a great
 * circle, climbing on long hops so the globe comes into view on the way (the "cinematic" camera mode of
 * docs/earth-sim/10 §3).
 */
import * as THREE from 'three/webgpu';
import { geodeticToEcef, ecefToGeodetic, enuBasis, WGS84, DEG } from '../geodesy.js';

const _p = [0, 0, 0];

/** Orientation vectors of a pose in ECEF. */
export function poseVectors({ latDeg, lonDeg, headingDeg, pitchDeg }) {
  const { east, north, up } = enuBasis(latDeg * DEG, lonDeg * DEG);
  const h = headingDeg * DEG;
  const p = pitchDeg * DEG;
  const fE = Math.sin(h) * Math.cos(p);
  const fN = Math.cos(h) * Math.cos(p);
  const fU = Math.sin(p);
  const uE = -Math.sin(h) * Math.sin(p);
  const uN = -Math.cos(h) * Math.sin(p);
  const uU = Math.cos(p);
  const combine = (a, b, c) => new THREE.Vector3(
    east[0] * a + north[0] * b + up[0] * c,
    east[1] * a + north[1] * b + up[1] * c,
    east[2] * a + north[2] * b + up[2] * c,
  );
  return { forward: combine(fE, fN, fU), up: combine(uE, uN, uU) };
}

/** Put the camera at a pose. */
export function applyPose(camera, pose) {
  geodeticToEcef(pose.latDeg * DEG, pose.lonDeg * DEG, pose.heightM, _p);
  camera.position.set(_p[0], _p[1], _p[2]);
  const { forward, up } = poseVectors(pose);
  camera.up.copy(up);
  camera.lookAt(camera.position.clone().add(forward));
  camera.updateMatrixWorld();
}

/** Read the pose back from a camera. */
export function readPose(camera) {
  const g = ecefToGeodetic(camera.position.x, camera.position.y, camera.position.z);
  const { east, north, up } = enuBasis(g.lat, g.lon);
  const f = new THREE.Vector3();
  camera.getWorldDirection(f);
  const fE = f.x * east[0] + f.y * east[1] + f.z * east[2];
  const fN = f.x * north[0] + f.y * north[1] + f.z * north[2];
  const fU = f.x * up[0] + f.y * up[1] + f.z * up[2];
  return {
    latDeg: g.lat / DEG,
    lonDeg: g.lon / DEG,
    heightM: g.h,
    headingDeg: (Math.atan2(fE, fN) / DEG + 360) % 360,
    pitchDeg: Math.asin(Math.max(-1, Math.min(1, fU))) / DEG,
  };
}

/** Angular distance (rad) between two geodetic points, on the sphere. */
function centralAngle(a, b) {
  const la1 = a.latDeg * DEG;
  const la2 = b.latDeg * DEG;
  const dLon = (b.lonDeg - a.lonDeg) * DEG;
  const c = Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(dLon);
  return Math.acos(Math.max(-1, Math.min(1, c)));
}

/** Spherical interpolation of two positions given in degrees. */
function slerpLatLon(a, b, t) {
  const toVec = (p) => {
    const la = p.latDeg * DEG;
    const lo = p.lonDeg * DEG;
    return new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
  };
  const va = toVec(a);
  const vb = toVec(b);
  const omega = Math.acos(Math.max(-1, Math.min(1, va.dot(vb))));
  let v;
  if (omega < 1e-9) v = va;
  else v = va.multiplyScalar(Math.sin((1 - t) * omega) / Math.sin(omega)).add(vb.multiplyScalar(Math.sin(t * omega) / Math.sin(omega)));
  return { latDeg: Math.asin(Math.max(-1, Math.min(1, v.z / v.length()))) / DEG, lonDeg: Math.atan2(v.y, v.x) / DEG };
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const shortestAngle = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;

/**
 * A flight from one pose to another.
 * @returns {{ duration: number, at: (t: number) => object }} `at(seconds)` returns the pose at that time
 */
export function createFlight(from, to) {
  const angle = centralAngle(from, to);
  const groundDistance = angle * WGS84.a;
  // climb so the route stays in view on long hops; short hops just glide
  const apex = Math.max(from.heightM, to.heightM, Math.min(groundDistance * 0.6, 12e6));
  const duration = Math.min(4.5, Math.max(1.6, 1.6 + Math.log10(1 + groundDistance / 2000) * 0.9));
  const logH0 = Math.log(Math.max(from.heightM, 10));
  const logH1 = Math.log(Math.max(to.heightM, 10));
  const logApex = Math.log(Math.max(apex, 10));
  const dHeading = shortestAngle(from.headingDeg, to.headingDeg);
  return {
    duration,
    at(seconds) {
      const t = Math.min(1, Math.max(0, seconds / duration));
      const e = ease(t);
      const ll = slerpLatLon(from, to, e);
      // height: blend between the ends in log space, plus a bump towards the apex in the middle
      const base = logH0 + (logH1 - logH0) * e;
      const bump = Math.sin(Math.PI * e) * Math.max(0, logApex - Math.max(logH0, logH1));
      // look down more while high up so the globe stays in frame
      const pitchBlend = from.pitchDeg + (to.pitchDeg - from.pitchDeg) * e;
      const pitch = pitchBlend + (-90 - pitchBlend) * Math.sin(Math.PI * e) * Math.min(1, bump / 2);
      return {
        latDeg: ll.latDeg,
        lonDeg: ll.lonDeg,
        heightM: Math.exp(base + bump),
        headingDeg: from.headingDeg + dHeading * e,
        pitchDeg: Math.max(-89.9, Math.min(89.9, pitch)),
      };
    },
  };
}

/**
 * Where a ray first meets the ellipsoid inflated by `heightM` (ECEF, metres) – the readout uses this with
 * the terrain height under the hit for the place at the centre of the view.
 * @returns {THREE.Vector3|null}
 */
export function rayEllipsoid(origin, dir, heightM = 0) {
  const a = WGS84.a + heightM;
  const b = WGS84.b + heightM;
  // scale to a unit sphere
  const ox = origin.x / a;
  const oy = origin.y / a;
  const oz = origin.z / b;
  const dx = dir.x / a;
  const dy = dir.y / a;
  const dz = dir.z / b;
  const A = dx * dx + dy * dy + dz * dz;
  const B = 2 * (ox * dx + oy * dy + oz * dz);
  const C = ox * ox + oy * oy + oz * oz - 1;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  let t = (-B - s) / (2 * A);
  if (t < 0) t = (-B + s) / (2 * A);
  if (t < 0) return null;
  return new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
}
