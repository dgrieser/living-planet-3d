// Validates the Living Earth ephemeris (src/sims/earth/ephemeris.js) against JPL Horizons:
// topocentric Sun and Moon positions for Lübbecke and Nordby (Fanø) within 1′ (astronomy-engine's
// documented accuracy), sunrise/sunset within ±30 s, the Moon's illuminated fraction, and the
// consistency of the Earth-fixed (ECEF) vectors the renderer lights the globe with.
//
// Reference values: JPL Horizons API (ssd.jpl.nasa.gov/api/horizons.api), fetched 2026-10-31.
// Positions: OBSERVER ephemeris, CENTER='coord@399', COORD_TYPE='GEODETIC', QUANTITIES='4',
// APPARENT='AIRLESS' (no refraction), TIME_TYPE='UT'. Rise/set: 1-minute airless Sun elevations,
// linearly interpolated to the −50′ crossing (34′ refraction + 16′ semi-diameter) – the same
// convention astronomy-engine's SearchRiseSet uses. Illuminated fraction: QUANTITIES='10', geocentric.
import * as E from '../src/sims/earth/ephemeris.js';

let failed = 0;
const check = (label, actual, expected, tolerance, unit = '') => {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failed++;
  console.log(`${ok ? '✔' : '✖'} ${label}: ${Number(actual.toPrecision(7))}${unit} (expected ${expected}${unit} ± ${tolerance}${unit})`);
};
const assert = (label, condition) => {
  if (!condition) failed++;
  console.log(`${condition ? '✔' : '✖'} ${label}`);
};

const SITES = {
  luebbecke: { lonDeg: 8.6176, latDeg: 52.3069, heightM: 60 }, // Lübbecke, north of the old town
  nordby: { lonDeg: 8.399, latDeg: 55.4446, heightM: 5 }, // Nordby, Fanø
};

// [site, body, UTC, azimuth°, altitude°] – Horizons, airless apparent topocentric
const POSITIONS = [
  ['luebbecke', 'sun', '2026-03-20T06:00:00Z', 95.431016701, 3.998420209],
  ['luebbecke', 'sun', '2026-06-21T12:00:00Z', 195.323767103, 60.462239331],
  ['luebbecke', 'sun', '2026-09-23T17:30:00Z', 272.237589193, -2.087044122],
  ['luebbecke', 'sun', '2026-12-21T08:15:00Z', 137.627825354, 3.835981261],
  ['luebbecke', 'sun', '2026-10-31T21:00:00Z', 313.841853463, -44.155711475],
  ['luebbecke', 'sun', '2000-01-01T12:00:00Z', 187.405180514, 14.350326233],
  ['luebbecke', 'sun', '2010-07-15T03:45:00Z', 56.312048425, 2.050350867],
  ['luebbecke', 'sun', '2045-02-11T15:20:00Z', 233.687739032, 8.735197295],
  ['luebbecke', 'moon', '2026-03-20T06:00:00Z', 79.469040055, 2.129160872],
  ['luebbecke', 'moon', '2026-06-21T12:00:00Z', 100.730735464, 7.313848882],
  ['luebbecke', 'moon', '2026-09-23T17:30:00Z', 127.592851354, 8.641821433],
  ['luebbecke', 'moon', '2026-12-21T08:15:00Z', 355.149603519, -15.521731705],
  ['luebbecke', 'moon', '2026-10-31T21:00:00Z', 56.879159676, 3.887175474],
  ['luebbecke', 'moon', '2000-01-01T12:00:00Z', 244.814602724, 4.178029355],
  ['luebbecke', 'moon', '2010-07-15T03:45:00Z', 22.20816893, -32.204544176],
  ['luebbecke', 'moon', '2045-02-11T15:20:00Z', 271.295654322, -38.367540696],
  ['nordby', 'sun', '2026-03-20T06:00:00Z', 95.460430704, 3.572241013],
  ['nordby', 'sun', '2026-06-21T12:00:00Z', 193.635723131, 57.45600094],
  ['nordby', 'sun', '2026-09-23T17:30:00Z', 272.168111776, -1.837591694],
  ['nordby', 'sun', '2026-12-21T08:15:00Z', 137.544300045, 1.432266391],
  ['nordby', 'sun', '2026-10-31T21:00:00Z', 315.659388934, -41.854625901],
  ['nordby', 'sun', '2000-01-01T12:00:00Z', 187.109386471, 11.25399535],
  ['nordby', 'sun', '2010-07-15T03:45:00Z', 56.269897248, 3.684789789],
  ['nordby', 'sun', '2045-02-11T15:20:00Z', 233.152847339, 6.968490201],
  ['nordby', 'moon', '2026-03-20T06:00:00Z', 79.473897802, 2.576223231],
  ['nordby', 'moon', '2026-06-21T12:00:00Z', 100.978116768, 6.594798042],
  ['nordby', 'moon', '2026-09-23T17:30:00Z', 127.77788414, 6.617009314],
  ['nordby', 'moon', '2026-12-21T08:15:00Z', 355.005471954, -12.397701089],
  ['nordby', 'moon', '2026-10-31T21:00:00Z', 56.970909785, 5.494109195],
  ['nordby', 'moon', '2000-01-01T12:00:00Z', 244.412046037, 2.947788599],
  ['nordby', 'moon', '2010-07-15T03:45:00Z', 21.293329318, -29.363337757],
  ['nordby', 'moon', '2045-02-11T15:20:00Z', 273.523491483, -38.109257707],
];

