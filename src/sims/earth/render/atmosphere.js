/**
 * Physically based atmosphere for the Living Earth – single scattering with a precomputed
 * transmittance table, written in TSL so it runs on the WebGPU and the WebGL 2 backend alike.
 *
 * Model (Bruneton 2017 / Hillaire 2020 parameters): Rayleigh scattering with an 8 km scale height,
 * Mie scattering and absorption with a 1.2 km scale height and a Cornette–Shanks phase function
 * (g = 0.8), ozone absorption in a tent profile around 25 km. Everything is evaluated in kilometres
 * in a frame where the WGS84 ellipsoid is stretched into a sphere of radius a (z scaled by a/b), so the
 * limb, the horizon and the terrain line up with the ellipsoid exactly.
 *
 *  - `createTransmittanceTexture()` integrates the optical depth on the CPU once (256×64, half float).
 *  - `transmittanceToSun(r, muS)` is used by the terrain material: the sunlight that reaches a point.
 *  - `createAtmospherePass()` is the post-processing node: it reads the scene colour and depth and adds
 *    the in-scattered light (the sky, aerial perspective, the limb glow from space), attenuates what
 *    lies behind, draws the solar disc and fades the stars out of a bright sky.
 *
 * Multiple scattering is approximated by an isotropic term (not the full LUT of Hillaire 2020) – the sky
 * is a little too dark right after sunset; listed in the model card.
 *
 * This is our own implementation rather than @takram/three-atmosphere: takram's packages list React and
 * React Three Fiber as peer dependencies that npm would install into this vanilla app.
 */
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, texture, vec2, vec3, vec4, float, exp, sqrt, max, min, clamp, dot, length, normalize, mix,
  smoothstep, abs, pow, Loop, If, uv, select, luminance,
} from 'three/tsl';
import { getViewPosition } from 'three/tsl';
import { WGS84 } from '../geodesy.js';

// ---------- constants (km, 1/km) -----------------------------------------------------------------------
export const ATMOSPHERE = Object.freeze({
  bottomRadius: WGS84.a / 1000,
  topRadius: WGS84.a / 1000 + 100,
  rayleighScattering: [5.802e-3, 13.558e-3, 33.1e-3],
  rayleighScaleHeight: 8,
  mieScattering: 3.996e-3,
  mieExtinction: 4.4e-3,
  mieScaleHeight: 1.2,
  mieG: 0.8,
  ozoneAbsorption: [0.65e-3, 1.881e-3, 0.085e-3],
  ozoneCenter: 25,
  ozoneHalfWidth: 15,
  sunAngularRadius: 0.004675, // rad
  zScale: WGS84.a / WGS84.b, // ellipsoid → sphere
});

const LUT_WIDTH = 256; // μ
const LUT_HEIGHT = 64; // r

// ---------- CPU: transmittance table ------------------------------------------------------------------
function densities(h) {
  const A = ATMOSPHERE;
  return [Math.exp(-h / A.rayleighScaleHeight), Math.exp(-h / A.mieScaleHeight), Math.max(0, 1 - Math.abs(h - A.ozoneCenter) / A.ozoneHalfWidth)];
}

function distanceToTop(r, mu) {
  const R = ATMOSPHERE.topRadius;
  return Math.max(0, -r * mu + Math.sqrt(Math.max(0, r * r * (mu * mu - 1) + R * R)));
}

/** Transmittance from radius r along direction cosine mu to the top of the atmosphere (CPU, RGB). */
export function transmittanceCpu(r, mu, steps = 64) {
  const A = ATMOSPHERE;
  const d = distanceToTop(r, mu);
  const dx = d / steps;
  let oR = 0;
  let oM = 0;
  let oO = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i * dx;
    const ri = Math.sqrt(t * t + 2 * r * mu * t + r * r);
    const [dR, dM, dO] = densities(ri - A.bottomRadius);
    const w = i === 0 || i === steps ? 0.5 : 1;
    oR += dR * w * dx;
    oM += dM * w * dx;
    oO += dO * w * dx;
  }
  return A.rayleighScattering.map((b, c) => Math.exp(-(b * oR + A.mieExtinction * oM + A.ozoneAbsorption[c] * oO)));
}

const H_TOP = Math.sqrt(ATMOSPHERE.topRadius ** 2 - ATMOSPHERE.bottomRadius ** 2);
const texToUnit = (u, size) => (u - 0.5 / size) / (1 - 1 / size);

