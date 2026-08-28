// Validates the magnetosphere physics (src/sims/magnetosphere/physics.js):
// solar-wind dynamic pressure, the pressure-balance and Shue et al. (1997)
// magnetopause standoff distances and their scaling with the wind, the
// paraboloid fits for the boundary surfaces, dipole field-line geometry, the
// containment/stretching properties of the field-line deformation, the
// Kp-style index, the aurora viewline and the CME envelope.
import * as P from '../src/sims/magnetosphere/physics.js';

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

const NOMINAL_P = P.dynamicPressureNPa(5, 400);
const GRID_N = [0, 0.5, 1, 2, 5, 10, 20, 35, 50, 75, 100];
const GRID_V = [200, 300, 400, 600, 800, 1100, 1400, 1700, 2000];
const L_SHELLS = [2, 2.75, 3.6, 4.6, 6, 8, 10];

console.log('— solar wind: P = ρv², ρ = n·m_p —');
checkRel('quiet wind 5 cm⁻³ / 400 km/s (nPa)', NOMINAL_P, 1.338, 0.01);
checkRel('mass density at 5 cm⁻³ (kg/m³)', P.massDensity(5), 8.363e-21, 0.01);
check('n = 0 → P = 0', P.dynamicPressureNPa(0, 800), 0, 0);
check('P scales linearly with density', P.dynamicPressureNPa(10, 400) / NOMINAL_P, 2, 1e-12);
check('P scales with the square of the speed', P.dynamicPressureNPa(5, 800) / NOMINAL_P, 4, 1e-12);
checkRel('extreme wind 100 cm⁻³ / 2000 km/s (nPa)', P.dynamicPressureNPa(100, 2000), 669, 0.01);
checkRel('Sun → Earth transit at 400 km/s (h)', P.transitTimeHours(400), 103.9, 0.01);
checkRel('Sun → Earth transit at 2000 km/s (h)', P.transitTimeHours(2000), 20.8, 0.01);

console.log('— magnetopause standoff —');
checkRel('pressure balance, quiet wind (R_E)', P.pressureBalanceStandoff(P.dynamicPressure(5, 400)), 10.47, 0.01);
between('pressure-balance standoff is the textbook 10–11 R_E', P.pressureBalanceStandoff(P.dynamicPressure(5, 400)), 10, 11);
check('pressure balance goes as P^(−1/6)', P.pressureBalanceStandoff(2 * P.dynamicPressure(5, 400)) / P.pressureBalanceStandoff(P.dynamicPressure(5, 400)), Math.pow(2, -1 / 6), 1e-9);
checkRel('Shue (1997), quiet wind (R_E)', P.shueStandoff(NOMINAL_P), 10.91, 0.01);
check('Shue goes as P^(−1/6.6)', P.shueStandoff(2 * NOMINAL_P) / P.shueStandoff(NOMINAL_P), Math.pow(2, -1 / 6.6), 1e-9);
checkRel('Shue and pressure balance agree to ~5 % at the quiet wind', P.shueStandoff(NOMINAL_P) / P.pressureBalanceStandoff(P.dynamicPressure(5, 400)), 1, 0.05);
check('southward B_z erodes the boundary (B_z = −10 nT)', P.shueStandoff(NOMINAL_P, -10), 9.57, 0.05);
checkRel('extreme wind pushes the nose to ≈ 4 R_E', P.shueStandoff(P.dynamicPressureNPa(100, 2000)), 4.25, 0.02);
assert('extreme wind exposes geostationary orbit (r₀ < 6.61 R_E)', P.geosyncExposed(P.shueStandoff(P.dynamicPressureNPa(100, 2000))));
assert('quiet wind keeps geostationary orbit inside', !P.geosyncExposed(P.shueStandoff(NOMINAL_P)));
assert('standoff decreases monotonically with density and speed', (() => {
  for (const v of GRID_V) {
    let prev = Infinity;
    for (const n of GRID_N) {
      const r = P.shueStandoff(P.dynamicPressureNPa(n, v));
      if (r > prev + 1e-12) return false;
      prev = r;
    }
  }
  for (const n of GRID_N.filter((x) => x > 0)) {
    let prev = Infinity;
    for (const v of GRID_V) {
      const r = P.shueStandoff(P.dynamicPressureNPa(n, v));
      if (r > prev + 1e-12) return false;
      prev = r;
    }
  }
  return true;
})());
assert('standoff stays inside the clamp for the whole slider range', (() => {
  for (const n of GRID_N) for (const v of GRID_V) {
    const r = P.shueStandoff(P.dynamicPressureNPa(n, v));
    if (r < P.STANDOFF_RANGE.min - 1e-9 || r > P.STANDOFF_RANGE.max + 1e-9) return false;
  }
  return true;
})());
check('n = 0 falls back to the pressure floor', P.shueStandoff(P.dynamicPressureNPa(0, 400)), P.shueStandoff(P.MIN_PRESSURE_NPA), 1e-12);
between('the calmest wind still gives a finite magnetosphere', P.shueStandoff(P.dynamicPressureNPa(0, 400)), 18, P.STANDOFF_RANGE.max);

