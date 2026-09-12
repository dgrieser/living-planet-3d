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
export const SPEED_RANGE = Object.freeze({ min: 0, max: 2000, default: 400 }); // km/s
export const WIND_NOMINAL = Object.freeze({ density: 5, speed: 400 });

/**
 * The nose can be pushed no closer than this (R_E). There is no upper bound and no pressure
 * floor: as the wind dies the boundary recedes as P^(−1/6.6) and at P = 0 it is gone
 * altogether – the standoff is Infinity and the field is an undisturbed dipole.
 */
export const STANDOFF_RANGE = Object.freeze({ min: 3 });

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
  if (speedKmS <= 0) return Infinity;
  return AU / (speedKmS * 1e3) / 3600;
}

// ---------- magnetopause ------------------------------------------------------
/**
 * Standoff distance from pressure balance: the compressed dipole field
 * (2·B₀·(R_E/r)³ at the boundary, doubled by the Chapman–Ferraro current)
 * balances k·ρv²  →  r/R_E = [2B₀²/(μ₀·k·P)]^(1/6). ≈ 10.5 R_E for the quiet wind.
 */
export function pressureBalanceStandoff(pressurePa) {
  if (pressurePa <= 0) return Infinity;
  const r = Math.pow((2 * EARTH.equatorialField * EARTH.equatorialField) / (MU0 * NOSE_PRESSURE_FACTOR * pressurePa), 1 / 6);
  return Math.max(r, STANDOFF_RANGE.min);
}

/**
 * Shue et al. (1997) empirical subsolar magnetopause distance in R_E:
 * r₀ = (11.4 + 0.013·B_z)·P^(−1/6.6)   (B_z ≥ 0; the 0.14 slope applies southward).
 * Pressure enters as P^(−1/6.6) rather than the theoretical P^(−1/6) because the
 * boundary is not a vacuum dipole.
 */
export function shueStandoff(pressureNPa, bzNT = 0) {
  if (pressureNPa <= 0) return Infinity;
  const base = bzNT >= 0 ? 11.4 + 0.013 * bzNT : 11.4 + 0.14 * bzNT;
  return Math.max(base * Math.pow(pressureNPa, -1 / 6.6), STANDOFF_RANGE.min);
}