/** Builds the 256×64 transmittance texture (Bruneton's (r, μ) parametrisation over non-ground rays). */
export function createTransmittanceTexture() {
  const A = ATMOSPHERE;
  const data = new Uint16Array(LUT_WIDTH * LUT_HEIGHT * 4);
  for (let j = 0; j < LUT_HEIGHT; j++) {
    const xR = texToUnit((j + 0.5) / LUT_HEIGHT, LUT_HEIGHT);
    const rho = H_TOP * xR;
    const r = Math.sqrt(rho * rho + A.bottomRadius ** 2);
    for (let i = 0; i < LUT_WIDTH; i++) {
      const xMu = texToUnit((i + 0.5) / LUT_WIDTH, LUT_WIDTH);
      const dMin = A.topRadius - r;
      const dMax = rho + H_TOP;
      const d = dMin + xMu * (dMax - dMin);
      const mu = d === 0 ? 1 : Math.max(-1, Math.min(1, (H_TOP * H_TOP - rho * rho - d * d) / (2 * r * d)));
      const T = transmittanceCpu(r, mu);
      const k = (j * LUT_WIDTH + i) * 4;
      data[k] = THREE.DataUtils.toHalfFloat(T[0]);
      data[k + 1] = THREE.DataUtils.toHalfFloat(T[1]);
      data[k + 2] = THREE.DataUtils.toHalfFloat(T[2]);
      data[k + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  const tex = new THREE.DataTexture(data, LUT_WIDTH, LUT_HEIGHT, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// ---------- shared uniforms ----------------------------------------------------------------------------
/**
 * Uniforms every atmosphere-aware shader reads. Updated once per frame by `updateAtmosphereUniforms()`.
 *  sunDirection   unit vector to the Sun, ECEF (world)
 *  cameraKm       camera position in the stretched-sphere frame, km
 *  cameraWorld    camera position, ECEF metres – for scene materials: three's `cameraPosition` node is a
 *                 render-group uniform that the post-processing quad's camera overwrites before submit
 *  exposure       scene radiance → display (applied before tone mapping)
 */
export function createAtmosphereUniforms() {
  return {
    sunDirection: uniform(new THREE.Vector3(1, 0, 0)),
    sunDirectionScaled: uniform(new THREE.Vector3(1, 0, 0)),
    cameraKm: uniform(new THREE.Vector3(0, 0, 20000)),
    cameraWorld: uniform(new THREE.Vector3(0, 0, 2e7)),
    viewRotation: uniform(new THREE.Matrix3()), // world → view (rotation only), same reason as cameraWorld
    viewToWorld: uniform(new THREE.Matrix3()),
    sunIlluminance: uniform(new THREE.Color(1, 0.985, 0.96)),
    haze: uniform(1), // 0 = no atmosphere drawn (the display toggle), 1 = on
    starBrightness: uniform(1),
  };
}

const _v = new THREE.Vector3();
/** Copy the per-frame state into the uniforms (positions in metres, ECEF). */
export function updateAtmosphereUniforms(u, { cameraPosition, sunDirection, camera = null }) {
  u.sunDirection.value.copy(sunDirection).normalize();
  u.sunDirectionScaled.value.set(sunDirection.x, sunDirection.y, sunDirection.z * ATMOSPHERE.zScale).normalize();
  _v.copy(cameraPosition).multiplyScalar(0.001);
  _v.z *= ATMOSPHERE.zScale;
  u.cameraKm.value.copy(_v);
  u.cameraWorld.value.copy(cameraPosition);
  if (camera) {
    u.viewRotation.value.setFromMatrix4(camera.matrixWorldInverse);
    u.viewToWorld.value.setFromMatrix4(camera.matrixWorld);
  }
}

// ---------- TSL building blocks ----------------------------------------------------------------------------
const A = ATMOSPHERE;
const RG = float(A.bottomRadius);
const RT = float(A.topRadius);
const HTOP = float(H_TOP);
const BETA_R = vec3(...A.rayleighScattering);
const BETA_M_S = float(A.mieScattering);
const BETA_M_E = float(A.mieExtinction);
const SIGMA_O = vec3(...A.ozoneAbsorption);
const PI = Math.PI;

/** Transmittance-table lookup for a ray from radius r with direction cosine mu (above the horizon). */
export function createTransmittanceLookup(lutTexture) {
  const lut = texture(lutTexture);
  return Fn(([r, mu]) => {
    const rho = sqrt(max(r.mul(r).sub(RG.mul(RG)), 0));
    const d = max(r.negate().mul(mu).add(sqrt(max(r.mul(r).mul(mu.mul(mu).sub(1)).add(RT.mul(RT)), 0))), 0);
    const dMin = RT.sub(r);
    const dMax = rho.add(HTOP);
    const xMu = d.sub(dMin).div(max(dMax.sub(dMin), 1e-6));
    const xR = rho.div(HTOP);
    const u = float(0.5 / LUT_WIDTH).add(clamp(xMu, 0, 1).mul(1 - 1 / LUT_WIDTH));
    const v = float(0.5 / LUT_HEIGHT).add(clamp(xR, 0, 1).mul(1 - 1 / LUT_HEIGHT));
    return lut.sample(vec2(u, v)).rgb;
  });
}

/** Sunlight transmittance at radius r for a Sun at cosine muS, with the planet's shadow softened over the disc. */
export function createTransmittanceToSun(lookup) {
  return Fn(([r, muS]) => {
    const sinH = RG.div(r);
    const cosH = sqrt(max(sinH.mul(sinH).oneMinus(), 0)).negate();
    const k = sinH.mul(A.sunAngularRadius);
    return lookup(r, muS).mul(smoothstep(k.negate(), k, muS.sub(cosH)));
  });
}

/** Distance to the near (x) and far (y) intersection of a ray with a sphere (negative = none). */
const raySphere = Fn(([origin, dir, radius]) => {
  const b = dot(origin, dir);
  const c = dot(origin, origin).sub(radius.mul(radius));
  const disc = b.mul(b).sub(c);
  const s = sqrt(max(disc, 0));
  return select(disc.lessThan(0), vec2(-1, -1), vec2(b.negate().sub(s), b.negate().add(s)));
});

const rayleighPhase = Fn(([c]) => float(3 / (16 * PI)).mul(c.mul(c).add(1)));
const miePhase = Fn(([c]) => {
  const g = float(A.mieG);
  const g2 = g.mul(g);
  const k = float(3 / (8 * PI)).mul(g2.oneMinus()).div(g2.add(2));
  return k.mul(c.mul(c).add(1)).div(pow(max(g2.add(1).sub(g.mul(c).mul(2)), 1e-4), 1.5));
});

/**
 * In-scattered radiance and transmittance along a ray segment [t0, t1] (km) – single scattering with an
 * isotropic multiple-scattering term. Builds nodes in the calling Fn's scope (it contains a Loop).
 * @returns {{ inscatter: Node<vec3>, transmittance: Node<vec3> }}
 */
function integrateSegment(toSun, steps, origin, dir, t0, t1, sunDir) {
  const inscatter = vec3(0).toVar();
  const transmittance = vec3(1).toVar();
  const dt = t1.sub(t0).div(steps);
  const cosTheta = dot(dir, sunDir);
  const phaseR = rayleighPhase(cosTheta);
  const phaseM = miePhase(cosTheta);
  Loop(steps, ({ i }) => {
    const t = t0.add(float(i).add(0.5).mul(dt));
    const p = origin.add(dir.mul(t));
    const r = max(length(p), RG);
    const h = r.sub(RG);
    const dR = exp(h.negate().div(A.rayleighScaleHeight));
    const dM = exp(h.negate().div(A.mieScaleHeight));
    const dO = max(abs(h.sub(A.ozoneCenter)).div(A.ozoneHalfWidth).oneMinus(), 0);
    const extinction = BETA_R.mul(dR).add(BETA_M_E.mul(dM)).add(SIGMA_O.mul(dO));
    const muS = dot(p, sunDir).div(r);
    const sunT = toSun(r, muS);
    const scatterR = BETA_R.mul(dR);
    const scatterM = BETA_M_S.mul(dM);
    // single scattering + a cheap isotropic multiple-scattering estimate driven by the light that
    // reaches this height when the Sun stands a little higher (keeps twilight from going black)
    const single = scatterR.mul(phaseR).add(scatterM.mul(phaseM)).mul(sunT);
    const multi = scatterR.add(scatterM).mul(0.08 / (4 * PI)).mul(toSun(r, clamp(muS.add(0.15), -1, 1)));
    const segT = exp(extinction.negate().mul(dt));
    // analytic integration over the segment (Hillaire 2015)
    const integ = single.add(multi).mul(segT.oneMinus()).div(max(extinction, vec3(1e-7)));
    inscatter.addAssign(transmittance.mul(integ));
    transmittance.mulAssign(segT);
  });
  return { inscatter, transmittance };
}

/**
 * The atmosphere post pass: scene colour + depth in, the colour with sky and aerial perspective out.
 * The pass runs on a full-screen quad, so the scene camera's matrices come in as explicit uniforms
 * (the built-in camera nodes would refer to the quad's camera).
 * @param {{ colorNode: Node, depthNode: Node, camera: THREE.PerspectiveCamera,
 *           uniforms: ReturnType<typeof createAtmosphereUniforms>, lutTexture: THREE.DataTexture,
 *           steps?: number, exposure: Node }} opts
 */
export function createAtmospherePass({ colorNode, depthNode, camera, uniforms: u, lutTexture, steps = 16, exposure }) {
  const lookup = createTransmittanceLookup(lutTexture);
  const toSun = createTransmittanceToSun(lookup);
  const zScale = vec3(1, 1, A.zScale);
  const projectionInverse = uniform(camera.projectionMatrixInverse);
  const cameraWorld = uniform(camera.matrixWorld);

  return Fn(() => {
    const screenUv = uv();
    const scene = colorNode.sample(screenUv).rgb.toVar();
    const depth = depthNode.sample(screenUv).r;
    const isSky = depth.lessThanEqual(0);
    // view ray in world space (ECEF directions), then into the stretched-sphere frame
    const viewDir = normalize(getViewPosition(screenUv, float(0.5), projectionInverse));
    const worldDir = normalize(cameraWorld.mul(vec4(viewDir, 0)).xyz);
    const scaledDir = worldDir.mul(zScale);
    const dirLen = length(scaledDir);
    const dir = scaledDir.div(dirLen);
    const origin = u.cameraKm;
    const sunDir = u.sunDirectionScaled;
    const viewDist = length(getViewPosition(screenUv, depth, projectionInverse)).mul(0.001).mul(dirLen);

    const top = raySphere(origin, dir, RT);
    const ground = raySphere(origin, dir, RG);
    const hitsGround = ground.x.greaterThan(0);
    // where the ray ends: the geometry, else the ground sphere (tiles not loaded yet), else space. Coarse
    // tiles are flat triangles whose middles sag below the ellipsoid (≈ 2 km on a zoom-1 tile); ending
    // those rays at the ellipsoid keeps the triangle grid out of the haze. Mountains stand above it and
    // keep their own, shorter distance.
    const geometryEnd = select(hitsGround, min(viewDist, ground.x), viewDist);
    const tEnd = select(isSky, select(hitsGround, ground.x, top.y), geometryEnd).toVar();
    const tStart = max(top.x, 0);
    const inside = top.y.greaterThan(0).and(tEnd.greaterThan(tStart));

    const color = scene.toVar();
    // an empty pixel that hits the planet (no tile yet): a dark ocean lit by the Sun
    If(isSky.and(hitsGround), () => {
      const p = origin.add(dir.mul(ground.x));
      const n = normalize(p);
      const muS = dot(n, sunDir);
      const albedo = vec3(0.02, 0.035, 0.06);
      color.assign(albedo.mul(1 / PI).mul(u.sunIlluminance).mul(toSun(RG.add(0.001), muS)).mul(max(muS, 0)));
    });

    const inscatter = vec3(0).toVar();
    const trans = vec3(1).toVar();
    If(inside, () => {
      const res = integrateSegment(toSun, steps, origin, dir, tStart, min(tEnd, top.y), sunDir);
      inscatter.assign(res.inscatter);
      trans.assign(res.transmittance);
    });

    // the solar disc, seen through the air it shines through
    If(isSky.and(hitsGround.not()), () => {
      const cosA = dot(dir, sunDir);
      const disc = smoothstep(Math.cos(A.sunAngularRadius * 1.05), Math.cos(A.sunAngularRadius * 0.95), cosA);
      const discRadiance = u.sunIlluminance.mul(1 / (PI * A.sunAngularRadius * A.sunAngularRadius));
      // stars fade out of a bright sky (the eye adapts to the sky, not to the stars)
      const skyLum = luminance(inscatter).mul(exposure);
      const starFade = clamp(skyLum.mul(-6).add(1), 0, 1).mul(u.starBrightness);
      color.assign(color.mul(starFade).add(discRadiance.mul(disc)));
    });

    const withAir = color.mul(trans).add(inscatter);
    return vec4(mix(color, withAir, u.haze).mul(exposure), 1);
  })();
}
