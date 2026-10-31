/**
 * Sun and Moon for the Living Earth simulation – pure JS (wraps astronomy-engine, MIT).
 *
 * Two kinds of answers:
 *  - what an observer on the ground sees: topocentric azimuth / altitude, rise and set, the Moon's phase
 *    (the readouts);
 *  - where the bodies are in the Earth-fixed frame the globe is drawn in: geocentric ECEF vectors
 *    (the light direction, the Sun and Moon in the sky, the orientation of the star field).
 *
 * ECEF here is the true-equator-of-date frame rotated by Greenwich apparent sidereal time, i.e. the
 * terrestrial frame without polar motion (≤ 0.5″, ~15 m on the ground – far below what lighting can show).
 * Time scales (UTC → TT, ΔT) are handled inside astronomy-engine.
 *
 * Validated against JPL Horizons by `npm run check:earth` (scripts/check-earth-ephemeris.mjs).
 */
import * as Astronomy from 'astronomy-engine';

const { Body } = Astronomy;
export const AU_M = 149597870700;
const DEG = Math.PI / 180;

export const BODIES = Object.freeze({ sun: Body.Sun, moon: Body.Moon });

/** Standard altitude of the Sun's centre at sunrise/sunset: 34′ refraction + 16′ semi-diameter. */
export const SUNRISE_ALTITUDE_DEG = -50 / 60;

function observer(latDeg, lonDeg, heightM = 0) {
  return new Astronomy.Observer(latDeg, lonDeg, heightM);
}

/**
 * Apparent topocentric position.
 * @param {'sun'|'moon'} body
 * @param {Date} date
 * @param {{ refraction?: boolean }} [opts] refraction: apply the standard atmospheric refraction
 * @returns {{ azimuthDeg: number, altitudeDeg: number, distanceKm: number, raHours: number, decDeg: number }}
 */
export function topocentric(body, date, latDeg, lonDeg, heightM = 0, { refraction = false } = {}) {
  const obs = observer(latDeg, lonDeg, heightM);
  const eq = Astronomy.Equator(BODIES[body], date, obs, true, true);
  const hor = Astronomy.Horizon(date, obs, eq.ra, eq.dec, refraction ? 'normal' : undefined);
  return { azimuthDeg: hor.azimuth, altitudeDeg: hor.altitude, distanceKm: (eq.dist * AU_M) / 1000, raHours: eq.ra, decDeg: eq.dec };
}

/**
 * Rotation from J2000 equatorial coordinates (EQJ – the star catalogues' frame) to ECEF at `date`:
 * precession + nutation to the true equator of date, then Earth rotation by apparent sidereal time.
 * @returns {number[][]} 3×3 row-major matrix
 */
export function eqjToEcefMatrix(date) {
  const eqd = Astronomy.Rotation_EQJ_EQD(date).rot; // astronomy-engine stores rot[col][row]
  const gast = Astronomy.SiderealTime(date) * 15 * DEG;
  const c = Math.cos(gast);
  const s = Math.sin(gast);
  // R_z(-gast) · R_eqd  (row-major result)
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const rz = [
    [c, s, 0],
    [-s, c, 0],
    [0, 0, 1],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += rz[i][k] * eqd[j][k];
      m[i][j] = sum;
    }
  }
  return m;
}

function applyMatrix(m, v) {
  return [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
}

/**
 * Apparent geocentric position of the Sun or Moon in ECEF.
 * @returns {{ position: number[], direction: number[], distance: number }} metres / unit vector / metres
 */
export function bodyEcef(body, date, matrix = eqjToEcefMatrix(date)) {
  const v = Astronomy.GeoVector(BODIES[body], date, true);
  const position = applyMatrix(matrix, [v.x * AU_M, v.y * AU_M, v.z * AU_M]);
  const distance = Math.hypot(position[0], position[1], position[2]);
  return { position, direction: position.map((c) => c / distance), distance };
}

/**
 * Geographic latitude/longitude (degrees) of the point where the body stands in the zenith.
 * Geocentric direction, so ±0.2° of geodetic latitude difference is ignored – fine for a marker.
 */
export function subBodyPoint(direction) {
  const [x, y, z] = direction;
  return { latDeg: Math.atan2(z, Math.hypot(x, y)) / DEG, lonDeg: Math.atan2(y, x) / DEG };
}

/**
 * Sunrise/sunset (or moonrise/moonset) of the day that starts at `dayStart` (a Date at local midnight).
 * Polar day / night return null for the missing event. Uses the standard −50′ horizon for the Sun.
 * @returns {{ rise: Date|null, set: Date|null }}
 */
export function riseSet(body, dayStart, latDeg, lonDeg, heightM = 0) {
  const obs = observer(latDeg, lonDeg, heightM);
  const rise = Astronomy.SearchRiseSet(BODIES[body], obs, +1, dayStart, 1);
  const set = Astronomy.SearchRiseSet(BODIES[body], obs, -1, dayStart, 1);
  return { rise: rise ? rise.date : null, set: set ? set.date : null };
}

/**
 * The Moon's phase: elongation angle (0 new, 90 first quarter, 180 full, 270 last quarter), the
 * illuminated fraction of the disc and a named phase for the readout.
 */
export function moonPhase(date) {
  const angle = Astronomy.MoonPhase(date);
  const fraction = Astronomy.Illumination(Body.Moon, date).phase_fraction;
  return { angleDeg: angle, fraction, name: moonPhaseName(angle) };
}

/**
 * A named phase. The four principal phases are instants, so they are named only within ±6.5° of
 * elongation (about half a day either side); the rest of the cycle is a crescent or a gibbous Moon,
 * waxing or waning.
 */
export function moonPhaseName(angleDeg) {
  const a = ((angleDeg % 360) + 360) % 360;
  const near = (x) => Math.abs(((a - x + 540) % 360) - 180) <= 6.5;
  if (near(0)) return 'new';
  if (near(90)) return 'firstQuarter';
  if (near(180)) return 'full';
  if (near(270)) return 'lastQuarter';
  if (a < 90) return 'waxingCrescent';
  if (a < 180) return 'waxingGibbous';
  if (a < 270) return 'waningGibbous';
  return 'waningCrescent';
}

/** Greenwich apparent sidereal time in hours (exposed for the star field and the checks). */
export function siderealTimeHours(date) {
  return Astronomy.SiderealTime(date);
}
