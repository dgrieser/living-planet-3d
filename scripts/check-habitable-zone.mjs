// Validates the habitable-zone physics (src/sims/habitable-zone/physics.js) against
// reference values: Kopparapu et al. (2014) zone edges and their temperature dependence,
// Earth's equilibrium temperature, the solar-evolution model, the star presets and the
// true sizes the picture exaggerates.
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
const within = (label, value, lo, hi) => assert(`${label}: ${value.toFixed(0)} in [${lo}, ${hi}]`, value >= lo && value <= hi);

// --- flux limits (Kopparapu et al. 2014, Table 1, 1 M⊕) --------------------------------------
// S_eff = S_eff,☉ + a·T* + b·T*² + c·T*³ + d·T*⁴ with T* = T_eff − 5780 K, fitted for 2600–7200 K.
check('Runaway greenhouse S_eff at 5780 K', HZ.seffLimit(HZ.HZ_LIMITS.runawayGreenhouse, HZ.HZ_TEFF_REFERENCE_K), 1.107, 1e-12);
check('Maximum greenhouse S_eff at 5780 K', HZ.seffLimit(HZ.HZ_LIMITS.maximumGreenhouse, HZ.HZ_TEFF_REFERENCE_K), 0.356, 1e-12);
// A cool star's redder light is absorbed more readily, so both limits move to lower fluxes.
const mDwarfLimits = HZ.zoneFluxLimits(3175);
check('M dwarf (3175 K): runaway greenhouse S_eff', mDwarfLimits.inner, 0.925, 0.002);
check('M dwarf (3175 K): maximum greenhouse S_eff', mDwarfLimits.outer, 0.238, 0.002);
assert('Both limits fall for cooler stars', mDwarfLimits.inner < 1.107 && mDwarfLimits.outer < 0.356);
const hot = HZ.zoneFluxLimits(7200);
assert('Both limits rise for hotter stars', hot.inner > 1.107 && hot.outer > 0.356);
// outside the fitted range the polynomial is held at the edge of its validity
for (const [label, teff, edge] of [['below 2600 K', 2000, 2600], ['above 7200 K', 8000, 7200]]) {
  const held = HZ.zoneFluxLimits(teff);
  const atEdge = HZ.zoneFluxLimits(edge);
  assert(`S_eff ${label} is held at the fit's edge`, held.inner === atEdge.inner && held.outer === atEdge.outer);
}

// --- zone edges --------------------------------------------------------------------------
const sun = HZ.zoneEdgesAU(1, HZ.SOLAR_TEFF_K);
check('Sun: inner edge, runaway greenhouse (AU)', sun.inner, 0.95, 0.005);
check('Sun: outer edge, maximum greenhouse (AU)', sun.outer, 1.676, 0.005);
assert('Earth lies inside the conservative zone', 1 > sun.inner && 1 < sun.outer);
assert('Venus (0.723 AU) lies inside the inner edge', 0.723 < sun.inner);
// Kopparapu's outer edge reaches past Mars: it is too small to hold the CO₂ atmosphere the
// maximum-greenhouse limit assumes, which is a planet property, not a habitable-zone one.
assert('Mars (1.524 AU) lies inside the outer edge', 1.524 < sun.outer);
const mTeff = HZ.mainSequenceStar(0.01).teffK;
const m = HZ.zoneEdgesAU(0.01, mTeff);
check('M dwarf (0.01 L☉): inner edge (AU)', m.inner, 0.104, 0.002);
check('M dwarf (0.01 L☉): outer edge (AU)', m.outer, 0.205, 0.002);
const mNaive = HZ.zoneEdgesAU(0.01, HZ.SOLAR_TEFF_K);
within('M dwarf zone vs. plain √L scaling, inner (%)', (m.inner / mNaive.inner - 1) * 100, 5, 15);
within('M dwarf zone vs. plain √L scaling, outer (%)', (m.outer / mNaive.outer - 1) * 100, 15, 30);
const f = HZ.mainSequenceStar(3);
check('F star (3 L☉): outer edge (AU)', HZ.zoneEdgesAU(3, f.teffK).outer, 2.707, 0.01);
assert('The edge ratio depends on the star', Math.abs(HZ.zoneEdgeRatio(mTeff) - HZ.zoneEdgeRatio(HZ.SOLAR_TEFF_K)) > 0.02);
for (const teff of [2600, 3175, 4500, 5778, 7200]) {
  const z = HZ.zoneEdgesAU(1, teff);
  assert(`T_eff = ${teff} K: inner edge inside the outer edge`, z.inner < z.outer);
}

