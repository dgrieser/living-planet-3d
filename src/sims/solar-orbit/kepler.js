/**
 * Approximate heliocentric planet positions from Keplerian elements.
 *
 * Implements the algorithm from JPL Solar System Dynamics,
 * "Keplerian Elements for Approximate Positions of the Major Planets"
 * (E. M. Standish), Table 1 – valid for 1800 AD – 2050 AD:
 * https://ssd.jpl.nasa.gov/planets/approx_pos.html
 *
 * The module is pure JavaScript (no DOM, no Three.js) so it can be unit-tested
 * with Node (see scripts/check-orbits.mjs).
 *
 * Coordinates are heliocentric J2000 ecliptic (x towards the vernal equinox,
 * z towards the ecliptic north pole), in astronomical units.
 */

export const AU_KM = 149597870.7;
export const J2000_JD = 2451545.0;
export const DAYS_PER_CENTURY = 36525;
export const DAYS_PER_YEAR = 365.25;

/** Range of validity of the element table (Julian dates for 1800-01-01 and 2050-12-31). */
export const VALID_RANGE = Object.freeze({
  minJD: dateToJD(new Date(Date.UTC(1800, 0, 1))),
  maxJD: dateToJD(new Date(Date.UTC(2050, 11, 31, 23, 59, 59))),
});

const DEG = Math.PI / 180;

/**
 * Table 1 – Keplerian elements and their rates, mean ecliptic and equinox of J2000.
 * Units: a [au, au/Cy], e [-, /Cy], I [deg, deg/Cy], L [deg, deg/Cy],
 * longPeri ϖ [deg, deg/Cy], longNode Ω [deg, deg/Cy].
 * "earth" uses the Earth–Moon barycenter row (Earth itself is < 0.00003 au away).
 */
export const ELEMENTS = Object.freeze({
  mercury: { a: [0.38709927, 0.00000037], e: [0.20563593, 0.00001906], I: [7.00497902, -0.00594749], L: [252.2503235, 149472.67411175], longPeri: [77.45779628, 0.16047689], longNode: [48.33076593, -0.12534081] },
  venus: { a: [0.72333566, 0.0000039], e: [0.00677672, -0.00004107], I: [3.39467605, -0.0007889], L: [181.9790995, 58517.81538729], longPeri: [131.60246718, 0.00268329], longNode: [76.67984255, -0.27769418] },
  earth: { a: [1.00000261, 0.00000562], e: [0.01671123, -0.00004392], I: [-0.00001531, -0.01294668], L: [100.46457166, 35999.37244981], longPeri: [102.93768193, 0.32327364], longNode: [0.0, 0.0] },
  mars: { a: [1.52371034, 0.00001847], e: [0.0933941, 0.00007882], I: [1.84969142, -0.00813131], L: [-4.55343205, 19140.30268499], longPeri: [-23.94362959, 0.44441088], longNode: [49.55953891, -0.29257343] },
  jupiter: { a: [5.202887, -0.00011607], e: [0.04838624, -0.00013253], I: [1.30439695, -0.00183714], L: [34.39644051, 3034.74612775], longPeri: [14.72847983, 0.21252668], longNode: [100.47390909, 0.20469106] },
  saturn: { a: [9.53667594, -0.0012506], e: [0.05386179, -0.00050991], I: [2.48599187, 0.00193609], L: [49.95424423, 1222.49362201], longPeri: [92.59887831, -0.41897216], longNode: [113.66242448, -0.28867794] },
  uranus: { a: [19.18916464, -0.00196176], e: [0.04725744, -0.00004397], I: [0.77263783, -0.00242939], L: [313.23810451, 428.48202785], longPeri: [170.9542763, 0.40805281], longNode: [74.01692503, 0.04240589] },
  neptune: { a: [30.06992276, 0.00026291], e: [0.00859048, 0.00005105], I: [1.77004347, 0.00035372], L: [-55.12002969, 218.45945325], longPeri: [44.96476227, -0.32241464], longNode: [131.78422574, -0.00508664] },
});

export const PLANET_IDS = Object.freeze(Object.keys(ELEMENTS));