console.log('— boundary surfaces —');
const r0 = P.shueStandoff(NOMINAL_P);
const alpha = P.shueAlpha(NOMINAL_P);
check('Shue radius at the nose is r₀', P.shueRadius(1, r0, alpha), r0, 1e-12);
checkRel('magnetopause at the terminator (R_E)', P.magnetopauseRadiusAtX(0, r0, alpha), 16.4, 0.02);
between('observed magnetopause flank at the terminator is ≈ 15 R_E', P.magnetopauseRadiusAtX(0, r0, alpha), 14, 18);
checkRel('bow-shock nose (R_E)', P.bowShockStandoff(r0), 14.18, 0.01);
between('observed bow-shock nose is ≈ 13–15 R_E', P.bowShockStandoff(r0), 13, 15);
checkRel('bow shock at the terminator (R_E)', P.bowShockRadiusAtX(0, r0), 24.9, 0.02);
checkRel('magnetosheath thickness along the Sun–Earth line (R_E)', P.sheathThickness(r0), 3.27, 0.02);
check('paraboloid matches Shue exactly at the terminator', P.magnetopauseRadiusAtX(0, r0, alpha), r0 * Math.pow(2, alpha), 1e-12);
assert('paraboloid fit is within 11 % of the exact Shue boundary on the dayside', (() => {
  for (let theta = 0.05; theta <= Math.PI / 2; theta += 0.02) {
    const r = P.shueRadius(Math.cos(theta), r0, alpha);
    const x = r * Math.cos(theta);
    const rho = r * Math.sin(theta);
    const fit = P.magnetopauseRadiusAtX(x, r0, alpha);
    if (Math.abs(fit - rho) / rho > 0.11) return false;
  }
  return true;
})());
assert('the bow shock encloses the magnetopause everywhere', (() => {
  for (const n of GRID_N) for (const v of GRID_V) {
    const rr = P.shueStandoff(P.dynamicPressureNPa(n, v));
    const aa = P.shueAlpha(P.dynamicPressureNPa(n, v));
    for (let x = P.bowShockStandoff(rr); x > -120; x -= 0.5) {
      if (P.bowShockRadiusAtX(x, rr) < P.magnetopauseRadiusAtX(x, rr, aa) - 1e-9) return false;
    }
  }
  return true;
})());

