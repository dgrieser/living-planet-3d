# 08 · Atmosphere, weather, clouds, wind, light and shadows

[← back to the plan index](README.md)

Goal: the sky over any place at any instant looks like it did (or will), from orbit down
to a puddle. **(✓)** = verified during research (Oct 2026), **(~)** = secondary source /
own design, **(?)** = to confirm.

> **What "accurate" can mean for weather.** Fronts, cloud layers, cloud base and top,
> cover fraction, precipitation timing, wind and temperature can be reproduced from
> analyses, satellite and radar to within the error of those products. *Individual*
> cumulus clouds, gusts and raindrops cannot be observed at that scale: they are
> generated so that their statistics match the data and – where a satellite cloud mask
> exists – so that they sit where the satellite saw cloud. The model card says this.

---

## 1. Sun, Moon, stars

| Item | Choice | |
|---|---|---|
| Ephemeris | **astronomy-engine 2.1.19** (MIT, ±1′ vs. NOVAS/JPL Horizons; rise/set, topocentric with refraction, phases, libration, eclipses). Already a dependency of `@takram/three-atmosphere`, which exposes `getSunDirectionECI` / `getMoonDirectionECI` | ✓ |
| Moon | LRO colour + normal map, phase-correct illumination, earthshine; moonlight as a second (dim, cooler) directional light with its own shadows at night | ~ |
| Stars | bright-star catalogue rendered in the sky pass, extinction by the atmosphere, twinkling from turbulence near the horizon | ~ |
| Light pollution | sky glow from the Black Marble radiance around the observer | ~ |
| Aurora | reuse the auroral-oval model of the `magnetosphere` sim, driven by the real Kp index (NOAA SWPC) – visible from Fanø in strong storms | ~ |

