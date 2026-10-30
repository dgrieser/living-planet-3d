# 04 · Hero area 2 – Fanø, Denmark

[← back to the plan index](README.md)

A 56 km² barrier island in the Danish Wadden Sea (UNESCO World Heritage, Nationalpark
Vadehavet), 16 km × 3 km, opposite Esbjerg. West: a kilometre-wide sand beach where cars
drive from Fanø Bad to Sønderho, dunes, heath and the Fanø Plantage dune forest. East and
south: salt marsh, tidal flats that fall dry twice a day, the Grådyb and Knudedyb tidal
channels. Towns: **Nordby** (ferry, ~2 700 inhabitants), **Sønderho** (thatched skipper
houses, windmill), Rindby, **Fanø Vesterhavsbad**. Population 3 332 (1 Jan 2026).
Highest point Pælebjerg, ≈ 21 m.

**(✓)** verified during research (Oct 2026, incl. live API calls), **(~)** partially /
secondary, **(?)** to confirm.

---

## 0. Area of interest and reference system

| | |
|---|---|
| Island bbox (OSM) | 55.3393–55.4727° N, 8.3275–8.4798° E |
| **Model box** (incl. Grådyb bar, Søren Jessens Sand, Knudedyb, Esbjerg harbour front) | **55.28–55.55° N, 8.20–8.56° E** ≈ 23 × 30 km; UTM32 E 449 183–472 240, N 6 126 242–6 156 086 |
| Full-detail zone | the island + beach + salt marsh + intertidal flats to the channel edges, + the Esbjerg ferry terminal |
| CRS | ETRS89 / UTM 32N (**EPSG:25832**) + **DVR90** heights (EPSG:5799), compound EPSG:7416 (✓) |
| Geoid | `dk_sdfi_dvr90_2023.tif` (DVR90(2023), EPSG:10485) on the PROJ CDN (CC BY 4.0) (✓) |
| Depth datums | `dk_sdfi_dkmsl_2022/2023.tif` (DKMSL), `dk_sdfi_dklat_2022/2023.tif` (LAT) – to bring sea-floor data into DVR90 (✓) |

**Agency & access changes (✓)**: the national geodata agency is now **Klimadatastyrelsen
(KDS)** (formerly SDFI/SDFE). Portals: **Dataforsyningen** (free login, token) and
**Datafordeler** (API key). Datafordeler's old raster/point-cloud file extracts ended on
29 Apr 2026 → new *FileDownloads API*; service-user login phased out 15 Jan 2027;
Dataforsyningen platform move planned for 30 Nov 2026. Coastal data (formerly
Kystdirektoratet, kyst.dk) now lives under **mst.dk** (Miljøstyrelsen).

---

## 1. Terrain, surface, point cloud

| Dataset | Facts | Licence / access | |
|---|---|---|---|
| **DHM/Terræn** (DTM) | **0.4 m**, DVR90; accuracy a few cm to ~0.5 m depending on surface; 5-year update cycle (1/5 of the country per year) | **CC BY 4.0**; FTP `ftps://ftp.dataforsyningen.dk/dhm_danmarks_hoejdemodel/DTM` (login), WCS `dhm_wcs_DAF`, Datafordeler FileDownloads; already in **Mapterhorn** | ✓ |
| **DHM/Overflade** (DSM) | 0.4 m | same | ✓ |
| **DHM/Punktsky** (LiDAR) | **8 pts/m² since 2018** (4–5 in 2014); LAZ 1 km tiles; survey year for Fanø → check the *DHM/Oprindelse* layer (?); a 4th national model is being flown 2024–27 | CC BY 4.0; FTP `/PUNKTSKY` or Datafordeler (≤ 45 GB per request) | ✓/? |
| Quick DHM | uncorrected recent LiDAR terrain/surface/difference | CC BY 4.0, WMS/WCS `dhm_temp` | ✓ |

Volume: ~2·10⁹ points over ~250 km² of land and flats ≈ 4–6 GB LAZ.