console.log('— solar-wind streamlines —');
assert('a streamline can never enter the magnetopause', (() => {
  for (const n of GRID_N) for (const v of GRID_V) {
    const p = P.dynamicPressureNPa(n, v);
    const rr = P.shueStandoff(p);
    const aa = P.shueAlpha(p);
    for (const rhoInf of [0, 0.5, 2, 5, 10, 20, 32]) {
      for (let x = rr; x > -80; x -= 0.25) {
        if (P.streamlineRadius(x, rhoInf, rr, aa) <= P.magnetopauseRadiusAtX(x, rr, aa)) return false;
      }
    }
  }
  return true;
})());
assert('even the stagnation streamline clears Earth at the nose plane', (() => {
  for (const n of GRID_N) for (const v of GRID_V) {
    const p = P.dynamicPressureNPa(n, v);
    const rr = P.shueStandoff(p);
    if (P.streamlineRadius(rr, 0, rr, P.shueAlpha(p)) < 1.5) return false;
  }
  return true;
})());
assert('a streamline is undeflected far upstream and deflects towards the obstacle', (() => {
  const rr = P.shueStandoff(NOMINAL_P);
  const aa = P.shueAlpha(NOMINAL_P);
  if (Math.abs(P.streamlineRadius(48, 6, rr, aa) - 6) > 1e-9) return false;
  let prev = 0;
  for (let x = 20; x > -40; x -= 0.5) {
    const rho = P.streamlineRadius(x, 6, rr, aa);
    if (rho < prev - 1e-12) return false; // monotone: parcels are pushed outward, never back in
    prev = rho;
  }
  return prev > 20; // and by the far tail it has been pushed well out
})());
assert('a stronger wind deflects the flow closer to Earth', (() => {
  let prev = Infinity;
  for (const [n, v] of [[1, 300], [5, 400], [20, 700], [50, 1200], [100, 2000]]) {
    const p = P.dynamicPressureNPa(n, v);
    const rr = P.shueStandoff(p);
    const aa = P.shueAlpha(p);
    // where does the stagnation streamline (ρ∞ = 0) reach 3 R⊕ of transverse offset?
    let xTurn = -80;
    for (let x = 60; x > -80; x -= 0.1) {
      if (P.streamlineRadius(x, 0, rr, aa) >= 3) {
        xTurn = x;
        break;
      }
    }
    if (xTurn > prev - 0.5) return false;
    prev = xTurn;
  }
  return true;
})());
checkRel('the flow starts turning at the bow shock, not at the magnetopause', (() => {
  const rr = P.shueStandoff(NOMINAL_P);
  const aa = P.shueAlpha(NOMINAL_P);
  for (let x = 60; x > 0; x -= 0.01) if (P.streamlineRadius(x, 0, rr, aa) > 0) return x;
  return 0;
})(), 1.28 * P.shueStandoff(NOMINAL_P), 0.02);

console.log('— dipole field lines r = L·cos²λ —');
const pt = [0, 0, 0];
check('L = 4 footpoint is at magnetic latitude 60°', (P.footpointLatitude(4) * 180) / Math.PI, 60, 1e-9);
check('L = 2 footpoint is at magnetic latitude 45°', (P.footpointLatitude(2) * 180) / Math.PI, 45, 1e-9);
P.dipolePoint(pt, 6, 0, 0);
check('the equatorial crossing of L = 6 is 6 R_E sunward', pt[0], 6, 1e-12);
P.dipolePoint(pt, 6, P.footpointLatitude(6), 0);
check('the footpoint of L = 6 sits on the surface', Math.hypot(pt[0], pt[1], pt[2]), 1, 1e-12);
assert('every field line runs from surface to surface', (() => {
  for (const L of L_SHELLS) {
    const lat = P.footpointLatitude(L);
    for (const sign of [-1, 1]) {
      P.dipolePoint(pt, L, sign * lat, 1.1);
      if (Math.abs(Math.hypot(pt[0], pt[1], pt[2]) - 1) > 1e-12) return false;
    }
  }
  return true;
})());

