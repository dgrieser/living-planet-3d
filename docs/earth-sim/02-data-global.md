# 02 · Global data – the whole Earth from a distance

[← back to the plan index](README.md)

What the globe is made of everywhere outside the two hero areas. All entries were
researched in October 2026; **(✓)** = checked against the provider's page or a live
endpoint during research, **(~)** = from a secondary source, **(?)** = still to confirm
before use. "CORS ✓" means a browser on another origin can fetch it directly.

> **Honesty rule for the globe:** outside the hero areas the open data tops out at
> ~10 m imagery (Sentinel-2) and ~30 m terrain. National open orthophotos (10–25 cm)
> exist for several countries and are layered in where available. Everything closer
> than that is either a commercial layer (optional, see §3.2) or *procedural*, and the
> provenance overlay ([10](10-time-ui-interaction.md#22-collapsible-section-everything-else))
> says so.

---

## 1. Terrain (land)

| Dataset | Resolution / datum | Licence | Access & notes | |
|---|---|---|---|---|
| **GEDTM30 v1.2** (OpenGeoHub, Mar 2026) | 1″ (~30 m) **bare-earth DTM** (ML ensemble trained on ICESat-2/GEDI), 65°S–85°N, EGM2008 | CC BY 4.0 | One global COG (432 GB) at `s3.opengeohub.org/global/dtm/v1.2/…`, range requests, CORS ✓. **Bare earth** – does not double-count trees and roofs we add as 3D objects. Disclaimer "use for testing purposes" on the page | ✓ |
| **Copernicus DEM GLO-30 / GLO-90** (release 2024_1; AWS copy = 2021) | 1″ / 3″ **DSM**, EGM2008 | Free incl. commercial; mandatory notice "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved" (derived: "produced using Copernicus WorldDEM-30 …") | `s3://copernicus-dem-30m` (no CORS → preprocess). Surface model: includes canopy/roofs. Use for Antarctica and as fallback | ✓ |
| FABDEM V1-2 | 1″ bare earth | **CC BY-NC-SA 4.0** (share-alike would infect derived tiles) | avoid unless NC-SA is acceptable | ~ |
| NASADEM | 1″, 60°N–56°S, EGM96 | public domain | Earthdata login | ~ |
| ALOS AW3D30 v4.1 | 1″ DSM | free incl. commercial (JAXA terms) | registration | ~ |
| **Mapterhorn** | global Terrarium-encoded WebP tiles (512 px), z0–17; fuses Copernicus with **national 1 m / 0.4 m DEMs** – incl. *NRW DGM1 1 m* (dl-de/zero-2.0) and *Danmarks Højdemodel – Terræn 0.4 m* (CC BY 4.0, Klimadatastyrelsen) | per source, full list in `download.mapterhorn.com/attribution.json` | `tiles.mapterhorn.com/{z}/{x}/{y}.webp`, TileJSON, **PMTiles downloads** (planet z0–12 + regional z13–17 extracts) | ✓ (attribution list checked) |
| AWS Terrain Tiles (Terrarium) | z0–15, mixed sources | attribution list (Tilezen) | CORS ✓, no key, frozen since 2017 – **prototyping only** | ✓ |

**Choice:** start with **Mapterhorn** (open, already contains both hero DEMs, no
preprocessing) – mirror the relevant PMTiles extracts to our own storage instead of
hot-linking. Long term: GEDTM30 bare earth on land (the Copernicus part of Mapterhorn
is a surface model), GLO-30 for Antarctica/gaps, merged with the bathymetry below into
one seamless global height field, tiled by our pipeline ([11](11-pipeline-hosting.md))
into quantized-mesh (or Terrarium) tiles. Note: Terrarium/Mapterhorn are land-only
heights at sea level – the sea floor below has to be fused in by us.

## 2. Sea floor (needed for "remove the water")

| Dataset | Resolution / datum | Licence | Notes | |
|---|---|---|---|---|
| **GEBCO_2026 Grid** (Apr 2026) | 15″ (~450 m), MSL, land + sea; a **sub-ice** variant (BedMachine) and a **TID grid** marking the source of each cell | public domain with acknowledgement: "GEBCO Compilation Group (2026) GEBCO 2026 Grid (doi:10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa)" | netCDF 7 GB; community COG mirror on source.coop (CORS ✓). Only **28.7 %** of the sea floor is mapped to modern standards – the rest is altimetry-predicted (km-scale). The TID grid lets the provenance overlay show *measured* vs *predicted* sea floor | ✓ |
| **EMODnet Bathymetry DTM 2024** | 1/16′ (~115 m) European seas; > 200 nearshore HR-DTMs at 1/32′–1/512′; **LAT** datum (MSL variant available) | CC BY 4.0 (?) | GeoTIFF/NetCDF/WMTS; the 2026 release is in production | ✓/~ |
| SRTM15+ V2.5.5 | 15″ | free | GEBCO's base where unmapped – use GEBCO | ~ |
| Cesium World Bathymetry | GEBCO 2023 + patches | Cesium ion ToS | only via ion | ~ |

**Choice:** GEBCO_2026 globally (sub-ice variant when the ice sheets are "removed" too –
a nice optional extra), EMODnet 2024 (MSL variant) blended in for Europe, and the hero
bathymetry ([04](04-data-fanoe.md)) on top. All converted to one vertical reference
(see §8).

## 3. Imagery

### 3.1 Open layers (the default stack)

| Layer | Use | Resolution / cadence | Licence | |
|---|---|---|---|---|
| **NASA Blue Marble Next Generation** – 12 monthly composites (2004) | **far zoom with seasons** (snow lines, green-up, dry seasons) | 500 m, one per month | NASA, credit "NASA Earth Observatory (Reto Stöckli)" | ✓ |
| **CDSE Sentinel-2 Global Mosaics** (quarterly L3) | **mid zoom, seasonal** – one mosaic per quarter = per season | 10 m, 2015 → now, each quarter ≈ 1 month after its end | Copernicus Sentinel notice – free incl. commercial, "Contains modified Copernicus Sentinel data [year]" | ✓ (reflectance → needs colour grading; STAC at `stac.dataspace.copernicus.eu`) |
| **EOX Sentinel-2 cloudless** (`s2cloudless-2016 … -2025`, WMTS, CORS ✓) | easiest ready-made mid-zoom layer | ~10 m, yearly | 2016: CC BY 4.0; **2017(?)–2025: CC BY-NC-SA 4.0** (commercial licence ≈ €6 000 / product) | ✓ (layer list checked live) |
| ESA WorldCover S2 composites 2020/2021 | alternative annual 10 m RGB/NIR | 10 m | CC BY 4.0 | ✓ |
| **NASA GIBS** – MODIS/VIIRS Corrected Reflectance (daily), HLS 30 m | **"today" layer** – the real cloud and snow picture of a given day from space | 250 m–30 m, daily, CORS ✓ | NASA open data, acknowledge GIBS | ✓ |
| **NASA Black Marble** (VNP46A4 annual, GIBS `VIIRS_Black_Marble`) | night side | 15″ / ~500 m | NASA | ✓ |

**National open orthophotos** (layered in where they exist – "close zoom" outside the
hero areas):

| Country | Layer | Licence | |
|---|---|---|---|
| Germany | DOP20 / DOP10 per state (WMS/WMTS) | BY, NI, MV, SH, HB: CC BY 4.0 · NW, HE, BE: dl-de/zero-2.0 · others: dl-de/by-2.0 | ~ |
| Netherlands | PDOK Luchtfoto 8 cm + AHN4/5 (0.5 m) | CC BY 4.0 / AHN CC0 | ✓ |
| Denmark | SDFI orthophotos 12.5 cm, DHM 0.4 m | see [04](04-data-fanoe.md) | ✓ |
| France | BD ORTHO 20 cm (`data.geopf.fr/wmts`), LiDAR HD 0.5 m | Licence Ouverte 2.0 | ✓ |
| Switzerland | SWISSIMAGE 10 cm, swissALTI3D, swissSURFACE3D | OGD (© swisstopo) | ✓ |
| Austria | basemap.at orthofoto 30 cm | CC BY 4.0 | ✓ |
| UK (England) | EA LIDAR 1 m | OGL v3 | ~ |
| USA | NAIP 0.3–1 m, USGS 3DEP 1 m + lidar | public domain | ✓ |

### 3.2 Optional commercial layers (behind an explicit switch, never the default)

| Provider | Terms that matter for a custom WebGL globe | |
|---|---|---|
| **Google Photorealistic 3D Tiles** | see [01 · Architecture §6](01-architecture.md#6-google-photorealistic-3d-tiles-optional) | – |
| Esri World Imagery | ArcGIS Location Platform key; 2 M tiles/month free; "Powered by Esri" + source credits; **no caching/export** | ✓ |
| Bing aerial | free Basic keys ended 30 Jun 2025; still via Cesium ion (Community plan, 1 000 imagery sessions/month) until 2028 at the latest | ✓ |
| Mapbox Satellite | 750 k tile requests/month free; logo + "© Maxar"; caching restricted (?) | ~ |
| MapTiler Satellite | free plan non-commercial; **no server caching, no redistribution, no bulk download** | ✓ |

Any API key on GitHub Pages is public → origin-restricted keys only.

## 4. Land cover, vegetation, phenology (drives procedural 3D vegetation globally)

| Dataset | Use | Resolution | Licence | |
|---|---|---|---|---|
| **ESA WorldCover v200 (2021)** | class placement (forest / shrub / grass / crop / built / water / snow / mangrove / moss) | 10 m | CC BY 4.0 | ✓ |
| Dynamic World V1 | near-real-time class probabilities incl. snow | 10 m | CC BY 4.0, Earth Engine only | ✓ |
| **Meta/WRI Canopy Height Maps v2** (Mar 2026) | **tree heights everywhere** | ~1 m | CC BY 4.0, `s3://dataforgood-fb-data/forests/v2/…` | ✓ |
| ETH Global Canopy Height 2020 (Lang et al.) | fallback | 10 m | CC BY 4.0 | ~ |
| CLMS HRL Tree Cover Density / **Dominant Leaf Type** / Forest Type | broadleaf vs. conifer in Europe | 10 m (2018–2021) | CLMS: free, credit "Generated using European Union's Copernicus Land Monitoring Service information" | ~ |
| **CLMS HR-VPP** | per-pixel **start/end of season** dates (Europe), 2017 → now | 10 m | CLMS | ~ |
| **MODIS MCD12Q2 v6.1** | global green-up / senescence / dormancy dates 2001–2024 | 500 m | no restrictions | ✓ |
| DLR Tree Species Germany 2022 | species groups | 10 m | CC BY 4.0 | ~ |

## 5. Buildings and roads (procedural 3D outside the hero areas)

| Dataset | Notes | Licence | |
|---|---|---|---|
| **Overture Maps buildings** (release 2026-10-21.0, monthly, GeoParquet) | OSM + Esri Community + Microsoft + Google + more; heights/floors/parts mostly from OSM | **ODbL** – a 3D building tileset is a *derivative database* → publish it under ODbL; rendered pixels only need attribution | ✓ |
| OpenStreetMap | roads, `roof:shape`, `building:levels`, landuse, street lamps, trees | ODbL, "© OpenStreetMap contributors" | ✓ |
| Google Open Buildings v3 + 2.5D Temporal | Global South footprints; yearly height rasters 2016–2023 | CC BY 4.0 **or** ODbL | ✓ |
| Microsoft Global ML Building Footprints | 1.4 B footprints, some heights | repo says CDLA-Permissive-2.0 (Overture lists ODbL) | ✓ |
| GlobalBuildingAtlas (TUM 2025) | 2.68 B LoD1 heights (RMSE ≈ 4 m in Europe) | unclear overall licence | ~ |
| GHSL GHS-BUILT-H R2023A | 100 m mean building height | CC BY 4.0 | ~ |

## 6. Snow, sea ice, lakes and rivers

| Dataset | Use | Resolution / cadence | Licence | |
|---|---|---|---|---|
| **NOAA/USNIC IMS** (NSIDC G02156) | **daily snow + sea-ice mask**, Northern Hemisphere | 1 km / 4 km, daily (current to yesterday) | US government, cite DOI 10.7265/N52R3PMC | ✓ |
| **OSI SAF OSI-401-d** | daily global sea-ice concentration | ~10 km | CC BY 4.0 | ✓ |
| GIBS MODIS NDSI snow (daily), MODIS monthly snow % (2000 → now) | snow climatology for `climatology` mode | z6–z8 | NASA | ✓ |
| Copernicus Land snow (SCE 1 km global daily; HR-S&I FSC 20 m / GFSC 60 m Europe) | European snow detail | daily | CLMS | ~ |
| ERA5-Land | snow depth / SWE for replay mode | 0.1°, hourly, 1950 → now | CC BY 4.0 | ~ |
| HydroLAKES / HydroRIVERS | lake polygons / river network | 1.4 M lakes ≥ 10 ha | CC BY 4.0 / HydroSHEDS licence | ✓ |
| JRC Global Surface Water v1.5 (1984–2024) | water occurrence → wet/dry, seasonal lakes | 30 m, XYZ tiles available | free, "Source: EC JRC/Google" | ✓ |
| GLOBathy | depth of 1.4 M lakes (for draining lakes) | per lake | CC BY 4.0 (?) | ? |

## 7. Night lights, stars, Moon

- VIIRS Black Marble (above) for the night side from space.
- Star catalogue for the sky: Hipparcos / Yale Bright Star Catalogue (public), rendered by
  the atmosphere's sky pass; Moon texture & normal map: NASA LRO (public domain).

## 8. Vertical reference – one height system for everything

Every height source uses a different zero:

| Source | Vertical datum |
|---|---|
| Copernicus DEM, GEDTM30, FABDEM | EGM2008 geoid |
| NASADEM, AW3D30 | EGM96 |
| GEBCO | MSL |
| EMODnet | LAT (MSL variant available) |
| Lübbecke (NRW) | DHHN2016 (NHN), quasigeoid GCG2016 |
| Fanø (DK) | DVR90, DKgeoid |
| 3D Tiles / Google tiles / raw LiDAR | WGS84 / ETRS89 **ellipsoid** |

**Rule:** the runtime works in **ellipsoidal heights** (WGS84). The pipeline converts each
source with its geoid (`h = H + N`; EGM2008 2.5′ grid from `cdn.proj.org/us_nga_egm08_25.tif`,
public domain; national quasigeoids for the hero areas). Sea level at a place is then
`N(place) + MDT + tide + surge`, which is exactly what the water renderer needs
([07](07-water-tides-seafloor.md)). Skipping this step moves coastlines by tens of metres.

## 9. Recommended open default stack (summary)

1. **Terrain**: Mapterhorn (mirrored PMTiles) for M0–M1; then GEDTM30 (land) + GLO-30
   (gaps, Antarctica) + national DEMs + GEBCO_2026 (sea) + EMODnet (Europe) → our own
   seamless land+sea tiles.
2. **Imagery**: Blue Marble monthly (far) → CDSE quarterly S2 (mid, seasonal; EOX
   s2cloudless as the quick NC alternative) → national orthophotos (near, where open) →
   hero tilesets. GIBS daily true colour as the "today from space" layer. Black Marble at
   night.
3. **Vegetation**: WorldCover classes + Meta CHM v2 heights + DLT broadleaf/conifer +
   MCD12Q2/HR-VPP season dates → procedural forests and fields.
4. **Snow/ice**: IMS 1 km daily + OSI SAF sea ice (+ monthly MODIS snow % for climatology).
5. **Buildings**: Overture (ODbL) extruded with OSM roof shapes; GHSL/GBA heights as fallback.
6. **Water**: HydroLAKES, HydroRIVERS, JRC GSW.
7. **Geoid**: EGM2008 from the PROJ CDN.
8. **Avoid as defaults**: anything that forbids caching or needs a paid key (Esri,
   Mapbox, MapTiler, Bing) and share-alike/NC sources for tiles we redistribute
   (FABDEM; EOX 2018+ only if NC is acceptable – it is, for this non-commercial
   educational app, but it is then the only NC layer and must be marked).
