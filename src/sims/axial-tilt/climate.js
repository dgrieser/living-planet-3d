/**
 * Climate & habitability estimates for the axial-tilt simulation, built on the
 * energy-balance physics (./physics.js). Pure module – no
 * Three.js / DOM – so scripts/check-axial-tilt-climate.mjs can validate it from node.
 *
 * "Summer"/"winter" are the seasonal *means* of the energy-balance model at
 * the two solstices – the annual extremes on a circular orbit. A teaching
 * aid, not a climate model.
 *
 * The same module says what a latitude *looks like* at a date – snow, sea ice, dormant or
 * parched vegetation, seas falling dry, city lights – as 0 … 1 factors from the seasonal mean
 * (SURFACE, surfaceState()); the Earth shader mirrors those ramps on the surface texture.
 */
import { declinationDeg, annualMeanInsolation, temperatureEstimate, iceCoverFraction, EARTH_ROTATION_H } from './physics.js';

const DEG = Math.PI / 180;

const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Seasonal-mean bounds within which a latitude band counts as livable. */
export const LIVABLE = Object.freeze({
  minWinterC: -25, // coldest seasonal mean a band may reach
  maxSummerC: 45, // hottest seasonal mean a band may reach
  minSummerC: 0, // summer must at least thaw
});

/**
 * What the surface of a latitude looks like at a date, as temperature ramps on its seasonal mean
 * (°C): each factor is 0 below `onsetC`/above it for the hot ones and 1 past `fullC`. The Earth
 * shader applies the very same ramps (mirrored from these constants) to the seasonal mean it
 * reads from the surface texture, so the JS side and the picture agree.
 * - snow: seasonal snow on land; permanent ice (iceCoverFraction) is the floor for both snow and sea ice.
 * - seaIce: seawater freezes at −1.8 °C, and a pack needs a sustained cold season; the seasonal mean
 *   is already damped for the oceans' heat storage (EBM.seasonalDamping), so no extra lag is added.
 *   While the Sun is up for part of the day the pack only closes well below freezing (`fullC`), the
 *   afternoons eating at it; in polar night nothing melts, so it closes just under the freezing point
 *   (`darkFullC`), the two blended by how little daily sunshine is left (`darkBelowWm2`).
 * - dormant: vegetation shuts down for the cold season – the land goes brown before the snow arrives.
 * - parch: heat kills the vegetation and the land goes to sand, complete at the livable limit.
 * - scorch: beyond that limit the dead land bakes – red-brown earth, bleached playas, cracked ground,
 *   salt in the basins – and the bare ground feeds dust storms; over the hot seas the air fills with a
 *   dense convective cloud deck, the ocean going into the air (the moist-greenhouse state), and the
 *   limb haze turns from blue to a warm white.
 * - dry: evaporation outruns what rain returns – the shallow shelves fall dry, the deep water turns to
 *   brine with salt pans. Only the polar summers of a high tilt get here (~90 °C in the model);
 *   schematic, since one summer cannot evaporate an ocean.
 * - thaw: the ice the map itself paints – Greenland, Antarctica, the Arctic cap – melts away where the
 *   *annual* mean climbs above freezing for good (ice sheets are a slow variable, like permIce, so this
 *   ramp runs on the annual mean, not the season); today's Earth keeps its caps (annual means ≤ 3 °C
 *   there), a tilt of 45° or more clears them.
 * - lightsFadeK: city lights stay where the latitude is livable year-round and fade out within this
 *   many K past a LIVABLE edge (as the habitable-zone simulation's LIVABLE_FADE_K).
 */
export const SURFACE = Object.freeze({
  tempRangeC: Object.freeze({ min: -60, max: 100 }), // 8-bit encoding of the seasonal mean in the surface texture (0.63 K per step)
  snow: Object.freeze({ onsetC: 2, fullC: -8 }),
  seaIce: Object.freeze({ onsetC: -2, fullC: -12, darkFullC: -5, darkBelowWm2: 60 }),
  dormant: Object.freeze({ onsetC: 8, fullC: -4 }),
  parch: Object.freeze({ onsetC: 30, fullC: LIVABLE.maxSummerC }),
  scorch: Object.freeze({ onsetC: LIVABLE.maxSummerC, fullC: 75 }),
  dry: Object.freeze({ onsetC: LIVABLE.maxSummerC, fullC: 80 }),
  thaw: Object.freeze({ onsetC: 2, fullC: 10 }), // on the annual mean
  lightsFadeK: 8,
});

/**
 * Verdict tiers by tilt. The thresholds are pedagogical labels for the model
 * output (see scripts/check-axial-tilt-climate.mjs for the numbers behind them);
 * the displayed temperatures and fractions always come from the physics.
 */
export const VERDICT_TIERS = Object.freeze([
  { id: 'uniform', maxTiltDeg: 10 }, // barely any seasons, permanently frozen poles
  { id: 'moderate', maxTiltDeg: 35 }, // Earth-like sweet spot
  { id: 'severe', maxTiltDeg: 55 },
  { id: 'extreme', maxTiltDeg: 90 }, // Uranus-like
]);

