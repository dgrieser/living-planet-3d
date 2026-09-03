// Validates the galactic-zone model (src/sims/galactic-zone/model.js):
// the Sun's orbit (period, speed, galactic years), zone classification with
// configurable edges, the metallicity gradient and the schematic supernova
// hazard, the logarithmic-arm geometry (Sun on the Orion spur, trailing arms,
// arm order along the Sun's radius) and the statistical properties of the
// generated 50 000-point galaxy (density falling with radius, arm contrast,
// thin disc, determinism), the "life on Earth" neighbourhood numbers scaled from
// published present-day anchors, and the haze / dust-lane / globular-cluster
// generators that dress the picture.
import * as M from '../src/sims/galactic-zone/model.js';

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

const cfg = M.DEFAULT_CONFIG;
const DEG = 180 / Math.PI;

console.log('— the Sun’s orbit —');
check('Sun at 27 kly ≈ 8.3 kpc', cfg.sun.radiusKly / M.LY_PER_KPC, 8.28, 0.02);
checkRel('orbital speed at 27 kly / 230 Myr (km/s)', M.sunSpeedKmS(), 221, 0.01);
between('the textbook value is 220–240 km/s', M.sunSpeedKmS(), 215, 245);
check('period at the Sun’s radius is the configured 230 Myr', M.orbitalPeriodMyr(27), 230, 1e-9);
check('flat rotation curve: period doubles with radius', M.orbitalPeriodMyr(54) / M.orbitalPeriodMyr(27), 2, 1e-12);
check('speed is the same at every radius (flat curve)', M.circularSpeedKmS(13, M.orbitalPeriodMyr(13)), M.sunSpeedKmS(), 1e-9);
check('galactic years since the Sun formed', M.galacticYearsSinceFormation(), 20, 1e-9);
check('pattern angle after one pattern period is 2π', M.patternAngle(230), M.TAU, 1e-12);
check('the Sun stays on the pattern at 27 kly (corotation)', M.orbitAzimuth(230, 27, cfg.sunAzimuth) - cfg.sunAzimuth, M.patternAngle(230), 1e-9);
assert('inside 27 kly the Sun would overtake the arms, outside it lags', M.angularSpeed(20) > M.TAU / cfg.patternPeriodMyr && M.angularSpeed(40) < M.TAU / cfg.patternPeriodMyr);
check('orbits completed after 460 Myr at 27 kly', M.orbitsCompleted(460, 27), 2, 1e-12);

console.log('— zone classification —');
assert('27 kly is inside the habitable zone', M.classifyRadius(27) === 'habitable');
assert('edges are inclusive', M.classifyRadius(13) === 'habitable' && M.classifyRadius(33) === 'habitable');
assert('just inside the inner edge is hostile', M.classifyRadius(12.9) === 'inner');
assert('just outside the outer edge is metal-poor', M.classifyRadius(33.1) === 'outer');
check('zone width (kly)', M.zoneWidthKly(), 20, 1e-12);
const custom = M.createConfig({ zone: { innerKly: 20, outerKly: 30 } });
assert('createConfig() overrides only the zone edges', custom.zone.innerKly === 20 && custom.zone.outerKly === 30 && custom.sun.radiusKly === 27 && custom.arms === cfg.arms);
assert('classification follows the configured edges', M.classifyRadius(15, custom) === 'inner' && M.classifyRadius(27, custom) === 'habitable' && M.classifyRadius(31, custom) === 'outer');
assert('DEFAULT_CONFIG is untouched by overrides', cfg.zone.innerKly === 13 && cfg.zone.outerKly === 33);
assert('the Sun sits inside the zone with a comfortable margin on both sides', cfg.sun.radiusKly - cfg.zone.innerKly >= 5 && cfg.zone.outerKly - cfg.sun.radiusKly >= 5);

