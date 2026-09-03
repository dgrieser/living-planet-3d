# Living Planet 3D

Educational, bilingual (English / German) interactive 3D astronomy simulations built with [Vite](https://vite.dev) and [Three.js](https://threejs.org).

**Live demo:** <https://dgrieser.github.io/living-planet-3d/>

## Getting started

```bash
npm install
npm run dev        # start dev server (http://localhost:5173)
npm run build      # production build into dist/
npm run preview    # serve the production build
npm run lint       # ESLint
npm run check:i18n # verify de.json mirrors en.json 1:1
npm run check:prefs # verify the remembered view toggles (src/lib/prefs.js)
npm run check:axial  # validate axial-tilt climate module (habitable fraction vs. tilt, seasonal extremes, verdict tiers)
npm run check:orbits # validate planet-position algorithm against known events
npm run check:hz     # validate habitable-zone physics (zone edges, T_eq, stellar evolution)
npm run check:seasons # validate seasons physics (declination, day length, insolation, calendar mapping)
npm run check:tides   # validate moon-tides physics (2GMR/r³, 1/r³ scaling, spring/neap, periods, tilt models)
npm run check:mag     # validate magnetosphere physics (ram pressure, standoff, boundary fits, field-line deformation, Kp, aurora)
npm run check:galaxy  # validate galactic-zone model (Sun's orbit, zone edges, metallicity gradient, spiral geometry, point cloud statistics, "life on Earth" scalings, haze/dust/globular generators)
```

## Project structure

```
src/
  main.js            router / page loader (hash routes: #/ and #/sim/<id>)
  style.css          global "space" theme, UI kit styles, responsive rules
  i18n/en.json       all English UI strings
  i18n/de.json       all German UI strings (1:1 mirror of en.json)
  lib/i18n.js        t(), tList(), setLanguage(), getLanguage(), onLanguageChange(),
                     applyTranslations(), bindText(), bindAttr(), formatNumber()
  lib/ui.js          UI kit: createPanel, createSlider, createToggle, createStateToggle,
                     createButton, createInfoCard, createNotice, createMessage,
                     createSection, el()
  lib/prefs.js       createViewPrefs(): remembers a simulation's display toggles
                     (legends, labels, helper lines, overlays) in localStorage
  lib/scene.js       scene bootstrap: renderer (DPR ≤ 2), camera, OrbitControls,
                     starfield, resize, delta-time loop, tab-hidden pause,
                     prefers-reduced-motion handling
  lib/webgl.js       WebGL availability check (no Three.js import)
  sims/index.js      simulation registry (lazy-loaded modules)
  sims/<name>/       one folder per simulation
  sims/axial-tilt/   climate.js (seasonal extremes, habitable fraction, verdict tiers, colour ramp – pure JS,
                     built on the seasons physics), index.js
  sims/solar-orbit/  kepler.js (JPL approximate elements, pure JS), planets.js (physical data), index.js
  sims/habitable-zone/ physics.js (zone edges, T_eq, stellar evolution, star relations – pure JS), index.js
  sims/seasons/      physics.js (declination, day length, insolation, energy-balance temperature – pure JS), index.js
  sims/moon-tides/   physics.js (tidal acceleration, equilibrium bulge, spring/neap, Kepler periods, tilt models – pure JS), index.js
  sims/magnetosphere/ physics.js (ram pressure, magnetopause standoff, Shue boundary, dipole lines,
                     field-line deformation, streamlines, Kp-style index, aurora oval – pure JS), index.js
  sims/galactic-zone/ model.js (config object with zone edges, Sun's orbit, metallicity gradient, log-spiral
                     arms, seeded 50 000-point galaxy generator, haze / dust-lane / globular-cluster generators,
                     "life on Earth" neighbourhood scalings – pure JS), index.js
public/textures/     planet textures – Solar System Scope, CC BY 4.0
scripts/
  check-i18n.mjs     key-parity check for locale files
  check-prefs.mjs    validates the remembered view toggles (npm run check:prefs)
  check-axial-tilt.mjs validates the axial-tilt climate module (npm run check:axial)
  check-orbits.mjs   validates kepler.js against equinoxes, oppositions, transits (npm run check:orbits)
  check-habitable-zone.mjs validates physics.js against reference values (npm run check:hz)
  check-seasons.mjs  validates the seasons physics against textbook values (npm run check:seasons)
  check-moon-tides.mjs validates the moon-tides physics (npm run check:tides)
  check-magnetosphere.mjs validates the magnetosphere physics (npm run check:mag)
  check-galactic-zone.mjs validates the galactic-zone model (npm run check:galaxy)
```

## Simulations

| id | Module | Content |
|----|--------|---------|
| `axial-tilt` | Axial tilt & rotation | Tilt a planet's axis (0–90°) while the Sun circles it once per visual year (planet-centric view); lit temperature-band overlay of the seasonal-mean energy-balance temperature per latitude, livable-region view (green border rings + darkened hostile bands), click-to-pin a place (camera follows it with a live latitude/season/temperature readout and a livable verdict), season-stop buttons (Jun/Sep/Dec/Mar), live readouts for the current seasons, the year-round livable surface fraction with a verdict (no / moderate / severe / extreme seasons) and the 45°-latitude summer/winter means – showing that 0° tilt freezes the poles, ~23.4° keeps almost everything livable and 90° turns most of the planet hostile. |
| `solar-orbit` | Earth's orbit & the habitable zone | All 8 planets from JPL Keplerian elements (1800–2050), habitable-zone annulus (0.95–1.37 AU), Earth highlight, hypothetical e = 0.3 orbit, true/visual scale, date picker, camera presets, bilingual planet info cards. |
| `seasons` | Seasons, axial tilt & day length | Earth orbiting an emissive Sun with adjustable tilt (0–90°) and rotation period (6–300 h); shader day/night terminator, insolation heat map, live tropics/polar circles/subsolar point, draggable orbit position with season stops, annual-cycle animation, day-length/insolation/temperature readout for any latitude, bilingual what-if presets (0°, 23.4°, 90°, 300 h, 6 h). |
| `moon-tides` | The Moon & the tides | Two linked views: (A) ocean shell displaced by the equilibrium tide of Moon + optional Sun (spring/neap), adjustable Moon distance 0.5–2× with 1/r³ bulge scaling, rotating Earth with a tide-gauge strip chart; (B) precessing, gently nodding axis with the Moon vs. a clearly flagged schematic chaotic wobble (0–60°) after "Remove Moon". Bilingual moon-size comparison table. |
| `magnetosphere` | Earth's magnetosphere | Dipole field lines (56 curves, L = 2–10) confined below the Shue magnetopause on the dayside and stretched into a magnetotail on the night side, 10 000 GPU solar-wind particles deflecting around the boundary, translucent bow-shock and magnetopause paraboloids, emissive auroral ovals whose radius follows the Kp-style index, density (0–100 cm⁻³) and speed (200–2000 km/s) sliders, "Launch CME" event with a space-weather readout, and a clearly flagged schematic "magnetic field off" mode with atmospheric erosion. |
| `galactic-zone` | The galactic habitable zone | Schematic barred spiral Milky Way from 50 000 GPU points (bar + bulge, four logarithmic arms, Orion spur, HII regions, exponential disc) under a haze of unresolved starlight, with dust lanes drawn as multiplicative extinction on the concave arm edges, a warm nucleus glow and 150 globular clusters in the halo; translucent green habitable annulus (13 000–33 000 ly, configurable), red "hostile core" and blue-grey metal-poor overlays with bilingual hover tooltips, pulsing Sun marker at 27 000 ly with a camera flight from the overview into the Sun's neighbourhood, what-if radius slider with zone status / period / supernova-hazard / heavy-element readouts and a "Conditions in the solar system" box that explains in prose, against today's Earth as the reference, the odds of ozone-damaging supernovae and comet-shower passages, whether the Sun would cross spiral arms here, and what a solar system born here would have got in terms of a Jupiter and radiogenic heat, 230 Myr orbit timeline with play button, arm labels, clearly flagged as schematic. |
| `habitable-zone` | The habitable zone | Adjustable star (M/K/G/F presets, luminosity 0.001–10 L☉) with colour-accurate appearance, draggable planet (0.1–5 AU) whose surface morphs frozen / habitable / scorched from T_eq, live Kopparapu zone (annulus or 3D shell), evolution mode ageing a Sun-like star 0–10 Gyr, orbit grid, temperature labels, bilingual physics card. |

### axial-tilt notes

- Planet-centric frame: the planet sits at the origin, the ecliptic is y = 0 and the Sun (light, disc, glow)
  circles it at radius 40 – the equivalent view of the axis keeping its direction while the planet orbits.
  The axis leans towards +x, so orbit angle θ = 0° is the June solstice; declination `δ = arcsin(sin ε · cos θ)`.
  The terminator ring is kept perpendicular to the current Sun direction.
- The night side shows real city lights (NASA Black Marble data via Solar System Scope's
  `2k_earth_nightmap.jpg`, CC BY 4.0) as the standard material's emissive map; an `onBeforeCompile` patch
  multiplies the emissive term by a smoothstep of the sun direction against the surface normal, so the
  lights fade in across the terminator and vanish in daylight.
- The temperature overlay is a 128-row canvas texture (one row per latitude band) on a slightly larger,
  Lambert-lit sphere: each row is coloured by the seasonal-mean temperature of the seasons energy-balance
  model (`sims/seasons/physics.js`) at the current declination, on a −40 … +60 °C ramp matching the legend.
  Annual-mean insolation per row is cached per tilt.
- `climate.js` derives the headline numbers: seasonal extremes are the solstice means; a latitude band counts
  as livable when its winter mean stays above −25 °C and its summer mean between 0 and 45 °C; the habitable
  fraction is the area-weighted share of livable bands. The model peaks near Earth's tilt (~100 % livable at
  20–35°), drops to ~87 % at 0° (permanently frozen poles) and ~45 % at 90° (Uranus-like extremes; the equator
  even ices over because its annual insolation minimises while ice albedo kicks in). Verdict tiers are
  pedagogical labels over fixed tilt ranges (≤10° / ≤35° / ≤55° / >55°); all displayed numbers come from the model.