**Open question (important for the tides):** whether the intertidal flats in the DHM were
flown at low water. The *DHM/Oprindelse* (origin) layer gives flight dates per area; the
flight time is compared with the DMI water level of that moment to mask flats that were
under water (they then need bathymetry, §3).

## 2. Imagery

| Dataset | Facts | Licence / access | |
|---|---|---|---|
| **GeoDanmark Ortofoto (spring)** | flown every spring 21 Mar – 5 May (leaf-off, low sun); **12.5 cm** national; 2025–29 contract: RGB + NIR at 12.5 cm (optionally 10 cm); **Ortofoto 2026 final on Datafordeler from 2 Nov 2026** | **CC BY 4.0**; WMS/WMTS `orto_foraar_DAF`, Datafordeler `GeoDKO` | ✓ |
| Summer orthophotos | 10 May – 31 Jul (agriculture); only historic years free | CC BY 4.0 (free part) | ~ |
| **Skråfoto** (oblique aerial) | whole country every 2nd year since 2017; 5 cameras (nadir + N/E/S/W); COG JPEGs behind a STAC API (`api.dataforsyningen.dk/rest/skraafoto_api/v1.0/`, token); GSD ~10–15 cm (?) | **CC BY 4.0** | ✓ |

Use: the spring orthophoto (leaf-off, NIR) is the base for ground materials and
vegetation classification; the **oblique photos are the facade texture source** for
Fanø's buildings ([05](05-terrain-imagery-buildings.md#3-buildings)) – a big advantage
over Lübbecke.

## 3. Sea floor, flats and coast

| Dataset | Facts | Licence / access | |
|---|---|---|---|
| **Danmarks Dybdemodel (DDM) 2024 (v2.0)**, Geodatastyrelsen | 50 m grid over the Danish EEZ; vertical **DKMSL(2022)** (EPSG:10547), horizontal **EPSG:3034** (gotcha); layers depth + source + survey year; shallow areas from satellite & airborne LiDAR, crowdsourced bathymetry, EMODnet; not for navigation | GeoTIFF/WMS, dataforsyningen.dk/data/4817, own terms (?) | ✓ |
| **EMODnet DTM 2024** | ~115 m, LAT / MSL variants | (CC BY 4.0 ?) | ✓ |
| **EMODnet satellite-derived intertidal DEM, Danish Wadden Sea 2020** | intertidal heights from satellite waterlines | CC BY 4.0 | ~ |
| **Green (bathymetric) LiDAR, Wadden Sea** (Kystdirektoratet/MST with KU, GEUS, NIRAS, since 2013) | the Wadden Sea was scanned; ±5–10 cm in the pilot | **not downloadable – request from mst@mst.dk** | ~ |
| Grådyb channel surveys (Port Esbjerg, multibeam) | navigation channel to Esbjerg | ENC charts only for approved users; port surveys on request (?) | ? |
| MST Kystatlas / coastal data portal | beach profiles, coastal structures | various | ~ |

**Seamless land–flat–channel DEM (plan):**

1. DHM 0.4 m DTM for land, dunes, beach, salt marsh and every flat that was dry during
   the flight (verified against the flight-time water level).
2. Green-LiDAR intertidal/subtidal heights from MST (requested) for the flats and
   shallow gullies (*priele*).
3. Satellite-derived intertidal DEM (EMODnet 2020) where 1–2 are missing.
4. Multibeam / port surveys for Grådyb (requested), else DDM 50 m for the channels and
   the sea, EMODnet beyond.
