/**
 * Where the globe has more than its global data (milestone M2, docs/earth-sim/12 §1): the two hero
 * boxes get Mapterhorn's national terrain levels (NRW DGM1 1 m, Danish DHM 0.4 m, fetched at zoom 16 ≈
 * 0.7 m per pixel) and their national height references; North Rhine-Westphalia gets its 10 cm
 * orthophotos (Geobasis NRW, dl-de/zero-2.0) down to zoom 21. Pure functions, checked by
 * scripts/check-earth-hero.mjs.
 */
import { HERO_BOXES } from './places.js';

/** Terrain source levels (even zooms of Mapterhorn): everywhere / inside a hero box. */
export const TERRAIN_SOURCE_MAX = Object.freeze({ global: 12, hero: 16 });
/** Deepest tile level: EOX ends at z15; hero relief adds one level past its source; NRW imagery z21. */
export const LEVEL_MAX = Object.freeze({ global: 15, hero: 17, nrw: 21 });
/** Coverage of the NRW orthophoto WMTS (its WGS84 bounding box; outside NRW it is transparent). */
export const NRW_DOP = Object.freeze({ west: 5.6989, south: 50.2651, east: 9.6835, north: 52.5704, minZoom: 10, maxZoom: 21 });
/** Width (degrees of latitude) of the blend between national and global height references. */
export const HERO_FEATHER_DEG = 0.02;

/** Geographic bounds (degrees) of an XYZ Web-Mercator tile. */
export function xyzBounds(x, y, z) {
  const n = 2 ** z;
  const lat = (ny) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * ny))) * 180) / Math.PI;
  return { west: (x / n) * 360 - 180, east: ((x + 1) / n) * 360 - 180, north: lat(y / n), south: lat((y + 1) / n) };
}

export function intersects(a, b) {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south;
}

/** The hero box a tile touches, or null. */
export function heroBoxOf(bounds) {
  for (const [id, box] of Object.entries(HERO_BOXES)) {
    if (intersects(bounds, box)) return id;
  }
  return null;
}

/** Deepest terrain source level for a tile. */
export function terrainSourceCap(bounds) {
  return heroBoxOf(bounds) ? TERRAIN_SOURCE_MAX.hero : TERRAIN_SOURCE_MAX.global;
}

/** Deepest tile level the tree may refine to over these bounds. */
export function levelCap(bounds) {
  let cap = heroBoxOf(bounds) ? LEVEL_MAX.hero : LEVEL_MAX.global;
  if (intersects(bounds, NRW_DOP)) cap = Math.max(cap, LEVEL_MAX.nrw);
  return cap;
}

/** Whether an imagery tile reads the NRW orthophoto (else EOX). */
export function usesNrwDop(x, y, z) {
  return z >= NRW_DOP.minZoom && z <= NRW_DOP.maxZoom && intersects(xyzBounds(x, y, z), NRW_DOP);
}

/**
 * Weight of a hero box's national height reference at a point: 1 inside the box (more than the feather
 * from its edge), 0 outside, smooth in between – the same function runs in the shader (surface.js).
 */
export function heroWeight(box, latDeg, lonDeg, feather = HERO_FEATHER_DEG) {
  const k = Math.cos((latDeg * Math.PI) / 180);
  const d = Math.min(latDeg - box.south, box.north - latDeg, (lonDeg - box.west) * k, (box.east - lonDeg) * k);
  const t = Math.min(1, Math.max(0, (d + feather) / (2 * feather)));
  return t * t * (3 - 2 * t);
}
