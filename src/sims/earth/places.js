/**
 * Places and camera views of the Living Earth (pure data).
 *
 * A place is what the panel's preset row switches between: the whole globe and the two hero areas. Each
 * place brings its own clock (the local time zone) and its own short list of camera views – the list the
 * panel header's camera button cycles through (docs/earth-sim/10 §2.2). Coordinates of the landmarks are
 * from docs/earth-sim/03 and 04. Heights are above the WGS84 ellipsoid (the geoid lies ≈ 44 m above it
 * in Lübbecke and ≈ 41 m in Fanø).
 */

export const PLACES = Object.freeze([
  { id: 'globe', timeZone: null, latDeg: 50, lonDeg: 10, views: ['globe', 'europe'] },
  { id: 'luebbecke', timeZone: 'Europe/Berlin', latDeg: 52.3028, lonDeg: 8.6183, views: ['luebbeckeOverview', 'reineberg', 'wurzelbrink'] },
  { id: 'fanoe', timeZone: 'Europe/Copenhagen', latDeg: 55.4, lonDeg: 8.41, views: ['fanoeOverview', 'nordby', 'sonderho'] },
]);

/** Camera views: pose of the camera (heading clockwise from north, pitch negative = looking down). */
export const VIEWS = Object.freeze({
  // the whole Earth over Europe and Africa, and Europe from a low orbit
  globe: { place: 'globe', latDeg: 28, lonDeg: 12, heightM: 17.5e6, headingDeg: 0, pitchDeg: -90, fitGlobe: true, icon: '🌍' },
  europe: { place: 'globe', latDeg: 38, lonDeg: 9, heightM: 1.6e6, headingDeg: 0, pitchDeg: -38, icon: '🛰️' },
  // Lübbecke: the town (Markt 52.3028 N, 8.6183 E) at the foot of the Wiehengebirge, seen from the lowland
  luebbeckeOverview: { place: 'luebbecke', latDeg: 52.352, lonDeg: 8.62, heightM: 1500, headingDeg: 180, pitchDeg: -16, icon: '🏘️' },
  // from above the Reineberg castle ruin (52.2940 N, 8.6296 E) north over the town and the plain
  reineberg: { place: 'luebbecke', latDeg: 52.288, lonDeg: 8.636, heightM: 650, headingDeg: 345, pitchDeg: -9, icon: '🏰' },
  // the Wurzelbrink (Wartturm, 52.2830 N, 8.6152 E) and the ridge running east–west
  wurzelbrink: { place: 'luebbecke', latDeg: 52.276, lonDeg: 8.565, heightM: 900, headingDeg: 70, pitchDeg: -12, icon: '🗼' },
  // Fanø from the Wadden Sea side: the island, the tidal flats, Esbjerg behind
  fanoeOverview: { place: 'fanoe', latDeg: 55.36, lonDeg: 8.66, heightM: 9000, headingDeg: 290, pitchDeg: -28, icon: '🏝️' },
  // Nordby and the harbour (55.45 N, 8.4083 E) with the ferry route to Esbjerg
  nordby: { place: 'fanoe', latDeg: 55.425, lonDeg: 8.455, heightM: 1300, headingDeg: 320, pitchDeg: -16, icon: '⛴️' },
  // Sønderho at the island's southern tip (Mølle 55.3545 N, 8.4634 E) and the beach
  sonderho: { place: 'fanoe', latDeg: 55.33, lonDeg: 8.53, heightM: 1100, headingDeg: 300, pitchDeg: -14, icon: '🌾' },
});

export function findPlace(id) {
  return PLACES.find((p) => p.id === id) ?? PLACES[0];
}

/** The place a camera position belongs to: a hero area when inside its box, else the globe. */
export const HERO_BOXES = Object.freeze({
  luebbecke: { south: 52.2, north: 52.4, west: 8.4, east: 8.85 },
  fanoe: { south: 55.25, north: 55.6, west: 8.15, east: 8.65 },
});

export function placeAt(latDeg, lonDeg) {
  for (const [id, b] of Object.entries(HERO_BOXES)) {
    if (latDeg >= b.south && latDeg <= b.north && lonDeg >= b.west && lonDeg <= b.east) return findPlace(id);
  }
  return null;
}
