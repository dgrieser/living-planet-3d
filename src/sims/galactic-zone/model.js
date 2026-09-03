/**
 * Pure model for the galactic-habitable-zone simulation. No Three.js / DOM
 * imports so the module can be validated from node (scripts/check-galactic-zone.mjs).
 *
 * Units
 * - Lengths in kly (thousands of light-years) – one scene unit is 1 kly.
 * - Times in Myr, speeds in km/s, angles in radians unless the name ends in Deg.
 * - Frame: the galactic plane is y = 0, +y points to the north galactic pole.
 *   Azimuth φ is measured in the plane from +x towards +z. Seen from +y (the
 *   overview camera) that is clockwise on screen, which is the sense in which
 *   the Milky Way rotates when viewed from the north galactic pole.
 *
 * What is real and what is schematic
 * - The Sun's distance (27 kly ≈ 8.2 kpc), its orbital period (≈ 230 Myr) and
 *   speed (≈ 220 km/s), the commonly quoted habitable-zone range (13–33 kly),
 *   the exponential disc scale length (2.6 kpc) and the radial metallicity
 *   gradient (≈ −0.06 dex/kpc) are quantitative.
 * - The number of arms, their pitch angle, the bar and the point distribution
 *   are a schematic Milky Way. The rotation curve is taken as flat, the spiral
 *   pattern rotates rigidly at the Sun's angular speed (the Sun is close to the
 *   corotation radius) and the "supernova hazard" is simply the stellar density
 *   relative to the solar neighbourhood. All of this is labelled as schematic
 *   in the UI.
 * - The "life on Earth" numbers (neighbourhoodState) scale published present-day
 *   anchors (NEIGHBOURHOOD) with those same two relations – stellar density and
 *   metallicity – so they inherit the schematic caveat.
 * - The extra visual components (haze, dust lanes, globular clusters) are real
 *   Milky Way constituents placed with the same geometry: unresolved starlight
 *   follows the stars, dust lanes sit on the concave edge of the arms inside
 *   corotation and in a thin disc, the globular clusters form a spheroidal halo.
 */

// ---------- physical constants -------------------------------------------------
export const LY_PER_KPC = 3.2616; // kly per kpc
export const KM_PER_LY = 9.4607e12;
export const SECONDS_PER_YEAR = 3.15576e7;
export const SUN_AGE_MYR = 4600;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const TAU = Math.PI * 2;

// ---------- configuration ------------------------------------------------------
/**
 * Everything the picture depends on. `createConfig()` merges overrides into a
 * copy, so the zone edges (and anything else) can be adjusted per mount without
 * touching the defaults.
 */
export const DEFAULT_CONFIG = Object.freeze({
  /** Radius of the drawn stellar disc. */
  discRadiusKly: 50,
  /** Outer edge of the metal-poor overlay (fades out towards it). */
  outerOverlayKly: 56,
  /** Galactic habitable zone – commonly cited range (Lineweaver et al. 2004 give 7–9 kpc as the peak). */
  zone: Object.freeze({ innerKly: 13, outerKly: 33 }),
  /** The Sun today. */
  sun: Object.freeze({ radiusKly: 27, orbitPeriodMyr: 230 }),
  /** Slider range for the what-if radius. */
  sunRadiusRangeKly: Object.freeze({ min: 3, max: 50, step: 0.5 }),
  /** The spiral pattern rotates rigidly with this period (Sun ≈ corotation). */
  patternPeriodMyr: 230,
  /** Exponential disc: Σ(r) ∝ exp(−r/h), h = 2.6 kpc. */
  discScaleLengthKly: 2.6 * LY_PER_KPC,
  /** Thin-disc scale height (Gaussian σ) and its flaring per kly of radius. */
  discScaleHeightKly: 0.65,
  discFlarePerKly: 0.012,
  /** Radial metallicity gradient d[Fe/H]/dr ≈ −0.06 dex/kpc. */
  metallicityGradientDexPerKly: -0.06 / LY_PER_KPC,
  /** Logarithmic spiral r = r₀·exp(k·Δφ) with k = tan(pitch). */
  pitchDeg: 12.5,
  /** Arms start at the ends of the bar. */
  armStartKly: 9,
  /**
   * Spiral arms, each described by the radius at which it crosses the Sun's
   * azimuth (a convenient way to place them relative to the Sun) and a density
   * weight. `widthKly` is the Gaussian half-width across the arm.
   * Real order along the Sun's line of sight towards the anticentre:
   * Scutum–Centaurus (inside), Sagittarius–Carina, Orion spur (Sun), Perseus, Norma/Outer.
   */
  arms: Object.freeze([
    Object.freeze({ id: 'scutumCentaurus', crossKly: 16, weight: 1, widthKly: 1.7, major: true }),
    Object.freeze({ id: 'sagittarius', crossKly: 21.5, weight: 0.6, widthKly: 1.4, major: false }),
    Object.freeze({ id: 'perseus', crossKly: 32.5, weight: 1, widthKly: 1.8, major: true }),
    Object.freeze({ id: 'norma', crossKly: 44, weight: 0.55, widthKly: 1.9, major: false }),
  ]),
  /** The Orion spur (Local Arm): a short, thin arm segment that carries the Sun. */
  spur: Object.freeze({ id: 'orion', crossKly: 27, weight: 0.35, widthKly: 0.9, fromKly: 22.5, toKly: 32.5 }),
  /** Bar + bulge: exponential radius scale along the bar and the two axis ratios. */
  bulge: Object.freeze({ scaleKly: 3.2, acrossRatio: 0.42, verticalRatio: 0.6, maxKly: 11 }),
  /** Fractions of the point budget. */
  mix: Object.freeze({ bulge: 0.2, arms: 0.5, disc: 0.24, hii: 0.06 }),
  /** Azimuth of the Sun today (−90° puts it at the top of the overview). */
  sunAzimuth: -Math.PI / 2,
  /** Unresolved starlight (soft haze billboards): fractions of the haze budget; arm ridges are wider than the star lanes. */
  haze: Object.freeze({ bulge: 0.12, arms: 0.55, disc: 0.33, armWidthFactor: 1.6 }),
  /**
   * Interstellar dust: lanes on the concave (inner) edge of the arms inside corotation –
   * gas overtakes the pattern there and is compressed on the inner side – plus a thin
   * diffuse disc (dust is far thinner than the stars, σ_z ≈ 100 pc).
   */
  dust: Object.freeze({ laneFraction: 0.6, laneOffsetWidths: 0.6, laneScatterWidths: 0.5, fadeBeyondCorotationKly: 5, discFromKly: 8, discToKly: 35, scaleHeightKly: 0.3 }),
  /** Globular-cluster halo: ρ(r) ∝ (r² + a²)^(−7/4); a = 6 kly puts the median at ≈ 5 kpc like the Harris catalogue. */
  globulars: Object.freeze({ count: 150, coreKly: 6, minKly: 1, maxKly: 60 }),
});

