# 12 · Roadmap, verification, risks and licences

[← back to the plan index](README.md)

---

## 1. Milestones

Each milestone ends in something that runs in the browser and is deployable behind the
work-in-progress flag (`hidden: true`). Sizes are relative effort (S ≈ days, M ≈ 1–2
weeks, L ≈ 3–6 weeks, XL ≈ 2–3 months of focused work for one developer).

| # | Milestone | Content | Exit criteria | Size |
|---|---|---|---|---|
| **M0** | Foundations | `earth` sim scaffold, repo upgrade three r185 → r187 (all simulations re-checked), WebGPU renderer with WebGL2 fallback, **WebGPU go/no-go spike** – imagery draped on streamed terrain via a TSL `ImageOverlay` port ([01 §1.4](01-architecture.md#14-fallback-architecture)), globe tiles streaming (3d-tiles-renderer), camera stack (globe → local → walk), `clock.js`, `ephemeris.js`, `geodesy.js` + checks, physically based atmosphere, attribution strip | Zoom from space to 1 km over any place at 60 fps (mid laptop) with imagery draped on the terrain – on WebGPU, or the WebGL2 fallback architecture is adopted; sun and moon within 1′ of JPL Horizons; check scripts green | L |
| **M1** | The whole Earth from a distance | Global land+sea tiles z0–10 (Mapterhorn + GEBCO_2026, [02 §1](02-data-global.md#1-terrain-land)), seasonal global imagery (monthly), night lights, snow & sea-ice overlay from daily products, global cloud layer from NWP (2D → volumetric), global tide overlay (amphidromes), **drain-the-ocean** slider on GEBCO | Globe looks right for any date 2004–today; draining reveals the mid-ocean ridges; clouds match the satellite picture of the same hour at synoptic scale | XL |
| **M2** | Hero terrain & imagery | Pipelines for DGM1/DOP (NRW) and DHM/orthophoto (DK), vertical datum conversion, merged land–sea DEM for the Wadden Sea, de-shadowed orthophotos, ground material classification, hero tilesets on the mittwald server | Ground at 10 cm imagery / ≤ 1 m relief; seams to the global layer invisible; heights within ±0.2 m of the source at control points | L |
| **M3** | Buildings | NRW LoD2 → 3D Tiles; DK LoD2 reconstruction from DHM point cloud + footprints; roof textures from the orthophoto; procedural facades by function/age/material; windows lit at night | Every building of both areas present, roof shapes match the orthophoto, picking shows ALKIS/BBR attributes | L |
| **M4** | Vegetation | Single-tree inventory from LiDAR, species assignment, procedural species models with LOD/impostors, wind animation, ground cover (grass, crops, heath, dune grass), hedges | Against hand-mapped sample plots (incl. a leaf-off beech plot on the ridge): ≥ 90 % of trees > 3 m found (target to confirm on the beech plot), crown tops within 1 m; forest edges match the orthophoto; 60 fps at "High" over the Wiehengebirge forest | XL |
| **M5** | Water | FFT ocean (cascades, JONSWAP/TMA, foam), shoreline breakers, Wadden Sea tide model (offline hydrodynamics → baked harmonics), wet/dry flats with drainage gullies, Mittellandkanal and ponds, underwater, hero-resolution drained mode | Water line at Fanø within ±10 min / ±10 cm of DMI gauges over a test month; flats fall dry where the orthophoto at low water shows dry flats | XL |
| **M6** | Weather | Scheduled weather pipeline, volumetric clouds (local + global), cloud shadows, precipitation (rain/snow/wet surfaces), wind downscaling (hero areas), fog, live mode | For test days, cloud cover / precipitation timing match radar & satellite; wind at stations within NWP error | XL |
| **M7** | Seasons & snow | Phenology models + calibration, leaf colours per species, leaf litter, crop calendar per field, heath/marsh colours, snowpack + downscaling + rendering, Wadden Sea ice | Leaf-out and colouring dates with RMSE ≤ 7 days against DWD/PEP725 observations; snow present/absent correct on ≥ 90 % of station days | L |
| **M8** | Hero spots | LoD3 landmark buildings (St.-Andreas-Kirche, Burgmannshöfe, Wartturm, Sønderho Kirke & Mølle, Nordby harbour), street furniture, fences, signs, street lamps; optional ground-level splat captures (no drones) | Side-by-side with photos at eye level the spots are recognisable in detail | L |
| **M9** | Polish | Performance tiers, mobile, accessibility, i18n texts, model card, docs in the root README, remove `hidden` | Lighthouse/frame-time budget met on the reference devices | M |

Order rationale: M0–M1 deliver "the whole Earth from a distance" first (as requested);
M2–M4 build the static hero worlds; M5–M7 add the dynamic systems that make them *live*;
M8 adds the last centimetre. M5–M7 can run in parallel once M2 exists.

**Total**: four XL, five L and one M ≈ **12–20 months** of focused work for one developer.
**Proposed cut line** (to be confirmed by the project owner): M0–M3 (≈ 4–7 months) form the
first release that drops `hidden` – the real Earth from space plus both hero areas with
terrain, imagery and buildings in a static season; M4–M9 follow as updates.

### 1.1 M0 outcome (31 Oct 2026)

**Built** (`src/sims/earth/`, registered as `earth` with `hidden: true`):

| M0 item | State |
|---|---|
| `earth` scaffold, registry entry, EN/DE strings | done – panel per the repo's layout: time of day with play/pause and "now", date and rate, place presets, camera views (per place, `setCameraViews()` added to `lib/ui.js`), quality tiers, display toggles, readouts, essay, model card |
| three r185 → r187 | done – all six existing simulations rendered side by side on r185 and r187 in headless Chrome: no visual change, no console errors; all `check:*` scripts green |
| `WebGPURenderer` with WebGL 2 fallback | done – `?renderer=webgl` forces the fallback; reversed float depth buffer |
| **WebGPU go/no-go spike** | **GO on WebGPU.** Imagery is draped without porting `ImageOverlayPlugin`: `TerrariumMeshPlugin` composes the imagery of each tile on a 2D canvas (no shader patching) and our subclass swaps its GLSL-patched Lambert material for a node material that shares one TSL graph across all tiles (one pipeline for the planet). Two WebGPU-specific fixes were needed: ImageBitmaps decoded with `imageOrientation: 'flipY'` get `flipY = false` (WebGLRenderer ignores `flipY` for ImageBitmaps, WebGPURenderer honours it), and the controls' GLSL pivot marker is replaced by a TSL sprite |
| globe tiles streaming | done – Mapterhorn z0–12 (hot-linked for now; open-sea tiles, which Mapterhorn does not serve, are answered with a flat 0 m tile) + EOX s2cloudless-2025 z0–15 |
| camera stack | globe orbit → local orbit (`GlobeControls`), geodetic camera poses, cinematic flights between views. **Walk mode is not built yet** – it needs collision against the hero terrain and moves to M2 |
| `clock.js`, `ephemeris.js`, `geodesy.js` + checks | done – `npm run check:earth` (CI step) |
| physically based atmosphere | done – own TSL single-scattering atmosphere (transmittance table built on the CPU, analytic segment integration, isotropic multiple-scattering estimate) instead of `@takram/three-atmosphere`, whose packages list React/R3F as peer dependencies |
| attribution strip | done – strip of the providers on screen + "Data sources" list with licences and mandatory notices (`sources.js`) |

**Exit criteria:**

- *Zoom from space to 1 km over any place at 60 fps with imagery draped on the terrain, on WebGPU* –
  met on the development machine: synthetic wheel-zoom from 17 500 km to ≈ 200 m over Lübbecke works;
  60 fps (the display's refresh, so the true headroom is higher) on WebGPU and on the WebGL 2 fallback, at
  1400 × 700 and at 2800 × 1700 (Ultra, DPR 2), for the globe, Europe and Lübbecke views. The machine's
  GPU is an AMD Radeon 890M (integrated, RDNA 3.5) – stronger than the plan's "mid laptop" reference
  (Iris Xe / M1), which still has to be measured.
- *Sun and Moon within 1′ of JPL Horizons* – met: worst 0.08′ (Sun) and 0.16′ (Moon) over 32 positions for
  Lübbecke and Nordby (2000–2045), sunrise/sunset within 5 s (tolerance 30 s), illuminated fraction
  within 0.1 %.
- *Check scripts green* – met: geodesy against PROJ 9.7 below 0.01 mm (ECEF, UTM 32N both ways,
  ETRF2020 ↔ ITRF2020, EGM96 grid lookups), clock, and all existing checks; `npm run check` runs in CI.

**Deviations from the plan, and what they move:**

- Precision: `renderer.highPrecision` (CPU float64 model-view) instead of the floating origin of
  [01 §3](01-architecture.md#3-coordinates-precision-and-depth) – enough while there are no instanced
  meshes; the floating origin is needed by M4 (instanced trees).
- Terrain: only Mapterhorn's global level (z12, ≈ 19 m in the hero areas). Its national 1 m / 0.4 m
  levels (z16 in NRW, z17 in Denmark) exist only inside their regions; the tree needs per-region depth
  limits, which come with the hero tilesets (M2). Heights are orthometric and placed on the ellipsoid
  without the geoid (≈ 40 m here) – fixed by the merged land–sea tiles (M1).
- Data are hot-linked from the providers' public endpoints; mirroring them onto the mittwald server is
  part of the M1 pipeline work ([11](11-pipeline-hosting.md)).
- Stars are generated (seeded), not a catalogue; the Moon is untextured – both small M1 items.
- Antialiasing: none yet (no MSAA/TRAA on the scene pass); the depth-based atmosphere pass needs a
  resolved depth – TRAA is planned with the post chain (M6/M9).

### 1.2 M1 outcome (31 Oct 2026)

**Built** (same sim, still `hidden: true`):

| M1 item | State |
|---|---|
| global land+sea terrain | done, at runtime instead of baked z0–10 tiles: each decoded Mapterhorn grid gets GEBCO_2026's sea floor where Mapterhorn writes exactly 0 m (its sea value; open-sea 404s become flat tiles first), plus the EGM2008 undulation N, so the mesh sits on the ellipsoid (`data/gebco.js`, `data/geoid.js`, `render/globe.js`). A sea mask travels with every grid (polders, the Caspian and the Dead Sea shore stay land). GEBCO comes from two places: a 16′ (≈ 30 km) copy shipped in `public/earth/` (754 kB, land zeroed, delta/byte-plane encoded) for every tile at once, then the tile's own window from the community COG on Source Cooperative (15″ + overviews) for zoom ≥ 3, swapped in when it arrives – range requests there cost 0.3–0.8 s each, too slow to wait for. The global geoid is a 0.5° EGM2008 grid (520 kB, ≤ 0.14 m from the full grid in the hero areas) |
| drain-the-ocean slider | done – headline "Water level" slider 0 … −11 000 m with snap stops (−10, −50, −120 Last Glacial Maximum, −200 shelf edge, drained) and the circle-arrow reset; *mean low water* waits for the tide model. Uncovered floor: sediment classes by depth (shelf sand, slope mud, carbonate ooze above the CCD on the ridges, abyssal clay), basalt on steep slopes, or hypsometric depth colours with 1000 m contours (display toggle). Its relief is shaded ×5 exaggerated (model card) |
| water | the sea is shaded on the sea floor (no separate surface): imagery colour (depth model once lowered) under a Fresnel sky reflection and a GGX sun glint (α 0.28, Cox–Munk at ≈ 7 m/s); sea ice on top |
| seasonal global imagery (monthly) | done – NASA Blue Marble NG monthly 2004 (CORS from assets.science.nasa.gov), the two months around the date blended, faded in above 1 200–4 000 km; EOX stays the near imagery (no seasons there yet) |
| night lights | done – NASA Black Marble 2016 (GIBS, 7.8 km), sodium tint, only where the Sun is down |
| snow & sea-ice overlay from daily products | done with GIBS: MODIS/Terra **monthly** snow cover (the daily L3 product has cloud gaps), AMSR-E/AMSR2 **daily** sea-ice concentration; colour maps read back to values; dates outside the records fall back to the nearest covered year (climatology, flagged in the model card) |
| global cloud layer from NWP (2D) | done – NOAA GFS 0.25° low/middle/high cover read directly from the NOAA Open Data bucket (CORS, byte ranges via the `.idx`), decoded by our own GRIB2 decoder in a worker (`data/grib2.js`, simple + complex packing with spatial differencing, checked against ecCodes); archive from Jan 2021 (run 1–6 h before the instant), forecast to +384 h; two shells (≈ 2 km, ≈ 9 km) whose opacity is the cover thresholding fractal noise, ground shadows. Volumetric clouds and satellite fusion stay M6 |
| global tide overlay (amphidromes) | **not built** – needs the FES2022b (AVISO registration) or EOT20 constituent pipeline and `tides.js`; moved to M5 with the tide model it shares |
| per-pixel relief | added – bump normals from the height grid's detail between the mesh vertices (screen-space derivatives in view space) |

**Exit criteria:**

- *Globe looks right for any date 2004–today* – met for what M1 shows: the Blue Marble month, the month's
  snow and the day's sea ice change with the date (checked: January 2024 – snow over eastern Europe and
  Russia, Arctic ice; July 2024 – snow-free Europe, summer ice). Gaps: the EOX near imagery has no season;
  sea ice after Sep 2025 and in the 2011–12 AMSR gap, snow before Mar 2000 are climatology.
- *Draining reveals the mid-ocean ridges* – met: at −11 000 m the Mid-Atlantic Ridge stands out from orbit
  as the pale ooze band between the brown abyssal plains, and in the depth-colour view with contours;
  at −120 m the North Sea falls dry while the Norwegian Trench keeps its water.
- *Clouds match the satellite picture of the same hour at synoptic scale* – met on the test day
  (30 Oct 2026, 11 UTC, Europe and the North Atlantic, against MODIS/Terra true colour from GIBS): the
  frontal band west of the British Isles curving to Iberia, the clear North Sea and Germany, the cloud
  over eastern Europe. Broken cumulus fields come out too closed (the cover alone cannot say how broken).
- Performance: 60 fps (display refresh) with clouds, snow/ice, lights and per-pixel relief on WebGPU and
  on the WebGL 2 fallback (globe, Europe, Lübbecke; Radeon 890M).

**Checks:** `check-earth-grib.mjs` (decoder vs ecCodes on two GFS fixtures, run/step choice, index
parsing), `check-earth-layers.mjs` (tile bounds, GEBCO level choice and resampling, land/sea merge, the
shipped base grid, product dates, Blue Marble months, colour maps, mip chains), geoid grid vs PROJ in
`check-earth-geodesy.mjs`.

**Deviations and what they move:**

- No baked land+sea tileset and nothing on the mittwald server yet: the merge runs in the browser and
  the sources are hot-linked (Source Cooperative, NOAA, NASA). Two small derived grids ship in
  `public/earth/` (built by `tools/earth-pipeline/`). The baked tiles, mirroring and the weather baker
  stay pipeline work ([11](11-pipeline-hosting.md)) – needed before `hidden` goes.
- Snow is monthly, not daily; clouds are GFS only (no ICON/IFS, no satellite correction); sea ice ends in
  Sep 2025 on GIBS (OSI SAF would continue it, but has no CORS tile service).
- Tide overlay → M5. Star catalogue and Moon texture still open (small).
- Known rough edges: the sea mask's coastline follows Mapterhorn's 0 m texels (stair-steps at low zoom
  where the EOX coast is finer); the drained floor's colours are a generalisation, not a sediment map.

### 1.3 M2 outcome (31 Oct 2026)

**Built** – in the browser, from public services, without the pipeline-baked hero tilesets of the plan:

| M2 item | State |
|---|---|
| hero terrain | done – Mapterhorn carries NRW DGM1 (1 m) and the Danish DHM (0.4 m); inside the hero boxes of `places.js` the tree reads its zoom-16 level (≈ 0.7 m per pixel), everywhere else it stays at z12 (`regions.js`: per-region depth limits in `createChild`, per-tile source level in `getUrl`/`parseToMesh`) |
| vertical datum conversion | done – Mapterhorn keeps the national heights (DHHN2016 / DVR90), so the hero boxes use the national references: GCG2016 (Lübbecke) and DVR90(2023) (Fanø) from the PROJ CDN, cropped by `tools/earth-pipeline/build-hero-geoids.mjs` into `data/heroGeoids.js`; residuals to EGM2008 (0.20 m / 0.27 m) blended in over ±0.02° around each box, identically on the CPU (grids) and in the shader (waterline) |
| NRW orthophotos | done – DOP10 2024 from the state's WMTS (dl-de/zero-2.0, CORS) over all of NRW from z10 to z21 (7.5 cm), drawn over EOX where the state's tiles are transparent; the leaf-off/leaf-on seam near 52.31° N is in the data |
| Danish orthophotos | **not built** – GeoDanmark Ortofoto needs a Dataforsyningen token ([13](13-data-requests.md)); Fanø keeps EOX at 10 m |
| walk mode (moved from M0) | done – first person at 1.7 m on the finest loaded terrain, 1.4 m/s (Shift 6 m/s), arrow keys/WASD, Q/E turn, drag to look, on-screen pad for touch; its own button next to the camera views |
| ground detail | small step of [05 §2](05-terrain-imagery-buildings.md#2-ground-surface--from-orthophoto-to-living-material): generated fractal detail where a pixel is smaller than the imagery's (anchored with a double-precision camera offset); the material classification, de-shadowing and the merged Wadden Sea DEM (green LiDAR requested) remain |
| hero tilesets on the mittwald server | **not built** – still hot-linked; needs the server |

**Exit criteria:**

- *Ground at 10 cm imagery / ≤ 1 m relief* – met for Lübbecke (DOP10, DGM1 at ≈ 0.7 m per pixel); Fanø has
  the relief (0.4 m source) but 10 m imagery until the Danish token is in.
- *Seams to the global layer invisible* – terrain: one pyramid, so the hero levels continue the global ones
  without a step; the height reference blends over ±2 km. Imagery: the EOX → DOP change happens at the NRW
  border from z10 on, not at the hero box; it is a colour change seen from regional heights (two different
  mosaics), not a gap.
- *Heights within ±0.2 m of the source at control points* – met for Lübbecke:
  `tools/earth-pipeline/verify_hero_heights.py` compares Mapterhorn z16 with NRW's DGM1 from the state's WCS
  at 400 points – mean 0.001 m, 5–95 % within −0.028 … +0.031 m; the national references reproduce PROJ to
  0.1 mm (`check-earth-hero.mjs`). Fanø: not verified – the DHM WCS also needs the token.

**Deviations and what they move:** baked hero tilesets, the Danish orthophoto, ground material
classification, de-shadowing and the merged land–sea DEM of the Wadden Sea stay open (pipeline and data
requests); buildings are flat until M3; walking does not collide with anything but the ground.

### 1.4 M3 outcome (31 Oct 2026)

**Built** (`render/buildings.js`, `data/osmBuildings.js`):

| M3 item | State |
|---|---|
| NRW LoD2 | done, live instead of our own pg2b3dm tileset: `ogc-api.nrw.de/3dg/v1/collections/building/3dtiles` (3D Tiles 1.1, implicit quadtree, glTF with `EXT_mesh_features` + `EXT_structural_metadata`, CORS) over all of NRW. The service delivers every building with its ground at the ellipsoid (checked at Lübbecke, Winterberg, Cologne: lowest vertex at h = 0), so each building is set onto our terrain: base at the lowest terrain sample under its footprint, re-fitted whenever terrain tiles arrive. Meshes are rewritten into one float format and drawn with one TSL material |
| DK LoD2 reconstruction (roofer) | **not built** – needs the DHM point cloud (token). Fanø uses OpenStreetMap footprints instead (16 196, baked by `tools/earth-pipeline/build-osm-buildings.mjs` into `public/earth/fanoe-buildings.bin.gz`, 525 kB, ODbL): heights from tags or per type, gabled/hipped/pyramidal roofs over the minimum bounding rectangle of near-rectangular houses, flat roofs otherwise |
| roof textures from the orthophoto, procedural facades | partly – generated colours (roof type / height / building type, Danish and East-Westphalian palettes), a window grid (3 m storeys, 2.6 m bays) on every wall of buildings that have windows; no orthophoto roofs, no facade photos |
| windows lit at night | done – about half the windows glow after dusk (hash per window) |
| picking with ALKIS/BBR attributes | done for NRW: the click finds the building (raycast) and asks the state's simplified ALKIS WFS (CORS) for the building at that point: function (e.g. *Kirche*, code 31001_3041), name, street address, update date. The 3D Tiles' own `function` property is empty. Fanø: OSM type, roof, height (marked *generated* where untagged); BBR needs a Datafordeler key |

**Exit criteria:**

- *Every building of both areas present* – NRW: all LoD2 buildings (the state's complete stock) within
  the streaming distance; Fanø: every OSM footprint (OSM's Danish building layer comes from the national
  import, so practically complete).
- *Roof shapes match the orthophoto* – NRW: the LoD2 roofs are the state's fit to the laser scan; Fanø:
  only for simple rectangular houses (generated gables), not for L-shapes or complex roofs.
- *Picking shows ALKIS/BBR attributes* – met for ALKIS (function, name, address); BBR open (key).

**Performance:** 51–53 fps in the town and on Fanø, ≈ 45–50 in the Lübbecke overview (≈ 140 draw calls,
three.js submits ≈ 10.7 ms per frame on the CPU; building tiles use `UpdateOnChangePlugin`, sunlight and
cloud shadow are evaluated per building vertex). Batching draw calls is M9 work.

**Deviations:** no own building tileset, no roofer reconstruction, no orthophoto roofs or facade
photos, no building shadows; the window pattern ignores real facades.

---

## 2. Verification (keep the repo's `scripts/check-*.mjs` culture)

Every pure-JS model gets a node check script. CI runs only lint and build today
([11 §7](11-pipeline-hosting.md#7-ci)), so the `check:*` scripts – the existing ones and
the new `check-earth-*` – become a CI step.

| Script | Validates | Reference / tolerance |
|---|---|---|
| `check-earth-ephemeris.mjs` | sun & moon topocentric position, sunrise/sunset, moon phase | JPL Horizons samples for Lübbecke and Nordby, ≤ 1′ (astronomy-engine's documented accuracy), sunrise ±30 s |
| `check-earth-geodesy.mjs` | geodetic ↔ ECEF ↔ ENU, UTM32 (EPSG:25832) → WGS84, ETRS89 ↔ ITRF epoch shift, geoid/quasigeoid lookups | PROJ reference values ≤ 1 mm; official geoid control points ≤ 1 cm |
| `check-earth-tides.mjs` | harmonic prediction, nodal corrections, HW/LW finder | official tide tables (DMI) for Esbjerg: HW/LW time ±10 min, height ±10 cm; a year of observed minus predicted RMS ≤ surge climatology |
| `check-earth-phenology.mjs` | leaf-out / colouring / fall models per species | DWD phenology stations near Lübbecke, PEP725, Danish observations: RMSE ≤ 7 days |
| `check-earth-snow.mjs` | snowpack model, downscaling | DWD/DMI station snow depth: presence hit rate ≥ 90 %, depth RMSE ≤ 3 cm in shallow-snow winters |
| `check-earth-crops.mjs` | crop calendar → stage | Sentinel-2-derived harvest dates of sample parcels ±7 days |
| `check-earth-tiles.mjs` | tileset manifests: bounding volumes contain content, geometric error monotonic, attributions present, no missing tiles | structural |
| `check-earth-weather.mjs` | decoding of the weather textures, cloud-layer reconstruction from cloud-fraction profiles, interpolation in time | synthetic fields with known answers |

Plus:

- **Visual regression**: Playwright (new devDependency; CI installs Chromium with
  `npx playwright install --with-deps chromium`) renders fixed views at fixed
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
| Data volume (tens of GB for the hero areas, 100+ GB with the global layers and weather archive) | disk space and traffic on the mittwald server, load times | versioned static tiles, archive thinning, aggressive LOD, KTX2/meshopt, service-worker cache, optional CDN in front ([11 §5](11-pipeline-hosting.md#5-hosting--the-mittwald-server)) |
| Licence mismatch (NC imagery, Google ToS, ODbL share-alike on derived databases) | cannot publish a layer | licence matrix below, every tileset carries its licence; ODbL-derived data published as a separate database layer |
| WebGPU gaps on some devices | features missing | WebGL2 fallback backend; compute-only features degrade to precomputed textures |
| 3d-tiles-renderer plugins that patch shaders fail on WebGPU (issue #1380) | no imagery on terrain – blocks M0/M1 | go/no-go spike in M0 with takram's TSL ports; WebGL2 fallback architecture otherwise ([01 §1.4](01-architecture.md#14-fallback-architecture)) |
| Leaf-off LiDAR and imagery over the Wiehengebirge | beech crowns missed or merged | point-based segmentation, Meta CHM v2 cross-check, hand-mapped sample plots ([06 §1](06-vegetation-seasons.md#1-tree-inventory-from-airborne-lidar-pipeline)) |
| PALM-4U town wind needs 48 LES runs | 10³–10⁴ core-hours (~) | optional after M6 with an HPC/cloud budget; WindNinja + roughness profiles otherwise |
| Wadden Sea hydrodynamics needs a real model run | tide accuracy | offline model (open-source), calibrated on gauges, baked into harmonic maps; fallback: gauge harmonics + hypsometric flooding |
| Weather pipeline needs a scheduler | stale live mode | mStudio cronjobs + baker container on the mittwald server, health file, app shows data age and falls back to the last bake ([11 §6](11-pipeline-hosting.md#6-scheduled-jobs-weather-and-land-state)) |
| Scope creep (people, cars, animals, interiors) | never finishing | explicitly out of scope for v1 (see README); hooks left for later (AIS ferry, wind turbines) |
| Mobile memory limits | crashes | hard GPU memory budget per tier, tile cache eviction by LRU + screen-space error |

---

## 4. Out of scope for the first version

People, private cars and live traffic, interiors, animals (except as optional later
layers: seals on the sandbanks, starling murmurations), sound, and day-exact recreation of
past construction states (the buildings are "as surveyed").

---

## 5. Licence & attribution matrix

Every tileset produced by the pipeline carries its licence and attribution string in its
manifest; the client shows the attributions of everything visible
([10 §2.5](10-time-ui-interaction.md#25-attribution)). The app's **code stays 0BSD**;
data keep their own terms (as `public/textures/` already does). Status of each check as
of 31 Oct 2026: **✓** confirmed at the source (licence page, service capabilities or
catalogue metadata), **~** confirmed only via a secondary source, **✉** written
confirmation requested ([13](13-data-requests.md)).

### 5.1 Lübbecke / Germany

| Data | Licence | Attribution / condition | Derived tiles OK? | |
|---|---|---|---|---|
| Geobasis NRW (DGM1, DOM1, 3D-Messdaten, bDOM, DOP10, iDOP20, 3D-Mesh, LoD1/2, ALKIS, Basis-DLM) | dl-de/zero-2.0 | none required (courtesy "© Geobasis NRW") | yes | ✓ |
| Landbedeckung NRW | dl-de/by-2.0 | "Enthält modifizierte Copernicus Sentinel-2 Daten [2023], verarbeitet durch Geobasis NRW; dl-de/by-2-0 (www.govdata.de/dl-de/by-2-0); https://www.wms.nrw.de/geobasis/wms_nw_landbedeckung" | yes, with the note | ✓ |
| NRW Baumartenklassifikation, Vitalitätsabnahme Nadelwald | dl-de/by-2.0 | "Land NRW 2022" | yes | ✓ |
| LWK field parcels (TSCHLAG, -HIST) | dl-de/by-2.0 | "Land NRW, Abrufdatum <date>" | yes | ✓ |
| GSK3E stream stationing | dl-de/zero-2.0 | – | yes | ✓ |
| PEGELONLINE (WSV gauges) | dl-de/zero-2.0 | – (courtesy "WSV") | yes | ✓ |
| DWD open data (ICON-D2, radar, stations, phenology, SNOWRAS, HYRAS) | CC BY 4.0 | "Quelle: Deutscher Wetterdienst" | yes | ✓ |
| BKG quasigeoid GCG2016 | CC BY 4.0 | "© BKG (year) CC BY 4.0, Datenquellen: …" | yes | ✓ |

### 5.2 Fanø / Denmark

| Data | Licence | Attribution / condition | Derived tiles OK? | |
|---|---|---|---|---|
| Klimadatastyrelsen geodata (DHM, point cloud, orthophotos, skråfoto, GeoDanmark) | CC BY 4.0 (since 16 May 2024) | credit "Klimadatastyrelsen" | yes | ✓ |
| BBR (via Datafordeler) | CC BY 4.0 (free basic data) | credit "Bygnings- og Boligregistret (BBR)" | yes | ✓ |
| Danmarks Dybdemodel 50 m | GST terms (May 2024): free, worldwide, commercial + non-commercial | "Contains data from the Danish Geodata Agency, Denmark's Depth Model, 50 m resolution" + date obtained + "Model and data are not suitable for navigation"; link to the terms | yes, with notices | ✓ |
| GST hydrographic soundings | sold case by case, Defence security clearance | per agreement | per agreement | ✉ |
| Danmarks Miljøportal / Arealinformation (§3 nature, protected areas) | Miljøportal terms (PSI law, "comparable to CC0/CC-BY"): free, unlimited, incl. modification and commercial use | "Indeholder data, som benyttes i henhold til vilkår for brug af danske offentlige data" | yes | ✓ |
| MST (Kystdirektoratet) water levels, published datasets | free download | credit MST/Kystdirektoratet | yes | ~ |
| MST green-LiDAR / surveys (on request) | per answer | per answer | per answer | ✉ |
| DMI open data (DINI, DKSS, WAM, radar, gauges, stations) | CC BY 4.0 | "DMI" | yes | ✓ |
| Landbrugsstyrelsen *Marker* | CC0-1.0 per fiboa catalogue; agency states none | credit "Landbrugsstyrelsen" until confirmed | yes (crop fields only) | ✉ |
| Danish AIS (aisdata.ais.dk) | free download, no licence stated | – | only derived ferry tracks, after confirmation | ✉ |
| PROJ CDN Danish geoid grids (DVR90, DKMSL, DKLAT) | CC BY 4.0 | Klimadatastyrelsen | yes | ✓ |

### 5.3 Global and European

| Data | Licence | Attribution / condition | Derived tiles OK? | |
|---|---|---|---|---|
| Copernicus DEM | Copernicus DEM licence (free incl. commercial) | mandatory DLR/Airbus notice + no-liability sentence | yes, with notice | ✓ |
| GEDTM30 | CC BY 4.0 | OpenGeoHub | yes | ✓ |
| Mapterhorn | per source (`attribution.json`) | every source's credit | yes | ✓ |
| GEBCO_2026 | public domain | citation + no endorsement | yes | ✓ |
| EMODnet Bathymetry DTM | CC BY 4.0 (EU-owned products) | "EMODnet Digital Bathymetry (DTM 2024)", EMODnet Bathymetry Consortium, DOI 10.12770/cf51df64-56f9-4a99-b1aa-36b8d7b743a1; not for navigation | yes | ✓ |
| Copernicus Sentinel / CDSE mosaics | Copernicus Sentinel notice | "Contains modified Copernicus Sentinel data [year]" | yes | ✓ |
| **EOX Sentinel-2 cloudless 2018–2025** (chosen) | **CC BY-NC-SA 4.0** | "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data [year])" | yes, but derived/cached tiles are **CC BY-NC-SA** too – separate tileset | ✓ |
| EOX s2cloudless 2016 | CC BY 4.0 | as above with "2016 & 2017" | yes | ✓ |
| NASA (Blue Marble, Black Marble, GIBS, LRO) | no copyright | "NASA" | yes | ✓ |
| ESA WorldCover | CC BY 4.0 | "© ESA WorldCover project …" | yes | ✓ |
| CLMS (HRL, HR-VPP, snow) | CLMS data policy | "Generated using European Union's Copernicus Land Monitoring Service information" | yes | ✓ |
| Meta/WRI canopy height v2 | CC BY 4.0 | Meta / WRI | yes | ✓ |
| DLR tree species Germany 2022 | CC BY 4.0 | DLR | yes | ~ |
| Thünen species map | paper CC BY 4.0; data licence not found (not needed – NRW raster used) | – | – | – |
| OpenStreetMap, Overture buildings | **ODbL 1.0** | "© OpenStreetMap contributors" (+ Overture source list) | derived *databases* (3D building tiles) under ODbL | ✓ |
| IMS snow & ice | US government | cite DOI 10.7265/N52R3PMC | yes | ✓ |
| OSI SAF sea ice | CC BY 4.0 | "EUMETSAT OSI SAF" | yes | ✓ |
| ECMWF open data, ERA5 | CC BY 4.0 | "ECMWF" / "Copernicus Climate Change Service" | yes | ✓ |
| NOAA GFS, GOES | public | NOAA | yes | ✓ |
| EUMETSAT derived products (MTG cloud mask/CTTH, LI) | CC BY 4.0 (core data) | "EUMETSAT" | yes | ✓ |
| OPERA radar | CC BY 4.0 | EUMETNET OPERA | yes | ✓ |
| **FES2022b** (AVISO License, Aug 2026) | CC-BY-like: use, share, adapt, commercial; **original files must not be re-hosted** on a public platform | cite "The FES2022 Tide product was funded by CNES, produced by LEGOS, NOVELTIS and CLS and made freely available by AVISO" + DOI 10.24400/527896/A01-2024.004 + link to the licence + "modified" | our resampled constituent textures are *Derivative Works* → **yes** | ✓ |
| Copernicus Marine (NWS waves/physics) | CMEMS licence, free until at least 2028 | "Generated using E.U. Copernicus Marine Service Information; <DOIs>" | yes | ✓ |
| TPXO10 | academic / non-commercial | – | avoid in shipped data | ✓ |
| HydroRIVERS / HydroLAKES | HydroSHEDS licence (scientific, educational, commercial use) / CC BY 4.0 | per technical documentation | yes | ✓ |
| GLOBathy | not confirmed (figshare blocked) – optional layer | – | check before use | – |
| Open-Meteo API | data CC BY 4.0; API free only non-commercial | "Open-Meteo" | point queries only | ✓ |
| Google Photorealistic 3D Tiles | Google Maps Platform terms | logo + aggregated copyrights | **never** (no caching; EEA-blocked) | ✓ |
| CC0 assets (ambientCG, Poly Haven, Quaternius) | CC0 | – | yes | ✓ |

### 5.4 Consequences for the build

- Three licence families end up in served tiles: **open/attribution** (dl-de, CC BY,
  public domain – the vast majority), **ODbL** (anything derived from OSM/Overture) and
  **CC BY-NC-SA** (EOX imagery). Each family gets its own tilesets; they are only combined
  at render time, never baked together.
- The attribution strip collects the strings of all visible tilesets; the "Data sources"
  dialog lists all of the above with links.
- Notices that are conditions, not courtesy: Copernicus DEM, Danmarks Dybdemodel
  (incl. "not suitable for navigation"), Landbedeckung NRW, FES2022, CMEMS, EOX.
