# 10 · Time, UI and interaction

[← back to the plan index](README.md)

Everything the simulation shows is a function of **one clock and one place**. This file
defines that clock, the panel (following the repository's *Panel layout* rules in the
root `README.md`), the camera, picking and the readouts.

---

## 1. The simulation clock

### 1.1 One source of truth

```
simTime   : UTC, float64 milliseconds since 1970 (JS Date semantics)
rate      : simulated seconds per real second (0 = paused)
mode      : 'live' | 'replay' | 'forecast' | 'climatology'
```

- `live` – `simTime` follows the wall clock, `rate = 1`, data feeds refresh on their own
  cadence (see [08](08-atmosphere-weather-clouds.md) and [11](11-pipeline-hosting.md)).
  Any scrub or rate change leaves live mode; a **"Now"** button returns to it.
- `replay` – any past instant. Weather from archived analyses / reanalysis, water level
  from the harmonic tide **plus the observed surge** for that date, snow and phenology
  integrated from the archived drivers.
- `forecast` – up to the end of the latest NWP run (IFS HRES +10 days, IFS ENS +15 days,
  GFS +16 days globally; ICON-D2 +48 h, DINI +60 h in the hero areas).
- `climatology` – any date without data (before the archive, beyond the forecast, or the
  visitor typed "2150-07-01"). Tides and astronomy stay exact – they are predictable –
  but weather, snow and leaf state come from a **seeded stochastic weather generator**
  trained on the local climatology, and the UI says so in the readout ("typical weather
  for this date – not an observation").

The mode is derived, not chosen: the clock picks the best mode for `simTime` and the
readout names the source and its age ("ECMWF IFS analysis 30 Oct 12 UTC · radar 12:15").

### 1.2 Time scales

- Ephemerides need TT/TDB (ΔT ≈ 69 s today); astronomy-engine handles UTC → TT internally.
- Tidal arguments use the standard astronomical arguments (Doodson / Schureman) with
  nodal corrections `f, u` updated per day.
- Local time strings come from `Intl.DateTimeFormat` with `Europe/Berlin` (Lübbecke) and
  `Europe/Copenhagen` (Fanø) – both CET/CEST, but keep the zone per place so other places
  can be added.

### 1.3 Rates and presets

| Preset | rate | What it is for |
|---|---|---|
| Real time | 1× | live mode, watching waves and clouds |
| Minute per second | 60× | clouds drift, shadows crawl |
| Tide | 1 800× | one tidal cycle (12 h 25 min) in ≈ 25 s |
| Day | 86 400× | a day in one second (forces cloud "time-lapse" rendering) |
| Season | 2 592 000× | a month per second – leaf-out, colouring, snow seasons |

Above ≈ 600× the wave field switches from simulated phase to a stable statistical look
(otherwise it strobes), cloud motion switches from advection to cross-fading between NWP
time steps, and precipitation particles are replaced by the wet/snow surface state alone.

### 1.4 History-dependent state ("the land remembers")

Some things are not a function of the instant alone:

| State | Depends on | Spin-up |
|---|---|---|
| Snow pack depth / age / wetness | precipitation, temperature, sun, wind since the first snow | from 1 Sep |
| Leaf phenology (bud, leaf, colour, fall) | chilling + forcing degree-days, photoperiod | from 1 Nov of the year before simTime's year (covers this year's leaf-out and autumn); the next season's chilling runs in parallel from 1 Nov |
| Leaf litter on the ground | leaf fall per tree, wind, decay, snow, street cleaning | from 1 Aug two autumns back (beech and oak litter lasts more than a year) |
| Surface wetness, puddles | rain, evaporation (sun, wind, T) | 3 days |
| Crop stage per field | sowing date (crop type), degree-days, harvest detected from Sentinel-2 | from sowing |
| Grass greenness / drought browning | soil moisture | 60 days |
| Sea ice in the Wadden Sea | freezing degree-days | from 1 Nov |

