// Validates the persisted view preferences (src/lib/prefs.js): defaults when
// nothing is stored, stored values winning, hostile/corrupt entries being
// ignored, set() round-tripping, and localStorage failures degrading to memory.
import { STORAGE_PREFIX, createViewPrefs } from '../src/lib/prefs.js';

let failed = 0;
const assert = (label, condition) => {
  if (!condition) failed++;
  console.log(`${condition ? '✔' : '✖'} ${label}`);
};
const equal = (label, actual, expected) =>
  assert(`${label}: ${JSON.stringify(actual)}`, JSON.stringify(actual) === JSON.stringify(expected));

/** Minimal localStorage stub; `throws` simulates privacy mode / blocked site data. */
function stubStorage({ seed = {}, throws = false } = {}) {
  const map = new Map(Object.entries(seed));
  globalThis.localStorage = {
    getItem(k) {
      if (throws) throw new Error('blocked');
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      if (throws) throw new Error('blocked');
      map.set(k, v);
    },
  };
  return map;
}

const DEFAULTS = Object.freeze({ showAxis: true, showLabels: true, showHeat: false });
const KEY = `${STORAGE_PREFIX}seasons`;

// --- nothing stored → defaults, and nothing written until a change ------------------------------
{
  const store = stubStorage();
  const prefs = createViewPrefs('seasons', DEFAULTS);
  equal('empty storage falls back to the defaults', prefs.values, DEFAULTS);
  assert('reading does not write', !store.has(KEY));
}

// --- stored values win, and only for keys we still know ------------------------------------------
{
  stubStorage({ seed: { [KEY]: JSON.stringify({ showAxis: false, showHeat: true }) } });
  const prefs = createViewPrefs('seasons', DEFAULTS);
  equal('stored values override the defaults', prefs.values, { showAxis: false, showLabels: true, showHeat: true });
}
{
  stubStorage({ seed: { [KEY]: JSON.stringify({ showAxis: 'nope', showGone: true, showLabels: false }) } });
  const prefs = createViewPrefs('seasons', DEFAULTS);
  equal('retyped and unknown keys are ignored', prefs.values, { showAxis: true, showLabels: false, showHeat: false });
  assert('unknown keys are not adopted', !('showGone' in prefs.values));
}

// --- corrupt entries fall back to the defaults ---------------------------------------------------
for (const [label, raw] of [
  ['garbage', 'not json at all'],
  ['a JSON array', '[1,2,3]'],
  ['JSON null', 'null'],
  ['a JSON string', '"showAxis"'],
]) {
  stubStorage({ seed: { [KEY]: raw } });
  equal(`${label} falls back to the defaults`, createViewPrefs('seasons', DEFAULTS).values, DEFAULTS);
}

// --- set() round-trips the whole object, and rejects unknown names --------------------------------
{
  const store = stubStorage();
  const prefs = createViewPrefs('seasons', DEFAULTS);
  prefs.set('showAxis', false);
  equal('set() updates values', prefs.values.showAxis, false);
  equal('set() persists every key', JSON.parse(store.get(KEY)), { showAxis: false, showLabels: true, showHeat: false });

  prefs.set('showGone', true);
  assert('set() ignores unknown names', !('showGone' in prefs.values) && !('showGone' in JSON.parse(store.get(KEY))));

  // a fresh mount sees what the previous one stored
  equal('a later mount reads the stored view', createViewPrefs('seasons', DEFAULTS).values, { showAxis: false, showLabels: true, showHeat: false });
}

// --- one entry per simulation --------------------------------------------------------------------
{
  const store = stubStorage();
  createViewPrefs('seasons', DEFAULTS).set('showAxis', false);
  createViewPrefs('moon-tides', DEFAULTS).set('showLabels', false);
  equal('seasons keeps its own entry', JSON.parse(store.get(KEY)).showAxis, false);
  equal('moon-tides gets a separate entry', JSON.parse(store.get(`${STORAGE_PREFIX}moon-tides`)), { showAxis: true, showLabels: false, showHeat: false });
}

// --- privacy mode: no throw, in-memory only ------------------------------------------------------
{
  stubStorage({ throws: true });
  const prefs = createViewPrefs('seasons', DEFAULTS);
  equal('blocked storage still yields the defaults', prefs.values, DEFAULTS);
  prefs.set('showAxis', false);
  equal('blocked storage keeps the change in memory', prefs.values.showAxis, false);
}

// --- no localStorage at all (e.g. a non-browser host) --------------------------------------------
{
  delete globalThis.localStorage;
  const prefs = createViewPrefs('seasons', DEFAULTS);
  equal('a missing localStorage yields the defaults', prefs.values, DEFAULTS);
  prefs.set('showAxis', false);
  equal('a missing localStorage keeps the change in memory', prefs.values.showAxis, false);
}

console.log(failed ? `✖ ${failed} check(s) failed` : '✔ all view-preference checks passed');
process.exit(failed ? 1 : 0);
