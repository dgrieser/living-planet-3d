/**
 * Pure physics for the magnetosphere simulation. No Three.js / DOM imports so the
 * module can be validated from node (scripts/check-magnetosphere.mjs).
 *
 * Conventions
 * - SI units internally (m, kg, s, T, Pa); the solar-wind API takes the units used
 *   by space-weather monitors: number density in cm⁻³, bulk speed in km/s,
 *   dynamic pressure in nPa.
 * - Distances that describe the magnetosphere are in Earth radii (R_E) because
 *   every published model uses them; `EARTH.radius` converts to metres.
 * - Angles in radians unless the name ends in `Deg`.
 * - Frame used by the scene and by every function here: +x points at the Sun
 *   (the wind flows towards −x), +y is the magnetic dipole axis (north), +z
 *   completes a right-handed system (dusk). θ is the solar zenith angle measured
 *   from +x, so θ = 0 is the subsolar point and θ = π is the centre of the tail.
 *
 * What is real and what is schematic
 * - Dynamic pressure, the pressure-balance standoff distance, the Shue et al.
 *   (1997) magnetopause, dipole field-line geometry (r = L·cos²λ), the transit
 *   time and the aurora viewline are quantitative.
 * - The deformation of the field lines (`deformPoint`), the paraboloid fits used
 *   for the boundary surfaces and the Kp-style index are qualitative models
 *   chosen so that the picture responds correctly to the wind parameters. They
 *   are not a substitute for an MHD simulation and are labelled as schematic in
 *   the UI.
 */

// ---------- constants ---------------------------------------------------------
export const PROTON_MASS = 1.67262192e-27; // kg
export const MU0 = 4 * Math.PI * 1e-7; // N A⁻²
export const AU = 1.495978707e11; // m

export const EARTH = Object.freeze({
  radius: 6.371e6, // m (mean)
  equatorialField: 3.12e-5, // T – dipole field at the equator on the surface
  dipoleTiltDeg: 11, // angle between the magnetic and the rotation axis (not modelled, quoted in the UI)
});

/** Geostationary orbit – the yardstick for "are the satellites still inside?". */
export const GEOSYNC_RE = 6.61;

/** k in k·ρv² – the fraction of the dynamic pressure that presses on the nose. */
export const NOSE_PRESSURE_FACTOR = 0.88;

/** Slider ranges and the quiet-time reference wind (ACE/DSCOVR long-term means). */
export const DENSITY_RANGE = Object.freeze({ min: 0, max: 100, default: 5 }); // cm⁻³
export const SPEED_RANGE = Object.freeze({ min: 200, max: 2000, default: 400 }); // km/s
export const WIND_NOMINAL = Object.freeze({ density: 5, speed: 400 });

/** Pressure floor so that n = 0 cm⁻³ stays finite, plus the standoff clamp. */
export const MIN_PRESSURE_NPA = 0.02;
export const STANDOFF_RANGE = Object.freeze({ min: 3, max: 22 }); // R_E

/** Bow-shock nose distance as a multiple of the magnetopause standoff. */
export const BOW_SHOCK_FACTOR = 1.3;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Hermite smoothstep; edge0 > edge1 is allowed and reverses the ramp. */
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// ---------- solar wind --------------------------------------------------------
/** Mass density ρ = n·m_p in kg/m³ (protons only – ~4 % He adds ~16 %, ignored). */
export function massDensity(densityCm3) {
  return Math.max(densityCm3, 0) * 1e6 * PROTON_MASS;
}

/** Dynamic (ram) pressure P = ρv² in Pa. */
export function dynamicPressure(densityCm3, speedKmS) {
  const v = Math.max(speedKmS, 0) * 1e3;
  return massDensity(densityCm3) * v * v;
}

/** Dynamic pressure in nPa – the unit every space-weather monitor prints. */
export function dynamicPressureNPa(densityCm3, speedKmS) {
  return dynamicPressure(densityCm3, speedKmS) * 1e9;
}

/** Quiet-time reference pressure (≈ 1.34 nPa at 5 cm⁻³ / 400 km/s). */
export const REFERENCE_PRESSURE_NPA = dynamicPressureNPa(WIND_NOMINAL.density, WIND_NOMINAL.speed);

/** Sun → Earth travel time of a wind parcel, in hours (1 AU at constant speed). */
export function transitTimeHours(speedKmS) {
  return AU / (Math.max(speedKmS, 1) * 1e3) / 3600;
}

