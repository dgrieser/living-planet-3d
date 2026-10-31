/**
 * The colour of the Earth's surface: one TSL graph shared by every terrain tile (render/globe.js).
 *
 * Per fragment it knows the ground height above the ellipsoid (the tile's height grid), the geoid N
 * (a global texture), hence the height above mean sea level H, and whether the texel is sea or land (the
 * tile's sea mask – land below sea level such as polders stays land). From that:
 *
 *  - **land**: the imagery as albedo, lit by the Sun through the atmosphere (transmittance table) plus
 *    a little sky light, with snow and night lights from the global layers;
 *  - **sea** below the water level: a water surface – the imagery (or, once the sea is lowered, a depth
 *    model: deep water over the sea floor colour) under a Fresnel reflection of the sky and the Sun's glint;
 *    sea ice on top where the daily ice map says so;
 *  - **sea floor above the water level** (the "remove the water" slider, docs/earth-sim/07 §6): sediment
 *    colours by depth and slope, or hypsometric depth colours with 1000 m contours.
 *
 * Relief is lit per pixel: the mesh carries 33 × 33 vertices per tile, the height grid 512 × 512 texels; the
 * detail in between becomes a bump normal from screen-space derivatives (Mikkelsen 2010), taken in view
 * space where the positions are small and precise.
 *
 * The water is shaded on the sea floor itself, not on a separate surface: from the heights this globe
 * shows (hundreds of metres and up) a flat sea surface and the floor below it project to the same pixel.
 * The FFT ocean of the hero areas (M5) brings a real surface.
 */
import {
  Fn, vec2, vec3, vec4, float, uniform, max, min, normalize, dot, smoothstep, length, clamp, mix, exp, pow, atan, fract, fwidth,
  abs, sign, cross, dFdx, dFdy, vertexStage, attribute, materialColor, materialReference, modelWorldMatrix, positionWorld,
  positionView, texture, If, cos, mx_fractal_noise_float,
} from 'three/tsl';
import { ATMOSPHERE, DETAIL_SCALE } from './atmosphere.js';
import { WGS84 } from '../geodesy.js';
import { HERO_FEATHER_DEG } from '../regions.js';

const PI = Math.PI;
const E2 = WGS84.e2 ?? WGS84.f * (2 - WGS84.f);
// diffuse attenuation of coastal water (Jerlov type I–II), red / green / blue, 1/m
const WATER_K = [0.35, 0.065, 0.03];
const DEEP_WATER = [0.004, 0.012, 0.03];
const GLINT_ROUGHNESS = 0.28; // GGX α of the sea surface seen from afar (Cox–Munk slopes σ ≈ 0.2 at ≈ 7 m/s wind)

/** Uniforms the panel drives. */
export function createSurfaceUniforms() {
  return {
    /** water level relative to mean sea level (m): 0 = the real sea, down to −11 000 m */
    seaLevel: uniform(0),
    /** 0 = the imagery's water colour, 1 = the depth model (blended in as the sea is lowered) */
    drain: uniform(0),
    /** 1 = hypsometric colours and contours on the sea floor */
    depthTint: uniform(0),
    /** 0 = the tile imagery (EOX), 1 = the seasonal Blue Marble month – set from the camera altitude */
    farBlend: uniform(0),
    /** 0/1 display toggles for the date-driven layers */
    snowIce: uniform(1),
    nightLights: uniform(1),
    /** vertical exaggeration of the sea floor's shading while it is shown */
    floorRelief: uniform(5),
    /** development aid: 1 = sea mask, 2 = height above sea level, 3 = relief normal, 4 = bump residual */
    debug: uniform(0),
  };
}

/** Sea level and the derived blend, from the slider value (m). */
export function setSeaLevel(s, levelM) {
  s.seaLevel.value = levelM;
  s.drain.value = Math.min(1, Math.max(0, -levelM / 5));
}

/** Geodetic latitude and longitude (radians) of a world (ECEF) position near the ellipsoid. */
export const geodeticLatLon = Fn(([p]) => {
  const rho = length(p.xy);
  return vec2(atan(p.z, rho.mul(1 - E2)), atan(p.y, p.x));
});