- The livable-region view draws `livableBands()` (contiguous livable latitude ranges, edges refined by
  bisection so they move smoothly with the tilt slider) as green latitude rings from a fixed mesh pool and
  darkens the hostile bands with a second canvas-texture sphere; the displayed fraction is the exact band
  area `Δsin φ / 2`, which the check script keeps within 3 % of the sampled area-weighted fraction.
- Clicking the planet (click, not drag) raycasts the surface and pins that place: a marker in the spinning
  group, the camera held above the point every frame (zoom preserved, orbit rotation disabled until unpinned)
  and a live readout of latitude, the hemisphere's current season, the seasonal-mean temperature at the
  current declination and whether the place is livable year-round.

### solar-orbit notes

- Positions use the JPL "Keplerian Elements for Approximate Positions of the Major Planets"
  (Table 1, 1800–2050). Earth uses the Earth–Moon barycenter row. Scene: 1 AU = 10 units,
  ecliptic (x, y, z) → scene (x, z, −y).
- Visual mode exaggerates planet radii ×1000 and the Sun ×30; orbits and positions are always to scale.
- Textures: [Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0) – credited in
  the home footer and inside the simulation.

### habitable-zone notes

- Zone edges (conservative limits, Kopparapu et al. 2013): `d_inner = √(L/1.1) AU`, `d_outer = √(L/0.53) AU`.
  Since the inner/outer ratio is constant, the zone geometry is built once and scaled by √L.