These are integrated **daily** (hourly for wetness) by small pure-JS models
(`snowpack.js`, `phenology.js`, `litter.js`, `wetness.js`, `crops.js`) from compact
daily driver series. For the two hero areas a scheduled job precomputes a
`land-state/<area>/<YYYY-MM-DD>.bin` every day so the client does not have to spin up a
year on load; the client integrates only the hours since the last state file. The file
holds per-area scalars, the per-stand/per-species phenology state and the 10 m snowpack
grid (≈ 1.2 M cells for Lübbecke – a few hundred kB to a few MB compressed). Fine fields
are **not** stored: litter (0.5 m), wetness and 1 m snow are rebuilt on the GPU in tiles
around the camera from the static maps, the per-tree attributes and the driver series. A
0.5 m litter map of the whole Lübbecke box would be 480 M texels, about 7× the largest 2D
texture (8192²).
For `climatology` mode the same models run on generator output.

---

## 2. Panel (follows the repository's *Panel layout*)

`createPanel({ onToggle, onReset: reset, camera: { views: CAMERA_VIEWS, onSelect } })` –
the same header buttons as every other simulation.

### 2.1 Headline controls (always visible)

1. **Date & time** – slider over the day (local time of the current place) with
   **play/pause** inline, plus a date field; a second inline action **"Now"** (returns to
   live mode). A rate selector (the presets above) sits beside the date field.
2. **Place** – preset row: *Globe* · *Lübbecke* · *Fanø* (+ a search field for any
   lat/lon or place name via a geocoder, see [11](11-pipeline-hosting.md)).
3. **Water level** – slider from "real" (the tide/sea level of the moment) down to
   "drained" (−11 000 m), with the circle-arrow reset back to "real". The slider snaps at
   *real*, *mean low water*, *−10 m*, *−50 m*, *−120 m (Last Glacial Maximum)*,
   *−200 m (shelf edge)*, *drained*.

### 2.2 Collapsible section (everything else)

- **Weather source**: *live/archive* (default) · *fair weather* · *custom* – custom unlocks
  sliders for cloud cover, cloud type, wind speed/direction, precipitation, temperature
  offset (a what-if that also drives snow and wave height).
- **What-if extras**: sea-level rise (+0 … +2 m, for the Wadden Sea), "force snow",
  "force leaf state" (spring / summer / autumn / winter) – off by default, flagged in the
  readout when on.
