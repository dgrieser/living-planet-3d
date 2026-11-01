/**
 * Exposure that follows the light near the ground, like an eye or a camera adapting (pure functions,
 * checked by scripts/check-earth-weather.mjs).
 *
 * The base exposure (index.js EXPOSURE) suits the sunlit Earth seen from space. On the ground the light
 * spans more than a factor of ten – a clear June noon against an overcast November morning – and one fixed
 * exposure washes out the first and drowns the second in murk. Near the ground the exposure therefore
 * scales with the light on open ground, estimated from the Sun's elevation and the cloud cover at the
 * camera: partly (strength < 1), so an overcast day still reads darker than a sunny one, and only by day –
 * the night keeps its darkness. From orbit the base exposure holds.
 */

export const EXPOSURE_ADAPT = Object.freeze({
  /** light on open ground (sunlight = 1) that the base exposure is made for: the Sun 30° high, clear sky */
  reference: 0.49,
  /** 0 = fixed exposure, 1 = full adaptation */
  strength: 0.6,
  min: 0.55,
  max: 2.6,
  /**
   * the tile imagery (EOX's Sentinel-2 mosaic, and the orthophotos calibrated onto it) is darker than the
   * ground's reflectance: near the ground the surface shader lifts it by this much (render/surface.js
   * `imageryGain`) – on the albedo, not the exposure, so water, glint, sky and clouds keep their brightness
   */
  imageryGain: 1.6,
  /** camera altitudes (m) over which the adaptation hands back to the base exposure */
  altitudeM: Object.freeze([30000, 300000]),
  /** less exposure over a sea of cloud below the camera (a bright scene): at full cover, by this fraction */
  cloudBelow: 0.3,
  /** seconds for the eye to follow a change */
  timeConstant: 0.8,
});

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Cloud cover that keeps the Sun off the ground: low and middle cloud in full, thin cirrus a third. */
export function shadingCover({ low = 0, middle = 0, high = 0 } = {}) {
  return 1 - (1 - low) * (1 - middle) * (1 - 0.3 * high);
}

/**
 * Light on open ground (sunlight at the top of the atmosphere = 1): the beam through the air (a simple air
 * mass) past the clouds, the sunlight the clouds pass on diffusely (≈ 35 %, render/clouds.js `skyLight`),
 * plus the sky – the terms of the surface shader (render/surface.js).
 * @param {number} muS cosine of the Sun's zenith angle
 * @param {number} cover 0…1 (`shadingCover`)
 */
export function groundIlluminance(muS, cover) {
  const beam = muS > 0 ? muS * Math.exp(-0.12 / Math.max(muS, 0.035)) : 0;
  const sky = 0.107 * smooth(-0.2, 0.25, muS) * Math.min(1, Math.max(0.25, muS + 0.6)) * (1 - 0.1 * cover);
  return beam * (1 - cover) + beam * cover * 0.35 + sky;
}

/**
 * Factor on the base exposure for a camera at `altitudeM` with the Sun at `muS` under `cover` (the cloud
 * above the camera) and over `below` (the cloud cover under it, seen lit from above).
 */
export function exposureFactor({ muS, cover, below = 0, altitudeM }) {
  const a = EXPOSURE_ADAPT;
  const e = groundIlluminance(muS, cover);
  const ratio = Math.min(a.max, Math.max(a.min, (a.reference / Math.max(e, 1e-4)) ** a.strength)) * (1 - a.cloudBelow * below);
  const day = smooth(-0.05, 0.1, muS);
  return ratio ** (day * nearGround(altitudeM));
}

/** How much of the near-ground treatment applies at a camera altitude (1 low, 0 from orbit). */
export function nearGround(altitudeM) {
  return 1 - smooth(EXPOSURE_ADAPT.altitudeM[0], EXPOSURE_ADAPT.altitudeM[1], altitudeM);
}