// ---------- magnetopause ------------------------------------------------------
/**
 * Standoff distance from pressure balance: the compressed dipole field
 * (2·B₀·(R_E/r)³ at the boundary, doubled by the Chapman–Ferraro current)
 * balances k·ρv²  →  r/R_E = [2B₀²/(μ₀·k·P)]^(1/6). ≈ 10.5 R_E for the quiet wind.
 */
export function pressureBalanceStandoff(pressurePa) {
  const p = Math.max(pressurePa, MIN_PRESSURE_NPA * 1e-9);
  const r = Math.pow((2 * EARTH.equatorialField * EARTH.equatorialField) / (MU0 * NOSE_PRESSURE_FACTOR * p), 1 / 6);
  return clamp(r, STANDOFF_RANGE.min, STANDOFF_RANGE.max);
}

/**
 * Shue et al. (1997) empirical subsolar magnetopause distance in R_E:
 * r₀ = (11.4 + 0.013·B_z)·P^(−1/6.6)   (B_z ≥ 0; the 0.14 slope applies southward).
 * Pressure enters as P^(−1/6.6) rather than the theoretical P^(−1/6) because the
 * boundary is not a vacuum dipole.
 */
export function shueStandoff(pressureNPa, bzNT = 0) {
  const p = Math.max(pressureNPa, MIN_PRESSURE_NPA);
  const base = bzNT >= 0 ? 11.4 + 0.013 * bzNT : 11.4 + 0.14 * bzNT;
  return clamp(base * Math.pow(p, -1 / 6.6), STANDOFF_RANGE.min, STANDOFF_RANGE.max);
}

/** Shue flaring exponent α = (0.58 − 0.010·B_z)(1 + 0.010·P), clamped to the fitted range. */
export function shueAlpha(pressureNPa, bzNT = 0) {
  const p = Math.max(pressureNPa, MIN_PRESSURE_NPA);
  return clamp((0.58 - 0.01 * bzNT) * (1 + 0.01 * p), 0.5, 0.95);
}

/** Shue boundary radius along the ray with the given cos θ: r = r₀·[2/(1+cos θ)]^α. */
export function shueRadius(cosTheta, r0, alpha) {
  return r0 * Math.pow(2 / (1 + clamp(cosTheta, -0.995, 1)), alpha);
}

/**
 * Paraboloid of revolution fitted to the Shue boundary at the nose and at the
 * terminator: ρ² = r₀·4^α·(r₀ − x). Used for the boundary surfaces and for the
 * particle streamlines, where a closed-form ρ(x) is needed. Agrees with the
 * exact Shue radius to better than 11 % on the dayside; it flares more in the tail.
 */
export function magnetopauseRadiusAtX(x, r0, alpha) {
  if (x >= r0) return 0;
  return Math.sqrt(r0 * Math.pow(4, alpha) * (r0 - x));
}

/** Bow-shock nose distance in R_E. */
export function bowShockStandoff(r0) {
  return BOW_SHOCK_FACTOR * r0;
}

/** Bow-shock paraboloid ρ² = 4·r₀·(x_n − x); ≈ 25 R_E at the terminator for the quiet wind. */
export function bowShockRadiusAtX(x, r0) {
  const xn = bowShockStandoff(r0);
  if (x >= xn) return 0;
  return Math.sqrt(4 * r0 * (xn - x));
}

/**
 * Transverse radius of a solar-wind streamline at station x, for a parcel that
 * came in with impact parameter ρ∞: ρ(x) = √(ρ∞² + ρ_mp(x + Δ·r₀)²).
 *
 * Adding the cross-section of the obstacle is the standard construction for
 * incompressible flow around a blunt body: it is the identity far upstream and
 * can never take the parcel inside the magnetopause. Evaluating the boundary
 * Δ·r₀ sunward of its true position makes the flow start to turn at the bow
 * shock rather than at the magnetopause itself. The particle vertex shader in
 * index.js implements exactly this formula.
 */
export function streamlineRadius(x, rhoInfinity, r0, alpha, offsetFraction = 0.28) {
  const rb = magnetopauseRadiusAtX(x - offsetFraction * r0, r0, alpha);
  return Math.sqrt(rhoInfinity * rhoInfinity + rb * rb);
}

/** Magnetosheath thickness along the Sun–Earth line, in R_E. */
export function sheathThickness(r0) {
  return bowShockStandoff(r0) - r0;
}

