// Validates the Moon & tides physics (src/sims/moon-tides/physics.js): tidal
// acceleration and equilibrium bulge height against textbook values, the 1/r³
// distance scaling, the solar/lunar ratio, spring/neap ranges, orbital periods
// and the ranges of the (schematic) axis-stability models.
import * as P from '../src/sims/moon-tides/physics.js';

let failed = 0;
const check = (label, actual, expected, tolerance, digits = 4) => {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failed++;
  console.log(`${ok ? '✔' : '✖'} ${label}: ${Number(actual.toPrecision(digits))} (expected ${expected} ± ${tolerance})`);
};
const checkRel = (label, actual, expected, relTolerance) => check(label, actual, expected, Math.abs(expected) * relTolerance, 5);
const assert = (label, condition) => {
  if (!condition) failed++;
  console.log(`${condition ? '✔' : '✖'} ${label}`);
};
const between = (label, value, lo, hi) => {
  const ok = value >= lo && value <= hi;
  if (!ok) failed++;
  console.log(`${ok ? '✔' : '✖'} ${label}: ${Number(value.toPrecision(5))} (expected ${lo} … ${hi})`);
};

console.log('— tidal acceleration a = 2GMR/r³ —');
const moonNow = P.lunarTide(1);
const sunNow = P.solarTide();
checkRel('lunar tidal acceleration at the surface (m/s²)', moonNow.acceleration, 1.1e-6, 0.02);
checkRel('solar tidal acceleration at the surface (m/s²)', sunNow.acceleration, 5.05e-7, 0.02);
check('solar / lunar ratio', P.SOLAR_TO_LUNAR_RATIO, 0.46, 0.01);
check('surface gravity g (m/s²)', P.surfaceGravity(), 9.82, 0.03);

console.log('— equilibrium bulge height h₀ = a·R/(2g) = (M/M_E)(R/r)³·R —');
checkRel('lunar bulge peak height (m)', moonNow.height, 0.357, 0.02);
checkRel('lunar bulge-to-trough range 1.5·h₀ (m)', moonNow.range, 0.535, 0.02);
checkRel('solar bulge peak height (m)', sunNow.height, 0.164, 0.02);
check('height formula agrees with (M/M_E)(R/r)³·R', moonNow.height, (P.MOON.mass / P.EARTH.mass) * Math.pow(P.EARTH.radius / P.MOON.distance, 3) * P.EARTH.radius, 1e-9);

console.log('— 1/r³ scaling with Moon distance —');
check('half the distance → 8× the bulge', P.lunarTide(0.5).height / moonNow.height, 8, 1e-9);
check('twice the distance → ⅛ of the bulge', P.lunarTide(2).height / moonNow.height, 0.125, 1e-9);
check('relativeToToday(0.5)', P.lunarTide(0.5).relativeToToday, 8, 1e-9);
assert('h(k)·k³ is constant over the whole slider range', (() => {
  const ref = moonNow.height;
  for (let k = P.DISTANCE_RANGE.min; k <= P.DISTANCE_RANGE.max + 1e-9; k += 0.01) {
    if (Math.abs(P.lunarTide(k).height * k * k * k - ref) > 1e-9) return false;
  }
  return true;
})());
assert('acceleration and height scale identically', Math.abs(P.lunarTide(1.37).acceleration / moonNow.acceleration - P.lunarTide(1.37).height / moonNow.height) < 1e-12);

console.log('— bulge shape P₂(cos θ) —');
check('P₂(1) = 1 (sub-lunar point)', P.legendreP2(1), 1, 1e-12);
check('P₂(0) = −½ (90° away)', P.legendreP2(0), -0.5, 1e-12);
check('P₂(−1) = 1 (antipodal bulge)', P.legendreP2(-1), 1, 1e-12);
assert('mean of P₂ over the sphere is 0 (volume conserved)', (() => {
  // ∫ P₂(cos θ) sin θ dθ over 0…π
  let sum = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) {
    const th = ((i + 0.5) / n) * Math.PI;
    sum += P.legendreP2(Math.cos(th)) * Math.sin(th) * (Math.PI / n);
  }
  return Math.abs(sum) < 1e-6;
})());

