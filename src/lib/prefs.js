/**
 * Persisted view preferences.
 *
 * Every simulation panel mixes two kinds of controls: the physics the visitor is
 * experimenting with (tilt, date, speed, luminosity, playing) and the chrome
 * they want to look at while doing it (legends, labels, helper lines, overlays).
 * Only the chrome is remembered here — a reload always starts the simulation
 * itself from the teaching defaults.
 *
 * One localStorage entry per simulation, keyed `lp-view:<sim-id>`, holding a JSON
 * object of the sim's VIEW_DEFAULTS keys. Mirrors the language preference in
 * i18n.js: reads and writes are wrapped so privacy mode degrades to in-memory.
 *
 *   const viewPrefs = createViewPrefs(meta.id, VIEW_DEFAULTS);
 *   const state = { ...DEFAULTS, ...viewPrefs.values };
 */
export const STORAGE_PREFIX = 'lp-view:';

/**
 * @param {string} simId  registry id of the simulation (see sims/index.js)
 * @param {Record<string, boolean>} defaults  the sim's VIEW_DEFAULTS
 * @returns {{ values: Record<string, boolean>, set: (name: string, value: boolean) => void }}
 */
export function createViewPrefs(simId, defaults) {
  const storageKey = `${STORAGE_PREFIX}${simId}`;
  const values = { ...defaults };

  // Only adopt keys we still know, and only when the type still matches, so a
  // renamed or retyped toggle in a newer build cannot poison a panel.
  const stored = read(storageKey);
  if (stored) {
    for (const [key, fallback] of Object.entries(defaults)) {
      if (typeof stored[key] === typeof fallback) values[key] = stored[key];
    }
  }

  return {
    values,
    set(name, value) {
      if (!(name in defaults)) return;
      values[name] = value;
      write(storageKey, values);
    },
  };
}

function read(storageKey) {
  let raw;
  try {
    raw = localStorage.getItem(storageKey);
  } catch {
    /* localStorage unavailable (privacy mode) – stay in memory */
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    /* corrupt entry – fall back to the defaults */
    return null;
  }
}

function write(storageKey, values) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(values));
  } catch {
    /* ignore persistence failure */
  }
}
