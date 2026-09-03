// Validates the habitable-zone physics (src/sims/habitable-zone/physics.js) against
// reference values: Kopparapu et al. (2013) zone edges for the Sun, Earth's
// equilibrium temperature, the solar-evolution model and the star presets.
import * as HZ from '../src/sims/habitable-zone/physics.js';

let failed = 0;
const check = (label, actual, expected, tolerance) => {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failed++;
  console.log(`${ok ? '✔' : '✖'} ${label}: ${actual.toFixed(4)} (expected ${expected} ± ${tolerance})`);
};
const assert = (label, condition) => {
  if (!condition) failed++;
  console.log(`${condition ? '✔' : '✖'} ${label}`);
};

// --- zone edges --------------------------------------------------------------------------
const sun = HZ.zoneEdgesAU(1);
check('Sun: inner edge (AU)', sun.inner, 0.953, 0.002);
check('Sun: outer edge (AU)', sun.outer, 1.374, 0.002);
check('Zone edge ratio inner/outer', HZ.ZONE_EDGE_RATIO, sun.inner / sun.outer, 1e-12);
const m = HZ.zoneEdgesAU(0.01);
check('M dwarf (0.01 L☉): inner edge (AU)', m.inner, 0.0953, 0.0005);
check('M dwarf (0.01 L☉): outer edge (AU)', m.outer, 0.1374, 0.0005);
check('F star (3 L☉): outer edge (AU)', HZ.zoneEdgesAU(3).outer, 2.379, 0.002);

// --- equilibrium temperature & classification ---------------------------------------------
check('Earth T_eq (K)', HZ.equilibriumTemperatureK(1, 1), 278, 1e-9);
check('Venus-distance T_eq (0.723 AU)', HZ.equilibriumTemperatureK(1, 0.723), 326.9, 0.2);
check('Mars-distance T_eq (1.524 AU)', HZ.equilibriumTemperatureK(1, 1.524), 225.2, 0.2);
check('Frozen threshold (K)', HZ.T_FROZEN_K, 237.2, 0.1);
check('Scorched threshold (K)', HZ.T_SCORCHED_K, 284.8, 0.1);
assert('Earth classified habitable', HZ.classify(HZ.equilibriumTemperatureK(1, 1)) === 'habitable');
assert('Venus distance classified scorched', HZ.classify(HZ.equilibriumTemperatureK(1, 0.723)) === 'scorched');
assert('Mars distance classified frozen', HZ.classify(HZ.equilibriumTemperatureK(1, 1.524)) === 'frozen');
// thresholds coincide with the zone edges for any luminosity
for (const L of [0.001, 0.01, 0.3, 1, 3, 10]) {
  const { inner, outer } = HZ.zoneEdgesAU(L);
  assert(`L=${L}: just inside inner edge → habitable`, HZ.classify(HZ.equilibriumTemperatureK(L, inner * 1.001)) === 'habitable');
  assert(`L=${L}: just outside inner edge → scorched`, HZ.classify(HZ.equilibriumTemperatureK(L, inner * 0.999)) === 'scorched');
  assert(`L=${L}: just inside outer edge → habitable`, HZ.classify(HZ.equilibriumTemperatureK(L, outer * 0.999)) === 'habitable');
  assert(`L=${L}: just outside outer edge → frozen`, HZ.classify(HZ.equilibriumTemperatureK(L, outer * 1.001)) === 'frozen');
}

