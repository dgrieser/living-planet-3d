// Validates the Living Earth simulation clock (src/sims/earth/clock.js): live mode following the
// wall clock, scrubbing and rate changes leaving it, the derived mode (live / replay / forecast /
// climatology), the range clamp, and local-time helpers (time zone offsets incl. daylight saving,
// nautical time from the longitude, local midnight).
import * as C from '../src/sims/earth/clock.js';

let failed = 0;
const check = (label, actual, expected, tolerance = 0) => {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failed++;
  console.log(`${ok ? '✔' : '✖'} ${label}: ${actual} (expected ${expected}${tolerance ? ` ± ${tolerance}` : ''})`);
};
const equal = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? '✔' : '✖'} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
};

const H = 3600000;
const DAY = C.MS_PER_DAY;
let wall = Date.UTC(2026, 9, 31, 12, 0, 0);
const now = () => wall;

console.log('— live mode —');
const clock = C.createClock({ now });
equal('starts live', clock.live, true);
equal('mode', clock.mode, 'live');
wall += 5000;
clock.tick(0.016);
check('follows the wall clock, not the frame time', clock.simTime, wall);
equal('effective rate', clock.effectiveRate, 1);

console.log('— leaving live mode —');
clock.setRate(3600);
equal('a rate change leaves live mode', clock.live, false);
const t0 = clock.simTime;
clock.tick(2);
check('3600× for 2 s advances 2 h', clock.simTime - t0, 2 * H);
equal('2 h ahead of the wall clock is a forecast', clock.mode, 'forecast');
clock.setPlaying(false);
const t1 = clock.simTime;
clock.tick(10);
check('paused: time stands still', clock.simTime, t1);
equal('effective rate while paused', clock.effectiveRate, 0);
clock.setTime(Date.UTC(2015, 5, 1));
equal('a scrub into 2015 is a replay', clock.mode, 'replay');
clock.setTime(Date.UTC(1900, 0, 1));
equal('before the archive (ERA5 from 1940) is climatology', clock.mode, 'climatology');
clock.setTime(wall + 20 * DAY);
equal('beyond the forecast horizon (16 d) is climatology', clock.mode, 'climatology');
clock.goLive();
equal('"Now" returns to live', clock.live && clock.playing && clock.rate === 1, true);
check('… at the wall clock', clock.simTime, wall);
const paused = C.createClock({ now });
paused.setPlaying(false);
equal('pausing live mode freezes the instant (leaves live)', paused.live, false);

console.log('— range clamp —');
const c2 = C.createClock({ now, simTime: C.TIME_RANGE.max - 1000, rate: 86400 });
equal('a given simTime starts outside live mode', c2.live, false);
c2.tick(1);
check('clamped to the end of the range', c2.simTime, C.TIME_RANGE.max);
equal('playing stops at the end of the range', c2.playing, false);
c2.setTime(-1e16);
check('clamped to the start', c2.simTime, C.TIME_RANGE.min);
equal('time-lapse above 600×', C.createClock({ now, simTime: wall, rate: 1800 }).timelapse, true);
equal('no time-lapse at 60×', C.createClock({ now, simTime: wall, rate: 60 }).timelapse, false);

console.log('— mode derivation —');
equal('exactly now, not live → replay', C.deriveMode(wall, wall), 'replay');
equal('16 days ahead → forecast', C.deriveMode(wall + 16 * DAY, wall), 'forecast');
equal('custom availability (forecast 2 days)', C.deriveMode(wall + 3 * DAY, wall, { availability: { archiveStart: 0, forecastHorizonMs: 2 * DAY } }), 'climatology');

console.log('— local time —');
equal('Lübbecke in winter (CET)', C.timeZoneOffsetMinutes('Europe/Berlin', Date.UTC(2026, 0, 15, 12)), 60);
equal('Lübbecke in summer (CEST)', C.timeZoneOffsetMinutes('Europe/Berlin', Date.UTC(2026, 6, 15, 12)), 120);
equal('Fanø in summer (CEST)', C.timeZoneOffsetMinutes('Europe/Copenhagen', Date.UTC(2026, 6, 15, 12)), 120);
equal('DST ends 2026-10-25 01:00 UTC: one minute before', C.timeZoneOffsetMinutes('Europe/Berlin', Date.UTC(2026, 9, 25, 0, 59)), 120);
equal('… and one minute after', C.timeZoneOffsetMinutes('Europe/Berlin', Date.UTC(2026, 9, 25, 1, 1)), 60);
equal('unknown zone falls back to UTC', C.timeZoneOffsetMinutes('Not/AZone', Date.UTC(2026, 0, 1)), 0);
equal('nautical time at 8.6° E', C.placeTimeZone({ lonDeg: 8.6 }).label(0), 'UTC+1');
equal('nautical time at 122.4° W', C.placeTimeZone({ lonDeg: -122.4 }).label(0), 'UTC−8');
equal('offset label with minutes (India)', C.formatUtcOffset(330), 'UTC+5:30');
const noonCest = Date.UTC(2026, 6, 15, 10, 0); // 12:00 CEST
equal('local midnight of 15 Jul in CEST', new Date(C.localDayStart(noonCest, 120)).toISOString(), '2026-07-14T22:00:00.000Z');
check('minute of day at 12:00 CEST', C.localMinuteOfDay(noonCest, 120), 720);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
