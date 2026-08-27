/**
 * Pure physics for the habitable-zone simulation. No Three.js imports so the
 * module can be validated from node (scripts/check-habitable-zone.mjs).
 *
 * Units: luminosity L in solar luminosities (L☉), distance d in astronomical
 * units (AU), temperatures in kelvin, ages in Gyr.
 */

// --- constants -----------------------------------------------------------------
export const SOLAR_TEFF_K = 5778;
export const SUN_AGE_GYR = 4.57;
export const MAX_AGE_GYR = 10;

/** Conservative habitable-zone flux limits (Kopparapu et al. 2013), in units of Earth's insolation S☉. */
export const S_INNER = 1.1; // runaway greenhouse
export const S_OUTER = 0.53; // maximum greenhouse

/** Equilibrium-temperature constant: T_eq = TEQ_CONST_K · L^¼ / √d. */
export const TEQ_CONST_K = 278;
/** Approximate greenhouse warming of Earth's surface above its equilibrium temperature. */
export const GREENHOUSE_EARTH_K = 33;

export const DISTANCE_RANGE_AU = Object.freeze({ min: 0.1, max: 5 });
export const LUMINOSITY_RANGE = Object.freeze({ min: 0.001, max: 10 });

/** Star type presets (luminosity in L☉). Effective temperature and radius follow from mainSequenceStar(). */
export const STAR_PRESETS = Object.freeze([
  { id: 'M', luminosity: 0.01 },
  { id: 'K', luminosity: 0.3 },
  { id: 'G', luminosity: 1 },
  { id: 'F', luminosity: 3 },
]);

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (edge0, edge1, x) => {
  const k = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return k * k * (3 - 2 * k);
};

// --- habitable zone ----------------------------------------------------------------
/** Inner/outer edge of the conservative habitable zone in AU for luminosity L. */
export function zoneEdgesAU(L) {
  return { inner: Math.sqrt(L / S_INNER), outer: Math.sqrt(L / S_OUTER) };
}

/** Ratio inner/outer – independent of L, so the zone geometry can simply be scaled by √L. */
export const ZONE_EDGE_RATIO = Math.sqrt(S_OUTER / S_INNER);

/** Stellar flux at distance d relative to Earth's insolation. */
export const insolation = (L, dAU) => L / (dAU * dAU);

// --- planet ---------------------------------------------------------------------------
/** Planetary equilibrium temperature (K), fast rotator, no greenhouse effect. */
export function equilibriumTemperatureK(L, dAU) {
  return (TEQ_CONST_K * Math.pow(L, 0.25)) / Math.sqrt(dAU);
}

/**
 * State thresholds expressed as equilibrium temperatures. They coincide with the
 * zone edges: T_eq depends only on the insolation S = L/d², so S = S_OUTER and
 * S = S_INNER map to fixed temperatures (≈ 237 K and ≈ 285 K).
 */
export const T_FROZEN_K = equilibriumTemperatureK(S_OUTER, 1);
export const T_SCORCHED_K = equilibriumTemperatureK(S_INNER, 1);

/** 'frozen' | 'habitable' | 'scorched' */
export function classify(teqK) {
  if (teqK < T_FROZEN_K) return 'frozen';
  if (teqK > T_SCORCHED_K) return 'scorched';
  return 'habitable';
}

/**
 * Continuous blend factors for the surface shader (0…1 each), smoothed over ±width K
 * around the thresholds so the surface morphs instead of popping.
 */
export function stateMix(teqK, width = 4) {
  return {
    thaw: smoothstep(T_FROZEN_K - width, T_FROZEN_K + width, teqK), // 0 frozen → 1 temperate
    scorch: smoothstep(T_SCORCHED_K - width, T_SCORCHED_K + width, teqK), // 0 temperate → 1 scorched
  };
}

/** Kepler's third law: orbital period in years for distance d (AU) around mass M (M☉). */
export const orbitalPeriodYears = (dAU, massSolar) => Math.sqrt((dAU * dAU * dAU) / massSolar);

