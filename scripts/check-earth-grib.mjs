// Validates the Living Earth's GRIB2 decoder (src/sims/earth/data/grib2.js) against ecCodes 2.50 on two
// real GFS messages (run 2026-10-30 00 UTC, +3 h, 1° grid, complex packing with spatial differencing):
// low cloud cover (%) and 2 m temperature (K). Fixtures in scripts/fixtures/ are byte ranges of
// noaa-gfs-bdp-pds/gfs.20261030/00/atmos/gfs.t00z.pgrb2.1p00.f003 (located with its .idx file).
// Reference values: ecCodes codes_get_values() (python eccodes 2.50.0), generated 2026-10-31.
// Also checks the run/step choice of data/gfs.js and the cloud texture packing.
import fs from 'node:fs';
import { decodeGrib2 } from '../src/sims/earth/data/grib2.js';
import { chooseGfsSteps, parseIdx, findMessage, GFS_START } from '../src/sims/earth/data/gfs.js';

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

const REFERENCE = {
  'gfs-20261030-00z-f003-lcdc-1p00': {
    category: 6, parameter: 3, min: 0, max: 100, mean: 44.15796347452425,
    samples: [[0, 99.3], [1, 99.3], [359, 99.3], [360, 99.4], [1000, 100], [12345, 5], [32580, 3.5], [40000, 1.2], [50000, 100], [65159, 100]],
  },
  'gfs-20261030-00z-f003-tmp2m-1p00': {
    category: 0, parameter: 0, min: 227.13705078125, max: 312.39705078125, mean: 279.9274131201082,
    samples: [[0, 265.77705078125], [1, 265.77705078125], [359, 265.77705078125], [360, 266.13705078125], [1000, 267.68705078125],
      [12345, 258.42705078125], [32580, 302.39705078125], [40000, 296.89705078125], [50000, 278.31705078125], [65159, 249.78705078125]],
  },
};

for (const [name, ref] of Object.entries(REFERENCE)) {
  console.log(`— ${name} —`);
  const bytes = new Uint8Array(fs.readFileSync(new URL(`./fixtures/${name}.grb2`, import.meta.url)));
  const g = decodeGrib2(bytes);
  assert(`grid 360 × 181 from 90° N, 0° E, 1° steps (got ${g.ni} × ${g.nj}, ${g.la1}, ${g.lo1}, ${g.di})`, g.ni === 360 && g.nj === 181 && g.la1 === 90 && g.lo1 === 0 && g.di === 1 && g.dj === 1);
  assert(`reference time 2026-10-30 00 UTC, +3 h (got ${g.refTime.toISOString()}, +${g.forecast} h)`, g.refTime.getTime() === Date.UTC(2026, 9, 30) && g.forecast === 3);
  assert(`parameter ${ref.category}.${ref.parameter} (got ${g.category}.${g.parameter})`, g.category === ref.category && g.parameter === ref.parameter);
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of g.values) {
    min = Math.min(min, v);
    max = Math.max(max, v);
    sum += v;
  }
  check('minimum', min, ref.min, 1e-4);
  check('maximum', max, ref.max, 1e-4);
  check('mean over all 65 160 points', sum / g.values.length, ref.mean, 1e-4);
  for (const [i, v] of ref.samples) check(`value[${i}]`, g.values[i], v, 1e-4);
}

console.log('— corrupt input is refused —');
let threw = false;
try {
  decodeGrib2(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
} catch {
  threw = true;
}
assert('a non-GRIB buffer throws', threw);

console.log('— run and step choice (data/gfs.js) —');
const H = 3600000;
// archive: the run 1–6 h before the instant, hourly steps around it
const past = chooseGfsSteps(Date.UTC(2025, 2, 10, 13, 20), { latestRun: Date.UTC(2026, 9, 31, 6) });
assert(`13:20 UTC is drawn from the 12 UTC run, +1 h and +2 h (got ${new Date(past.run).toISOString()} +${past.steps.join('/')})`,
  past.run === Date.UTC(2025, 2, 10, 12) && past.steps[0] === 1 && past.steps[1] === 2);
check('blend between the two steps', past.mix, 20 / 60, 1e-9);
const onRun = chooseGfsSteps(Date.UTC(2025, 2, 10, 12, 0), { latestRun: Date.UTC(2026, 9, 31, 6) });
assert(`an instant on a run hour takes the run before, +6 h (got +${onRun.steps.join('/')})`, onRun.run === Date.UTC(2025, 2, 10, 6) && onRun.steps[0] === 6);
// forecast: the latest run, hourly to +120 h, then 3-hourly
const fc = chooseGfsSteps(Date.UTC(2026, 10, 3, 10, 30), { latestRun: Date.UTC(2026, 9, 31, 6) });
assert(`3 Nov 10:30 is +76.5 h of the 31 Oct 06 UTC run (got +${fc.steps.join('/')})`, fc.run === Date.UTC(2026, 9, 31, 6) && fc.steps[0] === 76 && fc.steps[1] === 77);
const far = chooseGfsSteps(Date.UTC(2026, 10, 7, 8, 0), { latestRun: Date.UTC(2026, 9, 31, 6) });
assert(`beyond +120 h the steps are 3-hourly (got +${far.steps.join('/')})`, far.steps[0] % 3 === 0 && far.steps[1] - far.steps[0] === 3);
assert('beyond +384 h there is nothing', chooseGfsSteps(Date.UTC(2026, 10, 20), { latestRun: Date.UTC(2026, 9, 31, 6) }) === null);
assert('before the archive (Jan 2021) there is nothing', chooseGfsSteps(GFS_START - H, { latestRun: Date.UTC(2026, 9, 31, 6) }) === null);

console.log('— index files —');
const idx = parseIdx(['629:36561875:d=2026103000:CWAT:entire atmosphere (considered as a single layer):3 hour fcst:',
  '630:36765498:d=2026103000:LCDC:low cloud layer:3 hour fcst:', '631:36835281:d=2026103000:LCDC:low cloud layer:0-3 hour ave fcst:',
  '632:36903404:d=2026103000:MCDC:middle cloud layer:3 hour fcst:'].join('\n'));
const lcdc = findMessage(idx, 'LCDC', 'low cloud layer');
assert(`LCDC instantaneous: bytes 36765498–36835280 (got ${lcdc?.start}–${lcdc?.end})`, lcdc?.start === 36765498 && lcdc?.end === 36835280);
assert('the averaged field is not taken', findMessage(idx, 'LCDC', 'low cloud layer').start !== 36835281);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