- **Quality**: *Auto* (default, adaptive to frame time) · *Low* · *High* · *Ultra* (the tiers
  of [01 §5](01-architecture.md#5-streaming-budgets)).
- **Camera presets** (one line, same list as the header camera button). Ten views do not
  fit one line, so the list follows the place preset – at most four per place:
  *Globe*: `globe`, `europe` · *Lübbecke*: `luebbecke-overview`, `luebbecke-market`,
  `reineberg` · *Fanø*: `fanoe-overview`, `sonderho`, `nordby-harbour`, `fanoe-beach`.
  `walk` (first person) is a camera mode, not a step of the cycle, so it keeps its own
  button (like axial-tilt's pinned place). This needs a `setCameraViews()` in `lib/ui.js`:
  today `createPanel()` fixes the camera list at creation.
- **Display toggles** (`createViewToggles`, remembered per visitor):
  clouds · precipitation · atmosphere haze · buildings · trees · labels · tide gauge
  overlay · bathymetry tint · depth contours · **data-provenance overlay** (tints every
  surface by where its data came from – *measured* / *modelled* / *generated* – so the
  visitor can see exactly how "real" each pixel is) · wind field arrows · weather map.

### 2.3 Readouts (one `lp-facts` listing)

- **Place**: lat/lon, height above sea level (DHHN2016 NHN / DVR90) and above the
  ellipsoid, ground type (ALKIS / GeoDanmark / land cover class), the object under the
  cursor.
- **Sky**: local time, sun elevation/azimuth, sunrise/sunset, moon phase & altitude.
- **Weather**: temperature, wind (speed, gusts, direction, Beaufort), cloud cover by layer
  and cloud base, precipitation rate and type, snow depth, visibility, data source & age.
- **Water** (when the place has tides): water level vs. DVR90 and vs. chart datum,
  rising/falling, next high and low water (time and height), spring/neap state, observed
  surge, wave height & period.
- **Season**: phenological state of the dominant species in view ("beech: colouring
  60 %"), crop on the field under the cursor and its stage, heath bloom.

### 2.4 Legend, essay, model card

- Legend for the provenance overlay, bathymetry tint and the weather map.
- Essay card: *"How does a digital twin know the world?"* – measured vs. modelled vs.
  generated, and why individual clouds can never be exact.
- Model card (opens with the caveats): data dates (the orthophoto is from a specific
  flight, the LiDAR from a specific year), what is procedural (facade details outside the
  hero spots, individual cumulus clouds, leaf litter positions, people/cars absent), the
  tidal model's validated error, the weather model resolutions.

### 2.5 Attribution

Licences of the data in view are **required** to be shown (CC BY, dl-de/by, Copernicus,
OSM ODbL, GEBCO, SDFI, Geobasis NRW, Google if used, …). A small attribution strip at the
bottom of the canvas lists the providers of every tileset that currently has visible
tiles (each tileset declares its `attribution` in its manifest), plus a "Data sources"
dialog with the full list and licence links. See
[12 · Roadmap, verification, licences](12-roadmap-verification-licences.md#5-licence--attribution-matrix).

---

## 3. Camera and navigation

| Mode | Control | Notes |
|---|---|---|
| Globe orbit | drag rotates the globe, wheel/pinch zooms toward the cursor | `GlobeControls` from 3d-tiles-renderer; zoom speed scales with height above the ground |
| Local orbit | drag orbits a ground pivot, right-drag/2-finger pans, wheel zooms | `EnvironmentControls`; switches in automatically below ~20 km |
| Fly | WASD + mouse look, Q/E down/up, shift = fast | speed ∝ altitude |
| Walk | WASD at 1.7 m eye height, terrain and building collision, jump, run | first-person street view; touch: left stick + look drag |
| Cinematic | spline flights between the camera presets | the camera button cycles these |

- **Seamless zoom**: there is no "mode switch" visible to the visitor – the controls hand
  over by altitude, the near/far planes and depth range adapt every frame
  ([01 · Architecture §3](01-architecture.md#3-coordinates-precision-and-depth)).
- **Collision**: the camera never goes below terrain/water surface unless the water is
  drained or an explicit *underwater* view is chosen.
- **Picking**: a GPU ID pass (or `EXT_mesh_features` feature IDs read back from the
  hit) identifies the building / tree / field / water body under the cursor; the info
  card shows its attributes (building function from ALKIS/BBR, construction year where
  the register has it – BBR, rarely NRW ALKIS,
  tree species/height/crown from the LiDAR inventory, crop from the field register,
  depth from the sea-floor model).
- **Reduced motion**: as everywhere in the app – no auto animation, a static frame on
  demand, the camera still moves.

---

## 4. Module layout (proposal)

```
src/sims/earth/
  index.js            mount(container, meta) → dispose; panel, wiring
  clock.js            simTime, rate, mode selection (pure JS)
  ephemeris.js        sun/moon positions & illumination (wraps astronomy-engine; pure JS)
  geodesy.js          WGS84/ECEF/ENU, ETRS89↔ITRF epoch handling, geoid lookups (pure JS)
  tides.js            harmonic tide prediction, nodal corrections, HW/LW finder (pure JS)
  phenology.js        species leaf-out / colouring / fall models (pure JS)
  snowpack.js         degree-day + energy-balance snow model, downscaling helpers (pure JS)
  crops.js            crop calendar & growth stage per crop code (pure JS)
  weather/            feed clients (NWP tiles, radar, observations), weather generator
  render/             globe, terrain, water, clouds, vegetation, buildings, post (Three.js / TSL)
  workers/            tile decoding, instance culling prep, weather texture assembly
scripts/check-earth-*.mjs   node validation of the pure-JS modules (see file 12)
tools/earth-pipeline/       offline data pipeline (Python + Node; not shipped to the client)
```

The registry entry follows the existing pattern:

```js
{
  id: 'earth',
  titleKey: 'sims.earth.title',            // "Living Earth" / "Lebendige Erde"
  descriptionKey: 'sims.earth.description',
  icon: '🛰️',
  load: () => import('./earth/index.js'),
  hidden: true, // work in progress – only listed when the header toggle is on
}
```

All strings go under `sims.earth.*` in **both** `en.json` and `de.json`.