- Equilibrium temperature `T_eq = 278 K · L^¼ / √d`. The surface state is derived from T_eq thresholds
  that coincide with the zone edges (frozen < 237 K, scorched > 285 K), so state and zone always agree.
- Stellar evolution uses Gough (1981): `L(t) = L☉ / (1 + 0.4 (1 − t/4.57 Gyr))` – Earth reaches the inner
  edge at ≈ 5.6 Gyr (≈ 1 Gyr from now).
- Star appearance from main-sequence relations `T_eff ≈ 5778 K · L^0.13`, `M ≈ L^(1/3.5)`, `R = √L (5778/T_eff)²`;
  colours follow a spectral-class ramp (red M dwarfs → blue-white A stars). Star and planet are drawn
  with a minimum on-screen size; distances are to scale (1 AU = 10 units).
- The planet can be dragged in the orbital plane; the pointerdown handler is registered in the capture
  phase and disables OrbitControls for the duration of the drag.

### seasons notes

- Scene: Sun at the origin, ecliptic plane y = 0, Earth orbits counter-clockwise at radius 9 (not to scale).
  The rotation axis leans towards −x, so orbit angle θ = 0° is the June solstice, 90° the September equinox,
  180° the December solstice and 270° the March equinox. Declination `δ = arcsin(sin ε · cos θ)`.
