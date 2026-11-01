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
 * Relief is lit per pixel: the mesh carries 33 × 33 vertices per tile, the height grid 512 × 512 texels, and
 * each grid brings its texel normals (render/globe.js) – the lighting follows the grid, never the mesh's
 * triangles.
 *
 * (smoothstep edges always low → high: WGSL leaves reversed edges undefined, and a NaN poisons every mix.)
 *
 * The water is shaded on the sea floor itself, not on a separate surface: from the heights this globe
 * shows (hundreds of metres and up) a flat sea surface and the floor below it project to the same pixel.
 * The FFT ocean of the hero areas (M5) brings a real surface.
 */
import {
  Fn, vec2, vec3, float, uniform, max, min, normalize, dot, smoothstep, length, clamp, mix, exp, pow, atan, fract, fwidth,
  abs, sign, cross, dFdx, dFdy, materialColor, materialReference, positionWorld,
  positionView, texture, If, cos, sin, sqrt, mx_fractal_noise_float, mx_noise_float,
} from 'three/tsl';
import { ATMOSPHERE, DETAIL_SCALE } from './atmosphere.js';
import { WGS84 } from '../geodesy.js';
import { HERO_FEATHER_DEG } from '../regions.js';
import { skyLight } from './clouds.js';

const PI = Math.PI;
const E2 = WGS84.e2 ?? WGS84.f * (2 - WGS84.f);
// diffuse attenuation of coastal water (Jerlov type I–II), red / green / blue, 1/m
const WATER_K = [0.35, 0.065, 0.03];
const DEEP_WATER = [0.004, 0.012, 0.03];
const TURBID_K = [2.2, 1.5, 1.9];
const TURBID_WATER = [0.022, 0.03, 0.024];
/** Fanø's tidal basins (Grådyb, Knudedyb, Juvre Dyb) – where data/water.js sets the level. */
const TIDE_BOX = Object.freeze({ south: 55.2, north: 55.62, west: 8.1, east: 8.75 });
/** Wind-sea components: wavelength (m), direction of travel (° from north), steepness (slope amplitude), phase. */
const WAVES = Object.freeze([
  { lambda: 40, dir: 80, steep: 0.05, phase: 0 }, { lambda: 23, dir: 104, steep: 0.05, phase: 1.3 },
  { lambda: 13, dir: 63, steep: 0.05, phase: 2.1 }, { lambda: 7.5, dir: 117, steep: 0.045, phase: 4.2 },
  { lambda: 4.3, dir: 52, steep: 0.04, phase: 0.7 }, { lambda: 2.4, dir: 128, steep: 0.035, phase: 3.3 },
]);
const DEG = Math.PI / 180;
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
    /** factor on the tile imagery's colour near the ground (render/exposure.js EXPOSURE_ADAPT.imageryGain) */
    imageryGain: uniform(1),
    /** 0/1 display toggles for the date-driven layers */
    snowIce: uniform(1),
    nightLights: uniform(1),
    /** the water level around Fanø relative to mean sea level (m, DVR90) – the tide of the moment (data/water.js) */
    tideLevel: uniform(0),
    /** seconds, for the waves (frozen under reduced motion) */
    time: uniform(0),
    /** 10 m wind at the camera (m/s): the direction the waves travel (radians clockwise from north) and the speed */
    windTo: uniform(Math.PI / 2),
    windSpeed: uniform(7),
    /** vertical exaggeration of the sea floor's shading while it is shown */
    floorRelief: uniform(5),
    /** development aid: 1 = sea mask, 2 = height above sea level, 3 = relief normal, 4 = normal grid (east, north) */
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
 *           layers?: { farImagery?: Function, snow?: Function, seaIce?: Function, lights?: Function, sunShadow?: Function,
 *                      wetness?: Function } }} opts
 *   layers: optional TSL functions of (latLon, position) – the seasonal far-view imagery (linear rgb),
 *   snow cover 0…1 on land, sea ice 0…1 on water, night-light radiance, the fraction of direct
 *   sunlight that clouds let through, and how wet the ground is after rain (0…1).
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
    const sunBeam = toSun(r, muS);
    const sunT = sunBeam.mul(shadow);
    // the sky's light (grey under cloud) and the sunlight that comes down diffusely through the cloud
    const light = skyLight(muS, shadow);
    const skyIrr = light.sky;
    const cloudIrr = sunBeam.mul(light.diffuse);
    const E = u.sunIlluminance;
    const L = u.sunDirection;

    // --- relief normal: the tile's normal grid – east and north components, stored as sign · √|n| -------
    const up = normalize(p.mul(vec3(1, 1, 1 / (1 - E2)))); // ellipsoid normal
    const east = normalize(cross(vec3(0, 0, 1), up));
    const north = cross(up, east);
    const ng = materialReference('normalGrid', 'texture').rg.mul(2).sub(1);
    const nEN = ng.mul(abs(ng));
    const nLand = normalize(east.mul(nEN.x).add(north.mul(nEN.y)).add(up.mul(sqrt(max(float(1).sub(dot(nEN, nEN)), 0)))));
    // The sea floor's slopes are gentle (a mid-ocean ridge rises 2–3 km over 1000 km); while it is shown
    // (drained or depth colours) its relief is shaded exaggerated, like a relief map – said in the model card.
    const nFloor = u.viewToWorld.mul(bumpNormal(positionView, normalize(u.viewRotation.mul(up)), H.mul(s.floorRelief)));
    const nTerrain = normalize(mix(nLand, nFloor, sea.mul(max(s.drain, s.depthTint))));

    // --- ground (land, and sea floor above the water level) -------------------------------------------
    // the tide around Fanø (a smooth box over the Wadden Sea basins); elsewhere mean sea level for now
    const latDeg = latLon.x.mul(180 / PI);
    const lonDeg = latLon.y.mul(180 / PI);
    const tb = TIDE_BOX;
    const tideD = min(min(latDeg.sub(tb.south), float(tb.north).sub(latDeg)), min(lonDeg.sub(tb.west), float(tb.east).sub(lonDeg)).mul(cos(latLon.x)));
    const tideW = smoothstep(-0.05, 0.05, tideD);
    const level = s.seaLevel.add(s.tideLevel.mul(tideW));
    const wet = sea.mul(smoothstep(level.sub(0.05), level.add(0.05), H).oneMinus());
    const exposed = sea.mul(wet.oneMinus());
    const floor = seaFloorAlbedo(H, dot(nTerrain, up), s.depthTint);
    let imagery = materialColor.rgb.mul(s.imageryGain); // the tile's imagery (sRGB decoded to linear by the sampler)
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
    // wet ground after rain (Lagarde 2013, simplified): darker – the pores fill with water – and glossy
    const wetness = layers.wetness ? layers.wetness(latLon, p).mul(sea.oneMinus()) : float(0);
    let land = imagery.mul(mix(float(1), float(0.62), wetness));
    if (layers.snow) land = mix(land, vec3(0.8, 0.82, 0.86), layers.snow(latLon, p).mul(sea.oneMinus()).mul(s.snowIce));
    // uncovered sea floor: within the tidal range it is the photographed flat (darker while still wet near
    // the water line); deeper – only ever dry with the slider – the sediment colours
    const intertidal = smoothstep(-4, -2.5, H);
    const wetFlat = smoothstep(0.0, 0.6, H.sub(s.seaLevel.add(s.tideLevel.mul(tideW)))).oneMinus();
    const flatAlbedo = imagery.mul(mix(float(1), float(0.6), wetFlat));
    const uncovered = mix(floor, flatAlbedo, intertidal.mul(s.depthTint.oneMinus()));
    const groundAlbedo = mix(land, uncovered, max(exposed, sea.mul(s.depthTint)));
    const groundIrr = E.mul(sunT.mul(max(dot(nTerrain, L), 0)).add(skyIrr).add(cloudIrr)).add(nightFloor);
    let ground = groundAlbedo.mul(1 / PI).mul(groundIrr);
    if (layers.wetness) {
      // the sheen of a wet surface: a rough GGX lobe (α 0.2) with water's Fresnel, plus the sky in it
      const Vg = normalize(u.cameraWorld.sub(p));
      const Hg = normalize(Vg.add(L));
      const nh = max(dot(nTerrain, Hg), 0);
      const nv = max(dot(nTerrain, Vg), 1e-3);
      const aw = 0.2 * 0.2;
      const dg = nh.mul(nh).mul(aw - 1).add(1);
      const fw = pow(nv.oneMinus(), 5).mul(0.98).add(0.02);
      const sheen = E.mul(sunT).mul(float(aw / PI).div(dg.mul(dg)).mul(fw).div(nv.mul(4))).mul(smoothstep(0, 0.05, dot(nTerrain, L)))
        .add(E.mul(skyIrr).mul(fw).mul(1 / PI));
      ground = ground.add(sheen.mul(wetness).mul(0.7));
    }
    // city lights: always on, but only worth drawing where the Sun is down (a fixed exposure would let
    // them glow in daylight)
    if (layers.lights) ground = ground.add(layers.lights(latLon, p).mul(sea.oneMinus()).mul(smoothstep(-0.12, 0.04, muS).oneMinus()).mul(s.nightLights));

    // --- water ---------------------------------------------------------------------------------------------
    const depth = max(level.sub(H), 0);
    // the Wadden Sea is turbid: green-brown and opaque within a metre or two (Jerlov coastal 5–9)
    const kWater = mix(vec3(...WATER_K), vec3(...TURBID_K), tideW);
    const through = exp(kWater.mul(depth).mul(-2)); // down to the floor and back up
    const modelled = mix(mix(vec3(...DEEP_WATER), vec3(...TURBID_WATER), tideW), floor.mul(0.8), through);
    // the imagery's own water colour where the sea is as photographed; the depth model where the tide or
    // the slider moved the water line
    let waterAlbedo = mix(imagery, modelled, max(s.drain, tideW.mul(0.85)));
    const V = normalize(u.cameraWorld.sub(p));
    // waves: six wind-sea components (wavelengths 2.4 … 40 m) spread around the direction the wind blows to,
    // steeper in a stronger wind, damped in shallow water, faded out where a pixel is wider than the wave
    // (no shimmer from orbit)
    const qm = u.detailOrigin.mul(DETAIL_SCALE).add(u.viewToWorld.mul(positionView));
    const px = dot(qm, east);
    const py = dot(qm, north);
    // the larger of the two screen derivatives: at grazing angles a pixel is long along the view
    const footprint = max(length(dFdx(qm)), length(dFdy(qm)));
    let gx = float(0);
    let gy = float(0);
    const windSea = clamp(s.windSpeed.div(7), 0.15, 1.5);
    for (const w of WAVES) {
      const k = (2 * PI) / w.lambda;
      const angle = s.windTo.add((w.dir - 90) * DEG); // the set was laid out around east (90°)
      const dx = sin(angle);
      const dy = cos(angle);
      const omega = Math.sqrt(9.81 * k);
      const phase = px.mul(dx.mul(k)).add(py.mul(dy.mul(k))).sub(s.time.mul(omega)).add(w.phase);
      const amp = float(w.steep).mul(windSea).mul(smoothstep(0.08, 0.3, footprint.mul(k / (2 * PI))).oneMinus()).mul(clamp(depth.mul(k), 0, 1));
      gx = gx.add(amp.mul(dx).mul(cos(phase)));
      gy = gy.add(amp.mul(dy).mul(cos(phase)));
    }
    const nWater = normalize(up.sub(east.mul(gx)).sub(north.mul(gy)));
    const nDotV = max(dot(nWater, V), 1e-3);
    const nDotL = dot(nWater, L);
    const fresnel = pow(nDotV.oneMinus(), 5).mul(0.98).add(0.02);
    const Hv = normalize(V.add(L));
    const nDotH = max(dot(nWater, Hv), 0);
    // swash foam: a thin band at the water line, only where the bottom is as steep as a beach (the surf of the
    // North Sea beach – on the flats a few centimetres of water span hundreds of metres and do not foam);
    // patches of smooth noise drifting in time, their average where a pixel is wider than a patch
    const depthSlope = length(vec2(dFdx(depth), dFdy(depth))).div(max(footprint, 1e-3));
    const beach = smoothstep(0.004, 0.02, depthSlope);
    const band = smoothstep(0, 0.02, depth).mul(smoothstep(0.08, 0.3, depth).oneMinus());
    const swashNoise = mx_noise_float(vec3(px.mul(0.6), py.mul(0.6), s.time.mul(0.5))).mul(0.5).add(0.5);
    const swash = band.mul(beach).mul(mix(smoothstep(0.45, 0.7, swashNoise), float(0.3), smoothstep(0.4, 1.5, footprint)));
    // whitecaps on open water: Monahan's fraction W = 3.84e-6 U^3.41 (≈ 1 % at 10 m/s, 4 % at 15 m/s)
    const capFraction = clamp(pow(s.windSpeed, 3.41).mul(3.84e-6), 0.001, 0.2); // (never 0: equal smoothstep edges are undefined)
    // patches a few metres across that come and go (gradient noise drifting in time), not single sparkles
    const capNoise = mx_noise_float(vec3(px.mul(0.11), py.mul(0.11), s.time.mul(0.22))).mul(0.5).add(0.5);
    const caps = mix(smoothstep(capFraction.mul(-3).add(1), capFraction.mul(-1.5).add(1), capNoise), capFraction, smoothstep(1, 4, footprint))
      .mul(smoothstep(0.5, 2, depth));
    const foam = max(swash, caps);
    // Cox–Munk: the slopes of the sea surface widen the glint with the wind (σ² = 0.003 + 0.00512 U)
    const alpha = clamp(sqrt(s.windSpeed.mul(0.00512).add(0.003)).mul(GLINT_ROUGHNESS / Math.sqrt(0.003 + 0.00512 * 7)), 0.08, 0.45);
    const a2 = alpha.mul(alpha);
    const dTerm = nDotH.mul(nDotH).mul(a2.sub(1)).add(1);
    const D = a2.div(dTerm.mul(dTerm).mul(PI));
    const fGlint = pow(max(dot(V, Hv), 0).oneMinus(), 5).mul(0.98).add(0.02);
    const glint = E.mul(sunT).mul(D.mul(fGlint).div(nDotV.mul(4))).mul(smoothstep(0, 0.05, nDotL));
    let ice = float(0);
    if (layers.seaIce) ice = layers.seaIce(latLon, p).mul(s.snowIce).mul(s.drain.oneMinus());
    waterAlbedo = mix(waterAlbedo, vec3(0.7, 0.74, 0.78), max(ice, foam.mul(0.8)));
    const waterIrr = E.mul(sunT.mul(max(nDotL, 0)).add(skyIrr).add(cloudIrr)).add(nightFloor);
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
        dbg.assign(vec3(nEN.mul(5).add(0.5), 0));
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
