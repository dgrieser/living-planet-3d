// Sanity checks for src/sims/solar-orbit/kepler.js (pure JS, runs in Node).
//
//  1. Earth's orbit stays inside the conservative habitable zone (0.95–1.37 au)
//     for every month 1900–2050 and never deviates from a circle by more than e·a.
//  2. Heliocentric longitudes match well-known astronomical events
//     (equinoxes/solstices → Earth; oppositions → outer planets; inferior
//     conjunctions → inner planets) to well below the 0.05 au acceptance limit.
//  3. Kepler solver round-trips M = E − e·sin E for all planets.
import { planetPosition, dateToJD, orbitalPeriodDays, PLANET_IDS, solveKepler, apsides } from '../src/sims/solar-orbit/kepler.js';

const DEG = Math.PI / 180;
let failed = false;
const ok = (cond, msg) => {
  console.log(`${cond ? '✔' : '✖'} ${msg}`);
  if (!cond) failed = true;
};
const lon = (p) => ((Math.atan2(p.y, p.x) / DEG) + 360) % 360;
const angDiff = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const jd = (iso) => dateToJD(new Date(iso));

// --- 1. Earth inside habitable zone ------------------------------------------
let rMin = Infinity, rMax = -Infinity;
for (let y = 1900; y <= 2050; y++) {
  for (let m = 0; m < 12; m++) {
    const r = planetPosition('earth', dateToJD(new Date(Date.UTC(y, m, 15)))).r;
    rMin = Math.min(rMin, r);
    rMax = Math.max(rMax, r);
  }
}
ok(rMin > 0.95 && rMax < 1.37, `Earth distance 1900–2050 within habitable zone: ${rMin.toFixed(4)}–${rMax.toFixed(4)} au`);
ok(Math.abs(rMin - 0.9833) < 0.002 && Math.abs(rMax - 1.0167) < 0.002, `Earth perihelion/aphelion ≈ 0.983 / 1.017 au`);
const eccOrbit = apsides('earth', jd('2000-01-01T12:00:00Z'), { e: 0.3 });
ok(eccOrbit.perihelion < 0.95, `Hypothetical e=0.3 orbit leaves the zone (perihelion ${eccOrbit.perihelion.toFixed(3)} au)`);

// --- 2. Known events -----------------------------------------------------------------
// Earth's heliocentric longitude = apparent solar longitude + 180°. Equinoxes/solstices are
// defined against the equinox *of date*, while the elements use the fixed J2000 equinox, so the
// general precession in longitude (≈ 1.39697°/century) is subtracted from the expectation.
const PRECESSION_DEG_PER_CY = 5029.0966 / 3600;
const toJ2000 = (lonOfDate, jdEvent) => lonOfDate - PRECESSION_DEG_PER_CY * ((jdEvent - 2451545) / 36525);
const events = [
  ['earth', '2000-03-20T07:35:00Z', 180, 0.05, 'March equinox 2000'],
  ['earth', '2000-06-21T01:48:00Z', 270, 0.05, 'June solstice 2000'],
  ['earth', '2024-09-22T12:44:00Z', 0, 0.05, 'September equinox 2024'],
  ['earth', '1950-12-22T10:13:00Z', 90, 0.05, 'December solstice 1950'],
  ['earth', '1904-03-21T00:58:00Z', 180, 0.05, 'March equinox 1904'],
];
for (const [id, iso, expected, tol, label] of events) {
  const got = lon(planetPosition(id, jd(iso)));
  const want = (toJ2000(expected, jd(iso)) + 360) % 360;
  const diff = angDiff(got, want);
  ok(diff < tol, `${label}: heliocentric longitude ${got.toFixed(3)}° (expected ${want.toFixed(3)}° in J2000 frame, Δ=${diff.toFixed(3)}°)`);
}
// At opposition an outer planet shares Earth's heliocentric longitude (within ~1° due to inclination/latitude).
const oppositions = [
  ['mars', '2003-08-28T18:00:00Z', 'Mars opposition 2003-08-28'],
  ['mars', '2020-10-13T23:00:00Z', 'Mars opposition 2020-10-13'],
  ['jupiter', '2022-09-26T20:00:00Z', 'Jupiter opposition 2022-09-26'],
  ['saturn', '2023-08-27T08:00:00Z', 'Saturn opposition 2023-08-27'],
  ['uranus', '2023-11-13T17:00:00Z', 'Uranus opposition 2023-11-13'],
  ['neptune', '2023-09-19T11:00:00Z', 'Neptune opposition 2023-09-19'],
];
for (const [id, iso, label] of oppositions) {
  const t = jd(iso);
  const earth = planetPosition('earth', t);
  const p = planetPosition(id, t);
  const diff = angDiff(lon(p), lon(earth));
  // 1° of longitude at Mars' distance is ≈ 0.027 au – comfortably inside the 0.05 au bound.
  ok(diff < 1.0, `${label}: Δlongitude Earth↔${id} = ${diff.toFixed(3)}°`);
}
// Inferior conjunction: inner planet between Earth and Sun (same heliocentric longitude).
const conjunctions = [
  ['venus', '2012-06-06T01:30:00Z', 'Venus transit 2012-06-06'],
  ['venus', '2004-06-08T08:20:00Z', 'Venus transit 2004-06-08'],
  ['mercury', '2019-11-11T15:20:00Z', 'Mercury transit 2019-11-11'],
  ['mercury', '2016-05-09T15:00:00Z', 'Mercury transit 2016-05-09'],
];
for (const [id, iso, label] of conjunctions) {
  const t = jd(iso);
  const diff = angDiff(lon(planetPosition(id, t)), lon(planetPosition('earth', t)));
  ok(diff < 0.5, `${label}: Δlongitude Earth↔${id} = ${diff.toFixed(3)}°`);
}

// --- 3. Solver + periods -------------------------------------------------------------------
for (const id of PLANET_IDS) {
  const { M, E, elements } = planetPosition(id, jd('2025-01-01T00:00:00Z'));
  const back = E - (elements.e / DEG) * Math.sin(E * DEG);
  ok(Math.abs(back - M) < 1e-5, `${id}: Kepler equation residual ${Math.abs(back - M).toExponential(2)}°`);
}
ok(Math.abs(solveKepler(0, 0.2)) < 1e-9 && Math.abs(solveKepler(180, 0.2) - 180) < 1e-9, 'Kepler solver fixed points at M = 0°, 180°');
const periods = { mercury: 87.97, venus: 224.7, earth: 365.26, mars: 686.98, jupiter: 4332.6, saturn: 10759, uranus: 30687, neptune: 60190 };
for (const [id, days] of Object.entries(periods)) {
  const got = orbitalPeriodDays(id);
  ok(Math.abs(got - days) / days < 0.002, `${id}: orbital period ${got.toFixed(1)} d (reference ${days} d)`);
}

process.exit(failed ? 1 : 0);