- The orbit is treated as circular; the day-of-year slider maps to θ piecewise-linearly between the real
  equinox/solstice dates (20 Mar, 21 Jun, 22 Sep, 21 Dec) so the season stops land on the right calendar dates.
- Day length uses the geometric horizon: `cos H₀ = −tan φ · tan δ`, day = (H₀/180°) · P. The "polar circle"
  quick button follows the tilt (90° − ε) so it always shows a full polar day/night at the solstices.
- Daily mean insolation `Q̄ = (S₀/π)(H₀ sin φ sin δ + cos φ cos δ sin H₀)` with S₀ = 1361 W/m² drives the
  heat-map shader (computed per fragment from the object-space latitude) and the readout.
- Temperatures are a deliberately simple energy-balance estimate (North 1975 constants A = 203.3 W/m²,
  B = 2.09, C = 3.8 W/m²/K; albedo 0.31 → 0.62 where the annual mean would drop below 0 °C; seasonal excursion
  damped to 60 %). The day–night swing scales with √(P/24 h) and vanishes during polar day/night.
- Camera "Earth" mode follows Earth in its co-rotating frame (camera offset is rotated by Δθ each frame), so
  the Sun keeps its place on screen while the tilt geometry changes through the year. Dragging Earth along the
  orbit freezes the follow and catches up with a short tween afterwards.
- Earth's visual spin (one turn in ≈ 6.7 s at 24 h, scaled by 24 h/P) is decoupled from the annual animation.

### moon-tides notes

- Tidal acceleration `a = 2GMR/r³`; equilibrium bulge height `h₀ = a·R/(2g) = (M/M_E)(R/r)³·R` (Moon today ≈ 0.36 m,
  Sun ≈ 0.16 m, ratio 0.46 – computed from the masses/distances, not hard-coded). The ocean shell is
  `r(n̂) = 1.03 + k·[h₀ₘ·P₂(n̂·m̂) + h₀ₛ·P₂(n̂·ŝ)]` in a vertex shader (`P₂(c) = (3c² − 1)/2`), normals corrected with the
  tangential gradient. `k` is the exaggeration slider (10⁵–10⁷, default 10⁶): the real 0.36 m bulge is 5.6·10⁻⁸ Earth radii,
  so only a factor of about a million makes it visible on a unit sphere. Readouts always show real metres.
- Frame: Sun direction fixed at +x, Moon and Sun in the equatorial plane. Earth spins once per 24 h solar day; the Moon
  moves once per synodic month (Kepler III for other distances: `P_sid = 27.32 d·k^{3/2}`, `1/P_syn = 1/P_sid − 1/yr`),
  so the tide gauge on the equator sees two highs per lunar day (24 h 50 min today). Spring/neap range along the equator:
  `1.5·√(h₀ₘ² + h₀ₛ² + 2h₀ₘh₀ₛ cos 2ε)`.
- The Moon's size relative to Earth (27 %) is always to scale; its distance is compressed (6 units at 1×) unless
  "to scale" is on (60.3 units).
- View B: ecliptic pole = +y. With the Moon the tilt follows `23.3° + 1.2°·sin(2πt/41 kyr)` and the axis precesses
  once per 25,772 yr (cone + fading trace). "Remove Moon" hands over (30 kyr smoothstep) to a **schematic** sum of
  incommensurate sinusoids wandering between 0° and 60° with a 60 kyr time scale, precession slowed 3×; flagged as
  simplified in the UI. Real chaos (Laskar et al. 1993) unfolds over millions of years.
- Removing the Moon also switches off the lunar tide in view A (only the solar tide remains if enabled).

### magnetosphere notes

- Frame: +x points at the Sun (the wind flows towards −x), +y is the dipole axis, +z is dusk. One scene
  unit is one Earth radius and Earth is drawn to scale (radius 1). The dipole is drawn aligned with the
  rotation axis; the real 11° offset, the interplanetary magnetic field, reconnection and the ring current
  are all left out and the physics card says so.
