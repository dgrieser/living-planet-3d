/**
 * Pure physics for the seasons simulation. No Three.js / DOM imports so the
 * module can be validated from node (scripts/check-seasons.mjs).
 *
 * Conventions
 * - Angles in degrees at the API boundary, radians internally.
 * - Orbit angle θ: 0° = June solstice (north pole tilted towards the Sun),
 *   increasing counter-clockwise seen from ecliptic north; 90° = September
 *   equinox, 180° = December solstice, 270° = March equinox.
 * - Day of year: 0-based (0 = 1 January) in a 365.25-day year. Dates are
 *   interpolated piecewise-linearly between the real equinox/solstice dates
 *   (the orbit itself is treated as circular).
 * - Latitude φ: −90° … 90°, north positive.
 */

export const SOLAR_CONSTANT_W_M2 = 1361;
export const DAYS_PER_YEAR = 365.25;
export const EARTH_TILT_DEG = 23.4;
export const EARTH_ROTATION_H = 24;
export const TILT_RANGE_DEG = Object.freeze({ min: 0, max: 90 });
export const ROTATION_RANGE_H = Object.freeze({ min: 6, max: 300 });

/** Quick-select latitudes for the readout (northern hemisphere). The polar circle follows the tilt (90° − ε). */
export const LATITUDE_PRESETS = Object.freeze([
  { id: 'equator', latitudeDeg: 0 },
  { id: 'midLatitude', latitudeDeg: 45 },
  { id: 'polarCircle', latitudeDeg: 90 - EARTH_TILT_DEG },
  { id: 'pole', latitudeDeg: 90 },
]);

/** What-if presets. Missing fields keep the current value. */
export const WHAT_IF_PRESETS = Object.freeze([
  { id: 'noTilt', tiltDeg: 0 },
  { id: 'earth', tiltDeg: EARTH_TILT_DEG, periodH: EARTH_ROTATION_H },
  { id: 'uranus', tiltDeg: 90 },
  { id: 'slowRotation', periodH: 300 },
  { id: 'fastRotation', periodH: 6 },
]);

/**
 * Season stops: orbit angle and the 0-based day of year of the real event
 * (non-leap calendar, event placed at noon). Seasons are named for the
 * northern hemisphere.
 */
export const SEASON_STOPS = Object.freeze([
  { id: 'march', season: 'spring', angleDeg: 270, dayOfYear: 78.5 }, // 20 March
  { id: 'june', season: 'summer', angleDeg: 0, dayOfYear: 171.5 }, // 21 June
  { id: 'september', season: 'autumn', angleDeg: 90, dayOfYear: 264.5 }, // 22 September
  { id: 'december', season: 'winter', angleDeg: 180, dayOfYear: 354.5 }, // 21 December
]);

/** Energy-balance constants (North 1975 style) used for the temperature estimate. */
export const EBM = Object.freeze({
  A: 203.3, // W/m² – outgoing long-wave radiation at 0 °C
  B: 2.09, // W/m²/K – long-wave sensitivity
  C: 3.8, // W/m²/K – meridional heat transport towards the global mean
  albedo: 0.31,
  albedoIce: 0.62,
  iceOnsetC: 0, // ice-free annual-mean temperature below which ice starts to form
  iceFullC: -5, // … and below which the surface is fully ice covered
  seasonalDamping: 0.6, // fraction of the instantaneous seasonal response that shows up (heat storage)
  diurnalRefK: 14, // day–night swing (K) at the equator, equinox, 24 h rotation
});

/** Global-mean temperature (°C) of the model: solves the global balance S₀/4 · (1 − α) = A + B·T. */
export const GLOBAL_MEAN_C = ((SOLAR_CONSTANT_W_M2 / 4) * (1 - EBM.albedo) - EBM.A) / EBM.B;

