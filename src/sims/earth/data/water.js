/**
 * The water level around Fanø at the simulated instant (milestone M5, docs/earth-sim/04 §4, 07 §3):
 *
 *  1. **observed** – DMI's gauges Esbjerg Havn I, else II (10-minute values since 2001, DVR90, open ocean API
 *     with CORS): the real level including storm surges, for every past instant;
 *  2. **predicted** – DMI's official tide predictions for Nordby, for later instants and the gauges' gaps;
 *  3. **model** – our harmonic constants (data/tides.js) for everything else (before 2001, beyond the
 *     published predictions, offline).
 * Days are fetched one at a time as the clock reaches them and kept in memory.
 */
import { TIDE_STATIONS } from './tideConstants.js';
import { predictTide, findExtremes } from './tides.js';

const API = 'https://opendataapi.dmi.dk/v2/oceanObs/collections';
const DAY = 86400000;
export const FANOE_WATER = Object.freeze({
  sources: [{ kind: 'observed', station: '25149' }, { kind: 'observed', station: '25151' }, { kind: 'predicted', station: '25139' }],
  model: 'nordby',
  firstObservation: Date.UTC(2001, 0, 1),
});

/** Linear interpolation in a sorted series; null outside it or across a gap of more than 30 minutes. */
export function interpolateSeries(times, values, t) {
  if (!times.length || t < times[0] || t > times[times.length - 1]) return null;
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  if (times[hi] - times[lo] > 30 * 60000) return null;
  const f = times[hi] === times[lo] ? 0 : (t - times[lo]) / (times[hi] - times[lo]);
  return values[lo] + f * (values[hi] - values[lo]);
}

export function createFanoeWater({ onChange }) {
  const station = TIDE_STATIONS[FANOE_WATER.model];
  const cache = new Map(); // `${kind}|${day}` → { status, times, values }
  let inFlight = 0;
  let lastRequest = 0;

  async function loadDay(src, day) {
    const key = `${src.station}|${day}`;
    const entry = { status: 'loading', times: [], values: [] };
    cache.set(key, entry);
    inFlight++;
    try {
      const a = new Date(day * DAY - 3600000).toISOString().slice(0, 19) + 'Z';
      const b = new Date((day + 1) * DAY + 3600000).toISOString().slice(0, 19) + 'Z';
      const url = src.kind === 'observed'
        ? `${API}/observation/items?stationId=${src.station}&parameterId=sealev_dvr&datetime=${a}/${b}&limit=1000`
        : `${API}/tidewater/items?stationId=${src.station}&datetime=${a}/${b}&limit=1000`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`DMI ${res.status}`);
      const json = await res.json();
      const pts = json.features
        .map((f) => [Date.parse(f.properties.observed ?? f.properties.predictionTime), f.properties.value / 100])
        .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
        .sort((x, y) => x[0] - y[0]);
      entry.times = pts.map((p) => p[0]);
      entry.values = pts.map((p) => p[1]);
      entry.status = pts.length ? 'ready' : 'empty';
    } catch {
      entry.status = 'failed';
    } finally {
      inFlight--;
      onChange?.();
    }
  }

  /** The sources worth asking for an instant, in order: gauges for the past, the prediction always. */
  const sourcesAt = (ms) => (ms < FANOE_WATER.firstObservation ? []
    : FANOE_WATER.sources.filter((src) => src.kind === 'predicted' || ms < Date.now() - 45 * 60000));

  function fromCache(ms) {
    const day = Math.floor(ms / DAY);
    for (const src of sourcesAt(ms)) {
      const e = cache.get(`${src.station}|${day}`);
      if (!e || e.status !== 'ready') continue;
      const v = interpolateSeries(e.times, e.values, ms);
      if (v !== null) return { level: v, source: src.kind };
    }
    return null;
  }

  return {
    /** Requests the day of the instant when it is missing (one request at a time, at most one a second). */
    update(ms, { allowFetch = true } = {}) {
      if (!allowFetch || inFlight > 0 || performance.now() - lastRequest < 1000 || fromCache(ms)) return;
      const day = Math.floor(ms / DAY);
      // the first source of the day not asked yet (a gauge with a gap moves on to the next)
      const src = sourcesAt(ms).find((x) => !cache.has(`${x.station}|${day}`));
      if (src) {
        lastRequest = performance.now();
        loadDay(src, day);
      }
    },
    /** Level (m, DVR90), its source and whether it is rising, at an instant. */
    level(ms) {
      const here = fromCache(ms) ?? { level: predictTide(station, ms), source: 'model' };
      const ahead = fromCache(ms + 15 * 60000)?.level ?? predictTide(station, ms + 15 * 60000);
      const behind = fromCache(ms - 15 * 60000)?.level ?? predictTide(station, ms - 15 * 60000);
      return { ...here, rising: ahead > behind };
    },
    /** The next high and low water after an instant (harmonic model – times within minutes of DMI's). */
    next(ms) {
      const ext = findExtremes((t) => predictTide(station, t), ms, ms + 14 * 3600000);
      return { high: ext.find((e) => e.high) ?? null, low: ext.find((e) => !e.high) ?? null };
    },
    dispose() {
      cache.clear();
    },
  };
}
