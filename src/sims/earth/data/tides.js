/**
 * Harmonic tide prediction (docs/earth-sim/07 §2): η(t) = Z0 + Σ f·H·cos(V + u − g), with the equilibrium
 * arguments V of each constituent from the mean longitudes of Moon and Sun (Doodson/Schureman), the nodal
 * corrections f and u for the 18.6-year cycle of the lunar node (Pugh 1987, table 4.3), and the station's
 * amplitudes H and Greenwich phase lags g (data/tideConstants.js, fitted by tools/earth-pipeline/fit-tides.mjs).
 *
 * The sim uses DMI's own gauges and predictions where they exist (data/water.js); this model answers
 * every other instant – before 2001, past the published predictions, offline – and is checked against
 * DMI's official predictions by scripts/check-earth-tides.mjs.
 */

const DEG = Math.PI / 180;
const norm = (a) => ((a % 360) + 360) % 360;

/** Mean astronomical longitudes (degrees) at an instant (ms since 1970, UT). */
export function astronomicalArguments(ms) {
  const jd = ms / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const s = norm(218.3164477 + 481267.88123421 * T); // Moon
  const h = norm(280.4664567 + 36000.7697489 * T); // Sun
  const p = norm(83.3532465 + 4069.0137287 * T); // lunar perigee
  const N = norm(125.04452 - 1934.136261 * T); // lunar ascending node
  const hours = (((ms / 3600000) % 24) + 24) % 24;
  const tau = norm(15 * hours + 180); // hour angle of the mean Sun
  return { s, h, p, N, tau };
}

/** Nodal factors f and phase corrections u (degrees) of the base families (Pugh 1987, table 4.3). */
function nodal(N) {
  const n = N * DEG;
  const c = Math.cos;
  const sn = Math.sin;
  return {
    M2: { f: 1.0004 - 0.0373 * c(n) + 0.0002 * c(2 * n), u: -2.14 * sn(n) },
    K1: { f: 1.006 + 0.115 * c(n) - 0.0088 * c(2 * n) + 0.0006 * c(3 * n), u: -8.86 * sn(n) + 0.68 * sn(2 * n) - 0.07 * sn(3 * n) },
    O1: { f: 1.0089 + 0.1871 * c(n) - 0.0147 * c(2 * n) + 0.0014 * c(3 * n), u: 10.8 * sn(n) - 1.34 * sn(2 * n) + 0.19 * sn(3 * n) },
    K2: { f: 1.0241 + 0.2863 * c(n) + 0.0083 * c(2 * n) - 0.0015 * c(3 * n), u: -17.74 * sn(n) + 0.68 * sn(2 * n) - 0.04 * sn(3 * n) },
    Mm: { f: 1 - 0.13 * c(n) + 0.0013 * c(2 * n), u: 0 },
    Mf: { f: 1.0429 + 0.4135 * c(n) - 0.004 * c(2 * n), u: -23.74 * sn(n) + 2.68 * sn(2 * n) - 0.38 * sn(3 * n) },
    J1: { f: 1.0129 + 0.1676 * c(n) - 0.017 * c(2 * n) + 0.0016 * c(3 * n), u: -12.94 * sn(n) + 1.34 * sn(2 * n) - 0.19 * sn(3 * n) },
    OO1: { f: 1.1027 + 0.6504 * c(n) + 0.0317 * c(2 * n) - 0.0014 * c(3 * n), u: -36.68 * sn(n) + 4.02 * sn(2 * n) - 0.57 * sn(3 * n) },
    one: { f: 1, u: 0 },
  };
}

// equilibrium arguments of the astronomical constituents (τ hour angle of the mean Sun, s Moon, h Sun, p perigee)
const V = {
  M2: (a) => 2 * a.tau - 2 * a.s + 2 * a.h,
  S2: (a) => 2 * a.tau,
  N2: (a) => 2 * a.tau - 3 * a.s + 2 * a.h + a.p,
  K2: (a) => 2 * a.tau + 2 * a.h,
  K1: (a) => a.tau + a.h - 90,
  O1: (a) => a.tau - 2 * a.s + a.h + 90,
};
// compound tides: arguments add, factors multiply, corrections add (sign −1 for a subtracted parent)
const combo = (parts) => ({
  V: (a) => parts.reduce((sum, [name, k]) => sum + k * V[name](a), 0),
  node: (n) => parts.reduce((acc, [name, k]) => {
    const fam = { M2: n.M2, N2: n.M2, S2: n.one, K2: n.K2, K1: n.K1, O1: n.O1 }[name];
    return { f: acc.f * fam.f ** Math.abs(k), u: acc.u + k * fam.u };
  }, { f: 1, u: 0 }),
});
const astro = (v, node) => ({ V: v, node });

/**
 * Constituents: equilibrium argument V(τ, s, h, p) and nodal factor/correction. The shallow-water set
 * matters in the Wadden Sea: the flood is shorter than the ebb and the low waters are long and flat.
 */
