/**
 * Clouds (docs/earth-sim/08 §4), drawn in the atmosphere post pass (render/atmosphere.js):
 *
 *  - **one cloud field** for everything: GFS low / middle / high cover (data/gfs.js), corrected by the
 *    Meteosat cloud mask and cloud-top height where the satellite sees (data/satellite.js – satellite clear
 *    thins the model's cloud, satellite cloudy fills it in up to the observed top), with heights from the
 *    GFS ceiling and convective cover: low cloud from the ceiling up – a few hundred metres of stratus, a
 *    kilometre or two of cumulus, towers of 6–8 km where deep convection rains –, middle cloud 3.5–5.5 km,
 *    cirrus 8–10.5 km. Inside a layer the cover thresholds tileable Perlin–Worley noise (Schneider 2015),
 *    eroded by finer Worley noise; the noise drifts with the wind.
 *  - **volumetric** below ≈ 50 km: ray marching through the field – fine steps inside the occupied height
 *    intervals of each column (at most 120 m of height per step), analytic jumps between them, jittered –,
 *    sunlight through the atmosphere's transmittance table and a short light march towards the Sun,
 *    a two-lobe phase function with Wrenninge's multiple-scattering octaves, sky light from below;
 *    rain and snow shafts under raining cloud bases.
 *  - **from space**: two shells (≈ 2 km and ≈ 9 km) whose opacity is the same cover thresholding the
 *    noise – the "2D first" layer of M1, now with the satellite correction.
 *  - **shadows** on the ground, the trees and the buildings: the same field sampled where the ray towards
 *    the Sun crosses each layer (`createCloudShadow`).
 *
 * The heights of individual cumulus and the shape of each cloud are generated: only cover, layer heights,
 * cloud tops (satellite) and precipitation come from data – said in the model card.
 */
import * as THREE from 'three/webgpu';
import {
  vec2, vec3, float, int, uniform, max, min, normalize, dot, smoothstep, length, clamp, mix, exp, sqrt,
  fract, fwidth, If, Loop, Break, select, screenCoordinate, atan, step, pow, abs, sin, log,
} from 'three/tsl';
import { ATMOSPHERE } from './atmosphere.js';
import { WGS84 } from '../geodesy.js';
import { CEILING_MAX, PRECIP_MIN, PRECIP_DECADES, SAT_BROKEN, SAT_THIN } from '../data/weatherCodes.js';
import { SATELLITE } from '../data/satellite.js';

const PI = Math.PI;
const E2 = WGS84.e2 ?? WGS84.f * (2 - WGS84.f);
const RG = ATMOSPHERE.bottomRadius; // km

/** Layer parameters: heights (m above sea level), extinction at full density (1/m), noise tile (m). */
export const CLOUD_LAYERS = Object.freeze({
  low: Object.freeze({ defaultBase: 1000, stratus: 500, cumulus: 1500, towers: 6000, sigma: 0.045, tile: 9000 }),
  middle: Object.freeze({ base: 3500, top: 5500, sigma: 0.02, tile: 16000 }),
  high: Object.freeze({ base: 8200, top: 10400, sigma: 0.0018, tile: 36000 }),
});
/** The slab the march covers (m): from below sea level (rain reaches the ground) to the highest tops. */
export const CLOUD_SLAB = Object.freeze({ bottom: -500, top: 13000 });
/** Shells for the view from space. */
export const CLOUD_SHELLS = Object.freeze([
  { id: 'low', heightM: 2000, opacity: 0.94, scaleM: 60000, sharpness: 0.22 },
  { id: 'high', heightM: 9000, opacity: 0.55, scaleM: 140000, sharpness: 0.45 },
]);
/** Camera altitudes (m) over which the volumetric clouds hand over to the shells. */
export const VOLUME_FADE = Object.freeze([35000, 60000]);
const WARP_TILE = 160000; // m – breaks up the 0.25° grid of the model
const SAT_WARP_TILE = 36000; // m – and the satellite's 0.05° pixels
const DETAIL_TILE = 1500; // m
const MARCH_ITERATIONS = 120;
const LIGHT_STEPS = [150, 400, 900, 1900]; // m towards the Sun
const MAX_MARCH_KM = 220;