// --- equilibrium temperature & classification ---------------------------------------------
check('Earth T_eq (K)', HZ.equilibriumTemperatureK(1, 1), 278, 1e-9);
check('Venus-distance T_eq (0.723 AU)', HZ.equilibriumTemperatureK(1, 0.723), 326.9, 0.2);
check('Mars-distance T_eq (1.524 AU)', HZ.equilibriumTemperatureK(1, 1.524), 225.2, 0.2);
const sunEdges = HZ.edgeTemperaturesK(HZ.SOLAR_TEFF_K);
check('Frozen threshold around the Sun (K)', sunEdges.frozen, 214.7, 0.2);
check('Scorched threshold around the Sun (K)', sunEdges.scorched, 285.1, 0.2);
const mEdges = HZ.edgeTemperaturesK(mTeff);
assert('An M dwarf freezes its planets closer in', mEdges.frozen < sunEdges.frozen && mEdges.scorched < sunEdges.scorched);
assert('Earth classified habitable', HZ.classify(HZ.equilibriumTemperatureK(1, 1), HZ.SOLAR_TEFF_K) === 'habitable');
assert('Venus distance classified scorched', HZ.classify(HZ.equilibriumTemperatureK(1, 0.723), HZ.SOLAR_TEFF_K) === 'scorched');
assert('Mars distance classified habitable (inside the maximum-greenhouse edge)', HZ.classify(HZ.equilibriumTemperatureK(1, 1.524), HZ.SOLAR_TEFF_K) === 'habitable');
assert('2 AU from the Sun classified frozen', HZ.classify(HZ.equilibriumTemperatureK(1, 2), HZ.SOLAR_TEFF_K) === 'frozen');
// thresholds coincide with the zone edges for every star the simulation can show
for (const L of [0.001, 0.01, 0.3, 1, 3, 10]) {
  const { teffK } = HZ.mainSequenceStar(L);
  const { inner, outer } = HZ.zoneEdgesAU(L, teffK);
  const state = (d) => HZ.classify(HZ.equilibriumTemperatureK(L, d), teffK);
  assert(`L=${L}: just inside inner edge → habitable`, state(inner * 1.001) === 'habitable');
  assert(`L=${L}: just outside inner edge → scorched`, state(inner * 0.999) === 'scorched');
  assert(`L=${L}: just inside outer edge → habitable`, state(outer * 0.999) === 'habitable');
  assert(`L=${L}: just outside outer edge → frozen`, state(outer * 1.001) === 'frozen');
}