console.log('— environment (metallicity gradient, schematic supernova hazard) —');
check('metallicity relative to the Sun is 1 at 27 kly', M.relativeMetallicity(27), 1, 1e-12);
checkRel('gradient −0.06 dex/kpc: one kpc further in → +15 %', M.relativeMetallicity(27 - M.LY_PER_KPC), Math.pow(10, 0.06), 1e-9);
between('the outer disc at 45 kly holds roughly half the Sun’s heavy elements', M.relativeMetallicity(45), 0.4, 0.55);
between('the inner edge at 13 kly holds nearly twice as much', M.relativeMetallicity(13), 1.6, 2.0);
assert('metallicity decreases monotonically outward', (() => {
  let prev = Infinity;
  for (let r = 1; r <= 50; r += 0.5) {
    const m = M.relativeMetallicity(r);
    if (m >= prev) return false;
    prev = m;
  }
  return true;
})());
check('supernova rate relative to the Sun is 1 at 27 kly', M.relativeSupernovaRate(27), 1, 1e-12);
between('at 5 kly the hazard is an order of magnitude higher', M.relativeSupernovaRate(5), 8, 20);
between('at the inner edge the hazard is a few times higher', M.relativeSupernovaRate(13), 3, 7);
between('at 45 kly the hazard is well below today’s', M.relativeSupernovaRate(45), 0.05, 0.2);
assert('sunState() clamps to the slider range and reports consistently', (() => {
  const s = M.sunState(100, 115);
  const t = M.sunState(27, 115);
  return s.radiusKly === cfg.sunRadiusRangeKly.max && s.zone === 'outer' && Math.abs(t.orbits - 0.5) < 1e-12 && t.zone === 'habitable' && Math.abs(t.radiusLy - 27000) < 1e-9;
})());

console.log('— spiral geometry —');
const k = M.spiralK();
checkRel('pitch 12.5° → k = tan(12.5°)', k, 0.2217, 0.001);
check('the Sun lies exactly on the Orion spur', M.distanceToArm(27, cfg.sunAzimuth, cfg.spur), 0, 1e-9);
assert('each arm crosses the Sun’s azimuth at its configured radius', cfg.arms.every((a) => Math.abs(M.armRadiusAt(cfg.sunAzimuth, a) - a.crossKly) < 1e-9));
assert('arm order along the Sun’s radius: Scutum–Centaurus < Sagittarius < Sun (27) < Perseus < Norma', (() => {
  const r = Object.fromEntries(cfg.arms.map((a) => [a.id, a.crossKly]));
  return r.scutumCentaurus < r.sagittarius && r.sagittarius < 27 && 27 < r.perseus && r.perseus < r.norma;
})());
assert('the Sun is at least 4 kly from every major arm', cfg.arms.filter((a) => a.major).every((a) => Math.abs(M.distanceToArm(27, cfg.sunAzimuth, a)) > 4 || Math.abs(a.crossKly - 27) > 4));
assert('arms trail: azimuth decreases as radius grows', (() => {
  for (const arm of cfg.arms) {
    const line = M.armCentreLine(arm);
    for (let i = 1; i < line.length; i++) if (line[i].phi >= line[i - 1].phi) return false;
  }
  return true;
})());
assert('a logarithmic spiral: Δφ per e-fold of radius is 1/k', Math.abs(M.armAzimuth(10, cfg.arms[0]) - M.armAzimuth(10 * Math.E, cfg.arms[0]) - 1 / k) < 1e-9);
between('the arms wind about one turn between the bar and the rim', (M.armAzimuth(cfg.armStartKly, cfg.arms[0]) - M.armAzimuth(cfg.discRadiusKly, cfg.arms[0])) / M.TAU, 0.9, 1.5);
assert('the two major arms start at (nearly) opposite ends of the bar', (() => {
  const majors = cfg.arms.filter((a) => a.major);
  let d = M.armAzimuth(cfg.armStartKly, majors[0]) - M.armAzimuth(cfg.armStartKly, majors[1]);
  d = Math.abs((((d + Math.PI) % M.TAU) + M.TAU) % M.TAU - Math.PI) * DEG;
  return Math.abs(d - 180) < 12;
})());
between('the bar direction lies between the two major arm roots', (() => {
  const majors = cfg.arms.filter((a) => a.major);
  const a0 = M.armAzimuth(cfg.armStartKly, majors[0]) * DEG;
  return Math.abs(M.barAngle() * DEG - a0);
})(), 0, 12);
check('distanceToArm is signed and antisymmetric', M.distanceToArm(27, cfg.sunAzimuth + 0.05, cfg.spur), -M.distanceToArm(27, cfg.sunAzimuth - 0.05, cfg.spur), 1e-9);

