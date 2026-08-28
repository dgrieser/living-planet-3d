/**
 * Pure physics for the Moon & tides simulation. No Three.js / DOM imports so the
 * module can be validated from node (scripts/check-moon-tides.mjs).
 *
 * Conventions
 * - SI units internally (m, kg, s); distances at the API boundary in units of
 *   today's mean Earth–Moon distance where noted ("distance factor" k = r / r₀).
 * - Angles in radians unless the name ends in `Deg`.
 * - Equilibrium tide: the ocean is assumed to settle instantly into the surface
 *   of constant total potential (gravity + tidal potential). No lag, no
 *   resonance, no coastlines. Both tide-raising bodies are placed in Earth's
 *   equatorial plane; Earth's annual motion is ignored (the Sun direction is
 *   fixed, so Earth's rotation period relative to the Sun is the 24 h solar day).
 * - Axis-stability models (View B) are deliberately schematic – see
 *   `tiltWithMoonDeg()` / `tiltWithoutMoonDeg()`.
 */

export const G = 6.674e-11; // m³ kg⁻¹ s⁻²

export const EARTH = Object.freeze({
  mass: 5.972e24, // kg
  radius: 6.371e6, // m (mean)
  diameterKm: 12742,
  solarDayH: 24,
  siderealDayH: 23.9345,
  tiltDeg: 23.44,
  tiltMinDeg: 22.1, // Milankovitch obliquity cycle
  tiltMaxDeg: 24.5,
  obliquityPeriodYr: 41000,
  precessionPeriodYr: 25772,
  yearDays: 365.25,
});

export const MOON = Object.freeze({
  mass: 7.342e22, // kg
  radius: 1.7374e6, // m
  diameterKm: 3474,
  distance: 3.844e8, // m – mean Earth–Moon distance (384,400 km)
  distanceKm: 384400,
  siderealMonthDays: 27.3217,
});

export const SUN = Object.freeze({
  mass: 1.989e30, // kg
  distance: 1.496e11, // m (1 AU)
});

export const DISTANCE_RANGE = Object.freeze({ min: 0.5, max: 2 }); // × today's distance
export const EXAGGERATION_RANGE = Object.freeze({ min: 1e5, max: 1e7, default: 1e6 });
export const TIDE_SPEED_RANGE_H_PER_S = Object.freeze({ min: 0.25, max: 48, default: 3 }); // simulated hours per real second
export const AXIS_SPEED_RANGE_KYR_PER_S = Object.freeze({ min: 0.5, max: 20, default: 4 }); // simulated millennia per real second

/** Surface gravity g = G·M/R². */
export const surfaceGravity = (mass = EARTH.mass, radius = EARTH.radius) => (G * mass) / (radius * radius);

/**
 * Tidal acceleration at Earth's surface along the line to the body:
 * a = 2·G·M·R / r³ (difference between the body's pull at the surface and at
 * Earth's centre, first order in R/r).
 */
export function tidalAcceleration(bodyMass, distance, radius = EARTH.radius) {
  return (2 * G * bodyMass * radius) / (distance * distance * distance);
}

/**
 * Peak height of the equilibrium bulge (sub-body and antipodal point) relative
 * to the undisturbed sphere:
 *   h₀ = a · R / (2 g) = (M / M_E) · (R / r)³ · R
 * The full surface is h(θ) = h₀ · P₂(cos θ) with P₂(c) = (3c² − 1)/2, so the
 * trough (θ = 90°) sits at −h₀/2 and the bulge-to-trough range is 1.5·h₀.
 */
export function bulgeHeight(bodyMass, distance, radius = EARTH.radius, earthMass = EARTH.mass) {
  return (tidalAcceleration(bodyMass, distance, radius) * radius) / (2 * surfaceGravity(earthMass, radius));
}

/** Second Legendre polynomial – the angular shape of a tidal bulge. */
export const legendreP2 = (c) => (3 * c * c - 1) / 2;

/** Moon distance in metres for a distance factor k (k = 1 → today). */
export const moonDistance = (k) => MOON.distance * k;

/** Lunar tidal quantities for a distance factor k. */
export function lunarTide(k = 1) {
  const r = moonDistance(k);
  return {
    distance: r,
    acceleration: tidalAcceleration(MOON.mass, r),
    height: bulgeHeight(MOON.mass, r),
    range: 1.5 * bulgeHeight(MOON.mass, r),
    relativeToToday: 1 / (k * k * k),
  };
}

