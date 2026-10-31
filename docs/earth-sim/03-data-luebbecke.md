# 03 · Hero area 1 – Lübbecke, Germany

[← back to the plan index](README.md)

A town of ~26 800 inhabitants (31 Dec 2025) and 65 km² in Kreis Minden-Lübbecke, NRW, on
the north slope of the **Wiehengebirge**. From the ridge crest (≈ 320 m, beech and – until
the bark-beetle years – spruce forest, the *Wittekindsweg* trail) the land drops to the
North German lowland (≈ 46 m): the old town with the Burgmannshöfe and St.-Andreas-Kirche,
farmland, the **Mittellandkanal** with the port, and the **Großes Torfmoor** raised bog.
Districts: Alswede, Blasheim, Eilhausen, Gehlenbeck, Kernstadt, Nettelstedt, Obermehnen,
Stockhausen. Land use (2014): agriculture 50.7 %, settlement & transport 23.3 %,
forest 20.9 %, water 1.4 %.

**(✓)** verified during research (Oct 2026: directory listings, tile metadata, LAS
headers, DGM samples, live services), **(~)** official page / secondary, **(?)** to confirm.

---

## 0. Area of interest and reference system

| | |
|---|---|
| Municipality bbox (WGS84) | W 8.53277, S 52.26621, E 8.72860, N 52.34368 |
| UTM32 bbox | E 468 155–481 499, N 5 790 735–5 799 356 |
| **1 km tiles touching the municipality** | **90 tiles: x 468–481, y 5790–5799** (✓) – all volumes below are for these |
| Model box (full detail) | the 90 tiles + ~1 km margin (Heidbrink, Kniebrink, the whole Torfmoor, the canal port) ≈ 120 km² |
| Elevation (DGM1 2023, ✓) | min **46.2 m NHN** (east edge) · max inside the boundary **318.8 m at the Wurzelbrink** (Wartturm) · **Heidbrink 319.8 m** (the "highest point", 14 m outside the OSM boundary on the line to Hüllhorst) |
| CRS | ETRS89 / UTM 32N (**EPSG:25832**) + **DHHN2016** normal heights (EPSG:7837) (✓) |
| Quasigeoid | **GCG2016** (BKG, v2023 update, CC BY 4.0, 1 cm in lowlands): height anomaly **ζ ≈ 43.5–43.9 m** across Lübbecke (43.74 m in the centre) → ellipsoidal h ≈ H + 43.7 m. Download `daten.gdz.bkg.bund.de/produkte/sonstige/quasigeoid/aktuell/quasigeoid.geo89.de.zip` (24 MB) (✓) |

## 1. Licences at a glance

| Source | Licence | Attribution |
|---|---|---|
| **Geobasis NRW** (DGM, DOM, 3D-Messdaten, DOP, 3D-Mesh, LoD1/2, ALKIS, Basis-DLM) | **dl-de/zero-2.0** (✓) | none required; courtesy "© Geobasis NRW" (3D Tiles asset: "Bezirksregierung Köln, Geobasis NRW") |
| **Landbedeckung NRW** (exception) | **dl-de/by-2.0** (✓ WMS capabilities) | **mandatory**: "Enthält modifizierte Copernicus Sentinel-2 Daten [2023], verarbeitet durch Geobasis NRW; dl-de/by-2-0 (www.govdata.de/dl-de/by-2-0); https://www.wms.nrw.de/geobasis/wms_nw_landbedeckung" |
| DWD | CC BY 4.0 (✓) | "Quelle: Deutscher Wetterdienst" |
| BKG GCG2016 | CC BY 4.0 (✓) | "© BKG (year) CC BY 4.0, Datenquellen: …Datenquellen_Quasigeoid.pdf" |
| LWK field parcels (TSCHLAG), NRW forest rasters (Baumartenklassifikation, Vitalitätsabnahme) | **dl-de/by-2.0** (✓ GovData/open.nrw distribution metadata) | fields: "Land NRW, Abrufdatum <date>"; forest rasters: "Land NRW 2022" |
| GSK3E stream stationing, PEGELONLINE | **dl-de/zero-2.0** (✓) | none required (courtesy "WSV" / "Land NRW") |
| OSM | ODbL | "© OpenStreetMap contributors" |

All Geobasis products live under `https://www.opengeodata.nrw.de/produkte/geobasis/`
with machine-readable `index.json` / `index.xml` per folder and per-tile metadata
CSVs (`*_meta.zip`).

## 2. Terrain, surface, LiDAR