const DEG = Math.PI / 180;
const EPS = 1e-9;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const normalizeDeg = (a) => ((a % 360) + 360) % 360;
export const normalizeDay = (d) => ((d % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;

// --- calendar ↔ orbit -------------------------------------------------------------
const SEGMENTS = (() => {
  const stops = [...SEASON_STOPS].sort((a, b) => a.dayOfYear - b.dayOfYear);
  const out = [];
  let angle = stops[0].angleDeg;
  for (let i = 0; i < stops.length; i++) {
    const cur = stops[i];
    const next = stops[(i + 1) % stops.length];
    const d1 = i + 1 < stops.length ? next.dayOfYear : next.dayOfYear + DAYS_PER_YEAR;
    let a1 = next.angleDeg;
    while (a1 <= angle) a1 += 360;
    out.push({ d0: cur.dayOfYear, d1, a0: angle, a1 });
    angle = a1;
  }
  return out;
})();

/** Orbit angle (deg) for a day of year – piecewise linear between the season stops. */
export function orbitAngleFromDay(dayOfYear) {
  let d = normalizeDay(dayOfYear);
  if (d < SEGMENTS[0].d0) d += DAYS_PER_YEAR;
  const seg = SEGMENTS.find((s) => d >= s.d0 && d < s.d1) ?? SEGMENTS[SEGMENTS.length - 1];
  return normalizeDeg(seg.a0 + ((seg.a1 - seg.a0) * (d - seg.d0)) / (seg.d1 - seg.d0));
}

/** Day of year for an orbit angle (deg) – inverse of orbitAngleFromDay. */
export function dayFromOrbitAngle(angleDeg) {
  let a = normalizeDeg(angleDeg);
  if (a < SEGMENTS[0].a0) a += 360;
  const seg = SEGMENTS.find((s) => a >= s.a0 && a < s.a1) ?? SEGMENTS[SEGMENTS.length - 1];
  return normalizeDay(seg.d0 + ((seg.d1 - seg.d0) * (a - seg.a0)) / (seg.a1 - seg.a0));
}

/** Astronomical season for both hemispheres at an orbit angle. */
export function seasonAt(angleDeg) {
  const q = Math.floor(normalizeDeg(angleDeg) / 90) % 4;
  const north = ['summer', 'autumn', 'winter', 'spring'][q];
  const south = ['winter', 'spring', 'summer', 'autumn'][q];
  return { north, south };
}

// --- geometry of illumination -----------------------------------------------------------
/** Solar declination (deg) = latitude of the subsolar point. */
export function declinationDeg(tiltDeg, orbitAngleDeg) {
  return Math.asin(clamp(Math.sin(tiltDeg * DEG) * Math.cos(orbitAngleDeg * DEG), -1, 1)) / DEG;
}

/**
 * Fraction of a rotation during which the Sun is above the (geometric) horizon.
 * 1 = polar day, 0 = polar night, 0.5 at every equinox.
 */
export function dayFraction(latitudeDeg, declinationDeg) {
  const phi = latitudeDeg * DEG;
  const delta = declinationDeg * DEG;
  const num = -Math.sin(phi) * Math.sin(delta);
  const den = Math.cos(phi) * Math.cos(delta);
  if (Math.abs(den) < EPS) return num > EPS ? 0 : num < -EPS ? 1 : 0.5; // at the poles
  const c = num / den;
  if (c <= -1 + EPS) return 1; // polar day (exactly on the polar circle at the solstice: c = −1 up to rounding)
  if (c >= 1 - EPS) return 0; // polar night
  return Math.acos(c) / Math.PI;
}

/** Day length in hours for a rotation period P (hours). */
export function dayLengthHours(latitudeDeg, declinationDeg, periodH) {
  return dayFraction(latitudeDeg, declinationDeg) * periodH;
}

/** Daily mean insolation at the top of the atmosphere (W/m²). Independent of the rotation period. */
export function dailyInsolation(latitudeDeg, declinationDeg) {
  const phi = latitudeDeg * DEG;
  const delta = declinationDeg * DEG;
  const H0 = dayFraction(latitudeDeg, declinationDeg) * Math.PI;
  const q = (SOLAR_CONSTANT_W_M2 / Math.PI) * (H0 * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(H0));
  return Math.max(0, q);
}

/** Annual mean of the daily insolation (W/m²) at a latitude for a given tilt (circular orbit → uniform in θ). */
export function annualMeanInsolation(latitudeDeg, tiltDeg, samples = 180) {
  let sum = 0;
  for (let i = 0; i < samples; i++) sum += dailyInsolation(latitudeDeg, declinationDeg(tiltDeg, (i / samples) * 360));
  return sum / samples;
}

/** Number of days per year with midnight sun / polar night at a latitude. */
export function polarDays(latitudeDeg, tiltDeg) {
  let midnightSun = 0;
  let polarNight = 0;
  const n = 365;
  for (let i = 0; i < n; i++) {
    const f = dayFraction(latitudeDeg, declinationDeg(tiltDeg, orbitAngleFromDay(i + 0.5)));
    if (f >= 1 - EPS) midnightSun++;
    else if (f <= EPS) polarNight++;
  }
  return { midnightSun, polarNight };
}

/**
 * Climate zone by illumination geometry: tropical if the Sun reaches the zenith
 * (|φ| ≤ ε), polar if there is at least one polar day/night (|φ| ≥ 90° − ε).
 * For tilts above 45° both can be true at once ("extreme").
 */
export function climateZone(latitudeDeg, tiltDeg) {
  const a = Math.abs(latitudeDeg);
  const tropical = a <= tiltDeg + 1e-6;
  const polar = a >= 90 - tiltDeg - 1e-6;
  if (tropical && polar) return 'extreme';
  if (tropical) return 'tropical';
  if (polar) return 'polar';
  return 'temperate';
}

// --- temperature estimate -----------------------------------------------------------------
function ebmTemperatureC(insolation, albedo) {
  return (insolation * (1 - albedo) - EBM.A + EBM.C * GLOBAL_MEAN_C) / (EBM.B + EBM.C);
}

/** Surface albedo from the ice-free annual-mean temperature (ice cover is a slow variable). */
export function albedoFor(annualMeanInsolationWm2) {
  const tFree = ebmTemperatureC(annualMeanInsolationWm2, EBM.albedo);
  const ice = clamp((tFree - EBM.iceOnsetC) / (EBM.iceFullC - EBM.iceOnsetC), 0, 1);
  return EBM.albedo + (EBM.albedoIce - EBM.albedo) * ice;
}

/**
 * Day–night temperature swing (K). Scales with √P (thermal inertia of the ground)
 * and with the difference between the Sun's height at noon and at midnight, so it
 * vanishes during polar day and polar night.
 */
export function diurnalSwingK(latitudeDeg, declinationDeg, periodH) {
  const phi = latitudeDeg * DEG;
  const delta = declinationDeg * DEG;
  const noon = Math.max(0, Math.cos(phi - delta)); // sin(altitude at noon)
  const midnight = Math.max(0, -Math.cos(phi + delta)); // sin(altitude at midnight), > 0 only during polar day
  return EBM.diurnalRefK * Math.sqrt(periodH / EARTH_ROTATION_H) * Math.max(0, noon - midnight);
}

/**
 * Rough surface temperature estimate for a latitude at a given orbit position.
 * Annual mean from the energy balance; the seasonal excursion is damped; the
 * day/night values add the diurnal swing. A teaching aid, not a climate model.
 */
export function temperatureEstimate(latitudeDeg, tiltDeg, declinationDeg, periodH, annualInsolation = annualMeanInsolation(latitudeDeg, tiltDeg)) {
  const albedo = albedoFor(annualInsolation);
  const annualC = ebmTemperatureC(annualInsolation, albedo);
  const insolation = dailyInsolation(latitudeDeg, declinationDeg);
  const instantC = ebmTemperatureC(insolation, albedo);
  const meanC = annualC + EBM.seasonalDamping * (instantC - annualC);
  const swingK = diurnalSwingK(latitudeDeg, declinationDeg, periodH);
  return { meanC, dayC: meanC + swingK / 2, nightC: meanC - swingK / 2, swingK, albedo, annualC, insolation, annualInsolation };
}