// --- stellar evolution ---------------------------------------------------------------------
check('Sun today: L (L☉)', HZ.solarLuminosityAtAge(HZ.SUN_AGE_GYR), 1, 1e-12);
check('Sun at birth: L (L☉)', HZ.solarLuminosityAtAge(0), 0.714, 0.001);
check('Sun at 10 Gyr: L (L☉)', HZ.solarLuminosityAtAge(10), 1.905, 0.002);
const growth = HZ.solarLuminosityAtAge(HZ.SUN_AGE_GYR + 1) / HZ.solarLuminosityAtAge(HZ.SUN_AGE_GYR) - 1;
check('Luminosity growth over next Gyr (~10 %)', growth, 0.096, 0.01);
check('Age when Earth reaches the inner edge (Gyr)', HZ.ageForSolarLuminosity(HZ.zoneFluxLimits(HZ.SOLAR_TEFF_K).inner), 5.67, 0.02);
check('ageForSolarLuminosity inverts solarLuminosityAtAge', HZ.ageForSolarLuminosity(HZ.solarLuminosityAtAge(7.3)), 7.3, 1e-9);
const earthWindow = HZ.habitableWindowGyr(1);
assert('Earth habitable window exists', earthWindow !== null);
check('Earth habitable from (Gyr)', earthWindow.from, 0, 1e-9);
check('Earth habitable until (Gyr)', earthWindow.to, 5.67, 0.02);
assert('Planet at 0.5 AU never habitable around a Sun-like star', HZ.habitableWindowGyr(0.5) === null);
const marsWindow = HZ.habitableWindowGyr(1.524);
assert('Mars distance is habitable today and stays so', marsWindow !== null && marsWindow.from < HZ.SUN_AGE_GYR && marsWindow.to === HZ.MAX_AGE_GYR);
check('Mars distance entered the zone (Gyr)', marsWindow.from, 2.17, 0.05);
const outerWindow = HZ.habitableWindowGyr(2.2);
assert('2.2 AU only becomes habitable in the far future', outerWindow !== null && outerWindow.from > HZ.SUN_AGE_GYR + 4);

// --- star presets / main-sequence relations ---------------------------------------------------
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
const mixCold = HZ.stateMix(sunEdges.frozen - HZ.COLD_RAMP_K, HZ.SOLAR_TEFF_K);
const mixHot = HZ.stateMix(sunEdges.scorched + HZ.HEAT_RAMP_K, HZ.SOLAR_TEFF_K);
assert('stateMix: deep-frozen planet → cold = 1, heat = 0', mixCold.cold === 1 && mixCold.heat === 0 && mixCold.thaw === 0);
assert('stateMix: lava world → heat = 1, cold = 0', mixHot.heat === 1 && mixHot.cold === 0 && mixHot.scorch === 1);
assert('stateMix: Earth → all ramps at rest', (() => { const mix = HZ.stateMix(HZ.equilibriumTemperatureK(1, 1), HZ.SOLAR_TEFF_K); return mix.thaw === 1 && mix.scorch === 0 && mix.cold === 0 && mix.heat === 0; })());
check('Earth orbital period (yr)', HZ.orbitalPeriodYears(1, 1), 1, 1e-12);
check('Mars orbital period (yr)', HZ.orbitalPeriodYears(1.524, 1), 1.881, 0.002);
// --- true sizes (what the picture exaggerates) ---------------------------------------------
check('1 R☉ in AU', HZ.SOLAR_RADIUS_AU, 0.004650, 1e-6);
check('1 R⊕ in AU', HZ.EARTH_RADIUS_AU, 4.2588e-5, 1e-8);
check('Sun seen from Earth: angular diameter (°)', HZ.angularDiameterDeg(1, 1), 0.533, 0.001);
check('Sun seen from Mercury (0.387 AU): angular diameter (°)', HZ.angularDiameterDeg(1, 0.387), 1.377, 0.005);
// a planet in an M dwarf's habitable zone sees a star more than twice the width of our Sun
check('M dwarf seen from the middle of its zone (°)', HZ.angularDiameterDeg(HZ.mainSequenceStar(0.01).radiusSolar, (m.inner + m.outer) / 2), 1.141, 0.01);
assert('Earth is far smaller than its orbit', HZ.EARTH_RADIUS_AU < 1e-4 && HZ.SOLAR_RADIUS_AU < 0.005);

const red = HZ.starColorRGB(3000);
const blue = HZ.starColorRGB(9000);
assert('3000 K star colour is red-dominant', red[0] > red[1] && red[1] > red[2]);
assert('9000 K star colour is blue-dominant', blue[2] > blue[0]);

console.log(failed ? `\n${failed} check(s) failed` : '\nAll habitable-zone checks passed');
process.exit(failed ? 1 : 0);