/** Deep-merge overrides into a copy of DEFAULT_CONFIG (one level for nested objects). */
export function createConfig(overrides = {}) {
  const out = { ...DEFAULT_CONFIG };
  for (const [k, v] of Object.entries(overrides)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && !Array.isArray(out[k]) ? { ...out[k], ...v } : v;
  }
  return out;
}

// ---------- zone classification -------------------------------------------------
/** 'inner' (radiation, supernovae) | 'habitable' | 'outer' (too few heavy elements). */
export function classifyRadius(rKly, cfg = DEFAULT_CONFIG) {
  if (rKly < cfg.zone.innerKly) return 'inner';
  if (rKly > cfg.zone.outerKly) return 'outer';
  return 'habitable';
}

/** Zone width in kly. */
export function zoneWidthKly(cfg = DEFAULT_CONFIG) {
  return cfg.zone.outerKly - cfg.zone.innerKly;
}

// ---------- orbit ---------------------------------------------------------------
/** Circular speed in km/s for a radius and period. */
export function circularSpeedKmS(rKly, periodMyr) {
  return (TAU * rKly * 1000 * KM_PER_LY) / (periodMyr * 1e6 * SECONDS_PER_YEAR);
}

/** The Sun's orbital speed today (≈ 220 km/s). */
export function sunSpeedKmS(cfg = DEFAULT_CONFIG) {
  return circularSpeedKmS(cfg.sun.radiusKly, cfg.sun.orbitPeriodMyr);
}

/**
 * Orbital period at radius r for a flat rotation curve (v = const):
 * T(r) = T☉ · r / r☉. Every star further out takes proportionally longer.
 */
export function orbitalPeriodMyr(rKly, cfg = DEFAULT_CONFIG) {
  return (cfg.sun.orbitPeriodMyr * Math.max(rKly, 1e-6)) / cfg.sun.radiusKly;
}

/** Angular speed in rad/Myr. */
export function angularSpeed(rKly, cfg = DEFAULT_CONFIG) {
  return TAU / orbitalPeriodMyr(rKly, cfg);
}

/** Pattern (arm) rotation angle after t Myr – positive φ is clockwise from above. */
export function patternAngle(tMyr, cfg = DEFAULT_CONFIG) {
  return (TAU * tMyr) / cfg.patternPeriodMyr;
}

/** Azimuth of a star that started at φ₀ and orbits at radius r, after t Myr. */
export function orbitAzimuth(tMyr, rKly, phi0, cfg = DEFAULT_CONFIG) {
  return phi0 + angularSpeed(rKly, cfg) * tMyr;
}

/** Orbits completed in t Myr at radius r. */
export function orbitsCompleted(tMyr, rKly, cfg = DEFAULT_CONFIG) {
  return tMyr / orbitalPeriodMyr(rKly, cfg);
}