/** JavaScript Date → Julian date (UTC; the ~1 min TT−UTC offset is irrelevant at this accuracy). */
export function dateToJD(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Julian date → JavaScript Date. */
export function jdToDate(jd) {
  return new Date((jd - 2440587.5) * 86400000);
}

/** Julian centuries since J2000.0. */
export function centuriesSinceJ2000(jd) {
  return (jd - J2000_JD) / DAYS_PER_CENTURY;
}

/** Normalise an angle in degrees to the interval [-180, 180). */
export function normalizeDegrees(deg) {
  let d = deg % 360;
  if (d < -180) d += 360;
  else if (d >= 180) d -= 360;
  return d;
}

/**
 * Elements at time T (centuries since J2000) – step 1 of the algorithm.
 * Returns angles in degrees and the derived argument of perihelion ω = ϖ − Ω.
 */
export function elementsAt(planetId, T) {
  const el = ELEMENTS[planetId];
  if (!el) throw new Error(`Unknown planet "${planetId}"`);
  const a = el.a[0] + el.a[1] * T;
  const e = el.e[0] + el.e[1] * T;
  const I = el.I[0] + el.I[1] * T;
  const L = el.L[0] + el.L[1] * T;
  const longPeri = el.longPeri[0] + el.longPeri[1] * T;
  const longNode = el.longNode[0] + el.longNode[1] * T;
  return { a, e, I, L, longPeri, longNode, argPeri: longPeri - longNode };
}

/**
 * Solve Kepler's equation M = E − e·sin E for the eccentric anomaly (degrees),
 * using the Newton iteration from the JPL note (tolerance 1e-6 degrees).
 * @param {number} M mean anomaly in degrees
 * @param {number} e eccentricity
 */
export function solveKepler(M, e, tolerance = 1e-6) {
  const eStar = e / DEG; // e in degrees
  let E = M + eStar * Math.sin(M * DEG);
  for (let i = 0; i < 100; i++) {
    const dM = M - (E - eStar * Math.sin(E * DEG));
    const dE = dM / (1 - e * Math.cos(E * DEG));
    E += dE;
    if (Math.abs(dE) <= tolerance) break;
  }
  return E;
}

/**
 * Rotate orbital-plane coordinates (x', y') into the J2000 ecliptic frame.
 * Angles in degrees.
 */
export function orbitalToEcliptic(xp, yp, argPeriDeg, longNodeDeg, inclDeg) {
  const cw = Math.cos(argPeriDeg * DEG);
  const sw = Math.sin(argPeriDeg * DEG);
  const cO = Math.cos(longNodeDeg * DEG);
  const sO = Math.sin(longNodeDeg * DEG);
  const cI = Math.cos(inclDeg * DEG);
  const sI = Math.sin(inclDeg * DEG);
  return {
    x: (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    y: (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    z: sw * sI * xp + cw * sI * yp,
  };
}

/**
 * Heliocentric J2000 ecliptic position of a planet (au) at a Julian date.
 * `overrides` replaces individual elements (e.g. `{ e: 0.3 }` for a hypothetical orbit).
 * @returns {{x:number,y:number,z:number,r:number,E:number,M:number,elements:object}}
 */
export function planetPosition(planetId, jd, overrides = {}) {
  const T = centuriesSinceJ2000(jd);
  const el = { ...elementsAt(planetId, T), ...overrides };
  if ('longPeri' in overrides || 'longNode' in overrides) el.argPeri = el.longPeri - el.longNode;
  const M = normalizeDegrees(el.L - el.longPeri);
  const E = solveKepler(M, el.e);
  const xp = el.a * (Math.cos(E * DEG) - el.e);
  const yp = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E * DEG);
  const pos = orbitalToEcliptic(xp, yp, el.argPeri, el.longNode, el.I);
  return { ...pos, r: Math.hypot(pos.x, pos.y, pos.z), E, M, elements: el };
}

/**
 * Sample a full orbit ellipse (au, ecliptic frame) for the elements valid at `jd`.
 * `overrides` lets callers draw hypothetical orbits (e.g. a different eccentricity).
 */
export function orbitPath(planetId, jd, segments = 360, overrides = {}) {
  const el = { ...elementsAt(planetId, centuriesSinceJ2000(jd)), ...overrides };
  if ('longPeri' in overrides || 'longNode' in overrides) el.argPeri = el.longPeri - el.longNode;
  const points = [];
  const b = el.a * Math.sqrt(1 - el.e * el.e);
  for (let i = 0; i <= segments; i++) {
    const E = (i / segments) * 360;
    const xp = el.a * (Math.cos(E * DEG) - el.e);
    const yp = b * Math.sin(E * DEG);
    points.push(orbitalToEcliptic(xp, yp, el.argPeri, el.longNode, el.I));
  }
  return points;
}

/** Sidereal orbital period in days derived from the mean-longitude rate. */
export function orbitalPeriodDays(planetId) {
  return (360 / ELEMENTS[planetId].L[1]) * DAYS_PER_CENTURY;
}

/** Perihelion / aphelion distances (au) for the elements at `jd`. */
export function apsides(planetId, jd, overrides = {}) {
  const el = { ...elementsAt(planetId, centuriesSinceJ2000(jd)), ...overrides };
  return { perihelion: el.a * (1 - el.e), aphelion: el.a * (1 + el.e) };
}