console.log('— spring / neap tides —');
const hm = moonNow.height;
const hs = sunNow.height;
check('spring range (aligned) = 1.5·(hₘ + hₛ)', P.tidalRange(hm, hs, 0), 1.5 * (hm + hs), 1e-12);
check('spring range at full moon (ε = 180°)', P.tidalRange(hm, hs, Math.PI), 1.5 * (hm + hs), 1e-9);
check('neap range (quadrature) = 1.5·|hₘ − hₛ|', P.tidalRange(hm, hs, Math.PI / 2), 1.5 * (hm - hs), 1e-9);
checkRel('spring range ≈ 0.78 m', P.tidalRange(hm, hs, 0), 0.78, 0.02);
checkRel('neap range ≈ 0.29 m', P.tidalRange(hm, hs, Math.PI / 2), 0.29, 0.03);
check('spring / neap ratio (1 + 0.46)/(1 − 0.46)', P.tidalRange(hm, hs, 0) / P.tidalRange(hm, hs, Math.PI / 2), (1 + P.SOLAR_TO_LUNAR_RATIO) / (1 - P.SOLAR_TO_LUNAR_RATIO), 1e-9);
assert('closed-form range matches brute-force max − min of the sea surface', (() => {
  for (const eps of [0, 0.3, Math.PI / 4, 1.2, Math.PI / 2, 2.5, Math.PI]) {
    let lo = Infinity;
    let hi = -Infinity;
    const bodies = [{ angle: eps, height: hm }, { angle: 0, height: hs }];
    for (let i = 0; i < 3600; i++) {
      const h = P.seaLevel((i / 3600) * 2 * Math.PI, bodies);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    if (Math.abs(hi - lo - P.tidalRange(hm, hs, eps)) > 2e-6) return false;
  }
  return true;
})());
assert('springNeap classification', P.springNeap(0).kind === 'spring' && P.springNeap(Math.PI).kind === 'spring' && P.springNeap(Math.PI / 2).kind === 'neap' && P.springNeap(Math.PI / 4).kind === 'between');
assert('moon phases', P.moonPhase(0) === 'new' && P.moonPhase(Math.PI / 2) === 'firstQuarter' && P.moonPhase(Math.PI) === 'full' && P.moonPhase(1.5 * Math.PI) === 'lastQuarter' && P.moonPhase(-0.1) === 'new');

console.log('— periods —');
check('sidereal month today (d)', P.siderealMonthDays(1), 27.32, 0.01);
check('synodic month today (d)', P.synodicMonthDays(1), 29.53, 0.01);
check('lunar day today (h)', P.lunarDayHours(1), 24.84, 0.01);
check('Kepler III: sidereal month at half the distance (d)', P.siderealMonthDays(0.5), 27.3217 * Math.pow(0.5, 1.5), 1e-6);
check('Kepler III: sidereal month at twice the distance (d)', P.siderealMonthDays(2), 27.3217 * Math.pow(2, 1.5), 1e-6);
assert('two high tides per lunar day at the marker', (() => {
  const dt = 0.05;
  const lunarDay = P.lunarDayHours(1);
  let maxima = 0;
  let prev = P.markerSeaLevel(-dt, 1, 0.7, 0.2);
  let cur = P.markerSeaLevel(0, 1, 0.7, 0.2);
  for (let t = dt; t <= lunarDay + 1e-9; t += dt) {
    const next = P.markerSeaLevel(t, 1, 0.7, 0.2);
    if (cur > prev && cur >= next) maxima++;
    prev = cur;
    cur = next;
  }
  return maxima === 2;
})());
assert('marker sea level is periodic with the lunar day', Math.abs(P.markerSeaLevel(5, 1, 0.3, 1.1) - P.markerSeaLevel(5 + P.lunarDayHours(1), 1, 0.3, 1.1)) < 1e-9);
check('marker sea level with Moon only, peak = h₀', (() => {
  let hi = -Infinity;
  for (let t = 0; t < 30; t += 0.01) hi = Math.max(hi, P.markerSeaLevel(t, 1, 0, 0));
  return hi;
})(), hm, 1e-4);
assert('without the Moon only the solar tide remains', Math.abs(P.markerSeaLevel(3, 1, 0, 0, { moon: false, sun: true }) - hs * P.legendreP2(Math.cos((2 * Math.PI * 3) / 24))) < 1e-12);

console.log('— axis stability (schematic) —');
between('tilt with Moon stays within 22.1°…24.5°', (() => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let t = 0; t < 200000; t += 250) {
    const v = P.tiltWithMoonDeg(t);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return hi - lo;
})(), 2.3, 2.41);
assert('tilt with Moon is 23.3° on average', Math.abs(P.tiltWithMoonDeg(0) - 23.3) < 0.01);
assert('tilt with Moon returns after one obliquity cycle', Math.abs(P.tiltWithMoonDeg(1234) - P.tiltWithMoonDeg(1234 + P.EARTH.obliquityPeriodYr)) < 1e-9);
const chaos = [];
for (let t = 0; t < 5e6; t += 500) chaos.push(P.tiltWithoutMoonDeg(t));
between('tilt without Moon: minimum', Math.min(...chaos), 0, 15);
between('tilt without Moon: maximum', Math.max(...chaos), 45, 60);
assert('tilt without Moon never leaves 0°…60°', chaos.every((v) => v >= 0 && v <= 60));
assert('tilt without Moon visits both extremes (spread > 40°)', Math.max(...chaos) - Math.min(...chaos) > 40);
check('tilt is continuous at the moment the Moon is removed', P.tiltAfterRemovalDeg(0, 23.4), 23.4, 1e-9);
assert('tilt blends smoothly into the chaotic model', (() => {
  let prev = P.tiltAfterRemovalDeg(0, 23.4);
  for (let t = 100; t <= 100000; t += 100) {
    const v = P.tiltAfterRemovalDeg(t, 23.4);
    if (Math.abs(v - prev) > 0.2) return false;
    prev = v;
  }
  return Math.abs(P.tiltAfterRemovalDeg(50000, 23.4) - P.tiltWithoutMoonDeg(50000)) < 1e-9;
})());
check('precession period with Moon (yr)', P.PRECESSION_PERIOD_YR.withMoon, 25772, 1);

console.log('— moon size comparison —');
const rows = Object.fromEntries(P.MOON_COMPARISON.map((r) => [r.id, r]));
check('Moon / Earth diameter ratio (%)', rows.earthMoon.ratio * 100, 27.3, 0.1);
check('Phobos / Mars (%)', rows.marsPhobos.ratio * 100, 0.33, 0.01);
check('Ganymede / Jupiter (%)', rows.jupiterGanymede.ratio * 100, 3.8, 0.05);
check('Titan / Saturn (%)', rows.saturnTitan.ratio * 100, 4.4, 0.05);
check('Triton / Neptune (%)', rows.neptuneTriton.ratio * 100, 5.5, 0.05);
assert('Earth–Moon has by far the largest ratio', P.MOON_COMPARISON.every((r) => r.id === 'earthMoon' || r.ratio < rows.earthMoon.ratio / 4));

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
