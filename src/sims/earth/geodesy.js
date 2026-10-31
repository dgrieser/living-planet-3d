/**
 * Geodesy for the Living Earth simulation – pure JS, no Three.js.
 *
 * Everything the client streams lives in ECEF (WGS84, metres); the hero areas are produced in
 * ETRS89 / UTM zone 32N (EPSG:25832). This module holds the conversions between those frames:
 *
 *   geodeticToEcef / ecefToGeodetic   WGS84 latitude, longitude, ellipsoidal height ↔ ECEF
 *   enuBasis / ecefToEnu / enuToEcef  local east-north-up frames for flat simulation grids
 *   utmToGeodetic / geodeticToUtm     transverse Mercator (Krüger series to n⁶, Karney 2011)
 *   etrf2020ToItrf2020 / itrf2020ToEtrf2020   the plate-fixed European frame vs. the global one
 *   parseGtx / sampleGeoidGrid        bilinear geoid / quasigeoid grid lookups (h = H + N)
 *
 * Angles are radians unless a name says otherwise; heights and coordinates are metres.
 * Validated against PROJ by `npm run check:earth` (scripts/check-earth-geodesy.mjs).
 */

// ---------- ellipsoids --------------------------------------------------------------------------
export const WGS84 = Object.freeze(makeEllipsoid(6378137, 1 / 298.257223563));
/** GRS80 – the ellipsoid of ETRS89. Differs from WGS84 by 0.1 mm in the semi-minor axis. */
export const GRS80 = Object.freeze(makeEllipsoid(6378137, 1 / 298.257222101));

function makeEllipsoid(a, f) {
  const b = a * (1 - f);
  const e2 = f * (2 - f);
  return { a, f, b, e2, ep2: e2 / (1 - e2) };
}

export const DEG = Math.PI / 180;
const MAS = DEG / 3600 / 1000; // one milliarcsecond in radians

// ---------- geodetic ↔ ECEF -------------------------------------------------------------------------
/**
 * @param {number} lat geodetic latitude (rad)
 * @param {number} lon longitude (rad)
 * @param {number} [h=0] height above the ellipsoid (m)
 * @param {number[]} [out] receives [x, y, z]
 */
export function geodeticToEcef(lat, lon, h = 0, out = [0, 0, 0], ell = WGS84) {
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const N = ell.a / Math.sqrt(1 - ell.e2 * sinLat * sinLat); // prime vertical radius of curvature
  out[0] = (N + h) * cosLat * Math.cos(lon);
  out[1] = (N + h) * cosLat * Math.sin(lon);
  out[2] = (N * (1 - ell.e2) + h) * sinLat;
  return out;
}

/**
 * ECEF → geodetic, Bowring's parametric start refined by Newton steps on the latitude. Converges to
 * < 1e-12 rad (sub-micrometre) within three iterations anywhere from the Earth's centre region out to
 * lunar distance; the poles and the equatorial plane are handled explicitly.
 * @returns {{ lat: number, lon: number, h: number }}
 */
export function ecefToGeodetic(x, y, z, ell = WGS84) {
  const { a, b, e2, ep2 } = ell;
  const p = Math.hypot(x, y);
  const lon = Math.atan2(y, x);
  if (p < 1e-9) {
    // on the axis: the latitude is ±90° and the height is measured from the pole
    const lat = z >= 0 ? Math.PI / 2 : -Math.PI / 2;
    return { lat, lon: 0, h: Math.abs(z) - b };
  }
  // Bowring (1976) initial guess via the parametric latitude
  let beta = Math.atan2(z * a, p * b);
  let lat = Math.atan2(z + ep2 * b * Math.sin(beta) ** 3, p - e2 * a * Math.cos(beta) ** 3);
  for (let i = 0; i < 4; i++) {
    beta = Math.atan2((1 - ell.f) * Math.sin(lat), Math.cos(lat));
    const next = Math.atan2(z + ep2 * b * Math.sin(beta) ** 3, p - e2 * a * Math.cos(beta) ** 3);
    if (Math.abs(next - lat) < 1e-15) {
      lat = next;
      break;
    }
    lat = next;
  }
  const sinLat = Math.sin(lat);
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  // height: the better-conditioned formula for the latitude band
  const h = Math.abs(lat) < Math.PI / 4 ? p / Math.cos(lat) - N : z / sinLat - N * (1 - e2);
  return { lat, lon, h };
}

/** Degrees convenience wrapper: [lonDeg, latDeg, h] like GeoJSON, out → [x, y, z]. */
export function lonLatHeightToEcef(lonDeg, latDeg, h = 0, out = [0, 0, 0]) {
  return geodeticToEcef(latDeg * DEG, lonDeg * DEG, h, out);
}