// --- stellar evolution ---------------------------------------------------------------------
check('Sun today: L (L☉)', HZ.solarLuminosityAtAge(HZ.SUN_AGE_GYR), 1, 1e-12);
check('Sun at birth: L (L☉)', HZ.solarLuminosityAtAge(0), 0.714, 0.001);
check('Sun at 10 Gyr: L (L☉)', HZ.solarLuminosityAtAge(10), 1.905, 0.002);
const growth = HZ.solarLuminosityAtAge(HZ.SUN_AGE_GYR + 1) / HZ.solarLuminosityAtAge(HZ.SUN_AGE_GYR) - 1;
check('Luminosity growth over next Gyr (~10 %)', growth, 0.096, 0.01);
check('Age when Earth reaches the inner edge (Gyr)', HZ.ageForSolarLuminosity(HZ.S_INNER), 5.61, 0.02);
check('ageForSolarLuminosity inverts solarLuminosityAtAge', HZ.ageForSolarLuminosity(HZ.solarLuminosityAtAge(7.3)), 7.3, 1e-9);
const earthWindow = HZ.habitableWindowGyr(1);
assert('Earth habitable window exists', earthWindow !== null);
check('Earth habitable from (Gyr)', earthWindow.from, 0, 1e-9);
check('Earth habitable until (Gyr)', earthWindow.to, 5.61, 0.02);
assert('Planet at 0.5 AU never habitable around a Sun-like star', HZ.habitableWindowGyr(0.5) === null);
const marsWindow = HZ.habitableWindowGyr(1.524);
assert('Mars distance becomes habitable later', marsWindow !== null && marsWindow.from > HZ.SUN_AGE_GYR && marsWindow.to === HZ.MAX_AGE_GYR);

// --- star presets / main-sequence relations ---------------------------------------------------
const within = (label, value, lo, hi) => assert(`${label}: ${value.toFixed(0)} in [${lo}, ${hi}]`, value >= lo && value <= hi);
const star = Object.fromEntries(HZ.STAR_PRESETS.map((p) => [p.id, HZ.mainSequenceStar(p.luminosity)]));
within('M preset T_eff (K)', star.M.teffK, 2800, 3500);
within('K preset T_eff (K)', star.K.teffK, 4000, 5200);
within('G preset T_eff (K)', star.G.teffK, 5700, 5900);
within('F preset T_eff (K)', star.F.teffK, 6000, 7200);
assert('Spectral types of presets', ['M', 'K', 'G', 'F'].every((id) => HZ.spectralType(star[id].teffK) === id));
check('Sun: mass (M☉)', star.G.massSolar, 1, 1e-12);
check('Sun: radius (R☉)', star.G.radiusSolar, 1, 1e-12);
within('M preset mass ×100 (M☉)', star.M.massSolar * 100, 20, 40);
within('F preset radius ×100 (R☉)', star.F.radiusSolar * 100, 120, 160);
check('Radius exponent R ∝ L^0.24', HZ.RADIUS_LUMINOSITY_EXPONENT, 0.24, 1e-12);
for (const [L0, k] of [[1, 10], [0.01, 100], [3, 0.1]]) {
  // the exponent is what the star pull relies on: k× the luminosity → k^0.24 × the radius
  check(`${L0} → ${L0 * k} L☉: radius ratio`, HZ.mainSequenceStar(L0 * k).radiusSolar / HZ.mainSequenceStar(L0).radiusSolar, Math.pow(k, HZ.RADIUS_LUMINOSITY_EXPONENT), 1e-9);
}
const mixCold = HZ.stateMix(HZ.T_FROZEN_K - HZ.COLD_RAMP_K);
const mixHot = HZ.stateMix(HZ.T_SCORCHED_K + HZ.HEAT_RAMP_K);
assert('stateMix: deep-frozen planet → cold = 1, heat = 0', mixCold.cold === 1 && mixCold.heat === 0 && mixCold.thaw === 0);
assert('stateMix: lava world → heat = 1, cold = 0', mixHot.heat === 1 && mixHot.cold === 0 && mixHot.scorch === 1);
assert('stateMix: Earth → all ramps at rest', (() => { const m = HZ.stateMix(HZ.equilibriumTemperatureK(1, 1)); return m.thaw === 1 && m.scorch === 0 && m.cold === 0 && m.heat === 0; })());
check('Earth orbital period (yr)', HZ.orbitalPeriodYears(1, 1), 1, 1e-12);
check('Mars orbital period (yr)', HZ.orbitalPeriodYears(1.524, 1), 1.881, 0.002);
const red = HZ.starColorRGB(3000);
const blue = HZ.starColorRGB(9000);
assert('3000 K star colour is red-dominant', red[0] > red[1] && red[1] > red[2]);
assert('9000 K star colour is blue-dominant', blue[2] > blue[0]);

console.log(failed ? `\n${failed} check(s) failed` : '\nAll habitable-zone checks passed');
process.exit(failed ? 1 : 0);
