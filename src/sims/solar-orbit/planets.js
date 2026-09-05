/**
 * Static physical data for the Sun and the eight planets.
 * Radii: IAU mean radii (km). Rotation: sidereal rotation period (days, negative = retrograde).
 * Textures: Solar System Scope, CC BY 4.0 – https://www.solarsystemscope.com/textures/
 */
import { zoneEdgesAU, SOLAR_TEFF_K } from '../habitable-zone/physics.js';
export const SUN = Object.freeze({
  id: 'sun',
  radiusKm: 695700,
  rotationDays: 25.38,
  texture: '2k_sun.jpg',
  color: 0xffd27a,
});

export const PLANETS = Object.freeze([
  { id: 'mercury', radiusKm: 2439.7, rotationDays: 58.646, texture: '2k_mercury.jpg', color: 0x9e9a93, orbitColor: 0x8d8a85 },
  { id: 'venus', radiusKm: 6051.8, rotationDays: -243.025, texture: '2k_venus_atmosphere.jpg', color: 0xe6c98a, orbitColor: 0xc9b07a },
  { id: 'earth', radiusKm: 6371.0, rotationDays: 0.99727, texture: '2k_earth_daymap.jpg', color: 0x4d8fe0, orbitColor: 0x7cc4ff, axialTiltDeg: 23.44 },
  { id: 'mars', radiusKm: 3389.5, rotationDays: 1.02596, texture: '2k_mars.jpg', color: 0xc1603a, orbitColor: 0xd9825f },
  { id: 'jupiter', radiusKm: 69911, rotationDays: 0.41354, texture: '2k_jupiter.jpg', color: 0xd3b48c, orbitColor: 0xbfa27f },
  { id: 'saturn', radiusKm: 58232, rotationDays: 0.44401, texture: '2k_saturn.jpg', color: 0xe3d3a0, orbitColor: 0xcdbb84, axialTiltDeg: 26.73, ring: { texture: '2k_saturn_ring_alpha.png', innerKm: 74500, outerKm: 140220 } },
  { id: 'uranus', radiusKm: 25362, rotationDays: -0.71833, texture: '2k_uranus.jpg', color: 0x9fd8e3, orbitColor: 0x8ec9d4, axialTiltDeg: 97.77 },
  { id: 'neptune', radiusKm: 24622, rotationDays: 0.6713, texture: '2k_neptune.jpg', color: 0x4b70dd, orbitColor: 0x6d8ae6 },
]);

/**
 * Conservative circumstellar habitable zone of the Sun: runaway greenhouse to maximum greenhouse,
 * 0.95–1.68 AU. Taken from the habitable-zone simulation's physics module rather than written out
 * again, so the two simulations cannot drift apart on the same number.
 */
const sunZone = zoneEdgesAU(1, SOLAR_TEFF_K);
export const HABITABLE_ZONE_AU = Object.freeze({ inner: sunZone.inner, outer: sunZone.outer });

/** Hypothetical eccentric Earth orbit used for comparison. */
export const HYPOTHETICAL_ECCENTRICITY = 0.3;