/** Equirectangular texture coordinates of a node-centred global grid (cols × rows, south row first). */
export function gridUv(latLon, cols, rows, lon0Deg = -180) {
  const lonDeg = latLon.y.mul(180 / PI);
  const latDeg = latLon.x.mul(180 / PI);
  const dLon = 360 / cols;
  const dLat = 180 / (rows - 1);
  return vec2(lonDeg.sub(lon0Deg).div(dLon).add(0.5).div(cols), latDeg.add(90).div(dLat).add(0.5).div(rows));
}

/**
 * Sea floor colours: the main sediment classes by depth (Seibold & Berger, *The Sea Floor*): sand and
 * gravel on the shelf, terrigenous mud on the slope and rise, pale calcareous ooze above the carbonate
 * compensation depth (≈ 4.5 km – which drapes the mid-ocean ridges), brown abyssal clay below it, and
 * bare basalt where it is steep. Or hypsometric depth colours with a line every 1000 m.
 */
const seaFloorAlbedo = Fn(([H, cosSlope, tint]) => {
  const depth = H.negate();
  // linear albedos (the imagery's sRGB is decoded to linear too: sRGB 0.5 ≈ linear 0.21)
  const sand = vec3(0.2, 0.16, 0.11);
  const mud = vec3(0.085, 0.078, 0.062);
  const ooze = vec3(0.26, 0.235, 0.19);
  const clay = vec3(0.12, 0.068, 0.042);
  const basalt = vec3(0.035, 0.032, 0.03);
  const shelfToSlope = mix(sand, mud, smoothstep(150, 500, depth));
  const toOoze = mix(shelfToSlope, ooze, smoothstep(1800, 2600, depth));
  const sediment = mix(toOoze, clay, smoothstep(4200, 4900, depth));
  const natural = mix(sediment, basalt, smoothstep(0.02, 0.1, float(1).sub(cosSlope)));
  // hypsometric: pale on the shelf, deep blue in the trenches, a line every 1000 m
  const t = pow(clamp(depth.div(8000), 0, 1), 0.6);
  const ramp = mix(mix(vec3(0.3, 0.55, 0.5), vec3(0.03, 0.14, 0.32), smoothstep(0, 0.45, t)), vec3(0.004, 0.01, 0.06), smoothstep(0.45, 1, t));
  const k = depth.div(1000);
  const f = fract(k);
  const line = smoothstep(float(0), fwidth(k).mul(1.5), min(f, f.oneMinus())).oneMinus().mul(smoothstep(50, 300, depth));
  const tinted = mix(ramp, ramp.mul(0.45), line.mul(0.8));
  return mix(natural, tinted, tint);
});

/** Bump-mapped normal (Mikkelsen 2010): base normal and height field, all in view space. */
const bumpNormal = Fn(([position, normal, height]) => {
  const sx = dFdx(position);
  const sy = dFdy(position);
  const r1 = cross(sy, normal);
  const r2 = cross(normal, sx);
  const det = dot(sx, r1);
  const grad = sign(det).mul(r1.mul(dFdx(height)).add(r2.mul(dFdy(height))));
  return normalize(abs(det).mul(normal).sub(grad));
});

/**
 * The surface radiance of a terrain fragment (linear, before the atmosphere pass).
 * @param {ReturnType<import('./atmosphere.js').createAtmosphereUniforms>} u
 * @param {Function} toSun transmittance-to-Sun TSL function from atmosphere.js
 * @param {ReturnType<typeof createSurfaceUniforms>} s
 * @param {{ nightFloor: Node, geoid: ReturnType<import('../data/geoid.js').createGeoid>,
 *           layers?: { farImagery?: Function, snow?: Function, seaIce?: Function, lights?: Function, sunShadow?: Function } }} opts
 *   layers: optional TSL functions of (latLon, position) – the seasonal far-view imagery (linear rgb),
 *   snow cover 0…1 on land, sea ice 0…1 on water, night-light radiance, and the fraction of direct
 *   sunlight that clouds let through.
 */
/**
 * Geoid undulation N (TSL) at a latitude/longitude: the global EGM2008 grid plus, inside the hero boxes,
 * the national residual blended in exactly like data/geoid.js `sample` (regions.js `heroWeight`).
 */