console.log('— generated galaxy (50 000 points) —');
const t0 = Date.now();
const g = M.generateGalaxy(cfg, 50000);
const genMs = Date.now() - t0;
check('point count', g.count, 50000, 0);
assert('generation is fast enough for mount time (< 250 ms)', genMs < 250);
console.log(`  (generated in ${genMs} ms)`);
assert('deterministic for the same seed', (() => {
  const h = M.generateGalaxy(cfg, 2000);
  const h2 = M.generateGalaxy(cfg, 2000);
  for (let i = 0; i < h.positions.length; i++) if (h.positions[i] !== h2.positions[i]) return false;
  return true;
})());
assert('a different seed gives a different galaxy', M.generateGalaxy(cfg, 500, 1).positions[0] !== M.generateGalaxy(cfg, 500, 2).positions[0]);
assert('all points lie inside the disc radius', (() => {
  for (let i = 0; i < g.count; i++) if (g.radii[i] > cfg.discRadiusKly + 1e-6) return false;
  return true;
})());
assert('no NaN anywhere', (() => {
  for (const arr of [g.positions, g.colors, g.sizes, g.phases]) for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) return false;
  return true;
})());
assert('colours are in 0…1.4 (bright core allowed) and sizes positive', (() => {
  for (let i = 0; i < g.colors.length; i++) if (g.colors[i] < 0 || g.colors[i] > 1.4) return false;
  for (let i = 0; i < g.count; i++) if (g.sizes[i] <= 0 || g.sizes[i] > 5) return false;
  return true;
})());
const profile = M.radialDensityProfile(g.radii, 5, 50);
assert('surface density decreases monotonically with radius (5 kly bins)', profile.every((b, i) => i === 0 || b.density < profile[i - 1].density));
between('centre-to-Sun density contrast is large (bulge + exponential disc)', profile[0].density / profile[5].density, 10, 60);
between('roughly half of all points sit inside the habitable ring', M.fractionBetween(g.radii, cfg.zone.innerKly, cfg.zone.outerKly), 0.35, 0.6);
between('bulge points are a fifth of the budget', g.kinds.filter((k) => k === M.KIND.bulge).length / g.count, 0.19, 0.21);
assert('inside the bulge radius, bulge points dominate', (() => {
  let bulge = 0;
  let other = 0;
  for (let i = 0; i < g.count; i++) if (g.radii[i] < 6) g.kinds[i] === M.KIND.bulge ? bulge++ : other++;
  return bulge > 2 * other;
})());
assert('the disc is thin: 90 % of disc points within ±2 kly of the plane', (() => {
  let n = 0;
  let total = 0;
  for (let i = 0; i < g.count; i++) {
    if (g.kinds[i] === M.KIND.bulge) continue;
    total++;
    if (Math.abs(g.positions[i * 3 + 1]) <= 2) n++;
  }
  return n / total > 0.9;
})());
assert('the bulge is thicker than the disc', (() => {
  let zb = 0;
  let nb = 0;
  let zd = 0;
  let nd = 0;
  for (let i = 0; i < g.count; i++) {
    const y = Math.abs(g.positions[i * 3 + 1]);
    if (g.kinds[i] === M.KIND.bulge) {
      zb += y;
      nb++;
    } else if (g.kinds[i] === M.KIND.arm) {
      zd += y;
      nd++;
    }
  }
  return zb / nb > zd / nd;
})());
assert('the bar is elongated along the bar angle', (() => {
  const b = M.barAngle();
  const c = Math.cos(b);
  const s = Math.sin(b);
  let along = 0;
  let across = 0;
  for (let i = 0; i < g.count; i++) {
    if (g.kinds[i] !== M.KIND.bulge) continue;
    const x = g.positions[i * 3];
    const z = g.positions[i * 3 + 2];
    along += Math.abs(x * c + z * s);
    across += Math.abs(-x * s + z * c);
  }
  return along / across > 1.8;
})());
assert('arm points cluster on the arm centre lines (RMS offset below 1.5 arm widths)', (() => {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < g.count; i++) {
    if (g.kinds[i] !== M.KIND.arm) continue;
    const x = g.positions[i * 3];
    const z = g.positions[i * 3 + 2];
    const r = Math.hypot(x, z);
    const phi = Math.atan2(z, x);
    let best = Infinity;
    for (const arm of cfg.arms) best = Math.min(best, Math.abs(M.distanceToArm(r, phi, arm)) / arm.widthKly);
    sum += best * best;
    n++;
  }
  return Math.sqrt(sum / n) < 1.5;
})());
assert('arm contrast: 3–4 kly off the Perseus arm the point density is below half of the on-arm value', (() => {
  // annulus 36–40 kly, binned by the across-arm distance (1 kly bins on both sides)
  const arm = cfg.arms.find((a) => a.id === 'perseus');
  let on = 0;
  let off = 0;
  for (let i = 0; i < g.count; i++) {
    const r = g.radii[i];
    if (r < 36 || r > 40) continue;
    const d = Math.abs(M.distanceToArm(r, Math.atan2(g.positions[i * 3 + 2], g.positions[i * 3]), arm));
    if (d < 1) on++;
    else if (d >= 3 && d < 4) off++;
  }
  // `on` spans 2 kly of across distance (−1…1), `off` also 2 kly (two 1 kly bins)
  return on > 60 && off <= on * 0.5;
})());
assert('the spur is populated around the Sun', (() => {
  let n = 0;
  for (let i = 0; i < g.count; i++) {
    if (g.kinds[i] !== M.KIND.spur) continue;
    const x = g.positions[i * 3];
    const z = g.positions[i * 3 + 2];
    if (Math.hypot(x - 0, z + 27) < 2.5) n++;
  }
  return n > 40;
})());
assert('HII regions are the largest points and sit in the arms', (() => {
  let minHii = Infinity;
  let maxOther = 0;
  let inArm = 0;
  let nHii = 0;
  for (let i = 0; i < g.count; i++) {
    if (g.kinds[i] === M.KIND.hii) {
      nHii++;
      minHii = Math.min(minHii, g.sizes[i]);
      const x = g.positions[i * 3];
      const z = g.positions[i * 3 + 2];
      const r = Math.hypot(x, z);
      const phi = Math.atan2(z, x);
      let best = Infinity;
      for (const arm of [...cfg.arms, cfg.spur]) best = Math.min(best, Math.abs(M.distanceToArm(r, phi, arm)));
      if (best < 2.5) inArm++;
    } else {
      maxOther = Math.max(maxOther, g.sizes[i]);
    }
  }
  return minHii >= 2.2 && maxOther < 4 && inArm / nHii > 0.85;
})());
assert('the mix fractions add up to one', Math.abs(Object.values(cfg.mix).reduce((a, b) => a + b, 0) - 1) < 1e-12);

