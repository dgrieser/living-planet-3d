# 07 · Water, tides (Ebbe und Flut) and the sea floor

[← back to the plan index](README.md)

**Accuracy targets**

- Global ocean: the real wind sea and swell look (from wave forecasts), real tidal
  sea-surface height at shelf scale (for the overlay and for coasts outside the hero areas).
- **Fanø**: water level at every point of the Wadden Sea within **±10 cm and ±10 min**
  of the DMI gauges (incl. storm surge); flats fall dry and flood where and when they
  really do; waves as forecast by DMI WAM.
- **Remove the water**: the sea floor that appears is the best available measured
  surface, with its provenance shown.

**(✓)** verified during research (Oct 2026), **(~)** secondary / own design.

---

## 1. Ocean surface rendering

### 1.1 Spectrum and simulation

- **Tessendorf FFT** ocean, **3 cascades** (e.g. 1 024 m / 144 m / 24 m patches) in TSL
  compute; directional spectrum **JONSWAP** (wind speed + fetch from the NWP / wave
  model) with **Horvath 2015** spreading and swell, and the **TMA finite-depth
  correction** using the bathymetry texture → waves shorten and steepen over the Fanø
  shoals.
- **Starting point: Poseidon** (owenyuwono, **MIT**, three r184, WebGPU + TSL, 3 cascades,
  JONSWAP/Horvath + TMA, Jacobian foam with build-up/decay tuned to a wind-speed whitecap
  fraction, Jerlov water optics). It has **no shoreline handling** – we add it. (✓)
  Alternatives / references: Spiri0 *Threejs-WebGPU-IFFT-Ocean-V2* (MIT), Noniv
  *web-ocean* (MIT, raw WebGPU, foam persistence), jbouny *fft-ocean* (WebGL – basis for
  the WebGL2 fallback), three.js `WaterMesh` (scrolling normals – lowest tier and far
  distance).
- Wave parameters per region from **DMI WAM** (Fanø, ~1 km), **CMEMS NWS** waves
  (1.5 km), **ECMWF WAM** (0.25°, global) – significant height, peak period, direction,
  swell – drive the spectrum's energy and direction per area (blended spatially).

### 1.2 Shoreline and shallow water (Fanø beach)

Without a solver (always on):