5. All converted to DVR90 → ellipsoid; blended with distance-weighted feathering and a
   hydrologically consistent channel network (drainage gullies cut from flow
   accumulation, [07](07-water-tides-seafloor.md#4-the-tidal-flats-falling-dry)).
6. The *source/year* of every cell is kept as the provenance layer.

The bed changes: sand banks (Søren Jessens Sand) and channels migrate. The DEM is "as
surveyed" with its survey years shown in the model card.

## 4. Tides and sea level

### 4.1 Observations and predictions (DMI, CC BY 4.0, no key – ✓ live)

`https://opendataapi.dmi.dk/v2/oceanObs/collections/{observation|station|tidewater|tidewaterstation}/items`
– 10-min values since 2001, `sealev_dvr` (cm, DVR90), fair use 500 req / 5 s.

| Station | ID | Lat, lon | Type |
|---|---|---|---|
| Esbjerg Havn I / II | 25149 / 25151 | 55.4602, 8.4397 | DMI gauge + prediction |
| Esbjerg Havn | 9006401 | 55.4716, 8.4237 | Kystdirektoratet gauge |
| **Grådyb Barre** | prediction 25137 · gauge 6404 (MST) | 55.4401, 8.2602 | channel entrance = Fanø west |
| **Nordby** | prediction 25139 | 55.45, 8.4083 | Fanø harbour |
| **Sønderho** | prediction 25144 | 55.3478, 8.4749 | dries at low water |
| Mandø | 9007101/2, pred. 25346 | 55.2764, 8.5739 | south |
| Ribe Kammersluse | 9006701/3, pred. 25343 | 55.34, 8.676 | |
| Havneby (Rømø) | 9006801/2, pred. 26136 | 55.0871, 8.5654 | |

Grådyb Barre gauge data (6404, since 1997) via MST's water-level page (CSV, web service,
archive).

### 4.2 Tidal character (from the DMI 2026 prediction series)

| Station | Mean HW | Mean LW | **Mean range** | Max HW / min LW |
|---|---|---|---|---|
| Esbjerg | +0.71 m | −0.84 m | **1.55 m** | +0.99 / −1.10 m |
| Grådyb Barre (≈ west coast) | +0.63 | −0.82 | **1.45 m** | +0.89 / −1.09 |
| Nordby | +0.72 | −0.87 | **1.58 m** | +1.00 / −1.14 |
| Mandø | +0.63 | −0.67 | 1.30 m | – |

Relative to the series mean (≈ DVR90). Semi-diurnal, M2-dominated; noticeable
shallow-water distortion (M4) – flood shorter than ebb.

Preliminary harmonic fit (least squares on the 2026 predictions, no nodal correction,
RMS residual 3–4 cm – **to be redone properly with UTide on observations**):

| Constituent | Esbjerg A / φ | Grådyb Barre A / φ | Nordby A / φ |
|---|---|---|---|
| M2 | 70.5 cm / 327° | 67.2 / 302° | 72.0 / 323° |
| S2 | 17.8 / 100° | 17.5 / 71° | 18.4 / 95° |
| N2 | 11.8 / 303° | 11.4 / 276° | 11.6 / 298° |
| O1 | 9.6 / 222° | 9.8 / 207° | – |
| K2 | 6.7 / 249° | – | – |
| **M4** | 6.3 / 100° | **8.6 / 53°** | 6.9 / 93° |
| K1 | 6.0 / 49° | 6.5 / 35° | – |
| MS4 | 2.8 / 242° | 4.2 / 194° | – |

(phases relative to 2026-01-01 00:00 UTC, η = Σ A cos(ωt − φ))

### 4.3 Storm surges (Kystdirektoratet *Højvandsstatistikker 2024*, DVR90 – ✓)

| Event | Esbjerg |
|---|---|
| **24 Nov 1981** | **4.22 m** (record) |
| 26 Jan 1990 | 4.02 m |
| 24 Nov 1928 | 3.89 m |
| 3 Dec 1999 | 3.81 m |
| 5 Dec 2013 (Xaver/Bodil) | 3.43 m (Grådyb Barre 2.98 m) |
| Return levels (2024) | 20 y 3.69 m · 50 y 3.93 m · 100 y 4.07 m |

These are the showcase replays: the salt marsh and beach flood, waves break on the
dune front.

### 4.4 Forecast models (DMI STAC/EDR, GRIB, ~2 days retained, CC BY 4.0 – ✓)

| Model | Collection | Resolution | Content |
|---|---|---|---|
| **DKSS Wadden Sea** | `dkss_ws` | ~1 nm, 24 layers, 6.18–10.49° E / 53.23–55.69° N | sea-level deviation, currents, T/S, ice; 4×/day, 5-day forecast |
| **WAM Danish waters** | `wam_dw` | ~1 km | Hs, Tp, direction, swell; 4×/day, 5.5 days |
| CMEMS NWS waves | `NWSHELF_ANALYSISFORECAST_WAV_004_014` | 1.5 km, hourly | backup, free account |

Wave buoys: MST wave measurements page (stations to confirm).

## 5. Weather (DMI, CC BY 4.0, no key – ✓)

- **HARMONIE DINI** (`harmonie_dini_sf/_pl/_ml`, EPS products): ~2 km, 90 levels, runs
  every 3 h to +60 h; incl. 2 m T/dew point, 10 m wind, gusts, precipitation, snowfall
  rate, snow depth, cloud layers, cloud base, visibility.
- **Stations** (`/v2/metObs`): **Nordby 06088** (on Fanø since 2003: T, wind, gust,
  precipitation, soil T; no snow), **Esbjerg Lufthavn 06080** (full synop incl. clouds,
  visibility), Blåvandshuk Fyr 06081; manual snow depth at Ribe 25339, Agerbæk 25104,
  Oksvang Andrup 25161; historic Nordby snow series 25140 (1871–2009).
- **Radar** composite 500 m / 5 min (ODIM HDF5); **lightning** (`/v2/lightningdata`,
  since ≥ 2004).
- ICON-D2 (DWD) covers Fanø too – second opinion and 3D cloud fields
  ([08](08-atmosphere-weather-clouds.md)).

## 6. Buildings

| Dataset | Facts | Licence | |
|---|---|---|---|
| **GeoDanmark 6.0.2 – Bygning** | footprints with 3D Z at the roof edge; `BBRUUID` link | **CC BY 4.0** ("© GeoDanmark") | ✓ |
| **National LoD2** | **does not exist** – KDS *Danmarks Digitale Tvilling* (CityGML LoD2) only as prototypes for 5 municipalities; national launch awaiting funding | – | ✓ |
| **BBR** (building register, Datafordeler GraphQL/REST/files, API key) | per building: construction year, **roof covering material** (thatch / tiles / metal / felt / green roof …), **exterior wall material** (brick, half-timber, wood …), floors, area – attribute names/codes to confirm on teknik.bbr.dk | free data (exact terms ?) | ~ |
| Skråfoto | facades from 4 directions | CC BY 4.0 | ✓ |

→ **Build LoD2 ourselves**: GeoDanmark footprints + DHM point cloud → **roofer**
(3DBAG, LoD2.2) → BBR roof material (Sønderho's **thatched roofs** get a thatch
material with ridge caps; red/yellow brick walls, white-washed gables) → facade
textures from the oblique photos ([05](05-terrain-imagery-buildings.md)).

## 7. Vector features (GeoDanmark 6.0.2, CC BY 4.0, all 3D – ✓)

Bygning · **Træ** (single trees with trunk > 20 cm inside urban areas) · Trægruppe ·
**Hegn** (hedges) · Skov · KratBevoksning (scrub) · Hede (heath) · **SandKlit** (beach,
drift sand, dunes ≥ 1 ha) · Vådområde · Sø · Vandløb · **Kyst** (coastline) · Havn ·
Dige (dikes) · Vejmidte/Vejkant (roads) · Vindmølle · Plads. Accuracy at 10 cm GSD:
10 cm plan / 15 cm height for well-defined points. WFS `GeoDanmark_60_NOHIST_DAF`, GPKG.

## 8. Nature, land use, fields

| Dataset | Facts | Licence | |
|---|---|---|---|
| **§3 protected nature types** – Danmarks Arealinformation WFS `arealeditering-dist-geo.miljoeportal.dk/geoserver/ows`, layer `dai:bes_naturtyper` (no auth, tested) | in the model box 724 polygons: salt marsh (strandeng) 2 511 ha, heath (hede) 1 612 ha, dry grassland (overdrev) 603 ha, bog (mose) 521 ha, meadow (eng) 124 ha, lakes 54 ha; same service: habitat, bird protection, Ramsar, reserves | (?) | ✓ |
| **Landbrugsstyrelsen "Marker"** (field parcels with crop code + crop name per year, 2008–2026) | `landbrugsgeodata.fvm.dk/Download/Marker/Marker_<year>.zip`; fiboa/source.coop harmonised GeoParquet | **CC0-1.0** (per the fiboa catalogue) | ~ |
| **Fanø Plantage** (Naturstyrelsen) | ~1 400 ha, ~⅓ unplanted; mainly **Scots pine and mountain pine**; **Sitka spruce and lodgepole pine being removed**; parabolic dunes in the east, Pælebjerg dune heath in the west; proposed nature national park ~1 050 ha (540 ha conifer, 53 ha broadleaf, 152 ha wet, 302 ha open) | – | ✓ |
| Dunes | GeoDanmark SandKlit + klitfredning parcels (cadastre) | CC BY 4.0 | ~ |
| National park boundary, seal haul-outs | layer not found yet – MiljøGIS / DCE / trilateral seal surveys | ? | ? |

## 9. Ships – the ferry and the harbour

**Danish AIS data**: daily ZIPs of CSV (`aisdata.ais.dk`, ~0.8 GB/day, all Danish
waters, 26 columns: time, MMSI, position, SOG, COG, heading, name, type, size, draught);
now run by the Danish Emergency Management Agency; licence not stated (?).
**FanøFærgen**: *Fenja*, *Menja* and the electric *Grotte* (since 2021), 12-minute
crossing between Esbjerg (55.4613, 8.4410) and Nordby (55.4502, 8.4084) – animated along
their real AIS tracks in replay mode, along the timetable otherwise.

## 10. Landmarks (OSM/Nominatim, ODbL)

| Landmark | Lat, lon | Note |
|---|---|---|
| Nordby Kirke | 55.4405, 8.3974 | 1786 |
| Sønderho Kirke | 55.3497, 8.4667 | 1782, ship models |
| **Sønderho Mølle** | 55.3545, 8.4634 | windmill, 1895 |
| Fanø Bad / Vesterhavsbad | 55.4341, 8.3657 | beach driving to Sønderho |
| Søren Jessens Sand | 55.4487, 8.3420 | NW sand bank |
| Fanø Plantage (centre) | 55.3967, 8.4285 | |
| Pælebjerg | 55.3878, 8.4104 | dune hill, highest point |
| Kikkebjerg | 55.4512, 8.3942 | |
| Albuen Fuglekøje | 55.3944, 8.4431 | duck decoy |
| Hønen (south tip) | 55.3401, 8.4729 | Knudedyb side |
| Grådyb Barre gauge | 55.4401, 8.2602 | channel entrance |
| Ferry terminals Nordby / Esbjerg | 55.4502, 8.4084 / 55.4613, 8.4410 | |
| *Mennesket ved Havet* (Esbjerg) | 55.4878, 8.4111 | visible across the water |
| Sædding Strand Mellemfyr / Blåvandshuk Fyr | 55.4991, 8.4059 / 55.5578, 8.0833 | lighthouses (beams at night) |

**Hero spots for splat/photogrammetry capture** ([05 §5](05-terrain-imagery-buildings.md#5-hero-spots-photogrammetry-and-gaussian-splats)):
Sønderho village core with the mill, Nordby harbour and ferry terminal, a beach section
at Fanø Bad, a salt-marsh creek.

## 11. Open items (to settle in M2)

1. DHM survey year and tide state during the flight over the flats.
2. Green-LiDAR Wadden Sea data and Grådyb multibeam surveys (request to MST / Port Esbjerg).
3. BBR code lists (roof/wall material) and terms.
4. Licences of DDM, §3 layer, AIS.
5. Wave buoy stations.
6. National park and seal haul-out layers.
7. Published hydrodynamic studies of the Grådyb basin for model calibration.