/** "Galactic years" since the Sun formed (≈ 20). */
export function galacticYearsSinceFormation(rKly = DEFAULT_CONFIG.sun.radiusKly, cfg = DEFAULT_CONFIG) {
  return SUN_AGE_MYR / orbitalPeriodMyr(rKly, cfg);
}

// ---------- environment (schematic) --------------------------------------------
/** Surface density of the exponential disc relative to the Sun's radius. */
export function relativeStellarDensity(rKly, cfg = DEFAULT_CONFIG) {
  return Math.exp((cfg.sun.radiusKly - rKly) / cfg.discScaleLengthKly);
}

/**
 * Supernova hazard relative to the solar neighbourhood – taken as proportional
 * to the stellar density (schematic; the true rate also follows star formation).
 */
export function relativeSupernovaRate(rKly, cfg = DEFAULT_CONFIG) {
  return relativeStellarDensity(rKly, cfg);
}

/** Heavy-element abundance relative to the Sun from the radial metallicity gradient. */
export function relativeMetallicity(rKly, cfg = DEFAULT_CONFIG) {
  return Math.pow(10, cfg.metallicityGradientDexPerKly * (rKly - cfg.sun.radiusKly));
}

// ---------- life on Earth at another radius ------------------------------------
/**
 * Present-day anchors that the "life on Earth" readouts scale with the stellar
 * density ρ(r) and the metallicity Z(r). Sources are given per value.
 */
export const NEIGHBOURHOOD = Object.freeze({
  /** Proxima Centauri; the typical spacing of a Poisson field scales as n^(−1/3). */
  nearestStarLy: 4.25,
  /** Yale Bright Star Catalogue: ≈ 9 100 stars to V = 6.5 over the whole sky. */
  nakedEyeStars: 9000,
  /** Stellar passages within 1 pc: 19.7 ± 2.2 per Myr (Bailer-Jones et al. 2018, A&A 616, A37). */
  encountersPerMyr: 19.7,
  /** Core-collapse supernovae within 8 pc – close enough to damage the ozone layer: ≈ 1.5 per Gyr (Gehrels et al. 2003, ApJ 585, 1169). */
  supernovaPerGyr: 1.5,
  /** Giant-planet occurrence P ∝ 10^(2.0·[Fe/H]) (Fischer & Valenti 2005, ApJ 622, 1102). */
  giantPlanetSlopeDex: 2.0,
  /** Crossing intervals above this are shown as "practically never" (the Sun is near corotation). */
  neverCrossingMyr: 1000,
  /** Window for quoting catastrophe odds: "a x % chance in any 100 million years". */
  oddsWindowMyr: 100,
  /** Metallicity above/below these counts as a metal-rich / metal-poor birthplace for the solar system. */
  richMetallicity: 1.1,
  poorMetallicity: 0.9,
});

/** Probability (in %) of at least one event within `windowMyr` for a Poisson process with the given mean interval. */
export function chanceWithinPercent(intervalMyr, windowMyr = NEIGHBOURHOOD.oddsWindowMyr) {
  if (!Number.isFinite(intervalMyr)) return 0;
  return 100 * (1 - Math.exp(-windowMyr / intervalMyr));
}

/** Birthplace chemistry for a solar system formed at r: 'rich' | 'same' | 'poor'. */
export function metallicityTier(rKly, cfg = DEFAULT_CONFIG) {
  const z = relativeMetallicity(rKly, cfg);
  if (z >= NEIGHBOURHOOD.richMetallicity) return 'rich';
  if (z <= NEIGHBOURHOOD.poorMetallicity) return 'poor';
  return 'same';
}

/** Typical distance to the nearest star (ly): spacing ∝ ρ^(−1/3). */
export function nearestStarLy(rKly, cfg = DEFAULT_CONFIG) {
  return NEIGHBOURHOOD.nearestStarLy * Math.pow(relativeStellarDensity(rKly, cfg), -1 / 3);
}

/** Stars visible to the naked eye – a density-limited count, ∝ ρ. */
export function nakedEyeStarCount(rKly, cfg = DEFAULT_CONFIG) {
  return NEIGHBOURHOOD.nakedEyeStars * relativeStellarDensity(rKly, cfg);
}

/** Stellar passages within 1 pc per Myr, ∝ ρ (a lower bound: the velocity dispersion also grows inward). */
export function stellarEncounterRatePerMyr(rKly, cfg = DEFAULT_CONFIG) {
  return NEIGHBOURHOOD.encountersPerMyr * relativeStellarDensity(rKly, cfg);
}

/** Mean interval between passages within 1 pc, in kyr. */
export function stellarEncounterIntervalKyr(rKly, cfg = DEFAULT_CONFIG) {
  return 1000 / stellarEncounterRatePerMyr(rKly, cfg);
}

/** Outer edge of the Oort cloud relative to today: the tidal truncation radius scales as (M☉/ρ)^(1/3). */
export function oortCloudTidalFactor(rKly, cfg = DEFAULT_CONFIG) {
  return Math.pow(relativeStellarDensity(rKly, cfg), -1 / 3);
}