/** True when the magnetopause has been pushed inside geostationary orbit. */
export function geosyncExposed(r0) {
  return r0 < GEOSYNC_RE;
}

// ---------- dipole field lines ------------------------------------------------
/** Magnetic latitude where the L-shell meets the surface: cos²λ = 1/L. */
export function footpointLatitude(L) {
  return Math.acos(Math.sqrt(1 / Math.max(L, 1)));
}

/**
 * Point on an undisturbed dipole field line: r = L·cos²λ, in the meridian at
 * azimuth φ (measured from the Sun direction +x, around the dipole axis +y).
 */
export function dipolePoint(out, L, latRad, azimuthRad) {
  const c = Math.cos(latRad);
  const r = L * c * c;
  const h = r * c;
  out[0] = h * Math.cos(azimuthRad);
  out[1] = r * Math.sin(latRad);
  out[2] = h * Math.sin(azimuthRad);
  return out;
}

/** Tuning of the qualitative deformation – see `deformPoint`. */
export const TAIL = Object.freeze({
  gain: 1.15, // antisunward stretch per unit of (r − 2)/6
  flatten: 0.72, // collapse towards the cross-tail current sheet
  flare: 0.15, // slight dawn–dusk widening of the lobes
  squashExp: 3, // sharpness of the dayside saturation
  reachMax: 4,
});

/**
 * Wind-dependent parameters of the deformation.
 * `tailStretch` is 1 for the quiet-time reference pressure and grows with
 * log P – more ram pressure opens more flux into a longer, thinner tail.
 */
export function fieldEnv(pressureNPa, bzNT = 0) {
  const p = Math.max(pressureNPa, MIN_PRESSURE_NPA);
  return {
    r0: shueStandoff(p, bzNT),
    alpha: shueAlpha(p, bzNT),
    tailStretch: clamp(1 + 0.9 * Math.log10(p / REFERENCE_PRESSURE_NPA), 0.45, 3.6),
  };
}

/**
 * Bend an undisturbed dipole point into the wind-shaped magnetosphere.
 *
 * Three qualitative effects, all switched off at the surface so the footpoints
 * stay planted on Earth:
 *  1. confinement – the radius is mapped through r ↦ r_b·u/(1+u^p)^(1/p) with
 *     u = r/r_b(θ), which is the identity for r ≪ r_b and saturates below the
 *     boundary r_b, so no line can ever cross the magnetopause;
 *  2. antisunward stretch – on the nightside x is scaled up with r, drawing the
 *     outer shells into a magnetotail whose length grows with the wind pressure;
 *  3. flattening – the same region is pressed towards the equatorial current
 *     sheet and slightly widened in dawn–dusk, which is what makes the two
 *     tail lobes.
 */
export function deformPoint(out, x, y, z, env) {
  const r = Math.sqrt(x * x + y * y + z * z);
  if (r < 1e-6) {
    out[0] = x;
    out[1] = y;
    out[2] = z;
    out[3] = 1;
    return out;
  }
  const near = smoothstep(1, 2, r); // 0 at the surface → footpoints are never moved
  const cosT = x / r;
  const nightFrac = smoothstep(-0.3, -0.8, cosT);
  const night = nightFrac * near;
  const confine = (1 - nightFrac) * near;

  const rb = shueRadius(cosT, env.r0, env.alpha);
  const u = r / rb;
  const squashed = (rb * u) / Math.pow(1 + Math.pow(u, TAIL.squashExp), 1 / TAIL.squashExp);
  const rNew = r + confine * (squashed - r);
  const s = rNew / r;

  const reach = clamp((r - 2) / 6, 0, TAIL.reachMax);
  const flat = clamp((r - 2) / 5, 0, 1);
  out[0] = x * s * (1 + TAIL.gain * env.tailStretch * night * reach);
  out[1] = y * s * (1 - TAIL.flatten * night * flat);
  out[2] = z * s * (1 + TAIL.flare * night * flat);
  out[3] = s; // compression ratio – 1 = untouched, < 1 = squeezed by the wind
  return out;
}

// ---------- geomagnetic activity (schematic) ----------------------------------
/**
 * Coupling strength of the wind, normalised to the quiet-time reference:
 * D = √(n/n₀)·(v/v₀)² ∝ v·√P. Speed dominates, exactly as in the observed
 * Kp–wind correlations, but this is a teaching formula, not a forecast model.
 */