export function verdictFor(tiltDeg) {
  return (VERDICT_TIERS.find((tier) => tiltDeg <= tier.maxTiltDeg) ?? VERDICT_TIERS[VERDICT_TIERS.length - 1]).id;
}

/** Warmest / coldest seasonal mean (°C) a latitude sees over the year (solstice extremes). */
export function seasonalExtremes(latitudeDeg, tiltDeg, annualInsolation = annualMeanInsolation(latitudeDeg, tiltDeg)) {
  // For φ ≥ 0 the June solstice (orbit angle 0°) is the warm one, for φ < 0 the December solstice (180°).
  const toward = declinationDeg(tiltDeg, latitudeDeg >= 0 ? 0 : 180);
  const away = declinationDeg(tiltDeg, latitudeDeg >= 0 ? 180 : 0);
  const summerC = temperatureEstimate(latitudeDeg, tiltDeg, toward, EARTH_ROTATION_H, annualInsolation).meanC;
  const winterC = temperatureEstimate(latitudeDeg, tiltDeg, away, EARTH_ROTATION_H, annualInsolation).meanC;
  return { summerC, winterC, swingK: summerC - winterC };
}

export function isLivable({ summerC, winterC }) {
  return winterC > LIVABLE.minWinterC && summerC < LIVABLE.maxSummerC && summerC > LIVABLE.minSummerC;
}

/** Area-weighted fraction of the surface whose seasonal means stay livable all year. */
export function habitableFraction(tiltDeg, stepDeg = 2) {
  let livable = 0;
  let total = 0;
  for (let lat = -90 + stepDeg / 2; lat < 90; lat += stepDeg) {
    const weight = Math.cos(lat * DEG);
    total += weight;
    if (isLivable(seasonalExtremes(lat, tiltDeg))) livable += weight;
  }
  return livable / total;
}

/**
 * Livable latitude bands [fromDeg, toDeg] for a tilt: the contiguous ranges
 * whose seasonal means stay within LIVABLE. Edges are refined by bisection so
 * the borders move smoothly while the tilt slider is dragged.
 */