- Dynamic pressure `P = ρv² = n·m_p·v²` (5 cm⁻³ / 400 km/s → 1.34 nPa). Two standoff distances are computed:
  the pressure-balance result `r₀ = [2B₀²/(μ₀·k·P)]^(1/6)` with k = 0.88 (10.5 R⊕ for the quiet wind, quoted in
  the physics card) and the empirical Shue et al. (1997) `r₀ = 11.4·P^(−1/6.6)`, `α = 0.58·(1 + 0.01·P)`, which
  drives the scene (10.9 R⊕ quiet, 4.3 R⊕ at 100 cm⁻³ / 2000 km/s). Bow shock at 1.3·r₀.
- Both boundary surfaces are paraboloids of revolution fitted to the Shue boundary at the nose and the
  terminator (`ρ² = r₀·4^α·(r₀ − x)`, within 11 % on the dayside). Position **and** normal `(c, 2y, 2z)` are
  evaluated in a vertex shader from a fixed (u, v) grid, so changing the wind never rebuilds geometry.
- Field lines start as ideal dipole curves `r = L·cos²λ` and are bent by `deformPoint()`: the radius is mapped
  through `r ↦ r_b·u/(1+u³)^(1/3)` with `u = r/r_b(θ)`, which is the identity near Earth and saturates below the
  boundary, so no line can cross the magnetopause; on the night side x is scaled up with r (tail) and y is
  pressed towards the current sheet (lobes). Both effects are faded out below r = 2 R⊕ so the footpoints stay
  planted on the surface. Rising pressure moves the noon apex from 9.2 to 4.2 R⊕ and the tail from −17 to −63 R⊕.
- Solar wind, CME cloud and escaping atmosphere are three `THREE.Points` objects (10 000 / 4 000 / 1 600)
  whose positions are computed entirely in the vertex shader; a frame costs a handful of uniform writes.
  Streamlines follow `ρ(x) = √(ρ∞² + ρ_mp(x − 0.28·r₀)²)` – adding the obstacle's cross-section can never take a
  parcel inside the magnetopause, and evaluating the boundary 0.28·r₀ sunward makes the flow start turning at
  the bow shock. Particles inside the shock silhouette but outside the magnetopause are drawn hot and larger
  (the compressed magnetosheath). 72 % of the beam sits in a slab around the noon–midnight meridian, because a
  hollow tube of points projects to a filled disc and the split around the boundary would otherwise be invisible.
- "Launch CME": the cloud travels from the Sun sprite to the magnetopause in 3.6 s, then a sheath envelope
  (0.6 s rise, 5.5 s plateau, 8 s decay) multiplies the wind to `n·(1 + 9e) + 6e` and `v·(1 + 1.25e)`. Everything
  else – standoff, Kp, aurora radius and brightness – follows from that single effective wind, so on the quiet
  wind a CME pushes the nose to 5.9 R⊕ (inside geostationary orbit) and the index to Kp 5.6 (G2) within 0.6 s.
- Kp-style index `Kp ≈ 1.5 + 3.3·log₁₀[√(n/5)·(v/400)²]`, capped at 9, bucketed into the NOAA G-scale; the oval's
  equatorward edge follows the NOAA viewline `λ ≈ 66.5° − 2.1·Kp`. Both are labelled as schematic in the UI.
- "Magnetic field off" hides the field lines, boundaries and aurora, sends the particles straight into the
  atmosphere (they are absorbed inside r = 1.045) and releases an escaping-atmosphere plume downwind. Flagged
  as schematic: real atmospheric escape takes hundreds of millions of years.

### galactic-zone notes

- Scene: one unit is 1 000 light-years, the galactic plane is y = 0 and +y is the north galactic pole.
  Azimuth is measured from +x towards +z, which is clockwise seen from above – the sense in which the
  Milky Way rotates when viewed from the north galactic pole. The Sun sits at azimuth −90° (top of the
  overview) on the Orion spur; arms trail, i.e. their azimuth decreases with radius.
- Everything adjustable lives in `DEFAULT_CONFIG` in `model.js`; `createConfig({ zone: { innerKly, outerKly } })`
  changes the habitable-zone edges and the overlays, labels and readouts follow. The dev hook
  `window.__lpGalacticZone.setZoneEdges()` rebuilds them at run time.
- The Sun: 27 kly (≈ 8.3 kpc), 230 Myr per orbit ⇒ v = 2πr/T ≈ 221 km/s; ≈ 20 "galactic years" since it
  formed. The rotation curve is taken as flat, so `T(r) = 230 Myr · r / 27 kly`; the spiral pattern rotates
  rigidly once per 230 Myr (Sun ≈ corotation). Moving the Sun inward therefore makes it overtake the arms on
  the timeline, moving it outward makes it lag – both flagged as schematic in the UI.
