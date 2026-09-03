// Validates the axial-tilt climate module (src/sims/axial-tilt/climate.js):
// seasonal extremes, hemispheric symmetry, the habitable fraction across the
// tilt range (peak near Earth's tilt, frozen-pole minimum at 0°, hostile
// extremes at 90°), the verdict tiers and the temperature colour ramp.
import * as C from '../src/sims/axial-tilt/climate.js';
import { EARTH_TILT_DEG } from '../src/sims/axial-tilt/physics.js';

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
  console.log(`${ok ? '✔' : '✖'} ${label}: ${value.toFixed(2)} (expected ${lo} … ${hi})`);
};

console.log('— seasonal extremes —');
check('no seasonal swing at 0° tilt (45° lat)', C.seasonalExtremes(45, 0).swingK, 0, 1e-9);
assert('swing grows with tilt (45° lat)', (() => {
  let prev = -1;
  for (const tilt of [0, 10, 23.4, 45, 70, 90]) {
    const swing = C.seasonalExtremes(45, tilt).swingK;
    if (swing < prev) return false;
    prev = swing;
  }
  return true;
})());
between('Earth-tilt swing at 45° lat (K)', C.seasonalExtremes(45, EARTH_TILT_DEG).swingK, 15, 40);
between('Uranus-tilt swing at 45° lat (K)', C.seasonalExtremes(45, 90).swingK, 50, 100);

const north = C.seasonalExtremes(45, EARTH_TILT_DEG);
const south = C.seasonalExtremes(-45, EARTH_TILT_DEG);
check('hemispheric symmetry: summer', north.summerC, south.summerC, 1e-9);
check('hemispheric symmetry: winter', north.winterC, south.winterC, 1e-9);

console.log('— livability —');
assert('equator livable at Earth tilt', C.isLivable(C.seasonalExtremes(0, EARTH_TILT_DEG)));
assert('pole not livable at 0° tilt', !C.isLivable(C.seasonalExtremes(89, 0)));
assert('equator not livable at 90° tilt (too cold: low annual sun + high albedo)', !C.isLivable(C.seasonalExtremes(0, 90)));

console.log('— habitable fraction across the tilt range —');
const fEarth = C.habitableFraction(EARTH_TILT_DEG);
const fZero = C.habitableFraction(0);
const fUranus = C.habitableFraction(90);
between('fraction at Earth tilt', fEarth, 0.9, 1.0);
between('fraction at 0° tilt', fZero, 0.7, 0.95);
between('fraction at 90° tilt', fUranus, 0.2, 0.6);
assert('Earth tilt beats 0° tilt', fEarth > fZero);
assert('Earth tilt beats 90° tilt', fEarth > fUranus);
assert('0° tilt beats 90° tilt (frozen poles < global extremes)', fZero > fUranus);

let bestTilt = 0;
let bestFraction = -1;
for (let tilt = 0; tilt <= 90; tilt += 2.5) {
  const f = C.habitableFraction(tilt);
  if (f > bestFraction) {
    bestFraction = f;
    bestTilt = tilt;
  }
}
between('most livable tilt (deg)', bestTilt, 15, 40);
console.log(`  (peak: ${(bestFraction * 100).toFixed(0)}% at ${bestTilt}°, Earth ${(fEarth * 100).toFixed(0)}%, 0° ${(fZero * 100).toFixed(0)}%, 90° ${(fUranus * 100).toFixed(0)}%)`);

console.log('— livable bands —');
const bandsEarth = C.livableBands(EARTH_TILT_DEG);
assert('Earth tilt: one band covering the whole sphere', bandsEarth.length === 1 && C.bandsFraction(bandsEarth) > 0.95);
const bandsZero = C.livableBands(0);
assert('0° tilt: one mid band, poles excluded', bandsZero.length === 1 && bandsZero[0][0] > -80 && bandsZero[0][1] < 80);
check('0° tilt: band symmetric about the equator', bandsZero[0][0] + bandsZero[0][1], 0, 0.5);
const bandsUranus = C.livableBands(90);
assert('90° tilt: two bands, equator excluded', bandsUranus.length === 2 && !bandsUranus.some(([lo, hi]) => lo <= 0 && hi >= 0));
assert('90° tilt: one band per hemisphere', bandsUranus.some(([, hi]) => hi < 0) && bandsUranus.some(([lo]) => lo > 0));
for (const tilt of [0, 10, EARTH_TILT_DEG, 45, 60, 90]) {
  check(`bands area matches sampled fraction at ${tilt}°`, C.bandsFraction(C.livableBands(tilt)) - C.habitableFraction(tilt), 0, 0.03);
}

console.log('— verdict tiers —');
assert('0° → uniform', C.verdictFor(0) === 'uniform');
assert('23.4° → moderate', C.verdictFor(EARTH_TILT_DEG) === 'moderate');
assert('45° → severe', C.verdictFor(45) === 'severe');
assert('90° → extreme', C.verdictFor(90) === 'extreme');

console.log('— colour ramp —');
const validRgb = (c) => Array.isArray(c) && c.length === 3 && c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255);
assert('ramp endpoints are valid colours', validRgb(C.temperatureColor(-100)) && validRgb(C.temperatureColor(100)));
assert('cold end is blue-dominant', (() => { const [r, , b] = C.temperatureColor(C.TEMP_COLOR_RANGE_C.min); return b > r; })());
assert('hot end is red-dominant', (() => { const [r, , b] = C.temperatureColor(C.TEMP_COLOR_RANGE_C.max); return r > b; })());
assert('livable middle is green-dominant', (() => { const [r, g, b] = C.temperatureColor(10); return g > r && g > b; })());

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