/** Shue flaring exponent α = (0.58 − 0.010·B_z)(1 + 0.010·P), clamped to the fitted range. */
export function shueAlpha(pressureNPa, bzNT = 0) {
  const p = Math.max(pressureNPa, 0);
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
  return Number.isFinite(r0) ? bowShockStandoff(r0) - r0 : Infinity;
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

/**
 * Tuning of the qualitative deformation – see `deformPoint`. The night-side stretch and
 * flattening start at `tailStart·r₀` and grow over `tailScale·r₀`, so the whole picture is
 * self-similar in the standoff: a weaker wind means a bigger magnetosphere whose inner
 * lines are left alone, and no wind at all (r₀ = ∞) leaves the dipole untouched.
 */
export const TAIL = Object.freeze({
  gain: 1.15, // antisunward stretch per unit of reach
  flatten: 0.72, // collapse towards the cross-tail current sheet
  flare: 0.15, // slight dawn–dusk widening of the lobes
  squashExp: 3, // sharpness of the dayside saturation
  tailStart: 0.2, // …of r₀: inside this the field is dipolar
  tailScale: 0.6, // …of r₀ per unit of reach
  flatScale: 0.5, // …of r₀ until fully pressed into the current sheet
  reachMax: 4,
});

/** Wind-dependent parameters of the deformation: the Shue boundary the lines are held under. */
export function fieldEnv(pressureNPa, bzNT = 0) {
  const p = Math.max(pressureNPa, 0);
  return {
    r0: shueStandoff(p, bzNT),
    alpha: shueAlpha(p, bzNT),
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
 *  2. antisunward stretch – on the nightside x is scaled up with r/r₀, drawing the
 *     outer shells into a magnetotail whose length grows as the wind pushes the
 *     boundary in, and which disappears with the wind;
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

  let s = 1; // compression ratio – 1 = untouched, < 1 = squeezed by the wind
  if (Number.isFinite(env.r0)) {
    const rb = shueRadius(cosT, env.r0, env.alpha);
    const u = r / rb;
    const squashed = (rb * u) / Math.pow(1 + Math.pow(u, TAIL.squashExp), 1 / TAIL.squashExp);
    s = (r + confine * (squashed - r)) / r;
  }

  // everything on the night side scales with the boundary: r₀ = ∞ (no wind) is the identity
  const inner = TAIL.tailStart * env.r0;
  const reach = Number.isFinite(env.r0) ? clamp((r - inner) / (TAIL.tailScale * env.r0), 0, TAIL.reachMax) : 0;
  const flat = Number.isFinite(env.r0) ? clamp((r - inner) / (TAIL.flatScale * env.r0), 0, 1) : 0;
  out[0] = x * s * (1 + TAIL.gain * night * reach);
  out[1] = y * s * (1 - TAIL.flatten * night * flat);
  out[2] = z * s * (1 + TAIL.flare * night * flat);
  out[3] = s;
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

/** Aurora brightness 0…1 from the index; a faint oval always glows – as long as there is a wind at all. */
export function auroraIntensity(kp) {
  if (kp <= 0) return 0;
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
    // the cloud brings its own speed: even into a dead calm it arrives at ≈ 900 km/s
    speed: clamp(Math.max(speedKmS * (1 + CME.speedGain * e), 900 * e), 0, 3000),
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
 * - The air is a budget of two reservoirs: the N₂/O₂ background, which nothing replaces,
 *   and CO₂, which volcanoes add at ≈ 32 t/s and silicate weathering removes wherever
 *   there is liquid water (the carbonate–silicate thermostat of Walker, Hays & Kasting
 *   1981). The wind strips both in proportion. This is why an Earth stripped or robbed of
 *   its air does not stay airless: as long as the planet is volcanically alive it rebuilds
 *   a CO₂ atmosphere in millions of years – the difference between Earth and Mars.
 * - The climate is a grey atmosphere (see GREENHOUSE) coupled to the Budyko/North
 *   one-dimensional ice line with the ice–albedo feedback. It reproduces today's 288 K and
 *   ≈ 74° ice line, freezes the planet over once roughly two thirds of the air are gone,
 *   and needs ≈ 0.2 bar of CO₂ to thaw a snowball again (Pierrehumbert 2004).
 * - Below the triple point of water (6.1 hPa) ice can no longer melt, only sublimate: the
 *   sunlit low latitudes lose their ice to the polar cold traps, as on Mars. With no air the
 *   ground also takes the full cosmic-ray dose of the Moon (cut by the field's cutoff) and
 *   space-weathers – faster when the solar wind reaches it. Cap extent, migration time and
 *   the reddening are order-of-magnitude choices, labelled schematic in the UI.
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
  iceThresholdC: -10, // Budyko: the ice line sits where the annual mean is −10 °C
  meridionalT2: -28, // North (1975): T(x) = T_m + T₂·P₂(x), x = sin φ
  iterations: 80,
  damping: 0.5,
});

/**
 * Grey greenhouse in two parts. The background term stands for water vapour, clouds and
 * pressure broadening and scales with √P (Goldblatt et al. 2009: doubling N₂ ≈ +4 K); the CO₂
 * term is logarithmic above a knee – ≈ 3 K per doubling near today's 0.4 hPa once the
 * water-vapour feedback is folded in – and fades in a thin atmosphere, where the lines are
 * not broadened. Together they give 288 K today with CO₂ carrying ≈ 43 % of the effect,
 * ≈ +9 K for a Mars-like 6 hPa of CO₂ and ≈ +60 K for a bar of it.
 */
export const GREENHOUSE = Object.freeze({
  tauBackground: 0.48,
  pressureExponent: 0.5,
  co2Gain: 0.0975,
  co2KneeHPa: 0.01,
  broadeningExponent: 0.25,
});

export const AIRLESS = Object.freeze({
  albedoGround: 0.2, // bare rock, dry basins
  albedoIce: 0.6,
  capLatDeg: 55, // where the polar caps end while the whole ocean is still there (flow vs. sublimation)
  capLatDryDeg: 84, // …and when nearly all of it has been lost
  migrationYr: 1e5, // low-latitude ice → polar cold traps (mm–m per year, so geologically instant)
  meltYr: 2e4, // …and back into the basins once a greenhouse has thawed the world
  rustYrShielded: 1.2e9, // space weathering by micrometeorites alone (the field keeps the wind off the ground)
  rustYrUnshielded: 4e8, // …plus solar-wind sputtering and implantation, as on the Moon
  noonFactor: 0.9, // thermal lag of a 24-h rotator below the instantaneous subsolar temperature
  nightDropK: 45, // how far a rock surface cools below its mean during a 12-h night
});

/** Volcanic CO₂ and the silicate-weathering thermostat that consumes it (Walker, Hays & Kasting 1981). */
export const VOLCANISM = Object.freeze({
  co2KgPerYr: 1e12, // subaerial + mid-ocean-ridge outgassing, ≈ 0.3 Gt C/yr ≈ 32 t/s
  n2KgPerYr: 5e9, // nitrogen comes back too, but a thousand times more slowly – today's N₂ in ≈ 1 Gyr
  // …and only up to today's amount: what the crust and mantle can give back is what the air held, and
  // today's N₂ is itself in balance with burial, so the shielded Earth stays a steady state
  n2InventoryMultiple: 1,
});
export const WEATHERING = Object.freeze({
  tempScaleK: 13.7, // weathering rate grows e-fold per 13.7 K
  co2Exponent: 0.3, // …and as pCO₂^0.3
  maxMultiple: 20, // a hothouse cannot weather faster than this
  // The ocean holds ≈ 45× the air's carbon and hands it back as the air loses CO₂, so changes in
  // atmospheric CO₂ run this much slower than the bare fluxes while there is open water. A frozen
  // or boiled-off ocean is sealed and buffers nothing.
  oceanBuffer: 15,
});

/** Galactic cosmic rays at the ground: lunar dose with nothing above you, cut down by air and by the field. */
export const RADIATION = Object.freeze({
  airlessDoseMSvYr: 500, // Chang'e-4 / LRO on the Moon: ≈ 1.4 mSv per day
  shieldingGcm2: 140, // e-folding column of air (1033 g/cm² today → ≈ 0.3 mSv/yr)
  fieldFactor: 0.6, // geomagnetic cutoff, averaged over the globe (≈ 0.4 at the equator, 1 at the poles)
});

/** Today's air: 5.15 × 10¹⁸ kg, of which 3.2 × 10¹⁵ kg are CO₂ (≈ 420 ppm by volume). */
export const TODAY_AIR = Object.freeze({ airKg: ATMOSPHERE_MASS - 3.2e15, co2Kg: 3.2e15 });
export const EARTH_SURFACE_AREA = 5.1e14; // m²
export const GRAVITY = 9.81; // m/s²
export const MOLAR_MASS = Object.freeze({ air: 28.97, co2: 44.01 });
/** Water loss to space once the air is gone and the ice sublimates, kg/s – H escapes on its own even with the field. */
export const WATER_LOSS_FLOOR_KGS = 3;

export const CLOCK = Object.freeze({
  maxYr: 1e11, // the scrub range and the cap for the running clock
  timeLapse: { minMyrPerS: 0.01, maxMyrPerS: 1000, defaultMyrPerS: 100, removedMyrPerS: 0.05 }, // the removed-air story plays in kyr–Myr
  maxSubstepYr: 2e4, // the budget is integrated in steps no longer than this…
  maxSubsteps: 200, // …and no more than this many per frame
  historySteps: 400, // outer steps when the clock is scrubbed and the run is re-integrated
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


// ---------- pressures and composition ----------------------------------------------------------
/** Surface pressure of a column of `kg` spread over the globe, in hPa – today's mass gives today's 1013.25. */
export function pressureHPa(kg) {
  return (Math.max(kg, 0) / ATMOSPHERE_MASS) * SEA_LEVEL_PRESSURE_HPA;
}

/** Total pressure, CO₂ partial pressure (by volume) and CO₂ volume fraction of an air/CO₂ mix. */
export function composition(airKg, co2Kg) {
  const air = Math.max(airKg, 0);
  const co2 = Math.max(co2Kg, 0);
  const totalHPa = pressureHPa(air + co2);
  const molesAir = air / MOLAR_MASS.air;
  const molesCo2 = co2 / MOLAR_MASS.co2;
  const co2Fraction = molesAir + molesCo2 > 0 ? molesCo2 / (molesAir + molesCo2) : 0;
  return { totalHPa, co2HPa: totalHPa * co2Fraction, co2Fraction, fraction: totalHPa / SEA_LEVEL_PRESSURE_HPA };
}

/** Today's CO₂ partial pressure in the model, ≈ 0.4 hPa. */
export const TODAY_CO2_HPA = composition(TODAY_AIR.airKg, TODAY_AIR.co2Kg).co2HPa;

/** Fraction of the atmosphere at which the surface pressure drops below the triple point. */
export const TRIPLE_POINT_FRACTION = TRIPLE_POINT_HPA / SEA_LEVEL_PRESSURE_HPA;

/** Altitude on today's Earth with the same pressure, in metres (barometric formula). */
export function equivalentAltitudeM(fraction) {
  if (fraction <= 0) return Infinity;
  return Math.max(0, -SCALE_HEIGHT_KM * 1e3 * Math.log(fraction));
}

/**
 * How the air feels: 'fine' below 3 km, 'thin' up to Everest, 'deathZone' beyond, 'none' in
 * vacuum – and 'toxic' once more than a tenth of it is CO₂, whatever the pressure.
 */
export function breathability(fraction, co2Fraction = 0) {
  if (fraction < TRIPLE_POINT_FRACTION * 2) return 'none';
  if (co2Fraction > 0.1) return 'toxic';
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

/** Grey optical depth of an atmosphere with `totalHPa` of gas, `co2HPa` of it CO₂ – see GREENHOUSE. */
export function opticalDepth(totalHPa, co2HPa) {
  const x = Math.max(totalHPa, 0) / SEA_LEVEL_PRESSURE_HPA;
  const background = GREENHOUSE.tauBackground * Math.pow(x, GREENHOUSE.pressureExponent);
  const co2 = GREENHOUSE.co2Gain * Math.log(1 + Math.max(co2HPa, 0) / GREENHOUSE.co2KneeHPa) * Math.pow(x, GREENHOUSE.broadeningExponent);
  return background + co2;
}

/** Grey-atmosphere surface temperature: T_s⁴ = T_e⁴·(1 + ¾τ). */
export function greenhouseSurfaceTemperature(effectiveK, tau) {
  return effectiveK * Math.pow(1 + 0.75 * Math.max(tau, 0), 0.25);
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
 * Fixed point of greenhouse + ice–albedo feedback for an atmosphere of `totalHPa` with
 * `co2HPa` of CO₂, iterated from `startK`. The feedback has two branches – a warm one with
 * an ice line and a snowball – so where both exist the start decides: a run carries its
 * own temperature forward and therefore freezes only when the warm branch vanishes and
 * thaws only when the frozen one does (≈ 0.15 bar of CO₂, Pierrehumbert 2004). Called
 * without a start it answers "what would today's Earth do with this air".
 */
export function climateState(totalHPa, co2HPa, startK = 288) {
  const tau = opticalDepth(totalHPa, co2HPa);
  let meanK = startK;
  for (let i = 0; i < CLIMATE.iterations; i++) {
    const x = iceLineSin(meanK - 273.15);
    const next = greenhouseSurfaceTemperature(effectiveTemperature(planetaryAlbedo(x)), tau);
    meanK += CLIMATE.damping * (next - meanK);
  }
  const iceSin = iceLineSin(meanK - 273.15);
  return {
    tau,
    meanK,
    meanC: meanK - 273.15,
    iceSin,
    iceLineLatDeg: (Math.asin(iceSin) * 180) / Math.PI,
    frozenArea: 1 - iceSin,
    albedo: planetaryAlbedo(iceSin),
    snowball: iceSin <= 1e-6,
  };
}

/** Today's climate in the model: 288 K, ice line ≈ 74°. */
export const TODAY_CLIMATE = climateState(SEA_LEVEL_PRESSURE_HPA, TODAY_CO2_HPA);
TODAY_ICE_LINE.x = TODAY_CLIMATE.iceSin;
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

/**
 * Galactic-cosmic-ray dose at the ground in mSv/yr: the lunar value with nothing above you,
 * attenuated e-fold per 140 g/cm² of air, and cut to 60 % by the geomagnetic field.
 */
export function cosmicDoseMSvYr(totalHPa, fieldOn) {
  const column = (Math.max(totalHPa, 0) * 100) / GRAVITY / 10; // g/cm²
  return RADIATION.airlessDoseMSvYr * Math.exp(-column / RADIATION.shieldingGcm2) * (fieldOn ? RADIATION.fieldFactor : 1);
}

// ---------- the budget ------------------------------------------------------------------------
/**
 * Silicate weathering, kg of CO₂ per year: today's outgassing at today's climate, e-fold per
 * 13.7 K and ∝ pCO₂^0.3, scaled by the ice-free area – and nothing at all below the triple
 * point or on a frozen world, because it needs rain on rock.
 */
export function weatheringRate(climate, totalHPa, co2HPa) {
  if (totalHPa < TRIPLE_POINT_HPA || climate.snowball || co2HPa <= 0) return 0;
  const warmth = Math.exp((climate.meanK - TODAY_CLIMATE.meanK) / WEATHERING.tempScaleK);
  const supply = Math.pow(co2HPa / TODAY_CO2_HPA, WEATHERING.co2Exponent);
  const liquid = clamp(climate.iceSin, 0, 1) / TODAY_CLIMATE.iceSin;
  return VOLCANISM.co2KgPerYr * Math.min(warmth * supply, WEATHERING.maxMultiple) * liquid;
}

/** The world as it is today – the starting point of every run. */
export function todayWorld() {
  return { elapsedYr: 0, airKg: TODAY_AIR.airKg, co2Kg: TODAY_AIR.co2Kg, waterKg: OCEAN_MASS, meanK: TODAY_CLIMATE.meanK, migration: 0, rust: 0, airlessYr: 0, lifeGone: false };
}

/** The thought experiment: every last bit of gas is gone, and with it everything that breathed it. */
export function removeAtmosphere(world) {
  return { ...world, airKg: 0, co2Kg: 0, lifeGone: true };
}

/** Put today's air back (the ground keeps whatever the run did to it). */
export function restoreAtmosphere(world) {
  return { ...world, airKg: TODAY_AIR.airKg, co2Kg: TODAY_AIR.co2Kg };
}

/**
 * The fluxes acting on a world under the given settings, all in kg/yr.
 * @param {{ density: number, speed: number, fieldOn: boolean, carbonCycle: boolean }} settings
 */
export function fluxes(world, settings) {
  const gas = world.airKg + world.co2Kg;
  const { totalHPa, co2HPa } = composition(world.airKg, world.co2Kg);
  const climate = climateState(totalHPa, co2HPa, world.meanK);
  const airless = totalHPa < TRIPLE_POINT_HPA;
  // the wind strips whatever gas there is – a tenuous exosphere offers it little to take
  const windKgS = settings.fieldOn ? 0 : escapeRateKgS(settings.density, settings.speed);
  const strip = windKgS * YEAR_SECONDS * smoothstep(0, 0.002 * ATMOSPHERE_MASS, gas);
  // The carbon cycle – volcanic CO₂ and N₂, silicate weathering, the ocean's buffer – is one switch:
  // off, the air is a fixed inventory that only the wind can touch.
  const cycle = settings.carbonCycle !== false;
  const outgas = cycle ? VOLCANISM.co2KgPerYr : 0;
  const n2 = cycle ? VOLCANISM.n2KgPerYr * clamp(1 - world.airKg / (VOLCANISM.n2InventoryMultiple * TODAY_AIR.airKg), 0, 1) : 0;
  const weather = cycle ? weatheringRate(climate, totalHPa, co2HPa) : 0;
  const openOcean = cycle && !airless && !climate.snowball;
  // water only goes once the ice sublimates into vacuum: hydrogen escapes on its own, the
  // oxygen is picked up by the wind unless the field keeps it
  const waterKgS = airless ? Math.max(WATER_LOSS_FLOOR_KGS, windKgS) : 0;
  return { strip, outgas, n2, weather, water: waterKgS * YEAR_SECONDS, climate, totalHPa, co2HPa, airless, openOcean };
}

/** One explicit step of the budget; `stepWorld` splits a frame into these. */
function stepOnce(world, settings, dtYr) {
  const f = fluxes(world, settings);
  const gas = world.airKg + world.co2Kg;
  const airShare = gas > 0 ? world.airKg / gas : 0;
  const airKg = Math.max(0, world.airKg + (f.n2 - f.strip * airShare) * dtYr);
  const buffer = f.openOcean ? WEATHERING.oceanBuffer : 1;
  const co2Kg = Math.max(0, world.co2Kg + ((f.outgas - f.weather - f.strip * (1 - airShare)) * dtYr) / buffer);
  const waterKg = Math.max(0, world.waterKg - f.water * dtYr);
  let migration = world.migration;
  if (f.airless) migration = Math.min(1, migration + dtYr / AIRLESS.migrationYr);
  else if (f.climate.meanC > CLIMATE.iceThresholdC) migration = Math.max(0, migration - dtYr / AIRLESS.meltYr);
  let rust = world.rust;
  if (f.airless) {
    const rustYr = settings.fieldOn ? AIRLESS.rustYrShielded : AIRLESS.rustYrUnshielded;
    rust = 1 - (1 - rust) * Math.exp(-dtYr / rustYr);
  }
  return {
    elapsedYr: world.elapsedYr + dtYr,
    airKg,
    co2Kg,
    waterKg,
    meanK: f.climate.meanK,
    migration,
    rust,
    airlessYr: world.airlessYr + (f.airless ? dtYr : 0),
    lifeGone: world.lifeGone || (f.totalHPa < 0.35 * SEA_LEVEL_PRESSURE_HPA),
  };
}

/** Advance the world by `dtYr` years, in substeps short enough for the thermostat to behave. */
export function stepWorld(world, settings, dtYr) {
  const dt = Math.min(Math.max(dtYr, 0), CLOCK.maxYr - world.elapsedYr);
  if (dt <= 0) return world;
  const n = clamp(Math.ceil(dt / CLOCK.maxSubstepYr), 1, CLOCK.maxSubsteps);
  let w = world;
  for (let i = 0; i < n; i++) w = stepOnce(w, settings, dt / n);
  return w;
}

/**
 * The world after `elapsedYr` years of *constant* settings, integrated from today (with the
 * air removed at t = 0 when the settings say so) – used when the clock is scrubbed.
 */
export function historyAt(settings, elapsedYr, { airRemoved = false } = {}) {
  const yr = clamp(elapsedYr, 0, CLOCK.maxYr);
  let w = airRemoved ? removeAtmosphere(todayWorld()) : todayWorld();
  if (yr <= 0) return w;
  const n = CLOCK.historySteps;
  for (let i = 0; i < n; i++) w = stepWorld(w, settings, yr / n);
  return w;
}

// ---------- everything the panel and the picture need -------------------------------------
/**
 * @param {ReturnType<typeof todayWorld>} world
 * @param {{ density: number, speed: number, fieldOn: boolean, carbonCycle: boolean }} settings
 */
export function worldState(world, settings) {
  const f = fluxes(world, settings);
  const comp = composition(world.airKg, world.co2Kg);
  const climate = f.climate;
  const airless = f.airless;
  const water = clamp(world.waterKg / OCEAN_MASS, 0, 1);
  const capLatDeg = capLatitudeDeg(water);
  const bare = airlessTemperatures(capLatDeg);
  const windKgS = settings.fieldOn ? 0 : escapeRateKgS(settings.density, settings.speed);
  let stage;
  if (airless) stage = world.airlessYr < 1e3 ? 'decompression' : world.migration < 0.999 ? 'sublimating' : 'airless';
  else if (comp.co2Fraction > 0.5) stage = climate.snowball ? 'co2Frozen' : climate.iceLineLatDeg < 60 ? 'co2Cold' : 'co2World';
  else if (climate.snowball) stage = 'snowball';
  else if (climate.iceLineLatDeg < 60) stage = 'iceAge';
  else if (world.lifeGone) stage = 'rebuilt';
  else if (comp.fraction < 0.97) stage = 'thinning';
  else stage = 'intact';
  // the mean temperature hands over from the ice-line model to the bare-rock world as the ice migrates
  const bareShare = airless ? world.migration : 0;
  const meanK = climate.meanK + (bare.meanK - climate.meanK) * bareShare;
  return {
    elapsedYr: world.elapsedYr,
    airlessYr: world.airlessYr,
    lifeGone: world.lifeGone,
    fraction: comp.fraction,
    pressureHPa: comp.totalHPa,
    co2HPa: comp.co2HPa,
    co2Fraction: comp.co2Fraction,
    altitudeM: equivalentAltitudeM(comp.fraction),
    breathability: breathability(comp.fraction, comp.co2Fraction),
    water,
    airless,
    climate,
    meanK,
    meanC: meanK - 273.15,
    migration: world.migration,
    rust: world.rust,
    capLatDeg,
    bare,
    stripKgS: f.strip / YEAR_SECONDS,
    windKgS,
    outgasKgS: f.outgas / YEAR_SECONDS,
    weatherKgS: f.weather / YEAR_SECONDS,
    netKgS: (f.outgas + f.n2 - f.weather - f.strip) / YEAR_SECONDS,
    lifetimeYr: atmosphereLifetimeYr(windKgS),
    remainingYr: f.strip > f.outgas + f.n2 - f.weather ? (world.airKg + world.co2Kg) / (f.strip - (f.outgas + f.n2 - f.weather)) : Infinity,
    doseMSvYr: cosmicDoseMSvYr(comp.totalHPa, settings.fieldOn),
    stage,
    beyondSun: world.elapsedYr > SUN_REMAINING_YR,
  };
}
