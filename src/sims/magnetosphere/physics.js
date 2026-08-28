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