console.log('— field-line deformation (schematic) —');
const out = [0, 0, 0, 0];
const sampleLines = (env, azimuth, steps = 400) => {
  let apexX = -Infinity;
  let tailX = Infinity;
  let worstRatio = 0;
  for (const L of L_SHELLS) {
    const lat1 = P.footpointLatitude(L);
    for (let i = 0; i <= steps; i++) {
      const lat = -lat1 + (2 * lat1 * i) / steps;
      P.dipolePoint(pt, L, lat, azimuth);
      P.deformPoint(out, pt[0], pt[1], pt[2], env);
      apexX = Math.max(apexX, out[0]);
      tailX = Math.min(tailX, out[0]);
      const r = Math.hypot(out[0], out[1], out[2]);
      worstRatio = Math.max(worstRatio, r / P.shueRadius(out[0] / r, env.r0, env.alpha));
    }
  }
  return { apexX, tailX, worstRatio };
};
assert('no deformed point ever crosses the magnetopause', (() => {
  for (const n of GRID_N) for (const v of GRID_V) {
    const env = P.fieldEnv(P.dynamicPressureNPa(n, v));
    for (let a = 0; a < 16; a++) {
      if (sampleLines(env, (a / 16) * 2 * Math.PI, 200).worstRatio > 1) return false;
    }
  }
  return true;
})());
assert('footpoints stay planted on the surface at every pressure', (() => {
  for (const n of GRID_N) for (const v of GRID_V) {
    const env = P.fieldEnv(P.dynamicPressureNPa(n, v));
    for (const L of L_SHELLS) {
      const lat = P.footpointLatitude(L);
      for (const sign of [-1, 1]) for (let a = 0; a < 8; a++) {
        P.dipolePoint(pt, L, sign * lat, (a / 8) * 2 * Math.PI);
        P.deformPoint(out, pt[0], pt[1], pt[2], env);
        if (Math.abs(Math.hypot(out[0], out[1], out[2]) - 1) > 1e-9) return false;
      }
    }
  }
  return true;
})());
assert('the inner magnetosphere (L = 2) stays a near-perfect dipole in the quiet wind', (() => {
  const env = P.fieldEnv(NOMINAL_P);
  const lat1 = P.footpointLatitude(2);
  for (let i = 0; i <= 200; i++) {
    const lat = -lat1 + (2 * lat1 * i) / 200;
    P.dipolePoint(pt, 2, lat, 0);
    P.deformPoint(out, pt[0], pt[1], pt[2], env);
    if (Math.hypot(out[0] - pt[0], out[1] - pt[1], out[2] - pt[2]) > 0.05) return false;
  }
  return true;
})());
const PRESSURE_SERIES = [[1, 300], [5, 400], [20, 700], [50, 1200], [100, 2000]];
assert('the dayside is compressed monotonically as the wind pressure rises', (() => {
  let prev = Infinity;
  for (const [n, v] of PRESSURE_SERIES) {
    const apex = sampleLines(P.fieldEnv(P.dynamicPressureNPa(n, v)), 0).apexX;
    if (apex > prev - 0.2) return false;
    prev = apex;
  }
  return true;
})());
assert('the magnetotail lengthens monotonically as the wind pressure rises', (() => {
  let prev = 0;
  for (const [n, v] of PRESSURE_SERIES) {
    const tail = sampleLines(P.fieldEnv(P.dynamicPressureNPa(n, v)), Math.PI).tailX;
    if (tail > prev - 2) return false;
    prev = tail;
  }
  return true;
})());
const quietLines = sampleLines(P.fieldEnv(NOMINAL_P), 0);
const stormLines = sampleLines(P.fieldEnv(P.dynamicPressureNPa(100, 2000)), 0);
checkRel('noon apex of the L = 10 shell, quiet wind (R_E)', quietLines.apexX, 8.27, 0.02);
checkRel('noon apex of the L = 10 shell, extreme wind (R_E)', stormLines.apexX, 4.15, 0.02);
between('the tail reaches 20–30 R_E in the quiet wind', -sampleLines(P.fieldEnv(NOMINAL_P), Math.PI).tailX, 20, 30);
assert('the tail is flattened towards the current sheet', (() => {
  const env = P.fieldEnv(NOMINAL_P);
  P.dipolePoint(pt, 10, 0.6, Math.PI); // a point well up the nightside lobe
  const before = Math.abs(pt[1]);
  P.deformPoint(out, pt[0], pt[1], pt[2], env);
  return Math.abs(out[1]) < before;
})());

