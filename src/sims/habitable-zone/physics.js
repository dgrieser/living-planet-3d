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

/** Sizes, from the IAU nominal values – used to state honestly how far the picture exaggerates. */
export const KM_PER_AU = 149597870.7;
export const SOLAR_RADIUS_KM = 695700;
export const EARTH_RADIUS_KM = 6371;
export const SOLAR_RADIUS_AU = SOLAR_RADIUS_KM / KM_PER_AU; // 0.004650 AU – the Sun is 1/215 of Earth's orbit
export const EARTH_RADIUS_AU = EARTH_RADIUS_KM / KM_PER_AU; // 4.259e-5 AU

/**
 * Equilibrium-temperature constant: T_eq = TEQ_CONST_K · L^¼ / √d, for a Bond albedo of 0
 * (a perfectly absorbing, fast-rotating planet): 278 K = [S☉ / (4σ)]^¼ with S☉ = 1361 W/m².
 * It is not a surface temperature – a real planet reflects part of the light away (Earth's
 * albedo of 0.3 lowers this to 255 K) and its greenhouse effect then warms the ground back up
 * (Earth's surface sits at 288 K, 33 K above its albedo-0.3 equilibrium temperature).
 */
export const TEQ_CONST_K = 278;
/** Greenhouse warming of Earth's surface (288 K) above its albedo-0.3 equilibrium temperature (255 K). */
export const GREENHOUSE_EARTH_K = 33;
export const EARTH_ALBEDO = 0.306; // Bond albedo, for the note above

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
/**
 * Conservative habitable-zone limits from Kopparapu et al. (2014), Table 1, for a 1 M⊕ planet:
 * the effective stellar flux at a limit, as a quartic in T* = T_eff − 5780 K,
 *
 *   S_eff = S_eff,☉ + a·T* + b·T*² + c·T*³ + d·T*⁴.
 *
 * The inner edge is the runaway greenhouse (the oceans evaporate), the outer edge the maximum
 * greenhouse (beyond it not even a thick CO₂ atmosphere keeps the surface above freezing). The
 * point of the polynomial is that the limits are not the same flux for every star: the light of
 * a cool red star is absorbed more readily by a planet's atmosphere than the Sun's, so both edges
 * move to lower fluxes – around an M dwarf the zone sits some 10–20 % farther out than the naive
 * √L scaling of the solar values would put it.
 */
export const HZ_LIMITS = Object.freeze({
  runawayGreenhouse: Object.freeze({ sSun: 1.107, a: 1.332e-4, b: 1.58e-8, c: -8.308e-12, d: -1.931e-15 }),
  maximumGreenhouse: Object.freeze({ sSun: 0.356, a: 6.171e-5, b: 1.698e-9, c: -3.198e-12, d: -5.575e-16 }),
});
/** The polynomials are expanded around this T_eff and fitted over this range (held at the edges outside it). */
export const HZ_TEFF_REFERENCE_K = 5780;
export const HZ_TEFF_RANGE = Object.freeze({ min: 2600, max: 7200 });

/** Effective stellar flux (S☉) at one limit for a star of effective temperature `teffK`. */
export function seffLimit(limit, teffK) {
  const dT = clamp(teffK, HZ_TEFF_RANGE.min, HZ_TEFF_RANGE.max) - HZ_TEFF_REFERENCE_K;
  return limit.sSun + dT * (limit.a + dT * (limit.b + dT * (limit.c + dT * limit.d)));
}
/** Both conservative flux limits (S☉) for a star of effective temperature `teffK`. */
export function zoneFluxLimits(teffK = SOLAR_TEFF_K) {
  return {
    inner: seffLimit(HZ_LIMITS.runawayGreenhouse, teffK),
    outer: seffLimit(HZ_LIMITS.maximumGreenhouse, teffK),
  };
}

/** Inner/outer edge of the conservative habitable zone in AU for luminosity L (L☉) and T_eff. */
export function zoneEdgesAU(L, teffK = SOLAR_TEFF_K) {
  const s = zoneFluxLimits(teffK);
  return { inner: Math.sqrt(L / s.inner), outer: Math.sqrt(L / s.outer) };
}

/** Ratio inner/outer of the zone edges. Independent of L, but not of the star's temperature. */
export function zoneEdgeRatio(teffK = SOLAR_TEFF_K) {
  const s = zoneFluxLimits(teffK);
  return Math.sqrt(s.outer / s.inner);
}

/** Stellar flux at distance d relative to Earth's insolation. */
export const insolation = (L, dAU) => L / (dAU * dAU);

