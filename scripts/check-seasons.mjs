// Validates the seasons physics (src/sims/seasons/physics.js) against textbook
// values: declination, day length (incl. polar day/night), daily and annual
// insolation, the calendar ↔ orbit mapping and sanity ranges of the
// temperature estimate.
import * as S from '../src/sims/seasons/physics.js';

let failed = 0;
const check = (label, actual, expected, tolerance) => {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failed++;
  console.log(`${ok ? '✔' : '✖'} ${label}: ${actual.toFixed(3)} (expected ${expected} ± ${tolerance})`);
};
const assert = (label, condition) => {
  if (!condition) failed++;
  console.log(`${condition ? '✔' : '✖'} ${label}`);
};
const between = (label, value, lo, hi) => {
  const ok = value >= lo && value <= hi;
  if (!ok) failed++;
  console.log(`${ok ? '✔' : '✖'} ${label}: ${value.toFixed(1)} (expected ${lo} … ${hi})`);
};

const TILT = S.EARTH_TILT_DEG;
const JUNE = 0;
const SEPTEMBER = 90;
const DECEMBER = 180;
const MARCH = 270;

console.log('— calendar ↔ orbit —');
for (const stop of S.SEASON_STOPS) {
  check(`orbit angle at ${stop.id} stop`, S.orbitAngleFromDay(stop.dayOfYear), stop.angleDeg, 1e-9);
  check(`day of year at ${stop.id} stop`, S.dayFromOrbitAngle(stop.angleDeg), stop.dayOfYear, 1e-9);
}
let roundTrip = 0;
for (let d = 0; d < 365.25; d += 0.25) roundTrip = Math.max(roundTrip, Math.abs(S.normalizeDay(S.dayFromOrbitAngle(S.orbitAngleFromDay(d)) - d + 100) - 100));
check('round trip day → angle → day (max error, days)', roundTrip, 0, 1e-6);
assert('orbit angle increases monotonically through the year', (() => {
  let prev = S.orbitAngleFromDay(78.5);
  for (let d = 79; d < 78.5 + 365; d += 1) {
    const a = S.orbitAngleFromDay(d);
    const diff = S.normalizeDeg(a - prev);
    if (diff <= 0 || diff > 2) return false;
    prev = a;
  }
  return true;
})());
assert('seasons: June solstice = northern summer / southern winter', S.seasonAt(JUNE).north === 'summer' && S.seasonAt(JUNE).south === 'winter');
assert('seasons: December solstice = northern winter / southern summer', S.seasonAt(DECEMBER).north === 'winter' && S.seasonAt(DECEMBER).south === 'summer');

console.log('— declination —');
check('declination at June solstice = tilt', S.declinationDeg(TILT, JUNE), TILT, 1e-9);
check('declination at December solstice = −tilt', S.declinationDeg(TILT, DECEMBER), -TILT, 1e-9);
check('declination at September equinox', S.declinationDeg(TILT, SEPTEMBER), 0, 1e-9);
check('declination at March equinox', S.declinationDeg(TILT, MARCH), 0, 1e-9);
check('declination with 0° tilt is always 0', S.declinationDeg(0, 37), 0, 1e-12);
check('declination with 90° tilt at solstice', S.declinationDeg(90, JUNE), 90, 1e-9);

console.log('— day length (24 h rotation) —');
const dJune = S.declinationDeg(TILT, JUNE);
const dDec = S.declinationDeg(TILT, DECEMBER);
check('equator, June solstice', S.dayLengthHours(0, dJune, 24), 12, 1e-9);
check('45° N, June solstice (geometric, no refraction)', S.dayLengthHours(45, dJune, 24), 15.43, 0.05);
check('45° N, December solstice', S.dayLengthHours(45, dDec, 24), 8.57, 0.05);
const polarCircle = 90 - TILT;
check(`polar circle (${polarCircle.toFixed(1)}° N), June solstice → polar day`, S.dayLengthHours(polarCircle, dJune, 24), 24, 1e-9);
check(`polar circle (${polarCircle.toFixed(1)}° N), December solstice → polar night`, S.dayLengthHours(polarCircle, dDec, 24), 0, 1e-9);
check(`polar circle (${polarCircle.toFixed(1)}° S), June solstice → polar night`, S.dayLengthHours(-polarCircle, dJune, 24), 0, 1e-9);
check('66.5° N, June solstice (0.1° inside the circle): almost a full day', S.dayLengthHours(66.5, dJune, 24), 23.25, 0.05);
check('66.5° N with 30° tilt, June solstice → polar day', S.dayLengthHours(66.5, S.declinationDeg(30, JUNE), 24), 24, 1e-9);
check('66.5° N with 30° tilt, December solstice → polar night', S.dayLengthHours(66.5, S.declinationDeg(30, DECEMBER), 24), 0, 1e-9);
check('90° N, June solstice → polar day', S.dayLengthHours(90, dJune, 24), 24, 1e-9);
check('90° N, December solstice → polar night', S.dayLengthHours(90, dDec, 24), 0, 1e-9);
check('90° N at the equinox: Sun on the horizon (½)', S.dayFraction(90, 0), 0.5, 1e-9);
assert('every latitude has a 12 h day at the equinox', [-90, -60, -30, 0, 30, 60, 90].every((lat) => Math.abs(S.dayLengthHours(lat, 0, 24) - 12) < 1e-9));
assert('0° tilt: 12 h days everywhere all year', [0, 90, 180, 270].every((a) => [0, 45, 66.5, 89].every((lat) => Math.abs(S.dayLengthHours(lat, S.declinationDeg(0, a), 24) - 12) < 1e-9)));
assert('90° tilt at solstice: polar day everywhere north of the equator', [1, 30, 60, 89].every((lat) => S.dayFraction(lat, S.declinationDeg(90, JUNE)) >= 1 - 1e-9));
check('rotation period scales the day length (45° N, June, 300 h)', S.dayLengthHours(45, dJune, 300), 15.43 * 12.5, 0.6);