- Readouts: heavy elements relative to the Sun from the radial gradient `[Fe/H] ≈ −0.06 dex/kpc · (r − r☉)`
  (≈ 0.47× at 45 kly, 1.8× at 13 kly); "supernova hazard" ∝ stellar surface density of an exponential disc
  with scale length 2.6 kpc (`exp[(r☉ − r)/h]`, ≈ 13× at 5 kly) – an order-of-magnitude teaching number.
- Galaxy: four logarithmic arms `r = r₀·exp(k·Δφ)` with pitch 12.5° (Scutum–Centaurus and Perseus major,
  Sagittarius and Norma minor), pinned by the radius at which each crosses the Sun's azimuth (16 / 21.5 /
  32.5 / 44 kly), plus the Orion spur (22.5–32.5 kly) carrying the Sun. Radii are drawn from Gamma(2, h)
  (the radial pdf of an exponential disc), arm offsets are Gaussian across the arm, the bar/bulge is an
  exponential blob squashed to 0.42 × 0.6 axis ratios and aligned with the major-arm roots. Colours: warm
  bulge, blue-white arm cores, pink HII regions, dim inter-arm disc; brightness fades with radius.
- Rendering: one `THREE.Points` with per-point colour, size and twinkle phase; the vertex shader adds
  perspective sizing, a very faint shimmer and a near-camera fade. Zone overlays are flat radial shaders
  (soft band between two radii, rims, pulsing core) with `depthTest` off so they read as overlays; hit meshes
  on layer 1 drive the tooltips. Labels are canvas sprites; arm labels are children of the rotating group.
- Dressing (all real constituents, placed with the same geometry): a **haze** of 4 000 additive billboards
  (`generateHaze()`: 30 % bulge, 40 % arm ridges at 1.6× the arm width, 30 % exponential disc) stands for
  unresolved starlight; **dust lanes** are 6 000 billboards (`generateDust()`) drawn with custom blend factors
  `Zero / SrcColor` so the fragment is a *transmission* – framebuffer × mix(1, reddening tint, k) – i.e. a
  physical extinction that also dims the background; 60 % sit on the concave (inner) edge of the arms
  (−0.6 arm widths) inside corotation and fade out over the next 5 kly, the rest form a diffuse disc
  5–35 kly with σ_z = 0.3 kly. Both clouds are instanced camera-facing quads sized in kly (point sprites are
  capped at 64 device pixels on some GPUs and pop at the viewport edge); instances within 3–8 kly of the
  camera fade and are moved outside the clip volume, and both thin out when the camera dips into the disc:
  the haze would otherwise stack up along grazing lines of sight, and the dust, which writes no depth, would
  darken foreground stars. The dust shader deliberately skips tone mapping (ACES would darken even a
  clear fragment). Two additive sprites give the **nucleus** its glow; 150 **globular clusters**
  (`generateGlobularClusters()`, ρ ∝ (r² + a²)^(−7/4), a = 6 kly, median ≈ 5 kpc like the Harris catalogue)
  sit in a static spheroidal halo outside the rotating group.
- "Conditions in the solar system" (`neighbourhoodState()`, rendered as prose with every figure in bold) scales published present-day anchors
  (`NEIGHBOURHOOD`) with the same stellar density ρ(r) = exp[(r☉ − r)/h] and metallicity Z(r): nearest-star
  spacing 4.25 ly · ρ^(−1/3) and ≈ 9 000 naked-eye stars · ρ; stellar passages within 1 pc 19.7 per Myr · ρ
  (Bailer-Jones et al. 2018), Oort-cloud edge ∝ ρ^(−1/3); ozone-damaging supernovae within 8 pc 1.5 per Gyr ·
  hazard (Gehrels et al. 2003); giant-planet occurrence 10^(2·[Fe/H]) = Z² (Fischer & Valenti 2005); arm
  crossings every 2π / (4 · |Ω(r) − Ω_p|) – never at corotation, shown as "practically never" above 1 Gyr;
  the odds are quoted as the chance of at least one event in any 100 Myr, 1 − exp(−100/T). The birthplace
  paragraph switches on metallicity (≥ 1.1 rich, ≤ 0.9 poor): metal-rich
  systems favour giants that migrate inward, so a far-out Jupiter is less likely to repeat, and more U/Th means
  a hotter interior; metal-poor the reverse. The text states that Earth's orbit, year, seasons and sunlight are
  set by the Sun and do not change. All rows inherit the schematic caveat and are checked at 13 / 27 / 33 kly by `check:galaxy`.

