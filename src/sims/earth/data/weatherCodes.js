/**
 * Byte encodings shared by the weather loaders (data/gfsWorker.js, data/satellite.js), the shaders that
 * unpack them (render/cloudVolume.js) and the checks (scripts/check-earth-weather.mjs). Pure functions.
 *
 *  - precipitation rate: 0 = none, 1…255 log-spaced over 0.01…100 mm/h (≈ 3.7 % per step) – bilinear
 *    filtering then fades a shower out smoothly instead of jumping between classes;
 *  - cloud ceiling (height of the lowest broken/overcast base above sea level): square-root spaced over
 *    0…12 km, so fog and low stratus get metre steps and cirrus bases hundred-metre ones; "no ceiling"
 *    encodes as the top (255), not as 0, so filtering never pulls a base down to the ground;
 *  - satellite cloud-top height: the colours of EUMETSAT's MSG cloud-top-height rendering read back to
 *    metres through the 207 colour stops of its legend (320 … 16 000 m, linear).
 */

export const PRECIP_MIN = 0.01; // mm/h
export const PRECIP_DECADES = 4; // 0.01 … 100 mm/h

export function encodePrecip(mmPerHour) {
  if (!(mmPerHour >= PRECIP_MIN)) return 0;
  return Math.min(255, Math.max(1, Math.round(1 + (254 * Math.log10(mmPerHour / PRECIP_MIN)) / PRECIP_DECADES)));
}

export function decodePrecip(code) {
  return code < 0.5 ? 0 : PRECIP_MIN * 10 ** ((PRECIP_DECADES * (code - 1)) / 254);
}

export const CEILING_MAX = 12000; // m

export function encodeCeiling(m) {
  if (!Number.isFinite(m) || m >= CEILING_MAX) return 255;
  return Math.max(0, Math.min(255, Math.round(255 * Math.sqrt(Math.max(0, m) / CEILING_MAX))));
}

export function decodeCeiling(code) {
  const x = code / 255;
  return x * x * CEILING_MAX;
}

/** Wind speed (m/s) and the direction it blows from (degrees clockwise from north), from u (east) and v (north). */
export function windFrom(u, v) {
  const speed = Math.hypot(u, v);
  const fromDeg = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
  return { speed, fromDeg };
}

/**
 * Terrain correction of the model's near-ground temperature (docs/earth-sim/08 §5, the light part of the
 * planned downscaling): the model's ground is smooth – a 0.25° cell averages ridge and lowland – so ground
 * above it is colder, ground below it warmer, by the standard lapse rate of 6.5 K per km. The wind is left
 * as the model gives it: a speed-up by height alone made it worse at the test stations (scripts/
 * check-earth-weather.mjs) – exposure needs the terrain around a place, i.e. a flow model (WindNinja).
 */
export function terrainCorrection({ windSpeed, tempC, groundHeight, modelHeight }) {
  const dh = Number.isFinite(groundHeight) && Number.isFinite(modelHeight) ? groundHeight - modelHeight : 0;
  return { windSpeed, tempC: tempC - 0.0065 * dh, dh };
}

