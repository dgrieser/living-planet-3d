/**
 * Climate & habitability estimates for the axial-tilt simulation, built on the
 * seasons energy-balance physics (../seasons/physics.js). Pure module – no
 * Three.js / DOM – so scripts/check-axial-tilt.mjs can validate it from node.
 *
 * "Summer"/"winter" are the seasonal *means* of the energy-balance model at
 * the two solstices – the annual extremes on a circular orbit. A teaching
 * aid, not a climate model.
 */
import { declinationDeg, annualMeanInsolation, temperatureEstimate, EARTH_ROTATION_H } from '../seasons/physics.js';

const DEG = Math.PI / 180;

/** Seasonal-mean bounds within which a latitude band counts as livable. */
export const LIVABLE = Object.freeze({
  minWinterC: -25, // coldest seasonal mean a band may reach
  maxSummerC: 45, // hottest seasonal mean a band may reach
  minSummerC: 0, // summer must at least thaw
});

/**
 * Verdict tiers by tilt. The thresholds are pedagogical labels for the model
 * output (see scripts/check-axial-tilt.mjs for the numbers behind them);
 * the displayed temperatures and fractions always come from the physics.
 */
export const VERDICT_TIERS = Object.freeze([
  { id: 'uniform', maxTiltDeg: 10 }, // barely any seasons, permanently frozen poles
  { id: 'moderate', maxTiltDeg: 35 }, // Earth-like sweet spot
  { id: 'severe', maxTiltDeg: 55 },
  { id: 'extreme', maxTiltDeg: 90 }, // Uranus-like
]);

export function verdictFor(tiltDeg) {
  return (VERDICT_TIERS.find((tier) => tiltDeg <= tier.maxTiltDeg) ?? VERDICT_TIERS[VERDICT_TIERS.length - 1]).id;
}

/** Warmest / coldest seasonal mean (°C) a latitude sees over the year (solstice extremes). */
export function seasonalExtremes(latitudeDeg, tiltDeg, annualInsolation = annualMeanInsolation(latitudeDeg, tiltDeg)) {
  // For φ ≥ 0 the June solstice (orbit angle 0°) is the warm one, for φ < 0 the December solstice (180°).
  const toward = declinationDeg(tiltDeg, latitudeDeg >= 0 ? 0 : 180);
  const away = declinationDeg(tiltDeg, latitudeDeg >= 0 ? 180 : 0);
  const summerC = temperatureEstimate(latitudeDeg, tiltDeg, toward, EARTH_ROTATION_H, annualInsolation).meanC;
  const winterC = temperatureEstimate(latitudeDeg, tiltDeg, away, EARTH_ROTATION_H, annualInsolation).meanC;
  return { summerC, winterC, swingK: summerC - winterC };
}

export function isLivable({ summerC, winterC }) {
  return winterC > LIVABLE.minWinterC && summerC < LIVABLE.maxSummerC && summerC > LIVABLE.minSummerC;
}

/** Area-weighted fraction of the surface whose seasonal means stay livable all year. */
export function habitableFraction(tiltDeg, stepDeg = 2) {
  let livable = 0;
  let total = 0;
  for (let lat = -90 + stepDeg / 2; lat < 90; lat += stepDeg) {
    const weight = Math.cos(lat * DEG);
    total += weight;
    if (isLivable(seasonalExtremes(lat, tiltDeg))) livable += weight;
  }
  return livable / total;
}

/**
 * Livable latitude bands [fromDeg, toDeg] for a tilt: the contiguous ranges
 * whose seasonal means stay within LIVABLE. Edges are refined by bisection so
 * the borders move smoothly while the tilt slider is dragged.
 */
export function livableBands(tiltDeg, stepDeg = 2) {
  const livAt = (lat) => isLivable(seasonalExtremes(lat, tiltDeg, annualMeanInsolation(lat, tiltDeg, 90)));
  const edge = (lo, hi, loLivable) => {
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (livAt(mid) === loLivable) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const bands = [];
  let start = null;
  let prev = livAt(-90 + 1e-4);
  if (prev) start = -90;
  for (let lat = -90 + stepDeg; lat <= 90 + 1e-9; lat += stepDeg) {
    const clamped = Math.min(lat, 90 - 1e-4);
    const cur = livAt(clamped);
    if (cur !== prev) {
      const boundary = edge(lat - stepDeg, Math.min(lat, 90), prev);
      if (cur) start = boundary;
      else {
        bands.push([start, boundary]);
        start = null;
      }
      prev = cur;
    }
  }
  if (start !== null) bands.push([start, 90]);
  return bands;
}

/** Area fraction of the sphere covered by latitude bands (exact: ∫cos φ dφ = Δsin φ). */
export function bandsFraction(bands) {
  return bands.reduce((sum, [lo, hi]) => sum + (Math.sin(hi * DEG) - Math.sin(lo * DEG)) / 2, 0);
}

// --- temperature colour ramp (matches .lp-heat-legend__bar in style.css) ---------
export const TEMP_COLOR_RANGE_C = Object.freeze({ min: -40, max: 60 });

const RAMP = Object.freeze([
  { t: 0.0, rgb: [26, 42, 122] }, // #1a2a7a deep frozen
  { t: 0.25, rgb: [42, 117, 214] }, // #2a75d6 cold
  { t: 0.5, rgb: [92, 203, 103] }, // #5ccb67 temperate
  { t: 0.75, rgb: [247, 197, 58] }, // #f7c53a hot
  { t: 1.0, rgb: [230, 52, 26] }, // #e6341a scorching
]);

/** Maps a seasonal-mean temperature (°C) to an [r, g, b] colour (0–255). */
export function temperatureColor(tempC) {
  const { min, max } = TEMP_COLOR_RANGE_C;
  const t = Math.min(1, Math.max(0, (tempC - min) / (max - min)));
  let i = 0;
  while (i < RAMP.length - 2 && t > RAMP[i + 1].t) i++;
  const a = RAMP[i];
  const b = RAMP[i + 1];
  const f = (t - a.t) / (b.t - a.t);
  return a.rgb.map((v, k) => Math.round(v + (b.rgb[k] - v) * f));
}