console.log('— polar day / night statistics —');
const poleStats = S.polarDays(90, TILT);
between('midnight-sun days at the pole', poleStats.midnightSun, 176, 190);
between('polar-night days at the pole', poleStats.polarNight, 172, 186);
const circleStats = S.polarDays(70, TILT);
between('midnight-sun days at 70° N', circleStats.midnightSun, 50, 80);
between('polar-night days at 70° N', circleStats.polarNight, 45, 75);
const noStats = S.polarDays(45, TILT);
assert('no polar day/night at 45° N', noStats.midnightSun === 0 && noStats.polarNight === 0);
assert('0° tilt: no polar day/night anywhere', S.polarDays(89.9, 0).midnightSun === 0 && S.polarDays(89.9, 0).polarNight === 0);

console.log('— insolation (S₀ = 1361 W/m²) —');
check('equator at the equinox = S₀/π', S.dailyInsolation(0, 0), S.SOLAR_CONSTANT_W_M2 / Math.PI, 1e-6);
check('pole at the June solstice = S₀ · sin δ', S.dailyInsolation(90, dJune), S.SOLAR_CONSTANT_W_M2 * Math.sin((dJune * Math.PI) / 180), 1e-6);
check('pole at the December solstice = 0', S.dailyInsolation(90, dDec), 0, 1e-9);
assert('pole receives more than the equator on the June solstice', S.dailyInsolation(90, dJune) > S.dailyInsolation(0, dJune));
check('annual mean at the equator', S.annualMeanInsolation(0, TILT), 416, 4);
check('annual mean at the poles', S.annualMeanInsolation(90, TILT), 173, 4);
check('annual mean at 45° N', S.annualMeanInsolation(45, TILT), 307, 4);
assert('90° tilt: poles get more energy per year than the equator', S.annualMeanInsolation(90, 90) > S.annualMeanInsolation(0, 90));
const globalMean = (() => {
  let sum = 0;
  let weight = 0;
  for (let lat = -89.5; lat < 90; lat += 1) {
    const w = Math.cos((lat * Math.PI) / 180);
    sum += S.annualMeanInsolation(lat, TILT, 90) * w;
    weight += w;
  }
  return sum / weight;
})();
check('global annual mean = S₀/4', globalMean, S.SOLAR_CONSTANT_W_M2 / 4, 1.5);

console.log('— climate zones —');
assert('20° N is tropical at 23.4° tilt', S.climateZone(20, TILT) === 'tropical');
assert('45° N is temperate at 23.4° tilt', S.climateZone(45, TILT) === 'temperate');
assert('70° N is polar at 23.4° tilt', S.climateZone(70, TILT) === 'polar');
assert('45° N is "extreme" at 50° tilt (zenith sun and polar night)', S.climateZone(45, 50) === 'extreme');
assert('60° N is polar at 50° tilt', S.climateZone(60, 50) === 'polar');
assert('45° N is temperate at 0° tilt', S.climateZone(45, 0) === 'temperate');

console.log('— temperature estimate (sanity ranges) —');
check('global mean temperature of the model', S.GLOBAL_MEAN_C, 15, 1);
const T = (lat, tilt, angle, period = 24) => S.temperatureEstimate(lat, tilt, S.declinationDeg(tilt, angle), period);
between('equator, equinox, mean', T(0, TILT, MARCH).meanC, 20, 32);
between('45° N, June solstice, mean', T(45, TILT, JUNE).meanC, 15, 30);
between('45° N, December solstice, mean', T(45, TILT, DECEMBER).meanC, -12, 8);
between('North Pole, June solstice, mean', T(90, TILT, JUNE).meanC, -8, 8);
between('North Pole, December solstice, mean', T(90, TILT, DECEMBER).meanC, -35, -12);
assert('polar albedo is ice-like', T(90, TILT, JUNE).albedo > 0.55);
assert('0° tilt: temperature does not change through the year', Math.abs(T(45, 0, JUNE).meanC - T(45, 0, DECEMBER).meanC) < 1e-9);
assert('90° tilt: the pole swings by more than 60 K over the year', T(90, 90, JUNE).meanC - T(90, 90, DECEMBER).meanC > 60);
const slow = T(0, TILT, MARCH, 300);
assert(`300 h rotation: day–night swing at the equator ≥ 40 K (${slow.swingK.toFixed(1)} K)`, slow.swingK >= 40);
assert('6 h rotation: day–night swing is smaller than at 24 h', T(0, TILT, MARCH, 6).swingK < T(0, TILT, MARCH, 24).swingK);
check('no day–night swing during polar day', S.diurnalSwingK(90, dJune, 24), 0, 1e-9);
check('no day–night swing during polar night', S.diurnalSwingK(90, dDec, 24), 0, 1e-9);

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
