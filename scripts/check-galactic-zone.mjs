// Validates the galactic-zone model (src/sims/galactic-zone/model.js):
// the Sun's orbit (period, speed, galactic years), zone classification with
// configurable edges, the metallicity gradient and the schematic supernova
// hazard, the logarithmic-arm geometry (Sun on the Orion spur, trailing arms,
// arm order along the Sun's radius) and the statistical properties of the
// generated 50 000-point galaxy (density falling with radius, arm contrast,
// thin disc, determinism).
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