Validation: `check-earth-ephemeris.mjs` against JPL Horizons
([12](12-roadmap-verification-licences.md#2-verification-keep-the-repos-scriptscheck-mjs-culture)).

## 2. Atmosphere (sky, aerial perspective, sunlight)

- **Technique**: Bruneton precomputed scattering (2008/2017) and/or Hillaire 2020
  (transmittance, multi-scattering, sky-view and aerial-perspective LUTs – cheap enough
  to recompute every frame, valid from the ground to space).
- **Library**: **`@takram/three-atmosphere` 0.19.1** (MIT) – Bruneton LUTs + Hillaire
  multi-scattering; its **`/webgpu` export** (three ≥ 0.182) provides `AtmosphereLight`
  (physically correct sun + sky light for any material), `aerialPerspective()` and
  `skyBackground()` (sun, moon, stars), world-origin rebasing, light shafts. Examples with
  3D Tiles and from orbit. (✓)
  - Alternative: **`@pmndrs/sky` 0.6.0** (MIT, Hillaire 2020, ground to orbit, ~1 ms sky
    lighting refiltering, WebGPU-only, three ≥ 0.186). Very new. (✓)
  - Risk: takram's project has had one maintainer and ~5 quiet months; keep the
    integration thin so the atmosphere is swappable.
- **Dynamic inputs**: aerosol optical depth (Saharan dust, haze, smoke) from CAMS
  (Copernicus Atmosphere Monitoring Service) as a scalar per region to modulate Mie
  scattering; humidity from the NWP for haze; ozone climatology.
- **Exposure**: physically based (EV from sun/sky luminance) with auto-exposure, so a
  midday beach and a moonlit heath both read correctly. Tone mapping: AgX or ACES.

## 3. Weather data

### 3.1 Sources

| Source | Resolution / cadence | What it gives the renderer | Licence | |
|---|---|---|---|---|
| **NOAA GFS 0.25°** | 4 runs/day, to +384 h, AWS `noaa-gfs-bdp-pds` | **best open global 3D cloud structure**: cloud water / ice / rain / snow / graupel mixing ratios and **cloud cover on 22 pressure levels**, low/mid/high cover with base/top, precipitation type, snow depth, wind on 41 levels | open | ✓ |
| **ECMWF IFS open data** | 0.25° (and a new **0.1°** grid since 20 Oct 2026), 4 runs/day, portal keeps ~12 runs; AWS/Azure/GCP mirrors | tcc/lcc/mcc/hcc, column cloud water/ice/rain, wind/T/q on 14 pressure levels, 10 m/100 m wind, gusts, precip, **ptype**, snow depth. *Not* open: per-level cloud fraction / water | CC BY 4.0 | ✓ |
| ECMWF AIFS (single/ENS) | 0.25°, 4 runs/day | cloud cover layers, wind | CC BY 4.0 | ✓ |
| **DWD ICON-D2** (~2.2 km, covers **both** hero areas) | 8 runs/day to +48 h, ~1 h latency, server keeps ~24 h | **cloud fraction on all 65 model levels**, qc/qi/qr/qs/qg, w, TKE, level heights, cloud base/top, ceiling, synthetic radar, lightning potential, **synthetic satellite brightness temperatures**, snow depth (`h_snow`), fresh snow, snow density | CC BY 4.0 | ✓ (folders listed live) |
| DWD ICON-EU 6.5 km / ICON 13 km | 8 / 4 runs/day | clc on 74 model + 20 pressure levels (EU) | CC BY 4.0 | ✓ |
| **DMI HARMONIE DINI** (2 km, Fanø) | every 3 h to +60 h, STAC/EDR API **without key**, kept 48 h | surface, pressure-level and **model-level** collections (`harmonie_dini_sf/_pl/_ml`); also EPS products | CC BY 4.0 | ✓ (collections listed live) |
| **ERA5** (reanalysis) | 0.25°, hourly, 1940 → ~5 days ago; 37 pressure / 137 model levels | **per-level cloud fraction, liquid, ice, rain, snow**, cloud base height – the replay-mode source | CC BY | ✓ |
| ARCO-ERA5 (Google Cloud Zarr) | same, anonymous, from 1979 | on-demand baking without CDS queues | CC BY | ✓ |
| ERA5-Land | 0.1°, hourly | snow depth, soil moisture, skin temperature | CC BY | ✓ |
| CERRA | 5.5 km Europe | regional replay (coverage end date conflicting between sources) | CC BY | ~ |
| Open-Meteo API | point/time-series; ICON-D2, DINI, IFS, GFS, ERA5, marine | quick point checks & readouts (free non-commercial: 10 000 calls/day); **its pressure-level cloud cover is derived from RH** – not used for 3D clouds | data CC BY 4.0 | ✓ |

### 3.2 Satellite, radar, lightning (observations)

| Source | Cadence / latency | Use | Licence | |
|---|---|---|---|---|
| **EUMETSAT MTG-FCI** (Meteosat Third Generation) | full disk 10 min, Europe 2.5 min | cloud mask (`FCI-2-CLM`), cloud type & top height (`CT/CTTH`), optimal cloud analysis; hourly L1 free; full-cadence L1 free at ≥ 1 h latency (< 1 h costs €4–8 k/yr) | derived products **CC BY 4.0** (policy of 25 Nov 2025) | ✓ |
| DWD satellite cloud-top height | 10–15 min, ~20 min latency | cheap European cloud-top height field | CC BY 4.0 | ✓ |
| GOES-19/18, Himawari-9 (AWS) | 10 min full disk | Americas / Asia-Pacific cloud-top height & imagery | NOAA open | ✓ |
| NOAA GMGSI | hourly global IR/VIS mosaic, ~8 km | simplest whole-globe "clouds right now" from space | open | ~ |
| GridSat-B1 | 1980 → now, 0.07°, 3-hourly IR | historical cloud placement | NOAA CDR | ✓ |
| **DWD RADOLAN RV** | 1 km, 5 min, + 2 h nowcast, ~3 min latency | rain over Lübbecke | CC BY 4.0 | ✓ |
| **DMI radar composite** | 500 m, 5 min, kept 180 days | rain over Fanø | CC BY 4.0 | ✓ |
| **OPERA CIRRUS** composite | 1 km, 5 min, archive from 2012 | European rain (replay) | CC BY 4.0 | ✓ |
| MTG Lightning Imager L2 | 30 s / 5 min | lightning flashes | CC BY 4.0 | ~ |
| Blitzortung | – | **not usable** (participants / approved projects only) | – | ~ |

### 3.3 The weather baker (server side)

A Python job (xarray + cfgrib/eccodes) runs on a schedule ([11](11-pipeline-hosting.md)),
keeps **its own archive** (DWD keeps ~24 h, DMI 48 h, ECMWF 2–3 days) and writes compact
brotli-compressed textures in a quadtree:

| Tier | Source | Output | Update |
|---|---|---|---|
| **G – global** (space → ~50 km altitude) | GFS 0.25° 3D cloud fields; IFS 0.1° for layer cover, ptype, wind (cross-check) | 2048×1024 (or cube-sphere 6×512²) textures: **A** coverage low/mid/high/convective · **B** cloud base, top, water+ice path, type/phase · **C** precipitation rate/type, 700 hPa wind; optional 3D volume 1440×721×24 (0–14 km stretched, R8 ≈ 25 MB) | every 6 h run, hourly steps |
| **S – satellite correction** (live mode) | GMGSI (global hourly), FCI cloud mask + CTTH and DWD CTH (Europe, 10 min), GOES/Himawari | 4–8 km cloud mask + cloud-top override, blended when < 1 h old | 10–60 min |
| **R – regional** | ICON-D2 65-level clc/qc/qi (DE+DK), DINI model levels (DK), ICON-EU (rest of Europe); radar for precipitation | 3D textures resampled to height above ground, 0–12 km in 40 levels (300 m); ICON-D2 ≈ 1215×746×40 R8 ≈ 36 MB per step, streamed in 256² tiles near the camera | 3-hourly runs, hourly steps; radar 5 min |
| **L – hero areas** (~20×20 km) | R + S + radar | 80×80×64 at 250 m plus Nubis-style detail noise; precomputed wind lookups (§5) | as R |

**Satellite–model fusion** (own design, ~):

1. Vertical structure (cloud base, layers, water content) from the NWP.
2. Horizontal placement from the satellite cloud mask (1–3 km, 10 min); cloud tops from
   CTTH.
3. Satellite cloudy / model clear → insert cloud between the observed top and a type
   dependent base. Satellite confidently clear → thin model cloud (except low cloud
   hidden under high cloud).
4. **Field alignment**: optical flow between ICON-D2's *synthetic* 10.8 µm image and the
   real FCI image gives a displacement field that is applied to all 3D fields – fixes the
   model's position errors of fronts and showers.
5. Optical flow between satellite frames interpolates in time and extrapolates the last
   frame 30–60 min to "now".

**Time handling**

| Mode | Data |
|---|---|
| live | latest NWP step + satellite/radar correction, advected to now |
| forecast | ICON-D2 (48 h), DINI (60 h), IFS HRES (10 d) / ENS (15 d), GFS (16 d) |
| replay ≥ 5 days ago | ARCO-ERA5 (37-level cloud fraction, liquid, ice), CERRA for Europe, GridSat-B1 IR (1980+), OPERA radar archive (2012+) |
| replay 0–5 days | our own archive of runs |
| climatology | seeded weather generator (§7) |

Between NWP time steps clouds are **advected along the 700 hPa wind, then cross-faded**
– pure cross-fading makes clouds blink instead of drift.

## 4. Clouds (rendering)

- **References**: Schneider, *Real-time Volumetric Cloudscapes of Horizon Zero Dawn*
  (2015), *Nubis* (2017), *Nubis Evolved* (2022, fly-through, in-cloud lightning),
  *Nubis³* (2023, voxel clouds with compressed signed-distance acceleration); Hillaire
  2016 (Frostbite energy-conserving integration); Hillaire 2020 (beer shadow maps).
- **Library status**: `@takram/three-clouds` 0.7.6 (MIT) – excellent, but **WebGL/GLSL
  only**, max 4 layers, and its weather texture is a *repeating tile*, not a geo-located
  map; global coverage / views from space only "planned"; a WebGPU port lives on a branch.
  → **Write our own TSL cloud pass using takram's MIT GLSL as the template**, with a
  geo-referenced weather input. (✓)
- **Density model**: for each column take the highest tier available (L → R → G, blended
  at the edges), shape it with a height profile per cloud type (stratus, stratocumulus,
  cumulus, cumulonimbus, altostratus, cirrus – Nubis-style), erode with 3D
  Perlin–Worley noise (128³ shape + 32³ detail), add curl-noise distortion advected by
  the wind.
- **Marching**: quarter/half resolution, 64–128 primary + 6 light samples, blue-noise
  jitter, temporal reprojection; "powder" term; multiple-scattering approximation;
  lightning flashes as internal point lights (from Lightning Imager flashes or ICON-D2
  LPI).
- **From space**: above ~30–50 km switch to a 2.5D cloud shell from the tier-G textures
  (coverage, optical depth, top height) with parallax and a self-shadow term; it matches
  the GIBS/GMGSI imagery of the same hour.
- **Fog and low stratus**: froxel volumetric fog (Wronski 2014, Hillaire 2015) from NWP
  visibility / RH near the ground; valley fog in the Lübbecke lowland (cold-air pooling),
  sea fog over the Wadden Sea.

## 5. Wind

| Scale | Source | Resolution | Use |
|---|---|---|---|
| Global / regional | GFS / IFS / ICON-D2 / DINI (10 m, 100 m, pressure levels) | 2–25 km | cloud advection, wave spectrum (wind speed + fetch), flags |
| **Terrain (Lübbecke ridge)** | **WindNinja** (US public domain; mass-conserving + OpenFOAM momentum solver) precomputed for 16 directions × 2–3 speeds on the 1–10 m DEM | 20–50 m | speed-up over the Wiehengebirge crest, lee shelter, channelling (✓ licence) |
| **Town (Lübbecke)** | **PALM-4U** (GPLv3 LES, v25.10.1; output data not GPL) precomputed for ~3×3 km at 5–10 m, 16 directions × 3 stability cases → mean wind + turbulence as 3D textures. **Optional, after M6**: 48 LES runs ≈ 10³–10⁴ core-hours (an HPC/cloud budget, not the mittwald server) and ≈ 1–4 GB of 3D textures (~) | 5–10 m | street canyon flow, gusts around buildings, leaves swirling in courtyards |
| Fanø (flat) | DINI 10 m wind + log/roughness profile per land-cover class (sea, sand, dune, heath, forest) | 2 km → per pixel | dune grass, sand drift, kite festival |
| Runtime | 3D wind texture around the camera (≈ 1 km, 64×64×16), gusts as travelling noise fronts | – | vegetation sway, leaves, rain/snow slant, cloud detail, waves |

Vegetation animation follows *GPU Gems 3 ch. 16 (Crysis)*: main bending + branch
detail + leaf flutter weighted by vertex colours ([06](06-vegetation-seasons.md)).

## 6. Precipitation, wet surfaces, rainbows, lightning

- **Rain**: GPU particle streaks (Garg & Nayar 2006; NVIDIA rain SDK 2007) in a camera
  volume, density from radar rain rate, slant from wind; splashes and ripples on water
  and puddles; **wetness model** (Lagarde 2013): albedo darkens by porosity, roughness
  drops, puddles form in DEM local minima and flatten normals, then dry with sun, wind and
  temperature (history state, [10 §1.4](10-time-ui-interaction.md#14-history-dependent-state-the-land-remembers)).
- **Snowfall**: flakes as particles with flutter, accumulation handled in
  [09](09-snow-ice-winter.md).
- **Hail, graupel, sleet**: precipitation type from IFS `ptype` / GFS flags / ICON-D2
  `qg`.
- **Rainbows**: precomputed brightness by scattering angle and drop size (Sadeghi et al.
  2012); shown where it rains, the sun is behind the viewer and below ~42°.
- **Lightning**: procedural branching bolts timed by MTG Lightning Imager flashes (live)
  or ICON-D2 lightning potential index (forecast), lighting the cloud from inside.

## 7. Weather generator (for `climatology` mode)

For dates without data: a stochastic weather generator (Markov chain of weather types /
Grosswetterlagen, with daily T, precipitation, wind, cloud cover statistics fitted on 30
years of ERA5 / DWD / DMI station data for each hero area) seeded by the date, so the same
date always gives the same weather. Output feeds the same textures as real data, flagged
as *typical*.

## 8. Shadows and lighting

| Effect | Technique |
|---|---|
| Sun shadows (buildings, trees, terrain near) | cascaded shadow maps (4 cascades, 2048²), stabilised; contact shadows in screen space |
| Terrain self-shadowing (far) | horizon maps per terrain tile or a coarse far cascade |
| **Cloud shadows** | beer shadow map from the cloud raymarch (Hillaire 2020): 1024² cascades near the camera + a coarse global 2D transmittance map for views from space; also dims the sky light |
| Ambient / sky light | atmosphere's `AtmosphereLight` (sky irradiance), GTAO for occlusion; optional SSGI on Ultra |
| Moonlight | second directional light at night with its own (low-res) shadows |
| Artificial light | street lamps (positions from OSM/ALKIS/GeoDanmark where mapped, else procedural along roads), window lights by building function and time of day, lighthouses (rotating beams through fog), ferry lights |
| Light shafts | from the atmosphere/cloud passes (crepuscular rays through cloud gaps) |
