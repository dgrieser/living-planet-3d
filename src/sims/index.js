/**
 * Simulation registry. Each entry lazy-loads its module; the module's default
 * export is `mount(container) => dispose()` (may return a Promise).
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
  },
  {
    id: 'moon-tides',
    titleKey: 'sims.moonTides.title',
    descriptionKey: 'sims.moonTides.description',
    icon: '🌕',
    load: () => import('./moon-tides/index.js'),
  },
  {
    id: 'axial-tilt',
    titleKey: 'sims.axialTilt.title',
    descriptionKey: 'sims.axialTilt.description',
    icon: '🌍',
    load: () => import('./axial-tilt/index.js'),
  },
  {
    id: 'seasons',
    titleKey: 'sims.seasons.title',
    descriptionKey: 'sims.seasons.description',
    icon: '🍂',
    load: () => import('./seasons/index.js'),
  },
  {
    id: 'magnetosphere',
    titleKey: 'sims.magnetosphere.title',
    descriptionKey: 'sims.magnetosphere.description',
    icon: '🧲',
    load: () => import('./magnetosphere/index.js'),
  },
];

export function findSimulation(id) {
  return simulations.find((s) => s.id === id);
}