| Dataset | Path / service | Spec for Lübbecke | Volume (90 tiles) | |
|---|---|---|---|---|
| **DGM1** (bare earth) | `hm/dgm1_tiff/dgm1_tiff/dgm1_32_{x}_{y}_1_nw_2023.tif`; WCS `wcs.nrw.de/geobasis/wcs_nw_dgm`; also in **Mapterhorn** | 1 m, ±0.2 m, from LiDAR flown **2023-02-09 (leaf-off)**; GeoTIFF float32 | 184 MB | ✓ |
| **DOM1** (surface) | `hm/dom1_tiff/dom1_tiff/`; WCS `wcs_nw_dom` | 1 m, 2023-02-09 | 198 MB | ✓ |
| **3D-Messdaten** (airborne LiDAR) | `hm/3dm_l_las/3dm_l_las/3dm_32_{x}_{y}_1_nw.laz` | flown **2023-02-09**; **7.8–23.7 pts/m², mean 11.4** (ridge forest densest); **1.03 billion points**; ±0.30 m H / ±0.15 m V; full-waveform; LAS 1.2 PDRF 1 (**no RGB**); 5-year cycle (next ≈ 2028) | **6.44 GB** | ✓ |
| ↳ classes | – | 2 ground · 24 basement · 17 bridge · 26 synthetic ground · 9 synthetic water · **20 "last return not ground"** (buildings, cars, …) · **1 unclassified** (incl. intermediate vegetation returns) · 18 high noise → **no vegetation/building classes – separate them ourselves** with LoD2/ALKIS footprints | | ✓ |
| **bDOM50** (image-matched DSM point cloud) | `hm/bdom50_las/bdom50_las/` | 0.5 m, **RGBI-coloured**, from the 2024 flight (SURE) | 1.23 GB | ✓ |
| nDOM50 (normalised surface) | `hm/ndom50_tiff/`; WMS `wms_nw_ndom` | 0.5 m, mixed 2022/2024 tiles | 1.44 GB | ✓ |

## 3. Imagery and photoreal mesh

| Dataset | Path / service | Spec | Volume | |
|---|---|---|---|---|
| **DOP10** (current) | `lusat/akt/dop/dop_jp2_f10/dop10rgbi_32_{x}_{y}_1_nw_2024.jp2`; WMS `wms.nrw.de/geobasis/wms_nw_dop` (`nw_dop_rgb`, `nw_dop_cir`, `nw_dop_nir`); **WMTS** `wmts.nrw.de/geobasis/wmts_nw_dop` (set `EPSG_3857_16`: TileMatrix = WebMercator zoom − 5, down to 7.5 cm/px) | **10 cm RGBI, true orthophoto** (rectified on the bDOM – no leaning buildings); UltraCam Eagle M3; **south part (town + ridge, up to ≈ 52.314° N) flown 2024-03-08 leaf-off, north part 2024-05-01 leaf-on** | 3.24 GB (JP2) | ✓ |
| **iDOP20** (yearly, statewide) | `lusat/akt/idop/idop_jp2_f2/idop20rgbi_…_2025.jp2`; WMS `wms_nw_idop` | 20 cm RGBI, flown **2025-03-09/10, uniformly leaf-off**, not true-ortho | ~4.4 GB | ✓ |
| Historical DOP | `lusat/hist/hist_dop/…`; WMS `wms_nw_hist_dop` | Lübbecke: 1962 (partial), 1975, 1983, 1989, 1994/95, 1999/2000, 2004/05, 2008, 2011, 2014, 2017, 2020, 2022, 2024; before 2009 in Gauss-Krüger (EPSG:31467) | – | ✓ |
| DOP flight cycle | – | since 2023 half the state is flown each year at 10 cm TrueDOP, the other half at 20 cm; a new Lübbecke 10 cm flight in 2026 likely (?) | – | ~ |
| **3D-Mesh NRW** (textured, from aerial images) | SLPK `lusat/akt/3dmesh/3dmesh/` – Lübbecke in `Mesh_1425T5_nw_2024.slpk` (72.8 GB, 2024-03-08) + `Mesh_1425T12_nw_2024.slpk` (80.1 GB, 2024-05-01); **I3S SceneServer** `gis.nrw.de/geobasis/3D_mesh/SceneServer` (I3S 1.7 IntegratedMesh, EPSG:25832 + 7837) (✓ responds); b3dm version on CODE-DE (registration) | 10 cm texture, ±2–3 dm H / ±4–6 dm V, **2.5D** (one height per xy – facades smeared), 2-year cycle | 153 GB (whole blocks) – stream instead | ✓ |
| Oblique imagery | not offered by Geobasis NRW (the mesh is the substitute) | – | – | ~ |

