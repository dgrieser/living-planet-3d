// Checks the single-tree detection of the Living Earth (milestone M4, data/trees.js) on synthetic canopy
// height models with known answers: every crown found once at its top with its height, a flat roof and
// a gable roof rejected, small crowns next to tall ones kept, crown radii in range; the conifer test on
// leaf-off colour-infrared pixels; the leaf calendar.
import { detectTrees, isConifer, windowRadius } from '../src/sims/earth/data/trees.js';
import { leafCalendar } from '../src/sims/earth/render/trees.js';

let failed = 0;
const check = (label, actual, expected, tolerance, unit = '') => {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failed++;
  console.log(`${ok ? '✔' : '✖'} ${label}: ${Number(actual.toPrecision(10))}${unit} (expected ${expected}${unit} ± ${tolerance}${unit})`);
};
const assert = (label, condition) => {
  if (!condition) failed++;
  console.log(`${condition ? '✔' : '✖'} ${label}`);
};

// a 120 × 120 m canopy at 1 m with crowns as paraboloids of radius r and height h
const W = 120;
const H = 120;
const chm = new Float32Array(W * H);
const crowns = [
  { x: 20, y: 20, h: 28, r: 5 }, { x: 31, y: 21, h: 24, r: 4.5 }, { x: 22, y: 33, h: 30, r: 5.5 },
  { x: 60, y: 30, h: 8, r: 2.5 }, { x: 66, y: 30, h: 6, r: 2 }, { x: 90, y: 90, h: 18, r: 4 }, { x: 40, y: 80, h: 3.5, r: 1.5 },
];
for (const c of crowns) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d2 = (x - c.x) ** 2 + (y - c.y) ** 2;
      if (d2 <= c.r * c.r) chm[y * W + x] = Math.max(chm[y * W + x], c.h * (1 - 0.6 * (d2 / (c.r * c.r))));
    }
  }
}
// a flat roof (12 × 10 m at 7 m) and a gable roof (ridge along x, 6 → 10 m)
for (let y = 60; y < 70; y++) for (let x = 80; x < 92; x++) chm[y * W + x] = 7;
for (let y = 100; y < 110; y++) for (let x = 60; x < 75; x++) chm[y * W + x] = 10 - Math.abs(y - 104.5) * 0.8;

const trees = detectTrees(chm, W, H, 1);
console.log(`— ${trees.length} tops found —`);
for (const c of crowns) {
  const hits = trees.filter((t) => Math.hypot(t.x - c.x, t.y - c.y) <= 1.5);
  assert(`crown at (${c.x}, ${c.y}), ${c.h} m: found once (${hits.length})`, hits.length === 1);
  if (hits.length === 1) {
    check(`  height`, hits[0].height, c.h, c.h * 0.08, ' m');
    assert(`  crown radius ${hits[0].radius.toFixed(1)} m within 0.5–1.6 × ${c.r} m`, hits[0].radius >= 0.5 * c.r && hits[0].radius <= 1.6 * c.r);
  }
}
const onRoofs = trees.filter((t) => (t.x >= 79 && t.x <= 92 && t.y >= 59 && t.y <= 70) || (t.x >= 59 && t.x <= 75 && t.y >= 99 && t.y <= 110));
assert(`no trees on the flat and the gable roof (${onRoofs.length})`, onRoofs.length === 0);
assert(`no false tops (${trees.length} found for ${crowns.length} crowns)`, trees.length === crowns.length);
assert('the search window grows with the height', windowRadius(30) > windowRadius(8) && windowRadius(3) >= 1.5);

console.log('— species group from leaf-off colour infrared —');
assert('a spruce (bright near infrared, low red) is a conifer', isConifer(190, 90));
assert('a bare beech (grey-brown) is not', !isConifer(120, 110));
assert('a dark shadow pixel is not', !isConifer(40, 10));

console.log('— leaf calendar (lowland broadleaves) —');
check('foliage in January', leafCalendar(15).foliage, 0, 0);
check('foliage in July', leafCalendar(196).foliage, 1, 0);
assert(`leaf-out under way in late April (${leafCalendar(117).foliage.toFixed(2)})`, leafCalendar(117).foliage > 0.3 && leafCalendar(117).foliage < 0.7);
assert(`autumn colours in mid October (${leafCalendar(288).autumn.toFixed(2)})`, leafCalendar(288).autumn > 0.5);
check('bare again in late November', leafCalendar(330).foliage, 0, 0);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