export function livableBands(tiltDeg, stepDeg = 2) {
  const livAt = (lat) => isLivable(seasonalExtremes(lat, tiltDeg, annualMeanInsolation(lat, tiltDeg, 90)));
  const edge = (lo, hi, loLivable) => {
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (livAt(mid) === loLivable) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const bands = [];
  let start = null;
  let prev = livAt(-90 + 1e-4);
  if (prev) start = -90;
  for (let lat = -90 + stepDeg; lat <= 90 + 1e-9; lat += stepDeg) {
    const clamped = Math.min(lat, 90 - 1e-4);
    const cur = livAt(clamped);
    if (cur !== prev) {
      const boundary = edge(lat - stepDeg, Math.min(lat, 90), prev);
      if (cur) start = boundary;
      else {
        bands.push([start, boundary]);
        start = null;
      }
      prev = cur;
    }
  }
  if (start !== null) bands.push([start, 90]);
  return bands;
}

/** Area fraction of the sphere covered by latitude bands (exact: ∫cos φ dφ = Δsin φ). */
export function bandsFraction(bands) {
  return bands.reduce((sum, [lo, hi]) => sum + (Math.sin(hi * DEG) - Math.sin(lo * DEG)) / 2, 0);
}

// --- surface conditions --------------------------------------------------------------------
/** Seasonal mean (°C) → 0 … 1 on SURFACE.tempRangeC, clamped – the surface texture's red channel. */
export function encodeSurfaceTemp(tempC) {
  const { min, max } = SURFACE.tempRangeC;
  return Math.min(1, Math.max(0, (tempC - min) / (max - min)));
}

/**
 * City lights (0 … 1) for a latitude from its seasonal extremes: the soft-edged form of
 * isLivable() – 1 where the band is livable year-round, fading to 0 within SURFACE.lightsFadeK
 * past any of the three LIVABLE limits.
 */
export function lightsFactor({ summerC, winterC }) {
  const { minWinterC, maxSummerC, minSummerC } = LIVABLE;
  const fade = SURFACE.lightsFadeK;
  return smoothstep(minWinterC - fade, minWinterC, winterC) * smoothstep(minSummerC - fade, minSummerC, summerC) * (1 - smoothstep(maxSummerC, maxSummerC + fade, summerC));
}

/** How far a latitude is into polar night, 0 (daily sunshine) … 1 (none) – from its daily mean insolation (W/m²). */
export function seaIceDarkness(insolationWm2) {
  return 1 - smoothstep(0, SURFACE.seaIce.darkBelowWm2, insolationWm2);
}

/** The seasonal mean (°C) at which the pack closes completely: `fullC` under the Sun, `darkFullC` in polar night. */
export function seaIceFullC(darkness) {
  return SURFACE.seaIce.fullC + (SURFACE.seaIce.darkFullC - SURFACE.seaIce.fullC) * darkness;
}

/**
 * The surface of a latitude at a date, as 0 … 1 factors (see SURFACE): the seasonal mean of the
 * energy-balance model drives snow, sea ice, dormant and parched vegetation and drying seas;
 * permanent ice follows the annual mean and floors snow and sea ice, the thaw of the map's own
 * ice sheets follows the annual mean too; the lights follow the year-round livability of the
 * latitude. The rotation period does not enter (the mean is independent of it).
 */
export function surfaceState(latitudeDeg, tiltDeg, declinationDeg, annualInsolation = annualMeanInsolation(latitudeDeg, tiltDeg)) {
  const { meanC, annualC, insolation } = temperatureEstimate(latitudeDeg, tiltDeg, declinationDeg, EARTH_ROTATION_H, annualInsolation);
  const permIce = iceCoverFraction(annualInsolation);
  const cold = (ramp) => smoothstep(ramp.onsetC, ramp.fullC, meanC);
  const hot = (ramp) => smoothstep(ramp.onsetC, ramp.fullC, meanC);
  const darkness = seaIceDarkness(insolation);
  return {
    meanC,
    annualC,
    permIce,
    thaw: smoothstep(SURFACE.thaw.onsetC, SURFACE.thaw.fullC, annualC),
    snow: Math.max(cold(SURFACE.snow), permIce),
    seaIce: Math.max(smoothstep(SURFACE.seaIce.onsetC, seaIceFullC(darkness), meanC), permIce),
    dormant: cold(SURFACE.dormant),
    parch: hot(SURFACE.parch),
    scorch: hot(SURFACE.scorch),
    dry: hot(SURFACE.dry),
    lights: lightsFactor(seasonalExtremes(latitudeDeg, tiltDeg, annualInsolation)),
  };
}

// --- temperature colour ramp (matches .lp-heat-legend__bar in style.css) ---------
export const TEMP_COLOR_RANGE_C = Object.freeze({ min: -40, max: 60 });

const RAMP = Object.freeze([
  { t: 0.0, rgb: [26, 42, 122] }, // #1a2a7a deep frozen
  { t: 0.25, rgb: [42, 117, 214] }, // #2a75d6 cold
  { t: 0.5, rgb: [92, 203, 103] }, // #5ccb67 temperate
  { t: 0.75, rgb: [247, 197, 58] }, // #f7c53a hot
  { t: 1.0, rgb: [230, 52, 26] }, // #e6341a scorching
]);

/** Maps a seasonal-mean temperature (°C) to an [r, g, b] colour (0–255). */
export function temperatureColor(tempC) {
  const { min, max } = TEMP_COLOR_RANGE_C;
  const t = Math.min(1, Math.max(0, (tempC - min) / (max - min)));
  let i = 0;
  while (i < RAMP.length - 2 && t > RAMP[i + 1].t) i++;
  const a = RAMP[i];
  const b = RAMP[i + 1];
  const f = (t - a.t) / (b.t - a.t);
  return a.rgb.map((v, k) => Math.round(v + (b.rgb[k] - v) * f));
}

// --- overlay opacity: only the hostile ends of the ramp paint over the map --------
/**
 * How strongly a ramp colour is painted over Earth's texture. Values a place like
 * today's Earth lives in stay nearly transparent – the map keeps showing through, so
 * the overlay reads as a tint rather than a repaint – and the overlay only reaches full
 * strength where the seasonal mean leaves what LIVABLE allows (below −25 °C / above
 * +45 °C). Positions are ramp coordinates (0 … 1 over TEMP_COLOR_RANGE_C) so the same
 * fade can be applied to the insolation heat map, which shares the ramp (see the
 * overlayAlpha() mirror in the Earth shader).
 */
const rampAt = (tempC) => (tempC - TEMP_COLOR_RANGE_C.min) / (TEMP_COLOR_RANGE_C.max - TEMP_COLOR_RANGE_C.min);
export const OVERLAY_FADE = Object.freeze({
  minAlpha: 0.3, // opacity factor inside the comfortable window
  comfort: Object.freeze([rampAt(-10), rampAt(30)]), // habitable everyday temperatures: faintest
  danger: Object.freeze([rampAt(LIVABLE.minWinterC), rampAt(LIVABLE.maxSummerC)]), // beyond livable: full strength
});

/** Overlay opacity factor (OVERLAY_FADE.minAlpha … 1) for a position on the colour ramp. */
export function overlayAlpha(rampT) {
  const { minAlpha, comfort, danger } = OVERLAY_FADE;
  const cold = 1 - smoothstep(danger[0], comfort[0], rampT);
  const hot = smoothstep(comfort[1], danger[1], rampT);
  return minAlpha + (1 - minAlpha) * Math.max(cold, hot);
}

/** Overlay opacity factor for a seasonal-mean temperature (°C). */
export function temperatureOverlayAlpha(tempC) {
  return overlayAlpha(rampAt(tempC));
}
