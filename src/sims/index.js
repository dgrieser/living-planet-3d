/**
 * Simulation registry. Each entry lazy-loads its module; the module's default
 * export is `mount(container) => dispose()` (may return a Promise).
 *
 * `hidden: true` keeps an entry off the overview grid while it is being worked on.
 * Its route stays reachable (deep links keep working) and the header toggle lists it again.
 */
export const simulations = [
  {
    id: 'galactic-zone',
    titleKey: 'sims.galacticZone.title',
    descriptionKey: 'sims.galacticZone.description',
    icon: '🌌',
    load: () => import('./galactic-zone/index.js'),
  },
  {
    id: 'habitable-zone',
    titleKey: 'sims.habitableZone.title',
    descriptionKey: 'sims.habitableZone.description',
    icon: '🌡️',
    load: () => import('./habitable-zone/index.js'),
  },
  {
    id: 'solar-orbit',
    titleKey: 'sims.solarOrbit.title',
    descriptionKey: 'sims.solarOrbit.description',
    icon: '🪐',
    load: () => import('./solar-orbit/index.js'),
    hidden: true, // work in progress – only listed when the header toggle is on
  },
  {
    id: 'moon-tides',
    titleKey: 'sims.moonTides.title',
    descriptionKey: 'sims.moonTides.description',
    icon: '🌕',
    load: () => import('./moon-tides/index.js'),
    hidden: true, // work in progress – only listed when the header toggle is on
  },
  {
    id: 'axial-tilt',
    titleKey: 'sims.axialTilt.title',
    descriptionKey: 'sims.axialTilt.description',
    icon: '🌍',
    load: () => import('./axial-tilt/index.js'),
  },
  {
    id: 'magnetosphere',
    titleKey: 'sims.magnetosphere.title',
    descriptionKey: 'sims.magnetosphere.description',
    icon: '🧲',
    load: () => import('./magnetosphere/index.js'),
    hidden: true, // work in progress – only listed when the header toggle is on
  },
];

export function findSimulation(id) {
  return simulations.find((s) => s.id === id);
}

/** The overview list: finished simulations, plus the work-in-progress ones when they are toggled on. */
export function listSimulations({ includeHidden = false } = {}) {
  return includeHidden ? simulations : simulations.filter((s) => !s.hidden);
}