/** Solar tidal quantities (fixed distance). */
export function solarTide() {
  return {
    distance: SUN.distance,
    acceleration: tidalAcceleration(SUN.mass, SUN.distance),
    height: bulgeHeight(SUN.mass, SUN.distance),
    range: 1.5 * bulgeHeight(SUN.mass, SUN.distance),
  };
}

/** Solar / lunar tidal strength today (≈ 0.46). */
export const SOLAR_TO_LUNAR_RATIO = solarTide().acceleration / lunarTide(1).acceleration;

/**
 * Sea-surface height at a point of the (equatorial) ocean.
 * @param {number} pointAngle   longitude of the point in the inertial frame (rad)
 * @param {Array<{ angle: number, height: number }>} bodies  direction + peak bulge height of each tide raiser
 */
export function seaLevel(pointAngle, bodies) {
  let h = 0;
  for (const b of bodies) h += b.height * legendreP2(Math.cos(pointAngle - b.angle));
  return h;
}

/**
 * Bulge-to-trough tidal range along the equator for two tide raisers separated
 * by `elongation` (angle Moon–Earth–Sun). Closed form of max − min of
 * hₘ·P₂(cos(λ − αₘ)) + hₛ·P₂(cos(λ − αₛ)) over λ:
 *   range = 1.5 · √(hₘ² + hₛ² + 2 hₘ hₛ cos 2ε)
 * Spring tide (ε = 0°, 180°): 1.5 (hₘ + hₛ); neap tide (ε = ±90°): 1.5 |hₘ − hₛ|.
 */
export function tidalRange(moonHeight, sunHeight, elongation) {
  return 1.5 * Math.sqrt(moonHeight * moonHeight + sunHeight * sunHeight + 2 * moonHeight * sunHeight * Math.cos(2 * elongation));
}

/**
 * Classify the Sun–Moon configuration. `strength` runs from 0 (perfect neap)
 * to 1 (perfect spring): strength = cos²(ε).
 */
export function springNeap(elongation) {
  const c = Math.cos(elongation);
  const strength = c * c;
  const kind = strength > 0.75 ? 'spring' : strength < 0.25 ? 'neap' : 'between';
  return { strength, kind };
}

