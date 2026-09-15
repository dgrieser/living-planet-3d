// Validates the axial-tilt climate module (src/sims/axial-tilt/climate.js):
// seasonal extremes, hemispheric symmetry, the habitable fraction across the
// tilt range (peak near Earth's tilt, frozen-pole minimum at 0°, hostile
// extremes at 90°), the verdict tiers, the temperature colour ramp and the
// overlay opacity that keeps livable temperatures faint on the globe, and the
// surface conditions (snow, sea ice, dormant / parched land, drying seas, city
// lights) that the Earth shader paints from the same ramps.
import * as C from '../src/sims/axial-tilt/climate.js';
import * as S from '../src/sims/axial-tilt/physics.js';
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

console.log('— overlay opacity —');
const { minAlpha } = C.OVERLAY_FADE;
check('a lived-in 15 °C is barely painted', C.temperatureOverlayAlpha(15), minAlpha, 1e-9);
check('the comfort window is flat at both ends', C.temperatureOverlayAlpha(-10), C.temperatureOverlayAlpha(30), 1e-9);
check('the cold livable limit paints full', C.temperatureOverlayAlpha(C.LIVABLE.minWinterC), 1, 1e-9);
check('the hot livable limit paints full', C.temperatureOverlayAlpha(C.LIVABLE.maxSummerC), 1, 1e-9);
check('off the cold end of the ramp stays full', C.temperatureOverlayAlpha(-100), 1, 1e-9);
check('off the hot end of the ramp stays full', C.temperatureOverlayAlpha(100), 1, 1e-9);
assert('the comfortable middle is far more transparent than the ends', C.temperatureOverlayAlpha(15) < 0.5 * C.temperatureOverlayAlpha(-40));
assert('opacity rises monotonically towards the cold end', (() => {
  let prev = -1;
  for (let tempC = -10; tempC >= -40; tempC -= 1) {
    const a = C.temperatureOverlayAlpha(tempC);
    if (a < prev - 1e-12) return false;
    prev = a;
  }
  return true;
})());
assert('opacity rises monotonically towards the hot end', (() => {
  let prev = -1;
  for (let tempC = 30; tempC <= 60; tempC += 1) {
    const a = C.temperatureOverlayAlpha(tempC);
    if (a < prev - 1e-12) return false;
    prev = a;
  }
  return true;
})());
assert('every temperature stays within [minAlpha, 1]', (() => {
  for (let tempC = -80; tempC <= 100; tempC += 0.5) {
    const a = C.temperatureOverlayAlpha(tempC);
    if (!(a >= minAlpha - 1e-12 && a <= 1 + 1e-12)) return false;
  }
  return true;
})());
assert('the ramp-coordinate form matches the °C form', Math.abs(C.overlayAlpha(0.5) - C.temperatureOverlayAlpha(10)) < 1e-12);