// --- stars -------------------------------------------------------------------------------
/**
 * Main-sequence star described by its luminosity, using rough empirical relations:
 *   T_eff ≈ 5778 K · L^0.13,  M ≈ L^(1/3.5) M☉,  R = √L · (5778 K / T_eff)² R☉.
 */
export function mainSequenceStar(L) {
  const teffK = SOLAR_TEFF_K * Math.pow(L, 0.13);
  return {
    luminosity: L,
    teffK,
    massSolar: Math.pow(L, 1 / 3.5),
    radiusSolar: Math.sqrt(L) * Math.pow(SOLAR_TEFF_K / teffK, 2),
  };
}

/**
 * Luminosity of a Sun-like star at age t (Gyr) on the main sequence
 * (Gough 1981): L(t) = L☉ / (1 + 0.4 · (1 − t / 4.57 Gyr)).
 * ≈ 0.71 L☉ at birth, 1 L☉ today, ≈ 1.9 L☉ at 10 Gyr – roughly +10 % per Gyr.
 */
export function solarLuminosityAtAge(tGyr) {
  return 1 / (1 + 0.4 * (1 - tGyr / SUN_AGE_GYR));
}

/** Inverse of solarLuminosityAtAge(). */
export function ageForSolarLuminosity(L) {
  return SUN_AGE_GYR * (1 - (1 / L - 1) / 0.4);
}

/** Sun-like star at age t (Gyr). T_eff changes only slightly along the main sequence. */
export function sunAtAge(tGyr) {
  const luminosity = solarLuminosityAtAge(tGyr);
  const teffK = SOLAR_TEFF_K * Math.pow(luminosity, 0.04); // ≈ 5700 K at birth, ≈ 5930 K at 10 Gyr
  return {
    luminosity,
    teffK,
    massSolar: 1,
    radiusSolar: Math.sqrt(luminosity) * Math.pow(SOLAR_TEFF_K / teffK, 2),
  };
}

/**
 * Age interval [from, to] (Gyr, within 0…MAX_AGE_GYR) during which a planet at
 * distance d around a Sun-like star lies inside the habitable zone, or null.
 */
export function habitableWindowGyr(dAU) {
  const from = Math.max(0, ageForSolarLuminosity(S_OUTER * dAU * dAU));
  const to = Math.min(MAX_AGE_GYR, ageForSolarLuminosity(S_INNER * dAU * dAU));
  return from < to ? { from, to } : null;
}

/** Harvard spectral class from effective temperature. */
export function spectralType(teffK) {
  if (teffK >= 7500) return 'A';
  if (teffK >= 6000) return 'F';
  if (teffK >= 5200) return 'G';
  if (teffK >= 3700) return 'K';
  return 'M';
}

/**
 * Display colour (sRGB, 0…1) for a star of the given effective temperature.
 * A hand-tuned ramp following the classic spectral-class colours (red M dwarfs,
 * yellow-white G stars, blue-white A stars); slightly more saturated than a
 * pure black-body rendering so the classes read clearly on screen.
 */
const STAR_COLOR_RAMP = [
  [2400, 0xff2e12],
  [3000, 0xff5a2a],
  [3700, 0xff8c3a],
  [4500, 0xffb56b],
  [5200, 0xffd9a3],
  [5800, 0xfff0c8],
  [6500, 0xfdf9f0],
  [7500, 0xe6eeff],
  [10000, 0xbcd0ff],
];
export function starColorRGB(teffK) {
  const T = clamp(teffK, STAR_COLOR_RAMP[0][0], STAR_COLOR_RAMP[STAR_COLOR_RAMP.length - 1][0]);
  let i = 0;
  while (i < STAR_COLOR_RAMP.length - 2 && T > STAR_COLOR_RAMP[i + 1][0]) i++;
  const [t0, c0] = STAR_COLOR_RAMP[i];
  const [t1, c1] = STAR_COLOR_RAMP[i + 1];
  const k = (T - t0) / (t1 - t0);
  const ch = (c, shift) => ((c >> shift) & 0xff) / 255;
  return [16, 8, 0].map((shift) => ch(c0, shift) + (ch(c1, shift) - ch(c0, shift)) * k);
}