/** Angular diameter (degrees) of a star of radius R (R☉) seen from d AU – 0.53° for the Sun from Earth. */
export function angularDiameterDeg(radiusSolar, dAU) {
  return (2 * Math.atan((radiusSolar * SOLAR_RADIUS_AU) / dAU) * 180) / Math.PI;
}

// --- planet ---------------------------------------------------------------------------
/** Planetary equilibrium temperature (K), fast rotator, no greenhouse effect. */
export function equilibriumTemperatureK(L, dAU) {
  return (TEQ_CONST_K * Math.pow(L, 0.25)) / Math.sqrt(dAU);
}

/**
 * State thresholds expressed as equilibrium temperatures. They coincide with the zone edges:
 * T_eq depends only on the insolation S = L/d², so each flux limit maps to one temperature
 * (≈ 215 K and ≈ 285 K around the Sun). Since the limits depend on the star's temperature,
 * so do these thresholds – around an M dwarf they sit some 10 K lower.
 */
export function edgeTemperaturesK(teffK = SOLAR_TEFF_K) {
  const s = zoneFluxLimits(teffK);
  return { frozen: equilibriumTemperatureK(s.outer, 1), scorched: equilibriumTemperatureK(s.inner, 1) };
}

/** 'frozen' | 'habitable' | 'scorched' */
export function classify(teqK, teffK = SOLAR_TEFF_K) {
  const edge = edgeTemperaturesK(teffK);
  if (teqK < edge.frozen) return 'frozen';
  if (teqK > edge.scorched) return 'scorched';
  return 'habitable';
}

/** Temperature spans over which the frozen / scorched appearance ramps (see stateMix). */
export const COLD_RAMP_K = 120;
export const HEAT_RAMP_K = 500;

/**
 * Continuous blend factors for the surface shader (0…1 each), smoothed over ±width K
 * around the thresholds so the surface morphs instead of popping.
 */
export function stateMix(teqK, teffK = SOLAR_TEFF_K, width = 4) {
  const { frozen, scorched } = edgeTemperaturesK(teffK);
  return {
    thaw: smoothstep(frozen - width, frozen + width, teqK), // 0 frozen → 1 temperate
    scorch: smoothstep(scorched - width, scorched + width, teqK), // 0 temperate → 1 scorched
    // how far beyond the edges the planet is – drives the look of the hostile surfaces (schematic):
    cold: smoothstep(frozen, frozen - COLD_RAMP_K, teqK), // 0 partly glaciated → 1 deep-frozen ice world
    heat: smoothstep(scorched, scorched + HEAT_RAMP_K, teqK), // 0 Venus-like cloud world → 1 lava world
  };
}

/** Kepler's third law: orbital period in years for distance d (AU) around mass M (M☉). */
export const orbitalPeriodYears = (dAU, massSolar) => Math.sqrt((dAU * dAU * dAU) / massSolar);

// --- stars -------------------------------------------------------------------------------
/**
 * A star is described by the two quantities the visitor sets: its effective temperature and
 * its radius. Everything else follows from them, starting with the Stefan–Boltzmann law
 *
 *   L = 4πR²σT⁴,  i.e.  L/L☉ = (R/R☉)² · (T_eff/T☉)⁴,
 *
 * which is exact, not a fit. That is what lets the star leave the main sequence: at a fixed
 * temperature a larger star is simply a more luminous one – a subgiant, then a giant – which
 * is how real stars of one spectral class come in luminosity classes.
 */
export function luminosityFromRadiusTeff(radiusSolar, teffK) {
  return radiusSolar * radiusSolar * Math.pow(teffK / SOLAR_TEFF_K, 4);
}
/** The inverse: the radius a star of this luminosity and temperature must have. */
export function radiusFromLuminosityTeff(L, teffK) {
  return Math.sqrt(L) * Math.pow(SOLAR_TEFF_K / teffK, 2);
}

/**
 * Main-sequence relations, used for the presets, for the mass and as the reference the
 * luminosity class is measured against:
 *   T_eff ≈ 5778 K · L^0.13,  M ≈ L^(1/3.5) M☉,  R = √L · (5778 K / T_eff)² R☉.
 */
export const TEFF_LUMINOSITY_EXPONENT = 0.13;
export const MASS_LUMINOSITY_EXPONENT = 3.5;
/** R ∝ √L · T_eff⁻² and T_eff ∝ L^0.13 give R ∝ L^0.24 along the main sequence. */
export const RADIUS_LUMINOSITY_EXPONENT = 0.5 - 2 * TEFF_LUMINOSITY_EXPONENT;
export function mainSequenceStar(L) {
  const teffK = SOLAR_TEFF_K * Math.pow(L, TEFF_LUMINOSITY_EXPONENT);
  return {
    luminosity: L,
    teffK,
    massSolar: Math.pow(L, 1 / MASS_LUMINOSITY_EXPONENT),
    radiusSolar: radiusFromLuminosityTeff(L, teffK),
  };
}
/** Luminosity and radius of the main-sequence star of this temperature (inverse of the above). */
export function mainSequenceLuminosity(teffK) {
  return Math.pow(teffK / SOLAR_TEFF_K, 1 / TEFF_LUMINOSITY_EXPONENT);
}
export function mainSequenceRadius(teffK) {
  return radiusFromLuminosityTeff(mainSequenceLuminosity(teffK), teffK);
}

