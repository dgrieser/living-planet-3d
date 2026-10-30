# 12 · Roadmap, verification, risks and licences

[← back to the plan index](README.md)

---

## 1. Milestones

Each milestone ends in something that runs in the browser and is deployable behind the
work-in-progress flag (`hidden: true`). Sizes are relative effort (S ≈ days, M ≈ 1–2
weeks, L ≈ 3–6 weeks, XL ≈ 2–3 months of focused work for one developer).

| # | Milestone | Content | Exit criteria | Size |
|---|---|---|---|---|
| **M0** | Foundations | `earth` sim scaffold, WebGPU renderer with WebGL2 fallback, globe tiles streaming (3d-tiles-renderer), camera stack (globe → local → walk), `clock.js`, `ephemeris.js`, `geodesy.js` + checks, physically based atmosphere, attribution strip | Zoom from space to 1 km over any place at 60 fps (mid laptop); sun and moon within 0.01° of JPL Horizons; check scripts green | L |
| **M1** | The whole Earth from a distance | Global terrain + bathymetry tiles, seasonal global imagery (monthly), night lights, snow & sea-ice overlay from daily products, global cloud layer from NWP (2D → volumetric), global tide overlay (amphidromes), **drain-the-ocean** slider on GEBCO | Globe looks right for any date 2004–today; draining reveals the mid-ocean ridges; clouds match the satellite picture of the same hour at synoptic scale | XL |
| **M2** | Hero terrain & imagery | Pipelines for DGM1/DOP (NRW) and DHM/orthophoto (DK), vertical datum conversion, merged land–sea DEM for the Wadden Sea, de-shadowed orthophotos, ground material classification, hero tilesets on object storage | Ground at 10 cm imagery / ≤ 1 m relief; seams to the global layer invisible; heights within ±0.2 m of the source at control points | L |
| **M3** | Buildings | NRW LoD2 → 3D Tiles; DK LoD2 reconstruction from DHM point cloud + footprints; roof textures from the orthophoto; procedural facades by function/age/material; windows lit at night | Every building of both areas present, roof shapes match the orthophoto, picking shows ALKIS/BBR attributes | L |
| **M4** | Vegetation | Single-tree inventory from LiDAR, species assignment, procedural species models with LOD/impostors, wind animation, ground cover (grass, crops, heath, dune grass), hedges | Every tree > 3 m of both areas placed within 1 m of its LiDAR crown top; forest edges match the orthophoto; 60 fps at "High" over the Wiehengebirge forest | XL |
| **M5** | Water | FFT ocean (cascades, JONSWAP/TMA, foam), shoreline breakers, Wadden Sea tide model (offline hydrodynamics → baked harmonics), wet/dry flats with drainage gullies, Mittellandkanal and ponds, underwater, hero-resolution drained mode | Water line at Fanø within ±10 min / ±10 cm of DMI gauges over a test month; flats fall dry where the orthophoto at low water shows dry flats | XL |
| **M6** | Weather | Scheduled weather pipeline, volumetric clouds (local + global), cloud shadows, precipitation (rain/snow/wet surfaces), wind downscaling (hero areas), fog, live mode | For test days, cloud cover / precipitation timing match radar & satellite; wind at stations within NWP error | XL |
| **M7** | Seasons & snow | Phenology models + calibration, leaf colours per species, leaf litter, crop calendar per field, heath/marsh colours, snowpack + downscaling + rendering, Wadden Sea ice | Leaf-out and colouring dates within ±7 days of DWD/PEP725 observations; snow present/absent correct on ≥ 90 % of station days | L |
| **M8** | Hero spots | Gaussian-splat or photogrammetry captures of selected spots (Lübbecke market square & Burgmannshöfe, Reineberg, Sønderho, Nordby harbour), street furniture, fences, signs, street lamps | Side-by-side with photos at eye level the spots are recognisable in detail | L (+ capture time) |
| **M9** | Polish | Performance tiers, mobile, accessibility, i18n texts, model card, docs in the root README, remove `hidden` | Lighthouse/frame-time budget met on the reference devices | M |

Order rationale: M0–M1 deliver "the whole Earth from a distance" first (as requested);
M2–M4 build the static hero worlds; M5–M7 add the dynamic systems that make them *live*;
M8 adds the last centimetre. M5–M7 can run in parallel once M2 exists.

---

## 2. Verification (keep the repo's `scripts/check-*.mjs` culture)

Every pure-JS model gets a node check script, run in CI next to lint/build.