## Adding a simulation

1. Create `src/sims/<name>/index.js` with a default export
   `mount(container, meta) => dispose` (may be async).
2. Use `createScene()` from `lib/scene.js` and the components from `lib/ui.js`.
3. Add all UI strings under `sims.<camelName>` in **both** `en.json` and `de.json`.
   Run `npm run check:i18n` to verify parity.
4. Register the module in `src/sims/index.js`.
5. Split the panel's initial state: simulation parameters go in `DEFAULTS`, display
   toggles in `VIEW_DEFAULTS` (see *Remembered view* below).

## Remembered view

Display toggles – legends, labels, helper lines, overlays, heat maps – are remembered
per visitor so a reload or a trip back to the overview keeps the view they set up.
Simulation parameters (tilt, date, speed, luminosity, playing, …) are deliberately not
remembered: every visit starts from the teaching defaults.

- Each simulation therefore splits its initial state into two frozen objects:
  `DEFAULTS` (simulation) and `VIEW_DEFAULTS` (display). `createViewPrefs(meta.id,
  VIEW_DEFAULTS)` from `lib/prefs.js` hydrates the display half, and the toggles are
  built with `createStateToggle({ labelKey, state, name, prefs, onChange })` so state,
  storage and checkbox stay in sync.
- Storage is `localStorage`, one JSON entry per simulation under `lp-view:<sim-id>`.
  Unknown, retyped or corrupt entries fall back to the defaults, and a blocked
  `localStorage` (privacy mode) degrades to in-memory only. `npm run check:prefs`
  covers all of that.
- **Reset** restores the simulation defaults only; the remembered view survives it.
  That falls out of the split, since `Object.assign(state, DEFAULTS)` no longer
  mentions the display keys.

## Bilingual UI rules

- Language toggle **EN | DE** lives in the header of every page.
- Default language is detected from `navigator.language` (`de*` → German, otherwise English)
  and persisted in `localStorage` under `lp-lang`.
- Every user-facing string – including `aria-label`s, slider units and tooltips – must come
  from the i18n JSON files. Bind DOM text with `bindText(el, key)` / `data-i18n`, attributes
  with `bindAttr(el, { 'aria-label': key })`, and subscribe to `onLanguageChange()` for
  dynamically formatted values.
- German strings use standard technical terminology (Achsneigung, Rotationsgeschwindigkeit,
  Umlaufbahn, Bewohnbare Zone, Gezeiten, Magnetfeld, Sonnenwind, Milchstraße, …).

## Quality bar

- Target 60 fps on a mid-range laptop; `devicePixelRatio` capped at 2.
- Touch support via OrbitControls; the control panel collapses on small screens.
- `prefers-reduced-motion`: animation is paused and a static frame is rendered on demand;
  the view can still be rotated and zoomed.
- Graceful bilingual fallback message when WebGL is unavailable.
- Dark space theme; semi-transparent panel with WCAG AA contrast.

## Deployment

Every push to `main` runs [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml),
which lints, builds and publishes `dist/` to GitHub Pages. The workflow can also be started
manually from the *Actions* tab (`workflow_dispatch`).

Pages must be configured once in **Settings → Pages → Build and deployment → Source:
GitHub Actions**.

The Vite `base` is `'./'`, so all assets are referenced relatively and the build works both at
a domain root and under the `/living-planet-3d/` project-page path. Routing is hash based
(`#/sim/<id>`), so deep links need no SPA 404 fallback.

## Licence

The code in this repository is released under the
[BSD Zero Clause License](LICENSE) (SPDX `0BSD`) – use, copy, modify and
redistribute it for any purpose, with no attribution and no notice-retention
requirement.

Two things in the tree are **not** covered by that grant and keep their own terms:

- `public/textures/` – planet and Sun maps by
  [Solar System Scope](https://www.solarsystemscope.com/textures/), licensed
  **CC BY 4.0**. Reusing them requires keeping the attribution (already shown in
  the home footer and inside each simulation).
- `three` and the other npm dependencies, which ship under their own licences
  (Three.js is MIT).