export function windCoupling(densityCm3, speedKmS) {
  const n = Math.max(densityCm3, 0);
  const v = Math.max(speedKmS, 0);
  if (n <= 0 || v <= 0) return 0;
  return Math.sqrt(n / WIND_NOMINAL.density) * Math.pow(v / WIND_NOMINAL.speed, 2);
}

export const KP_FIT = Object.freeze({ intercept: 1.5, slope: 3.3 });

/** Kp-style planetary index 0…9 from the wind alone. Schematic – see `windCoupling`. */
export function kpIndex(densityCm3, speedKmS) {
  const d = windCoupling(densityCm3, speedKmS);
  if (d <= 0) return 0;
  return clamp(KP_FIT.intercept + KP_FIT.slope * Math.log10(d), 0, 9);
}

/** NOAA G-scale bucket (G1 = Kp 5 … G5 = Kp 9) plus two quiet levels. */
export function stormLevel(kp) {
  if (kp >= 8.5) return 'g5';
  if (kp >= 7.5) return 'g4';
  if (kp >= 6.5) return 'g3';
  if (kp >= 5.5) return 'g2';
  if (kp >= 4.5) return 'g1';
  if (kp >= 3.5) return 'active';
  return 'quiet';
}

/**
 * Equatorward edge of the auroral oval in geomagnetic latitude, following the
 * NOAA viewline table (≈ 66° at Kp 0, ≈ 48° at Kp 9).
 */
export function auroraBoundaryLatDeg(kp) {
  return clamp(66.5 - 2.1 * clamp(kp, 0, 9), 45, 70);
}

/** Auroral oval as a band in colatitude (radians from the magnetic pole). */
export function auroraBand(kp) {
  const equatorward = auroraBoundaryLatDeg(kp);
  const width = 5.5 + 0.35 * clamp(kp, 0, 9); // the oval also widens during storms
  const poleward = Math.min(equatorward + width, 88);
  const centreLat = (equatorward + poleward) / 2;
  const DEG = Math.PI / 180;
  return {
    equatorwardLatDeg: equatorward,
    polewardLatDeg: poleward,
    centreColat: (90 - centreLat) * DEG,
    halfWidth: ((poleward - equatorward) / 2) * DEG,
  };
}

/** Aurora brightness 0…1 from the index; never quite zero, because the oval always glows. */
export function auroraIntensity(kp) {
  return clamp(Math.pow(clamp((kp - 0.2) / 8.8, 0, 1), 1.2), 0.12, 1);
}

// ---------- coronal mass ejection (schematic envelope) ------------------------
export const CME = Object.freeze({
  travelSeconds: 3.6, // scene time from the Sun sprite to the magnetopause
  riseSeconds: 0.6, // ramp-up after impact – the aurora must be lit well within 2 s
  holdSeconds: 5.5,
  decaySeconds: 8,
  densityGain: 9, // sheath compression of the density
  speedGain: 1.25, // and of the bulk speed
});

/** Impact envelope 0…1 for a CME that arrived `secondsSinceImpact` ago. */
export function cmeEnvelope(secondsSinceImpact) {
  const t = secondsSinceImpact;
  if (t <= 0) return 0;
  if (t < CME.riseSeconds) return smoothstep(0, CME.riseSeconds, t);
  if (t < CME.riseSeconds + CME.holdSeconds) return 1;
  const decayed = t - CME.riseSeconds - CME.holdSeconds;
  if (decayed >= CME.decaySeconds) return 0;
  return 1 - smoothstep(0, CME.decaySeconds, decayed);
}

export const CME_TOTAL_SECONDS = CME.riseSeconds + CME.holdSeconds + CME.decaySeconds;

/** Wind seen by the magnetosphere while a CME sheath is passing. */
export function effectiveWind(densityCm3, speedKmS, envelope) {
  const e = clamp(envelope, 0, 1);
  return {
    density: clamp(densityCm3 * (1 + CME.densityGain * e) + 6 * e, 0, 600),
    speed: clamp(speedKmS * (1 + CME.speedGain * e), 0, 3000),
  };
}

// ---------- one call for everything the UI shows ------------------------------
/**
 * Complete derived state for a wind (already including any CME sheath).
 * @param {number} densityCm3
 * @param {number} speedKmS
 * @param {{ fieldOn?: boolean, bzNT?: number }} [opts]
 */