// ---------- local ENU frames ---------------------------------------------------------------------------
/**
 * Unit vectors of the east-north-up frame at a geodetic position, in ECEF.
 * @returns {{ east: number[], north: number[], up: number[] }}
 */
export function enuBasis(lat, lon) {
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  return {
    east: [-sinLon, cosLon, 0],
    north: [-sinLat * cosLon, -sinLat * sinLon, cosLat],
    up: [cosLat * cosLon, cosLat * sinLon, sinLat],
  };
}

/**
 * An ENU frame anchored at a geodetic origin – the exact transform between a flat simulation grid
 * (tides, snow, wind) and ECEF.
 */
export function createEnuFrame(lat, lon, h = 0, ell = WGS84) {
  const origin = geodeticToEcef(lat, lon, h, [0, 0, 0], ell);
  const { east, north, up } = enuBasis(lat, lon);
  return {
    origin,
    east,
    north,
    up,
    /** ECEF → [e, n, u] metres relative to the origin. */
    toEnu(x, y, z, out = [0, 0, 0]) {
      const dx = x - origin[0];
      const dy = y - origin[1];
      const dz = z - origin[2];
      out[0] = east[0] * dx + east[1] * dy + east[2] * dz;
      out[1] = north[0] * dx + north[1] * dy + north[2] * dz;
      out[2] = up[0] * dx + up[1] * dy + up[2] * dz;
      return out;
    },
    /** [e, n, u] metres → ECEF. */
    toEcef(e, n, u, out = [0, 0, 0]) {
      out[0] = origin[0] + east[0] * e + north[0] * n + up[0] * u;
      out[1] = origin[1] + east[1] * e + north[1] * n + up[1] * u;
      out[2] = origin[2] + east[2] * e + north[2] * n + up[2] * u;
      return out;
    },
    /** Column-major 4×4 matrix (Three.js `Matrix4.fromArray` order) taking ENU to ECEF. */
    matrix() {
      return [...east, 0, ...north, 0, ...up, 0, ...origin, 1];
    },
  };
}