/** Lunar phase name for an elongation (Moon − Sun angle, counter-clockwise from new moon). */
export function moonPhase(elongation) {
  const e = ((elongation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const eighth = Math.round(e / (Math.PI / 4)) % 8;
  return ['new', 'waxingCrescent', 'firstQuarter', 'waxingGibbous', 'full', 'waningGibbous', 'lastQuarter', 'waningCrescent'][eighth];
}

// ---------------------------------------------------------------------------------------------
// orbital periods
// ---------------------------------------------------------------------------------------------

/** Sidereal month for a distance factor k (Kepler III: P ∝ r^{3/2}). Days. */
export const siderealMonthDays = (k) => MOON.siderealMonthDays * Math.pow(k, 1.5);

/** Synodic month (new moon to new moon): 1/P_syn = 1/P_sid − 1/P_year. Days. */
export function synodicMonthDays(k) {
  const sid = siderealMonthDays(k);
  return 1 / (1 / sid - 1 / EARTH.yearDays);
}

/** Lunar day (successive upper culminations of the Moon, i.e. one full tide cycle of two highs). Hours. */
export function lunarDayHours(k) {
  const syn = synodicMonthDays(k);
  return EARTH.solarDayH * (syn / (syn - 1));
}

/**
 * Geometry of the tide view at simulated time t (hours).
 * Frame: Sun direction fixed at angle 0. Earth spins once per solar day; the
 * Moon moves once around per synodic month, starting at `elongation0`.
 */
export function tideGeometry(tHours, k, elongation0 = 0) {
  const earthAngle = (2 * Math.PI * tHours) / EARTH.solarDayH;
  const moonAngle = elongation0 + (2 * Math.PI * tHours) / (synodicMonthDays(k) * 24);
  return { earthAngle, moonAngle, sunAngle: 0 };
}

/**
 * Sea level (m) at a marker fixed on the rotating Earth (marker longitude λ₀ in
 * the Earth frame) at time t.
 */
export function markerSeaLevel(tHours, k, elongation0, markerLongitude, { moon = true, sun = false } = {}) {
  const g = tideGeometry(tHours, k, elongation0);
  const bodies = [];
  if (moon) bodies.push({ angle: g.moonAngle, height: lunarTide(k).height });
  if (sun) bodies.push({ angle: g.sunAngle, height: solarTide().height });
  return seaLevel(g.earthAngle + markerLongitude, bodies);
}

// ---------------------------------------------------------------------------------------------
// axis stability (View B) – schematic models
// ---------------------------------------------------------------------------------------------

/**
 * With the Moon: obliquity oscillates gently between 22.1° and 24.5° with a
 * 41,000-year period (the Milankovitch obliquity cycle). t in years.
 */
export function tiltWithMoonDeg(tYears) {
  const mid = (EARTH.tiltMinDeg + EARTH.tiltMaxDeg) / 2;
  const amp = (EARTH.tiltMaxDeg - EARTH.tiltMinDeg) / 2;
  return mid + amp * Math.sin((2 * Math.PI * tYears) / EARTH.obliquityPeriodYr);
}

/** Precession period of the axis with / without the Moon (yr). Without the Moon the solar torque alone remains (≈ ⅓ of today's rate). */
export const PRECESSION_PERIOD_YR = Object.freeze({ withMoon: EARTH.precessionPeriodYr, withoutMoon: Math.round(EARTH.precessionPeriodYr * 3) });

export const CHAOS_TILT_RANGE_DEG = Object.freeze({ min: 0, max: 60 });
/** Time scale of the schematic wobble (yr) – far faster than the real Myr-scale chaos, chosen so the wandering is visible within seconds. */
export const CHAOS_TIME_SCALE_YR = 60000;

/**
 * Without the Moon: SCHEMATIC chaotic wander of the tilt between ~0° and ~60°.
 * A sum of incommensurate sinusoids produces a non-repeating, smooth drift
 * (the real evolution – Laskar et al. 1993 – unfolds over millions of years
 * and depends on the spin rate, resonances with planetary perturbations and
 * initial conditions; this is a visual stand-in, not a prediction).
 * `tYears` counts from the moment the Moon was removed.
 */
export function tiltWithoutMoonDeg(tYears) {
  const u = tYears / CHAOS_TIME_SCALE_YR;
  const s = 0.5 * Math.sin(0.9 * u) + 0.3 * Math.sin(1.9 * u + 1.3) + 0.15 * Math.sin(3.7 * u + 2.1) + 0.05 * Math.sin(6.1 * u + 0.4);
  // s ∈ (−1, 1)  →  map onto 0° … 60° with the centre at 30°
  const { min, max } = CHAOS_TILT_RANGE_DEG;
  return (min + max) / 2 + ((max - min) / 2) * s;
}

/**
 * Blend from the current (stable) tilt into the chaotic model over the first
 * `blendYears` so the removal does not jump. Returns degrees.
 */
export function tiltAfterRemovalDeg(tYearsSinceRemoval, tiltAtRemovalDeg, blendYears = 30000) {
  const target = tiltWithoutMoonDeg(tYearsSinceRemoval);
  if (tYearsSinceRemoval >= blendYears) return target;
  const x = tYearsSinceRemoval / blendYears;
  const w = x * x * (3 - 2 * x); // smoothstep
  return tiltAtRemovalDeg * (1 - w) + target * w;
}

// ---------------------------------------------------------------------------------------------
// reference data
// ---------------------------------------------------------------------------------------------

/**
 * Largest moon of each host, diameter ratio moon / planet. Sources: NASA planetary fact sheets.
 */
export const MOON_COMPARISON = Object.freeze([
  { id: 'earthMoon', planet: 'earth', moon: 'moon', moonKm: 3474, planetKm: 12742 },
  { id: 'marsPhobos', planet: 'mars', moon: 'phobos', moonKm: 22.5, planetKm: 6779 },
  { id: 'jupiterGanymede', planet: 'jupiter', moon: 'ganymede', moonKm: 5268, planetKm: 139820 },
  { id: 'saturnTitan', planet: 'saturn', moon: 'titan', moonKm: 5150, planetKm: 116460 },
  { id: 'neptuneTriton', planet: 'neptune', moon: 'triton', moonKm: 2707, planetKm: 49244 },
].map((row) => Object.freeze({ ...row, ratio: row.moonKm / row.planetKm })));

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