export function magnetosphereState(densityCm3, speedKmS, { fieldOn = true, bzNT = 0 } = {}) {
  const pressurePa = dynamicPressure(densityCm3, speedKmS);
  const pressureNPa = pressurePa * 1e9;
  const env = fieldEnv(pressureNPa, bzNT);
  const kp = kpIndex(densityCm3, speedKmS);
  return {
    density: densityCm3,
    speed: speedKmS,
    pressurePa,
    pressureNPa,
    pressureRatio: pressureNPa / REFERENCE_PRESSURE_NPA,
    standoff: env.r0,
    alpha: env.alpha,
    tailStretch: env.tailStretch,
    dipoleStandoff: pressureBalanceStandoff(pressurePa),
    bowShock: bowShockStandoff(env.r0),
    sheath: sheathThickness(env.r0),
    standoffKm: (env.r0 * EARTH.radius) / 1000,
    geosyncExposed: fieldOn ? geosyncExposed(env.r0) : true,
    transitHours: transitTimeHours(speedKmS),
    kp: fieldOn ? kp : 0,
    level: fieldOn ? stormLevel(kp) : 'unshielded',
    aurora: auroraBand(kp),
    auroraIntensity: fieldOn ? auroraIntensity(kp) : 0,
    fieldOn,
    env,
  };
}

// =============================================================================================
// the unshielded Earth – what the wind does once the field is gone
// =============================================================================================
/*
 * Everything below describes the planet after the switch: how fast the solar wind can
 * strip the atmosphere, what the thinning air does to the climate, and what is left when
 * it is gone. The picture in index.js is driven from these numbers alone.
 *
 * What is real and what is schematic
 * - The escape budget is energy-limited: the kinetic-energy flux of the wind that the
 *   planet intercepts, times an efficiency, pays for lifting gas out of the gravity well
 *   (Watson et al. 1981 for the energy-limited argument; Zendejas et al. 2010 for the
 *   solar-wind version). The efficiency is calibrated so that the quiet wind gives the
 *   ≈ 1–2 kg/s measured today at Venus, Earth and Mars alike (Gunell et al. 2018) – which
 *   is also why the honest answer for the quiet wind is "longer than the Sun will live".
 *   A stronger wind strips faster as n·v³, so the sliders matter a great deal.
 * - The climate is a grey atmosphere whose optical depth grows as √P (calibrated to the
 *   logarithmic CO₂ forcing and the pressure-broadening result of Goldblatt et al. 2009
 *   that doubling N₂ warms by ≈ 4 K) coupled to the Budyko/North one-dimensional ice line
 *   with the ice–albedo feedback. It reproduces today's 288 K and ≈ 70° ice line, and
 *   freezes the planet over once roughly three quarters of the air are gone.
 * - Below the triple point of water (6.1 hPa) ice can no longer melt, only sublimate: the
 *   sunlit low latitudes lose their ice to the polar cold traps, as on Mars. The cap
 *   extent, the migration time and the reddening of the dry surface are order-of-
 *   magnitude choices, labelled schematic in the UI.
 */
export const G = 6.674e-11; // m³ kg⁻¹ s⁻²
export const SIGMA = 5.670374e-8; // W m⁻² K⁻⁴
export const SOLAR_CONSTANT = 1361; // W/m²
export const YEAR_SECONDS = 3.15576e7;
export const EARTH_MASS = 5.972e24; // kg
export const ATMOSPHERE_MASS = 5.15e18; // kg
export const OCEAN_MASS = 1.35e21; // kg – all of it, ≈ 260 atmospheres' worth
export const SEA_LEVEL_PRESSURE_HPA = 1013.25;
export const TRIPLE_POINT_HPA = 6.117; // below this liquid water cannot exist
export const SCALE_HEIGHT_KM = 7.8; // barometric scale height used for the "like … m altitude" readout
export const SUN_REMAINING_YR = 5e9; // main-sequence life left – the clock keeps running, the caveat appears

export const ESCAPE = Object.freeze({
  efficiency: 0.0025, // fraction of the intercepted kinetic-energy flux that ends up lifting gas
  exobaseAltitudeKm: 500, // radius of the obstacle the wind actually hits
});