// [site, local date, sunrise UTC, sunset UTC] – Horizons −50′ crossings
const RISE_SET = [
  ['luebbecke', '2026-03-20', '2026-03-20T05:28:24.049Z', '2026-03-20T17:38:34.625Z'],
  ['luebbecke', '2026-06-21', '2026-06-21T03:03:30.864Z', '2026-06-21T19:51:09.761Z'],
  ['luebbecke', '2026-12-21', '2026-12-21T07:32:55.374Z', '2026-12-21T15:14:14.125Z'],
  ['nordby', '2026-03-20', '2026-03-20T05:28:56.811Z', '2026-03-20T17:39:54.434Z'],
  ['nordby', '2026-06-21', '2026-06-21T02:43:44.796Z', '2026-06-21T20:12:40.701Z'],
  ['nordby', '2026-12-21', '2026-12-21T07:52:18.770Z', '2026-12-21T14:56:35.653Z'],
];

// [UTC, illuminated fraction %] – Horizons, geocentric
const ILLUMINATION = [
  ['2026-03-20T06:00:00Z', 1.93611],
  ['2026-06-21T12:00:00Z', 45.83584],
  ['2026-09-23T17:30:00Z', 90.52949],
  ['2026-12-21T08:15:00Z', 89.18365],
  ['2026-10-31T21:00:00Z', 61.14229],
  ['2000-01-01T12:00:00Z', 23.00638],
];

const DEG = Math.PI / 180;
/** Great-circle separation of two horizontal directions, arcminutes. */
function separationArcmin(az1, alt1, az2, alt2) {
  const a = Math.sin(alt1 * DEG) * Math.sin(alt2 * DEG) + Math.cos(alt1 * DEG) * Math.cos(alt2 * DEG) * Math.cos((az1 - az2) * DEG);
  return (Math.acos(Math.min(1, Math.max(-1, a))) / DEG) * 60;
}

console.log('— topocentric Sun & Moon vs. JPL Horizons (≤ 1′) —');
let worst = { sun: 0, moon: 0 };
for (const [site, body, utc, az, alt] of POSITIONS) {
  const s = SITES[site];
  const p = E.topocentric(body, new Date(utc), s.latDeg, s.lonDeg, s.heightM);
  const sep = separationArcmin(p.azimuthDeg, p.altitudeDeg, az, alt);
  worst[body] = Math.max(worst[body], sep);
  check(`${body} ${site} ${utc}`, sep, 0, 1, '′');
}
console.log(`  worst separation: Sun ${worst.sun.toFixed(3)}′, Moon ${worst.moon.toFixed(3)}′`);