**Gotcha – season seam**: the 2024 DOP10, bDOM and mesh are leaf-off south of
≈ 52.313° N and leaf-on north of it. Plan: base ground materials on the uniformly leaf-off
**iDOP20 2025** for colour consistency, use DOP10 for detail (macro modulation, roofs),
and let the vegetation model draw the leaves ([05 §2](05-terrain-imagery-buildings.md#2-ground-surface--from-orthophoto-to-living-material)).

## 4. Buildings, cadastre, topography

| Dataset | Path / service | Spec | Volume | |
|---|---|---|---|---|
| **LoD2 building models** | `3dg/lod2_gml/lod2_gml/LoD2_32_{x}_{y}_1_NW.gml`; **OGC API** `ogc-api.nrw.de/3dg/v1` → **3D Tiles 1.1** (implicit quadtree, GLB) at `/collections/building/3dtiles` (✓ live); items as CityJSON/GLB/CityGML; I3S `gis.nrw.de/geobasis/LOD2/SceneServer`; statewide SLPK | CityGML 1.0 (AdV profile), **untextured**; standard roof shapes fitted to the LiDAR, height ±1 m; attributes `roofType` (1000 flat, 2100 mono-pitch, 3100 gable, 3200 hip, 3300 half-hip, 3500 pyramid, 5000 mixed, …), `function` (ALKIS code, e.g. 31001_1000 residential), `measuredHeight`; centre tile 475/5795 alone has 1 335 objects; footprints 07/2025 | 469 MB | ✓ |
| LoD1 | `3dg/lod1_gml/` | blocks, ±5 m | 190 MB | ✓ |
| **ALKIS** (no owner data) | NAS `lk/akt/gru_xml/gru_05770000_Minden-Lübbecke_EPSG25832_NAS.zip` (455 MB) or simplified GPKG (160 MB); WFS `wfs_nw_alkis_vereinfacht` | parcels, buildings with *Gebäudefunktion*, **actual land use** (*tatsächliche Nutzung*) – the backbone of the material classes; per district only | 455 / 160 MB | ✓ |
| House coordinates | `lk/akt/gebref_txt/…` | address points (whole NRW) – for local search | 97 MB | ✓ |
| ATKIS Basis-DLM | `lm/akt/basis-dlm/…` | roads, paths, water, vegetation lines (whole NRW) | 1.2 GB | ✓ |
| **Landbedeckung NRW** | `lusat/akt/lb_nrw/…Detmold…GeoPackage.zip`; WMS/WMTS | 15 AdV land-cover classes (deciduous, conifers, woody, shrubs, grass, crops, reed, water, buildings, …), 1–2 m accuracy, status 01.01.2024 – **ready-made input for the material map** (dl-de/by-2.0!) | 734 MB (Regierungsbezirk) | ✓ |

## 5. Forest and trees

| Dataset | Spec | |
|---|---|---|
| **Baumartenklassifikation NRW** (`umwelt_klima/wald_forst/fernerkundung/baumartenklassifikation_nrw_EPSG25832_TIFF.zip`, 59 MB) | 10 m raster, 10 classes: clearing, oak, beech, other long-lived broadleaf, other short-lived broadleaf, poplar, pine, larch, spruce, Douglas fir (file date 10/2023; reference year ?) – **more local than the Thünen map → the species prior for Lübbecke** | ✓ |
| **Vitalitätsabnahme Nadelwald** (`…/vitalitaetsabnahme_nadelwald_201706-202508_…zip`) | bark-beetle conifer loss from PlanetScope, 2017-06 → 2025-08 (+ epochs 2023-06, 2023-09, 2024-09) | ✓ |
| Thünen tree species map (Blickensdörfer et al. 2024, RSE 304:114069) | Germany 10 m – cross-check | ~ |
| Copernicus HRL Tree Cover Density / Dominant Leaf Type (yearly 2018 →), Forest Type (3-yearly) | 10 m | ✓ |
| NRW beech/oak monitoring (`umwelt_klima/wald_forst/monitoring_buche/`) | phenology & vitality plots | ✓ |
| Single-tree register (*Baumkataster*) | **none found** for Lübbecke/NRW → trees from LiDAR (+ bDOM colour), ATKIS vegetation, LWK landscape elements `LFK-ALE` (single trees, tree rows, hedges ?) | ? |

**Forest composition inside the municipality** (from the NRW species raster, 1 647 ha
forest, ✓): beech **26.4 %** · **clearings 23.2 %** (dieback clear-cuts) · spruce 14.6 % ·
short-lived broadleaf 12.6 % · other long-lived broadleaf 8.2 % · larch 4.3 % · pine
4.1 % · oak 4.1 % · poplar 2.3 % · Douglas fir 0.3 %. The vitality layer maps ~580 ha of
conifer stands in Lübbecke, ~326 ha in damage class 3 (meaning to confirm). **The
Wiehengebirge of 2024 is beech forest with large bark-beetle clearings** – the twin must
show exactly that (clearings with regrowth, dead snags, stacked timber), not a generic
green ridge.

## 6. Fields (crop per field per year)

`https://www.opengeodata.nrw.de/produkte/umwelt_klima/bodennutzung/landwirtschaft/` (✓):

| Dataset | Content |
|---|---|
| **LWK-TSCHLAG** (current, 286 MB) / **LWK-TSCHLAG-HIST** (from 2019, 1.38 GB) | declared sub-parcels, statewide Shape, EPSG:25832, refreshed daily; `CODE`/`CODE_TXT` crop, `USE_CODE` crop group (cereals, oilseeds, root crops, permanent grassland …), `VALIDFROM` farm year, `ORGANICFAR`, `FLIK` field block |
| LFK-AKTI / LFK-ALE / DGL | field blocks / landscape elements / permanent grassland |

Licence ✓ **dl-de/by-2.0**, attribution "Land NRW, Abrufdatum <date of download>".

## 7. Water

| Water | Facts | |
|---|---|---|
| **Mittellandkanal** | Westhaltung Bergeshövede–Anderten, lock-free, nominal 50.30 m ü. NN (~); **PEGELONLINE gauge "LÜBBECKE", MLK-km 80.1**, ≈ 50.33 m+NN on 30 Oct 2026 – live REST `pegelonline.wsv.de/webservices/rest-api/v2/…` (✓); standard profiles: trapezoid ≈ 55 m wide × 4 m deep, sheet-pile rectangle 42 m (~); no open cross-section/bathymetry → model the standard profile; WSA Mittellandkanal/Elbe-Seitenkanal | ✓/~ |
| Streams | **Ronceva** through the town centre (mostly culverted) toward the Flöthe; **Große Aue** at the western edge; geometry & stationing **GSK3E** (`umwelt_klima/wasser/oberflaechengewaesser/gsk3e/…`, 429 MB); nearest river gauge **Fiestel** (Große Aue, 7 km NW, HYGON open data) | ✓ |
| Lakes | a ~9 ha moor lake in the Torfmoor; no bathymetry (?) | ~ |

## 8. Weather and climate (DWD, CC BY 4.0)

- **ICON-D2** (`opendata.dwd.de/weather/nwp/icon-d2/grib/{00..21}/{param}/`, ✓): 8 runs/day,
  0–48 h hourly, ~2.2 km; parameters incl. `clc` (3D cloud fraction), `clct/clcl/clcm/clch`,
  `h_snow`, `w_snow`, `freshsnw`, `snowc`, `snowlmt`, `rho_snow`, `u_10m/v_10m`,
  `vmax_10m`, `t_2m`, `td_2m`, `tot_prec`, `ww`, `vis`, `dbz_cmax`,
  `synmsg_bt_cl_ir10.8`, `lai`, `plcov`. Files roll off after ~1 day → archive.
- **Radar**: RADOLAN (`weather/radar/radolan/{rw,ry,sf,yw}`), composites
  (`weather/radar/composite/{rv,wn,hg,…}`), 1 km / 5 min; history in CDC.
- **Stations** (distance from the centre, ✓):

| ID | Name | km | m | Data |
|---|---|---|---|---|
| 03081 | Espelkamp-Isenstedt | 5.1 | 65 | precipitation (daily/hourly) |
| **04063** | **Rahden-Kleinendorf** | 16.1 N | 41 | hourly T & precip, 10-min "now", daily incl. **snow depth** |
| **04371** | **Bad Salzuflen** | 23.9 SSE | 135 | hourly T, **cloud**, **wind**, precip; daily snow |
| 07106 | Bielefeld-Deppendorf | 28.0 | 105 | hourly T & precip; daily snow |
| 00342 | Belm | 30.6 W | 103 | hourly T, cloud, wind; daily snow |
| 00769 | Bückeburg | 32.1 E | 68 | hourly T & cloud; daily snow |

- **Phenology** (✓): Lübbecke's own station (09168) closed in 1976; active annual
  reporters **09182 Hille** (9.6 km, 55 m) and **09187 Wulferdingsen** (9.8 km, 100 m).
  Observed: beech leaf unfolding 8–10 Apr 2024 / 15–25 Apr 2025, 50 % colouring 3–22 Oct,
  50 % leaf fall 20 Oct–14 Nov; pedunculate oak leaf unfolding 7 Apr 2024 / 10 Apr 2025,
  colouring 4–6 Nov, leaf fall 18–25 Nov. → calibration/validation set for
  `phenology.js`.
- **Grids** (✓): HYRAS-DE (daily 1 km precipitation, T, humidity, radiation),
  **SNOWRAS_DE** (daily snow depth 06 UTC, 1 km, Sep–May, from 1950), **HOSTRADA**
  (hourly 1 km T, cloud cover, wind …) – the downscaling drivers for replay mode.

## 9. Street level and photoreal

- **Panoramax**: only 4 images in the bbox (2017) (✓); Mapillary coverage (?) – token
  needed; Google Street View (?).
- Google Photorealistic 3D Tiles: irrelevant (EEA block, [01 §6](01-architecture.md#6-google-photorealistic-3d-tiles-optional));
  the open **NRW 3D-Mesh** (10 cm, I3S) is the photoreal reference.
- → facades are procedural by default; for the hero streets an optional **ground-level
  photo walk** (no drone) can add real facade detail
  ([05 §5](05-terrain-imagery-buildings.md#5-hero-spots-photogrammetry-and-gaussian-splats)).

## 10. Landmarks (Nominatim, ODbL)

| Feature | Lat | Lon |
|---|---|---|
| St.-Andreas-Kirche | 52.3016 | 8.6183 |
| Burgmannshof (Am Markt 29) | 52.3026 | 8.6174 |
| Bierbrunnen / Marktplatz | 52.3028 | 8.6183 |
| Rathaus | 52.3017 | 8.6143 |
| Barre's Brauwelt (brewery, est. 1842) | 52.2957 | 8.6179 |
| Reineberg (castle ruin) | 52.2940 | 8.6296 |
| Wurzelbrink with Wartturm (viewpoint) | 52.2830 | 8.6152 |
| Heidbrink | 52.2915 | 8.6389 |
| Kniebrink (just outside) | 52.2800 | 8.6175 |
| Babilonie (prehistoric hillfort) | 52.2744 | 8.5777 |
| Großes Torfmoor (raised bog) | 52.3258 | 8.6971 |
| Mittellandkanal / Hafen | 52.3339 | 8.6169 |
| Bahnhof Lübbecke (Westf) | 52.3064 | 8.6058 |
| Nettelstedt (church) | 52.3011 | 8.6967 |
| Gehlenbeck | 52.3089 | 8.6500 |
| Stockhauser Busch (lowland wood) | 52.3199 | 8.5933 |

The Wittekindsweg follows the ridge crest; industry lines the B 239 in the north.

## 11. Gotchas (summary)

1. **Season seam** in DOP10 / bDOM / mesh at ≈ 52.313° N (leaf-off south, leaf-on north) –
   iDOP20 2025 is uniformly leaf-off.
2. **LiDAR has no vegetation/building classes and no RGB** – split classes 1/20 with LoD2
   and ALKIS footprints, colour from DOP10 / bDOM50.
3. **Normal heights** (DHHN2016) everywhere – add GCG2016 ζ ≈ 43.7 m for the globe; check
   the height reference of the OGC-API 3D Tiles before mixing them with our terrain (?).
4. **I3S services are projected** (EPSG:25832), not WGS84 – convert, don't stream raw.
5. **Whole-block downloads**: mesh SLPK 153 GB, ALKIS/DLM/land cover/LWK per district,
   Regierungsbezirk or state – clip in the pipeline.
6. **LoD2 is untextured** – roofs from the true orthophoto, facades procedural / captured.
7. Historical DOPs before 2009 are Gauss-Krüger (EPSG:31467).
8. **Leaf-off forest**: the LiDAR (2023-02-09) and the DOP10/bDOM of the southern part
   (town and ridge, 2024-03-08) are leaf-off – beech crowns are thin in the canopy height
   model; see [06 §1](06-vegetation-seasons.md#1-tree-inventory-from-airborne-lidar-pipeline).
