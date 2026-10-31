/**
 * Fits harmonic tide constants for the Fanø stations from DMI's open ocean data (CC BY 4.0) and checks them
 * against DMI's official predictions of other months – docs/earth-sim/07 §2 / 12 M5:
 *
 *   node tools/earth-pipeline/fit-tides.mjs
 *
 * Fit: least squares of Z0 + Σ f·[A cos(V+u) + B sin(V+u)] (data/tides.js arguments and nodal factors, 37
 * constituents) on DMI's hourly predictions January–October 2026 → H = √(A²+B²), g = atan2(B, A). (A year of
 * gauge observations was tried first: gaps and surges left 46 cm rms.) Test: high and low waters of the
 * model vs DMI's predictions of November 2026, which the fit has not seen. Writes src/sims/earth/data/tideConstants.js and
 * scripts/fixtures/dmi-extremes-2026-11.json (DMI's own extremes of the test month, for the offline check).
 */
import fs from 'node:fs';
import { constituentTerms, predictTide, findExtremes, CONSTITUENTS } from '../../src/sims/earth/data/tides.js';

const API = 'https://opendataapi.dmi.dk/v2/oceanObs/collections';
const STATIONS = [
  { id: 'esbjerg', name: 'Esbjerg Havn', pred: '25149' },
  { id: 'nordby', name: 'Nordby (Fanø)', pred: '25139' },
];
const NAMES = Object.keys(CONSTITUENTS);

async function series(collection, stationId, from, to, param) {
  const out = new Map();
  for (let t = Date.parse(from); t < Date.parse(to); t += 31 * 86400000) {
    const a = new Date(t).toISOString().slice(0, 19) + 'Z';
    const b = new Date(Math.min(t + 31 * 86400000, Date.parse(to))).toISOString().slice(0, 19) + 'Z';
    const q = param ? `&parameterId=${param}` : '';
    const res = await fetch(`${API}/${collection}/items?stationId=${stationId}${q}&datetime=${a}/${b}&limit=300000`);
    if (!res.ok) throw new Error(`${collection} ${stationId} ${res.status}`);
    const json = await res.json();
    for (const f of json.features) {
      const time = Date.parse(f.properties.observed ?? f.properties.predictionTime);
      if (time % 3600000 === 0) out.set(time, f.properties.value / 100); // hourly, cm → m
    }
  }
  return [...out].sort((x, y) => x[0] - y[0]);
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function fit(data) {
  const m = 1 + NAMES.length * 2;
  const AtA = Array.from({ length: m }, () => new Array(m).fill(0));
  const Atb = new Array(m).fill(0);
  for (const [t, y] of data) {
    const row = [1];
    for (const term of constituentTerms(t, NAMES)) {
      const ph = (term.phase * Math.PI) / 180;
      row.push(term.f * Math.cos(ph), term.f * Math.sin(ph));
    }
    for (let i = 0; i < m; i++) {
      Atb[i] += row[i] * y;
      for (let j = 0; j < m; j++) AtA[i][j] += row[i] * row[j];
    }
  }
  const x = solve(AtA, Atb);
  const constituents = {};
  NAMES.forEach((name, i) => {
    const A = x[1 + i * 2];
    const B = x[2 + i * 2];
    constituents[name] = { H: Math.round(Math.hypot(A, B) * 10000) / 10000, g: Math.round((((Math.atan2(B, A) * 180) / Math.PI + 360) % 360) * 100) / 100 };
  });
  return { z0: Math.round(x[0] * 10000) / 10000, constituents };
}

const results = {};
const fixtures = {};
for (const st of STATIONS) {
  const data = await series('tidewater', st.pred, '2026-01-01T00:00:00Z', '2026-11-01T00:00:00Z');
  const station = fit(data);
  let ss = 0;
  for (const [t, y] of data) ss += (predictTide(station, t) - y) ** 2;
  console.log(`${st.id}: fitted on ${data.length} hours, rms residual ${(Math.sqrt(ss / data.length) * 100).toFixed(1)} cm, M2 ${station.constituents.M2.H} m / ${station.constituents.M2.g}°`);
  results[st.id] = { name: st.name, dmiStation: st.pred, fittedOn: 'DMI predictions Jan–Oct 2026 (hourly)', ...station };
  // test month: November 2026, DMI's 10-minute predictions
  const test = await (async () => {
    const out = [];
    const res = await fetch(`${API}/tidewater/items?stationId=${st.pred}&datetime=2026-11-01T00:00:00Z/2026-12-01T00:00:00Z&limit=300000`);
    const json = await res.json();
    for (const f of json.features) out.push([Date.parse(f.properties.predictionTime), f.properties.value / 100]);
    return out.sort((x, y) => x[0] - y[0]);
  })();
  const dmiLevel = (t) => {
    let i = test.findIndex((p) => p[0] >= t);
    if (i <= 0) i = 1;
    const [t0, y0] = test[i - 1];
    const [t1, y1] = test[Math.min(i, test.length - 1)];
    return t1 === t0 ? y0 : y0 + ((y1 - y0) * (t - t0)) / (t1 - t0);
  };
  const from = Date.parse('2026-11-01T06:00:00Z');
  const to = Date.parse('2026-11-30T18:00:00Z');
  const dmiExt = findExtremes(dmiLevel, from, to, 10 * 60000);
  const ours = findExtremes((t) => predictTide(station, t), from, to);
  let dt = 0;
  let dh = 0;
  let n = 0;
  for (const e of dmiExt) {
    const o = ours.filter((x) => x.high === e.high).sort((a, b) => Math.abs(a.time - e.time) - Math.abs(b.time - e.time))[0];
    if (!o) continue;
    dt = Math.max(dt, Math.abs(o.time - e.time) / 60000);
    dh = Math.max(dh, Math.abs(o.level - e.level) * 100);
    n++;
  }
  console.log(`  November 2026 vs DMI predictions: ${n} extremes, worst ${dt.toFixed(1)} min, ${dh.toFixed(1)} cm`);
  fixtures[st.id] = dmiExt.map((e) => ({ time: new Date(Math.round(e.time / 60000) * 60000).toISOString(), level: Math.round(e.level * 1000) / 1000, high: e.high }));
}

fs.writeFileSync('src/sims/earth/data/tideConstants.js', `// Generated by tools/earth-pipeline/fit-tides.mjs – do not edit.
// Harmonic constants (H in m, Greenwich phase lag g in degrees, heights DVR90) for the Fanø stations, fitted
// to DMI open ocean data (CC BY 4.0, Danmarks Meteorologiske Institut).
export const TIDE_STATIONS = Object.freeze(${JSON.stringify(results, null, 2)});
`);
fs.writeFileSync('scripts/fixtures/dmi-extremes-2026-11.json', JSON.stringify(fixtures));
console.log('wrote src/sims/earth/data/tideConstants.js and scripts/fixtures/dmi-extremes-2026-11.json');
