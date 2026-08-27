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
scripts/
  check-i18n.mjs     key-parity check for locale files
```

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
