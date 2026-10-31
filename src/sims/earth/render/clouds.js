/**
 * The global cloud layer, "2D first" (docs/earth-sim/08 §4, the view from space): two shells around the
 * ellipsoid – low and middle cloud at ≈ 2 km, high cloud (cirrus) at ≈ 9 km – whose opacity comes from
 * GFS cloud cover (data/gfs.js) broken up by fractal noise: the cover sets how much of the noise field
 * becomes cloud (the coverage remapping of Schneider 2015). Lit by the Sun through the atmosphere's
 * transmittance table, grey from below where the cloud is thick; they cast shadows on the ground
 * (`createCloudShadow`). Volumetric clouds near the ground follow with the weather pipeline (M6).
 */
import * as THREE from 'three/webgpu';
import {
  Fn, vec2, vec3, float, uniform, max, normalize, dot, smoothstep, length, clamp, mix, positionWorld, fwidth, If,
  mx_fractal_noise_float,
} from 'three/tsl';
import { ATMOSPHERE } from './atmosphere.js';
import { geodeticLatLon } from './surface.js';
import { WGS84 } from '../geodesy.js';

const PI = Math.PI;
export const CLOUD_LAYERS = Object.freeze([
  { id: 'low', heightM: 2000, channels: ['r', 'g'], opacity: 0.94, scaleM: 60000, sharpness: 0.22, segments: [512, 256] },
  { id: 'high', heightM: 9000, channels: ['b'], opacity: 0.55, scaleM: 140000, sharpness: 0.45, segments: [384, 192] },
]);

/** GFS texture coordinates: rows from 90° N (node-centred, 721 rows at 0.25°), columns east from 0°. */
const gfsUv = Fn(([latLon]) => {
  const u = latLon.y.div(2 * PI).add(1).fract();
  const v = float(0.5).sub(latLon.x.div(PI)).mul(720 / 721).add(0.5 / 721);
  return vec2(u, v);
});

/**
 * Cloud opacity of a layer at a world position (TSL): the cover (max of its GFS channels, blended between
 * the two forecast steps) thresholds the noise.
 */
export function cloudOpacity(nodes, cover, layer, p, { detail = true } = {}) {
  const latLon = geodeticLatLon(p);
  const uv = gfsUv(latLon);
  const a = nodes.a.sample(uv);
  const b = nodes.b.sample(uv);
  const pick = (s) => layer.channels.map((c) => s[c]).reduce((x, y) => max(x, y));
  const c = mix(pick(a), pick(b), cover.mix).mul(cover.on);
  const q = p.div(layer.scaleM);
  // detail only where a pixel is small against the noise: from orbit the fine octaves would alias into
  // speckle, so the coarse noise takes over as the footprint grows (fwidth of the noise coordinates –
  // taken here, outside the branch below: derivatives need uniform control flow)
  // (the shadow variant runs per vertex too, where there are no derivatives: it uses the plain sharpness)
  const footprint = detail ? length(fwidth(q)) : null;
  const coarseWeight = detail ? smoothstep(0.08, 0.35, footprint) : null;
  const soft = detail ? max(float(layer.sharpness), footprint.mul(0.8)) : float(layer.sharpness);
  const alpha = float(0).toVar();
  // no cover, no cloud: skip the noise (most of the sky on a clear day)
  If(c.greaterThan(0.02), () => {
    const coarse = mx_fractal_noise_float(q, 2, 2.0, 0.5);
    // the shadows on the ground need only the coarse shapes (and run for every terrain pixel)
    const n = (detail ? mix(mx_fractal_noise_float(q, 4, 2.0, 0.5), coarse, coarseWeight) : coarse).mul(0.5).add(0.5);
    // the cover decides how much of the noise field is cloud; full cover closes it
    const threshold = c.oneMinus();
    alpha.assign(smoothstep(threshold.sub(soft.mul(0.4)), threshold.add(soft), n).mul(smoothstep(0.02, 0.12, c)).mul(layer.opacity));
  });
  return alpha;
}