/** Straight-line (chord) distance between two ECEF points, metres. */
export function ecefDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// ---------- transverse Mercator / UTM -------------------------------------------------------------------
// Krüger series to sixth order in the third flattening n (Karney 2011, "Transverse Mercator with an
// accuracy of a few nanometers"). Error < 5 nm within 3900 km of the central meridian.
function tmSeries(ell) {
  const n = ell.f / (2 - ell.f);
  const n2 = n * n;
  const n3 = n2 * n;
  const n4 = n3 * n;
  const n5 = n4 * n;
  const n6 = n5 * n;
  const A = (ell.a / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
  const alpha = [
    0,
    n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180 - (127 * n5) / 288 + (7891 * n6) / 37800,
    (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440 + (281 * n5) / 630 - (1983433 * n6) / 1935360,
    (61 * n3) / 240 - (103 * n4) / 140 + (15061 * n5) / 26880 + (167603 * n6) / 181440,
    (49561 * n4) / 161280 - (179 * n5) / 168 + (6601661 * n6) / 7257600,
    (34729 * n5) / 80640 - (3418889 * n6) / 1995840,
    (212378941 * n6) / 319334400,
  ];
  const beta = [
    0,
    n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360 - (81 * n5) / 512 + (96199 * n6) / 604800,
    n2 / 48 + n3 / 15 - (437 * n4) / 1440 + (46 * n5) / 105 - (1118711 * n6) / 3870720,
    (17 * n3) / 480 - (37 * n4) / 840 - (209 * n5) / 4480 + (5569 * n6) / 90720,
    (4397 * n4) / 161280 - (11 * n5) / 504 - (830251 * n6) / 7257600,
    (4583 * n5) / 161280 - (108847 * n6) / 3991680,
    (20648693 * n6) / 638668800,
  ];
  return { n, A, alpha, beta, e: Math.sqrt(ell.e2) };
}
const TM_GRS80 = tmSeries(GRS80);

export const UTM = Object.freeze({ k0: 0.9996, falseEasting: 500000, falseNorthingSouth: 10000000 });

/** Central meridian (rad) of a UTM zone. */
export function utmCentralMeridian(zone) {
  return (zone * 6 - 183) * DEG;
}

/**
 * Geodetic (ETRS89/GRS80 by default) → UTM easting/northing.
 * @returns {{ easting: number, northing: number, convergence: number, scale: number }}
 */
export function geodeticToUtm(lat, lon, zone, { south = false, ell = GRS80 } = {}) {
  const s = ell === GRS80 ? TM_GRS80 : tmSeries(ell);
  const { A, alpha, e } = s;
  const dLon = lon - utmCentralMeridian(zone);
  // conformal latitude
  const tau = Math.tan(lat);
  const sigma = Math.sinh(e * Math.atanh((e * tau) / Math.sqrt(1 + tau * tau)));
  const tauP = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
  const xiP = Math.atan2(tauP, Math.cos(dLon));
  const etaP = Math.asinh(Math.sin(dLon) / Math.sqrt(tauP * tauP + Math.cos(dLon) ** 2));
  let xi = xiP;
  let eta = etaP;
  let pP = 1;
  let qP = 0;
  for (let j = 1; j <= 6; j++) {
    xi += alpha[j] * Math.sin(2 * j * xiP) * Math.cosh(2 * j * etaP);
    eta += alpha[j] * Math.cos(2 * j * xiP) * Math.sinh(2 * j * etaP);
    pP += 2 * j * alpha[j] * Math.cos(2 * j * xiP) * Math.cosh(2 * j * etaP);
    qP += 2 * j * alpha[j] * Math.sin(2 * j * xiP) * Math.sinh(2 * j * etaP);
  }
  const easting = UTM.falseEasting + UTM.k0 * A * eta;
  const northing = (south ? UTM.falseNorthingSouth : 0) + UTM.k0 * A * xi;
  // meridian convergence and point scale (Karney eqs. 26–28)
  const gammaP = Math.atan((tauP / Math.sqrt(1 + tauP * tauP)) * Math.tan(dLon));
  const gammaPP = Math.atan2(qP, pP);
  const sinLat = Math.sin(lat);
  const kP = (Math.sqrt(1 - e * e * sinLat * sinLat) * Math.sqrt(1 + tau * tau)) / Math.sqrt(tauP * tauP + Math.cos(dLon) ** 2);
  const kPP = (A / ell.a) * Math.sqrt(pP * pP + qP * qP);
  return { easting, northing, convergence: gammaP + gammaPP, scale: UTM.k0 * kP * kPP };
}

/**
 * UTM easting/northing → geodetic (ETRS89/GRS80 by default).
 * @returns {{ lat: number, lon: number }}
 */
export function utmToGeodetic(easting, northing, zone, { south = false, ell = GRS80 } = {}) {
  const s = ell === GRS80 ? TM_GRS80 : tmSeries(ell);
  const { A, beta, e } = s;
  const eta = (easting - UTM.falseEasting) / (UTM.k0 * A);
  const xi = (northing - (south ? UTM.falseNorthingSouth : 0)) / (UTM.k0 * A);
  let xiP = xi;
  let etaP = eta;
  for (let j = 1; j <= 6; j++) {
    xiP -= beta[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaP -= beta[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const sinhEtaP = Math.sinh(etaP);
  const sinXiP = Math.sin(xiP);
  const cosXiP = Math.cos(xiP);
  const tauP = sinXiP / Math.sqrt(sinhEtaP * sinhEtaP + cosXiP * cosXiP);
  // invert the conformal latitude by Newton iteration (Karney eq. 19–21)
  let tau = tauP;
  for (let i = 0; i < 6; i++) {
    const sigma = Math.sinh(e * Math.atanh((e * tau) / Math.sqrt(1 + tau * tau)));
    const tauI = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
    const dTau =
      ((tauP - tauI) / Math.sqrt(1 + tauI * tauI)) *
      ((1 + (1 - e * e) * tau * tau) / ((1 - e * e) * Math.sqrt(1 + tau * tau)));
    tau += dTau;
    if (Math.abs(dTau) < 1e-14) break;
  }
  const lat = Math.atan(tau);
  const lon = utmCentralMeridian(zone) + Math.atan2(sinhEtaP, cosXiP);
  return { lat, lon };
}

// ---------- ETRS89 (ETRF2020) ↔ ITRF2020 ------------------------------------------------------------------
// ETRF2020 coincides with ITRF2020 at epoch 1989.0 and then rotates with the stable part of the
// Eurasian plate (EUREF TN1, ITRF2020 plate motion model): rotation rates in milliarcseconds per year,
// "position vector" convention. By 2026 the frames are ≈ 0.95 m apart in Lübbecke and Fanø.
export const ETRF2020_RATES_MAS = Object.freeze([0.086, 0.519, -0.753]);
export const ETRF_EPOCH = 1989.0;

/** Calendar date → decimal year (UTC, good to ~1 s – plenty for plate motion at cm/yr). */
export function decimalYear(date) {
  const y = date.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  return y + (date.getTime() - start) / (end - start);
}

function etrfRotate(x, y, z, epoch, sign, out) {
  const dt = (epoch - ETRF_EPOCH) * sign;
  const rx = ETRF2020_RATES_MAS[0] * MAS * dt;
  const ry = ETRF2020_RATES_MAS[1] * MAS * dt;
  const rz = ETRF2020_RATES_MAS[2] * MAS * dt;
  // position vector convention: X' = X + R·X, R = [[0, -rz, ry], [rz, 0, -rx], [-ry, rx, 0]]
  out[0] = x - rz * y + ry * z;
  out[1] = rz * x + y - rx * z;
  out[2] = -ry * x + rx * y + z;
  return out;
}

/** ITRF2020 ECEF at `epoch` (decimal year) → ETRF2020 ECEF. */
export function itrf2020ToEtrf2020(x, y, z, epoch, out = [0, 0, 0]) {
  return etrfRotate(x, y, z, epoch, 1, out);
}

/**
 * ETRF2020 ECEF → ITRF2020 ECEF at `epoch`. The rotation is a few 1e-8 rad, so the first-order inverse
 * (the opposite rotation) is exact to well below a micrometre.
 */
export function etrf2020ToItrf2020(x, y, z, epoch, out = [0, 0, 0]) {
  return etrfRotate(x, y, z, epoch, -1, out);
}

// ---------- geoid / quasigeoid grids ------------------------------------------------------------------------
/**
 * Parse a NOAA .gtx grid (big-endian header: lat0, lon0, dlat, dlon in degrees, rows, cols; then rows×cols
 * float32 values, south row first). Used for EGM2008 / EGM96 and the national quasigeoids converted to .gtx.
 * @param {ArrayBuffer} buffer
 */
export function parseGtx(buffer) {
  const view = new DataView(buffer);
  const lat0 = view.getFloat64(0, false);
  const lon0 = view.getFloat64(8, false);
  const dLat = view.getFloat64(16, false);
  const dLon = view.getFloat64(24, false);
  const rows = view.getInt32(32, false);
  const cols = view.getInt32(36, false);
  const values = new Float32Array(rows * cols);
  for (let i = 0; i < values.length; i++) values[i] = view.getFloat32(40 + i * 4, false);
  return createGeoidGrid({ lat0, lon0, dLat, dLon, rows, cols, values });
}

/**
 * A regular lat/lon grid of geoid undulations N (m), south row first, west column first.
 * `-88.8888` is the conventional no-data value in .gtx files.
 */
export function createGeoidGrid({ lat0, lon0, dLat, dLon, rows, cols, values, noData = -88.8888 }) {
  const global = Math.abs(cols * dLon - 360) < 1e-9 || Math.abs((cols - 1) * dLon - 360) < 1e-9;
  return { lat0, lon0, dLat, dLon, rows, cols, values, noData, global };
}

/**
 * Bilinear undulation N (m) at a geodetic position (degrees). Returns null outside the grid or on no-data.
 * Ellipsoidal height h = orthometric/normal height H + N.
 */
export function sampleGeoidGrid(grid, latDeg, lonDeg) {
  const { lat0, lon0, dLat, dLon, rows, cols, values, noData, global } = grid;
  let fx = (lonDeg - lon0) / dLon;
  if (global) fx = ((fx % cols) + cols) % cols;
  const fy = (latDeg - lat0) / dLat;
  if (fy < 0 || fy > rows - 1 || fx < 0 || (!global && fx > cols - 1)) return null;
  const x0 = Math.min(Math.floor(fx), global ? cols - 1 : cols - 2);
  const y0 = Math.min(Math.floor(fy), rows - 2);
  const x1 = global ? (x0 + 1) % cols : x0 + 1;
  const tx = fx - x0;
  const ty = fy - y0;
  const v00 = values[y0 * cols + x0];
  const v10 = values[y0 * cols + x1];
  const v01 = values[(y0 + 1) * cols + x0];
  const v11 = values[(y0 + 1) * cols + x1];
  if ([v00, v10, v01, v11].some((v) => Math.abs(v - noData) < 1e-3)) return null;
  return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
}

// ---------- formatting helpers ----------------------------------------------------------------------------
/** Normalise a longitude in degrees to (-180, 180]. */
export function wrapLongitudeDeg(lonDeg) {
  let l = ((lonDeg + 180) % 360 + 360) % 360 - 180;
  if (l === -180) l = 180;
  return l;
}
