# 11 · Data pipeline, formats and hosting

[← back to the plan index](README.md)

The browser never touches raw national data. An **offline pipeline** turns sources into
streamable tilesets, a **scheduled job** keeps weather and land state fresh, and
**object storage behind a CDN** serves everything. The app itself stays on GitHub Pages.
**(✓)** verified during research (Oct 2026), **(~)** estimate / own design.

---

## 1. Pipeline layout (`tools/earth-pipeline/`, not shipped to the client)

```
tools/earth-pipeline/
  Dockerfile               GDAL 3.13, PDAL 2.10, Python 3.12, R + lidR, Node 22, KTX-Software
  Makefile                 one target per product, incremental
  sources.yaml             every source: URL, licence, attribution, CRS, vertical datum, checksum
  areas/
    luebbecke.yaml         bbox, tiling scheme, products, quality settings
    fanoe.yaml
  steps/
    fetch/                 ATOM/STAC/HTTP downloaders with resume + checksums
    geodesy/               reprojection, vertical datum → ellipsoid, ETRS89 → ITRF epoch
    terrain/               DEM fusion (land + intertidal + sea), hydro-flattening, meshing
    imagery/               ortho mosaicking, de-shadowing, colour harmonisation, tiling
    materials/             land-use / material class rasters
    buildings/             CityGML → 3D Tiles, LoD2 reconstruction, facade parameters
    trees/                 LiDAR → tree inventory → instanced tiles
    water/                 water bodies, bathymetry, tide model setup + harmonic baking
    weather/               (static) wind lookup tables, climatology for the generator
  out/                     tilesets + manifests (git-ignored; uploaded to storage)
```

