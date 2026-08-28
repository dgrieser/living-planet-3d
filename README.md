# Living Planet 3D

Educational, bilingual (English / German) interactive 3D astronomy simulations built with [Vite](https://vite.dev) and [Three.js](https://threejs.org).

## Getting started

```bash
npm install
npm run dev        # start dev server (http://localhost:5173)
npm run build      # production build into dist/
npm run preview    # serve the production build
npm run lint       # ESLint
npm run check:i18n # verify de.json mirrors en.json 1:1
npm run check:orbits # validate planet-position algorithm against known events
npm run check:hz     # validate habitable-zone physics (zone edges, T_eq, stellar evolution)
npm run check:seasons # validate seasons physics (declination, day length, insolation, calendar mapping)
npm run check:tides   # validate moon-tides physics (2GMR/r³, 1/r³ scaling, spring/neap, periods, tilt models)
npm run check:mag     # validate magnetosphere physics (ram pressure, standoff, boundary fits, field-line deformation, Kp, aurora)
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
  lib/ui.js          UI kit: createPanel, createSlider, createToggle, createButton,
                     createInfoCard, createNotice, createMessage, createSection, el()
  lib/scene.js       scene bootstrap: renderer (DPR ≤ 2), camera, OrbitControls,
                     starfield, resize, delta-time loop, tab-hidden pause,
                     prefers-reduced-motion handling
  lib/webgl.js       WebGL availability check (no Three.js import)
  sims/index.js      simulation registry (lazy-loaded modules)
  sims/<name>/       one folder per simulation
  sims/solar-orbit/  kepler.js (JPL approximate elements, pure JS), planets.js (physical data), index.js
  sims/habitable-zone/ physics.js (zone edges, T_eq, stellar evolution, star relations – pure JS), index.js
  sims/seasons/      physics.js (declination, day length, insolation, energy-balance temperature – pure JS), index.js
  sims/moon-tides/   physics.js (tidal acceleration, equilibrium bulge, spring/neap, Kepler periods, tilt models – pure JS), index.js
  sims/magnetosphere/ physics.js (ram pressure, magnetopause standoff, Shue boundary, dipole lines,
                     field-line deformation, streamlines, Kp-style index, aurora oval – pure JS), index.js
public/textures/     planet textures – Solar System Scope, CC BY 4.0
scripts/
  check-i18n.mjs     key-parity check for locale files
  check-orbits.mjs   validates kepler.js against equinoxes, oppositions, transits (npm run check:orbits)
  check-habitable-zone.mjs validates physics.js against reference values (npm run check:hz)
  check-seasons.mjs  validates the seasons physics against textbook values (npm run check:seasons)
  check-moon-tides.mjs validates the moon-tides physics (npm run check:tides)
  check-magnetosphere.mjs validates the magnetosphere physics (npm run check:mag)
```

## Simulations

| id | Module | Content |
|----|--------|---------|
| `axial-tilt` | Axial tilt & rotation | Tilt a planet's axis, watch the terminator move. |
| `solar-orbit` | Earth's orbit & the habitable zone | All 8 planets from JPL Keplerian elements (1800–2050), habitable-zone annulus (0.95–1.37 AU), Earth highlight, hypothetical e = 0.3 orbit, true/visual scale, date picker, camera presets, bilingual planet info cards. |
| `seasons` | Seasons, axial tilt & day length | Earth orbiting an emissive Sun with adjustable tilt (0–90°) and rotation period (6–300 h); shader day/night terminator, insolation heat map, live tropics/polar circles/subsolar point, draggable orbit position with season stops, annual-cycle animation, day-length/insolation/temperature readout for any latitude, bilingual what-if presets (0°, 23.4°, 90°, 300 h, 6 h). |
| `moon-tides` | The Moon & the tides | Two linked views: (A) ocean shell displaced by the equilibrium tide of Moon + optional Sun (spring/neap), adjustable Moon distance 0.5–2× with 1/r³ bulge scaling, rotating Earth with a tide-gauge strip chart; (B) precessing, gently nodding axis with the Moon vs. a clearly flagged schematic chaotic wobble (0–60°) after "Remove Moon". Bilingual moon-size comparison table. |
| `magnetosphere` | Earth's magnetosphere | Dipole field lines (56 curves, L = 2–10) confined below the Shue magnetopause on the dayside and stretched into a magnetotail on the night side, 10 000 GPU solar-wind particles deflecting around the boundary, translucent bow-shock and magnetopause paraboloids, emissive auroral ovals whose radius follows the Kp-style index, density (0–100 cm⁻³) and speed (200–2000 km/s) sliders, "Launch CME" event with a space-weather readout, and a clearly flagged schematic "magnetic field off" mode with atmospheric erosion. |
| `habitable-zone` | The habitable zone | Adjustable star (M/K/G/F presets, luminosity 0.001–10 L☉) with colour-accurate appearance, draggable planet (0.1–5 AU) whose surface morphs frozen / habitable / scorched from T_eq, live Kopparapu zone (annulus or 3D shell), evolution mode ageing a Sun-like star 0–10 Gyr, orbit grid, temperature labels, bilingual physics card. |

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

## Adding a simulation

1. Create `src/sims/<name>/index.js` with a default export
   `mount(container, meta) => dispose` (may be async).
2. Use `createScene()` from `lib/scene.js` and the components from `lib/ui.js`.
3. Add all UI strings under `sims.<camelName>` in **both** `en.json` and `de.json`.
   Run `npm run check:i18n` to verify parity.
4. Register the module in `src/sims/index.js`.

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
