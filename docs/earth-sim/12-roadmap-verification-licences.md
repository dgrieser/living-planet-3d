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
| **M2** | Hero terrain & imagery | Pipelines for DGM1/DOP (NRW) and DHM/orthophoto (DK), vertical datum conversion, merged land–sea DEM for the Wadden Sea, de-shadowed orthophotos, ground material classification, hero tilesets on the mittwald server | Ground at 10 cm imagery / ≤ 1 m relief; seams to the global layer invisible; heights within ±0.2 m of the source at control points | L |
| **M3** | Buildings | NRW LoD2 → 3D Tiles; DK LoD2 reconstruction from DHM point cloud + footprints; roof textures from the orthophoto; procedural facades by function/age/material; windows lit at night | Every building of both areas present, roof shapes match the orthophoto, picking shows ALKIS/BBR attributes | L |
| **M4** | Vegetation | Single-tree inventory from LiDAR, species assignment, procedural species models with LOD/impostors, wind animation, ground cover (grass, crops, heath, dune grass), hedges | Every tree > 3 m of both areas placed within 1 m of its LiDAR crown top; forest edges match the orthophoto; 60 fps at "High" over the Wiehengebirge forest | XL |
| **M5** | Water | FFT ocean (cascades, JONSWAP/TMA, foam), shoreline breakers, Wadden Sea tide model (offline hydrodynamics → baked harmonics), wet/dry flats with drainage gullies, Mittellandkanal and ponds, underwater, hero-resolution drained mode | Water line at Fanø within ±10 min / ±10 cm of DMI gauges over a test month; flats fall dry where the orthophoto at low water shows dry flats | XL |
| **M6** | Weather | Scheduled weather pipeline, volumetric clouds (local + global), cloud shadows, precipitation (rain/snow/wet surfaces), wind downscaling (hero areas), fog, live mode | For test days, cloud cover / precipitation timing match radar & satellite; wind at stations within NWP error | XL |
| **M7** | Seasons & snow | Phenology models + calibration, leaf colours per species, leaf litter, crop calendar per field, heath/marsh colours, snowpack + downscaling + rendering, Wadden Sea ice | Leaf-out and colouring dates within ±7 days of DWD/PEP725 observations; snow present/absent correct on ≥ 90 % of station days | L |
| **M8** | Hero spots | LoD3 landmark buildings (St.-Andreas-Kirche, Burgmannshöfe, Wartturm, Sønderho Kirke & Mølle, Nordby harbour), street furniture, fences, signs, street lamps; optional ground-level splat captures (no drones) | Side-by-side with photos at eye level the spots are recognisable in detail | L |
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
| Data volume (tens of GB for the hero areas, 100+ GB with the global layers and weather archive) | disk space and traffic on the mittwald server, load times | versioned static tiles, archive thinning, aggressive LOD, KTX2/meshopt, service-worker cache, optional CDN in front ([11 §5](11-pipeline-hosting.md#5-hosting--the-mittwald-server)) |
| Licence mismatch (NC imagery, Google ToS, ODbL share-alike on derived databases) | cannot publish a layer | licence matrix below, every tileset carries its licence; ODbL-derived data published as a separate database layer |
| WebGPU gaps on some devices | features missing | WebGL2 fallback backend; compute-only features degrade to precomputed textures |
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
