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
    write(x, vert, z, col, sizeSample() * (0.9 + 0.5 * (1 - tCore)), KIND.bulge, 0.55 + 0.45 * (1 - tCore));
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