export const CONSTITUENTS = Object.freeze({
  // long period
  Sa: astro((a) => a.h, (n) => n.one),
  Ssa: astro((a) => 2 * a.h, (n) => n.one),
  Mm: astro((a) => a.s - a.p, (n) => n.Mm),
  MSf: combo([['S2', 1], ['M2', -1]]),
  Mf: astro((a) => 2 * a.s, (n) => n.Mf),
  // diurnal
  Q1: astro((a) => a.tau - 3 * a.s + a.h + a.p + 90, (n) => n.O1),
  O1: astro(V.O1, (n) => n.O1),
  P1: astro((a) => a.tau - a.h + 90, (n) => n.one),
  K1: astro(V.K1, (n) => n.K1),
  J1: astro((a) => a.tau + a.s + a.h - a.p - 90, (n) => n.J1),
  OO1: astro((a) => a.tau + 2 * a.s + a.h - 90, (n) => n.OO1),
  // semi-diurnal
  '2N2': astro((a) => 2 * a.tau - 4 * a.s + 2 * a.h + 2 * a.p, (n) => n.M2),
  MU2: astro((a) => 2 * a.tau - 4 * a.s + 4 * a.h, (n) => n.M2),
  N2: astro(V.N2, (n) => n.M2),
  NU2: astro((a) => 2 * a.tau - 3 * a.s + 4 * a.h - a.p, (n) => n.M2),
  M2: astro(V.M2, (n) => n.M2),
  LAMBDA2: astro((a) => 2 * a.tau - a.s + a.p + 180, (n) => n.M2),
  L2: astro((a) => 2 * a.tau - a.s + 2 * a.h - a.p + 180, (n) => n.M2),
  S2: astro(V.S2, (n) => n.one),
  K2: astro(V.K2, (n) => n.K2),
  '2SM2': combo([['S2', 2], ['M2', -1]]),
  // ter- to eighth-diurnal (shallow water)
  MO3: combo([['M2', 1], ['O1', 1]]),
  M3: astro((a) => 1.5 * V.M2(a), (n) => ({ f: n.M2.f ** 1.5, u: 1.5 * n.M2.u })),
  MK3: combo([['M2', 1], ['K1', 1]]),
  SK3: combo([['S2', 1], ['K1', 1]]),
  MN4: combo([['M2', 1], ['N2', 1]]),
  M4: combo([['M2', 2]]),
  SN4: combo([['S2', 1], ['N2', 1]]),
  MS4: combo([['M2', 1], ['S2', 1]]),
  MK4: combo([['M2', 1], ['K2', 1]]),
  S4: combo([['S2', 2]]),
  '2MN6': combo([['M2', 2], ['N2', 1]]),
  M6: combo([['M2', 3]]),
  MSN6: combo([['M2', 1], ['S2', 1], ['N2', 1]]),
  '2MS6': combo([['M2', 2], ['S2', 1]]),
  '2SM6': combo([['S2', 2], ['M2', 1]]),
  '3MS8': combo([['M2', 3], ['S2', 1]]),
  M8: combo([['M2', 4]]),
});

/** f, and V + u (degrees) of every constituent at an instant. */
export function constituentTerms(ms, names = Object.keys(CONSTITUENTS)) {
  const a = astronomicalArguments(ms);
  const k = nodal(a.N);
  return names.map((name) => {
    const c = CONSTITUENTS[name];
    const { f, u } = c.node(k);
    return { name, f, phase: norm(c.V(a) + u) };
  });
}

/**
 * Water level (m) at an instant from a station's constants.
 * @param {{ z0: number, constituents: Record<string, { H: number, g: number }> }} station  H in m, g in degrees
 */
export function predictTide(station, ms) {
  let eta = station.z0;
  for (const t of constituentTerms(ms, Object.keys(station.constituents))) {
    const { H, g } = station.constituents[t.name];
    eta += t.f * H * Math.cos((t.phase - g) * DEG);
  }
  return eta;
}

/**
 * High and low waters in [from, to] (ms): extremes of a sampled series, refined by a parabola through
 * the neighbours. `level(ms)` is any water level function.
 * @returns {Array<{ time: number, level: number, high: boolean }>}
 */
export function findExtremes(level, from, to, stepMs = 5 * 60000) {
  const out = [];
  let y0 = level(from - stepMs);
  let t1 = from;
  let y1 = level(t1);
  for (let t2 = from + stepMs; t2 <= to + stepMs; t2 += stepMs) {
    const y2 = level(t2);
    if ((y1 > y0 && y1 >= y2) || (y1 < y0 && y1 <= y2)) {
      const denom = y0 - 2 * y1 + y2;
      const dx = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
      const time = t1 + dx * stepMs;
      if (time >= from && time <= to) out.push({ time, level: y1 - 0.25 * (y0 - y2) * dx, high: y1 > y0 });
    }
    y0 = y1;
    t1 = t2;
    y1 = y2;
  }
  return out;
}