/** Uniforms shared by the cloud pass and the shadows. */
export function createCloudUniforms() {
  const b = SATELLITE.box;
  return {
    mix: uniform(0), // blend between the two GFS steps
    on: uniform(0), // clouds shown and loaded
    localOn: uniform(0), // the near-ground weather (ceiling, convection, precipitation) is loaded
    satBox: uniform(new THREE.Vector4(b.south, b.north, b.west, b.east)),
    satWeight: uniform(0), // 0 = model only, 1 = satellite placement
    drift: uniform(new THREE.Vector3()), // wind drift of the noise (m, ECEF, wrapped)
    volume: uniform(1), // 1 = volumetric (camera low), 0 = shells (from space)
    stepScale: uniform(1), // longer steps on big canvases (the march costs per pixel)
    pixelAngle: uniform(0.001), // radians per texel of the cloud layer (the erosion noise fades out as texels grow)
    weatherOn: uniform(1), // the "rain, snow and fog" toggle (wet ground)
  };
}

/** A tiny placeholder volume with the sampler settings of the real noise (a texture node keeps its sampler). */
export function createNoiseTexture(data = new Uint8Array([128, 128, 128, 128]), size = 1) {
  const t = new THREE.Data3DTexture(data, size, size, size);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.wrapR = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

/** GFS texture coordinates: rows from 90° N (node-centred, 721 rows at 0.25°), columns east from 0°. */
const gfsUv = (latLon) => {
  const u = latLon.y.div(2 * PI).add(1).fract();
  const v = float(0.5).sub(latLon.x.div(PI)).mul(720 / 721).add(0.5 / 721);
  return vec2(u, v);
};

/** Geodetic latitude/longitude (radians) of a world position (m, ECEF). */
const latLonOf = (p) => vec2(atan(p.z, length(p.xy).mul(1 - E2)), atan(p.y, p.x));

const decodePrecip = (code) => select(code.lessThan(0.5), float(0), exp(code.sub(1).mul((PRECIP_DECADES * Math.LN10) / 254)).mul(PRECIP_MIN));

/** One layer of the GFS weather array texture (data/gfs.js WEATHER_LAYERS: 0, 1 cover; 2, 3 local). */
const weatherLayer = (nodes) => (uv, k) => nodes.weather.sample(uv).depth(int(k));

/**
 * The cloud field. Every function builds nodes in the calling Fn's scope.
 * @param {{ nodes: { weather, sat, noise }, cu: ReturnType<typeof createCloudUniforms> }} opts
 */
export function createCloudField({ nodes, cu }) {
  const layer = weatherLayer(nodes);
  /** The weather of a column at world position p (m): fused cover, layer heights, precipitation. */
  function column(p) {
    // warp the lookups a little so neither the model's 0.25° grid nor the satellite's pixels show: ≈ 0.15° for
    // the model, ≈ 0.04° (a few kilometres, finer noise) for the satellite
    const ll0 = latLonOf(p);
    const ll = ll0.add(nodes.noise.sample(p.add(cu.drift).div(WARP_TILE)).gb.sub(0.5).mul(0.0026));
    const uv = gfsUv(ll);
    const A = mix(layer(uv, 0), layer(uv, 1), cu.mix);
    const W = mix(layer(uv, 2), layer(uv, 3), cu.mix);
    // satellite
    const llS = ll0.add(nodes.noise.sample(p.add(cu.drift).div(SAT_WARP_TILE)).gb.sub(0.5).mul(0.0007));
    const latDeg = llS.x.mul(180 / PI);
    const lonDeg = llS.y.mul(180 / PI);
    const bx = cu.satBox;
    const su = lonDeg.sub(bx.z).div(bx.w.sub(bx.z));
    const sv = bx.y.sub(latDeg).div(bx.y.sub(bx.x));
    const inside = step(0, su).mul(step(su, 1)).mul(step(0, sv)).mul(step(sv, 1));
    const S = nodes.sat.sample(vec2(clamp(su, 0, 1), clamp(sv, 0, 1)));
    const satW = S.b.mul(inside).mul(cu.satWeight);
    const satCloud = S.r;
    const topM = S.g.mul(255).sub(1).mul(16000 / 254); // < 0: unknown
    const known = step(0, topM);
    const inLow = smoothstep(3000, 4000, topM).oneMinus();
    const inHigh = smoothstep(6500, 7500, topM);
    const inMid = inLow.oneMinus().mul(inHigh.oneMinus());
    // satellite clear thins the model's cloud to 12 %; satellite cloudy fills the layer of the observed top –
    // low cloud the model does not have becomes a broken field (a 5 km pixel flagged cloudy is often a field
    // of cumulus, not a deck)
    const thin = satCloud.oneMinus().mul(1 - SAT_THIN).oneMinus();
    const lowFill = mix(float(SAT_BROKEN), float(1), smoothstep(0.3, 0.8, A.r));
    const low = mix(A.r, max(A.r.mul(thin), satCloud.mul(inLow).mul(lowFill)), satW);
    const middle = mix(A.g, max(A.g.mul(thin), satCloud.mul(inMid)), satW);
    const high = mix(A.b, max(A.b.mul(thin), satCloud.mul(inHigh)), satW);
    // near-ground weather (placeholders until loaded: no precipitation, no ceiling, no convection)
    // precipitation only falls under cloud (the model's rain and the satellite's clear sky can disagree)
    const precip = decodePrecip(W.r.mul(255)).mul(cu.localOn).mul(smoothstep(0.1, 0.4, max(low, middle)));
    const snow = W.g;
    const ceiling = mix(float(CEILING_MAX), W.b.mul(W.b).mul(CEILING_MAX), cu.localOn);
    const conv = W.a.mul(cu.localOn);
    // heights: low cloud from the ceiling (else a cumulus base of 1 km); deep convection towers where it rains hard
    const L = CLOUD_LAYERS.low;
    const hasCeil = smoothstep(2500, 3500, ceiling).oneMinus();
    const lowBase = mix(float(L.defaultBase), clamp(ceiling, 40, 2500), hasCeil);
    const convective = smoothstep(0.03, 0.35, conv);
    const towers = smoothstep(0.3, 0.8, conv).mul(smoothstep(0.5, 4, precip));
    const satTopW = satW.mul(satCloud).mul(known);
    const lowTop = mix(lowBase.add(mix(float(L.stratus), float(L.cumulus), convective)).add(towers.mul(L.towers)), max(topM, lowBase.add(150)), satTopW.mul(inLow));
    const M = CLOUD_LAYERS.middle;
    const midTop = mix(float(M.top), clamp(topM, 3800, 7500), satTopW.mul(inMid));
    const midBase = max(midTop.sub(M.top - M.base), max(lowTop.add(200), float(3000)));
    const Hh = CLOUD_LAYERS.high;
    const highTop = mix(float(Hh.top), clamp(topM, 7000, 15000), satTopW.mul(inHigh));
    const highBase = highTop.sub(Hh.top - Hh.base);
    return { low, middle, high, precip, snow, conv: convective, lowBase, lowTop, midBase, midTop, highBase, highTop };
  }

  /**
   * Extinction (1/m) of cloud at world position p, height h (m above the ellipsoid), in column c.
   * `detail` adds the erosion noise; `rain` adds the precipitation shafts below the cloud base.
   * Returns { sigma, rain, hn } (rain extinction separately, for its own colour).
   */
  function extinction(p, h, c, { detail = true, rain = true, lod = float(0) } = {}) {
    const inLow = step(h, c.lowTop.add(50));
    const inMid = step(h, c.midTop.add(50)).mul(inLow.oneMinus());
    const L = CLOUD_LAYERS.low;
    const M = CLOUD_LAYERS.middle;
    const Hh = CLOUD_LAYERS.high;
    const base = select(inLow.greaterThan(0.5), c.lowBase, select(inMid.greaterThan(0.5), c.midBase, c.highBase));
    const top = select(inLow.greaterThan(0.5), c.lowTop, select(inMid.greaterThan(0.5), c.midTop, c.highTop));
    const cover = select(inLow.greaterThan(0.5), c.low, select(inMid.greaterThan(0.5), c.middle, c.high));
    const tile = select(inLow.greaterThan(0.5), float(L.tile), select(inMid.greaterThan(0.5), float(M.tile), float(Hh.tile)));
    const sigma0 = select(inLow.greaterThan(0.5), float(L.sigma), select(inMid.greaterThan(0.5), float(M.sigma), float(Hh.sigma)));
    const stratiform = select(inLow.greaterThan(0.5), c.conv.oneMinus(), select(inMid.greaterThan(0.5), float(0.6), float(0)));
    // thin cover, lower tops: a deck tapers towards its edge and scattered cumulus stay flat (humilis)
    const hn = h.sub(base).div(max(top.sub(base).mul(cover.mul(0.6).add(0.4)), 50));
    // below the low base, the noise is stretched vertically: rain falls in columns
    const below = step(h, c.lowBase);
    const q = p.add(cu.drift).div(tile);
    const up = normalize(p);
    const qs = mix(q, q.sub(up.mul(dot(q, up).mul(0.92))), below);
    const shape = nodes.noise.sample(qs);
    const n = shape.r;
    // the top of a deck is not a sheet: it comes down by up to half the layer with the shape noise and its
    // finer cells (the billows of a stratus or stratocumulus top – never above the column's top, where the
    // march ends); the base stays flat
    const hnTop = hn.add(n.mul(0.3)).add(shape.g.mul(0.2));
    const profile = smoothstep(0, 0.1, hn).mul(smoothstep(mix(0.55, 0.75, stratiform), 1, hnTop).oneMinus());
    // stratiform: the same coverage, but flatter inside (a deck rather than heaps)
    // full cover closes the layer: the noise floor rises towards 1 as the cover does (c⁴ – barely any change
    // below 70 %)
    const c4 = cover.mul(cover).mul(cover).mul(cover);
    const shaped = mix(mix(n, smoothstep(0.2, 0.8, n), stratiform), float(1), c4).mul(profile);
    const dens = clamp(shaped.sub(cover.oneMinus()).div(max(cover, 0.12)), 0, 1).toVar();
    if (detail) {
      If(dens.greaterThan(0).and(lod.lessThan(1)), () => {
        const d = nodes.noise.sample(p.add(cu.drift).div(DETAIL_TILE)).gba;
        const fbm = d.x.mul(0.625).add(d.y.mul(0.25)).add(d.z.mul(0.125));
        const e = fbm.mul(0.38).mul(hn.mul(0.4).oneMinus()).mul(lod.oneMinus());
        dens.assign(clamp(dens.sub(e).div(e.oneMinus()), 0, 1));
      });
    }
    let rainSigma = float(0);
    if (rain) {
      // rain ≈ 0.25/km at 1 mm/h (visibility ≈ 15 km), snow ten times that
      const rate = max(c.precip, 0);
      const beta = mix(pow(rate, 0.65).mul(0.00025), pow(rate, 0.7).mul(0.0025), c.snow);
      rainSigma = beta.mul(below).mul(smoothstep(0.3, 0.6, n)).mul(step(0.02, rate));
    }
    return { sigma: dens.mul(sigma0).mul(step(0.004, cover)), rain: rainSigma, hn, inLow, dens };
  }

  return { column, extinction, noise: nodes.noise };
}

const hg = (c, g) => float((1 - g * g) / (4 * PI)).div(pow(max(float(1 + g * g).sub(c.mul(2 * g)), 1e-4), 1.5));

/**
 * The cloud pass: returns a function for atmosphere.js that marches one view ray.
 * @returns {(origin: Node, dir: Node, tEnd: Node) => { light: Node<vec3>, transmittance: Node<float>, distance: Node<float> }}
 *   origin/dir in the atmosphere's stretched-sphere frame (km), tEnd = where the ray meets geometry (km)
 */
export function createCloudPass({ u, toSun, field, cu, nightFloor }) {
  const zScale = ATMOSPHERE.zScale;
  return (origin, dir, tEnd) => {
    const light = vec3(0).toVar();
    const trans = float(1).toVar();
    const distSum = float(0).toVar();
    const weightSum = float(0).toVar();
    const rTop = float(RG + CLOUD_SLAB.top / 1000);
    const rBottom = float(RG + CLOUD_SLAB.bottom / 1000);
    const b = dot(origin, dir);
    const camR = length(origin);
    const sphere = (R) => {
      const disc = b.mul(b).sub(dot(origin, origin)).add(R.mul(R));
      const s = sqrt(max(disc, 0));
      return { near: b.negate().sub(s), far: b.negate().add(s), hit: disc.greaterThan(0) };
    };
    const top = sphere(rTop);
    const bottom = sphere(rBottom);
    const t0 = select(camR.greaterThan(rTop), top.near, select(camR.greaterThan(rBottom), float(0), bottom.far));
    const t1raw = select(camR.lessThan(rBottom), top.far, select(bottom.hit.and(bottom.near.greaterThan(0)), bottom.near, top.far));
    const t1 = min(min(t1raw, tEnd), t0.add(MAX_MARCH_KM));
    const active = top.hit.and(top.far.greaterThan(0)).and(t1.greaterThan(t0)).and(cu.on.greaterThan(0.5)).and(cu.volume.greaterThan(0.001));
    If(active, () => {
      // a per-pixel offset of the samples inside each step hides the banding of finite steps
      const jitter = fract(sin(dot(screenCoordinate.xy, vec2(12.9898, 78.233))).mul(43758.5453));
      const cosTheta = dot(dir, u.sunDirectionScaled);
      const phase0 = mix(hg(cosTheta, 0.75), hg(cosTheta, -0.2), 0.3);
      const phase1 = mix(hg(cosTheta, 0.38), hg(cosTheta, -0.1), 0.3);
      const phase2 = hg(cosTheta, 0.19);
      const sunWorld = u.sunDirection;
      const t = t0.toVar(); // km
      Loop(MARCH_ITERATIONS, () => {
        If(t.greaterThan(t1).or(trans.lessThan(0.012)), () => {
          Break();
        });
        const pKm = origin.add(dir.mul(t));
        const h = length(pKm).sub(RG).mul(1000);
        const p = vec3(pKm.x, pKm.y, pKm.z.div(zScale)).mul(1000); // ECEF metres
        const c = field.column(p);
        const mu = dot(dir, normalize(pKm)); // the ray's climb per metre here
        const amu = max(abs(mu), 0.02);
        // fine steps: shorter near the camera, and at most 120 m of height per step (thin decks seen from above)
        const fine = clamp(min(t.mul(12), float(120).div(amu)), 40, 900).mul(cu.stepScale);
        // which height intervals of this column hold cloud – or rain, from the ground to the low base
        const occL = c.low.greaterThan(0.004);
        const occM = c.middle.greaterThan(0.004);
        const occH = c.high.greaterThan(0.004);
        const occR = c.precip.greaterThan(0.02);
        const within = (lo, hi) => h.greaterThan(lo.sub(30)).and(h.lessThan(hi.add(30)));
        const inside = occL.and(within(c.lowBase, c.lowTop)).or(occM.and(within(c.midBase, c.midTop)))
          .or(occH.and(within(c.highBase, c.highTop))).or(occR.and(h.lessThan(c.lowBase)));
        // otherwise skip to the next occupied interval in the ray's direction (at most 6 km: the column changes)
        const BIG = float(1e7);
        const baseAbove = (b0, occ) => select(occ.and(b0.greaterThan(h)), b0, BIG);
        const topBelow = (t0_, occ) => select(occ.and(t0_.lessThan(h)), t0_, BIG.negate());
        const nextBase = min(min(baseAbove(c.lowBase, occL), baseAbove(c.midBase, occM)), baseAbove(c.highBase, occH));
        const nextTop = max(max(topBelow(c.lowTop, occL), topBelow(c.midTop, occM)), max(topBelow(c.highTop, occH), topBelow(c.lowBase, occR)));
        const dist = select(mu.greaterThan(0), select(nextBase.lessThan(1e6), nextBase.sub(h).div(amu), BIG), select(nextTop.greaterThan(-1e6), h.sub(nextTop).div(amu), BIG));
        const stepM = select(inside, fine, clamp(dist, fine, 6000));
        If(inside, () => {
          const ts = t.add(fine.mul(jitter).mul(0.001));
          const q = origin.add(dir.mul(ts));
          const r = length(q);
          const hs = r.sub(RG).mul(1000);
          const ps = vec3(q.x, q.y, q.z.div(zScale)).mul(1000);
          // the erosion noise (≈ 20 m features) only aliases once a texel covers more than a few metres
          const lod = smoothstep(5, 15, ts.mul(1000).mul(cu.pixelAngle));
          const e = field.extinction(ps, hs, c, { lod });
          const sigma = e.sigma.add(e.rain);
          If(sigma.greaterThan(1e-6), () => {
            // light march towards the Sun through the cloud above this point (shape noise only)
            const muSun = dot(normalize(ps), sunWorld);
            let tau = float(0);
            let prev = 0;
            for (const sl of LIGHT_STEPS) {
              tau = tau.add(field.extinction(ps.add(sunWorld.mul(sl)), hs.add(muSun.mul(sl)), c, { detail: false, rain: false }).sigma.mul(sl - prev));
              prev = sl;
            }
            const muS = dot(normalize(q), u.sunDirectionScaled);
            const sunT = toSun(max(r, RG + 0.001), muS);
            // single scattering with Wrenninge's octaves for the first orders …
            const single = phase0.mul(exp(tau.negate())).add(phase1.mul(0.5).mul(exp(tau.mul(-0.5)))).add(phase2.mul(0.25).mul(exp(tau.mul(-0.25))));
            // … and the diffuse light of many orders inside a dense cloud body: it carries sunlight deep into
            // a deck (the top of overcast is as bright as a white surface, its base dim, a storm cloud dark)
            const diffuse = clamp(muS, 0, 1).mul(0.6).add(0.15).mul(0.8 / PI).mul(exp(tau.mul(-0.06))).mul(smoothstep(0.15, 0.6, e.dens));
            // sky light from above, darker towards the base of thick cloud
            const skyIrr = vec3(0.45, 0.6, 1.0).mul(smoothstep(-0.2, 0.25, muS).mul(0.18)).mul(clamp(muS.add(0.6), 0.25, 1));
            // (towards the base the light comes from the ground and the cloud around: grey, not sky blue)
            const skyGrey = vec3(dot(skyIrr, vec3(0.2126, 0.7152, 0.0722)));
            const ambient = mix(skyGrey.mul(0.3), skyIrr, clamp(e.hn, 0, 1)).mul(1 / PI);
            const cloudS = u.sunIlluminance.mul(sunT.mul(single.add(diffuse)).add(ambient)).add(nightFloor.mul(1 / PI));
            // rain and snow: grey, lit mostly by the sky under the cloud
            const rainS = u.sunIlluminance.mul(sunT.mul(0.25 / (4 * PI)).mul(exp(tau.mul(-0.5))).add(skyIrr.mul(0.6 / PI))).add(nightFloor.mul(1 / PI));
            const S = cloudS.mul(e.sigma).add(rainS.mul(e.rain));
            const segT = exp(sigma.negate().mul(fine));
            // energy-conserving integration over the step (Hillaire 2016)
            light.addAssign(trans.mul(S.mul(segT.oneMinus()).div(sigma)));
            const before = trans.toVar();
            trans.mulAssign(segT);
            const absorbed = before.sub(trans);
            distSum.addAssign(ts.mul(absorbed));
            weightSum.addAssign(absorbed);
          });
        });
        t.addAssign(stepM.mul(0.001));
      });
      // what is left of the light behind a nearly opaque cloud is nothing (the Sun's disc would shine through)
      trans.assign(select(trans.lessThan(0.012), float(0), trans));
    });
    const fade = cu.volume;
    return {
      light: light.mul(fade),
      transmittance: mix(float(1), trans, fade),
      distance: select(weightSum.greaterThan(1e-4), distSum.div(max(weightSum, 1e-4)), tEnd),
    };
  };
}

/**
 * The shells for the view from space (2.5D): opacity of each where the ray crosses it, lit like the M1
 * shells. Returns { light, transmittance, distance } like the pass.
 */
export function createShellPass({ u, toSun, field, cu, nightFloor }) {
  const zScale = ATMOSPHERE.zScale;
  return (origin, dir, tEnd) => {
    const b = dot(origin, dir);
    const c0 = dot(origin, origin);
    let light = vec3(0);
    let trans = float(1);
    let distance = tEnd;
    // high shell first only when it is nearer: from space both are seen from above, the high one in front
    for (const shell of [...CLOUD_SHELLS].reverse()) {
      const R = RG + shell.heightM / 1000;
      const disc = b.mul(b).sub(c0).add(R * R);
      const t = b.negate().sub(sqrt(max(disc, 0)));
      const hit = disc.greaterThan(0).and(t.greaterThan(0)).and(t.lessThan(tEnd));
      const pKm = origin.add(dir.mul(max(t, 0)));
      const p = vec3(pKm.x, pKm.y, pKm.z.div(zScale)).mul(1000);
      // derivatives of the noise coordinates, outside any branch
      const q = p.div(shell.scaleM);
      const footprint = length(fwidth(q));
      const col = field.column(p);
      const cover = shell.id === 'low' ? max(col.low, col.middle) : col.high;
      const coarse = field.noise.sample(q.mul(0.37)).r;
      const fine = field.noise.sample(q.mul(1.9)).g;
      const c4 = cover.mul(cover).mul(cover).mul(cover);
      const nn = mix(mix(coarse.mul(0.7).add(fine.mul(0.3)), coarse, smoothstep(0.08, 0.35, footprint)), float(1), c4);
      const soft = max(float(shell.sharpness), footprint.mul(0.8));
      const threshold = cover.oneMinus();
      const alpha = smoothstep(threshold.sub(soft.mul(0.4)), threshold.add(soft), nn).mul(smoothstep(0.02, 0.12, cover)).mul(shell.opacity).mul(select(hit, float(1), float(0)));
      const up = normalize(pKm);
      const muS = dot(up, u.sunDirectionScaled);
      const sunT = toSun(max(length(pKm), RG + 0.001), muS);
      const sky = vec3(0.5, 0.62, 0.85).mul(smoothstep(-0.2, 0.3, muS).mul(0.22));
      const lit = u.sunIlluminance.mul(sunT.mul(clamp(muS.mul(0.6).add(0.4), 0, 1)).add(sky)).add(nightFloor).mul(0.9 / PI);
      light = light.add(trans.mul(alpha).mul(lit));
      distance = select(alpha.greaterThan(0.05).and(trans.greaterThan(0.5)), t, distance);
      trans = trans.mul(alpha.oneMinus());
    }
    const fade = cu.volume.oneMinus().mul(cu.on);
    return { light: light.mul(fade), transmittance: mix(float(1), trans, fade), distance };
  };
}

/** How wet the ground is (0…1) after rain: the precipitation of either GFS step (an hour of memory). */
export function createWetness({ nodes, cu }) {
  return (latLon) => {
    const uv = gfsUv(latLon);
    const a = weatherLayer(nodes)(uv, 2);
    const b = weatherLayer(nodes)(uv, 3);
    const rate = decodePrecip(max(a.r, b.r).mul(255));
    const snow = mix(a.g, b.g, cu.mix);
    return smoothstep(0.03, 0.6, rate).mul(cu.localOn).mul(cu.weatherOn).mul(snow.mul(0.6).oneMinus());
  };
}

/**
 * The light of the sky and of the clouds on a surface, per unit sunlight (TSL), with the Sun at `muS`
 * (cosine of its zenith angle) and `shadow` = the fraction of the direct beam the clouds let through:
 *  - `sky`: the clear sky's light, turning grey and a little dimmer under cloud;
 *  - `diffuse`: sunlight scattered down through the cloud onto a level surface – the two-stream
 *    transmission of a water cloud, 1 / (1 + 0.75 τ (1 − g)) with g = 0.85 and τ the cloud's vertical
 *    optical depth (from `shadow`). This is what lights the ground under overcast: a 500 m stratus deck
 *    (τ ≈ 13) passes about 40 % of the sunlight as diffuse light, a thick cumulus about 15 %.
 * Multiply `diffuse` by the beam's transmittance through the air (unshadowed).
 */
export function skyLight(muS, shadow) {
  const clear = vec3(0.45, 0.6, 1.0).mul(smoothstep(-0.2, 0.25, muS).mul(0.18)).mul(clamp(muS.add(0.6), 0.25, 1));
  const sky = mix(clear, vec3(dot(clear, vec3(0.2126, 0.7152, 0.0722))).mul(0.9), shadow.oneMinus());
  const tauV = log(max(shadow, 1e-6)).negate().mul(max(muS, 0.08));
  const diffuse = shadow.oneMinus().mul(max(muS, 0)).div(tauV.mul(0.75 * 0.15).add(1));
  return { sky, diffuse };
}

/**
 * Fraction of direct sunlight the clouds let through at a ground position p (m, ECEF): the field where
 * the ray towards the Sun crosses the middle of each layer (shape noise only).
 */
export function createCloudShadow({ u, field, cu }) {
  return (latLon, p) => {
    const up = normalize(p);
    const muS = max(dot(up, u.sunDirection), 0.08);
    let tau = float(0);
    const mids = [1300, 4500, 9300];
    for (let k = 0; k < 3; k++) {
      const q = p.add(u.sunDirection.mul(float(mids[k]).div(muS)));
      const c = field.column(q);
      const base = [c.lowBase, c.midBase, c.highBase][k];
      const cover = [c.low, c.middle, c.high][k];
      // the layer as extinction() shapes it: thin cover has lower tops
      const thick = [c.lowTop, c.midTop, c.highTop][k].sub(base).mul(cover.mul(0.6).add(0.4));
      const h = base.add(thick.mul(0.45));
      const e = field.extinction(q, h, c, { detail: false, rain: false });
      tau = tau.add(e.sigma.mul(thick).mul(0.6).div(muS));
    }
    return mix(float(1), exp(tau.negate()), cu.on);
  };
}