console.log('— sunrise / sunset vs. Horizons (±30 s) —');
for (const [site, date, rise, set] of RISE_SET) {
  const s = SITES[site];
  // search from local midnight (CET, UTC+1) – early enough for both events of the day in either season
  const dayStart = new Date(`${date}T00:00:00+01:00`);
  const r = E.riseSet('sun', dayStart, s.latDeg, s.lonDeg, s.heightM);
  check(`sunrise ${site} ${date} (s)`, (r.rise - new Date(rise)) / 1000, 0, 30, ' s');
  check(`sunset ${site} ${date} (s)`, (r.set - new Date(set)) / 1000, 0, 30, ' s');
}
assert('polar night: no sunrise at 78° N on 21 Dec', E.riseSet('sun', new Date('2026-12-21T00:00:00Z'), 78, 15).rise === null);
assert('midnight sun: no sunset at 78° N on 21 Jun', E.riseSet('sun', new Date('2026-06-21T00:00:00Z'), 78, 15).set === null);

console.log('— Moon phase —');
for (const [utc, pct] of ILLUMINATION) check(`illuminated fraction ${utc} (%)`, E.moonPhase(new Date(utc)).fraction * 100, pct, 0.1, '%');
assert('principal phases are instants (±6.5°), the rest crescent/gibbous', E.moonPhaseName(0) === 'new' && E.moonPhaseName(359) === 'new' && E.moonPhaseName(45) === 'waxingCrescent' && E.moonPhaseName(90) === 'firstQuarter' && E.moonPhaseName(120) === 'waxingGibbous' && E.moonPhaseName(180) === 'full' && E.moonPhaseName(250) === 'waningGibbous' && E.moonPhaseName(270) === 'lastQuarter' && E.moonPhaseName(300) === 'waningCrescent');
assert('2026-06-21 12:00 UTC is first quarter (Horizons: 45.8 % lit)', E.moonPhase(new Date('2026-06-21T12:00:00Z')).name === 'firstQuarter');
assert('2026-10-31 21:00 UTC is waning gibbous (Horizons: 61.1 % lit)', E.moonPhase(new Date('2026-10-31T21:00:00Z')).name === 'waningGibbous');

console.log('— Earth-fixed vectors agree with the topocentric answer —');
// The ECEF Sun direction, seen from the site's local up vector, must reproduce the altitude (to the
// parallax of the Sun, 8.8″, i.e. well inside 0.01°).
for (const [site, body, utc, , alt] of POSITIONS.filter((p) => p[1] === 'sun').slice(0, 8)) {
  const s = SITES[site];
  const lat = s.latDeg * DEG;
  const lon = s.lonDeg * DEG;
  const up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const dir = E.bodyEcef(body, new Date(utc)).direction;
  const altFromEcef = Math.asin(up[0] * dir[0] + up[1] * dir[1] + up[2] * dir[2]) / DEG;
  check(`sun altitude from the ECEF vector ${site} ${utc} (°)`, altFromEcef, alt, 0.01, '°');
}
const subsolar = E.subBodyPoint(E.bodyEcef('sun', new Date('2026-06-21T08:24:00Z')).direction);
check('subsolar latitude at the June solstice 2026-06-21 08:24 UTC (°)', subsolar.latDeg, 23.436, 0.01, '°');
const moonDist = E.bodyEcef('moon', new Date('2026-06-21T12:00:00Z')).distance / 1000;
assert(`Moon distance within the perigee/apogee range (${moonDist.toFixed(0)} km)`, moonDist > 356000 && moonDist < 407000);
const m = E.eqjToEcefMatrix(new Date('2026-06-21T12:00:00Z'));
let orth = 0;
for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) orth = Math.max(orth, Math.abs(m[i][0] * m[j][0] + m[i][1] * m[j][1] + m[i][2] * m[j][2] - (i === j ? 1 : 0)));
check('EQJ → ECEF matrix is orthonormal (max deviation)', orth, 0, 1e-12);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