Every product writes a **manifest** (`tileset.json` + `manifest.json`): sources with
versions and checksums, licence, attribution string, bounding volume, creation date,
pipeline commit. The client reads the attribution from there
([10 §2.5](10-time-ui-interaction.md#25-attribution)).

## 2. Tools (✓ versions as of Oct 2026)

| Task | Tool | Licence |
|---|---|---|
| Raster / vector / reprojection, COG | GDAL 3.13.3, rio-cogeo 7 | MIT / BSD |
| Point clouds, COPC | PDAL 2.10.2 | BSD |
| Tree detection | lidR 4.2 (R) | GPL-3 (output data unaffected) |
| CityGML import / conversion | 3DCityDB 5.1.4, citygml-tools 2.5 / citygml4j 3.5 | Apache-2.0 |
| Buildings → 3D Tiles (implicit tiling, `EXT_mesh_features`) | **pg2b3dm 2.28** (Geodan) | MIT |
| Trees → instanced glTF (`EXT_mesh_gpu_instancing`) | **i3dm.export 2.18** or a glTF-Transform script | MIT |
| Alternative all-in-one (CityGML, LAS, mesh → 3D Tiles; DEM → quantized-mesh) | mago-3d-tiler 1.16 / mago-3d-terrainer 1.14 | MPL-2.0 |
| Point clouds → 3D Tiles | py3dtiles 12.1 | Apache-2.0 |
| LoD2 reconstruction (Fanø) | roofer (3DBAG) | GPL-3 |
| Terrain meshing | pydelatin 0.4 / pymartini 0.6, quantized-mesh-encoder 0.5 | MIT |
| glTF optimisation (meshopt, Draco, KTX2, simplify) | glTF-Transform 4.5 | MIT |
| Texture compression | KTX-Software 4.4 (Basis Universal ETC1S/UASTC) | Apache-2.0 |
| Tileset validation, packing (3TZ) | 3d-tiles-tools 0.5.4 | Apache-2.0 |
| Raster/vector archives | go-pmtiles 1.31, tippecanoe 2.79 | BSD |
| Catalogue | pystac 1.15 | Apache-2.0 |
| Tide model | SCHISM (Apache-2.0) or D-Flow FM (AGPL/GPL); UTide (MIT); pyTMD (MIT) | – |
| Wind | WindNinja (public domain), PALM-4U (GPL-3) | – |

Avoid in the default path: Obj2Tiles (AGPL), cesium-terrain-builder (unmaintained), FME
(commercial).

## 3. Output formats

| Content | Format |
|---|---|
| Global terrain + bathymetry | Terrarium WebP tiles in **PMTiles** (512 px), or quantized-mesh-1.0 with normals/watermask extensions |
| Hero terrain | **3D Tiles 1.1, implicit quadtree**, glTF meshes (delatin, error-bounded) + `EXT_meshopt_compression`, with skirts; or Terrarium tiles at z18–20 for GPU displacement |
| Imagery | KTX2 (UASTC for near tiles, ETC1S far) inside terrain glTF, or WebP/AVIF raster PMTiles draped by the overlay plugin |
| Material / land-use classes | 8-bit raster PMTiles (lossless) |
| Buildings | 3D Tiles 1.1 glTF + `EXT_mesh_features` / `EXT_structural_metadata` (feature IDs, function, year, material, height) |
| Trees, street furniture | glTF + **`EXT_mesh_gpu_instancing`** with per-instance attributes |
| Splat hero spots | glTF `KHR_gaussian_splatting` (ratified 2026) / SPZ v4 |
| Tide constituent maps | RGBA16F textures (KTX2, lossless) per constituent group + JSON constants |
| Weather | brotli-compressed R8/R16F/RGBA16F tiles + JSON index per run/time step |
| Land state | small JSON/binary per area per day |

## 4. Data volumes (estimates)

| Product | Lübbecke (~120 km² box) | Fanø (~600 km² box; ~70 km² land + beach at full res) |
|---|---|---|
| Orthophoto tiles (10 cm / 12.5 cm, pyramid +33 %, KTX2/WebP) | ~2.5–5 GB | ~2–4 GB |
| Terrain meshes (≤ 1 m / 0.4 m, error-bounded) | ~0.3–0.6 GB | ~0.5–1 GB (incl. intertidal + sea floor) |
| Material class rasters | ~0.2 GB | ~0.3 GB |
| Buildings (LoD2 + roof textures) | ~0.2–0.5 GB | ~0.1–0.2 GB |
| Trees (instances only; ~1 M / ~0.3 M trees × 32 B) | ~50 MB | ~15 MB |
| Tree/plant archetypes + impostors | ~0.3 GB shared | (shared) |
| Splat spots (each 20–200 MB) | ~0.5 GB | ~0.5 GB |
| Tide maps | – | ~50 MB |
| **Total hosted** | **≈ 4–7 GB** | **≈ 3.5–6 GB** |
| Raw sources kept for reprocessing | measured for the 90 municipality tiles: LiDAR 6.44 GB LAZ (1.03 billion points), DOP10 3.24 GB JP2, iDOP20 ~4.4 GB, bDOM50 1.23 GB, nDOM 1.44 GB, DGM1/DOM1 0.38 GB, LoD2 0.47 GB, ALKIS 0.46 GB → **≈ 20 GB** (+ the 153 GB mesh SLPK, which is streamed via I3S instead) | LiDAR ~4–6 GB LAZ, orthophotos ~1–3 GB (land), DHM rasters ~2–6 GB, AIS ~0.8 GB/day → **≈ 15–30 GB** |

Global layers: Mapterhorn PMTiles extracts (tens of GB for Europe at z13–17),
Blue Marble monthly (~10 GB tiled), S2 quarterly (self-hosted only for selected regions;
otherwise EOX WMTS) → **total served ≈ 50–200 GB**. (~)

## 5. Hosting

| Option | Facts | Verdict |
|---|---|---|
| GitHub Pages | 1 GB site, ~100 GB/month soft bandwidth, files > 100 MiB blocked, **does not serve Git LFS** | app only (as today) |
| **Cloudflare R2** | 10 GB-month free, then $0.015/GB-month; **free egress**; 1 M Class A / 10 M Class B ops free; r2.dev URLs are rate-limited → **custom domain + cache rule** (glb/json/pmtiles are not cached by default); CORS GET/HEAD, allow `Range`, expose `ETag` | **recommended** (~$3/month for 200 GB) |
| Backblaze B2 (+ Cloudflare) | $6.95/TB-month, egress free via CDN partners | good alternative |
| Hetzner Object Storage | €6.49/month incl. 1 TB storage + 1 TB egress (EU) | alternative, EU-hosted |
| AWS S3 + CloudFront | flat-rate plans (free tier 100 GB transfer / 5 GB S3) | possible |

- Versioned prefixes (`/v3/luebbecke/terrain/...`), immutable files with long
  `Cache-Control`, only `tileset.json` roots short-lived.
- A **service worker** caches our tiles and PMTiles range responses (browsers don't
  cache range requests) – never third-party content whose terms forbid caching.

## 6. Scheduled jobs (weather and land state)

| Job | Cadence | Work | Output |
|---|---|---|---|
| Weather baker – global | every 6 h (+ hourly satellite) | GFS 0.25° / IFS 0.1° → tier-G textures; GMGSI / FCI → satellite correction | `wx/global/<run>/<step>.*` |
| Weather baker – regional | every 3 h (+ 5 min radar, 10 min satellite in live mode) | ICON-D2, DINI, ICON-EU, radar composites, CTH | `wx/region/...` |
| Archive | with every run | keep everything (DWD keeps ~24 h, DMI 48 h, ECMWF 2–3 days) – the replay mode for the last days depends on it | `wx/archive/...` |
| Land state | daily | integrate snowpack, phenology, litter, crops, wetness per hero area | `land-state/<area>/<date>.bin` |
| Observations | 10 min | DMI water level (Esbjerg etc.), surge, station weather | `obs/...` |

**Where to run**: GitHub Actions cron is free for public repositories but (a) scheduled
workflows in public repos are **disabled after 60 days without repository activity**
(keep-alive or manual `workflow_dispatch` needed) and (b) jobs are capped at 6 h and the
radar/satellite cadence is too fast for it. → Baker as a small container on a cheap VM or
a serverless function with a cron trigger (Cloudflare Workers Cron for the light
5–10 min fetches; a VM/Cloud Run job for GRIB processing). The app falls back to the last
successful bake and shows its age.

## 7. CI

- Existing workflow (lint, build, deploy Pages) stays.
- Add: `npm run check:earth` (all `check-earth-*.mjs`), `3d-tiles-tools validate` on
  pipeline outputs (pipeline repo/branch), Playwright visual snapshots on the WebGL2
  backend ([12 §2](12-roadmap-verification-licences.md#2-verification-keep-the-repos-scriptscheck-mjs-culture)).
- Secrets (R2 write keys, any API keys) only in the scheduled job / pipeline
  environments, never in the client bundle; browser-side keys (if any) origin-restricted.

## 8. Geocoding (place search)

Nominatim (OSM, usage policy: ≤ 1 req/s, own User-Agent) or Photon for free text; for
the hero areas a local index of addresses (NRW Hauskoordinaten / DAWA addresses) and
named features shipped as a small JSON, so search there works offline and instantly.