/** Uniforms shared by the shells and the ground shadows: the blend between the two GFS steps, on/off. */
export function createCloudUniforms() {
  return { mix: uniform(0), on: uniform(1) };
}

/**
 * The cloud shells. Returns { group, uniforms, dispose }.
 * @param {{ u: ReturnType<import('./atmosphere.js').createAtmosphereUniforms>, toSun: Function,
 *           nodes: { a: Node, b: Node }, nightFloor: Node, cover: ReturnType<typeof createCloudUniforms> }} opts
 */
export function createClouds({ u, toSun, nodes, nightFloor, cover }) {
  const group = new THREE.Group();
  group.name = 'clouds';
  const materials = [];
  for (const layer of CLOUD_LAYERS) {
    const radius = WGS84.a + layer.heightM;
    const geometry = new THREE.SphereGeometry(radius, layer.segments[0], layer.segments[1]);
    geometry.rotateX(PI / 2); // poles on ±z (ECEF)
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: true });
    material.alphaTest = 0.03; // clear sky stays sky for the atmosphere pass (sun disc, stars)
    const alpha = Fn(() => cloudOpacity(nodes, cover, layer, positionWorld))(); // (If needs an Fn scope)
    // from below, a thin shell turns into a hard-edged band towards the horizon: fade it with distance
    // (volumetric clouds near the ground are M6)
    const camBelow = smoothstep(-50, 50, length(positionWorld).sub(length(u.cameraWorld)));
    const farFade = smoothstep(40000, 140000, length(positionWorld.sub(u.cameraWorld)));
    material.opacityNode = alpha.mul(float(1).sub(camBelow.mul(farFade)));
    material.colorNode = Fn(() => {
      const p = positionWorld;
      const pKm = p.mul(0.001).mul(vec3(1, 1, ATMOSPHERE.zScale));
      const r = max(length(pKm), ATMOSPHERE.bottomRadius + 0.001);
      const up = normalize(pKm);
      const muS = dot(up, u.sunDirectionScaled);
      const sunT = toSun(r, muS);
      // seen from below, a thick cloud is grey: the light it lets through falls with its opacity
      const below = smoothstep(-50, 50, length(p).sub(length(u.cameraWorld))); // camera below the shell
      const through = mix(float(1), clamp(alpha.oneMinus().mul(1.3), 0.18, 1), below);
      const sky = vec3(0.5, 0.62, 0.85).mul(smoothstep(-0.2, 0.3, muS).mul(0.22));
      const lit = u.sunIlluminance.mul(sunT.mul(clamp(muS.mul(0.6).add(0.4), 0, 1)).mul(through).add(sky)).add(nightFloor);
      return lit.mul(0.9 / PI);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(1, 1, (WGS84.b + layer.heightM) / radius); // follow the ellipsoid
    mesh.frustumCulled = false;
    mesh.renderOrder = layer.id === 'low' ? 1 : 2;
    group.add(mesh);
    materials.push(material);
  }
  return {
    group,
    uniforms: cover,
    dispose() {
      for (const m of group.children) m.geometry.dispose();
      for (const m of materials) m.dispose();
    },
  };
}

/**
 * Fraction of direct sunlight that the clouds let through at a ground position (TSL): each layer's
 * opacity where the ray towards the Sun crosses it.
 */
export function createCloudShadow({ u, nodes, cover }) {
  return (latLon, p) => {
    const up = normalize(p);
    const muS = max(dot(up, u.sunDirection), 0.05);
    let shadow = float(1);
    for (const layer of CLOUD_LAYERS) {
      const q = p.add(u.sunDirection.mul(float(layer.heightM).div(muS)));
      const a = cloudOpacity(nodes, cover, layer, q, { detail: false });
      shadow = shadow.mul(a.mul(layer.id === 'low' ? 0.85 : 0.45).oneMinus());
    }
    return shadow;
  };
}
