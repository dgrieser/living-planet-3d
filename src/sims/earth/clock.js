/**
 * The simulation clock – one source of truth for "when" (pure JS).
 *
 *   simTime : UTC, float64 milliseconds since 1970 (JS Date semantics)
 *   rate    : simulated seconds per real second (0 = paused)
 *   mode    : 'live' | 'replay' | 'forecast' | 'climatology' – derived, never chosen
 *
 * `live` follows the wall clock at 1×; any scrub or rate change leaves it and "Now" returns to it.
 * The other modes follow from where simTime falls against the data that exists: the weather archive
 * (ERA5 reaches back to 1940), the forecast horizon (GFS: +16 days), and climatology beyond both.
 * See docs/earth-sim/10-time-ui-interaction.md §1.
 */

export const MS_PER_DAY = 86400000;

/** Rate presets (simulated seconds per real second). */
export const RATE_PRESETS = Object.freeze([
  { id: 'realtime', rate: 1 },
  { id: 'minute', rate: 60 },
  { id: 'tide', rate: 1800 },
  { id: 'day', rate: 86400 },
  { id: 'season', rate: 2592000 },
]);

/** Data availability that decides the mode. Updated by the weather client once feeds exist. */
export const DEFAULT_AVAILABILITY = Object.freeze({
  archiveStart: Date.UTC(1940, 0, 1), // ERA5 reanalysis
  forecastHorizonMs: 16 * MS_PER_DAY, // GFS global forecast
});

/** The range the clock accepts at all – astronomy stays exact far beyond it, the UI does not need more. */
export const TIME_RANGE = Object.freeze({ min: Date.UTC(1800, 0, 1), max: Date.UTC(2200, 11, 31, 23, 59, 59) });

/** Above this rate the renderer switches waves/clouds/precipitation to their time-lapse looks. */
export const TIMELAPSE_RATE = 600;

/**
 * Which kind of data describes `simTime`.
 * @param {number} simTime  ms UTC
 * @param {number} now      wall clock, ms UTC
 * @param {{ live?: boolean, availability?: typeof DEFAULT_AVAILABILITY }} [opts]
 * @returns {'live'|'replay'|'forecast'|'climatology'}
 */
export function deriveMode(simTime, now, { live = false, availability = DEFAULT_AVAILABILITY } = {}) {
  if (live) return 'live';
  if (simTime <= now) return simTime >= availability.archiveStart ? 'replay' : 'climatology';
  return simTime - now <= availability.forecastHorizonMs ? 'forecast' : 'climatology';
}

/**
 * @param {{ now?: () => number, simTime?: number, rate?: number, live?: boolean,
 *           availability?: typeof DEFAULT_AVAILABILITY }} [opts]
 */
export function createClock({ now = () => Date.now(), simTime, rate = 1, live = simTime === undefined, availability = DEFAULT_AVAILABILITY } = {}) {
  const state = {
    simTime: clampTime(simTime ?? now()),
    rate,
    live,
    playing: true,
  };
  const listeners = new Set();
  const emit = () => listeners.forEach((cb) => cb(api));

  const api = {
    get simTime() {
      return state.simTime;
    },
    get date() {
      return new Date(state.simTime);
    },
    get rate() {
      return state.rate;
    },
    get live() {
      return state.live;
    },
    get playing() {
      return state.playing;
    },
    /** The effective rate: 0 while paused. */
    get effectiveRate() {
      return state.live ? 1 : state.playing ? state.rate : 0;
    },
    get mode() {
      return deriveMode(state.simTime, now(), { live: state.live, availability });
    },
    get timelapse() {
      return api.effectiveRate > TIMELAPSE_RATE;
    },
    /**
     * Advance by a slice of real time.
     * @param {number} realDtSeconds
     * @returns {boolean} whether simTime changed
     */
    tick(realDtSeconds) {
      const before = state.simTime;
      if (state.live) {
        state.simTime = clampTime(now());
      } else if (state.playing && state.rate !== 0) {
        const next = clampTime(state.simTime + state.rate * realDtSeconds * 1000);
        if (next === TIME_RANGE.min || next === TIME_RANGE.max) state.playing = false; // ran into the end of the range
        state.simTime = next;
      }
      return state.simTime !== before;
    },
    /** Jump to an instant – leaves live mode. */
    setTime(ms) {
      state.simTime = clampTime(ms);
      state.live = false;
      emit();
    },
    /** Change the rate – leaves live mode (1× stays a replay at real speed). */
    setRate(r) {
      state.rate = r;
      state.live = false;
      emit();
    },
    setPlaying(v) {
      if (state.live && !v) state.live = false; // pausing freezes the current instant
      state.playing = v;
      emit();
    },
    /** Back to the wall clock at real time. */
    goLive() {
      state.live = true;
      state.rate = 1;
      state.playing = true;
      state.simTime = clampTime(now());
      emit();
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return api;
}

export function clampTime(ms) {
  return Math.min(TIME_RANGE.max, Math.max(TIME_RANGE.min, ms));
}

// ---------- local time ----------------------------------------------------------------------------------
const offsetFormatters = new Map();
/**
 * UTC offset (minutes) of an IANA time zone at an instant, from Intl – no tz database shipped.
 * Falls back to 0 when the zone is unknown to the browser.
 */
export function timeZoneOffsetMinutes(timeZone, ms) {
  if (!timeZone || timeZone === 'UTC') return 0;
  let fmt = offsetFormatters.get(timeZone);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    } catch {
      return 0;
    }
    offsetFormatters.set(timeZone, fmt);
  }
  const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/**
 * A place's clock: either an IANA zone (named places) or a fixed offset in whole hours from the
 * longitude (nautical time) for anywhere else on the globe.
 * @returns {{ offsetMinutes: (ms: number) => number, timeZone: string|null, label: (ms: number) => string }}
 */
export function placeTimeZone({ timeZone = null, lonDeg = 0 } = {}) {
  if (timeZone) {
    return { timeZone, offsetMinutes: (ms) => timeZoneOffsetMinutes(timeZone, ms), label: (ms) => formatUtcOffset(timeZoneOffsetMinutes(timeZone, ms)) };
  }
  const hours = Math.max(-12, Math.min(12, Math.round(lonDeg / 15)));
  return { timeZone: null, offsetMinutes: () => hours * 60, label: () => formatUtcOffset(hours * 60) };
}

export function formatUtcOffset(minutes) {
  if (minutes === 0) return 'UTC';
  const sign = minutes > 0 ? '+' : '−';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/** Local midnight (as a UTC instant) of the local day containing `ms`. */
export function localDayStart(ms, offsetMinutes) {
  const local = ms + offsetMinutes * 60000;
  const dayStartLocal = Math.floor(local / MS_PER_DAY) * MS_PER_DAY;
  return dayStartLocal - offsetMinutes * 60000;
}

/** Minutes after local midnight (0 … 1440). */
export function localMinuteOfDay(ms, offsetMinutes) {
  const local = ms + offsetMinutes * 60000;
  return (((local % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY) / 60000;
}