/** Mean interval (Myr) between ozone-damaging supernovae within 8 pc, from the schematic hazard. */
export function ozoneSupernovaIntervalMyr(rKly, cfg = DEFAULT_CONFIG) {
  return 1000 / (NEIGHBOURHOOD.supernovaPerGyr * relativeSupernovaRate(rKly, cfg));
}

/** Giant-planet occurrence relative to today: 10^(2.0·[Fe/H]) = Z². */
export function giantPlanetFactor(rKly, cfg = DEFAULT_CONFIG) {
  return Math.pow(relativeMetallicity(rKly, cfg), NEIGHBOURHOOD.giantPlanetSlopeDex);
}

/**
 * Mean time between spiral-arm crossings: T = 2π / (m·|Ω(r) − Ω_p|) for m arms.
 * Infinity at corotation, where the Sun keeps its place in the pattern.
 */
export function armCrossingIntervalMyr(rKly, cfg = DEFAULT_CONFIG) {
  const dOmega = Math.abs(angularSpeed(rKly, cfg) - TAU / cfg.patternPeriodMyr);
  if (dOmega < 1e-9) return Infinity;
  return TAU / (cfg.arms.length * dOmega);
}

/** All "life on Earth" numbers for a Sun at radius r. */
export function neighbourhoodState(rKly, cfg = DEFAULT_CONFIG) {
  const r = clamp(rKly, cfg.sunRadiusRangeKly.min, cfg.sunRadiusRangeKly.max);
  return {
    radiusKly: r,
    zone: classifyRadius(r, cfg),
    density: relativeStellarDensity(r, cfg),
    metallicity: relativeMetallicity(r, cfg),
    nearestStarLy: nearestStarLy(r, cfg),
    nakedEyeStars: nakedEyeStarCount(r, cfg),
    encounterRatePerMyr: stellarEncounterRatePerMyr(r, cfg),
    encounterIntervalKyr: stellarEncounterIntervalKyr(r, cfg),
    oortCloudFactor: oortCloudTidalFactor(r, cfg),
    supernovaIntervalMyr: ozoneSupernovaIntervalMyr(r, cfg),
    giantPlanetFactor: giantPlanetFactor(r, cfg),
    armCrossingIntervalMyr: armCrossingIntervalMyr(r, cfg),
    /** Inside corotation the Sun overtakes the pattern, outside it lags behind. */
    overtakesPattern: angularSpeed(r, cfg) > TAU / cfg.patternPeriodMyr + 1e-12,
    supernovaChancePercent: chanceWithinPercent(ozoneSupernovaIntervalMyr(r, cfg)),
    metallicityTier: metallicityTier(r, cfg),
    isToday: Math.abs(r - cfg.sun.radiusKly) < 0.26,
    periodMyr: orbitalPeriodMyr(r, cfg),
    galacticYears: galacticYearsSinceFormation(r, cfg),
  };
}

/** Everything the readouts show for a Sun placed at radius r, at time t. */
export function sunState(rKly, tMyr, cfg = DEFAULT_CONFIG) {
  const r = clamp(rKly, cfg.sunRadiusRangeKly.min, cfg.sunRadiusRangeKly.max);
  const period = orbitalPeriodMyr(r, cfg);
  return {
    radiusKly: r,
    radiusLy: r * 1000,
    radiusKpc: r / LY_PER_KPC,
    zone: classifyRadius(r, cfg),
    periodMyr: period,
    speedKmS: circularSpeedKmS(r, period),
    orbits: tMyr / period,
    galacticYears: SUN_AGE_MYR / period,
    supernovaRate: relativeSupernovaRate(r, cfg),
    metallicity: relativeMetallicity(r, cfg),
    azimuth: orbitAzimuth(tMyr, r, cfg.sunAzimuth, cfg),
    patternAngle: patternAngle(tMyr, cfg),
    neighbourhood: neighbourhoodState(r, cfg),
  };
}

// ---------- spiral geometry -----------------------------------------------------
/** k = tan(pitch) of the logarithmic spiral. */
export function spiralK(cfg = DEFAULT_CONFIG) {
  return Math.tan((cfg.pitchDeg * Math.PI) / 180);
}

/**
 * Azimuth of an arm at radius r. Arms trail: as r grows the azimuth decreases,
 * i.e. the outer parts lag behind the (positive-φ) rotation.
 * `arm.crossKly` pins the arm to the Sun's azimuth at that radius.
 */
export function armAzimuth(rKly, arm, cfg = DEFAULT_CONFIG) {
  const k = spiralK(cfg);
  return cfg.sunAzimuth - Math.log(Math.max(rKly, 1e-6) / arm.crossKly) / k;
}

