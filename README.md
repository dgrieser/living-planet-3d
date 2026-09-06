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
npm run check:axial  # validate axial-tilt physics (declination, day length, insolation, calendar mapping) and climate module (habitable fraction vs. tilt, seasonal extremes, verdict tiers)
npm run check:orbits # validate planet-position algorithm against known events
npm run check:hz     # validate habitable-zone physics (Kopparapu flux limits, zone edges, T_eq, stellar evolution, true sizes)
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
  lib/ui.js          UI kit: createPanel, createPanelShift, createSlider, createToggle,
                     createStateToggle, createButton, createInfoCard, createNotice,
                     createMessage, createSection, createCollapsibleSection,
                     createControlRow, createIcon() / ICONS (line icons), el()
  lib/prefs.js       createViewPrefs(): remembers a simulation's display toggles
                     (legends, labels, helper lines, overlays) in localStorage
  lib/scene.js       scene bootstrap: renderer (DPR ≤ 2), camera, OrbitControls,
                     starfield, resize, delta-time loop, tab-hidden pause,
                     prefers-reduced-motion handling, setViewShift() (slides the
                     picture sideways out from under an overlaying panel)
  lib/webgl.js       WebGL availability check (no Three.js import)
  sims/index.js      simulation registry (lazy-loaded modules)
  sims/<name>/       one folder per simulation
  sims/axial-tilt/   physics.js (declination, day length, insolation, energy-balance temperature – pure JS),
                     climate.js (seasonal extremes, livable bands & fraction, verdict tiers, colour ramp – pure JS,
                     built on physics.js), index.js
  sims/solar-orbit/  kepler.js (JPL approximate elements, pure JS), planets.js (physical data), index.js
  sims/habitable-zone/ physics.js (Kopparapu flux limits & zone edges, T_eq, stellar evolution, star
                     relations, radius↔luminosity inverse for the star drag, surface-state ramps, true
                     radii – pure JS; solar-orbit imports the Sun's zone edges from here), index.js
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
  check-axial-tilt-physics.mjs validates the axial-tilt physics against textbook values (npm run check:axial)
  check-axial-tilt-climate.mjs validates the axial-tilt climate module (npm run check:axial)
  check-orbits.mjs   validates kepler.js against equinoxes, oppositions, transits (npm run check:orbits)
  check-habitable-zone.mjs validates physics.js against reference values (npm run check:hz)
  check-moon-tides.mjs validates the moon-tides physics (npm run check:tides)
  check-magnetosphere.mjs validates the magnetosphere physics (npm run check:mag)
  check-galactic-zone.mjs validates the galactic-zone model (npm run check:galaxy)
```

## App header

Brand on the left, and on the right three controls of the same round, icon-sized shape
(`.lp-icon-btn`): the way back to the overview – a house, shown only on a simulation page –
the EN/DE language pill and the lab flask that lists the work-in-progress simulations. The
house, the flask and the camera in the panel header are stroked line icons from `ICONS` in
`lib/ui.js` (`createIcon('home')`), drawn on a 24 grid; everything else in the UI keeps its
emoji glyph. They are balanced by eye rather than by their bounding box – the eye centres on
the body of a shape (the camera's back, the flask's cone, the walls of the house) and lets
the light bits above it overhang – so a "technically centred" icon that reads as sitting low
is wrong. Being icon-only, each one carries its name as `aria-label` and `title`, translated
like every other string.

## Panel layout

Every simulation's control panel follows the same order, so a visitor who learns one
finds their way around the next:

1. **The headline controls**, visible as soon as the panel opens – the slider, switch
   or preset row the simulation is actually about (habitable-zone keeps three: the
   planet's distance, the star's temperature and its radius). Where a slider has an obvious
   companion action, it sits inline on its right as a small icon-sized button
   (`createControlRow()` plus `compact: true`): play/pause for a timeline, "back to
   today", "remove the Moon". A full-width action gets `slim: true` so it stays one
   line tall, and a preset row that has to hold four labels up top uses
   `lp-presets--tight` (tiny type, small swatch, four-up even on a phone).
2. **One collapsible section** with every remaining control – secondary sliders,
   preset rows, the camera presets on one line, the display toggles and the overall
   reset (full width) – folded away by default on small screens
   (`createCollapsibleSection()`).
3. **The readouts**: the status box, then its follow-up stats – one `lp-facts` listing,
   not a stack of boxes. A control whose readout is only readable beside it (moon-tides'
   tide gauge) travels with that readout as one block instead of moving up into the fold.
4. **The legend**, then the essay card, and last the physics / model card, which opens
   with the schematic caveats that qualify the numbers above it. Live warnings – the
   magnetic field is off, the Moon is gone, the date is out of range – stay next to the
   control or readout they describe.

### The camera button in the panel header

Every simulation's panel header carries a camera button next to the collapse chevron, and it
is there whether the panel is open or collapsed – so the views stay one press away while the
panel is out of the way. Each press steps to the next view in the simulation's list and the
header names it for about two seconds, in place of the "Controls" title, before fading back.
The panel keeps no camera state of its own: the simulation reports every change – its own
preset row, a click in the scene, a reset – so the button stays in step, and a view the
visitor set up by hand simply leaves no view marked as active, with the next press carrying
on from the last preset. One list per simulation wires it up:

```js
const CAMERA_VIEWS = Object.freeze([
  { id: 'overview', labelKey: `${KEYS}.controls.cameraOverview`, icon: '🌌' },
  { id: 'sun', labelKey: `${KEYS}.controls.cameraSun`, icon: '☉' },
]);
const panel = createPanel({
  onToggle: () => viewShift.sync(),
  camera: { views: CAMERA_VIEWS, onSelect: (id) => setCamera(id) },
});
...
panel.setCameraView(cameraMode, { announce });   // from the simulation's syncCameraButtons()
```

The same list builds the preset row inside the panel, so the two can never drift apart. Views
that are not a step of the cycle stay off the list and keep their own button: axial-tilt's
"pinned place" (it only exists while a place is pinned) is one.

Below 720 px the panel is a bottom sheet, and there its header doubles as a drag handle
(the grip above the title): press it and pull to resize the sheet anywhere between closed
and the full height of the canvas, and it stays where it is let go. Releasing within 56 px
of the default height (70 % of the canvas) or of the closed position snaps to it, and
pulling a closed sheet upwards opens it. A press that starts on one of the header's buttons
never drags, so the chevron and the camera button keep working as buttons.

Above the breakpoint the panel floats over the top-right corner of the canvas, and every
simulation slides its picture out from under it: while the panel is open the projection is
offset to the left by half of what the panel covers, so the subject sits centred in the free
part of the canvas. It is a projection offset, not a camera move – the camera, its orbit
target and picking all stay where they are – it animates over 420 ms, and it is skipped when
less than 480 px of canvas would be left over. One line per simulation wires it up:

```js
const viewShift = createPanelShift({ sim, viewport });          // lib/ui.js
const panel = createPanel({ onToggle: () => viewShift.sync() });
container.append(panel.el);
viewShift.attach(panel);                                        // measures from here on
disposers.push(viewShift.dispose);
```

## Simulations

| id | Module | Content |
|----|--------|---------|
| `axial-tilt` | Axial tilt, seasons & day length | Earth orbiting an emissive Sun with adjustable tilt (0–90°) and rotation period (6–300 h); shader day/night terminator with real city lights on the night side, switchable overlays for the insolation heat map or the seasonal-mean temperature bands (energy-balance model per latitude), livable-region view (green border rings + darkened hostile bands), live tropics/polar circles/subsolar point, draggable orbit position with season stops, annual-cycle animation, day-length/insolation/temperature/seasonal-extremes/climate-zone readout for any latitude, click-to-pin a place (camera follows it, readout switches to its latitude, livable verdict), year-round livable surface fraction with a verdict (no / moderate / severe / extreme seasons), camera modes Earth / overview / top / pinned place, bilingual what-if presets (0°, 23.4°, 90°, 300 h, 6 h). |
| `solar-orbit` | Earth's orbit & the habitable zone | All 8 planets from JPL Keplerian elements (1800–2050), habitable-zone annulus (0.95–1.68 AU, shared with the habitable-zone simulation), Earth highlight, hypothetical e = 0.3 orbit, true/visual scale, date picker, camera presets, bilingual planet info cards. |
| `moon-tides` | The Moon & the tides | Two linked views: (A) ocean shell displaced by the equilibrium tide of Moon + optional Sun (spring/neap), adjustable Moon distance 0.5–2× with 1/r³ bulge scaling, rotating Earth with a tide-gauge strip chart; (B) precessing, gently nodding axis with the Moon vs. a clearly flagged schematic chaotic wobble (0–60°) after "Remove Moon". Bilingual moon-size comparison table. |
| `magnetosphere` | Earth's magnetosphere | Dipole field lines (56 curves, L = 2–10) confined below the Shue magnetopause on the dayside and stretched into a magnetotail on the night side, 10 000 GPU solar-wind particles deflecting around the boundary, translucent bow-shock and magnetopause paraboloids, emissive auroral ovals whose radius follows the Kp-style index, density (0–100 cm⁻³) and speed (200–2000 km/s) sliders, "Launch CME" event with a space-weather readout in the panel (Kp, storm phase, boundary distances, aurora reach, geostationary exposure), and a clearly flagged schematic "magnetic field off" mode with atmospheric erosion. |
| `galactic-zone` | The galactic habitable zone | Schematic barred spiral Milky Way from 50 000 GPU points (bar + bulge, four logarithmic arms, Orion spur, HII regions, exponential disc) under a haze of unresolved starlight, with dust lanes as Beer–Lambert extinction on the concave arm edges, a warm nucleus glow and 150 globular clusters in the halo; translucent green habitable annulus (13 000–33 000 ly, configurable), red "hostile core" and blue-grey metal-poor overlays with bilingual hover tooltips, pulsing Sun marker at 27 000 ly with a camera flight from the overview into the Sun's neighbourhood (click the Sun or the galactic centre to fly to either view), what-if radius slider with zone status / period / supernova-hazard / heavy-element readouts and a "Conditions in the solar system" box that explains in prose, against today's Earth as the reference, the odds of ozone-damaging supernovae and comet-shower passages, whether the Sun would cross spiral arms here, and what a solar system born here would have got in terms of a Jupiter and radiogenic heat, 230 Myr orbit timeline with play button, arm labels, clearly flagged as schematic. |
| `habitable-zone` | The habitable zone | Adjustable star set by its two physical properties – effective temperature (2600–7200 K) and radius, with the luminosity following from `L = R²T⁴`, so it can be pulled off the main sequence into a subgiant or a giant – with M/K/G/F presets, a colour-accurate photosphere (granulation, sunspots, faculae, limb darkening, flares on M dwarfs) and an animated corona, dragged up and down (mouse or touch) for its type, carrying temperature, size and brightness together along the main sequence, with a slider to inflate it off that sequence into a subgiant or giant; draggable planet (0.1–5 AU, grabbed by its offset and eased towards the pointer) that spins and morphs from T_eq between a snowball (sea ice with refrozen leads, snow-covered continents, blowing snow), the real Earth (day map + city lights on the night side, as in axial-tilt) and a Venus-like cloud world that burns off into a lava world — and morphs as a climate does, the ice closing in from the poles and the scorched ground spreading from the equator behind a ragged front with steam where the oceans boil, ending in a crust of drifting plates over convecting lava seas with flaring vents; live Kopparapu zone (T_eff-dependent flux limits, so the zone is not a plain √L scaling) with a master toggle and flat-annulus / 3D-shell sub-toggles, three camera modes on one row — "frame zone" keeps star, planet and zone in view by itself (re-framing on pointer up / touch release), "planet" rides along with the planet for a close-up with the star in the distance behind it, "overview" hands the camera back — Kelvin / °C / both unit switch for star and planet, evolution mode ageing a Sun-like star 0–10 Gyr, orbit grid, temperature labels, an overall speed slider (0–5×) that scales every animated element, bilingual physics card. |

### axial-tilt notes

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
- The night side shows real city lights (NASA Black Marble data via Solar System Scope's
  `2k_earth_nightmap.jpg`, CC BY 4.0): the Earth shader adds the night map scaled by the complement of its
  day factor, so the lights fade in across the terminator and vanish in daylight.
- The temperature bands are a 1 × 128 `DataTexture` (one texel row per latitude) sampled by the Earth shader
  at the fragment's latitude: each row is coloured by the seasonal-mean temperature of the energy-balance model
  at the current declination on a −40 … +60 °C ramp matching the legend. Annual-mean insolation per row is cached
  per tilt; the texture is only rewritten when tilt, rotation period or declination change. Heat map and
  temperature bands are exclusive toggles (same hue ramp, different meaning).
- `climate.js` derives the headline numbers: seasonal extremes are the solstice means; a latitude band counts
  as livable when its winter mean stays above −25 °C and its summer mean between 0 and 45 °C; the habitable
  fraction is the area-weighted share of livable bands. The model peaks near Earth's tilt (~100 % livable at
  20–35°), drops to ~87 % at 0° (permanently frozen poles) and ~45 % at 90° (Uranus-like extremes; the equator
  even ices over because its annual insolation minimises while ice albedo kicks in). Verdict tiers are
  pedagogical labels over fixed tilt ranges (≤10° / ≤35° / ≤55° / >55°); all displayed numbers come from the model.
  The readout also shows the summer/winter means and the livable verdict for the selected latitude.
- The livable-region view passes `livableBands()` (contiguous livable latitude ranges, edges refined by
  bisection so they move smoothly with the tilt slider) to the shader as up to four `[lo, hi]` uniforms, which
  darken every latitude outside them, and draws the band edges as green latitude rings from a fixed pool; the
  displayed fraction is the exact band area `Δsin φ / 2`, which the check script keeps within 3 % of the
  sampled area-weighted fraction.
- Panel: the tilt slider up front, everything else folded away – rotation period, the what-if presets, the
  year & orbit group and, under "Readout for one latitude", the latitude slider with its four presets, which
  pick the latitude every per-latitude figure describes. The readouts are one verdict box plus one table: the
  box carries the year-round livable surface fraction with its verdict tier and, under a hairline, what the
  chosen latitude makes of that tilt (climate zone with its hint, livable year-round); the table lists every
  figure in reading order – the year for the planet as a whole (season, subsolar latitude, tropics, polar
  circles), then the chosen latitude (pinned place, day length, midnight sun, polar night, insolation,
  temperature, day/night, seasonal means). Two rows carry more than a number: the pinned place its release
  button, the day length its polar-day / polar-night pill.
- Camera modes: "Earth" follows Earth in its co-rotating frame (camera offset is rotated by Δθ each frame), so
  the Sun keeps its place on screen while the tilt geometry changes through the year – the planet-centric view
  in which the Sun appears to circle Earth once a year; "overview" and "top" look at the whole orbit. Dragging
  Earth along the orbit freezes the follow and catches up with a short tween afterwards.
- Clicking Earth (a press that moves less than 6 px) raycasts the surface and pins that place: a marker in the
  spinning group, the latitude slider and every per-latitude figure jump to it, and the fourth camera mode
  "pinned place" holds the camera above the point every frame (zoom preserved, orbit rotation disabled, follow
  frozen during an orbit drag). The latitude slider and presets slide the pin along its meridian; a click on
  the sky, the Unpin button or Reset release it and return to the previous camera mode.
- Earth's visual spin (one turn in ≈ 6.7 s at 24 h, scaled by 24 h/P, capped at 30°/s while the camera rides on
  a pin) is decoupled from the annual animation.
- The former `seasons` simulation was merged into this one; `#/sim/seasons` redirects to `#/sim/axial-tilt`.

### solar-orbit notes

- Positions use the JPL "Keplerian Elements for Approximate Positions of the Major Planets"
  (Table 1, 1800–2050). Earth uses the Earth–Moon barycenter row. Scene: 1 AU = 10 units,
  ecliptic (x, y, z) → scene (x, z, −y).
- Visual mode exaggerates planet radii ×1000 and the Sun ×30; orbits and positions are always to scale.
- Textures: [Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0) – credited in
  the home footer and inside the simulation.

### habitable-zone notes

- Zone edges (conservative limits, Kopparapu et al. 2014, Table 1, 1 M⊕): `d = √(L / S_eff) AU` with the
  flux limit itself a quartic in the star's temperature, `S_eff = S_☉ + a·T* + b·T*² + c·T*³ + d·T*⁴`,
  `T* = T_eff − 5780 K` — runaway greenhouse (inner) and maximum greenhouse (outer), 1.107 and 0.356 S☉ for
  the Sun, i.e. **0.95–1.68 AU**. The fit is valid for 2600–7200 K and is held at those ends outside them
  (the luminosity range reaches ≈ 2350 K and ≈ 7800 K). Because a planet absorbs a red star's light more
  readily, both limits fall for cooler stars: an M dwarf's zone sits 10–20 % farther out than a plain √L
  scaling of the solar values gives. The two edges therefore move independently — the annulus is a unit
  disc whose shader drops everything inside the inner/outer ratio, and the edge loops and shells are unit
  geometry scaled to each radius, so nothing has to be rebuilt while the star is dragged.
- Equilibrium temperature `T_eq = 278 K · L^¼ / √d`, for albedo 0 and no greenhouse effect — a radiative
  balance, not a surface temperature (Earth's albedo of 0.3 puts its equilibrium temperature at 255 K, and
  its greenhouse effect lifts the surface to 288 K). The surface state is derived from T_eq thresholds that
  coincide with the zone edges (215 K and 285 K around the Sun, ≈ 20 K lower around an M dwarf), so state
  and zone always agree whatever the star.
- Stellar evolution uses Gough (1981): `L(t) = L☉ / (1 + 0.4 (1 − t/4.57 Gyr))` – Earth reaches the inner
  edge at ≈ 5.6 Gyr (≈ 1 Gyr from now).
- The star is described by the two quantities the visitor sets, its effective temperature and its
  radius; its luminosity follows from the Stefan–Boltzmann law, `L/L☉ = (R/R☉)² (T_eff/T☉)⁴`, exactly
  rather than by a fit. That is what lets it leave the main sequence: at one temperature a larger star
  is a brighter one, and the radius relative to the main-sequence radius of the same temperature gives
  the luminosity class shown in the readouts (< 0.7 below the main sequence, ≤ 1.4 dwarf V, ≤ 4 subgiant
  IV, above that giant III — a schematic reading of an ordering that is really taken from a spectrum).
  The main-sequence relations `T_eff ≈ 5778 K · L^0.13`, `M ≈ L^(1/3.5)`, `R = √L (5778/T_eff)²` remain
  the reference for the presets, for that class and for the mass; colours follow a spectral-class ramp
  (red M dwarfs → blue-white A stars). Distances are to scale (1 AU = 10 units).
- **Mass is an assumption off the main sequence**, and is flagged as one: temperature and radius do not
  determine it (a star swells at constant mass), so the simulation uses the mass of the main-sequence
  star of the same temperature. It enters only Kepler's third law, and a real giant is heavier, so its
  orbital periods would come out shorter than shown.
- What the two controls may reach: the temperature range is exactly the 2600–7200 K over which
  Kopparapu's flux-limit fit is valid, so the zone is never extrapolated; the radius runs from half the
  main-sequence radius (nothing real sits between the main sequence and the white dwarfs) up to whatever
  keeps `L ≤ 10 L☉` — beyond that the zone would lie outside the farthest orbit the planet can be dragged
  to. The ceiling depends on the temperature, so the radius slider's own bounds move with it: a red star
  reaches ≈ 10 R☉ (a giant), a 7200 K one only ≈ 2 R☉. A "back to the main sequence" button next to the
  slider restores the radius for the current temperature.
- Both bodies are built from their true radii times a stated exaggeration, rather than from a made-up
  size: `1 R☉ = 0.00465 AU` and `1 R⊕ = 4.26·10⁻⁵ AU`, the planet fixed at 375× and the star at the
  "Star size" setting — 1× is true to scale (a dot), the default 11× reproduces the previous drawing, up
  to 60×. It is a remembered *display* preference: the physical radius, the zone and every temperature are
  untouched, the physics card states the current factor, and the star readouts carry the star's true
  angular diameter as seen from the planet (0.53° for the Sun from Earth, ≈ 1.1° for an M dwarf from the
  middle of its zone). The planet's 375× follows the project's convention of exaggerating planets about
  30× more than their star (solar-orbit uses ×1000 and ×30), which is why a red dwarf and the planet come
  out at a similar size on screen.
- The planet can be dragged in the orbital plane; the pointerdown handler is registered in the capture
  phase and disables OrbitControls for the duration of the drag. The planet **eases** towards where the
  gesture puts it over a 130 ms time constant on real time, which takes the twitch out of a control that
  spans two and a half decades of temperature; a flick released mid-flight coasts to a stop, the catch-up is
  capped at 3.5 AU/s, and the orbital motion waits until it has landed.
- **The gesture is read in a frame fixed when the planet is picked up** (`planetDragFrame()`), not by asking
  every move where the pointer meets the orbital plane. One measurement at the planet — how far it travels
  outwards along its radius, and around its orbit, per pixel of pointer travel — inverted into a 2×2 map from
  screen pixels to the plane. Reading the plane afresh under the pointer is what made this gesture wild, and
  every one of these was a symptom of it:
  - a view lying near the orbital plane makes a pixel worth astronomical units towards the horizon, and
    nothing at all past it, where the drag simply stopped responding;
  - a pointer crossing the star reverses the direction it means, flipping the planet to the far side — and a
    guard that froze only the angle there let the distance walk the planet back out the way it came;
  - in the close-up the camera rides along with the planet, so moving the planet moved the ground under the
    finger with it.

  Measured once, none of that can happen: the gesture is the same everywhere on the screen and reversible —
  drag out, drag back, and the planet returns where it started.
- **The gain is capped at the whole range per 1.4 canvas heights of travel.** Pointing at a place in the plane
  is only as precise as the view is roomy, and a phone squeezes the whole system into a few hundred pixels,
  where a nudge swept the planet across the zone. Zoomed-in views (the close-up, or the zone framed tightly
  around a close orbit) are already finer than that and drag one-to-one; the wide ones are slowed to something
  steerable — on a phone framing 1.5 AU, to about a quarter of the raw rate.
- **Hit spheres are sized in screen pixels** (22 px radius for the planet, 26 for the star), not as a fraction
  of the viewing distance: what makes a body grabbable is how big it is under a fingertip, and a phone's canvas
  is a third the height of a desktop's. Both are generous, and an orbit near the inner limit puts the planet
  *inside* the star's, where the ray meets the star first — grabbing the planet dragged the star instead. The
  planet is the small target and wins wherever the two overlap, unless it has gone behind the star's drawn disc.
- The ease lands on its target rather than approaching it forever, and with motion reduced there are no frames
  to ease over, so the drag tracks the pointer exactly and redraws on the spot.
- The star is dragged **up and down**, and that one axis moves the whole star: up towards hotter, larger
  and brighter, down towards cooler, smaller and fainter, the way the types follow one another along the
  main sequence. Sideways movement is ignored, so the gesture cannot be pulled off course. What it holds
  fixed is the star's place relative to the main sequence — the radius keeps its ratio to the
  main-sequence radius of the temperature under the pointer — so a dwarf stays a dwarf and a giant stays a
  giant while its type changes; taking a star off the sequence in the first place is the radius slider's
  job. The axis is log-linear in temperature, with the gain taken from the canvas (60 % of its height
  covers the whole range, clamped to a 260–900 px travel) so one comfortable sweep works on a phone as
  well as on a desktop. Dragging leaves evolution mode, as the sliders do.
- **Nothing is rescaled by the camera.** Both bodies are drawn at their own exaggeration and keep it at
  every zoom, so a bigger star reads as a bigger star instead of the whole picture growing, and the
  planet does not swell when the star does or when the fit mode pulls the camera back. That is what used
  to hide the size difference between star types: the old drawing floored the star at 0.9 % of the
  viewing distance and capped it at 0.8 units, which squeezed an M dwarf and a G star to nearly the same
  disc. Legibility is carried by things that cost nothing physically instead: the star's screen-space
  halo, and the planet's name and temperature labels, which mark it when it is only a speck. Only the
  invisible hit spheres stay generous, so both bodies remain easy to grab; the rings around them are a
  drag/hover cue and nothing else.
- The camera has three modes (`cameraMode`, a remembered preference, `fit` by default), one per button on
  the camera row; switching into one flies there, so pressing the button shows what it does.
- **`fit` — "Frame zone".** The camera keeps the planet's orbit, the star's disc (plus a little corona) and
  – when it is shown – the outer zone edge in view, at `fitDistance()` for that radius and along whatever
  viewing direction the visitor has. It re-frames when a gesture *ends* – pointer up, touch released, a
  slider's `change` event, a preset or the zone toggle – never while one runs, so the view cannot pump in
  and out under a finger; a 6 % tolerance suppresses pointless tweens. Stellar evolution has no pointer to
  wait for, so playback re-frames itself with a wider 30 % tolerance, as does a window resize.
- **`follow` — "Planet".** A close-up that rides along with the planet, for seeing what its surface looks
  like at the moment. The camera stands 7.5 planet radii away — in planet radii, so the planet keeps the
  same apparent size at any orbit — swung off the line away from the star. That swing is one angle doing
  two jobs: it is the phase angle, so it sets how much of the planet's face is lit for us, and it is the
  separation between the two bodies in the frame. Both want it large, so it takes as much as the picture
  actually on show can hold — the frame's half-angle along the swing (this view widens the field of view
  to 66° for the room), less the part the panel covers, since the view shift slides the picture into the
  free canvas rather than moving the camera, and stopping a tenth short of that limit so neither body
  sits on an edge. A wide frame has the room beside the planet and a tall one above it, so the swing
  turns about the axis that has it: the star ends up left of the planet on a desktop and above it on a
  phone. The aim then puts the planet 45 % of the way from the centre towards the edge and the star the
  other way, the planet giving way further out — never so far that its own disc is cut — when a nearby
  star would otherwise fall outside the frame. Left alone
  the camera stays on that framing; once the visitor has taken hold of the view (`start` on the controls)
  it keeps their own angle and distance, carried around with the planet — the offsets are re-read from the
  live camera every frame, so orbiting and zooming keep working, and a planet dragged to another orbit
  takes the view with it. The tween into the mode re-evaluates its destination every step, since the
  planet is moving while the camera flies to it. A star swollen far past its own orbit can still fill this
  view; the camera keeps clear of its drawn disc, and the "Star size on screen" control is the way out.