/**
 * Mass assumed for a star of this temperature: that of the main-sequence star of the same
 * temperature. Temperature and radius do not determine a mass – an inflated star is an evolved
 * one, and evolution keeps the mass while the radius grows – so off the main sequence this is
 * an assumption, not a result. It only enters the orbital period (Kepler's third law), and a
 * real giant is the heavier star, so its periods would come out somewhat shorter than shown.
 */
export function massForTeff(teffK) {
  return Math.pow(mainSequenceLuminosity(teffK), 1 / MASS_LUMINOSITY_EXPONENT);
}

/** The star the visitor has set: temperature and radius in, everything else out. */
export function starFromTeffRadius(teffK, radiusSolar) {
  return {
    luminosity: luminosityFromRadiusTeff(radiusSolar, teffK),
    teffK,
    radiusSolar,
    massSolar: massForTeff(teffK),
  };
}

/** How far the star is inflated over the main-sequence star of the same temperature. */
export function inflationFactor(radiusSolar, teffK) {
  return radiusSolar / mainSequenceRadius(teffK);
}
/**
 * Schematic luminosity class from that ratio. Real classes are read off a spectrum, but the
 * ordering is the same one: at a given temperature a star is a dwarf on the main sequence
 * (V), a subgiant a few times larger (IV), and a giant an order of magnitude larger (III).
 */
export const LUMINOSITY_CLASS_LIMITS = Object.freeze({ dwarf: 0.7, subgiant: 1.4, giant: 4 });
export function luminosityClass(radiusSolar, teffK) {
  const f = inflationFactor(radiusSolar, teffK);
  if (f < LUMINOSITY_CLASS_LIMITS.dwarf) return 'subdwarf';
  if (f <= LUMINOSITY_CLASS_LIMITS.subgiant) return 'dwarf';
  if (f <= LUMINOSITY_CLASS_LIMITS.giant) return 'subgiant';
  return 'giant';
}

/**
 * What the two controls may be set to. The temperature range is exactly where Kopparapu's
 * flux-limit fit is valid, so the zone is never extrapolated. The radius is bounded below by
 * half the main-sequence radius (nothing real sits between the main sequence and the white
 * dwarfs) and above by the scene: past 10 L☉ the habitable zone would lie beyond the farthest
 * orbit the planet can be dragged to.
 */
export const TEFF_RANGE_K = HZ_TEFF_RANGE;
/** How far from the main sequence the star may be taken: half its radius, up to forty times it. */
export const INFLATION_RANGE = Object.freeze({ min: 0.5, max: 40 });
export function radiusRangeFor(teffK) {
  const t2 = Math.pow(clamp(teffK, TEFF_RANGE_K.min, TEFF_RANGE_K.max) / SOLAR_TEFF_K, 2);
  const ms = mainSequenceRadius(clamp(teffK, TEFF_RANGE_K.min, TEFF_RANGE_K.max));
  return {
    min: Math.max(ms * INFLATION_RANGE.min, Math.sqrt(LUMINOSITY_RANGE.min) / t2),
    max: Math.min(ms * INFLATION_RANGE.max, Math.sqrt(LUMINOSITY_RANGE.max) / t2),
  };
}
/** The widest radius the control ever offers, across the whole temperature range. */
export const RADIUS_RANGE_SOLAR = (() => {
  let min = Infinity;
  let max = 0;
  for (let teff = TEFF_RANGE_K.min; teff <= TEFF_RANGE_K.max; teff += 10) {
    const r = radiusRangeFor(teff);
    min = Math.min(min, r.min);
    max = Math.max(max, r.max);
  }
  return Object.freeze({ min, max });
})();

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
 * The flux limits are taken at the Sun's present T_eff: it moves by only ±2 % between
 * 0 and 10 Gyr (see sunAtAge), which shifts the edges by well under a per cent.
 */
export function habitableWindowGyr(dAU) {
  const s = zoneFluxLimits(SOLAR_TEFF_K);
  const from = Math.max(0, ageForSolarLuminosity(s.outer * dAU * dAU));
  const to = Math.min(MAX_AGE_GYR, ageForSolarLuminosity(s.inner * dAU * dAU));
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