| Script | Validates | Reference / tolerance |
|---|---|---|
| `check-earth-ephemeris.mjs` | sun & moon topocentric position, sunrise/sunset, moon phase | JPL Horizons samples for Lübbecke and Nordby, ≤ 0.01°, sunrise ±30 s |
| `check-earth-geodesy.mjs` | geodetic ↔ ECEF ↔ ENU, UTM32 (EPSG:25832) → WGS84, ETRS89 ↔ ITRF epoch shift, geoid/quasigeoid lookups | PROJ reference values ≤ 1 mm; official geoid control points ≤ 1 cm |
| `check-earth-tides.mjs` | harmonic prediction, nodal corrections, HW/LW finder | official tide tables (DMI) for Esbjerg: HW/LW time ±10 min, height ±10 cm; a year of observed minus predicted RMS ≤ surge climatology |
| `check-earth-phenology.mjs` | leaf-out / colouring / fall models per species | DWD phenology stations near Lübbecke, PEP725, Danish observations: RMSE ≤ 7 days |
| `check-earth-snow.mjs` | snowpack model, downscaling | DWD/DMI station snow depth: presence hit rate ≥ 90 %, depth RMSE ≤ 3 cm in shallow-snow winters |
| `check-earth-crops.mjs` | crop calendar → stage | Sentinel-2-derived harvest dates of sample parcels ±7 days |
| `check-earth-tiles.mjs` | tileset manifests: bounding volumes contain content, geometric error monotonic, attributions present, no missing tiles | structural |
| `check-earth-weather.mjs` | decoding of the weather textures, cloud-layer reconstruction from cloud-fraction profiles, interpolation in time | synthetic fields with known answers |

Plus:

- **Visual regression**: Playwright (pre-installed Chromium) renders fixed views at fixed
  `simTime` with a frozen weather snapshot and compares against approved screenshots
  (SSIM threshold) – catches shader regressions.
- **Ground truth gallery**: for each hero area a set of real photos with known position,
  time and camera; the simulation renders the same view and both are shown side by side.
  This is the honest test of "absolutely accurate".
- **Performance budget** in CI: a headless run of a scripted flight logs frame times on
  the WebGL2 fallback (CI has no GPU – this catches CPU-side regressions; GPU budgets are
  checked manually on the reference devices).

### Reference devices

| Tier | Device class | Target |
|---|---|---|
| Ultra | desktop, RTX 3070-class / Apple M3 Pro+ | 60 fps at 1440p, all features |
| High | mid laptop (integrated Iris Xe / Apple M1) | 60 fps at 1080p, half-res clouds |
| Low | 2022+ phone (A15 / Snapdragon 8 Gen 1) | 30 fps, reduced vegetation, 2D cloud shadows only, no FFT cascades beyond 2 |

---

## 3. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| "Absolutely accurate everywhere" is impossible: individual clouds, raindrops, leaf positions are not observable | expectation gap | define accuracy per subsystem (this plan), show the provenance overlay, put the caveats first in the model card |
| Orthophotos bake in shadows and one season | double shadows, wrong season | de-shadowing + masking under 3D objects + seasonal re-colouring ([05](05-terrain-imagery-buildings.md)) |
| Data volume (tens of GB for the hero areas) | hosting cost, load times | object storage with free egress, aggressive LOD, KTX2/meshopt, streaming budgets ([11](11-pipeline-hosting.md)) |
| Licence mismatch (NC imagery, Google ToS, ODbL share-alike on derived databases) | cannot publish a layer | licence matrix below, every tileset carries its licence; ODbL-derived data published as a separate database layer |
| WebGPU gaps on some devices | features missing | WebGL2 fallback backend; compute-only features degrade to precomputed textures |
| Wadden Sea hydrodynamics needs a real model run | tide accuracy | offline model (open-source), calibrated on gauges, baked into harmonic maps; fallback: gauge harmonics + hypsometric flooding |
| Weather pipeline needs a scheduler | stale live mode | GitHub Actions cron (note: scheduled workflows in public repos are disabled after 60 days without repository activity – add a keep-alive / manual trigger) or a small cloud function |
| Scope creep (people, cars, animals, interiors) | never finishing | explicitly out of scope for v1 (see README); hooks left for later (AIS ferry, wind turbines) |
| Mobile memory limits | crashes | hard GPU memory budget per tier, tile cache eviction by LRU + screen-space error |

---

## 4. Out of scope for the first version

People, private cars and live traffic, interiors, animals (except as optional later
layers: seals on the sandbanks, starling murmurations), sound, and day-exact recreation of
past construction states (the buildings are "as surveyed").

---

## 5. Licence & attribution matrix

*Filled from the research in files 02–04; every tileset produced by the pipeline carries
its licence and attribution string in its manifest.*

<!-- LICENCE_MATRIX -->
