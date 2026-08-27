/**
 * Simulation registry. Each entry lazy-loads its module; the module's default
 * export is `mount(container) => dispose()` (may return a Promise).
 */
export const simulations = [
  {
    id: 'axial-tilt',
    titleKey: 'sims.axialTilt.title',
    descriptionKey: 'sims.axialTilt.description',
    icon: '🌍',
    load: () => import('./axial-tilt/index.js'),
  },
  {
    id: 'solar-orbit',
    titleKey: 'sims.solarOrbit.title',
    descriptionKey: 'sims.solarOrbit.description',
    icon: '🪐',
    load: () => import('./solar-orbit/index.js'),
  },
];

export function findSimulation(id) {
  return simulations.find((s) => s.id === id);
}