export const CLIMATE = Object.freeze({
  albedoOpen: 0.2884, // ice-free surface + clouds; calibrated so today's fixed point is A = 0.30
  albedoIce: 0.6084, // planetary albedo of a fully frozen world
  tau0: 0.85, // grey optical depth today: (288/254.6)⁴ = 1 + ¾τ₀
  tauExponent: 0.5, // τ ∝ P^½ – logarithmic-like forcing plus pressure broadening
  iceThresholdC: -10, // Budyko: the ice line sits where the annual mean is −10 °C
  meridionalT2: -28, // North (1975): T(x) = T_m + T₂·P₂(x), x = sin φ
  iterations: 80,
  damping: 0.5,
});

export const AIRLESS = Object.freeze({
  albedoGround: 0.2, // bare rock, dry basins
  albedoIce: 0.6,
  capLatDeg: 55, // where the polar caps end while the whole ocean is still there (flow vs. sublimation)
  capLatDryDeg: 84, // …and when nearly all of it has been lost
  migrationYr: 1e6, // low-latitude ice → polar cold traps (mm–m per year, so geologically instant)
  rustYr: 1.5e9, // e-folding time of the oxidation / space-weathering of the bare surface
  noonFactor: 0.9, // thermal lag of a 24-h rotator below the instantaneous subsolar temperature
  nightDropK: 45, // how far a rock surface cools below its mean during a 12-h night
});

export const CLOCK = Object.freeze({
  maxYr: 1e11, // the scrub range and the cap for the running clock
  timeLapse: { minMyrPerS: 1, maxMyrPerS: 1000, defaultMyrPerS: 100 },
});

const TODAY_ICE_LINE = { x: 0 }; // filled in below once the model exists

// ---------- energy-limited escape ------------------------------------------------------------
/** Kinetic-energy flux of the wind, ½ρv³, in W/m². */
export function kineticEnergyFlux(densityCm3, speedKmS) {
  const v = Math.max(speedKmS, 0) * 1e3;
  return 0.5 * massDensity(densityCm3) * v * v * v;
}

/** Radius of the obstacle the wind hits when there is no magnetosphere, in metres. */
export function exobaseRadius() {
  return EARTH.radius + ESCAPE.exobaseAltitudeKm * 1e3;
}

/** Wind power intercepted by the unshielded planet, in watts. */
export function interceptedPower(densityCm3, speedKmS) {
  const r = exobaseRadius();
  return kineticEnergyFlux(densityCm3, speedKmS) * Math.PI * r * r;
}

/** Energy needed to lift one kilogram from the exobase to infinity, J/kg. */
export function escapeEnergyPerKg() {
  return (G * EARTH_MASS) / exobaseRadius();
}

/**
 * Energy-limited mass-loss rate in kg/s: ε · ½ρv³ · πR² / (GM/R).
 * ≈ 1.7 kg/s for the quiet wind, ≈ 4 t/s for 100 cm⁻³ at 2000 km/s.
 */
export function escapeRateKgS(densityCm3, speedKmS) {
  return (ESCAPE.efficiency * interceptedPower(densityCm3, speedKmS)) / escapeEnergyPerKg();
}

/** Years until the whole atmosphere is gone at a constant rate (Infinity for no wind). */
export function atmosphereLifetimeYr(rateKgS) {
  if (rateKgS <= 0) return Infinity;
  return ATMOSPHERE_MASS / rateKgS / YEAR_SECONDS;
}

/** Fraction of the atmosphere at which the surface pressure drops below the triple point. */
export const TRIPLE_POINT_FRACTION = TRIPLE_POINT_HPA / SEA_LEVEL_PRESSURE_HPA;

// ---------- the thinning atmosphere ------------------------------------------------------------
/** Mass still in the air, as a fraction of today's, after `lostKg` have been carried off. */
export function atmosphereFraction(lostKg) {
  return clamp(1 - Math.max(lostKg, 0) / ATMOSPHERE_MASS, 0, 1);
}

/** Fraction of the ocean left once the air is gone and the water starts to go. */
export function waterFraction(lostKg) {
  return clamp(1 - Math.max(lostKg - ATMOSPHERE_MASS, 0) / OCEAN_MASS, 0, 1);
}

/** Altitude on today's Earth with the same pressure, in metres (barometric formula). */
export function equivalentAltitudeM(fraction) {
  if (fraction <= 0) return Infinity;
  return Math.max(0, -SCALE_HEIGHT_KM * 1e3 * Math.log(fraction));
}

/** How the air feels: 'fine' below 3 km, 'thin' up to Everest, 'deathZone' beyond, 'none' in vacuum. */
export function breathability(fraction) {
  if (fraction < TRIPLE_POINT_FRACTION * 2) return 'none';
  const h = equivalentAltitudeM(fraction);
  if (h < 3000) return 'fine';
  if (h < 8000) return 'thin';
  return 'deathZone';
}