- **`free` — "Overview".** Flies out to 5 AU and leaves the camera to the visitor.
- Both hostile states are built **over** the same bare world (the Earth day map, or the procedural ocean
  and land while it loads) rather than swapping the planet for a different one, so the in-between
  distances show a recognisable Earth changing rather than a different picture arriving.
  - **Freezing** lays ice over it: the oceans whiten but keep their coastlines, young ice is thin enough
    for the water below to darken it and cracks open as leads, and the land shows through the snow.
    `cold` thickens all of it until a deep freeze buries the continents and the planet reads as a
    snowball — 1.7 to 2.4 AU around the Sun.
  - **Drying** takes the water away in the order it would go: the green goes out of the land first
    (`parch`, from the map's own vegetation), then the sea level falls (`fall`), leaving pale seabed
    graded by depth and salt pans crusting where the water has just left. The map has no bathymetry —
    its ocean is one flat blue — so the basins are a smooth noise field of their own. Only once the
    water is in the air does the Venus-like cloud deck close over it, and the crust bakes to rock
    underneath: 0.95 → 0.73 AU around the Sun, which puts the full deck at Venus's own distance.
- City lights burn **only while the planet is a place to live**: `livable` is 1 inside the zone and falls
  to 0 within 8 K of either edge, so a world that has started to freeze or to dry goes dark. It multiplies
  the per-pixel belt factors, which already keep the lights out of the frozen and scorched bands.
- Surface visuals are driven by `stateMix()`. `thaw` and `scorch` are **one-sided ramps that start at the
  edges** — 35 K below the outer edge, 45 K above the inner one — so a planet inside the zone always looks
  like one, and crossing an edge starts a transition rather than flipping a switch: around the Sun the ice
  closes in over 1.7 → 2.4 AU and the ground melts over 0.95 → 0.73 AU. `cold` then ramps over 120 K below
  the outer edge (partly glaciated → deep-frozen) and `heat` over 500 K above the inner one (Venus-like
  cloud deck → cracked crust → lava world).
- **The states morph, they do not cross-fade.** Each factor moves a climate belt across the globe instead of
  dissolving one picture into another: the ice line runs from beyond the poles down past the equator, the
  scorch line the other way, both behind a front that noise makes ragged, and along the boiling front the
  oceans go up in steam. Half-way out you get the snowball caught in the act — caps closing in on a strip of
  open water — and half-way in a Venus haze belt spreading from the equator with steam clouds at its edge.
- **The lava world is a surface, not a lamp.** The crust is a raft of plates over a domain warp whose offset
  drifts, so the plates move and the lanes between them open, glow and close; the seas convect (cooled rafts
  drifting apart, white-hot seams between them) and vents flare every few seconds on the `flareBurst()` clock
  shared with the star. Only the seams and the vents reach the white end of the incandescence ramp — the rest
  stays in its orange half, or the planet blows out into one featureless disc — and the haze around it turns
  from Venus yellow to ember red and breathes with the magma below.
  Earth-like planets use the axial-tilt Earth maps (Solar System Scope, CC BY 4.0) with the city lights
  gated to the night side; the procedural surface remains as a fallback while the maps load.
- View toggles: the habitable-zone toggle owns two sub-toggles (flat annulus, 3D shell) so either
  representation can be shown alone; the temperature unit (K / °C / both) is a remembered string preference,
  the star size a remembered number and the fit mode a remembered boolean.
- One “overall speed” slider (0–5×, default 1×) scales scene time: every animated element is stepped with
  `dt · speed` – the planet’s spin (0.35 rad/s ≈ one turn per 18 s), its orbital motion (a 1-year orbit in
  20 s, capped at π rad/s), stellar evolution while playing (0.4 Gyr/s) and the `uTime` uniforms of the
  photosphere, corona and planet surface. At 0× the scene freezes; the camera tween keeps running on real
  time, since re-framing is interface motion rather than scene time.

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
- The space-weather readout lives in the control panel like every other simulation's readouts: the "geomagnetic
  activity" box (Kp, the G-scale pill and a storm-phase pill, tinted while a storm runs) followed by one stats
  table – ram pressure, the two boundary distances, Sun→Earth transit, the aurora's reach and whether
  geostationary orbit is exposed.
- "Magnetic field off" hides the field lines, boundaries and aurora, sends the particles straight into the
  atmosphere (they are absorbed inside r = 1.045) and releases an escaping-atmosphere plume downwind. Flagged
  as schematic: real atmospheric escape takes hundreds of millions of years.

### galactic-zone notes

- Scene: one unit is 1 000 light-years, the galactic plane is y = 0 and +y is the north galactic pole.
  Azimuth is measured from +x towards +z, which is clockwise seen from above – the sense in which the
  Milky Way rotates when viewed from the north galactic pole. The Sun sits at azimuth −90° (top of the
  overview) on the Orion spur; arms trail, i.e. their azimuth decreases with radius.
- Panel: the shared layout above, with the radius slider as the headline control (a small "back to
  27 000 ly" button inline on its right) and the "Conditions in the solar system" box leading the readouts.
  The schematic caveat opens the model card. Like every simulation it slides the picture left while the panel
  is open on a wide screen (see *Panel layout*), so the galaxy stays centred in the free part of the canvas.
- Clicking or tapping the Sun or the galactic centre in the scene flies to its view – the Sun
  marker and a hit sphere the width of the drawn nucleus are the two targets that carry a
  "click to fly here" line in their tooltip, and the panel header names the view it switched to.
  A press that travels more than 6 px was an orbit drag and flies nowhere.
- Camera presets: "Overview" looks down on the galactic centre from 133 kly (dead centre – the panel is
  dodged by the shared view shift, not by moving the camera). "The Sun" flies down to the Sun's own height, 2.4 kly
  outside it, and aims 21.6 kly inward along the radius: the disc lies across the frame as the band we see
  from Earth, the bulge glows at the far end and the Sun burns in the foreground. That view keeps a slow
  hands-off parallax (a 44 s sway across the orbit and in height) and rides along with the Sun; the first
  drag or zoom hands it over, after which the visitor's own angle and distance are kept and only rotated
  with the Sun. The lateral offsets shrink with the aspect ratio so the Sun stays in frame on a portrait phone.
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
  unresolved starlight; **dust lanes** are 6 000 clouds (`generateDust()`): 60 % sit on the concave (inner)
  edge of the arms (−0.6 arm widths) inside corotation and fade out over the next 5 kly, the rest form a
  diffuse disc 8–35 kly with σ_z = 0.3 kly. Both clouds are instanced camera-facing quads sized in kly
  (point sprites are capped at 64 device pixels on some GPUs and pop at the viewport edge), and each quad is
  the silhouette of an *oblate* ellipsoid – `flat` in the config is its extent along the galactic pole
  relative to its size – so the disc stays a thin lens edge-on instead of a thick band of spheres, while the
  bulge haze keeps its puffed-up shape. The dust is rendered as extinction in two steps: the clouds add their
  optical depth into an offscreen half-resolution buffer, then one full-screen pass multiplies the frame
  (`Zero / SrcColor` blending, the fragment is a *transmission*) by the Beer–Lambert transmission
  tint^column, the tint following the interstellar extinction law (A_B ≈ 1.3 A_V, A_R ≈ 0.75 A_V), the column
  soft-capped (tanh) so dozens of clouds lined up edge-on stack into a dark, not pitch-black, lane and blurred
  a little from grazing angles. Because that pass writes no depth, the stars go down in two passes around it:
  the vertex shader estimates the share of the ray's dust column that lies between camera and star (Gaussian
  layer, ray clipped at the dust disc radius) and draws that share before the dust, the rest over it – seen
  from inside the disc the nearby stars shine in front of the rift instead of being buried under dust far
  beyond them. The split fades out as the camera rises above the plane, where the lanes read as dark bands
  in the smooth light as in a real face-on galaxy. Instances within 3–8 kly of the camera fade and are moved
  outside the clip volume, and haze and dust thin out when the camera dips into the disc (the haze would
  otherwise stack up along grazing lines of sight). The dust passes skip tone mapping (ACES would darken even
  a clear fragment). Two additive sprites give the **nucleus** its glow; 150 **globular clusters**
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
2. Use `createScene()` from `lib/scene.js` and the components from `lib/ui.js`, and lay the
   panel out in the order described under *Panel layout*.
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
  storage and checkbox stay in sync. A display setting does not have to be a boolean: a
  string carries a multi-way choice (a temperature unit), a number a continuous one
  (habitable-zone's star size). A stored value is only adopted when its type still
  matches, and the simulation clamps it to its own range on top of that.
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
- Touch support via OrbitControls; on small screens the control panel becomes a bottom sheet
  that collapses and can be dragged to any height by its header.
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