/** Radius at which the arm passes azimuth φ (the branch nearest to r₀). */
export function armRadiusAt(phi, arm, cfg = DEFAULT_CONFIG, near = arm.crossKly) {
  const k = spiralK(cfg);
  // r = cross · exp(k·(sunAzimuth − φ + 2πn)); choose n so that r is closest to `near`
  let best = Infinity;
  for (let n = -3; n <= 3; n++) {
    const r = arm.crossKly * Math.exp(k * (cfg.sunAzimuth - phi + TAU * n));
    if (Math.abs(Math.log(r / near)) < Math.abs(Math.log(best / near))) best = r;
  }
  return best;
}

/** Signed distance (kly) from a point to the arm's centre line, approximated in the plane. */
export function distanceToArm(rKly, phi, arm, cfg = DEFAULT_CONFIG) {
  const target = armAzimuth(rKly, arm, cfg);
  let d = phi - target;
  d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
  // distance across the arm ≈ r·Δφ·cos(pitch)
  return rKly * d * Math.cos((cfg.pitchDeg * Math.PI) / 180);
}

/** Angle of the bar: the mean start direction of the two major arms. */
export function barAngle(cfg = DEFAULT_CONFIG) {
  const majors = cfg.arms.filter((a) => a.major);
  const a0 = armAzimuth(cfg.armStartKly, majors[0], cfg);
  const a1 = armAzimuth(cfg.armStartKly, majors[1], cfg);
  // the two ends should be opposite; average the direction of the first with the flipped second
  let d = a1 - Math.PI - a0;
  d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a0 + d / 2;
}

/** Points along an arm's centre line (for labels and tests): [{ r, phi, x, z }]. */
export function armCentreLine(arm, cfg = DEFAULT_CONFIG, { from = cfg.armStartKly, to = cfg.discRadiusKly, steps = 64 } = {}) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const r = from + ((to - from) * i) / steps;
    const phi = armAzimuth(r, arm, cfg);
    out.push({ r, phi, x: r * Math.cos(phi), z: r * Math.sin(phi) });
  }
  return out;
}

// ---------- point cloud ----------------------------------------------------------
/** Deterministic PRNG (mulberry32) so the galaxy looks identical on every visit. */
export function createRandom(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** Standard normal via Box–Muller. */
  next.gauss = () => {
    let u = 0;
    while (u <= 1e-12) u = next();
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  };
  return next;
}

export const KIND = Object.freeze({ disc: 0, arm: 1, bulge: 2, hii: 3, spur: 4 });

/** Colour palette (linear-ish RGB 0…1) – warm old bulge, blue-white young arms, pink HII regions. */
const PALETTE = Object.freeze({
  bulgeCore: [1.0, 0.8, 0.52],
  bulgeEdge: [1.0, 0.6, 0.34],
  disc: [1.0, 0.88, 0.7],
  armHot: [0.52, 0.68, 1.0],
  armWarm: [0.82, 0.88, 1.0],
  hii: [1.0, 0.42, 0.6],
  spur: [0.66, 0.82, 1.0],
});

/** Haze tints are more saturated than the star palette: additive stacking and tone mapping wash colours out. */
const HAZE_BLUE = [0.4, 0.58, 1.0];
const HAZE_CREAM = [1.0, 0.78, 0.5];

const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * Sample a radius from the exponential disc, Σ(r) ∝ exp(−r/h): the radial pdf
 * is r·exp(−r/h), i.e. Gamma(2, h), which is the sum of two exponentials.
 */
export function sampleDiscRadius(rnd, cfg = DEFAULT_CONFIG, { min = 0, max = cfg.discRadiusKly } = {}) {
  const h = cfg.discScaleLengthKly;
  for (let i = 0; i < 64; i++) {
    const r = -h * Math.log(Math.max(rnd() * rnd(), 1e-12));
    if (r >= min && r <= max) return r;
  }
  return clamp(min + rnd() * (max - min), min, max);
}

/**
 * Build the whole galaxy as flat typed arrays for a single THREE.Points object.
 * @returns {{ positions: Float32Array, colors: Float32Array, sizes: Float32Array,
 *             phases: Float32Array, kinds: Uint8Array, radii: Float32Array, count: number }}
 */