// ---------- climate: grey greenhouse + Budyko ice line ---------------------------------------
/** Effective (emission) temperature for a planetary albedo A, K. */
export function effectiveTemperature(albedo) {
  return Math.pow((SOLAR_CONSTANT * (1 - albedo)) / (4 * SIGMA), 0.25);
}

/** Grey-atmosphere surface temperature: T_s⁴ = T_e⁴·(1 + ¾τ), τ = τ₀·f^k. */
export function greenhouseSurfaceTemperature(effectiveK, fraction) {
  const tau = CLIMATE.tau0 * Math.pow(clamp(fraction, 0, 1), CLIMATE.tauExponent);
  return effectiveK * Math.pow(1 + 0.75 * tau, 0.25);
}

/**
 * sin(latitude) of the ice line for a global mean T_m (°C): the latitude where
 * T_m + T₂·(3x² − 1)/2 = −10 °C. 1 means ice-free, 0 means frozen to the equator.
 */
export function iceLineSin(meanC) {
  const p2 = (meanC - CLIMATE.iceThresholdC) / -CLIMATE.meridionalT2; // required (3x²−1)/2
  const x2 = (1 + 2 * p2) / 3;
  if (x2 <= 0) return 0;
  return Math.min(Math.sqrt(x2), 1);
}

/** Planetary albedo for an ice line at x = sin φ: area fraction poleward of it is 1 − x per hemisphere. */
export function planetaryAlbedo(iceSin) {
  const frozenArea = 1 - clamp(iceSin, 0, 1);
  return CLIMATE.albedoOpen + (CLIMATE.albedoIce - CLIMATE.albedoOpen) * frozenArea;
}

/**
 * Fixed point of greenhouse + ice–albedo feedback for an atmosphere fraction f.
 * Always iterated from today's warm state, so the result is a function of f alone.
 */
export function climateState(fraction) {
  let meanK = 288;
  for (let i = 0; i < CLIMATE.iterations; i++) {
    const x = iceLineSin(meanK - 273.15);
    const next = greenhouseSurfaceTemperature(effectiveTemperature(planetaryAlbedo(x)), fraction);
    meanK += CLIMATE.damping * (next - meanK);
  }
  const iceSin = iceLineSin(meanK - 273.15);
  return {
    meanK,
    meanC: meanK - 273.15,
    iceSin,
    iceLineLatDeg: (Math.asin(iceSin) * 180) / Math.PI,
    frozenArea: 1 - iceSin,
    albedo: planetaryAlbedo(iceSin),
    snowball: iceSin <= 1e-6,
  };
}

TODAY_ICE_LINE.x = climateState(1).iceSin;
/** sin(latitude) of today's ice line in the model (≈ 0.96, i.e. ≈ 74°). */
export const TODAY_ICE_SIN = TODAY_ICE_LINE.x;

// ---------- the airless world ----------------------------------------------------------------
/** Latitude where the polar caps begin, for a remaining water fraction w (schematic). */
export function capLatitudeDeg(waterFrac) {
  const w = clamp(waterFrac, 0, 1);
  if (w <= 0) return 90;
  // thickness → extent: the caps shrink poleward as the inventory goes, and vanish with it
  return AIRLESS.capLatDeg + (AIRLESS.capLatDryDeg - AIRLESS.capLatDeg) * (1 - Math.pow(w, 0.4));
}

/** Rough surface temperatures of a bare, airless Earth at the equator, K. */
export function airlessTemperatures(capLatDeg) {
  const capArea = 1 - Math.sin((clamp(capLatDeg, 0, 90) * Math.PI) / 180);
  const albedo = AIRLESS.albedoGround + (AIRLESS.albedoIce - AIRLESS.albedoGround) * capArea;
  const subsolar = Math.pow((SOLAR_CONSTANT * (1 - AIRLESS.albedoGround)) / SIGMA, 0.25);
  const equatorMean = Math.pow((SOLAR_CONSTANT * (1 - AIRLESS.albedoGround)) / (Math.PI * SIGMA), 0.25);
  return {
    albedo,
    meanK: effectiveTemperature(albedo),
    noonK: AIRLESS.noonFactor * subsolar,
    nightK: equatorMean - AIRLESS.nightDropK,
  };
}

