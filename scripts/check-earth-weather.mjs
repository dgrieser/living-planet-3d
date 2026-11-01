/**
 * Checks of the M6 weather (docs/earth-sim/12 §1.7):
 *
 *  1. the byte encodings the GPU reads (precipitation, ceiling, cloud top), wind direction, the read-back of
 *     EUMETSAT's cloud renderings, the satellite–model fusion, the terrain correction, the cloud noise
 *     (seamless, equalised), the drop count, the low cloud layer's heights, the exposure that follows the light
 *     near the ground, the preset views that go under a low deck;
 *  2. the exit criteria on the test-day fixture (tools/earth-pipeline/weather-testdays.mjs): cloud cover
 *     against station observations and the satellite, precipitation timing against stations and radar,
 *     10 m wind against stations – scored with the simulation's own functions.
 */
import fs from 'node:fs';
import {
  encodePrecip, decodePrecip, encodeCeiling, decodeCeiling, encodeCloudTop, decodeCloudTop, windFrom, compassPoint,
  classifyCloudMask, cloudTopHeight, CTH_STOPS, fuseCover, rainUnderCloud, terrainCorrection, SAT_BROKEN, SAT_THIN,
  snowFraction, lowCloudLayer,
} from '../src/sims/earth/data/weatherCodes.js';
import { exposureFactor, groundIlluminance, shadingCover, EXPOSURE_ADAPT } from '../src/sims/earth/render/exposure.js';
import { poseUnderDeck, DECK_CLEARANCE_M } from '../src/sims/earth/places.js';
import { packSatellite, satelliteSlot, satelliteWeight, SATELLITE } from '../src/sims/earth/data/satellite.js';
import { generateCloudNoise } from '../src/sims/earth/render/cloudNoise.js';
import { dropCount } from '../src/sims/earth/render/precipitation.js';

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '✔' : '✖'} ${label}${detail ? ` – ${detail}` : ''}`);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// --- 1. encodings ------------------------------------------------------------------------------------------------------
{
  let worst = 0;
  for (const r of [0.012, 0.1, 0.5, 1, 3, 10, 40, 99]) worst = Math.max(worst, Math.abs(decodePrecip(encodePrecip(r)) / r - 1));
  check('precipitation code round trip 0.01…100 mm/h', worst < 0.02, `worst ${(worst * 100).toFixed(1)} %`);
  check('no precipitation encodes as 0 and decodes as 0', encodePrecip(0) === 0 && encodePrecip(0.005) === 0 && decodePrecip(0) === 0);
  check('precipitation code is monotonic', [0.02, 0.2, 2, 20].every((r, i, a) => i === 0 || encodePrecip(r) > encodePrecip(a[i - 1])));
  const ceil = [30, 100, 300, 800, 2000, 6000].map((m) => Math.abs(decodeCeiling(encodeCeiling(m)) - m) / Math.max(m, 50));
  check('ceiling round trip (square-root spacing)', Math.max(...ceil) < 0.08, `worst ${(Math.max(...ceil) * 100).toFixed(1)} %`);
  check('"no ceiling" encodes as the top, not the ground', encodeCeiling(NaN) === 255 && encodeCeiling(20000) === 255 && decodeCeiling(255) === 12000);
  check('cloud-top code round trip', near(decodeCloudTop(encodeCloudTop(5432)), 5432, 40) && encodeCloudTop(null) === 0 && decodeCloudTop(0) === null);
  check('snow fraction from the GFS types', snowFraction(0, 1, 0, 0) === 1 && snowFraction(1, 0, 0, 0) === 0 && snowFraction(1, 1, 0, 0) === 0.5 && snowFraction(0, 0, 0, 1) === 0.6 && snowFraction(0, 0, 1, 0) === 0);
}
{
  const w = windFrom(5, 0);
  const n = windFrom(0, -7);
  check('wind direction: u > 0 blows from the west, v < 0 from the north', near(w.fromDeg, 270, 1e-9) && near(n.fromDeg, 0, 1e-9) && near(n.speed, 7, 1e-12));
  check('compass points', compassPoint(0) === 'N' && compassPoint(44) === 'NE' && compassPoint(200) === 'S' && compassPoint(359) === 'N' && compassPoint(-90) === 'W');
}

// --- EUMETSAT read-back ----------------------------------------------------------------------------------------------
{
  check('cloud mask colours: white cloud, green land, blue sea, transparent none',
    classifyCloudMask(255, 255, 255, 255) === 1 && classifyCloudMask(0, 192, 0, 255) === 0 && classifyCloudMask(0, 0, 255, 255) === 0 && classifyCloudMask(0, 0, 0, 0) === -1);
  let worst = 0;
  for (const [r, g, b, m] of CTH_STOPS) worst = Math.max(worst, Math.abs(cloudTopHeight(r, g, b, 255) - m));
  check('cloud-top legend: each stop reads back its own height', worst === 0, `${CTH_STOPS.length} stops`);
  const mono = CTH_STOPS.every((s, i) => i === 0 || s[3] > CTH_STOPS[i - 1][3]);
  check('cloud-top legend spans 320…16 000 m, increasing', mono && CTH_STOPS[0][3] < 500 && CTH_STOPS.at(-1)[3] > 15500);
  check('cloud-top: a colour far from the legend reads as unknown', cloudTopHeight(0, 255, 255, 0) === null && cloudTopHeight(128, 128, 0, 255) === null);
  // 2 × 1 mask (cloud, clear land), top at the same size
  const mask = new Uint8Array([255, 255, 255, 255, 0, 192, 0, 255]);
  const [r, g, b] = CTH_STOPS[60];
  const top = new Uint8Array([r, g, b, 255, 0, 0, 0, 0]);
  const p = packSatellite(mask, 2, 1, top, 2, 1);
  check('satellite packing: cloud + top, clear, validity', p.data[0] === 255 && near(decodeCloudTop(p.data[1]), CTH_STOPS[60][3], 70) && p.data[2] === 255 && p.data[4] === 0 && p.data[6] === 255 && p.cloudy === 1 && p.valid === 2);
  const now = Date.UTC(2026, 9, 31, 12, 0);
  check('satellite slot: quarter hours, not before the archive, not before it is published',
    satelliteSlot(Date.UTC(2026, 5, 1, 10, 7), now) === Date.UTC(2026, 5, 1, 10, 0) && satelliteSlot(Date.UTC(2019, 0, 1), now) === null && satelliteSlot(now, now) <= now - 20 * 60000);
  check('satellite weight: full within 20 min, gone after an hour', satelliteWeight(0, 15 * 60000) === 1 && satelliteWeight(0, 60 * 60000) === 0 && near(satelliteWeight(0, 40 * 60000), 0.5, 1e-9));
  check('satellite box covers both hero areas', SATELLITE.box.south < 52 && SATELLITE.box.north > 56 && SATELLITE.box.west < 8 && SATELLITE.box.east > 9);
}

// --- fusion, rain, terrain --------------------------------------------------------------------------------------------
{
  const model = { low: 0.8, middle: 0.5, high: 0.3 };
  const clear = fuseCover(model, { cloud: 0, topM: null, valid: 1 }, 1);
  check('fusion: satellite clear thins the model cloud', near(clear.low, 0.8 * SAT_THIN, 1e-9) && near(clear.high, 0.3 * SAT_THIN, 1e-9));
  const cu = fuseCover({ low: 0, middle: 0, high: 0 }, { cloud: 1, topM: 1800, valid: 1 }, 1);
  check('fusion: satellite cloud with a low top where the model has none → a broken low field', near(cu.low, SAT_BROKEN, 1e-9) && cu.middle < 1e-9 && cu.high < 1e-9);
  const ci = fuseCover({ low: 0.6, middle: 0, high: 0 }, { cloud: 1, topM: 10500, valid: 1 }, 1);
  check('fusion: a high top adds cirrus and keeps the model\'s low cloud', near(ci.high, 1, 1e-9) && near(ci.low, 0.6, 1e-9));
  check('fusion: no picture, no change', fuseCover(model, null, 1).low === 0.8 && fuseCover(model, { cloud: 0, topM: null, valid: 1 }, 0).low === 0.8);
  check('rain only under cloud', rainUnderCloud(2, 0) === 0 && rainUnderCloud(2, 1) === 2 && rainUnderCloud(2, 0.25) > 0 && rainUnderCloud(2, 0.25) < 2);
  const tc = terrainCorrection({ windSpeed: 8, tempC: 10, groundHeight: 250, modelHeight: 150 });
  check('terrain correction: 100 m above the model ground → −0.65 K, wind unchanged', near(tc.tempC, 9.35, 1e-9) && tc.windSpeed === 8);
  check('terrain correction without heights changes nothing', terrainCorrection({ windSpeed: 5, tempC: 3, groundHeight: null, modelHeight: 100 }).tempC === 3);
}

// --- cloud noise ---------------------------------------------------------------------------------------------------------
{
  const S = 24;
  const n = generateCloudNoise(S);
  let seam = 0;
  let inner = 0;
  for (let z = 0; z < S; z++) {
    for (let y = 0; y < S; y++) {
      for (let c = 0; c < 4; c++) {
        seam += Math.abs(n[((z * S + y) * S + S - 1) * 4 + c] - n[((z * S + y) * S) * 4 + c]);
        inner += Math.abs(n[((z * S + y) * S + S / 2 - 1) * 4 + c] - n[((z * S + y) * S + S / 2) * 4 + c]);
      }
    }
  }
  check('cloud noise tiles seamlessly (wrap step ≈ inner step)', seam < inner * 1.4, `${(seam / S / S / 4).toFixed(1)} vs ${(inner / S / S / 4).toFixed(1)}`);
  const hist = new Array(4).fill(0);
  for (let i = 0; i < n.length; i += 4) hist[n[i] >> 6]++;
  const share = hist.map((h) => h / (n.length / 4));
  check('cloud noise R is equalised: a cover c makes the share c cloud', share.every((x) => near(x, 0.25, 0.03)), share.map((x) => x.toFixed(2)).join(' '));
}
check('drops: none when dry, more in heavier rain, snow fills more of the box', dropCount(0) === 0 && dropCount(0.5) < dropCount(5) && dropCount(1, 1) > dropCount(1, 0) && dropCount(100) === 14000);

// --- low layer, exposure, views under the deck ---------------------------------------------------------------------
{
  const deck = lowCloudLayer({ ceilingM: 790, convective: 0 });
  check('low layer from the ceiling: base 790 m, stratus 500 m deep', deck.base === 790 && deck.top === 1290, JSON.stringify(deck));
  const none = lowCloudLayer({ ceilingM: 12000, convective: 0.5 });
  check('no ceiling: cumulus base 1 km, 1.5 km deep when convective', none.base === 1000 && none.top === 2500, JSON.stringify(none));
  const satTop = lowCloudLayer({ ceilingM: 600, convective: 0 }, { cloud: 1, topM: 1800, valid: 1 }, 1);
  check('the satellite moves the low top to its cloud top', near(satTop.top, 1800, 1e-6), JSON.stringify(satTop));

  const june = exposureFactor({ muS: 0.87, cover: 0, altitudeM: 500 });
  const nov = exposureFactor({ muS: 0.3, cover: shadingCover({ low: 1 }), altitudeM: 500 });
  check('exposure: clear June noon below the base, overcast November above it', june < 0.85 && nov > 1.4, `${june.toFixed(2)} / ${nov.toFixed(2)}`);
  check('exposure: the night and the view from orbit keep the base exposure',
    exposureFactor({ muS: -0.3, cover: 0.9, altitudeM: 500 }) === 1 && near(exposureFactor({ muS: 0.3, cover: 1, altitudeM: 400000 }), 1, 1e-9));
  let monotone = true;
  for (let c = 0; c < 1; c += 0.05) monotone &&= exposureFactor({ muS: 0.5, cover: c + 0.05, altitudeM: 500 }) >= exposureFactor({ muS: 0.5, cover: c, altitudeM: 500 });
  check('exposure rises with the cover, stays within its limits', monotone && exposureFactor({ muS: 0.01, cover: 1, altitudeM: 0 }) <= EXPOSURE_ADAPT.max + 1e-9);
  check('exposure drops over a sea of cloud below the camera', exposureFactor({ muS: 0.5, cover: 0, below: 1, altitudeM: 3000 }) < exposureFactor({ muS: 0.5, cover: 0, altitudeM: 3000 }));
  check('ground light: overcast passes a fifth to a half of the clear-sky light', (() => {
    const r = groundIlluminance(0.6, 1) / groundIlluminance(0.6, 0);
    return r > 0.2 && r < 0.5;
  })());

  const view = { latDeg: 52.352, lonDeg: 8.62, heightM: 1500, headingDeg: 180, pitchDeg: -16 };
  const under = poseUnderDeck(view, { baseM: 830, topM: 1330, cover: 1, groundM: 90 });
  const reach = (p) => (p.heightM - 90) / Math.tan((-p.pitchDeg * Math.PI) / 180);
  check('overcast at 830 m: the view comes down under the base and looks at the same ground point',
    under.heightM === 830 - DECK_CLEARANCE_M && near(reach(under), reach(view), 1), `${under.heightM} m, pitch ${under.pitchDeg.toFixed(1)}°`);
  check('inside a broken layer the view comes down too', poseUnderDeck(view, { baseM: 1000, topM: 2500, cover: 0.6, groundM: 90 }).underDeck === true);
  check('above broken cloud, under thin cloud and over fog the view stays',
    !poseUnderDeck({ ...view, heightM: 3000 }, { baseM: 800, topM: 1300, cover: 0.6, groundM: 90 }).underDeck &&
    !poseUnderDeck(view, { baseM: 830, topM: 1330, cover: 0.3, groundM: 90 }).underDeck &&
    !poseUnderDeck(view, { baseM: 150, topM: 650, cover: 1, groundM: 90 }).underDeck);
}

// --- 2. the exit criteria on the test days -----------------------------------------------------------------------------
const fixtureUrl = new URL('./fixtures/weather-testdays-2026.json', import.meta.url);
if (!fs.existsSync(fixtureUrl)) {
  check('weather test-day fixture present (node tools/earth-pipeline/weather-testdays.mjs)', false);
} else {
  const fx = JSON.parse(fs.readFileSync(fixtureUrl, 'utf8'));
  const total = (c) => 1 - (1 - c.low) * (1 - c.middle) * (1 - c.high);
  const rows = [];
  for (const r of fx.records) {
    for (const id of Object.keys(fx.stations)) {
      const g = r.gfs[id];
      const sat = r.sat?.[id] ?? null;
      const fused = fuseCover(g, sat, sat ? 1 : 0);
      rows.push({ id, set: r.set, t: r.t, g, sat, fused, obs: r.obs[id], radar: id === 'luebbecke' ? r.radar : undefined, station: fx.stations[id] });
    }
  }
  // cloud cover vs the stations' automatic (ceilometer) cloud amount. Ceilometers miss high cloud and the
  // satellite misses some low cloud at night, so the two observations disagree too: the sim must come within
  // 30 % (2.4 octas) or within 5 points of the satellite picture's own disagreement with the station, and the
  // satellite placement must improve on the model alone.
  for (const id of Object.keys(fx.stations)) {
    const rs = rows.filter((x) => x.id === id && x.obs.cloud !== null && x.sat && x.sat.frac !== null);
    const mae = (f) => rs.reduce((s, x) => s + Math.abs(100 * f(x) - x.obs.cloud), 0) / rs.length;
    const model = mae((x) => total(x.g));
    const fused = mae((x) => total(x.fused));
    const satOwn = mae((x) => x.sat.frac);
    check(`cloud cover vs ${fx.stations[id].name}: within 30 % or the satellite's own error + 5, better than the model alone`,
      fused <= Math.max(30, satOwn + 5) && fused < model,
      `model ${model.toFixed(1)} %, with satellite ${fused.toFixed(1)} %, satellite picture itself ${satOwn.toFixed(1)} % (${rs.length} hours)`);
  }
  // cloudy / clear against the satellite's own picture around the station
  {
    const rs = rows.filter((x) => x.sat && x.sat.frac !== null);
    const agree = (f) => rs.filter((x) => (f(x) >= 0.5) === (x.sat.frac >= 0.5)).length / rs.length;
    const model = agree((x) => total(x.g));
    const fused = agree((x) => total(x.fused));
    check('cloudy/clear agrees with the satellite picture (≥ 85 % of station hours)', fused >= 0.85, `model alone ${(model * 100).toFixed(0)} %, with satellite ${(fused * 100).toFixed(0)} % (${rs.length})`);
  }
  // precipitation timing: hours with ≥ 0.1 mm/h in the sim vs observed (stations: the hour before or after; radar)
  const score = (rs, wetObs) => {
    let hit = 0;
    let miss = 0;
    let fa = 0;
    let cn = 0;
    for (const x of rs) {
      const sim = rainUnderCloud(x.g.precip, Math.max(x.fused.low, x.fused.middle)) >= 0.1;
      const o = wetObs(x);
      if (sim && o) hit++;
      else if (!sim && o) miss++;
      else if (sim && !o) fa++;
      else cn++;
    }
    return { n: rs.length, acc: (hit + cn) / rs.length, pod: hit / Math.max(1, hit + miss), far: fa / Math.max(1, hit + fa), hit, miss, fa };
  };
  const fmt = (s) => `${(s.acc * 100).toFixed(0)} % of ${s.n} hours agree, POD ${(s.pod * 100).toFixed(0)} %, FAR ${(s.far * 100).toFixed(0)} %`;
  {
    const rs = rows.filter((x) => x.obs.precip.some((v) => v !== null));
    const s = score(rs, (x) => x.obs.precip.some((v) => v >= 0.1));
    check('precipitation timing vs station gauges (hourly, ±1 h): ≥ 75 % agree', s.acc >= 0.75, fmt(s));
  }
  {
    const rs = rows.filter((x) => x.radar !== undefined && x.radar !== null);
    if (rs.length) {
      const s = score(rs, (x) => x.radar >= 0.1);
      check('precipitation timing vs DWD radar at Lübbecke (hourly): ≥ 75 % agree', s.acc >= 0.75, fmt(s));
    } else check('radar instants present in the fixture', false);
  }
  // wind vs stations, terrain-corrected (GFS 10 m wind errors are ≈ 1.5–2.5 m/s rms)
  for (const id of Object.keys(fx.stations)) {
    const rs = rows.filter((x) => x.id === id && x.obs.wind !== null);
    const st = fx.stations[id];
    const sim = (x) => terrainCorrection({ windSpeed: Math.hypot(x.g.u10, x.g.v10), tempC: 0, groundHeight: st.heightM, modelHeight: st.modelHeight }).windSpeed;
    const rmse = (f) => Math.sqrt(rs.reduce((s, x) => s + (f(x) - x.obs.wind) ** 2, 0) / rs.length);
    const bias = rs.reduce((s, x) => s + sim(x) - x.obs.wind, 0) / rs.length;
    check(`10 m wind vs ${st.name}: rms error ≤ 2.5 m/s (within NWP error), |bias| ≤ 1.5 m/s`, rmse(sim) <= 2.5 && Math.abs(bias) <= 1.5,
      `rms ${rmse(sim).toFixed(2)} m/s, bias ${bias >= 0 ? '+' : ''}${bias.toFixed(2)} m/s, ${rs.length} hours`);
  }
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nall weather checks passed');