console.log('— life on Earth at another radius (neighbourhood) —');
const N = M.NEIGHBOURHOOD;
const today = M.neighbourhoodState(27);
check('today: nearest star 4.25 ly', today.nearestStarLy, N.nearestStarLy, 1e-12);
check('today: 9 000 naked-eye stars', today.nakedEyeStars, N.nakedEyeStars, 1e-9);
checkRel('today: a star within 1 pc every ≈ 51 kyr (19.7 per Myr, Bailer-Jones 2018)', today.encounterIntervalKyr, 50.76, 0.001);
checkRel('today: an ozone-damaging supernova (< 8 pc) every ≈ 670 Myr (1.5 per Gyr, Gehrels 2003)', today.supernovaIntervalMyr, 666.7, 0.001);
check('today: Oort cloud edge factor 1', today.oortCloudFactor, 1, 1e-12);
check('today: giant-planet factor 1', today.giantPlanetFactor, 1, 1e-12);
assert('today: no arm crossings at corotation (Infinity)', !Number.isFinite(today.armCrossingIntervalMyr) && today.armCrossingIntervalMyr > 0);
check('today: galactic year 230 Myr', today.periodMyr, 230, 1e-9);
const inner = M.neighbourhoodState(13);
checkRel('13 kly: stellar density 5.2×', inner.density, 5.212, 0.001);
checkRel('13 kly: nearest star ≈ 2.45 ly (∝ ρ^−1/3)', inner.nearestStarLy, 2.451, 0.001);
checkRel('13 kly: ≈ 47 000 naked-eye stars', inner.nakedEyeStars, 46906, 0.001);
checkRel('13 kly: a passage within 1 pc every ≈ 9.7 kyr', inner.encounterIntervalKyr, 9.74, 0.002);
checkRel('13 kly: an ozone-damaging supernova every ≈ 128 Myr', inner.supernovaIntervalMyr, 127.9, 0.001);
checkRel('13 kly: Oort cloud shrinks to 0.58×', inner.oortCloudFactor, 0.5768, 0.001);
checkRel('13 kly: giant planets 3.3× as likely (10^(2·[Fe/H]))', inner.giantPlanetFactor, 3.274, 0.001);
checkRel('13 kly: arm crossing every ≈ 53 Myr', inner.armCrossingIntervalMyr, 53.4, 0.002);
const outer = M.neighbourhoodState(33);
checkRel('33 kly: stellar density 0.49×', outer.density, 0.4929, 0.001);
checkRel('33 kly: nearest star ≈ 5.4 ly', outer.nearestStarLy, 5.38, 0.001);
checkRel('33 kly: ≈ 4 400 naked-eye stars', outer.nakedEyeStars, 4436, 0.001);
checkRel('33 kly: a passage within 1 pc every ≈ 103 kyr', outer.encounterIntervalKyr, 103.0, 0.002);
checkRel('33 kly: an ozone-damaging supernova every ≈ 1.35 Gyr', outer.supernovaIntervalMyr, 1352.7, 0.001);
checkRel('33 kly: Oort cloud grows to 1.27×', outer.oortCloudFactor, 1.266, 0.001);
checkRel('33 kly: giant planets 0.6× as likely', outer.giantPlanetFactor, 0.6015, 0.001);
checkRel('33 kly: arm crossing every ≈ 316 Myr', outer.armCrossingIntervalMyr, 316.2, 0.002);
checkRel('20 kly: arm crossing every ≈ 164 Myr (T = 57.5 Myr / |27/r − 1|)', M.armCrossingIntervalMyr(20), 164.3, 0.002);
check('giant-planet factor is the square of the metallicity', M.giantPlanetFactor(19), Math.pow(M.relativeMetallicity(19), 2), 1e-12);
assert('the crossing interval grows monotonically towards corotation from both sides', (() => {
  let prev = 0;
  for (let r = 3; r < 27; r += 0.5) {
    const v = M.armCrossingIntervalMyr(r);
    if (v <= prev) return false;
    prev = v;
  }
  prev = 0;
  for (let r = 50; r > 27; r -= 0.5) {
    const v = M.armCrossingIntervalMyr(r);
    if (v <= prev) return false;
    prev = v;
  }
  return true;
})());
assert('every neighbourhood value is finite and positive across the slider range (except the crossing interval at corotation)', (() => {
  for (let r = cfg.sunRadiusRangeKly.min; r <= cfg.sunRadiusRangeKly.max; r += 0.5) {
    const n = M.neighbourhoodState(r);
    for (const [k, v] of Object.entries(n)) {
      if (typeof v !== 'number') continue;
      if (k === 'armCrossingIntervalMyr' && r === 27) continue;
      if (!Number.isFinite(v) || v <= 0) return false;
    }
  }
  return true;
})());
assert('nearest-star distance and Oort factor grow outward, star counts and encounter rates fall', (() => {
  for (let r = 4; r <= 50; r += 1) {
    if (!(M.nearestStarLy(r) > M.nearestStarLy(r - 1))) return false;
    if (!(M.oortCloudTidalFactor(r) > M.oortCloudTidalFactor(r - 1))) return false;
    if (!(M.nakedEyeStarCount(r) < M.nakedEyeStarCount(r - 1))) return false;
    if (!(M.stellarEncounterRatePerMyr(r) < M.stellarEncounterRatePerMyr(r - 1))) return false;
    if (!(M.ozoneSupernovaIntervalMyr(r) > M.ozoneSupernovaIntervalMyr(r - 1))) return false;
  }
  return true;
})());
checkRel('today: a 14 % chance of an ozone-damaging supernova in any 100 Myr (1 − e^(−100/667))', today.supernovaChancePercent, 13.9, 0.01);
checkRel('13 kly: a 54 % chance in any 100 Myr', inner.supernovaChancePercent, 54.2, 0.01);
check('an infinite interval means a 0 % chance', M.chanceWithinPercent(Infinity), 0, 1e-12);
assert('metallicity tiers: rich inside ≈ 24.7 kly, poor outside ≈ 29.5 kly', M.metallicityTier(27) === 'same' && M.metallicityTier(24) === 'rich' && M.metallicityTier(30) === 'poor' && M.metallicityTier(13) === 'rich' && M.metallicityTier(33) === 'poor');
assert('the Sun overtakes the pattern inside corotation and lags outside', M.neighbourhoodState(20).overtakesPattern && !M.neighbourhoodState(33).overtakesPattern && !today.overtakesPattern);
assert('only 27 kly counts as today', today.isToday && !M.neighbourhoodState(26.5).isToday && !M.neighbourhoodState(27.5).isToday);
assert('sunState() carries the same neighbourhood numbers', (() => {
  const s = M.sunState(20, 0);
  const n = M.neighbourhoodState(20);
  return Object.keys(n).every((k) => s.neighbourhood[k] === n[k]);
})());