console.log('— geomagnetic activity (schematic) —');
check('quiet wind → Kp ≈ 1.5', P.kpIndex(5, 400), 1.5, 0.01);
checkRel('extreme wind → Kp ≈ 8.3', P.kpIndex(100, 2000), 8.26, 0.01);
check('the index is capped at 9', P.kpIndex(600, 3000), 9, 1e-9);
check('no wind → Kp 0', P.kpIndex(0, 800), 0, 1e-9);
assert('Kp rises monotonically with density and with speed', (() => {
  for (const v of GRID_V) {
    let prev = -1;
    for (const n of GRID_N) {
      const kp = P.kpIndex(n, v);
      if (kp < prev - 1e-12) return false;
      prev = kp;
    }
  }
  for (const n of GRID_N.filter((x) => x > 0)) {
    let prev = -1;
    for (const v of GRID_V) {
      const kp = P.kpIndex(n, v);
      if (kp < prev - 1e-12) return false;
      prev = kp;
    }
  }
  return true;
})());
assert('speed matters more than density (doubling v beats doubling n)', P.kpIndex(5, 800) > P.kpIndex(10, 400));
assert('G-scale buckets follow NOAA (G1 = Kp 5 … G5 = Kp 9)', P.stormLevel(2) === 'quiet' && P.stormLevel(4) === 'active' && P.stormLevel(5) === 'g1' && P.stormLevel(6) === 'g2' && P.stormLevel(7) === 'g3' && P.stormLevel(8) === 'g4' && P.stormLevel(9) === 'g5');
check('aurora viewline at Kp 0 (° geomagnetic)', P.auroraBoundaryLatDeg(0), 66.5, 0.01);
check('aurora viewline at Kp 9 (° geomagnetic)', P.auroraBoundaryLatDeg(9), 47.6, 0.01);
between('at Kp 7 the aurora reaches the mid-latitudes', P.auroraBoundaryLatDeg(7), 50, 54);
assert('the oval moves equatorward and widens with rising Kp', (() => {
  let prevLat = 999;
  let prevWidth = 0;
  for (let kp = 0; kp <= 9; kp += 0.5) {
    const band = P.auroraBand(kp);
    const width = band.polewardLatDeg - band.equatorwardLatDeg;
    if (band.equatorwardLatDeg > prevLat - 1e-12) return false;
    if (width < prevWidth - 1e-12) return false;
    prevLat = band.equatorwardLatDeg;
    prevWidth = width;
  }
  return true;
})());
assert('the oval always glows a little, and saturates at 1', P.auroraIntensity(0) > 0 && P.auroraIntensity(9) === 1);

console.log('— CME sheath (schematic) —');
check('envelope before impact', P.cmeEnvelope(-1), 0, 0);
assert('the aurora is lit within 2 s of impact', P.cmeEnvelope(1) > 0.9);
check('envelope during the plateau', P.cmeEnvelope(3), 1, 1e-12);
check('envelope after the event', P.cmeEnvelope(P.CME_TOTAL_SECONDS + 0.1), 0, 1e-12);
assert('the envelope never leaves 0…1', (() => {
  for (let t = -1; t < P.CME_TOTAL_SECONDS + 2; t += 0.01) {
    const e = P.cmeEnvelope(t);
    if (e < 0 || e > 1) return false;
  }
  return true;
})());
const sheath = P.effectiveWind(5, 400, 1);
checkRel('sheath density (cm⁻³)', sheath.density, 56, 0.01);
checkRel('sheath speed (km/s)', sheath.speed, 900, 0.01);
const stormState = P.magnetosphereState(sheath.density, sheath.speed);
checkRel('sheath dynamic pressure (nPa)', stormState.pressureNPa, 75.9, 0.02);
between('a CME on the quiet wind pushes the nose inside geostationary orbit', stormState.standoff, 5, 6.61);
between('a CME on the quiet wind reaches G2', stormState.kp, 5.5, 6.5);
assert('a CME exposes geostationary orbit', stormState.geosyncExposed);
assert('the CME brightens the aurora by at least 4×', stormState.auroraIntensity > 4 * P.magnetosphereState(5, 400).auroraIntensity);
assert('the CME oval is at least 8° further equatorward', P.magnetosphereState(5, 400).aurora.equatorwardLatDeg - stormState.aurora.equatorwardLatDeg > 8);

console.log('— magnetosphereState() —');
const quiet = P.magnetosphereState(5, 400);
assert('quiet state is self-consistent', quiet.bowShock > quiet.standoff && quiet.sheath > 0 && !quiet.geosyncExposed && quiet.level === 'quiet');
checkRel('standoff in km', quiet.standoffKm, (quiet.standoff * P.EARTH.radius) / 1000, 1e-12);
check('pressure ratio is 1 for the reference wind', quiet.pressureRatio, 1, 1e-12);
assert('switching the field off reports no shield', (() => {
  const off = P.magnetosphereState(5, 400, { fieldOn: false });
  return off.level === 'unshielded' && off.kp === 0 && off.auroraIntensity === 0 && off.geosyncExposed;
})());

console.log(failed === 0 ? '\nAll magnetosphere physics checks passed.' : `\n${failed} check(s) FAILED.`);
process.exit(failed ? 1 : 0);
