# 11 · Data pipeline, formats and hosting

[← back to the plan index](README.md)

The browser never touches raw national data. An **offline pipeline** turns sources into
streamable tilesets, **scheduled jobs** keep weather and land state fresh, and the
project owner's **mittwald server** serves everything. The app itself stays on GitHub
Pages (or moves to the same server).
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
| Imagery | KTX2 inside terrain glTF – ETC1S, or UASTC with RDO + Zstandard for near tiles (plain UASTC is 8 bits/pixel: the Lübbecke 10 cm pyramid, ≈ 16 Gpx, would be ≈ 16 GB) – or WebP/AVIF raster PMTiles draped by the overlay plugin |
| Material / land-use classes | 8-bit raster PMTiles (lossless) |
| Buildings | 3D Tiles 1.1 glTF + `EXT_mesh_features` / `EXT_structural_metadata` (feature IDs, function, year, material, height) |
| Trees, street furniture | glTF + **`EXT_mesh_gpu_instancing`** with per-instance attributes |
| Splat hero spots | glTF `KHR_gaussian_splatting` (ratified 2026) / SPZ v4 |
| Tide constituent maps | RGBA16F textures (KTX2, lossless) per constituent group + JSON constants |
| Weather | brotli-compressed R8/R16F/RGBA16F tiles + JSON index per run/time step |
| Land state | binary per area per day (scalars, phenology state, 10 m snowpack grid) + JSON index – [10 §1.4](10-time-ui-interaction.md#14-history-dependent-state-the-land-remembers) |

## 4. Data volumes (estimates)

| Product | Lübbecke (~120 km² box) | Fanø (~690 km² box; ~70 km² land + beach at full res) |
|---|---|---|
| Orthophoto tiles (10 cm / 12.5 cm, pyramid +33 %, KTX2 ETC1S/WebP at ≈ 2–3 bits/pixel) | ~2.5–5 GB | ~2–4 GB |
| Terrain meshes (≤ 1 m / 0.4 m, error-bounded) | ~0.3–0.6 GB | ~0.5–1 GB (incl. intertidal + sea floor) |
| Material class rasters | ~0.2 GB | ~0.3 GB |
| Buildings (LoD2 + roof textures) | ~0.2–0.5 GB | ~0.1–0.2 GB |
| Trees (instances only; ~1 M / ~0.3 M trees × 32 B) | ~50 MB | ~15 MB |
| Tree/plant archetypes + impostors | ~0.3 GB shared | (shared) |
| Splat spots (each 20–200 MB) | ~0.5 GB | ~0.5 GB |
| Tide maps | – | ~120 MB |
| Town wind fields (PALM-4U, optional – not in the totals) | ~1–4 GB | – |
| **Total hosted** | **≈ 4–7 GB** | **≈ 3.5–6 GB** |
| Raw sources kept for reprocessing | measured for the 90 municipality tiles: LiDAR 6.44 GB LAZ (1.03 billion points), DOP10 3.24 GB JP2, iDOP20 ~4.4 GB, bDOM50 1.23 GB, nDOM 1.44 GB, DGM1/DOM1 0.38 GB, LoD2 0.47 GB, ALKIS 0.46 GB → **≈ 20 GB** (+ the 153 GB mesh SLPK, which is streamed via I3S instead) | LiDAR ~10–13 GB LAZ (at Lübbecke's 6.25 bytes/point), orthophotos ~1–3 GB (land), DHM rasters ~2–6 GB, AIS ~0.8 GB/day → **≈ 20–35 GB** |

Global layers: Mapterhorn PMTiles extracts (tens of GB for Europe at z13–17),
Blue Marble monthly (~10 GB tiled), S2 quarterly (self-hosted only for selected regions;
otherwise EOX WMTS) → **total served ≈ 50–200 GB**. (~)

## 5. Hosting – the mittwald server

**Decision**: tiles, weather textures, land state and the scheduled jobs run on the
project owner's **mittwald** server (mStudio). The app itself can stay on GitHub Pages
(today's deployment) or move to the same server – both work; serving both from one origin
removes the CORS step.

GitHub Pages alone is not an option for the data: 1 GB site limit, files > 100 MiB
blocked, ~100 GB/month soft bandwidth, no Git LFS serving.

### 5.1 Layout on the server

```
<data host>/                     e.g. https://earth-data.<your-domain>/
  v1/
    global/terrain.pmtiles …     global layers (mirrored PMTiles extracts)
    luebbecke/terrain/…          3D Tiles (tileset.json + subtrees + glb)
    luebbecke/buildings/…
    luebbecke/trees/…
    fanoe/…
    tide/fanoe/*.ktx2
  wx/                            weather textures (rolling + archive)
  land-state/<area>/<date>.bin
  obs/                           gauge / station snapshots
```

- Versioned prefixes (`/v1/`, `/v2/` …): every published file is immutable; only the
  `tileset.json` roots and the weather/land-state indexes are short-lived.
- Static files served by the web server directly (a static/PHP app's document root, or an
  nginx/Caddy container in a container stack – whichever the server plan offers); no
  application code in the request path.

### 5.2 Web server requirements (checklist)

| Requirement | Why | Apache (`.htaccess`) example |
|---|---|---|
| **CORS** (if the app stays on GitHub Pages) | browser fetches tiles cross-origin – from Pages *and* from `npm run dev` on localhost; the tiles are public and fetched without credentials, so `*` is safe and a single origin would block local development | `Header set Access-Control-Allow-Origin "*"` · `Header set Access-Control-Expose-Headers "ETag, Content-Range, Content-Length"` · `Header set Access-Control-Allow-Headers "Range, If-Match"` |
| **HTTP range requests** | PMTiles reads byte ranges | native for static files (`Accept-Ranges: bytes`) – don't route PMTiles through PHP |
| **MIME types** | correct decoding, compression | `AddType model/gltf-binary .glb` · `AddType image/ktx2 .ktx2` · `AddType application/vnd.pmtiles .pmtiles` · `AddType application/octet-stream .subtree .bin` |
| **Caching** | tiles are immutable | `<FilesMatch "\.(glb\|ktx2\|subtree\|bin\|webp\|pmtiles)$"> Header set Cache-Control "public, max-age=31536000, immutable" </FilesMatch>`; `tileset.json` / indexes: `max-age=300` |
| **Compression** | JSON and binary weather textures | serve pre-compressed `.br` files (`RewriteRule` + `Content-Encoding: br`) or let the server compress JSON; **never** compress `.ktx2`/`.webp`/`.glb` with meshopt again, and never compress PMTiles responses (breaks ranges) |
| HTTP/2 or HTTP/3, TLS | many small requests | Let's Encrypt via the mStudio ingress |

### 5.3 Capacity planning

| Item | Size |
|---|---|
| Hero tilesets (both areas) | ≈ 8–13 GB |
| Global layers (Mapterhorn extracts for Europe, Blue Marble monthly, selected S2 mosaics) | ≈ 50–150 GB (start small: Europe + low zooms globally) |
| Weather textures – rolling window | ≈ 5–10 GB |
| Weather **archive** (needed for replay of recent days; DWD keeps only ~24 h) | ≈ 100–150 GB per year at full resolution → keep hourly for 30 days, 3-hourly for a year, then analysis-only (≈ 30–40 GB/year) |
| Raw sources kept for reprocessing (not served) | ≈ 40–60 GB (can live on a local machine instead) |

Egress: a visit that flies into a hero area loads ~100–300 MB the first time (then the
service worker cache). Check the server plan's traffic allowance; if it becomes a limit,
put a CDN in front of the data host (e.g. Cloudflare in proxy mode with a cache rule for
the immutable paths) – nothing in the app changes.

### 5.4 Client caching

A **service worker** caches our tiles and PMTiles range responses (the HTTP cache handles
range requests unreliably) – never third-party content whose terms forbid caching.
`cache.put()` rejects 206 responses, so range responses are stored as synthetic 200
responses keyed by URL + byte range (or in IndexedDB).

## 6. Scheduled jobs (weather and land state)

| Job | Cadence | Work | Output |
|---|---|---|---|
| Weather baker – global | every 6 h (+ hourly satellite) | GFS 0.25° / IFS 0.1° → tier-G textures; GMGSI / FCI → satellite correction | `wx/global/<run>/<step>.*` |
| Weather baker – regional | every 3 h (+ 5 min radar, 10 min satellite in live mode) | ICON-D2, DINI, ICON-EU, radar composites, CTH | `wx/region/...` |
| Archive | with every run | keep everything (DWD keeps ~24 h, DMI 48 h, ECMWF 2–3 days) – the replay mode for the last days depends on it | `wx/archive/...` |
| Land state | daily | integrate snowpack, phenology, litter, crops, wetness per hero area | `land-state/<area>/<date>.bin` |
| Observations | 10 min | DMI water level (Esbjerg etc.), surge, station weather | `obs/...` |

**Where to run: the mittwald server.** mStudio cronjobs run on a cron schedule and can
execute bash commands, PHP scripts or HTTP requests, tied to an app installation or a
container; Python and Node.js app installations and Docker-Compose-compatible container
stacks (with volumes and per-service CPU/memory limits) are available depending on the
plan. Setup:

- a **container stack** (or Python app) `earth-baker` with the pipeline image
  (Python + eccodes/cfgrib + xarray), a volume shared with the static data host;
- **cronjobs**: `*/5` radar/gauges/observations, `*/10` satellite, hourly NWP poll
  (downloads only when a new run exists), daily land state, daily archive thinning;
- jobs write to a temp directory and **atomically rename** into place, then update the
  index JSON last – the client never sees half-written files;
- a health file (`wx/status.json`: last success per feed) that the app reads to show data
  age and fall back gracefully;
- **ingest is sized, not unlimited**: every model level × every step × several variables
  of every ICON-D2 run adds up to tens of GB of downloads per day, plus the CPU to decode
  the GRIB. The baker fetches only what the modes need – the first 12 h of each run for
  live mode, the full horizon of the 00/12 UTC runs for forecast mode, only the variables
  the textures use, GFS by byte range via its `.idx` files. Check the container's
  CPU/RAM limits and the plan's traffic allowance before M6. (~)

GitHub Actions is **not** used for the live jobs (scheduled workflows in public repos are
disabled after 60 days without repository activity, and the 5–10 min cadence is too fast)
– it stays for lint/build/deploy and the `check:earth` scripts. The app falls back to the
last successful bake and shows its age.

## 7. CI

- Existing workflow (lint, build, deploy Pages) stays.
- Add: the existing `check:*` scripts (CI runs only lint and build today),
  `npm run check:earth` (all `check-earth-*.mjs`), `3d-tiles-tools validate` on
  pipeline outputs (pipeline repo/branch), Playwright visual snapshots on the WebGL2
  backend ([12 §2](12-roadmap-verification-licences.md#2-verification-keep-the-repos-scriptscheck-mjs-culture)).
- Secrets (server deploy credentials, Dataforsyningen/Datafordeler tokens, any API keys)
  only in the scheduled-job / pipeline environments on the mittwald server, never in the
  client bundle; browser-side keys (if any) origin-restricted.
- Publishing pipeline output: `rsync` over SSH/SFTP to the data host into a new version
  prefix, then switch the root `tileset.json`.

## 8. Geocoding (place search)

Nominatim (OSM, usage policy: ≤ 1 req/s, own User-Agent) or Photon for free text; for
the hero areas a local index of addresses (NRW Hauskoordinaten / DAWA addresses) and
named features shipped as a small JSON, so search there works offline and instantly.