console.log('— haze, dust lanes and globular clusters —');
const t1 = Date.now();
const haze = M.generateHaze(cfg, 4000);
const dust = M.generateDust(cfg, 6000);
const gcs = M.generateGlobularClusters(cfg);
const dressMs = Date.now() - t1;
assert('the three extra generators are fast (< 100 ms together)', dressMs < 100);
console.log(`  (generated in ${dressMs} ms)`);
check('haze count', haze.count, 4000, 0);
check('dust count', dust.count, 6000, 0);
check('globular-cluster count follows the config', gcs.count, cfg.globulars.count, 0);
assert('no NaN in haze / dust / globulars', [haze.positions, haze.colors, haze.sizes, dust.positions, dust.sizes, dust.strengths, gcs.positions, gcs.sizes].every((arr) => arr.every((v) => Number.isFinite(v))));
assert('deterministic for the same seed', (() => {
  const a = M.generateDust(cfg, 500);
  const b = M.generateDust(cfg, 500);
  const c = M.generateHaze(cfg, 500);
  const d = M.generateHaze(cfg, 500);
  return a.positions.every((v, i) => v === b.positions[i]) && c.positions.every((v, i) => v === d.positions[i]) && M.generateGlobularClusters(cfg, 50, 1).positions[0] !== M.generateGlobularClusters(cfg, 50, 2).positions[0];
})());
assert('haze lies inside the disc radius and its sizes are a few kly', (() => {
  for (let i = 0; i < haze.count; i++) {
    if (Math.hypot(haze.positions[i * 3], haze.positions[i * 3 + 2]) > cfg.discRadiusKly + 1e-6) return false;
    if (haze.sizes[i] < 1 || haze.sizes[i] > 7) return false;
  }
  return true;
})());
assert('haze colours are positive and never brighter than the palette', haze.colors.every((c) => c >= 0 && c <= 1.0001));
assert('dust is thin: ≥ 90 % within ±1 kly of the plane (σ_z = 0.3 kly)', (() => {
  let n = 0;
  for (let i = 0; i < dust.count; i++) if (Math.abs(dust.positions[i * 3 + 1]) <= 1) n++;
  return n / dust.count >= 0.9;
})());
assert('dust strengths are in 0…1', dust.strengths.every((v) => v > 0 && v <= 1));
between('dust lanes are three fifths of the dust budget', dust.kinds.filter((k) => k === M.DUST_KIND.lane).length / dust.count, 0.58, 0.62);
assert('dust lanes stay inside corotation + fade width and the diffuse disc within its radii', (() => {
  for (let i = 0; i < dust.count; i++) {
    const r = dust.radii[i];
    if (dust.kinds[i] === M.DUST_KIND.lane && r > cfg.sun.radiusKly + cfg.dust.fadeBeyondCorotationKly + 1e-6) return false;
    if (dust.kinds[i] === M.DUST_KIND.disc && (r < cfg.dust.discFromKly - 1e-6 || r > cfg.dust.discToKly + 1e-6)) return false;
  }
  return true;
})());
between('dust lanes hug the concave (inner) edge of the arms: mean signed offset ≈ −0.6 arm widths', (() => {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < dust.count; i++) {
    if (dust.kinds[i] !== M.DUST_KIND.lane) continue;
    const x = dust.positions[i * 3];
    const z = dust.positions[i * 3 + 2];
    const r = Math.hypot(x, z);
    const phi = Math.atan2(z, x);
    let best = Infinity;
    let width = 1;
    for (const arm of cfg.arms) {
      const d = M.distanceToArm(r, phi, arm);
      if (Math.abs(d) < Math.abs(best)) {
        best = d;
        width = arm.widthKly * (0.85 + 0.006 * r);
      }
    }
    sum += best / width;
    n++;
  }
  return sum / n;
})(), -0.75, -0.45);
between('globular clusters: median galactocentric radius ≈ 5 kpc (Harris catalogue)', (() => {
  const r = [...gcs.radii].sort((a, b) => a - b);
  return r[Math.floor(r.length / 2)];
})(), 13, 19);
between('globular clusters: two thirds or more inside the Sun’s radius', gcs.radii.filter((r) => r < cfg.sun.radiusKly).length / gcs.count, 0.65, 0.9);
assert('globular clusters stay within the configured halo radii', gcs.radii.every((r) => r >= cfg.globulars.minKly - 1e-6 && r <= cfg.globulars.maxKly + 1e-6));
between('globular clusters form a spheroid, not a disc (RMS |y| / RMS |x|)', (() => {
  let y2 = 0;
  let x2 = 0;
  for (let i = 0; i < gcs.count; i++) {
    y2 += gcs.positions[i * 3 + 1] ** 2;
    x2 += gcs.positions[i * 3] ** 2;
  }
  return Math.sqrt(y2 / x2);
})(), 0.6, 1.6);
assert('haze / dust / globular budgets do not touch the point mix (still sums to one)', Math.abs(Object.values(cfg.mix).reduce((a, b) => a + b, 0) - 1) < 1e-12 && Math.abs(cfg.haze.bulge + cfg.haze.arms + cfg.haze.disc - 1) < 1e-12);

console.log('— sampling helpers —');
const rnd = M.createRandom(7);
between('createRandom() is uniform on [0, 1)', (() => {
  let s = 0;
  for (let i = 0; i < 20000; i++) s += rnd();
  return s / 20000;
})(), 0.49, 0.51);
between('gauss() has unit variance', (() => {
  let s = 0;
  for (let i = 0; i < 20000; i++) {
    const v = rnd.gauss();
    s += v * v;
  }
  return s / 20000;
})(), 0.95, 1.05);
between('sampleDiscRadius() has the mean of Gamma(2, h) = 2h before truncation', (() => {
  let s = 0;
  const cfgWide = M.createConfig({ discRadiusKly: 1e6 });
  for (let i = 0; i < 20000; i++) s += M.sampleDiscRadius(rnd, cfgWide, { max: 1e6 });
  return s / 20000;
})(), 2 * cfg.discScaleLengthKly * 0.97, 2 * cfg.discScaleLengthKly * 1.03);

console.log(failed === 0 ? '\nAll galactic-zone checks passed.' : `\n${failed} check(s) FAILED.`);
process.exit(failed ? 1 : 0);