export function createGeoidNode(geoid) {
  const global = texture(geoid.texture);
  const heroes = geoid.heroes.map((h) => ({ h, tex: texture(h.texture) }));
  return (latLon) => {
    let N = global.sample(gridUv(latLon, 720, 361)).r;
    const latDeg = latLon.x.mul(180 / PI);
    const lonDeg = latLon.y.mul(180 / PI);
    for (const { h, tex } of heroes) {
      const uv = vec2(lonDeg.sub(h.lon0).div(h.dLon).add(0.5).div(h.cols), latDeg.sub(h.lat0).div(h.dLat).add(0.5).div(h.rows));
      const k = cos(latLon.x);
      const d = min(min(latDeg.sub(h.box.south), float(h.box.north).sub(latDeg)), min(lonDeg.sub(h.box.west), float(h.box.east).sub(lonDeg)).mul(k));
      const w = smoothstep(-HERO_FEATHER_DEG, HERO_FEATHER_DEG, d);
      N = N.add(tex.sample(uv).r.mul(w));
    }
    return N;
  };
}

export function createSurfaceColorNode(u, toSun, s, { nightFloor, geoid, layers = {} }) {
  const geoidAt = createGeoidNode(geoid);
  return Fn(() => {
    const p = positionWorld;
    const latLon = geodeticLatLon(p);
    const N = geoidAt(latLon);
    const H = materialReference('displacementMap', 'texture').r.sub(N); // metres above mean sea level
    const sea = smoothstep(0.3, 0.7, materialReference('seaMask', 'texture').r);

    // light: the Sun through the atmosphere (stretched-sphere frame of atmosphere.js) and the sky
    const pKm = p.mul(0.001).mul(vec3(1, 1, ATMOSPHERE.zScale));
    const r = max(length(pKm), ATMOSPHERE.bottomRadius + 0.001);
    const muS = dot(normalize(pKm), u.sunDirectionScaled);
    const shadow = layers.sunShadow ? layers.sunShadow(latLon, p) : float(1);
    const sunT = toSun(r, muS).mul(shadow);
    const skyIrr = vec3(0.45, 0.6, 1.0).mul(smoothstep(-0.2, 0.25, muS).mul(0.18)).mul(clamp(muS.add(0.6), 0.25, 1));
    const E = u.sunIlluminance;
    const L = u.sunDirection;

    // --- relief normal: the vertex normal, bumped by the grid's detail between the vertices --------------
    const nVertex = normalize(modelWorldMatrix.mul(vec4(attribute('terrainNormal', 'vec3'), 0)).xyz);
    const nView = normalize(u.viewRotation.mul(nVertex));
    const hVertex = vertexStage(materialReference('displacementMap', 'texture').r);
    const bump = materialReference('displacementMap', 'texture').r.sub(hVertex);
    const up = normalize(p.mul(vec3(1, 1, 1 / (1 - E2)))); // ellipsoid normal
    const nLand = bumpNormal(positionView, nView, bump);
    // The sea floor's slopes are gentle (a mid-ocean ridge rises 2–3 km over 1000 km); while it is shown
    // (drained or depth colours) its relief is shaded exaggerated, like a relief map – said in the model card.
    const nFloor = bumpNormal(positionView, normalize(u.viewRotation.mul(up)), H.mul(s.floorRelief));
    const nTerrain = normalize(u.viewToWorld.mul(mix(nLand, nFloor, sea.mul(max(s.drain, s.depthTint)))));

    // --- ground (land, and sea floor above the water level) -------------------------------------------
    const wet = sea.mul(smoothstep(s.seaLevel.sub(0.25), s.seaLevel.add(0.25), H).oneMinus());
    const exposed = sea.mul(wet.oneMinus());
    const floor = seaFloorAlbedo(H, dot(nTerrain, up), s.depthTint);
    let imagery = materialColor.rgb; // the tile's imagery (sRGB decoded to linear by the sampler)
    // Generated detail where a pixel covers less than the imagery's own pixel (walking, low flights): a
    // little fractal variation anchored to the ground, so 10 cm orthophoto pixels do not read as tiles.
    // Anchored via the camera offset (double precision on the CPU) plus the precise view-space position.
    const q = u.detailOrigin.add(u.viewToWorld.mul(positionView).div(DETAIL_SCALE));
    const nearness = smoothstep(0.35, 1.2, length(fwidth(q))).oneMinus();
    const detail = float(1).toVar();
    If(nearness.greaterThan(0.001), () => {
      detail.assign(mx_fractal_noise_float(q, 3, 2.0, 0.5).mul(0.22).mul(nearness).add(1));
    });
    imagery = imagery.mul(detail);
    if (layers.farImagery) imagery = mix(imagery, layers.farImagery(latLon, p), s.farBlend);
    let land = imagery;
    if (layers.snow) land = mix(land, vec3(0.8, 0.82, 0.86), layers.snow(latLon, p).mul(sea.oneMinus()).mul(s.snowIce));
    const groundAlbedo = mix(land, floor, max(exposed, sea.mul(s.depthTint)));
    const groundIrr = E.mul(sunT.mul(max(dot(nTerrain, L), 0)).add(skyIrr)).add(nightFloor);
    let ground = groundAlbedo.mul(1 / PI).mul(groundIrr);
    // city lights: always on, but only worth drawing where the Sun is down (a fixed exposure would let
    // them glow in daylight)
    if (layers.lights) ground = ground.add(layers.lights(latLon, p).mul(sea.oneMinus()).mul(smoothstep(-0.12, 0.04, muS).oneMinus()).mul(s.nightLights));

    // --- water ---------------------------------------------------------------------------------------------
    const depth = max(s.seaLevel.sub(H), 0);
    const through = exp(vec3(...WATER_K).mul(depth).mul(-2)); // down to the floor and back up
    const modelled = mix(vec3(...DEEP_WATER), floor.mul(0.8), through);
    let waterAlbedo = mix(imagery, modelled, s.drain);
    const V = normalize(u.cameraWorld.sub(p));
    const nDotV = max(dot(up, V), 1e-3);
    const nDotL = dot(up, L);
    const fresnel = pow(nDotV.oneMinus(), 5).mul(0.98).add(0.02);
    const Hv = normalize(V.add(L));
    const nDotH = max(dot(up, Hv), 0);
    const a2 = GLINT_ROUGHNESS * GLINT_ROUGHNESS;
    const dTerm = nDotH.mul(nDotH).mul(a2 - 1).add(1);
    const D = float(a2 / PI).div(dTerm.mul(dTerm));
    const fGlint = pow(max(dot(V, Hv), 0).oneMinus(), 5).mul(0.98).add(0.02);
    const glint = E.mul(sunT).mul(D.mul(fGlint).div(nDotV.mul(4))).mul(smoothstep(0, 0.05, nDotL));
    let ice = float(0);
    if (layers.seaIce) ice = layers.seaIce(latLon, p).mul(s.snowIce).mul(s.drain.oneMinus());
    waterAlbedo = mix(waterAlbedo, vec3(0.7, 0.74, 0.78), ice);
    const waterIrr = E.mul(sunT.mul(max(nDotL, 0)).add(skyIrr)).add(nightFloor);
    const specular = E.mul(skyIrr).mul(1 / PI).mul(fresnel).add(glint).mul(ice.oneMinus());
    const water = waterAlbedo.mul(1 / PI).mul(waterIrr).mul(fresnel.oneMinus()).add(specular);

    const out = mix(ground, water, wet.mul(s.depthTint.oneMinus())).toVar();
    If(s.debug.greaterThan(0.5), () => {
      const dbg = vec3(sea, 0, 0).toVar();
      If(s.debug.greaterThan(1.5), () => {
        dbg.assign(vec3(clamp(H.div(3000), 0, 1), clamp(H.div(-6000), 0, 1), sea));
      });
      If(s.debug.greaterThan(2.5), () => {
        dbg.assign(vec3(float(1).sub(dot(nTerrain, up)).mul(50)));
      });
      If(s.debug.greaterThan(3.5), () => {
        dbg.assign(vec3(clamp(bump.div(200), 0, 1), clamp(bump.div(-200), 0, 1), 0));
      });
      if (layers.lights) {
        If(s.debug.greaterThan(4.5), () => {
          dbg.assign(layers.lights(latLon, p).mul(1 / 0.03));
        });
      }
      out.assign(dbg.mul(0.05));
    });
    return out;
  })();
}