/** One of 8 compass points for a direction in degrees ('N', 'NE', … – translated by the caller). */
export const COMPASS = Object.freeze(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
export function compassPoint(deg) {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/**
 * Snow fraction of the precipitation from GFS's categorical types (0/1 each): snow 1, ice pellets
 * (sleet) 0.6, rain and freezing rain 0 – freezing rain falls as rain and freezes on the ground.
 */
export function snowFraction(rain, snow, freezing, pellets) {
  if (snow >= 0.5 && rain >= 0.5) return 0.5;
  if (snow >= 0.5) return 1;
  if (pellets >= 0.5) return 0.6;
  return 0;
}

// --- satellite–model fusion ---------------------------------------------------------------------------------------
/** Cover given to satellite-cloudy pixels where the model has no low cloud (a cloudy 5 km pixel is often cumulus). */
export const SAT_BROKEN = 0.7;
/** What is left of the model's cloud where the satellite sees clear sky. */
export const SAT_THIN = 0.12;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The cover after the satellite correction – the CPU twin of render/clouds.js `column()` (readouts, rain at
 * the camera, the checks). `sat` = { cloud 0…1, topM (m or null), valid 0…1 }, `weight` = the picture's
 * time weight.
 */
export function fuseCover({ low, middle, high }, sat, weight) {
  if (!sat || !(weight > 0) || !(sat.valid > 0)) return { low, middle, high };
  const w = weight * sat.valid;
  const top = sat.topM ?? -1;
  const inLow = 1 - smooth(3000, 4000, top);
  const inHigh = smooth(6500, 7500, top);
  const inMid = (1 - inLow) * (1 - inHigh);
  const thin = 1 - (1 - sat.cloud) * (1 - SAT_THIN);
  const lowFill = SAT_BROKEN + (1 - SAT_BROKEN) * smooth(0.3, 0.8, low);
  const blend = (a, b) => a + (b - a) * w;
  return {
    low: blend(low, Math.max(low * thin, sat.cloud * inLow * lowFill)),
    middle: blend(middle, Math.max(middle * thin, sat.cloud * inMid)),
    high: blend(high, Math.max(high * thin, sat.cloud * inHigh)),
  };
}

/** Precipitation only falls under cloud: the model's rate faded out where the (fused) low/middle cover is thin. */
export function rainUnderCloud(rate, cover) {
  return rate * smooth(0.1, 0.4, cover);
}

// --- EUMETSAT MSG cloud products (EUMETView WMS renderings) ----------------------------------------------------
/** Cloud mask colours: white = cloud, green = clear land, blue = clear sea, transparent = no data. */
export function classifyCloudMask(r, g, b, a) {
  if (a < 128) return -1;
  if (r > 200 && g > 200 && b > 200) return 1;
  if (g > 120 && r < 80 && b < 80) return 0;
  if (b > 160 && r < 80 && g < 80) return 0;
  // anti-aliased or blended pixels: nearer white is cloud
  return r + g + b > 450 ? 1 : 0;
}

// the legend bar of msg_fes:cth, sampled run by run (RGB hex) and the height at each run's middle (tens of m)
const CTH_HEX =
  '0000001106001a0b00200e002912003116003517003a1a00431e004f23005325005a2702632b03692d0571291a7726257a242a7c233282203e891d4a8c1b4f92185e99156c9d12759f117aa40f85aa0c92ae099aaf099cb307a5ba04b4be01bdc000c0b500c4a700c99a00cc9400ce8600d37a00d77500d86d00db6000e05400e34f00e54700e83900ec2f00ef2900f11b00f80f00fb0401fd0013ff0019ff0023ff002dff0034ff003cff0045ff004cff0055ff005cff005fff0063ff006bff0074ff0079ff0085ff008dff0092ff009bff00a3ff00a9ff00b5ff00beff00c2ff00c6ff00ceff00d7ff00dcff00e4ff00eeff00f4ff00f5fd00f6f400f7ea00f8e200f5d500f0c200ecb400ebb100e7a200e38f00e08000de7b00db7000d65c00d45100d34d00cf4300ca3200c72400c61b05c5110ac20012c3001bc50022c8002bc90034cc003cce0044d0004dd20053d4005ad60063d8006ddb0073dc007ddf0086e1008be30093e4009be6009fe700a4e800aeea00b8ed00beee00c6f100d0f300d4f400dcf600e6f800e9f900edfa00f5fa00fefb00fef100fee800fee200fed600fecd00fec900fec100feb800feb100feb000fea800fe9e00fe9800fe9400fe8d00fe8000fe7a00fe6e00fe6600fe5e00fe5500fe4d00fe4800fe3f00fe3500fe2f00fe2600fe1c00fe1600fe0c00fe0300fa0b08f21515ee1a1ae92525e23030db3838db3939da3a3ad83f3fd24b4bcc5454c95858c56060bf6c6cb77878b28080ac8c8ca69696a69b9ba6a0a0a7a6a6a9a9a9afafafb5b5b5b7b7b7babababebebec1c1c1c7c7c7cdcdcdd0d0d0d4d4d4dadadadfdfdfe6e6e6eaeaeaefefeff3f3f3f7f7f7ffffff';
// prettier-ignore
const CTH_TENS = [43, 55, 64, 74, 77, 80, 90, 100, 103, 112, 122, 125, 129, 140, 151, 154, 164, 174, 177, 180, 190, 199, 203, 212, 222, 225, 228, 236, 245, 248, 251, 254, 264, 273, 277, 286, 296, 299, 302, 312, 322, 325, 328, 338, 348, 351, 354, 364, 373, 377, 388, 407, 418, 422, 433, 444, 447, 459, 470, 473, 476, 484, 492, 496, 499, 510, 521, 525, 534, 544, 547, 558, 570, 573, 583, 592, 595, 599, 608, 618, 621, 631, 641, 644, 647, 657, 666, 670, 673, 682, 692, 695, 705, 715, 718, 721, 724, 732, 740, 744, 747, 756, 768, 779, 789, 792, 803, 814, 818, 829, 840, 843, 853, 863, 866, 877, 888, 892, 901, 911, 914, 917, 927, 937, 940, 951, 962, 966, 975, 985, 988, 991, 1001, 1011, 1014, 1025, 1037, 1040, 1051, 1062, 1066, 1075, 1085, 1088, 1098, 1107, 1111, 1114, 1123, 1133, 1136, 1146, 1157, 1162, 1173, 1185, 1188, 1198, 1207, 1210, 1222, 1233, 1236, 1247, 1259, 1262, 1272, 1281, 1284, 1296, 1307, 1310, 1313, 1320, 1326, 1330, 1333, 1336, 1346, 1355, 1359, 1370, 1381, 1384, 1394, 1404, 1407, 1410, 1421, 1433, 1442, 1452, 1455, 1458, 1470, 1481, 1492, 1503, 1507, 1518, 1529, 1542, 1555, 1558, 1568, 1577, 1589];
export const CTH_STOPS = Object.freeze(
  CTH_TENS.map((tens, i) => Object.freeze([
    parseInt(CTH_HEX.slice(i * 6, i * 6 + 2), 16),
    parseInt(CTH_HEX.slice(i * 6 + 2, i * 6 + 4), 16),
    parseInt(CTH_HEX.slice(i * 6 + 4, i * 6 + 6), 16),
    tens * 10,
  ])),
);

/**
 * Cloud-top height (m) of a rendered colour: the nearest legend stop; null when transparent or no stop is
 * near (the rendering's colours are close to the legend's, not identical). `memo` caches per colour.
 */
export function cloudTopHeight(r, g, b, a, memo = null) {
  if (a < 128) return null;
  const key = (r << 16) | (g << 8) | b;
  if (memo?.has(key)) return memo.get(key);
  let best = Infinity;
  let h = null;
  for (const [sr, sg, sb, m] of CTH_STOPS) {
    const d = (r - sr) ** 2 + (g - sg) ** 2 + (b - sb) ** 2;
    if (d < best) {
      best = d;
      h = m;
    }
  }
  const out = best <= 60 * 60 ? h : null;
  memo?.set(key, out);
  return out;
}

/** Cloud-top height in a byte for the GPU (0 = unknown, 1…255 = 0…16 km). */
export function encodeCloudTop(m) {
  if (m === null || !Number.isFinite(m)) return 0;
  return Math.max(1, Math.min(255, Math.round(1 + (254 * m) / 16000)));
}

export function decodeCloudTop(code) {
  return code < 0.5 ? null : ((code - 1) / 254) * 16000;
}
