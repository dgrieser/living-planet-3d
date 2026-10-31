# 09 · Snow, ice and winter

[← back to the plan index](README.md)

**Accuracy target:** on any day, snow lies where it really lay, about as deep as it was
(station-validated), in the patterns that terrain, wind, trees and buildings give it at
1 m; lakes, the canal and the Wadden Sea freeze when they did.
**(✓)** verified during research, **(~)** secondary / own design.

---

## 1. Data drivers

| Scale | Source | Resolution / cadence | Use | |
|---|---|---|---|---|
| Global | **IMS** daily snow & ice (NSIDC G02156) | 1 km, daily | snow mask from space | ✓ |
| Global replay | ERA5-Land snow depth / SWE | 0.1°, hourly, 1950 → now | replay mode | ✓ |
| Europe | Copernicus HR Snow & Ice: fractional snow cover (Sentinel-2) / gap-filled daily | 20 m (~5-day revisit) / 60 m daily | where snow is (and isn't) in the hero areas | ~ |
| Germany | **DWD station snow depth & water equivalent** (daily; nearest with snow: Rahden-Kleinendorf 04063, Bad Salzuflen 04371, Bielefeld-Deppendorf 07106), **SNOWRAS_DE** (daily snow depth 06 UTC, 1 km, Sep–May, from 1950, CDC `grids_germany/daily/snowras_de/`) | stations; 1 km | depth at Lübbecke, replay back to 1950 | ✓ |
| Germany / Denmark forecast | **ICON-D2 `h_snow`, `freshsnw`, `rho_snow`** | 2.2 km, hourly | live/forecast snow | ✓ |
| Denmark | DMI observations (snow depth), DINI forecast | stations; 2 km | Fanø | ~ |
| Sea ice | **BSH ice charts** (German Bight, archive), DMI ice service (?), OSI SAF | daily in ice winters | Wadden Sea ice | ~ |

## 2. Snowpack model (`snowpack.js`)

A light, well-understood model per grid cell (10 m in the hero areas, coarser outside),
stepped hourly from the drivers and **nudged to observations**:

1. **Precipitation phase** from wet-bulb temperature (rain / sleet / snow / graupel; NWP
   precipitation type where available).
2. **Accumulation** as snow water equivalent; fresh-snow density from temperature and
   wind; **compaction** over time.
3. **Melt**: temperature-index + radiation term (enhanced degree-day): sun on the slope
   (exact sun position and terrain/building shadows from the renderer's shadow maps,
   amortised), albedo decay with snow age, rain-on-snow, ground heat.
4. **Assimilation**: if the satellite (HR-S&I) says snow-free, melt out; if the stations
   report depth, scale the field towards it (with the downscaling pattern preserved).

## 3. Downscaling to 1 m

| Process | Rule |
|---|---|
| Elevation | lapse rate → Wiehengebirge crest (~300 m) vs. Lübbecke lowland (~60 m): the ridge is often white while the town is green |
| Aspect / slope | south slopes melt first, north slopes and forest edges keep snow |
| **Wind redistribution** | Winstral S<sub>x</sub> shelter index for the day's wind direction + terrain curvature: scoured ridges and open fields, **drifts in the lee of hedges, buildings, dunes and road cuttings** |
| Canopy interception | conifers hold snow on branches (less on the ground beneath), unload with wind or warmth; leafless broadleaf forests let most snow through |
| Roofs | snow on roofs by pitch (steep roofs shed), **heated roofs melt faster** (proxy: construction year / insulation from ALKIS/BBR), solar panels shed early, roof avalanches leave piles along the eaves |
| Roads & paths | main roads cleared/salted quickly (black, wet), side streets white, ploughed snow banks along road edges, footpaths trodden |
| Urban heat | town centre melts earlier |
| Beach & dunes (Fanø) | salt spray and tides keep the beach and flats snow-free below the high-water line; snow in dune hollows |

## 4. Rendering

- **Coverage**: snow amount per pixel = f(snow-depth map, surface normal · up, an
  **occlusion map rendered from above** (Ohlsson & Seipel 2004) – which also gives snow on
  branches and less snow under spruce).
- **Depth**: displacement/tessellation where depth exceeds a few cm, burying grass,
  rounding edges; drifts as real geometry from the depth map.
- **Material**: snow BRDF with sparkle glints, subsurface scattering, ageing (fresh →
  dirty/compacted → wet/slushy), wet-snow darkening; sastrugi normals on wind-blown fields.
- **Trees**: per-instance snow load (from interception) drives a snow mask on branch tops.
- **Deformable snow** (walk mode): camera-following height render target with compute
  stamping for footprints/tracks (*Batman: Arkham Origins*, GDC 2014; *Rise of the Tomb
  Raider*, GPU Pro 7).
- **Frost & rime**: hoar frost on clear calm nights when the surface temperature drops
  below the dew point (white grass, frosted roofs at sunrise); rime on the ridge forest
  in freezing fog. Icicles: low priority.
- **Snowfall**: flake particles (size by temperature: large wet flakes near 0 °C), slant
  from wind, reduced visibility; blowing snow over open fields in strong wind.

## 5. Ice

| Water body | Model |
|---|---|
| Ponds and lakes | ice thickness from freezing-degree-days (Stefan's law) with snow insulation; clear black ice vs. snow-covered; cracks |
| Mittellandkanal | freezes only in long cold spells and is kept open by shipping/ice breaking – thin broken ice floes along the banks |
| Wadden Sea (Fanø) | in severe winters: ice forms on the flats and in the gullies, **floes strand on the flats at low tide** and drift with the tidal currents; driven by freezing-degree-days, checked against BSH/DMI ice charts for past winters |
| Sea | spray icing on harbour structures in cold storms (detail) |

## 6. Validation

`check-earth-snow.mjs`: snow present/absent at DWD/DMI stations ≥ 90 % hit rate over
recent winters; depth RMSE ≤ 3 cm in shallow-snow winters; Sentinel-2 snow maps of
selected days compared with the downscaled pattern (visual + area overlap).