console.log('— surface conditions —');
const surf = (lat, tilt, angleDeg) => C.surfaceState(lat, tilt, S.declinationDeg(tilt, angleDeg));
const JUNE = 0;
const SEPT = 90;
const DEC = 180;
assert('permanent ice matches the albedo ramp', (() => {
  for (let q = 100; q <= 450; q += 10) {
    const expected = S.EBM.albedo + (S.EBM.albedoIce - S.EBM.albedo) * S.iceCoverFraction(q);
    if (Math.abs(S.albedoFor(q) - expected) > 1e-12) return false;
  }
  return true;
})());
assert('every factor stays within [0, 1] over a latitude / tilt / season grid', (() => {
  for (const tilt of [0, 10, 23.4, 45, 70, 90]) {
    for (let angle = 0; angle < 360; angle += 45) {
      for (let lat = -90; lat <= 90; lat += 7.5) {
        const state = surf(lat, tilt, angle);
        for (const [key, v] of Object.entries(state)) if (!key.endsWith('C') && !(v >= 0 && v <= 1)) return false;
      }
    }
  }
  return true;
})());
// Earth's tilt at the June solstice: ice caps at both poles, winter snow and pack ice in the south, the
// northern summer snow-free below the Arctic, nothing parched, lights everywhere
between('permanent ice at the pole (Earth tilt)', surf(89.5, EARTH_TILT_DEG, JUNE).permIce, 0.9, 1);
check('no permanent ice at the equator (Earth tilt)', surf(0, EARTH_TILT_DEG, JUNE).permIce, 0, 1e-9);
assert('permanent ice grows towards the pole (Earth tilt)', (() => {
  let prev = -1;
  for (let lat = 0; lat <= 89.5; lat += 2.5) {
    const ice = surf(lat, EARTH_TILT_DEG, JUNE).permIce;
    if (ice < prev - 1e-12) return false;
    prev = ice;
  }
  return true;
})());
between('June: southern winter snow at 60° S', surf(-60, EARTH_TILT_DEG, JUNE).snow, 0.9, 1);
between('June: southern winter sea ice at 60° S', surf(-60, EARTH_TILT_DEG, JUNE).seaIce, 0.9, 1);
between('June: no snow at 60° N', surf(60, EARTH_TILT_DEG, JUNE).snow, 0, 0.05);
between('June: no sea ice at 45° S yet', surf(-45, EARTH_TILT_DEG, JUNE).seaIce, 0, 0.1);
between('June: the Arctic pack survives the summer (permanent ice floor)', surf(85, EARTH_TILT_DEG, JUNE).seaIce, 0.5, 1);
between('June: dormant land in the southern winter at 45° S', surf(-45, EARTH_TILT_DEG, JUNE).dormant, 0.5, 1);
check('nothing parched anywhere at Earth tilt', Math.max(...[-90, -60, -30, 0, 30, 60, 90].map((lat) => surf(lat, EARTH_TILT_DEG, JUNE).parch)), 0, 1e-9);
check('December mirrors June across the equator (snow)', surf(60, EARTH_TILT_DEG, DEC).snow, surf(-60, EARTH_TILT_DEG, JUNE).snow, 1e-9);
check('lights on at 60° N (Earth tilt)', surf(60, EARTH_TILT_DEG, JUNE).lights, 1, 1e-9);
check('Earth keeps its Arctic cap (no thaw at the pole)', surf(89.5, EARTH_TILT_DEG, JUNE).thaw, 0, 1e-9);
check('Earth keeps Antarctica (no thaw at 75° S)', surf(-75, EARTH_TILT_DEG, DEC).thaw, 0, 1e-9);
between('Earth: the far south of Greenland barely thaws (annual mean ≈ 3 °C at 60° N)', surf(60, EARTH_TILT_DEG, JUNE).thaw, 0, 0.2);
// no tilt: permanent caps, no seasons, no lights beyond the livable edge
between('tilt 0: permanent ice at both poles', Math.min(surf(89.5, 0, JUNE).permIce, surf(-89.5, 0, JUNE).permIce), 0.99, 1);
check('tilt 0: no lights at 75°', surf(75, 0, JUNE).lights, 0, 1e-9);
check('tilt 0: lights at the equator', surf(0, 0, JUNE).lights, 1, 1e-9);
check('tilt 0: June equals December (no seasons)', surf(60, 0, JUNE).snow, surf(60, 0, DEC).snow, 1e-9);
check('tilt 0: the caps do not thaw', surf(89.5, 0, JUNE).thaw, 0, 1e-9);
// a tilt of 45°: the poles average +11 °C over the year – the ice sheets are gone
check('tilt 45: the caps have melted', surf(89.5, 45, JUNE).thaw, 1, 1e-9);
check('tilt 45: no permanent ice anywhere', Math.max(...[-89.5, -60, 0, 60, 89.5].map((lat) => surf(lat, 45, JUNE).permIce)), 0, 1e-9);
// Uranus-like tilt at the June solstice: the sunlit hemisphere parches and its seas fall dry, the dark one freezes,
// the equator is iced over and the lights survive only in the mid-latitude bands
check('tilt 90 June: 60° N parched', surf(60, 90, JUNE).parch, 1, 1e-9);
between('tilt 90 June: 60° N seas falling dry', surf(60, 90, JUNE).dry, 0.9, 1);
check('tilt 90 June: the pole dry', surf(89.5, 90, JUNE).dry, 1, 1e-9);
between('tilt 90 June: the equator frozen', surf(0, 90, JUNE).seaIce, 0.9, 1);
between('tilt 90 June: snow at 60° S', surf(-60, 90, JUNE).snow, 0.3, 1);
check('tilt 90: no lights at the equator', surf(0, 90, JUNE).lights, 0, 1e-9);
between('tilt 90: lights in the 7–34° band', surf(20, 90, JUNE).lights, 0.5, 1);
check('tilt 90: lights are hemispherically symmetric', surf(20, 90, JUNE).lights, surf(-20, 90, JUNE).lights, 1e-9);
// long polar nights: with the Sun gone nothing melts by day, so the pack closes just under the freezing point
between('tilt 90 June: the dark pole freezes over (−4.5 °C, six months of night)', surf(-89.5, 90, JUNE).seaIce, 0.85, 1);
between('tilt 70 December: the dark pole freezes over', surf(89.5, 70, DEC).seaIce, 0.85, 1);
check('polar night: darkness is 1 without sunshine', C.seaIceDarkness(0), 1, 1e-9);
check('polar night: darkness is 0 in daily sunshine', C.seaIceDarkness(200), 0, 1e-9);
check('the pack closes at darkFullC in polar night', C.seaIceFullC(1), C.SURFACE.seaIce.darkFullC, 1e-12);
check('the pack closes at fullC under the Sun', C.seaIceFullC(0), C.SURFACE.seaIce.fullC, 1e-12);
between('Earth tilt: no sea ice at 45° S in June despite the ramp change', surf(-45, EARTH_TILT_DEG, JUNE).seaIce, 0, 0.1);
check('tilt 90 equinox: nothing dry', Math.max(...[-60, 0, 60].map((lat) => surf(lat, 90, SEPT).dry)), 0, 1e-9);
check('tilt 90 equinox: nothing parched', Math.max(...[-60, 0, 60].map((lat) => surf(lat, 90, SEPT).parch)), 0, 1e-9);
assert('the texture encoding is monotone and clamped', (() => {
  let prev = -1;
  for (let tempC = -100; tempC <= 140; tempC += 1) {
    const e = C.encodeSurfaceTemp(tempC);
    if (e < prev || e < 0 || e > 1) return false;
    prev = e;
  }
  return C.encodeSurfaceTemp(C.SURFACE.tempRangeC.min) === 0 && C.encodeSurfaceTemp(C.SURFACE.tempRangeC.max) === 1;
})());
check('parched is complete exactly at the livable summer limit', C.SURFACE.parch.fullC, C.LIVABLE.maxSummerC, 1e-12);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