export function generateGalaxy(cfg = DEFAULT_CONFIG, count = 50000, seed = 20250827) {
  const rnd = createRandom(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const kinds = new Uint8Array(count);
  const radii = new Float32Array(count);

  const nBulge = Math.round(count * cfg.mix.bulge);
  const nArms = Math.round(count * cfg.mix.arms);
  const nHii = Math.round(count * cfg.mix.hii);
  const nDisc = count - nBulge - nArms - nHii;

  const bar = barAngle(cfg);
  const cosB = Math.cos(bar);
  const sinB = Math.sin(bar);
  const armWeightTotal = cfg.arms.reduce((s, a) => s + a.weight, 0) + cfg.spur.weight;

  const pickArm = () => {
    let u = rnd() * armWeightTotal;
    for (const arm of cfg.arms) {
      if (u < arm.weight) return arm;
      u -= arm.weight;
    }
    return cfg.spur;
  };

  const radialFade = (r) => 0.55 + 0.45 * Math.exp(-r / 25);
  const sizeSample = () => {
    const u = rnd();
    return 0.7 + 1.9 * u * u * u;
  };

  let i = 0;
  const write = (x, y, z, rgb, size, kind, brightness = 1) => {
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    colors[i * 3] = rgb[0] * brightness;
    colors[i * 3 + 1] = rgb[1] * brightness;
    colors[i * 3 + 2] = rgb[2] * brightness;
    sizes[i] = size;
    phases[i] = rnd();
    kinds[i] = kind;
    radii[i] = Math.hypot(x, z);
    i++;
  };

  // bar + bulge: exponential radius along a random direction, then squashed into a bar
  for (let n = 0; n < nBulge; n++) {
    let rr;
    do rr = -cfg.bulge.scaleKly * Math.log(Math.max(rnd(), 1e-12));
    while (rr > cfg.bulge.maxKly);
    const u = rnd() * 2 - 1;
    const th = rnd() * TAU;
    const s = Math.sqrt(1 - u * u);
    const along = rr * s * Math.cos(th);
    const across = rr * s * Math.sin(th) * cfg.bulge.acrossRatio;
    const vert = rr * u * cfg.bulge.verticalRatio;
    const x = along * cosB - across * sinB;
    const z = along * sinB + across * cosB;
    const tCore = clamp(rr / cfg.bulge.maxKly, 0, 1);
    const col = mix3(PALETTE.bulgeCore, PALETTE.bulgeEdge, tCore);
    // dimmer than before the haze existed: additive blending of ~10 000 points would otherwise burn the core to white
    write(x, vert, z, col, sizeSample() * (0.9 + 0.5 * (1 - tCore)), KIND.bulge, 0.38 + 0.32 * (1 - tCore));
  }

  // spiral arms + the Orion spur
  for (let n = 0; n < nArms; n++) {
    const arm = pickArm();
    let r;
    if (arm === cfg.spur) {
      const u = rnd();
      // taper the spur towards both ends
      const w = 0.5 - 0.5 * Math.cos(Math.PI * u);
      r = cfg.spur.fromKly + (cfg.spur.toKly - cfg.spur.fromKly) * (0.15 + 0.7 * w + 0.15 * u);
    } else {
      r = sampleDiscRadius(rnd, cfg, { min: cfg.armStartKly * 0.85, max: cfg.discRadiusKly });
    }
    const width = arm.widthKly * (0.85 + 0.006 * r);
    const across = rnd.gauss() * width;
    const phi = armAzimuth(r, arm, cfg) + across / r;
    const sigmaZ = cfg.discScaleHeightKly * (1 + cfg.discFlarePerKly * r);
    const y = rnd.gauss() * sigmaZ;
    const core = Math.exp(-(across * across) / (2 * width * width * 0.35)); // brighter, bluer in the arm core
    const col = arm === cfg.spur ? PALETTE.spur : mix3(PALETTE.armWarm, PALETTE.armHot, 0.35 + 0.65 * core);
    write(r * Math.cos(phi), y, r * Math.sin(phi), col, sizeSample() * (0.9 + 0.4 * core), arm === cfg.spur ? KIND.spur : KIND.arm, radialFade(r) * (0.65 + 0.45 * core));
  }

  // HII regions / young clusters: a few larger pink points strung along the arm cores
  for (let n = 0; n < nHii; n++) {
    const arm = pickArm();
    const r = arm === cfg.spur ? cfg.spur.fromKly + rnd() * (cfg.spur.toKly - cfg.spur.fromKly) : sampleDiscRadius(rnd, cfg, { min: cfg.armStartKly, max: cfg.discRadiusKly * 0.9 });
    const across = rnd.gauss() * arm.widthKly * 0.45;
    const phi = armAzimuth(r, arm, cfg) + across / r;
    const y = rnd.gauss() * cfg.discScaleHeightKly * 0.6;
    write(r * Math.cos(phi), y, r * Math.sin(phi), PALETTE.hii, 2.2 + rnd() * 2.2, KIND.hii, radialFade(r) * 1.1);
  }

  // smooth disc between the arms
  for (let n = 0; n < nDisc; n++) {
    const r = sampleDiscRadius(rnd, cfg, { min: 1.5, max: cfg.discRadiusKly });
    const phi = rnd() * TAU;
    const sigmaZ = cfg.discScaleHeightKly * (1 + cfg.discFlarePerKly * r) * 1.3;
    const y = rnd.gauss() * sigmaZ;
    write(r * Math.cos(phi), y, r * Math.sin(phi), PALETTE.disc, sizeSample() * 0.85, KIND.disc, radialFade(r) * 0.62);
  }

  return { positions, colors, sizes, phases, kinds, radii, count: i };
}

/** Weighted pick among the arms (and the spur when `withSpur`). */
function armPicker(rnd, cfg, withSpur = true) {
  const arms = withSpur ? [...cfg.arms, cfg.spur] : cfg.arms;
  const total = arms.reduce((s, a) => s + a.weight, 0);
  return () => {
    let u = rnd() * total;
    for (const arm of arms) {
      if (u < arm.weight) return arm;
      u -= arm.weight;
    }
    return arms[arms.length - 1];
  };
}

/** Bar/bulge position sampler shared by the stars and the haze: exponential radius, squashed into a bar. */
function sampleBulge(rnd, cfg, cosB, sinB) {
  let rr;
  do rr = -cfg.bulge.scaleKly * Math.log(Math.max(rnd(), 1e-12));
  while (rr > cfg.bulge.maxKly);
  const u = rnd() * 2 - 1;
  const th = rnd() * TAU;
  const s = Math.sqrt(1 - u * u);
  const along = rr * s * Math.cos(th);
  const across = rr * s * Math.sin(th) * cfg.bulge.acrossRatio;
  return { x: along * cosB - across * sinB, y: rr * u * cfg.bulge.verticalRatio, z: along * sinB + across * cosB, rr };
}

/**
 * Unresolved starlight: a few thousand large, soft billboards that carry the
 * smooth glow a galaxy shows from outside – warm bulge, blue-white arm ridges and
 * a cream exponential disc. Sizes are in kly (world units).
 * @returns {{ positions: Float32Array, colors: Float32Array, sizes: Float32Array, count: number }}
 */
export function generateHaze(cfg = DEFAULT_CONFIG, count = 4000, seed = 7) {
  const rnd = createRandom(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const nBulge = Math.round(count * cfg.haze.bulge);
  const nArms = Math.round(count * cfg.haze.arms);
  const nDisc = count - nBulge - nArms;
  const bar = barAngle(cfg);
  const cosB = Math.cos(bar);
  const sinB = Math.sin(bar);
  const pickArm = armPicker(rnd, cfg, true);
  const radialFade = (r) => 0.55 + 0.45 * Math.exp(-r / 25);
  let i = 0;
  const write = (x, y, z, rgb, brightness, size) => {
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    colors[i * 3] = rgb[0] * brightness;
    colors[i * 3 + 1] = rgb[1] * brightness;
    colors[i * 3 + 2] = rgb[2] * brightness;
    sizes[i] = size;
    i++;
  };
  for (let n = 0; n < nBulge; n++) {
    const p = sampleBulge(rnd, cfg, cosB, sinB);
    const tCore = clamp(p.rr / cfg.bulge.maxKly, 0, 1);
    write(p.x, p.y * 0.9, p.z, mix3(PALETTE.bulgeCore, PALETTE.bulgeEdge, tCore), 0.12 + 0.28 * (1 - tCore), 2.5 + 3 * rnd());
  }
  for (let n = 0; n < nArms; n++) {
    const arm = pickArm();
    const r = arm === cfg.spur ? cfg.spur.fromKly + rnd() * (cfg.spur.toKly - cfg.spur.fromKly) : sampleDiscRadius(rnd, cfg, { min: cfg.armStartKly * 0.85, max: cfg.discRadiusKly * 0.95 });
    const width = arm.widthKly * (0.85 + 0.006 * r) * cfg.haze.armWidthFactor;
    const across = rnd.gauss() * width;
    const phi = armAzimuth(r, arm, cfg) + across / r;
    const y = rnd.gauss() * cfg.discScaleHeightKly * (1 + cfg.discFlarePerKly * r) * 0.8;
    const core = Math.exp(-(across * across) / (2 * width * width * 0.5));
    const col = arm === cfg.spur ? PALETTE.spur : mix3(PALETTE.armHot, HAZE_BLUE, 0.4 + 0.6 * core); // bluer than the stars: the ridge is young light
    write(r * Math.cos(phi), y, r * Math.sin(phi), col, radialFade(r) * (0.45 + 0.55 * core) * (arm === cfg.spur ? 0.7 : 1), 1.4 + 1.8 * rnd());
  }
  for (let n = 0; n < nDisc; n++) {
    const r = sampleDiscRadius(rnd, cfg, { min: 2, max: cfg.discRadiusKly });
    const phi = rnd() * TAU;
    const y = rnd.gauss() * cfg.discScaleHeightKly * (1 + cfg.discFlarePerKly * r) * 1.3;
    // large and faint: the smooth inter-arm light, fading with the exponential disc so the outskirts stay dark
    write(r * Math.cos(phi), y, r * Math.sin(phi), HAZE_CREAM, 0.4 * Math.min(1, Math.exp(-(r - 12) / 16)), 3.5 + 3 * rnd());
  }
  return { positions, colors, sizes, count: i };
}

export const DUST_KIND = Object.freeze({ lane: 0, disc: 1 });

/**
 * Interstellar dust as extinction billboards: lanes hugging the concave (inner)
 * edge of the arms inside corotation, fading out over a few kly beyond it, plus a
 * thin diffuse disc. `strengths` is the peak extinction of each billboard (0…1).
 * @returns {{ positions: Float32Array, sizes: Float32Array, strengths: Float32Array,
 *             radii: Float32Array, kinds: Uint8Array, count: number }}
 */
export function generateDust(cfg = DEFAULT_CONFIG, count = 6000, seed = 11) {
  const rnd = createRandom(seed);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const strengths = new Float32Array(count);
  const radii = new Float32Array(count);
  const kinds = new Uint8Array(count);
  const d = cfg.dust;
  const nLanes = Math.round(count * d.laneFraction);
  const nDisc = count - nLanes;
  const pickArm = armPicker(rnd, cfg, false);
  const rCorotation = cfg.sun.radiusKly;
  let i = 0;
  const write = (x, y, z, size, strength, kind) => {
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    sizes[i] = size;
    strengths[i] = strength;
    radii[i] = Math.hypot(x, z);
    kinds[i] = kind;
    i++;
  };
  for (let n = 0; n < nLanes; n++) {
    const arm = pickArm();
    let r;
    let weight;
    do {
      r = sampleDiscRadius(rnd, cfg, { min: cfg.armStartKly, max: rCorotation + d.fadeBeyondCorotationKly });
      weight = r <= rCorotation ? 1 : 1 - (r - rCorotation) / d.fadeBeyondCorotationKly;
    } while (rnd() > weight);
    const width = arm.widthKly * (0.85 + 0.006 * r);
    const across = -d.laneOffsetWidths * width + rnd.gauss() * d.laneScatterWidths * width;
    const phi = armAzimuth(r, arm, cfg) + across / r;
    const y = rnd.gauss() * d.scaleHeightKly;
    write(r * Math.cos(phi), y, r * Math.sin(phi), 0.9 + 1.3 * rnd(), (0.45 + 0.55 * rnd()) * weight, DUST_KIND.lane);
  }
  for (let n = 0; n < nDisc; n++) {
    const r = sampleDiscRadius(rnd, cfg, { min: d.discFromKly, max: d.discToKly });
    const phi = rnd() * TAU;
    const y = rnd.gauss() * d.scaleHeightKly;
    write(r * Math.cos(phi), y, r * Math.sin(phi), 2 + 2.2 * rnd(), 0.12 + 0.2 * rnd(), DUST_KIND.disc);
  }
  return { positions, sizes, strengths, radii, kinds, count: i };
}

/**
 * Globular clusters: a spheroidal halo with number density ρ(r) ∝ (r² + a²)^(−7/4),
 * sampled through a tabulated inverse CDF. They do not take part in the pattern rotation.
 * @returns {{ positions: Float32Array, sizes: Float32Array, radii: Float32Array, count: number }}
 */
export function generateGlobularClusters(cfg = DEFAULT_CONFIG, count = cfg.globulars.count, seed = 5) {
  const rnd = createRandom(seed);
  const { coreKly: a, minKly, maxKly } = cfg.globulars;
  const steps = 256;
  const cdf = new Float64Array(steps + 1);
  for (let k = 1; k <= steps; k++) {
    const r = minKly + ((maxKly - minKly) * (k - 0.5)) / steps;
    cdf[k] = cdf[k - 1] + r * r * Math.pow(r * r + a * a, -1.75);
  }
  const sampleRadius = () => {
    const u = rnd() * cdf[steps];
    let lo = 0;
    let hi = steps;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < u) lo = mid;
      else hi = mid;
    }
    const f = (u - cdf[lo]) / Math.max(cdf[hi] - cdf[lo], 1e-12);
    return minKly + ((maxKly - minKly) * (lo + f)) / steps;
  };
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const radii = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = sampleRadius();
    const u = rnd() * 2 - 1;
    const th = rnd() * TAU;
    const s = Math.sqrt(1 - u * u);
    positions[i * 3] = r * s * Math.cos(th);
    positions[i * 3 + 1] = r * u;
    positions[i * 3 + 2] = r * s * Math.sin(th);
    sizes[i] = 1.3 + 0.9 * rnd();
    radii[i] = r;
  }
  return { positions, sizes, radii, count };
}

/** Radial histogram of a point set: counts per annulus of width `binKly`, divided by annulus area. */
export function radialDensityProfile(radii, binKly = 5, maxKly = 50) {
  const bins = Math.ceil(maxKly / binKly);
  const counts = new Array(bins).fill(0);
  for (let i = 0; i < radii.length; i++) {
    const b = Math.floor(radii[i] / binKly);
    if (b >= 0 && b < bins) counts[b]++;
  }
  return counts.map((c, b) => {
    const r0 = b * binKly;
    const r1 = r0 + binKly;
    return { rMin: r0, rMax: r1, count: c, density: c / (Math.PI * (r1 * r1 - r0 * r0)) };
  });
}

/** Fraction of points whose radius falls inside [lo, hi]. */
export function fractionBetween(radii, lo, hi) {
  let n = 0;
  for (let i = 0; i < radii.length; i++) if (radii[i] >= lo && radii[i] <= hi) n++;
  return n / radii.length;
}
