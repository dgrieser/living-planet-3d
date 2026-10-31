# 06 · Vegetation and seasons – every tree, every field, every season

[← back to the plan index](README.md)

**Accuracy target (hero areas):** every tree taller than ~3 m stands where the LiDAR saw
its crown (± 1 m), with its measured height and crown size, the right species group, and
the leaf state of the day; every agricultural field shows the crop that was declared for
that year in its growth stage; every lawn, heath, dune and salt marsh has its plant
community and its seasonal colour. Outside the hero areas vegetation is procedural from
global layers ([02 §4](02-data-global.md#4-land-cover-vegetation-phenology-drives-procedural-3d-vegetation-globally)).
**(✓)** verified during research, **(~)** secondary / own design.

---

## 1. Tree inventory from airborne LiDAR (pipeline)

```
LAZ tiles ──PDAL──► ground classification check, height-above-ground (HAG)
          ──────► canopy height model (CHM) 0.25–0.5 m, pit-free
          ──lidR──► tree tops: locate_trees(lmf, variable window ∝ height)
          ──lidR──► crowns: segment_trees(dalponte2016 | li2012 | watershed)
          ──────► per tree: x, y, ground z, height, crown polygon + radius,
                   crown base height (vertical point profile), point density,
                   intensity stats, leaf-on/off of the flight
```

| Tool | Licence | Role | |
|---|---|---|---|
| **lidR 4.2.x** (R) | GPL-3 | tree detection & crown segmentation – production grade | ✓ |
| PDAL 2.10 | BSD | ground, HAG, tiling, COPC | ✓ |
| SegmentAnyTree (RSE 2024), ForestFormer3D (ICCV 2025) | (?) | deep-learning instance segmentation for dense stands (beech crowns merge in a CHM) | ~ |
| PyCrown | GPL-3 | archived 2021 – don't use | ✓ |

Pipeline output is GPL-free data (the tools' licence does not apply to their output).
Quality control: compare tree counts and heights per stand against the forest inventory
where available, and overlay crowns on the orthophoto.

**Urban trees**: street and park trees from a municipal tree register where one exists
([03](03-data-luebbecke.md)), otherwise LiDAR + OSM `natural=tree`; hedges from
ALKIS/ATKIS/GeoDanmark lines and the CHM.

**Hero-spot trees** (market square, church yard, Sønderho lanes): measured by hand
from photos (species, girth, crown form) and placed exactly.

## 2. Species

| Area | Source | Notes | |
|---|---|---|---|
| Lübbecke | **Baumartenklassifikation NRW** (10 m, 10 classes incl. clearings, dl-de/zero) + **Vitalitätsabnahme Nadelwald** (bark-beetle loss 2017→2025) – [03 §5](03-data-luebbecke.md#5-forest-and-trees); cross-checks: Thünen dominant species map (Blickensdörfer et al. 2024, 10 m, CC BY 4.0, 75.5 % overall / 87 % in pure stands), DLR Tree Species Germany 2022 | stand-level prior; the ridge is 26 % beech, 23 % clearings, 15 % spruce | ✓ |
| Fanø | no national species map found → own classifier: Sentinel-2 time series (10 m, phenology curves), CIR orthophoto NDVI, crown shape from LiDAR | the dune plantation is a small number of conifer species + birch/aspen/willow scrub ([04](04-data-fanoe.md)) | ~ |
| both | per-tree refinement: crown shape (conical conifer vs. rounded broadleaf), leaf-off LiDAR penetration (deciduous trees are "transparent" in a winter flight), HR-VPP season dates of the crown pixels, CIR colour | assign each tree the most likely species given the stand prior | ~ |

Species set for v1: beech, oak (pedunculate/sessile), Norway spruce, Scots pine, larch,
birch, ash, sycamore/maple, alder, lime (street trees), poplar, willow, hawthorn/blackthorn
(hedges), mountain pine, Sitka spruce, lodgepole pine (Fanø), fruit trees (gardens),
plus generic "other broadleaf / other conifer".

Special states that are visible in reality and must be modelled: **dead spruce** (bark
beetle stands since 2018 – grey snags or cleared areas, detected from the orthophoto/NDVI
change), storm gaps, young plantations, coppice.

## 3. Tree models and rendering at scale

- **Generator**: **ez-tree** (MIT, `@dgreenheck/ez-tree` 1.1.0, 50+ parameters,
  `generateLODs()`, GLB export) with one calibrated preset per species (branching
  angles, crown shape ratio from allometry, bark textures CC0 from ambientCG); several
  seeded variants per species and size class; Poly Haven CC0 scans for a few hero trees.
  SpeedTree is better but its EULA forbids redistributing trees as assets – not
  compatible with an open repo. (✓)
- **Per-instance attributes** (in `EXT_mesh_gpu_instancing` tiles):
  `speciesId, height, crownRadius, crownBase, seed, health (0 dead … 1 vital),
  phenologyOffset (days), litterFactor`. The shader scales the archetype to the measured
  crown, so each tree has its real size.
- **LOD chain**: full mesh < 60 m → simplified mesh (meshoptimizer) < 150 m → **octahedral
  impostor** (agargaro/octahedral-impostor, MIT) < 2 km → canopy shell / textured CHM
  surface beyond. Dithered cross-fade between levels. Impostors are baked per species ×
  leaf state (5 states) × variant.
- **GPU-driven drawing**: compute culling (frustum + Hi-Z occlusion) writing indirect
  draw args; `BatchedMesh` with indirect draws (r186+); `@three.ez/instanced-mesh` (BVH
  culling, LOD, shadow LOD) as the WebGL2 path.
- **Wind**: *GPU Gems 3 ch. 16* (Crysis) – trunk bending from the local wind vector,
  branch sway, leaf flutter; weights baked into vertex colours by the generator;
  species stiffness; gusts as travelling fronts from the wind field
  ([08 §5](08-atmosphere-weather-clouds.md#5-wind)).
- **Shading**: leaf translucency (thin-surface SSS), wet bark after rain, snow load
  ([09](09-snow-ice-winter.md)), specular glints on wet leaves.

## 4. Ground vegetation

Driven by the material/land-use class map of [05](05-terrain-imagery-buildings.md) (0.25–1 m
in the hero areas):

| Class | 3D content near the camera | Season behaviour |
|---|---|---|
| Lawn / pasture / meadow | compute grass blades (Ghost of Tsushima GDC 2021 technique; port of SimonDev *Quick_Grass*, MIT) with clover/dandelion patches | green; mowing events; drought browning from soil moisture; frost |
| Arable fields | per crop archetype (winter wheat, barley, rye, maize, rapeseed, sugar beet, potatoes, field grass) as instanced plants/rows following the field's tillage direction | crop calendar (§5.4) |
| Forest floor | beech: leaf litter carpet, sparse herbs; conifer: needles, moss, bilberry; ferns, bramble at gaps | litter builds up in autumn; spring geophytes (wood anemone carpets under beech in April before leaf-out) |
| Hedges / field margins | hawthorn, blackthorn, hazel, dog rose | blackthorn white bloom in April, hawthorn in May, hips/berries in autumn |
| Gardens | procedural lawns, shrubs, flower beds, fruit trees from parcel use (residential) | seasonal flowering, bare in winter |
| Heath (Fanø) | heather (*Calluna*), crowberry, grey hair-grass, lichen | **purple bloom Aug–Sep**, brown in winter |
| Dunes (Fanø) | marram grass (wind-combed), lyme grass, sea buckthorn, *Rosa rugosa* scrub | marram bleaches in winter; rugosa pink flowers Jun–Sep, red hips in autumn; sea buckthorn orange berries |
| Salt marsh (Fanø) | glasswort (*Salicornia*), sea lavender, sea purslane, cord grass | glasswort turns red in autumn; sea lavender purple in Jul–Aug |
| Reed / wet margins | common reed | green → straw-coloured, plumes in autumn |
| Raised bog (Großes Torfmoor) | cotton grass, heather, birch scrub, open water | cotton-grass white tufts in May–June |

Scatter: GPU procedural placement à la *Horizon Zero Dawn* (GDC 2017): density maps per
class × noise × slope/moisture rules → compute-generated instance buffers around the
camera (no stored instances for grass and small plants).

## 5. Seasons – the phenology engine (`phenology.js`, `crops.js`)

### 5.1 Drivers

Daily mean/min/max temperature (station data blended with the NWP/ERA5-Land analysis,
downscaled by elevation and urban heat), **exact photoperiod** (from the ephemeris),
soil moisture (ERA5-Land), snow cover. Integrated from 1 Nov of the previous year
([10 §1.4](10-time-ui-interaction.md#14-history-dependent-state-the-land-remembers)).

### 5.2 Models

| Event | Model | Data to fit / validate |
|---|---|---|
| Budburst / leaf-out | thermal time with chilling (sequential/parallel models, `pyPhenology` MIT / `phenor`); beech additionally photoperiod-limited | **DWD phenology observations** (CC BY 4.0) at stations near Lübbecke; PEP725 (registration, no redistribution); Danish observations |
| Leaf colouring & fall | **Delpierre et al. 2009** (photoperiod-triggered, cold-degree-day progression; fitted for *Fagus* and *Quercus*) | DWD phases "Blattverfärbung", "Blattfall" |
| Per-pixel calibration | **Copernicus HR-VPP** start/end-of-season dates (10 m, 2017 → now) → offset per stand/field for past years | ✓ |
| Flowering (heath, rapeseed, hawthorn, …) | thermal time | DWD phases (e.g. heather "Beginn Blüte") |
| Crops | **PCSE/WOFOST** (EUPL-1.2) development stage → height, colour, cover | DWD crop phases; Sentinel-2 NDVI per field |

Validation target: leaf-out and colouring within ± 7 days of observations
(`check-earth-phenology.mjs`). First reference set: DWD annual reporters **Hille (09182)**
and **Wulferdingsen (09187)**, ~10 km from Lübbecke – beech leaf unfolding 8–10 Apr 2024
and 15–25 Apr 2025, 50 % colouring 3–22 Oct, 50 % leaf fall 20 Oct–14 Nov; oak leaf
unfolding 7 Apr 2024 / 10 Apr 2025, leaf fall 18–25 Nov
([03 §8](03-data-luebbecke.md#8-weather-and-climate-dwd-cc-by-40)).

### 5.3 Per-tree state

Each instance gets `leafAmount` (0 … 1), `colourStage` (0 green → 1 peak autumn colour →
1.5 brown/dry) and `marcescent` (young beech and oak keep dry brown leaves through winter –
very visible in the Wiehengebirge hedges and understorey). Individual trees vary around
the stand date by a seeded offset plus microclimate (south slopes and street trees
earlier, frost hollows later). Shaders blend leaf textures per species palette:

| Species | Autumn sequence (design guidance – calibrate with photos/webcams) |
|---|---|
| Beech | green → yellow → orange → copper-brown; young trees marcescent |
| Oak | late; yellow-brown, partly marcescent |
| Birch | early, bright yellow, falls fast |
| Sycamore / maple | yellow (sycamore) to orange-red (Norway maple) |
| Larch | golden in late Oct/Nov, then bare (a deciduous conifer) |
| Lime | yellow, early in dry years |
| Spruce / pine | evergreen, slight winter dulling; pine needle drop in autumn |

Fallen leaves leave the crown: `leafAmount` drops, the canopy becomes see-through
(shadows and light on the forest floor change with it – LiDAR-measured crown
transparency is the leaf-off state).

### 5.4 Fields

The field register gives the **declared crop per field per year** ([03](03-data-luebbecke.md),
[04](04-data-fanoe.md)). `crops.js` holds a calendar per crop (sowing window, emergence,
stem elongation, flowering, ripening, harvest, stubble, tillage, catch crop) whose stages
advance by thermal time. For past years, **harvest and mowing dates per field** are
detected from the Sentinel-2 NDVI time series (sharp drop) and override the model – so the
right fields are golden, cut or ploughed on the right day. Visible highlights: rapeseed
yellow (late April–mid May), maize up to ~3 m by August, wheat golden in July, straw
bales after harvest, brown ploughed fields in autumn, green winter cereals in November.

### 5.5 Leaf litter (`litter.js`)

Each tree's leaf fall is deposited into a litter density map (0.5 m in the hero areas)
with a kernel shifted downwind by the day's wind; litter decays over winter
(species-specific: beech slow, ash/lime fast), is compressed under snow, is cleared on
roads (street cleaning), raked from lawns (procedural) and blown into corners (wind
field). Rendering: a terrain material layer (density → leaf texture blend, colour by
contributing species and age) plus instanced leaf cards near the camera that tumble in
the wind during fall and gusts.

## 6. Outside the hero areas (procedural)

WorldCover class + Meta CHM v2 heights + HRL dominant leaf type → forests with the right
height distribution, density and broadleaf/conifer mix; MCD12Q2 / HR-VPP season dates
drive green-up and colouring; crops from WorldCover "cropland" with a regional generic
calendar. Marked *procedural* in the provenance overlay.
