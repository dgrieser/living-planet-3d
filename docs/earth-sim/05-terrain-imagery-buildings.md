# 05 · Terrain, ground surface, buildings and hero spots

[← back to the plan index](README.md)

How measured data become the solid world of the two hero areas: relief, the ground
under your feet, every building, the small things, and photogrammetric "hero spots".
Sources are catalogued in [03 · Lübbecke](03-data-luebbecke.md) and
[04 · Fanø](04-data-fanoe.md). **(✓)** verified, **(~)** own design / secondary.

---

## 1. Terrain

- **Input**: NRW DGM1 (1 m) and DHM/Terræn (0.4 m), both bare-earth, fused with the
  bathymetry for Fanø ([04 §3](04-data-fanoe.md#3-sea-floor-flats-and-coast)) and with
  the global terrain at the edges (feathered over 1–2 km, ETRS89→ITRF shift applied,
  [01 §3](01-architecture.md#3-coordinates-precision-and-depth)).
- **Fixes before meshing**: hydro-flattening (lakes, canal at its exact water level),
  bridges (bare-earth DEMs cut them out → bridge decks as separate objects from
  ALKIS/GeoDanmark/OSM), embankments and noise walls, removal of LiDAR artefacts on water.
- **Meshing**: error-bounded TIN per tile (delatin) at 3D Tiles implicit quadtree levels,
  geometric error halving per level, skirts; or Terrarium height tiles at z18–20 with
  GPU displacement (3d-tiles-renderer `TerrariumMeshPlugin`) – decide by benchmark.
- **Micro-relief** below DEM resolution, procedural by material class: plough furrows
  following the field's tillage direction (from the orthophoto's texture orientation),
  tractor tracks, sand ripples on beach and flats, dune wind ripples, cobblestone
  displacement, root bumps in forests.

## 2. Ground surface – from orthophoto to living material

Orthophotos are *one moment*: the leaf state, the shadows and the parked cars of a
spring morning. A twin that changes season and sun cannot just drape them. Pipeline:

### 2.1 Clean the orthophoto

1. **Mosaic & harmonise**: seam-free colour balancing across flight lines and years.
2. **Mask under 3D objects**: building footprints (+ roof overhang) and tree crowns
   (from LiDAR) are masked – roofs get their own textures (§3), the ground under crowns is
   *inpainted* with the class-appropriate material (forest floor, lawn), not with the
   crown seen from above.
3. **De-shadowing**: the flight date/time is known → sun position → cast shadows of the
   DSM simulated and projected into the image; shadow pixels are relit by
   companion-area intensity mapping (classic photogrammetric method) or, better, an
   **inverse-rendering albedo recovery** (e.g. *A General Albedo Recovery Approach for
   Aerial Photogrammetric Images through Inverse Rendering*, arXiv 2409.03032). The
   renderer then casts its own, correct shadows for any instant.
4. **Remove transient objects**: parked cars, people on the beach – detection +
   inpainting (optional; the beach is better without them).

### 2.2 Material classification

Per-pixel class raster at 0.25–0.5 m from cadastre/topographic land use (ALKIS
*tatsächliche Nutzung*, GeoDanmark), field registers, §3 nature types, OSM, refined by a
segmentation of RGB + NIR + nDSM:

`asphalt · paving/cobbles · concrete · gravel · bare soil · lawn · meadow/pasture ·
crop (per field) · deciduous forest floor · conifer forest floor · heath · dune sand ·
dry beach sand · wet beach sand · mud flat · salt marsh · reed · water · sport surface ·
rail ballast · graveyard · garden`

### 2.3 Shading

- Each class → a CC0 PBR material set (ambientCG / Poly Haven), tri-planar on slopes,
  height-based blending at class borders.
- The cleaned orthophoto becomes a **macro albedo modulation** (low-frequency colour and
  pattern), so every field and lawn keeps its real look and wear – while season, wetness,
  snow, litter and crop stage change the material on top ([06](06-vegetation-seasons.md),
  [09](09-snow-ice-winter.md)).
- Far away (> 2 km), the plain orthophoto/seasonal mosaic is shown (cheaper, and
  correct at that scale).

### 2.4 Roads and paths

Road polygons/lines (ALKIS/ATKIS, GeoDanmark Vejkant/Vejmidte, OSM) → road surface
meshes conforming to the terrain with kerbs and sidewalks; lane markings from the
orthophoto (detected) or rules; drivable beach at Fanø Bad; forest tracks and the
*Wittekindsweg* ridge trail.

## 3. Buildings

### 3.1 Geometry

| Area | Source → model | |
|---|---|---|
| **Lübbecke** | **NRW LoD2** (CityGML 1.0, dl-de/zero-2.0, untextured, standard roof shapes ±1 m, ALKIS function codes – [03 §4](03-data-luebbecke.md#4-buildings-cadastre-topography)). Already served live as **3D Tiles 1.1** by `ogc-api.nrw.de/3dg/v1` – usable directly in M0/M1 for a first look; for the final product: CityGML → 3DCityDB 5 → **pg2b3dm** → own 3D Tiles 1.1 with `EXT_mesh_features` (function, height, roof type) + our roof textures, overhangs and details | ✓ |
| **Fanø** | no national LoD2 → **roofer** (3DBAG, GPL-3, LoD2.2) from DHM point cloud (8 pts/m²) + GeoDanmark footprints → CityJSON → 3D Tiles | ✓ |
| Hero buildings (St.-Andreas-Kirche, Burgmannshöfe, Rathaus / Sønderho Kirke, Sønderho Mølle, Nordby Kirke, ferry terminals) | LoD3 by hand (photos, plans) or photogrammetry (§5) | ~ |

Additions: roof overhangs (LoD2 roofs end at the wall), chimneys and dormers from the
point cloud, solar panels (from the orthophoto), roof windows.

### 3.2 Textures and appearance

- **Roofs**: projected from the cleaned (true-)orthophoto; material class (tiles,
  slate, metal, felt, green roof, **thatch**) from BBR (DK) / image classification (NRW)
  → PBR roof materials with the photo as albedo modulation. Thatch (Sønderho) gets real
  geometry thickness and ridge caps.
- **Facades**:
  - **Fanø**: textured from the **oblique aerial photos** (skråfoto, CC BY 4.0, 4
    directions every 2 years): projective texturing with visibility tests using the
    published camera poses → per-building texture atlas, de-lit like the orthophoto.
  - **Lübbecke**: NRW offers no oblique imagery, and the open **3D-Mesh NRW** (10 cm
    texture) is 2.5D, so its facades are smeared – it serves as roof/colour reference
    and as a far-LOD photoreal layer, not as a facade source. Roofs are textured from
    the **DOP10 true orthophoto** (rectified on the surface model – roofs sit exactly on
    their footprints). Facades are procedural by building function (ALKIS), region and age –
    East-Westphalian red brick and clinker, half-timbering (*Fachwerk*) in the old town,
    plaster, post-war and modern types – with window/door layouts fitted per building
    from street-level images where available (Mapillary/Panoramax, CC BY-SA; own photos
    for the hero streets).
- **Night**: windows lit by function and time of day (residential evening pattern,
  shops, church), interior-mapping shader for depth behind the glass.
- **Picking**: every building carries its feature ID → info card (function, height,
  roof type, year / materials where the register provides them).

## 4. Small things that make it real

| Object | Source | Notes |
|---|---|---|
| Street lamps | OSM / ALKIS / GeoDanmark where mapped; else along roads by rule | lit at night ([08 §8](08-atmosphere-weather-clouds.md#8-shadows-and-lighting)) |
| Traffic signs | Mapillary detections (CC BY-SA), OSM | |
| Fences, walls, hedges | ALKIS / GeoDanmark *Hegn* / OSM + LiDAR | |
| Benches, bins, bus stops, play equipment | OSM | generic models |
| Power lines & poles | OSM + LiDAR (line/pole detection) | catenary curves |
| **Wind turbines** | DE: Marktstammdatenregister; DK: Energistyrelsen turbine register; GeoDanmark *Vindmølle* | hub height, rotor diameter, rotor turns with the wind (cut-in/out) |
| Groynes, dikes, harbour moles, piers, beach huts, buoys and channel markers | GeoDanmark *Dige/Havn*, OSM, nautical data | channel buoys along Grådyb (lit at night) |
| Ships | AIS ([04 §9](04-data-fanoe.md#9-ships--the-ferry-and-the-harbour)) | ferry, fishing boats; canal barges on the Mittellandkanal (inland AIS, if available) |

Out of scope for v1: cars, people, animals ([12 §4](12-roadmap-verification-licences.md#4-out-of-scope-for-the-first-version)).

## 5. Hero spots: photogrammetry and Gaussian splats

Where "ALL details" must hold at eye level, captured reality replaces modelled geometry.

**Decision: no drone capture.** The view from above is covered by the official aerial
products – NRW's 10 cm 3D-Mesh and true orthophoto, Denmark's 12.5 cm orthophotos and
oblique photos (skråfoto, 4 directions) – which are better than a hobby drone survey
anyway. What aerial data cannot give is the **eye-level** detail (facades, doors, signs,
textures of walls and pavements). Two ways, in order of effort:

1. **Default – no own capture**: facades and street detail from the oblique photos (Fanø),
   procedural rules (Lübbecke) and street-level imagery where it exists
   (Mapillary/Panoramax, CC BY-SA – sparse in Lübbecke). The hero spots then get extra
   hand-modelled detail (LoD3 for the landmark buildings, placed street furniture).
2. **Optional – ground-level walk-around capture** (phone or camera, no drone): a few
   hundred photos or a slow 4K video walking around a spot, overcast light. Enough for
   facade-level photogrammetry/splats of a square or a street front (not for roofs –
   those come from the aerial data). Only if and when you want to; nothing depends on it.

| Step | Choice | |
|---|---|---|
| Capture (optional) | ground-level photos/video only, overcast light (less baked shadow); roofs and ground from the aerial products | ~ |
| Reconstruction | **COLMAP 4.2** (BSD, GLOMAP global SfM) or **RealityScan 2.x** (free < $1 M revenue) | ✓ |
| Splat training | gsplat / Brush (licence ?) / commercial tools | ~ |
| Clean-up & LOD packaging | **SuperSplat / splat-transform** (MIT, streamed SOG LOD) | ✓ |
| Format | glTF **`KHR_gaussian_splatting`** (ratified 2026) / SPZ v4 | ✓ |
| Runtime | **three.js r186+ native `GaussianSplat`** (WebGPU compute sort, WebGL fallback; no LOD) for small spots; **Gaussian Splat Lite** (Apache-2.0, WebGPU + streamed LOD, young) for larger scenes; Spark 2.4 is WebGL-only | ✓ |
| Integration | splat volume clips the LoD2/terrain inside its region (clip box/polygon; 3d-tiles-renderer `TileFlatteningPlugin` for the ground), colour-matched to the rendered lighting at the border | ~ |

Caveats: splats bake lighting and season (capture in neutral light; optionally several
seasons for the most important spots; blend toward the dynamic sky with a relighting
approximation), and they are static (moving water and trees inside a splat are frozen –
keep water and big trees as dynamic objects).

Ground-level capture needs no permits on public streets; respect privacy (blur faces and
number plates before publishing – the splat tools can mask them).

Candidate spots (if ground capture is done; otherwise they get LoD3 + placed detail):

- **Lübbecke**: Markt & St.-Andreas-Kirche, Burgmannshöfe, Reineberg castle ruin,
  Wartturm on the Wurzelbrink.
- **Fanø**: Sønderho village core with the mill, Nordby harbour & ferry terminal.

Trees, beach, dunes and salt marsh are *not* splat candidates – they must move with wind,
tide and season, so they stay dynamic geometry.