- finite-depth dispersion ω² = gk·tanh(kd) from the bathymetry texture,
- shoaling (Green's law, amplitude ∝ d^−¼), refraction approximated by aligning wave
  direction with the depth gradient,
- **breaking where H/d ≈ 0.78** → foam injection, surf-zone foam bands,
- foam lines pushed along a **shoreline signed-distance field**, swash as a scrolling
  run-up mask, wet-sand band that follows the swash and dries behind it.

With a local solver (High/Ultra, near the camera): a **Boussinesq / nonlinear
shallow-water window** (~1–2 km, 2–4 m cells) in WebGPU compute for the surf zone and
the incoming flood front on the flats – reference: **Celeris-WebGPU** (MIT, browser
Boussinesq with run-up/inundation); Kurganov–Petrova central-upwind scheme for robust
wetting/drying; virtual-pipes method as the cheap variant. Driven at its boundary by
the baked tide (§3) and the spectrum.

Further: *Water Surface Wavelets* (Jeschke 2018, MIT C++) for diffraction around the
harbour moles in a later phase; wave particles for the ferry's wake.

### 1.3 Optics

Screen-space reflections + sky/planar fallback, screen-space refraction, Fresnel,
**Jerlov coastal water type** per-channel absorption (the Wadden Sea is turbid: green-
brown, short visibility), suspended sediment from the tidal current speed, sun glitter,
**caustics** in shallow water over sand (Evan Wallace's technique ported to TSL),
underwater: height fog with the same absorption, god rays, the surface seen from below
(Snell's window).

## 2. Global tides

| Item | Choice | Licence | |
|---|---|---|---|
| Global atlas | **FES2022b** (1/30°, AVISO+ registration; heights usable for any purpose incl. commercial; currents not distributed) | AVISO terms | ✓ |
| Cross-checks | TPXO10-atlas v2 (academic/non-commercial only), EOT20 (CC BY), GOT5 | – | ✓ |
| Prediction | **pyTMD** (MIT) in the pipeline; at runtime our own `tides.js` (harmonic sum with nodal f, u and astronomical arguments V) | – | ✓ |
| Gauges | GESLA-3 (research use), **TICON-3** harmonic constants (CC BY 4.0) for validation worldwide | – | ✓ |

Pipeline: FES2022b constituents (≈ 15 major + shallow-water M4/MS4/MN4) resampled to a
1/16° global texture set (amplitude/phase per constituent) → the shader sums them for the
sea surface height at shelf scale. This drives:

- the global **tide overlay** (co-tidal lines and **amphidromic points** – a direct link
  to the `moon-tides` simulation, which shows the equilibrium tide: here the visitor sees
  the *real* one, rotating around amphidromes in the North Sea),
- the water level on coasts outside the hero areas.

## 3. The Wadden Sea tide model (Fanø)

Global atlases (~2 km) cannot resolve tidal channels. Plan:

### 3.1 Offline hydrodynamic model

1. **Mesh**: unstructured mesh of the Grådyb–Knudedyb tidal basins and the adjacent
   North Sea, 20–50 m in channels and on the flats, coarser offshore; bed from the
   seamless DEM ([04 §3](04-data-fanoe.md#3-sea-floor-flats-and-coast)).
2. **Model**: **SCHISM** (Apache-2.0, native wetting/drying, NTHMP-benchmarked) –
   alternative D-Flow FM (Delft3D FM, AGPL/GPL, large Wadden Sea user base).
3. **Forcing**: FES2022b at the open boundary (+ DMI DKSS surge for event runs), wind
   from DINI for event runs.
4. **Calibration/validation**: DMI gauges Esbjerg, Grådyb Barre, Nordby/Sønderho
   predictions, Mandø, Ribe (§[04 §4](04-data-fanoe.md#4-tides-and-sea-level)); DKSS
   `dkss_ws` as an operational comparison.
5. **Run** ≥ 60 days (better 370 days for the full constituent set) of pure tide.

### 3.2 Baking for real time

- Harmonic analysis per node (UTide) of water level η and depth-averaged currents u, v
  for ~12–16 constituents (M2, S2, N2, K2, K1, O1, P1, Q1, M4, MS4, MN4, M6, 2MS6, Sa,
  Ssa…) → amplitude/phase rasters on a ~15–25 m grid over the model box → RGBA16F
  textures (≈ 50 MB).
- **Wet/dry caveat**: harmonic reconstruction fails at cells that fall dry (the signal is
  clipped). Fix: store the water level of the nearest *always-wet* channel cell and the
  bed elevation, and compute local depth = max(0, η − z_bed) with a spreading kernel; or
  store a phase lookup table (48 snapshots per M2 cycle, scaled by the spring/neap
  factor). Choose by comparing both against the full model run.
- **Runtime**: `tides.js` computes the nodal factors and arguments once per frame (cheap),
  the shader sums `Σ f·H·cos(V + u − g)` per texel → water level field; **+ surge**:
  observed (DMI `sealev_dvr` minus prediction) in live/replay mode, DKSS forecast in
  forecast mode, applied as a smooth field (gradient from Esbjerg to Grådyb Barre) –
  for extreme surges with flooding of the salt marsh, precomputed full model runs of the
  showcase events (1981, 1999, 2013) as time series textures.
- **Currents** (u, v) from the same harmonics → flow maps for normals, foam and
  suspended-sediment advection, and visibly turning currents at slack water.

### 3.3 Fallback (before the model exists, M5 start)

Gauge harmonics (Esbjerg / Grådyb Barre / Nordby, already fitted – [04 §4.2](04-data-fanoe.md#42-tidal-character-from-the-dmi-2026-prediction-series))
interpolated in space with a co-tidal phase lag along the channel network + hypsometric
flooding of the DEM. Good to ±20 cm / ±20 min, enough to get the flats falling dry.

## 4. The tidal flats falling dry

- **Depth** = water level − bed (per texel). Below a few cm: thin water film shading;
  at zero: exposed flat.
- **Wetness timer** per texel: after the water leaves, the surface dries exponentially
  (sun, wind): dark glossy wet sand → matte light sand; sheen with strong Fresnel at low
  sun – the classic glittering Wadden view.
- **Drainage gullies (*priele*)**: from flow accumulation on the DEM (WhiteboxTools /
  pysheds) → keep water in the small channels longest, render meandering rivulets.
- **Puddles** in local minima of the DEM stay after the ebb.
- **Ripple marks**: normal-map ripples aligned with the baked current direction (sand
  ripples perpendicular to the flow); lugworm casts and mussel/oyster beds as detail
  materials on the right substrate.
- **Flood front**: the local shallow-water window draws the thin advancing water edge
  near the camera.
- **Salt marsh**: creeks fill first; the marsh floods only at spring high tides and
  surges.
- **Beach traffic**: the drivable beach at Fanø Bad – firm wet sand below the high-water
  line.

## 5. Inland water (Lübbecke)

| Water | Model |
|---|---|
| **Mittellandkanal** | fixed water level of its reach (level and profile from WSV data, [03](03-data-luebbecke.md)), standard canal cross-section as bed geometry, waves only from wind (short fetch) and passing ships (wakes) |
| Streams (*Bäche*) from the Wiehengebirge | flowing water with flow maps along the stream centreline (ELWAS-WEB network), water depth from the DEM's channel + a typical profile; level and turbidity rise after heavy rain (DWD radar) |
| Ponds, Großes Torfmoor open water | still water, wind ripples, reeds; bog water dark brown (humic) |
| Puddles | from the wetness model ([08 §6](08-atmosphere-weather-clouds.md#6-precipitation-wet-surfaces-rainbows-lightning)) |
| Ice | [09 §5](09-snow-ice-winter.md#5-ice) |

## 6. "Remove the water" – the sea floor

### 6.1 Mechanics

The water-level slider ([10 §2.1](10-time-ui-interaction.md#21-headline-controls-always-visible))
lowers the sea surface from "real" to −11 000 m. Everything below the new level becomes
dry ground:

- the water surface is clipped at the chosen level (per texel the sea surface height is
  `min(real level, slider level)`); lakes and canals drain with their own bed,
- the **sea floor** is ordinary terrain (it is already part of the seamless height field),
  shaded with a sediment material classification (sand / mud / gravel / rock from
  EMODnet Seabed Habitats where available, slope-based elsewhere) and optional
  **hypsometric tint** + depth contours,
- newly exposed ground is wet for a while after it falls dry (same wetness model), dries
  to salt-crusted mud in deep basins (cosmetic),
- the provenance overlay shows **measured** sea floor (multibeam, LiDAR, GEBCO TID
  "direct measurement") vs. **predicted** (altimetry) – honest about the 71 % of the
  ocean floor that is only known at km scale.

### 6.2 Data per scale

| Scale | Source | Resolution |
|---|---|---|
| Global | GEBCO_2026 (sub-ice variant optional) | 15″ (~450 m) |
| European seas | EMODnet DTM 2024 (+ HR-DTMs) | ~115 m (to ~4 m) |
| Danish waters | Danmarks Dybdemodel 2024 | 50 m |
| **Fanø flats & channels** | seamless DEM ([04 §3](04-data-fanoe.md#3-sea-floor-flats-and-coast)): DHM 0.4 m + green LiDAR + satellite intertidal DEM + multibeam | 0.4–5 m |
| Lakes (global) | GLOBathy | per lake |

### 6.3 Educational extras

- Snap stops at *mean low water*, *−10 m*, *−50 m*, *−200 m (shelf edge)*: the North Sea
  drains at about −100 m and Doggerland appears; at −120 m the Last Glacial Maximum
  coastline.
- **Sea-level rise** what-if (+0 … +2 m) on Fanø: which parts of Nordby, Sønderho and the
  marsh flood at mean high water and at the 100-year surge (4.07 m at Esbjerg).

## 7. Validation

- `check-earth-tides.mjs`: harmonic predictions vs. DMI official predictions for Esbjerg,
  Grådyb Barre, Nordby: HW/LW times ±10 min, heights ±10 cm over a year; nodal
  corrections vs. reference tables.
- Model run vs. gauges: RMS of (model − observed tide) ≤ 10 cm; HW/LW timing ≤ 10 min.
- Dry-flat extent vs. Sentinel-2 / orthophotos taken at known water levels: overlap
  (IoU) ≥ 0.85.