/** Progress 0…1 of the low-latitude ice moving to the poles, `airlessYr` after the air went. */
export function migrationProgress(airlessYr) {
  return smoothstep(0, AIRLESS.migrationYr, Math.max(airlessYr, 0));
}

/** How rusty and space-weathered the bare surface has become, 0…1. */
export function rustProgress(airlessYr) {
  return 1 - Math.exp(-Math.max(airlessYr, 0) / AIRLESS.rustYr);
}

// ---------- the timeline -------------------------------------------------------------------------
/**
 * Advance the integrated state by `dtYr` years of a wind that strips `rateKgS`.
 * `airlessYr` only counts once the pressure is below the triple point.
 */
export function advanceUnshielded(state, rateKgS, dtYr) {
  const elapsedYr = Math.min(state.elapsedYr + Math.max(dtYr, 0), CLOCK.maxYr);
  const applied = elapsedYr - state.elapsedYr;
  const lostKg = Math.min(state.lostKg + Math.max(rateKgS, 0) * applied * YEAR_SECONDS, ATMOSPHERE_MASS + OCEAN_MASS);
  const before = atmosphereFraction(state.lostKg);
  const after = atmosphereFraction(lostKg);
  let below = 0; // share of the step spent below the triple point
  if (before <= TRIPLE_POINT_FRACTION) below = 1;
  else if (after < TRIPLE_POINT_FRACTION) below = (TRIPLE_POINT_FRACTION - after) / (before - after);
  return { elapsedYr, lostKg, airlessYr: state.airlessYr + applied * below };
}

/** The state after `elapsedYr` years of a *constant* wind – used when the clock is scrubbed. */
export function historyAtConstantWind(rateKgS, elapsedYr) {
  const yr = clamp(elapsedYr, 0, CLOCK.maxYr);
  const lostKg = Math.min(rateKgS * yr * YEAR_SECONDS, ATMOSPHERE_MASS + OCEAN_MASS);
  const tripleYr = rateKgS > 0 ? (ATMOSPHERE_MASS * (1 - TRIPLE_POINT_FRACTION)) / rateKgS / YEAR_SECONDS : Infinity;
  return { elapsedYr: yr, lostKg, airlessYr: Math.max(0, yr - tripleYr) };
}

/**
 * Everything the panel and the picture need about the unshielded planet.
 * @param {{ elapsedYr: number, lostKg: number, airlessYr: number }} state
 * @param {number} densityCm3 steady wind (the CME sheath lasts a day and is not integrated)
 * @param {number} speedKmS
 */
export function unshieldedState(state, densityCm3, speedKmS) {
  const fraction = atmosphereFraction(state.lostKg);
  const water = waterFraction(state.lostKg);
  const climate = climateState(fraction);
  const airless = fraction <= TRIPLE_POINT_FRACTION;
  const migration = airless ? migrationProgress(state.airlessYr) : 0;
  const capLatDeg = capLatitudeDeg(water);
  const bare = airlessTemperatures(capLatDeg);
  const rate = escapeRateKgS(densityCm3, speedKmS);
  let stage = 'intact';
  if (airless) stage = migration >= 0.999 ? 'airless' : 'sublimating';
  else if (climate.snowball) stage = 'snowball';
  else if (climate.iceLineLatDeg < 60) stage = 'iceAge';
  else if (fraction < 0.97) stage = 'thinning';
  // the mean temperature hands over from the ice-line model to the bare-rock world as the ice migrates
  const meanK = climate.meanK + (bare.meanK - climate.meanK) * migration;
  return {
    elapsedYr: state.elapsedYr,
    lostKg: state.lostKg,
    airlessYr: state.airlessYr,
    fraction,
    pressureHPa: fraction * SEA_LEVEL_PRESSURE_HPA,
    altitudeM: equivalentAltitudeM(fraction),
    breathability: breathability(fraction),
    water,
    airless,
    climate,
    meanK,
    meanC: meanK - 273.15,
    migration,
    rust: airless ? rustProgress(state.airlessYr) : 0,
    capLatDeg,
    bare,
    rateKgS: rate,
    lifetimeYr: atmosphereLifetimeYr(rate),
    remainingYr: rate > 0 ? (fraction * ATMOSPHERE_MASS) / rate / YEAR_SECONDS : Infinity,
    stage,
    beyondSun: state.elapsedYr > SUN_REMAINING_YR,
  };
}
