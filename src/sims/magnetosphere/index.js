/**
 * Simulation: Earth's magnetosphere ("magnetosphere") – the first layer of the
 * "double shield" (magnetic field + atmosphere).
 *
 * Scene (all lengths in Earth radii, Earth at the origin with radius 1):
 *  - +x points at the Sun, so the solar wind flows towards −x; +y is the dipole
 *    axis (north), +z is dusk. The dipole is drawn aligned with the rotation
 *    axis – the real 11° offset is left out on purpose (see the physics card).
 *  - 56 dipole field lines (L = 2…10, eight meridians) are bent by
 *    `physics.deformPoint`: confined below the Shue et al. (1997) magnetopause on
 *    the dayside, stretched into a magnetotail and flattened towards the current
 *    sheet on the nightside. Higher wind pressure ⇒ smaller standoff ⇒ visibly
 *    compressed dayside and a longer tail.
 *  - 10 000 solar-wind particles, 4 000 CME particles and 3 000 escaping
 *    "erosion" particles are single `THREE.Points` objects whose positions are
 *    computed entirely in the vertex shader from a handful of uniforms, so the
 *    per-frame CPU cost is a few uniform writes.
 *  - The magnetopause and bow-shock paraboloids are also evaluated in a vertex
 *    shader from (u, v) parameters, so changing the wind never rebuilds geometry.
 *  - Switching the field off, removing the atmosphere or switching the volcanoes off
 *    starts a clock in millions of years per second. `physics.stepWorld` then runs
 *    the budget of the air – stripped by the wind, refilled with CO₂ by volcanoes,
 *    drawn down by weathering – and the climate, water and surface that follow from
 *    it: cooling and a snowball as the greenhouse goes, ice sublimating to the poles
 *    and a rusting, Mars-like ground below the triple point, and – on a volcanically
 *    alive Earth – a rebuilt CO₂ atmosphere that thaws the world again. The Earth
 *    shader paints all of that from a handful of eased uniforms; the physics never
 *    touches pixels. The atmosphere shell becomes the induced ionosphere of an
 *    unmagnetised planet: pressed down on the dayside, plasma clouds peeled off the
 *    flanks, and an ion tail downwind; its visible top drops one scale height per
 *    e-folding of lost mass. With no air at all the wind reaches the ground and
 *    leaves a wake behind the planet, as behind the Moon.
 *
 * All quantitative work lives in ./physics.js; this module only maps it to pixels.
 */
import * as THREE from 'three';
import { createScene } from '../../lib/scene.js';
import { createPanel, createPanelShift, createCollapsibleSection, createControlRow, createSlider, createToggle, createViewToggles, createButton, createResetButton, createInfoCard, createNotice, el } from '../../lib/ui.js';
import { createViewPrefs } from '../../lib/prefs.js';
import { t, bindText, bindAttr, onLanguageChange, formatNumber } from '../../lib/i18n.js';
import * as P from './physics.js';

const KEYS = 'sims.magnetosphere';
const DEG = Math.PI / 180;

const EARTH_RADIUS = 1;
const ATMOSPHERE_RADIUS = 1.045;
/** How long the ion tail is drawn at the strongest wind, in Earth radii (Venus's and Mars's reach several). */
const ION_TAIL_MAX = 3.2;
/** log₁₀ of the ram-pressure range the sliders cover; the wind's "lean" on the ionosphere is scaled by it. */
const PRESSURE_DECADES = Math.log10(2500);
const AURORA_RADIUS = 1.062;
const AURORA_CAP_DEG = 48;
const SUN_SPRITE_DISTANCE = 400;
const TEXTURE_BASE = `${import.meta.env.BASE_URL}textures/`;

const L_SHELLS = [2, 2.75, 3.6, 4.6, 6, 8, 10];
const AZIMUTH_COUNT = 8;
const LINE_SEGMENTS = 95; // segments per field line → 96 points
const POINTS_PER_LINE = LINE_SEGMENTS + 1;
const FIELD_LINE_COUNT = L_SHELLS.length * AZIMUTH_COUNT; // 56 curves

const WIND_PARTICLES = 10000;
const CME_PARTICLES = 4000;
const EROSION_PARTICLES = 3000;
const WIND_START_X = 28; // upstream spawn plane (just outside the default view)
const WIND_PATH_LENGTH = 72; // spawn plane → far end of the tail
const WIND_RHO_MAX = 18; // radius of the illuminated wind beam
const WIND_BASE_RATE = 0.135; // path fractions per second at 400 km/s
const EROSION_BASE_RATE = 0.16; // ditto for the atmosphere escaping with the shield off
const DEFLECTION_OFFSET = 0.28; // the flow starts turning 0.28·r₀ sunward of the nose, i.e. at the bow shock
// A hollow tube of particles projects to a filled disc, so most of the beam is
// concentrated in a slab around the noon–midnight meridian (the plane spanned by the
// Sun direction and the dipole axis). That is the plane the textbook cut uses and it
// makes the flow split around the magnetopause plainly visible; the remaining
// particles fill the volume so the boundary still reads as a 3D surface.
const MERIDIAN_FRACTION = 0.72;
const MERIDIAN_SPREAD = 0.3; // rad

const SURFACE_NX = 56; // paraboloid grid
const SURFACE_NTHETA = 72;
const SURFACE_TAIL = 5.2; // drawn tail length in units of the nose distance
const FAR_AWAY = 1e4; // stand-in standoff (R_E) for the shaders when there is no wind and the real one is infinite
const BOUNDARY_FADE_START = 20; // the boundaries fade out as the nose recedes from here…
const BOUNDARY_FADE_END = 60; // …to here, well outside the scene

const COLORS = Object.freeze({
  fieldInner: 0x5fd0ff,
  fieldOuter: 0x7a6cff,
  fieldCompressed: 0xffb057,
  magnetopause: 0x6fe3ff,
  bowShock: 0xffb45c,
  windCold: 0x6f9dff,
  windHot: 0xfff1b8,
  cmeCold: 0xff8f6a,
  cmeHot: 0xffe6b0,
  erosion: 0xff9d5c,
  erosionHot: 0xffd9a0,
  aurora: 0x5cffa0,
  atmosphere: 0x6fb6ff,
  sun: 0xffd9a0,
  label: 0xf0f4ff,
});

const DEFAULTS = Object.freeze({
  density: P.DENSITY_RANGE.default,
  speed: P.SPEED_RANGE.default,
  fieldOn: true,
  timeLapse: P.CLOCK.timeLapse.defaultMyrPerS, // Myr of the geological clock per second of scene time
  airRemoved: false, // the thought experiment: take every last bit of gas away
  volcanoes: true, // Earth is volcanically alive – switch off to see the dead-planet (Mars) path
});
/** The boiling oceans right after the air is taken: a scene-time flash that fades over this many seconds. */
const STEAM_FADE = 2.5;

/** The picture follows the model with this time constant (s), so a scrubbed clock does not pop. */
const VISUAL_EASE = 0.45;
/** Clock slider: 0 = the switch, then 1 Myr … 100 Gyr on a log scale. */
const CLOCK_SLIDER_STEPS = 1000;
const CLOCK_SLIDER_MIN_YR = 1e6;
/** The dev hook and the readouts treat this as "the ice line has moved". */
const NO_ICE_EDGE = 1.08;

/** Display toggles – remembered per visitor, see ../../lib/prefs.js. */
const VIEW_DEFAULTS = Object.freeze({
  showFieldLines: true,
  showBoundaries: true,
  showAurora: true,
  showLabels: true,
});

// Every view orbits Earth itself: the target stays at the origin, so the planet sits in the
// middle of the picture and dragging turns it rather than swinging it out of frame. The tail
// view only moves the camera downstream, so the stretched lobes lead away from Earth.
const CAMERA_PRESETS = Object.freeze({
  side: { position: [4, 11, 30], target: [0, 0, 0] },
  polar: { position: [0.02, 9, 0.01], target: [0, 0, 0] },
  tail: { position: [-38, 13, 34], target: [0, 0, 0] },
});
/** The views in the order the panel's header button steps through them. */
const CAMERA_VIEWS = Object.freeze(
  ['side', 'polar', 'tail'].map((id) => ({ id, labelKey: `${KEYS}.controls.camera${id[0].toUpperCase()}${id.slice(1)}` })),
);

const { clamp } = P;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const fmt = (v, digits = 1, min = 0) => formatNumber(v, { maximumFractionDigits: digits, minimumFractionDigits: Math.min(min, digits) });

export default function mount(container, meta) {
  const viewPrefs = createViewPrefs(meta.id, VIEW_DEFAULTS);
  const state = { ...DEFAULTS, ...viewPrefs.values };
  const disposers = [];
  let time = 0; // seconds of animated time
  // How far the wind / escaping particles have travelled along their path, in path fractions.
  // Integrated per frame so the flow only ever runs downwind, whatever the speed does.
  let windPhase = 0;
  let erosionPhase = 0;
  let cme = null; // { t, x, impacted, sinceImpact }
  let staticStorm = false; // reduced-motion fallback for the CME button
  let model = null;
  // The world on the geological clock: the air budget, the water, the ground – see physics.stepWorld.
  let world = P.todayWorld();
  let steam = 0; // the oceans flashing to vapour when the air goes (scene time)
  let scrubPointer = false; // the clock slider is being dragged – the running clock must not fight it
  let scrubKeyAt = -Infinity;
  // What the Earth shader currently shows; eased towards the model every frame.
  const vis = { atm: 1, iceEdge: NO_ICE_EDGE, deep: 0, veg: 0, lights: 1, landSnow: 1, migrate: 0, capEdge: 1, rust: 0, haze: 0 };
  /** The settings the budget runs under. */
  const settings = () => ({ density: state.density, speed: state.speed, fieldOn: state.fieldOn, volcanoes: state.volcanoes });
  /** Today's Earth with its shield is a steady state; anything else has a history worth running. */
  const clockRunning = () => !state.fieldOn || state.airRemoved || !state.volcanoes;

  const viewport = el('div', 'lp-sim__viewport');
  container.append(viewport);

  const sim = createScene({
    container: viewport,
    cameraPosition: CAMERA_PRESETS.side.position,
    fov: 45,
    near: 0.1,
    far: 5000,
    stars: { count: 1600, radius: 1500 },
    controls: { minDistance: 1.6, maxDistance: 400 },
  });
  const { scene, camera, renderer, controls } = sim;
  // Dim the shared starfield so the solar-wind particles stand out against it.
  const starfield = scene.getObjectByName('starfield');
  if (starfield) {
    starfield.material.size = 1.1;
    starfield.material.opacity = 0.5;
  }
  controls.target.set(...CAMERA_PRESETS.side.target);
  controls.update();
  const labelFont = getComputedStyle(document.documentElement).getPropertyValue('--lp-font') || 'sans-serif';
  const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // --- Earth, atmosphere -------------------------------------------------------------------------
  // Same day/night treatment as the other simulations (see axial-tilt): the terminator is a
  // smoothstep on N·L, the night side keeps a faint blue-grey of the day map, and the city
  // lights fade in across that same transition.
  const loader = new THREE.TextureLoader();
  function loadTexture(file, onLoad) {
    loader.load(
      TEXTURE_BASE + file,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = maxAnisotropy;
        onLoad(tex);
        sim.requestRender();
      },
      undefined,
      () => console.warn(`[magnetosphere] texture not available: ${file} – using flat colour`),
    );
  }
  const dayPlaceholder = new THREE.DataTexture(new Uint8Array([28, 70, 150, 255]), 1, 1);
  dayPlaceholder.colorSpace = THREE.SRGBColorSpace;
  dayPlaceholder.needsUpdate = true;
  const nightPlaceholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); // no city lights until the map arrives
  nightPlaceholder.needsUpdate = true;
  const earthMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: dayPlaceholder },
      uNightMap: { value: nightPlaceholder },
      uSunPos: { value: new THREE.Vector3(SUN_SPRITE_DISTANCE, 0, 0) },
      // the unshielded run – see `syncVisuals`
      uAtm: { value: 1 },
      uIceEdge: { value: NO_ICE_EDGE },
      uDeep: { value: 0 },
      uVeg: { value: 0 },
      uLights: { value: 1 },
      uLandSnow: { value: 1 },
      uMigrate: { value: 0 },
      uCapEdge: { value: 1 },
      uRust: { value: 0 },
      uHaze: { value: 0 },
      uSteam: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: EARTH_VERTEX,
    fragmentShader: EARTH_FRAGMENT,
  });
  loadTexture('2k_earth_daymap.jpg', (tex) => {
    earthMaterial.uniforms.uMap.value = tex;
  });
  // city lights (NASA Black Marble data via Solar System Scope), shown on the night side only
  loadTexture('2k_earth_nightmap.jpg', (tex) => {
    earthMaterial.uniforms.uNightMap.value = tex;
  });

  const earthSpin = new THREE.Group();
  const earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS, 96, 64), earthMaterial);
  earth.name = 'earth';
  earthSpin.add(earth);
  scene.add(earthSpin);

  // The shell's geometry is the unit sphere; its height, dayside compression and tail are set in
  // the vertex shader (see ATMOSPHERE_VERTEX), so nothing is rebuilt as the air goes.
  const atmosphereMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(COLORS.atmosphere) },
      uHotColor: { value: new THREE.Color(0xff8a5c) },
      uErosion: { value: 0 },
      uOpacity: { value: 1 },
      uHeight: { value: ATMOSPHERE_RADIUS - EARTH_RADIUS },
      uSquash: { value: 0 },
      uTail: { value: 0 },
      uTailGlow: { value: 0 },
      uRip: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: ATMOSPHERE_VERTEX,
    fragmentShader: ATMOSPHERE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS, 128, 96), atmosphereMaterial);
  atmosphere.frustumCulled = false; // the tail reaches well outside the sphere's bounds
  atmosphere.renderOrder = 2;
  scene.add(atmosphere);

  // --- aurora caps ------------------------------------------------------------------------------
  const auroraGeometry = new THREE.SphereGeometry(AURORA_RADIUS, 128, 40, 0, Math.PI * 2, 0, AURORA_CAP_DEG * DEG);
  const auroraMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uColat: { value: 0.4 },
      uWidth: { value: 0.06 },
      uIntensity: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: AURORA_VERTEX,
    fragmentShader: AURORA_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const auroraNorth = new THREE.Mesh(auroraGeometry, auroraMaterial);
  const auroraSouth = new THREE.Mesh(auroraGeometry, auroraMaterial);
  auroraSouth.rotation.x = Math.PI;
  auroraNorth.renderOrder = 3;
  auroraSouth.renderOrder = 3;
  scene.add(auroraNorth, auroraSouth);

  // --- field lines ------------------------------------------------------------------------------
  const linePositions = new Float32Array(FIELD_LINE_COUNT * LINE_SEGMENTS * 6);
  const lineColors = new Float32Array(FIELD_LINE_COUNT * LINE_SEGMENTS * 6);
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  lineGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
  const fieldLines = new THREE.LineSegments(
    lineGeometry,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }),
  );
  fieldLines.frustumCulled = false;
  scene.add(fieldLines);

  const dipoleTmp = [0, 0, 0];
  const deformTmp = [0, 0, 0, 1];
  const lineScratch = new Float32Array(POINTS_PER_LINE * 4);
  const shellColor = new THREE.Color();
  const vertexColor = new THREE.Color();
  const compressedColor = new THREE.Color(COLORS.fieldCompressed);
  const outerColor = new THREE.Color(COLORS.fieldOuter);
  let lastLineEnv = null;

  function rebuildFieldLines(env) {
    let w = 0;
    for (let li = 0; li < L_SHELLS.length; li++) {
      const L = L_SHELLS[li];
      const lat1 = P.footpointLatitude(L);
      shellColor.set(COLORS.fieldInner).lerp(outerColor, li / (L_SHELLS.length - 1));
      for (let ai = 0; ai < AZIMUTH_COUNT; ai++) {
        // stagger every other shell by half a step so the meridians do not overlap on screen
        const azimuth = ((ai + (li % 2) * 0.5) / AZIMUTH_COUNT) * Math.PI * 2;
        for (let i = 0; i < POINTS_PER_LINE; i++) {
          const lat = -lat1 + (2 * lat1 * i) / LINE_SEGMENTS;
          P.dipolePoint(dipoleTmp, L, lat, azimuth);
          P.deformPoint(deformTmp, dipoleTmp[0], dipoleTmp[1], dipoleTmp[2], env);
          lineScratch[i * 4] = deformTmp[0];
          lineScratch[i * 4 + 1] = deformTmp[1];
          lineScratch[i * 4 + 2] = deformTmp[2];
          lineScratch[i * 4 + 3] = deformTmp[3];
        }
        for (let i = 0; i < LINE_SEGMENTS; i++) {
          for (const idx of [i, i + 1]) {
            const x = lineScratch[idx * 4];
            const y = lineScratch[idx * 4 + 1];
            const z = lineScratch[idx * 4 + 2];
            const squeeze = lineScratch[idx * 4 + 3];
            linePositions[w] = x;
            linePositions[w + 1] = y;
            linePositions[w + 2] = z;
            const r = Math.sqrt(x * x + y * y + z * z);
            const fade = clamp(0.95 / (0.8 + 0.1 * r), 0.14, 0.78);
            vertexColor.copy(shellColor).lerp(compressedColor, clamp((1 - squeeze) * 2.4, 0, 0.85)).multiplyScalar(fade);
            lineColors[w] = vertexColor.r;
            lineColors[w + 1] = vertexColor.g;
            lineColors[w + 2] = vertexColor.b;
            w += 3;
          }
        }
      }
    }
    lineGeometry.attributes.position.needsUpdate = true;
    lineGeometry.attributes.color.needsUpdate = true;
    lastLineEnv = env;
  }

  /** Rebuild only when the shape actually moved – the CME animates through this smoothly. */
  function syncFieldLines(env) {
    // compared through 1/r₀ so that an infinite standoff (no wind) is a value like any other
    const inv = (e) => (Number.isFinite(e.r0) ? 1 / e.r0 : 0);
    if (!lastLineEnv || Math.abs(inv(env) - inv(lastLineEnv)) > 1.2e-4 || Math.abs(env.alpha - lastLineEnv.alpha) > 0.002) {
      rebuildFieldLines({ ...env });
    }
  }

  // --- boundary surfaces (magnetopause + bow shock) ---------------------------------------------
  const magnetopause = createParaboloidSurface({
    color: COLORS.magnetopause,
    opacity: 0.15,
    rings: 7,
    meridians: 16,
  });
  const bowShock = createParaboloidSurface({
    color: COLORS.bowShock,
    opacity: 0.12,
    rings: 6,
    meridians: 14,
  });
  scene.add(magnetopause.mesh, bowShock.mesh);

  // --- particles --------------------------------------------------------------------------------
  const wind = createParticles({
    count: WIND_PARTICLES,
    mode: 0,
    size: 1.5,
    cold: COLORS.windCold,
    hot: COLORS.windHot,
    rho: (rnd) => WIND_RHO_MAX * Math.pow(rnd(), 0.7),
  });
  const cmeCloud = createParticles({
    count: CME_PARTICLES,
    mode: 1,
    size: 2.2,
    cold: COLORS.cmeCold,
    hot: COLORS.cmeHot,
    rho: (rnd) => 20 * Math.pow(rnd(), 0.7),
  });
  const erosion = createParticles({
    count: EROSION_PARTICLES,
    mode: 2,
    size: 2.0,
    cold: COLORS.erosion,
    hot: COLORS.erosionHot,
    rho: (rnd) => Math.sqrt(rnd()) * 1.45, // launch colatitude from the Sun direction (dayside cap)
  });
  cmeCloud.uniforms.uOpacity.value = 0;
  erosion.uniforms.uOpacity.value = 0;
  scene.add(wind.points, cmeCloud.points, erosion.points);

  // --- Sun + labels -----------------------------------------------------------------------------
  const glowTexture = createGlowTexture();
  const sunSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture, color: COLORS.sun, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, sizeAttenuation: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  sunSprite.scale.set(0.12, 0.12, 1);
  sunSprite.position.set(SUN_SPRITE_DISTANCE, 0, 0);
  sunSprite.renderOrder = 6;
  scene.add(sunSprite);

  const labels = {
    sun: createLabel(COLORS.sun, labelFont, 0.95),
    bowShock: createLabel(COLORS.bowShock, labelFont, 0.85),
    magnetopause: createLabel(COLORS.magnetopause, labelFont, 0.85),
    tail: createLabel(COLORS.fieldOuter, labelFont, 0.85),
    north: createLabel(COLORS.label, labelFont, 0.8),
    south: createLabel(COLORS.label, labelFont, 0.8),
  };
  for (const l of Object.values(labels)) scene.add(l.sprite);

  const tmpUp = new THREE.Vector3();
  const hazeColor = new THREE.Color(0xd9b48f);

  // =============================================================================================
  // derived model
  // =============================================================================================
  function derive() {
    const envelope = staticStorm ? 1 : cme && cme.impacted ? P.cmeEnvelope(cme.sinceImpact) : 0;
    const effective = P.effectiveWind(state.density, state.speed, envelope);
    const active = P.magnetosphereState(effective.density, effective.speed, { fieldOn: state.fieldOn });
    let phase = 'none';
    if (staticStorm) phase = 'impact';
    else if (cme) phase = !cme.impacted ? 'incoming' : cme.sinceImpact < P.CME.riseSeconds + P.CME.holdSeconds ? 'impact' : 'decay';
    return {
      ...active,
      // the budget integrates the steady wind: a CME sheath lasts a day, which is nothing on this clock
      world: P.worldState(world, settings()),
      envelope,
      phase,
      cmeActive: phase !== 'none',
      cmeX: cme ? cme.x : WIND_START_X,
      cmeOpacity: staticStorm ? 0.75 : cme ? (cme.impacted ? clamp(1 - cme.sinceImpact / 5, 0, 1) : Math.min(1, cme.t / 0.4)) : 0,
    };
  }

  // =============================================================================================
  // scene update
  // =============================================================================================
  function applyModel() {
    const m = model;
    const shield = state.fieldOn;
    const alpha = m.alpha;
    // No wind, no boundary: the standoff is then infinite. The surfaces and the streamlines get a
    // far-away stand-in, and the boundaries fade out as they recede beyond the scene.
    const hasWind = Number.isFinite(m.standoff);
    const r0 = hasWind ? m.standoff : FAR_AWAY;
    const c = r0 * Math.pow(4, alpha);
    const bsNose = hasWind ? m.bowShock : FAR_AWAY * P.BOW_SHOCK_FACTOR;
    const boundaryFade = 1 - P.smoothstep(BOUNDARY_FADE_START, BOUNDARY_FADE_END, r0);
    // how much of a wind there is at all, for everything that only exists because of it
    const presence = P.smoothstep(0, 0.02, m.pressureRatio);

    // field lines
    fieldLines.visible = shield && state.showFieldLines;
    if (fieldLines.visible) syncFieldLines(m.env);

    // boundaries
    magnetopause.mesh.visible = shield && state.showBoundaries && boundaryFade > 0.02;
    bowShock.mesh.visible = shield && state.showBoundaries && boundaryFade > 0.02;
    magnetopause.set({ nose: r0, c, tail: -SURFACE_TAIL * r0, fade: boundaryFade });
    bowShock.set({ nose: bsNose, c: 4 * r0, tail: -SURFACE_TAIL * r0, fade: boundaryFade });

    // aurora – lit by the wind, so none without one
    const auroraOn = shield && state.showAurora && m.auroraIntensity > 0;
    auroraNorth.visible = auroraOn;
    auroraSouth.visible = auroraOn;
    auroraMaterial.uniforms.uColat.value = m.aurora.centreColat;
    auroraMaterial.uniforms.uWidth.value = Math.max(m.aurora.halfWidth, 0.045);
    // the oval is the air glowing: no air, no aurora – whatever the field does
    auroraMaterial.uniforms.uIntensity.value = m.auroraIntensity * (1 + 0.55 * m.envelope) * P.smoothstep(0, 0.02, vis.atm);
    auroraMaterial.uniforms.uTime.value = time;

    // the planet itself: what is left of the air, and what that did to the surface
    const eu = earthMaterial.uniforms;
    eu.uAtm.value = vis.atm;
    eu.uIceEdge.value = vis.iceEdge;
    eu.uDeep.value = vis.deep;
    eu.uVeg.value = vis.veg;
    eu.uLights.value = vis.lights;
    eu.uLandSnow.value = vis.landSnow;
    eu.uMigrate.value = vis.migrate;
    eu.uCapEdge.value = vis.capEdge;
    eu.uRust.value = vis.rust;
    eu.uHaze.value = vis.haze;
    eu.uSteam.value = steam;
    eu.uTime.value = time;
    // The shell. Its visible top follows the barometric law – one scale height lower per e-folding
    // of lost mass, reaching the ground at the triple point – so it thins slowly at first and
    // collapses at the end; its brightness is the column density, i.e. the mass itself.
    const air = Math.max(vis.atm, 1e-9);
    const top = clamp(1 + Math.log(air) / Math.log(1 / P.TRIPLE_POINT_FRACTION), 0, 1);
    const height = (ATMOSPHERE_RADIUS - EARTH_RADIUS) * top;
    // How hard the wind leans on the ionosphere, 0 for the quiet wind … 1 at the top of the sliders
    // (log scale of the ram pressure, CME sheath included).
    const lean = clamp(Math.log10(Math.max(m.pressureRatio, 1e-3)) / PRESSURE_DECADES, 0, 1);
    // What still feeds the plume: the air, or – once it is gone – the sublimating ice.
    const plume = vis.atm + (1 - vis.atm) * 0.08 * m.world.water;
    const au = atmosphereMaterial.uniforms;
    au.uErosion.value = shield ? 0 : presence;
    au.uOpacity.value = Math.pow(vis.atm, 0.6);
    // a CO₂ sky scatters paler and warmer than ours
    au.uColor.value.set(COLORS.atmosphere).lerp(hazeColor, vis.haze * 0.7);
    au.uHeight.value = height;
    au.uTime.value = time;
    if (shield) {
      au.uSquash.value = 0;
      au.uTail.value = 0;
      au.uTailGlow.value = 0;
      au.uRip.value = 0;
    } else {
      // the ionopause is pushed down on the dayside; a thinner ionosphere holds less pressure against the wind
      au.uSquash.value = (0.35 + 0.65 * lean) * (0.6 + 0.4 * (1 - vis.atm)) * presence;
      // the ion tail grows with the wind and lives on what is being stripped
      au.uTail.value = ION_TAIL_MAX * (0.2 + 0.8 * lean) * Math.pow(plume, 0.35) * presence;
      au.uTailGlow.value = (0.45 + 0.55 * lean) * presence;
      // plasma clouds torn off the flanks – more of them the harder the wind leans and the less air is left
      au.uRip.value = (0.3 + 0.7 * lean) * (0.55 + 0.45 * (1 - vis.atm)) * presence;
    }
    atmosphere.visible = vis.atm > 0.002 || (!shield && plume > 0.005);
    const absorbRadius = EARTH_RADIUS + height;

    // particles – positions come from the phases integrated in `frame`, never from `time × rate`
    for (const sys of [wind, cmeCloud, erosion]) {
      const u = sys.uniforms;
      u.uTime.value = time;
      u.uR0.value = r0;
      u.uC.value = c;
      u.uBsNose.value = bsNose;
      u.uFieldOn.value = shield ? 1 : 0;
      u.uAtmR.value = absorbRadius;
    }
    wind.uniforms.uPhase.value = windPhase;
    wind.uniforms.uOpacity.value = clamp(0.4 + 0.5 * Math.min(m.density / 30, 1), 0.4, 0.9);
    wind.uniforms.uBoost.value = shield ? 1 : 1.3; // with nothing to light the sheath, the stream itself has to show
    wind.points.visible = m.density > 0 && m.speed > 0; // a wind that does not blow is no wind

    cmeCloud.uniforms.uCmeX.value = m.cmeX;
    cmeCloud.uniforms.uOpacity.value = m.cmeOpacity;
    cmeCloud.points.visible = m.cmeOpacity > 0.01;

    erosion.uniforms.uPhase.value = erosionPhase;
    // the plume of escaping gas: brighter, bigger and longer the harder the wind strips; dwindling with the air
    erosion.uniforms.uOpacity.value = shield ? 0 : (0.35 + 0.65 * lean) * plume * presence;
    erosion.uniforms.uBoost.value = 1 + 0.9 * lean;
    erosion.uniforms.uTail.value = au.uTail.value;
    erosion.points.visible = !shield && plume > 0.005;

    // labels
    const showLabels = state.showLabels;
    labels.sun.sprite.visible = showLabels;
    labels.bowShock.sprite.visible = showLabels && bowShock.mesh.visible;
    labels.magnetopause.sprite.visible = showLabels && magnetopause.mesh.visible;
    labels.tail.sprite.visible = showLabels && shield && boundaryFade > 0.02;
    labels.north.sprite.visible = showLabels;
    labels.south.sprite.visible = showLabels;
    labels.bowShock.sprite.position.set(bsNose, 2.4, 0);
    labels.magnetopause.sprite.position.set(r0, -2.4, 0);
    labels.tail.sprite.position.set(-SURFACE_TAIL * r0 * 0.75, 3.5, 0);
    labels.north.sprite.position.set(0, 1.8, 0);
    labels.south.sprite.position.set(0, -1.8, 0);
  }

  /** Camera-dependent bits: label offsets and the near plane. */
  function updateOverlay() {
    tmpUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const camDist = camera.position.distanceTo(controls.target);
    labels.sun.sprite.position.copy(sunSprite.position).addScaledVector(tmpUp, -SUN_SPRITE_DISTANCE * 0.045);
    const near = clamp(camDist * 0.008, 0.05, 3);
    if (Math.abs(camera.near - near) / near > 0.2) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
  }

  /**
   * Targets for the Earth shader from the unshielded state. The ice edge is remapped so
   * that today's ice line adds nothing to the texture (which already has its polar ice) and
   * a snowball freezes the equator too.
   */
  function visualTargets(w) {
    const iceShare = clamp(w.climate.iceSin / P.TODAY_ICE_SIN, 0, 1);
    const dead = w.lifeGone ? 1 : 0;
    return {
      atm: Math.min(w.fraction, 1),
      iceEdge: -0.22 + (NO_ICE_EDGE + 0.22) * iceShare,
      deep: clamp((P.CLIMATE.iceThresholdC - w.climate.meanC) / 35, 0, 1),
      // plants starve of CO₂ as the air goes, freeze before that if the cold comes first – and never
      // come back once the world has been sterilised
      veg: Math.max(P.smoothstep(0.65, 0.3, w.fraction), P.smoothstep(8, -5, w.climate.meanC), dead),
      // the lights go out between "Everest base camp" and "the death zone", or when the world freezes
      lights: P.smoothstep(0.32, 0.6, w.fraction) * P.smoothstep(-22, -6, w.climate.meanC) * (1 - dead),
      // snow needs weather: an airless freeze ices the seas over but leaves the land bare, save for frost
      landSnow: w.airless ? 0.15 : 1,
      migrate: w.migration,
      capEdge: Math.sin(w.capLatDeg * DEG),
      rust: w.rust,
      haze: w.co2Fraction,
    };
  }
  /** Ease the picture towards the model; `dt = null` snaps (start-up, reset, reduced motion). */
  function syncVisuals(dt) {
    const target = visualTargets(model.world);
    const k = dt === null ? 1 : 1 - Math.exp(-dt / VISUAL_EASE);
    for (const key of Object.keys(vis)) vis[key] += (target[key] - vis[key]) * k;
  }

  function refresh() {
    model = derive();
    if (sim.reducedMotion) syncVisuals(null);
    applyModel();
    updateOverlay();
    updateReadouts(true);
    sim.requestRender();
  }

  // --- camera tween ------------------------------------------------------------------------------
  let cameraTween = null;
  let cameraMode = 'side';
  function tweenCamera(preset, { duration = 0.9 } = {}) {
    const to = new THREE.Vector3(...preset.position);
    const target = new THREE.Vector3(...preset.target);
    if (sim.reducedMotion || duration <= 0) {
      camera.position.copy(to);
      controls.target.copy(target);
      controls.update();
      sim.requestRender();
      return;
    }
    cameraTween = { from: camera.position.clone(), to, fromTarget: controls.target.clone(), target, t: 0, duration };
  }
  function stepTween(dt) {
    if (!cameraTween) return;
    cameraTween.t = Math.min(1, cameraTween.t + dt / cameraTween.duration);
    const k = easeInOut(cameraTween.t);
    camera.position.lerpVectors(cameraTween.from, cameraTween.to, k);
    controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.target, k);
    if (cameraTween.t >= 1) cameraTween = null;
  }
  function setCamera(mode, { announce = false } = {}) {
    cameraMode = mode;
    syncCameraButtons({ announce });
    tweenCamera(CAMERA_PRESETS[mode]);
  }

  // =============================================================================================
  // frame
  // =============================================================================================
  function frame(dt) {
    time += dt;
    earthSpin.rotation.y += dt * 0.05;
    if (cme) {
      cme.t += dt;
      if (!cme.impacted) {
        const travel = clamp(cme.t / P.CME.travelSeconds, 0, 1);
        const nose = model ? Math.min(model.standoff, 22) : 10.5; // into a dead calm the cloud still arrives
        // never let a slider that moves the magnetopause outwards mid-flight pull the cloud back
        cme.x = Math.min(cme.x, WIND_START_X + (nose - WIND_START_X) * (travel * travel * (3 - 2 * travel)));
        if (travel >= 1) {
          cme.impacted = true;
          cme.sinceImpact = 0;
        }
      } else {
        cme.sinceImpact += dt;
        cme.x = Math.max(cme.x - dt * 16, -40);
        if (cme.sinceImpact > P.CME_TOTAL_SECONDS) {
          cme = null;
          syncCmeButton();
        }
      }
    }
    if (clockRunning()) {
      // the geological clock: Myr per second of scene time, the budget run under the current settings
      world = P.stepWorld(world, settings(), dt * state.timeLapse * 1e6);
      syncClockSlider();
    }
    steam *= Math.exp(-dt / STEAM_FADE);
    model = derive();
    syncVisuals(dt);
    // integrate the flow: the speed sets how fast, the sign never changes
    windPhase += dt * WIND_BASE_RATE * (model.speed / P.WIND_NOMINAL.speed);
    erosionPhase += dt * EROSION_BASE_RATE * (model.speed / P.WIND_NOMINAL.speed);
    applyModel();
    stepTween(dt);
    updateOverlay();
    updateReadouts();
  }
  sim.onFrame(frame);
  const onControlsChange = () => {
    if (sim.reducedMotion) updateOverlay();
  };
  controls.addEventListener('change', onControlsChange);
  disposers.push(() => controls.removeEventListener('change', onControlsChange));

  // =============================================================================================
  // state setters
  // =============================================================================================
  function setDensity(v, { fromSlider = false } = {}) {
    state.density = clamp(Math.round(v), P.DENSITY_RANGE.min, P.DENSITY_RANGE.max);
    if (!fromSlider) densitySlider.setValue(state.density, { silent: true });
    refresh();
  }
  function setSpeed(v, { fromSlider = false } = {}) {
    state.speed = clamp(Math.round(v / 25) * 25, P.SPEED_RANGE.min, P.SPEED_RANGE.max);
    if (!fromSlider) speedSlider.setValue(state.speed, { silent: true });
    refresh();
  }
  function setFieldOn(on) {
    if (state.fieldOn === on) return;
    state.fieldOn = on;
    syncFieldButton();
    refresh();
  }
  /** Take the air away – or hand today's back; the ground keeps whatever the run did to it. */
  function setAirRemoved(removed) {
    if (state.airRemoved === removed) return;
    state.airRemoved = removed;
    world = removed ? P.removeAtmosphere(world) : P.restoreAtmosphere(world);
    if (removed) {
      steam = 1;
      // this story plays out in thousands to millions of years, so the clock slows down for it
      setTimeLapse(P.CLOCK.timeLapse.removedMyrPerS);
    }
    syncAirButton();
    syncFieldButton();
    refresh();
  }
  function setVolcanoes(on) {
    if (state.volcanoes === on) return;
    state.volcanoes = on;
    volcanoToggle.setChecked(on, { silent: true });
    syncFieldButton();
    refresh();
  }
  function setTimeLapse(myrPerS, { fromSlider = false } = {}) {
    const { minMyrPerS, maxMyrPerS } = P.CLOCK.timeLapse;
    state.timeLapse = clamp(myrPerS, minMyrPerS, maxMyrPerS);
    if (!fromSlider) timeLapseSlider.setValue(Math.log10(state.timeLapse), { silent: true });
    updateReadouts(true);
  }
  /** Scrub the clock: the world is re-run from today under the settings set now, held constant. */
  function setElapsed(yr, { fromSlider = false } = {}) {
    world = P.historyAt(settings(), yr, { airRemoved: state.airRemoved });
    if (!fromSlider) syncClockSlider(true);
    refresh();
  }
  function syncClockSlider(force = false) {
    const scrubbing = scrubPointer || performance.now() - scrubKeyAt < 1500;
    if (scrubbing && !force) return;
    const u = sliderFromClock(world.elapsedYr);
    if (u !== clockSlider.value) clockSlider.setValue(u, { silent: true });
  }
  function launchCme() {
    if (sim.reducedMotion) {
      staticStorm = !staticStorm;
      syncCmeButton();
      refresh();
      return;
    }
    if (cme) return;
    cme = { t: 0, x: WIND_START_X, impacted: false, sinceImpact: 0 };
    syncCmeButton();
    sim.requestRender();
  }

  // =============================================================================================
  // control panel
  // =============================================================================================
  // while the panel is open on a wide screen the picture slides left, so what the
  // simulation shows stays centred in the free part of the canvas
  const viewShift = createPanelShift({ sim, viewport });
  const panel = createPanel({
    onToggle: () => viewShift.sync(),
    onReset: reset,
    camera: { views: CAMERA_VIEWS, onSelect: (id) => setCamera(id) },
  });
  const isSmallScreen = window.matchMedia('(max-width: 720px)').matches;

  // --- controls: the shield switch and the wind up front, the rest folded away ---------------------
  // the two switches side by side, and one notice that says what the flipped ones do
  const fieldButton = createButton({ labelKey: `${KEYS}.controls.fieldOff`, icon: '🧲', slim: true, onClick: () => setFieldOn(!state.fieldOn) });
  const airButton = createButton({ labelKey: `${KEYS}.controls.removeAir`, icon: '🌫', slim: true, onClick: () => setAirRemoved(!state.airRemoved) });
  const cmeButton = createButton({ labelKey: `${KEYS}.controls.launchCme`, icon: '☀', variant: 'primary', slim: true, onClick: launchCme });
  const switchRow = el('div', 'lp-button-row lp-button-row--split');
  switchRow.append(fieldButton.el, airButton.el, cmeButton.el);
  // what the flipped switches do is explained inside the conditions box below, as its own row
  const switchNotice = el('div', 'lp-conditions__row lp-conditions__note', { role: 'status', hidden: true });
  const volcanoToggle = createToggle({ labelKey: `${KEYS}.controls.volcanoes`, checked: state.volcanoes, onChange: (v) => setVolcanoes(v) });
  const densitySlider = createSlider({
    labelKey: `${KEYS}.controls.density`,
    unitKey: 'units.perCubicCentimeter',
    min: P.DENSITY_RANGE.min,
    max: P.DENSITY_RANGE.max,
    step: 1,
    value: state.density,
    decimals: 0,
    onChange: (v) => setDensity(v, { fromSlider: true }),
  });
  const densityRow = createControlRow(densitySlider, createResetButton({ onClick: () => setDensity(DEFAULTS.density) }));
  const speedSlider = createSlider({
    labelKey: `${KEYS}.controls.speed`,
    unitKey: 'units.kilometersPerSecond',
    min: P.SPEED_RANGE.min,
    max: P.SPEED_RANGE.max,
    step: 25,
    value: state.speed,
    decimals: 0,
    onChange: (v) => setSpeed(v, { fromSlider: true }),
  });
  const speedRow = createControlRow(speedSlider, createResetButton({ onClick: () => setSpeed(DEFAULTS.speed) }));

  // --- the unshielded clock: how fast it runs, and where it stands ---------------------------------
  const timeLapseSlider = createSlider({
    labelKey: `${KEYS}.controls.timeLapse`,
    min: Math.log10(P.CLOCK.timeLapse.minMyrPerS),
    max: Math.log10(P.CLOCK.timeLapse.maxMyrPerS),
    step: 0.05,
    value: Math.log10(state.timeLapse),
    format: (u) => t(`${KEYS}.controls.timeLapseValue`, { n: formatYears(Math.pow(10, u) * 1e6) }),
    onChange: (u) => setTimeLapse(Math.pow(10, u), { fromSlider: true }),
  });
  const timeLapseRow = createControlRow(timeLapseSlider, createResetButton({ onClick: () => setTimeLapse(DEFAULTS.timeLapse) }));
  const clockSlider = createSlider({
    labelKey: `${KEYS}.controls.elapsed`,
    min: 0,
    max: CLOCK_SLIDER_STEPS,
    step: 1,
    value: 0,
    format: (u) => formatYears(clockFromSlider(u)),
    onChange: (u) => setElapsed(clockFromSlider(u), { fromSlider: true }),
  });
  clockSlider.input.addEventListener('pointerdown', () => {
    scrubPointer = true;
  });
  const endScrub = () => {
    scrubPointer = false;
  };
  window.addEventListener('pointerup', endScrub);
  window.addEventListener('pointercancel', endScrub);
  disposers.push(() => {
    window.removeEventListener('pointerup', endScrub);
    window.removeEventListener('pointercancel', endScrub);
  });
  clockSlider.input.addEventListener('keydown', () => {
    scrubKeyAt = performance.now();
  });
  // the clock has no play button of its own – it runs whenever the planet is left unshielded,
  // so what its scrub bar needs is the way back: today, before any of this happened
  const clockRow = createControlRow(clockSlider, createResetButton({ labelKey: `${KEYS}.controls.elapsedReset`, onClick: () => setElapsed(0) }));
  const clockControls = el('div', 'lp-clock');
  clockControls.append(timeLapseRow.el, clockRow.el);

  const moreControls = createCollapsibleSection({ titleKey: `${KEYS}.sections.more`, open: false });

  const view = createViewToggles({ state, prefs: viewPrefs, defaults: VIEW_DEFAULTS, onChange: refresh });
  const viewToggle = (name, labelKey) => view.toggle(name, labelKey);
  const toggles = {
    showFieldLines: viewToggle('showFieldLines', `${KEYS}.controls.fieldLines`),
    showBoundaries: viewToggle('showBoundaries', `${KEYS}.controls.boundaries`),
    showAurora: viewToggle('showAurora', `${KEYS}.controls.aurora`),
  };
  const labelsToggle = viewToggle('showLabels', `${KEYS}.controls.labels`);
  const cameraRow = el('div', 'lp-presets lp-presets--3 lp-presets--compact', { role: 'group' });
  bindAttr(cameraRow, { 'aria-label': `${KEYS}.controls.camera` });
  const cameraButtons = CAMERA_VIEWS.map(({ id, labelKey }) => {
    const btn = createButton({ labelKey, onClick: () => setCamera(id) });
    btn.el.classList.add('lp-presets__btn');
    cameraRow.append(btn.el);
    return { id, el: btn.el };
  });
  function syncCameraButtons({ announce = false } = {}) {
    for (const { id, el: btn } of cameraButtons) btn.setAttribute('aria-pressed', String(cameraMode === id));
    panel.setCameraView(cameraMode, { announce });
  }

  if (sim.reducedMotion) moreControls.add(createNotice({ textKey: 'motion.reducedNotice' }));
  moreControls.add(
    densityRow, speedRow, volcanoToggle, clockControls, cameraRow,
    toggles.showFieldLines, toggles.showBoundaries, toggles.showAurora, labelsToggle,
  );

  // --- readouts: the state of the shield and of the planet, then every number behind them ----------
  // One box for the current conditions: the geomagnetic index the scene drives, and what is left of
  // the air – both always on show, so the two switches can be compared at a glance.
  const conditions = el('div', 'lp-readout lp-readout--conditions');
  const stormRow = el('div', 'lp-conditions__row');
  const stormKpValue = el('div', 'lp-readout__value', { 'aria-live': 'off' });
  const stormPill = el('span', 'lp-state');
  const stormPhase = el('span', 'lp-state lp-state--phase', { hidden: true });
  stormRow.append(bindText(el('div', 'lp-readout__label'), `${KEYS}.storm.kp`), stormKpValue, stormPill, stormPhase);
  const worldRow = el('div', 'lp-conditions__row');
  const worldValue = el('div', 'lp-readout__value', { 'aria-live': 'off' });
  const worldPill = el('span', 'lp-state');
  const worldNote = el('span', 'lp-state lp-state--phase', { hidden: true });
  worldRow.append(bindText(el('div', 'lp-readout__label'), `${KEYS}.world.atmosphere`), worldValue, worldPill, worldNote);
  conditions.append(stormRow, worldRow, switchNotice);
  const facts = createFacts([
    ['pressure', `${KEYS}.facts.pressure`],
    ['ratio', `${KEYS}.facts.pressureRatio`],
    ['standoff', `${KEYS}.facts.standoff`],
    ['bowShock', `${KEYS}.facts.bowShock`],
    ['transit', `${KEYS}.facts.transit`],
    ['aurora', `${KEYS}.storm.aurora`],
    ['geosync', `${KEYS}.storm.geosync`],
    ['elapsed', `${KEYS}.world.elapsed`],
    ['surfacePressure', `${KEYS}.world.pressure`],
    ['strip', `${KEYS}.world.strip`],
    ['outgas', `${KEYS}.world.outgas`],
    ['weather', `${KEYS}.world.weather`],
    ['net', `${KEYS}.world.net`],
    ['temp', `${KEYS}.world.temp`],
    ['radiation', `${KEYS}.world.radiation`],
    ['air', `${KEYS}.world.air`],
    ['ice', `${KEYS}.world.ice`],
    ['ocean', `${KEYS}.world.ocean`],
  ]);
  const legend = createLegend([
    [`${KEYS}.legend.fieldLines`, COLORS.fieldInner],
    [`${KEYS}.legend.compressed`, COLORS.fieldCompressed],
    [`${KEYS}.legend.magnetopause`, COLORS.magnetopause],
    [`${KEYS}.legend.bowShock`, COLORS.bowShock],
    [`${KEYS}.legend.wind`, COLORS.windCold],
    [`${KEYS}.legend.sheath`, COLORS.windHot],
    [`${KEYS}.legend.cme`, COLORS.cmeCold],
    [`${KEYS}.legend.aurora`, COLORS.aurora],
    [`${KEYS}.legend.erosion`, COLORS.erosion],
  ]);

  const infoCard = createInfoCard({ titleKey: `${KEYS}.info.title`, bodyKey: `${KEYS}.info.body`, open: !isSmallScreen });
  const physicsCard = createPhysicsCard();
  panel.add(
    switchRow, moreControls,
    bindText(el('p', 'lp-subheading'), `${KEYS}.conditions.title`), conditions, facts,
    legend, infoCard, physicsCard,
  );
  container.append(panel.el);
  viewShift.attach(panel);
  disposers.push(viewShift.dispose);

  const hint = el('div', 'lp-sim__hint', { 'aria-hidden': 'true' });
  hint.append(bindText(el('span'), 'panel.hint'), document.createTextNode(' · '), bindText(el('span'), `${KEYS}.hint`));
  const credit = el('div', 'lp-sim__credit');
  const creditLink = el('a', '', { href: 'https://www.solarsystemscope.com/textures/', target: '_blank', rel: 'noopener noreferrer license' });
  bindText(creditLink, `${KEYS}.credit`);
  credit.append(creditLink);
  container.append(hint, credit);

  function syncFieldButton() {
    fieldButton.setIcon(state.fieldOn ? '🧲' : '⚠');
    fieldButton.setLabel(state.fieldOn ? `${KEYS}.controls.fieldOff` : `${KEYS}.controls.fieldOn`);
    fieldButton.el.classList.toggle('lp-button--primary', !state.fieldOn);
    fieldButton.el.classList.toggle('lp-button--ghost', state.fieldOn);
    syncSwitchNotice();
    syncWorldVisibility();
    toggles.showFieldLines.el.hidden = !state.fieldOn;
    toggles.showBoundaries.el.hidden = !state.fieldOn;
    toggles.showAurora.el.hidden = !state.fieldOn;
  }

  function syncAirButton() {
    airButton.setIcon(state.airRemoved ? '↩' : '🌫');
    airButton.setLabel(state.airRemoved ? `${KEYS}.controls.restoreAir` : `${KEYS}.controls.removeAir`);
    airButton.el.classList.toggle('lp-button--primary', state.airRemoved);
    airButton.el.classList.toggle('lp-button--ghost', !state.airRemoved);
    syncSwitchNotice();
  }

  /** One warning for whatever is switched off: the field, the air, or both. */
  function syncSwitchNotice() {
    const key = !state.fieldOn && state.airRemoved ? 'both' : !state.fieldOn ? 'fieldOff' : state.airRemoved ? 'airRemoved' : null;
    switchNotice.hidden = !key;
    conditions.classList.toggle('is-switched', !!key);
    if (key) switchNotice.textContent = t(`${KEYS}.warn.${key}`);
  }

  /** The clock's sliders appear once there is a history to run or to scrub. */
  function syncWorldVisibility() {
    clockControls.hidden = !(clockRunning() || world.elapsedYr > 0);
  }

  function syncCmeButton() {
    const running = staticStorm || !!cme;
    cmeButton.setLabel(running ? `${KEYS}.controls.cmeRunning` : `${KEYS}.controls.launchCme`);
    cmeButton.el.disabled = !!cme && !sim.reducedMotion;
    cmeButton.el.setAttribute('aria-pressed', String(running));
  }

  /** The panel header's reset: the simulation's parameters and the display toggles alike. */
  function reset() {
    Object.assign(state, DEFAULTS);
    view.reset();
    cme = null;
    staticStorm = false;
    time = 0;
    windPhase = 0;
    erosionPhase = 0;
    earthSpin.rotation.y = 0;
    world = P.todayWorld();
    steam = 0;
    densitySlider.setValue(state.density, { silent: true });
    speedSlider.setValue(state.speed, { silent: true });
    timeLapseSlider.setValue(Math.log10(state.timeLapse), { silent: true });
    volcanoToggle.setChecked(state.volcanoes, { silent: true });
    syncClockSlider(true);
    syncAirButton();
    syncFieldButton();
    syncCmeButton();
    setCamera('side');
    model = derive();
    syncVisuals(null);
    refresh();
  }

  // =============================================================================================
  // readouts
  // =============================================================================================
  let lastReadoutKey = '';
  function updateReadouts(force = false) {
    const m = model;
    const w = m.world;
    const key = [
      state.fieldOn,
      m.pressureNPa.toFixed(2),
      m.standoff.toFixed(2),
      m.kp.toFixed(2),
      m.phase,
      m.level,
      m.speed.toFixed(0),
      m.density.toFixed(0),
      w.stage,
      w.pressureHPa.toPrecision(3),
      w.co2Fraction.toFixed(2),
      w.elapsedYr.toPrecision(3),
      w.meanC.toFixed(0),
      w.water.toFixed(3),
      w.capLatDeg.toFixed(0),
      w.doseMSvYr.toPrecision(2),
      w.weatherKgS.toPrecision(2),
      w.beyondSun,
      state.volcanoes,
      state.airRemoved,
    ].join('|');
    if (!force && key === lastReadoutKey) return;
    lastReadoutKey = key;
    updateWorldReadouts(w);

    facts.set('pressure', `${fmt(m.pressureNPa, m.pressureNPa < 10 ? 2 : 1, 1)} ${t('units.nanopascal')}`);
    facts.set('ratio', `${fmt(m.pressureRatio, m.pressureRatio < 10 ? 1 : 0, 1)}×`);
    const noBoundary = t(`${KEYS}.storm.noBoundary`);
    const noWind = t(`${KEYS}.storm.noWind`);
    const hasWind = Number.isFinite(m.standoff);
    facts.set('standoff', !state.fieldOn ? noBoundary : !hasWind ? noWind : `${fmt(m.standoff, 1, 1)} ${t('units.earthRadii')} · ${fmt(m.standoffKm, 0)} ${t('units.kilometers')}`);
    facts.set('bowShock', !state.fieldOn ? noBoundary : !hasWind ? noWind : `${fmt(m.bowShock, 1, 1)} ${t('units.earthRadii')}`);
    facts.set('transit', m.density > 0 && Number.isFinite(m.transitHours) ? formatDuration(m.transitHours) : noWind);

    if (state.fieldOn) {
      stormKpValue.textContent = `Kp ${fmt(m.kp, 1, 1)}`;
      stormPill.textContent = t(`${KEYS}.storm.level.${m.level}`);
      stormPill.className = `lp-state lp-state--kp-${m.level}`;
      facts.set('aurora', w.fraction < 0.02 ? t(`${KEYS}.storm.noGlow`) : m.auroraIntensity <= 0 ? t(`${KEYS}.storm.noOval`) : `${fmt(m.aurora.equatorwardLatDeg, 1, 1)}° ${t(`${KEYS}.storm.latitude`)}`);
      facts.set('geosync', t(`${KEYS}.storm.${m.geosyncExposed ? 'geosyncExposed' : 'geosyncSafe'}`));
    } else {
      stormKpValue.textContent = '—';
      stormPill.textContent = t(`${KEYS}.storm.level.unshielded`);
      stormPill.className = 'lp-state lp-state--kp-unshielded';
      facts.set('aurora', t(`${KEYS}.storm.noOval`));
      facts.set('geosync', t(`${KEYS}.storm.geosyncExposed`));
    }
    conditions.classList.toggle('is-storm', m.cmeActive || m.kp >= 4.5);
    stormPhase.hidden = m.phase === 'none';
    if (m.phase !== 'none') stormPhase.textContent = t(`${KEYS}.storm.phase.${m.phase}`);
  }

  function updateWorldReadouts(w) {
    syncWorldVisibility();
    const K = `${KEYS}.world`;
    const pct = w.fraction * 100;
    worldValue.textContent = `${fmt(pct, pct < 1 ? 2 : pct < 10 ? 1 : 0)} %`;
    worldPill.textContent = t(`${K}.stage.${w.stage}`);
    worldPill.className = `lp-state lp-state--world-${w.stage}`;
    // a stopped clock is only worth a word once it has run
    const note = clockRunning() ? (w.beyondSun ? 'beyondSun' : null) : w.elapsedYr > 0 ? 'halted' : null;
    worldNote.hidden = !note;
    if (note) worldNote.textContent = t(`${K}.${note}`);
    conditions.classList.toggle('is-airless', w.airless);

    facts.set('elapsed', formatYears(w.elapsedYr));
    const pressure = w.pressureHPa < 1 ? `${fmt(w.pressureHPa * 100, 1)} Pa` : `${fmt(w.pressureHPa, w.pressureHPa < 10 ? 1 : 0)} ${t('units.hectopascal')}`;
    facts.set('surfacePressure', w.co2Fraction >= 0.005 ? `${pressure} · ${t(`${K}.co2Share`, { n: fmt(w.co2Fraction * 100, w.co2Fraction < 0.1 ? 1 : 0) })}` : pressure);
    // the three flows that make the budget – blank where nothing flows
    facts.set('strip', state.fieldOn ? t(`${K}.none`) : formatRate(w.stripKgS));
    facts.set('outgas', state.volcanoes ? formatRate(w.outgasKgS) : t(`${K}.none`));
    facts.set('weather', w.weatherKgS > 0.05 ? formatRate(w.weatherKgS) : t(`${K}.none`));
    facts.set('net', Math.abs(w.netKgS) < 0.05 ? t(`${K}.balanced`) : `${w.netKgS > 0 ? '+' : '−'}${formatRate(Math.abs(w.netKgS))}`);
    const degC = (k) => `${fmt(k - 273.15, 0)} ${t('units.celsius')}`;
    facts.set(
      'temp',
      w.airless && w.migration > 0.5
        ? t(`${K}.tempAirless`, { mean: degC(w.meanK), noon: degC(w.bare.noonK), night: degC(w.bare.nightK) })
        : t(`${K}.tempMean`, { mean: degC(w.meanK) }),
    );
    const dose = w.doseMSvYr < 10 ? fmt(w.doseMSvYr, w.doseMSvYr < 1 ? 2 : 1) : fmt(w.doseMSvYr, 0);
    const storms = w.fraction < 0.1 ? ` · ${t(`${K}.${state.fieldOn ? 'stormsPolar' : 'stormsEverywhere'}`)}` : '';
    facts.set('radiation', `${dose} ${t('units.millisievertPerYear')}${storms}`);
    const altitude = fmt(Math.min(w.altitudeM, 99999), 0);
    const airKey = `${K}.air${w.breathability[0].toUpperCase()}${w.breathability.slice(1)}`;
    facts.set('air', w.breathability === 'none' || w.breathability === 'toxic' ? t(airKey) : t(airKey, { alt: altitude }));
    if (w.migration > 0.5) facts.set('ice', t(`${K}.caps`, { lat: fmt(w.capLatDeg, 0) }));
    else if (w.airless || w.climate.snowball) facts.set('ice', t(`${K}.frozenOver`));
    else facts.set('ice', t(`${K}.iceTo`, { lat: fmt(w.climate.iceLineLatDeg, 0) }));
    let ocean;
    if (w.stage === 'decompression') ocean = t(`${K}.oceanBoiling`);
    else if (w.migration > 0.5) ocean = t(w.airless ? `${K}.oceanCaps` : `${K}.oceanMelting`);
    else if (w.airless) ocean = t(`${K}.oceanMigrating`);
    else ocean = t(`${K}.${w.climate.snowball ? 'oceanFrozen' : 'oceanLiquid'}`);
    const lost = (1 - w.water) * 100;
    if (lost >= 0.05) ocean += ` · ${t(`${K}.waterLost`, { n: fmt(lost, lost < 10 ? 1 : 0) })}`;
    facts.set('ocean', ocean);
  }

  // --- language ---------------------------------------------------------------------------------
  function syncLabelText() {
    labels.sun.setText(t(`${KEYS}.labels.sun`));
    labels.bowShock.setText(t(`${KEYS}.labels.bowShock`));
    labels.magnetopause.setText(t(`${KEYS}.labels.magnetopause`));
    labels.tail.setText(t(`${KEYS}.labels.magnetotail`));
    labels.north.setText(t(`${KEYS}.labels.north`));
    labels.south.setText(t(`${KEYS}.labels.south`));
  }
  disposers.push(
    onLanguageChange(() => {
      syncLabelText();
      densitySlider.setValue(densitySlider.value, { silent: true });
      speedSlider.setValue(speedSlider.value, { silent: true });
      timeLapseSlider.setValue(timeLapseSlider.value, { silent: true });
      clockSlider.setValue(clockSlider.value, { silent: true });
      syncFieldButton();
      syncAirButton();
      syncCmeButton();
      physicsCard.render();
      updateReadouts(true);
      sim.requestRender();
    }),
  );

  // --- go ----------------------------------------------------------------------------------------
  syncLabelText();
  model = derive();
  syncVisuals(null);
  rebuildFieldLines({ ...model.env });
  syncAirButton();
  syncFieldButton();
  syncCmeButton();
  syncCameraButtons();
  refresh();
  sim.start();

  // dev-only hook for automated checks; stripped from production builds
  if (import.meta.env.DEV) {
    window.__lpMagnetosphere = {
      sim,
      state,
      get model() {
        return model;
      },
      get cme() {
        return cme;
      },
      get time() {
        return time;
      },
      get windPhase() {
        return windPhase;
      },
      get erosionPhase() {
        return erosionPhase;
      },
      get world() {
        return world;
      },
      get visuals() {
        return vis;
      },
      setDensity,
      setSpeed,
      setFieldOn,
      setAirRemoved,
      setVolcanoes,
      setTimeLapse,
      setElapsed,
      launchCme,
      setCamera,
      reset,
      frame,
      refresh,
      windUniforms: wind.uniforms,
      erosionUniforms: erosion.uniforms,
      atmosphereUniforms: atmosphereMaterial.uniforms,
      auroraUniforms: auroraMaterial.uniforms,
      fieldLinePositions: linePositions,
      counts: { wind: WIND_PARTICLES, cme: CME_PARTICLES, erosion: EROSION_PARTICLES, lines: FIELD_LINE_COUNT },
    };
  }

  return () => {
    if (import.meta.env.DEV) delete window.__lpMagnetosphere;
    disposers.forEach((d) => d());
    panel.dispose();
    hint.remove();
    credit.remove();
    for (const l of Object.values(labels)) l.dispose();
    dayPlaceholder.dispose();
    nightPlaceholder.dispose();
    for (const sys of [wind, cmeCloud, erosion]) sys.dispose();
    magnetopause.dispose();
    bowShock.dispose();
    glowTexture.dispose();
    sim.dispose();
    viewport.remove();
  };
}

// ============================================================================================================
// scene building blocks
// ============================================================================================================
/**
 * Points system whose particle positions are evaluated in the vertex shader.
 * mode 0 = steady solar wind, 1 = CME cloud, 2 = atmosphere escaping downwind.
 */
function createParticles({ count, mode, size, cold, hot, rho }) {
  let seed = 20240517 + mode * 7919;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const aRho = new Float32Array(count);
  const aPhi = new Float32Array(count);
  const aSeed = new Float32Array(count);
  const aDepth = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    aRho[i] = rho(rnd);
    if (mode !== 2 && rnd() < MERIDIAN_FRACTION) {
      const side = rnd() < 0.5 ? 0 : Math.PI;
      aPhi[i] = side + (rnd() - 0.5) * 2 * MERIDIAN_SPREAD;
    } else {
      aPhi[i] = rnd() * Math.PI * 2;
    }
    aSeed[i] = rnd();
    aDepth[i] = rnd();
  }
  const geometry = new THREE.BufferGeometry();
  // `position` is required by three.js but unused – the shader builds the point from the attributes below.
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('aRho', new THREE.BufferAttribute(aRho, 1));
  geometry.setAttribute('aPhi', new THREE.BufferAttribute(aPhi, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
  geometry.setAttribute('aDepth', new THREE.BufferAttribute(aDepth, 1));

  const uniforms = {
    uTime: { value: 0 },
    // Distance already travelled along the path, integrated on the CPU (see `frame`). Using
    // an accumulated phase rather than `time × rate` keeps the flow moving downwind when the
    // rate changes: with `time × rate` a falling rate makes the product shrink, and the whole
    // stream visibly runs backwards – which is what a decaying CME used to do.
    uPhase: { value: 0 },
    uStartX: { value: WIND_START_X },
    uLength: { value: WIND_PATH_LENGTH },
    uR0: { value: 10.9 },
    uC: { value: 24 },
    uBsNose: { value: 14.2 },
    uOffset: { value: DEFLECTION_OFFSET },
    uFieldOn: { value: 1 },
    uAtmR: { value: ATMOSPHERE_RADIUS },
    uSize: { value: size },
    uBoost: { value: 1 }, // point-size multiplier (the escaping plume grows with the stripping rate)
    uTail: { value: 0 }, // length of the ion tail the escaping gas follows, in R_E
    uOpacity: { value: 1 },
    uCmeX: { value: WIND_START_X },
    uMode: { value: mode },
    uColdColor: { value: new THREE.Color(cold) },
    uHotColor: { value: new THREE.Color(hot) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: PARTICLE_VERTEX,
    fragmentShader: PARTICLE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // positions live in the shader
  points.renderOrder = 4;
  return {
    points,
    uniforms,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * Paraboloid of revolution ρ² = c·(x_nose − x), evaluated in the vertex shader
 * from a fixed (u, v) grid so that changing the solar wind never touches geometry.
 * The analytic normal of the surface is (c, 2y, 2z).
 */
function createParaboloidSurface({ color, opacity, rings, meridians }) {
  const positions = new Float32Array(SURFACE_NX * SURFACE_NTHETA * 3);
  const indices = [];
  for (let i = 0; i < SURFACE_NX; i++) {
    const u = i / (SURFACE_NX - 1);
    for (let j = 0; j < SURFACE_NTHETA; j++) {
      const v = j / (SURFACE_NTHETA - 1);
      const k = (i * SURFACE_NTHETA + j) * 3;
      positions[k] = u;
      positions[k + 1] = v;
      positions[k + 2] = 0;
      if (i < SURFACE_NX - 1 && j < SURFACE_NTHETA - 1) {
        const a = i * SURFACE_NTHETA + j;
        indices.push(a, a + 1, a + SURFACE_NTHETA, a + 1, a + SURFACE_NTHETA + 1, a + SURFACE_NTHETA);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const uniforms = {
    uNose: { value: 10.9 },
    uC: { value: 24 },
    uTail: { value: -55 },
    uColor: { value: new THREE.Color(color) },
    uOpacity: { value: opacity }, // × fade – the surface dissolves as it recedes beyond the scene
    uRings: { value: rings },
    uMeridians: { value: meridians },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SURFACE_VERTEX,
    fragmentShader: SURFACE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return {
    mesh,
    set({ nose, c, tail, fade = 1 }) {
      uniforms.uNose.value = nose;
      uniforms.uC.value = c;
      uniforms.uTail.value = tail;
      uniforms.uOpacity.value = opacity * fade;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

// ============================================================================================================
// DOM helpers
// ============================================================================================================
function createFacts(rows) {
  const dl = el('dl', 'lp-facts lp-facts--accent lp-facts--wrap');
  const values = new Map();
  for (const [id, labelKey] of rows) {
    const dd = el('dd');
    dl.append(bindText(el('dt'), labelKey), dd);
    values.set(id, dd);
  }
  return {
    el: dl,
    set(id, text) {
      const dd = values.get(id);
      if (dd && dd.textContent !== text) dd.textContent = text;
    },
    dispose() {},
  };
}

function createLegend(items) {
  const wrap = el('div', 'lp-legend');
  for (const [key, color, style] of items) {
    const li = el('div', 'lp-legend__item');
    const swatch = el('span', `lp-legend__swatch${style === 'dashed' ? ' lp-legend__swatch--dashed' : ''}`, { 'aria-hidden': 'true' });
    swatch.style.color = `#${new THREE.Color(color).getHexString()}`;
    li.append(swatch, bindText(el('span'), key));
    wrap.append(li);
  }
  return wrap;
}

/** Collapsible "Physics" card listing the formulas used. */
function createPhysicsCard() {
  const details = el('details', 'lp-info lp-physics');
  const summary = el('summary', 'lp-info__summary');
  summary.append(bindText(el('span', 'lp-info__title'), `${KEYS}.physics.title`));
  const body = el('div', 'lp-info__body');
  details.append(summary, body);
  const entries = ['pressure', 'standoff', 'shue', 'shock', 'kp', 'aurora', 'escape', 'volcanism', 'greenhouse', 'iceLine', 'sublimation', 'radiation'];
  function render() {
    body.replaceChildren();
    // the caveats behind the on-canvas storm index, the CME's scene timing and the unshielded run
    for (const key of [`${KEYS}.storm.schematic`, `${KEYS}.controls.cmeHint`, `${KEYS}.world.schematic`]) {
      const caveat = el('div', 'lp-notice lp-notice--info', { role: 'note' });
      caveat.textContent = t(key);
      body.append(caveat);
    }
    for (const id of entries) {
      const block = el('div', 'lp-formula');
      const label = el('p', 'lp-formula__label');
      label.textContent = t(`${KEYS}.physics.${id}Label`);
      const code = el('code', 'lp-formula__code');
      code.textContent = t(`${KEYS}.physics.${id}Formula`);
      const note = el('p', 'lp-formula__note');
      note.textContent = t(`${KEYS}.physics.${id}Note`);
      block.append(label, code, note);
      body.append(block);
    }
    const scale = el('p', 'lp-formula__note');
    scale.textContent = t(`${KEYS}.physics.scaleNote`);
    body.append(scale);
  }
  render();
  return { el: details, render, dispose() {} };
}

function formatDuration(hours) {
  if (hours >= 48) return t(`${KEYS}.facts.days`, { n: formatNumber(hours / 24, { maximumFractionDigits: 1, minimumFractionDigits: 1 }) });
  return `${formatNumber(hours, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} ${t('units.hours')}`;
}

/** Years on the geological clock: 0 yr, 12 kyr, 1.5 Myr, 4.6 Gyr – and ∞ for a wind that never gets there. */
function formatYears(yr) {
  if (!Number.isFinite(yr)) return '∞';
  const steps = [
    [1e9, 'units.gigayears'],
    [1e6, 'units.millionYears'],
    [1e3, 'units.kyr'],
  ];
  for (const [scale, unit] of steps) {
    if (yr >= scale * 0.9995) {
      const v = yr / scale;
      return `${fmt(v, v < 10 ? 1 : 0)} ${t(unit)}`;
    }
  }
  return `${fmt(yr, 0)} ${t('units.years')}`;
}

/** Mass-loss rate: kg/s up to a tonne, t/s beyond. */
function formatRate(kgS) {
  if (kgS >= 1000) return `${fmt(kgS / 1000, kgS < 1e4 ? 1 : 0)} ${t('units.tonnesPerSecond')}`;
  return `${fmt(kgS, kgS < 10 ? 1 : 0)} ${t('units.kilogramsPerSecond')}`;
}

/** Log-scaled clock slider: 0 is the moment of the switch, then 1 Myr … 100 Gyr. */
function clockFromSlider(u) {
  if (u <= 0) return 0;
  const decades = Math.log10(P.CLOCK.maxYr / CLOCK_SLIDER_MIN_YR);
  return Math.pow(10, Math.log10(CLOCK_SLIDER_MIN_YR) + (decades * u) / CLOCK_SLIDER_STEPS);
}
function sliderFromClock(yr) {
  if (yr < CLOCK_SLIDER_MIN_YR * 0.5) return 0;
  const decades = Math.log10(P.CLOCK.maxYr / CLOCK_SLIDER_MIN_YR);
  return clamp(Math.round((CLOCK_SLIDER_STEPS * (Math.log10(Math.max(yr, CLOCK_SLIDER_MIN_YR)) - Math.log10(CLOCK_SLIDER_MIN_YR))) / decades), 0, CLOCK_SLIDER_STEPS);
}

// ============================================================================================================
// textures / sprites
// ============================================================================================================
/** Screen-space text label whose text can be updated in place. */
function createLabel(color, font, size = 1) {
  const width = 1024;
  const height = 128;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false }));
  sprite.scale.set(0.4 * size, 0.05 * size, 1);
  sprite.renderOrder = 10;
  let currentText = null;
  const currentColor = `#${new THREE.Color(color).getHexString()}`;
  const draw = () => {
    ctx.clearRect(0, 0, width, height);
    ctx.font = `600 56px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(6,9,19,0.85)';
    ctx.strokeText(currentText, width / 2, height / 2);
    ctx.fillStyle = currentColor;
    ctx.fillText(currentText, width / 2, height / 2);
    texture.needsUpdate = true;
  };
  return {
    sprite,
    setText(text) {
      if (text === currentText) return;
      currentText = text;
      draw();
    },
    dispose() {
      texture.dispose();
      sprite.material.dispose();
    },
  };
}

function createGlowTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ============================================================================================================
// shaders
// ============================================================================================================
/** Value noise shared by the Earth shader – the same construction the habitable-zone planet uses. */
const NOISE_GLSL = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0, 0, 0)), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p, int octaves) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 6; i++) {
      if (i >= octaves) break;
      v += a * noise(p);
      p = p * 2.02 + vec3(1.7, 9.2, 3.1);
      a *= 0.5;
    }
    return v;
  }
`;

/**
 * Earth's surface: day map lit by the Sun, city lights on the night side and a soft
 * terminator between them – identical to the other simulations while the shield is on.
 *
 * With the field off the same map is taken through the unshielded run, in the order the
 * physics gives: the vegetation dies back to soil as the CO₂ goes (uVeg), ice grows from the
 * poles behind a ragged front and thickens as the world freezes over (uIceEdge, uDeep), the
 * lights go out (uLights), and once the air is below the triple point the ice between the caps
 * sublimates away (uMigrate, uCapEdge) and leaves dry basins with salt in the deep ones and
 * bare land that rusts and darkens over the aeons (uRust). The rim glow, the soft terminator
 * and the blue night side all thin with the air (uAtm), so the airless world has the hard
 * shadow line of the Moon. Ice is always a layer over the world that is there, never a swap.
 */
const EARTH_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vLocal;
  void main() {
    vUv = uv;
    vLocal = position;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const EARTH_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform sampler2D uNightMap;   // city lights, night side only
  uniform vec3 uSunPos;
  uniform float uAtm;      // air left, 0…1 – rim glow, terminator softness, night-side blue
  uniform float uIceEdge;  // ice where |sin φ| (+ noise) exceeds this; ≥ 1.08 adds nothing, −0.22 freezes the equator
  uniform float uDeep;     // 0…1 how far below −10 °C the world is – thicker, bluer ice
  uniform float uVeg;      // 0 living vegetation … 1 dead
  uniform float uLights;   // city lights 0…1
  uniform float uLandSnow; // 1 snow covers the frozen land, 0.15 only frost – an airless freeze has no weather
  uniform float uMigrate;  // 0…1 low-latitude ice sublimated away to the poles
  uniform float uCapEdge;  // sin(latitude) where the polar caps begin once the air is gone
  uniform float uRust;     // 0…1 oxidised and space-weathered bare surface
  uniform float uHaze;     // 0…1 CO₂ share of the air – its sky scatters paler and warmer
  uniform float uSteam;    // the oceans flashing to vapour the moment the air is gone
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vLocal;
  ${NOISE_GLSL}
  // palette in linear RGB
  const vec3 SOIL_DARK = vec3(0.16, 0.11, 0.06);
  const vec3 SOIL_PALE = vec3(0.36, 0.25, 0.12);
  const vec3 ICE = vec3(0.80, 0.86, 0.92);
  const vec3 ICE_SHADE = vec3(0.45, 0.58, 0.72);
  const vec3 SEA_ICE = vec3(0.60, 0.72, 0.84);
  const vec3 SEA_ICE_DARK = vec3(0.40, 0.54, 0.70);
  const vec3 LEAD = vec3(0.04, 0.09, 0.18);
  const vec3 SEABED = vec3(0.075, 0.058, 0.042);
  const vec3 SEABED_PALE = vec3(0.26, 0.20, 0.13);
  const vec3 SALT = vec3(0.72, 0.68, 0.60);
  const vec3 RUST = vec3(0.34, 0.13, 0.05);
  const vec3 RUST_DARK = vec3(0.14, 0.055, 0.025);
  void main() {
    vec3 p = normalize(vLocal);
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunPos - vWorldPos);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float ndl = dot(N, L);
    vec3 tex = texture2D(uMap, vUv).rgb;
    float lat = abs(p.y);
    float detail = fbm(p * 6.5 + vec3(7.0), 4);
    // what the map shows: land is where blue does not dominate, the paler blues are the shelves
    float land = 1.0 - smoothstep(0.15, 0.5, (tex.b - max(tex.r, tex.g)) / (tex.b + 0.002));
    float lum = dot(tex, vec3(0.333));
    float shelf = smoothstep(0.10, 0.34, lum) * (1.0 - land);
    float green = clamp((tex.g - max(tex.r, tex.b)) * 5.0, 0.0, 1.0);
    float relief = clamp(lum * 4.0, 0.0, 1.0);

    // 1. the living world, and its vegetation dying back to bare soil
    vec3 soil = mix(SOIL_DARK, SOIL_PALE, smoothstep(0.3, 0.75, detail));
    vec3 ground = mix(tex, soil, uVeg * land * (0.45 + 0.55 * green));

    // 2. ice: sea ice criss-crossed by leads, snow on the land, growing from the poles behind a
    //    front the noise makes ragged; young ice lets the water darken it, a deep freeze buries all
    float front = lat + (fbm(p * 3.4 + vec3(17.0, 2.0, 41.0), 4) - 0.5) * 0.28;
    float iced = smoothstep(uIceEdge - 0.07, uIceEdge + 0.07, front);
    vec3 frozen = ground;
    if (iced > 0.001) {
      float leadField = fbm(p * 7.0 + vec3(21.0, 3.0, 8.0), 4);
      float leads = pow(1.0 - abs(leadField * 2.0 - 1.0), 18.0) * (1.0 - uDeep * 0.7);
      vec3 seaIce = mix(SEA_ICE, SEA_ICE_DARK, smoothstep(0.4, 0.7, fbm(p * 3.5 + vec3(9.0), 3)) * 0.6);
      float pack = mix(0.78, 1.0, uDeep) * (1.0 - leads * 0.85);
      vec3 icedSea = mix(mix(ground, LEAD, leads * 0.5), seaIce, pack);
      float cover = clamp(mix(0.55, 1.0, uDeep) + (relief - 0.5) * 0.35, 0.0, 1.0) * uLandSnow;
      vec3 snowy = mix(ground, mix(ICE_SHADE, ICE, 0.45 + 0.55 * relief), cover);
      frozen = mix(mix(icedSea, snowy, land), vec3(0.62, 0.74, 0.92), uDeep * 0.25);
    }
    vec3 surf = mix(ground, frozen, iced);

    // 3. no air: between the caps the ice sublimates away to the poles. The basins come up dry –
    //    pale sediment on the shelves, dark floor with salt where the last brine froze in the deeps –
    //    the land is bare soil, and both rust and darken with the aeons; the caps thicken with what
    //    left the tropics.
    float capFront = lat + (fbm(p * 2.6 + vec3(5.0, 23.0, 8.0), 4) - 0.5) * 0.16;
    float inCap = smoothstep(uCapEdge - 0.05, uCapEdge + 0.05, capFront);
    float cleared = uMigrate * (1.0 - inCap);
    if (uMigrate > 0.001) {
      // the map has no bathymetry, so the deeps that held the last brine are a noise field of their own;
      // the salt crusts sit in them as small sharp-edged pans, not as a haze
      float basin = smoothstep(0.42, 0.62, fbm(p * 1.7 + vec3(19.0, 4.0, 27.0), 4)) * (1.0 - shelf);
      float pans = smoothstep(0.58, 0.72, fbm(p * 11.0 + vec3(13.0, 2.0, 6.0), 3)) * (0.35 + 0.65 * basin);
      vec3 seabed = mix(SEABED, SEABED_PALE, shelf) * (0.8 + 0.4 * detail);
      seabed = mix(seabed, SALT, pans * (0.9 - 0.6 * uRust));
      // the land keeps the map's relief under its dead soil
      vec3 dry = mix(seabed, mix(ground, soil, 0.45), land);
      // oxidation is a tint over that structure, and space weathering darkens it
      vec3 tinted = dry * vec3(1.55, 0.92, 0.6) * (0.75 + 0.25 * detail);
      vec3 rusty = mix(dry, mix(tinted, RUST, 0.3), uRust * 0.9);
      surf = mix(surf, rusty, cleared);
      vec3 thick = mix(frozen, mix(ICE_SHADE, ICE, 0.5 + 0.5 * relief), 0.6);
      surf = mix(surf, thick, uMigrate * inCap);
    }

    // lighting: the terminator softens and the night side keeps its blue only while there is air
    float soft = 0.02 + 0.08 * uAtm;
    float day = smoothstep(-0.03 * uAtm, soft, ndl);
    vec3 dayColor = surf * (0.02 + 0.08 * uAtm + 1.05 * clamp(ndl, 0.0, 1.0));
    vec3 nightColor = surf * mix(vec3(0.012, 0.012, 0.014), vec3(0.030, 0.040, 0.075), uAtm);
    vec3 color = mix(nightColor, dayColor, day);

    // the first minutes without air: the warm oceans boil at the surface until an ice lid stops them
    if (uSteam > 0.001) {
      float puff = smoothstep(0.42, 0.7, fbm(p * 4.5 + vec3(uTime * 0.45, uTime * 0.3, 0.0), 3));
      color += vec3(0.9, 0.92, 0.95) * puff * uSteam * (1.0 - land) * (0.25 + 0.75 * day);
    }

    // city lights, fading in across the terminator – and going out as the air goes
    color += texture2D(uNightMap, vUv).rgb * (1.0 - day) * 1.6 * uLights;

    // glints: open water, a little on ice, none on dry rock
    vec3 H = normalize(L + V);
    float open = (1.0 - land) * (1.0 - iced) * (1.0 - cleared);
    float spec = pow(clamp(dot(N, H), 0.0, 1.0), 60.0) * step(0.0, ndl);
    color += vec3(1.0, 0.95, 0.85) * spec * (0.30 * open + 0.12 * iced * (1.0 - cleared));

    // thin atmospheric rim – gone with the air
    float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
    color += mix(vec3(0.25, 0.5, 1.0), vec3(0.85, 0.66, 0.5), uHaze) * rim * (0.15 + 0.5 * day) * uAtm;

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * The atmosphere shell – and, with the field off, the induced ionosphere of an unmagnetised
 * planet. The geometry is the unit sphere; the vertex shader lifts it by `uHeight` (the visible
 * top of the air), presses it down towards the subsolar point (`uSquash`: the ionopause sits at
 * ≈ 300 km over the subsolar point of Venus and ≈ 1000 km at the terminator) and draws the night
 * side out into an ion tail of `uTail` Earth radii. The fragment shader tears plasma clouds off
 * the flanks (`uRip`) that flow tailward – what happens where the wind meets the ionosphere.
 */
const ATMOSPHERE_VERTEX = /* glsl */ `
  uniform float uHeight;   // visible thickness of the air, in Earth radii
  uniform float uSquash;   // 0…1 how far the dayside is pressed down
  uniform float uTail;     // length of the ion tail, in Earth radii
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying vec3 vDir;
  varying float vTail;
  void main() {
    vec3 d = normalize(position);
    float sun = d.x;                                   // the Sun sits towards +x
    float dayside = smoothstep(-0.25, 1.0, sun);
    float h = max(uHeight, 0.004) * (1.0 - 0.6 * uSquash * dayside);
    vec3 p = d * (1.0 + h);
    // the night hemisphere is drawn out downwind: a teardrop that bulges just behind the planet
    // and tapers towards its end
    float t = smoothstep(0.0, 1.0, -sun);
    t *= t;
    p.x -= uTail * t;
    p.yz *= 1.0 + 0.25 * uTail * t * (1.0 - t) - 0.5 * t * t;
    // approximate normal: radial across the tail, tilted downwind along it
    vec3 n = normalize(vec3(d.x * (1.0 - 0.8 * t), d.y, d.z));
    vec4 world = modelMatrix * vec4(p, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * n);
    vViewDir = normalize(cameraPosition - world.xyz);
    vDir = d;
    vTail = t;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const ATMOSPHERE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHotColor;
  uniform float uErosion;  // 1 while the wind hits the air directly
  uniform float uOpacity;  // column density – the mass that is left
  uniform float uTailGlow; // how bright the ion tail is drawn
  uniform float uRip;      // 0…1 how much of the flanks is being torn off in plasma clouds
  uniform float uTime;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying vec3 vDir;
  varying float vTail;
  ${NOISE_GLSL}
  void main() {
    vec3 N = normalize(vNormalW);
    float fres = pow(1.0 - max(dot(N, normalize(vViewDir)), 0.0), 2.2);
    float lit = smoothstep(-0.35, 0.45, vDir.x);
    vec3 col = mix(uColor, uHotColor, uErosion * (0.35 + 0.65 * lit));
    float alpha = uOpacity * fres * (0.25 + 0.9 * lit) * (1.0 + 0.7 * uErosion);

    if (uRip > 0.001) {
      // Plasma clouds: ripples that grow on the flanks and are carried tailward (the coordinates
      // drift towards −x), tearing gaps in the shell that close again downstream. The nose itself
      // is pressed, not torn; the flanks and the near tail shed the most.
      vec3 q = vDir * 5.5 + vec3(uTime * 0.7, 0.0, 0.0);
      float ripple = fbm(q, 3);
      float flank = smoothstep(-0.85, 0.15, vDir.x) * (1.0 - smoothstep(0.6, 0.98, vDir.x));
      float torn = smoothstep(0.62 - 0.22 * uRip, 0.78, ripple) * uRip * (0.35 + 0.65 * flank);
      alpha *= 1.0 - 0.9 * torn;
      col = mix(col, uHotColor, torn * 0.5);
      // the clouds themselves, glowing hot just outside the gaps – bright enough to show face-on
      float edge = 0.62 - 0.22 * uRip;
      float cloud = smoothstep(edge - 0.16, edge - 0.04, ripple) * (1.0 - smoothstep(edge - 0.04, edge + 0.06, ripple));
      alpha += uOpacity * cloud * uRip * flank * 0.7 * (0.55 + 0.45 * fres);
      col = mix(col, uHotColor, cloud * 0.4);
    }

    if (vTail > 0.001) {
      // the ion tail: what is leaving, hot and filamentary, thinning with distance
      vec3 q = vec3(vDir.yz * 6.0, vTail * 4.0 - uTime * 0.9);
      float streak = 0.3 + 0.9 * fbm(q, 3);
      float tail = vTail * (1.0 - 0.75 * vTail) * uTailGlow * streak;
      alpha += uOpacity * tail * (0.35 + 0.5 * fres) * (0.6 + 0.4 * uErosion);
      col = mix(col, uHotColor, vTail * 0.6);
    }
    gl_FragColor = vec4(col * (0.5 + 0.9 * fres), clamp(alpha, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`;

/** Auroral oval: a Gaussian band in colatitude, brightest near magnetic midnight. */
const AURORA_VERTEX = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const AURORA_FRAGMENT = /* glsl */ `
  uniform float uColat;
  uniform float uWidth;
  uniform float uIntensity;
  uniform float uTime;
  varying vec3 vPos;
  void main() {
    vec3 n = normalize(vPos);
    float colat = acos(clamp(n.y, -1.0, 1.0));
    float d = (colat - uColat) / max(uWidth, 1e-3);
    float band = exp(-d * d * 1.25);
    float az = atan(n.z, n.x);                       // 0 towards the Sun, ±π at midnight
    float night = 0.3 + 0.7 * (0.5 - 0.5 * cos(az));
    float curtain = 0.6 + 0.4 * sin(az * 7.0 + uTime * 1.3) * sin(az * 3.0 - uTime * 0.7 + 1.3);
    curtain = max(curtain, 0.2);
    vec3 col = mix(vec3(0.30, 1.0, 0.55), vec3(1.0, 0.35, 0.55), clamp(d * 0.6 + 0.35, 0.0, 1.0));
    float I = 0.3 + 1.15 * uIntensity;
    float a = band * night * curtain * I;
    gl_FragColor = vec4(col * (0.7 + 1.0 * band), clamp(a, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`;

/**
 * Solar-wind / CME / erosion particles. Everything is derived from the four
 * per-particle attributes and the uniforms, so the CPU never touches positions.
 * `uPhase` is the integrated flow distance, so a changing wind speed changes how fast
 * the stream moves, never which way.
 * Deflection: the transverse radius follows ρ(x) = √(ρ∞² + ρ_mp(x + Δ)²), which
 * can never enter the magnetopause and starts bending at the bow shock (Δ).
 */
const PARTICLE_VERTEX = /* glsl */ `
  attribute float aRho;
  attribute float aPhi;
  attribute float aSeed;
  attribute float aDepth;

  uniform float uTime;
  uniform float uPhase;
  uniform float uStartX;
  uniform float uLength;
  uniform float uR0;
  uniform float uC;
  uniform float uBsNose;
  uniform float uOffset;
  uniform float uFieldOn;
  uniform float uAtmR;
  uniform float uSize;
  uniform float uBoost;
  uniform float uTail;
  uniform float uOpacity;
  uniform float uCmeX;
  uniform int uMode;
  uniform vec3 uColdColor;
  uniform vec3 uHotColor;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vSheath;

  float mpRadius(float x) {
    return x >= uR0 ? 0.0 : sqrt(uC * (uR0 - x));
  }
  float bsRadius(float x) {
    return x >= uBsNose ? 0.0 : sqrt(4.0 * uR0 * (uBsNose - x));
  }

  void main() {
    vec3 p;
    bool absorbed = false;
    vColor = uColdColor;
    vAlpha = uOpacity;
    vSheath = 0.0;
    if (uMode == 2) {
      // Escaping gas: picked up at the top of the air on the sunlit side and the flanks, swept round
      // the planet and down the ion tail. It comes off in clouds, not as a steady drizzle – the
      // ionopause sheds plasma in clumps (Venus, Mars) – so the brightness pulses along the stream.
      float s = fract(aSeed + uPhase);
      float sn = sin(aRho);
      vec3 dir = vec3(cos(aRho), sn * cos(aPhi), sn * sin(aPhi));
      float travel = s * s;
      float reach = 6.0 + 8.0 * uTail;
      p = dir * (uAtmR + travel * (4.0 + 2.0 * uTail)) + vec3(-1.0, 0.0, 0.0) * travel * reach;
      float clump = 0.45 + 0.55 * smoothstep(-0.2, 0.8, sin(uPhase * 6.2832 * 3.0 + aSeed * 40.0 + aPhi * 2.0));
      vColor = mix(uColdColor, uHotColor, aDepth);
      vAlpha = uOpacity * (1.0 - s) * (0.35 + 0.65 * aDepth) * clump;
    } else {
      float x;
      float edgeFade = 1.0;
      if (uMode == 1) {
        float lag = aRho / 20.0;
        x = uCmeX - aDepth * 14.0 - lag * lag * 9.0;   // convex leading edge
      } else {
        float s = fract(aSeed + uPhase * (0.85 + 0.3 * aDepth));
        x = uStartX - s * uLength;
        edgeFade = smoothstep(0.0, 0.06, s) * smoothstep(1.0, 0.94, s); // hide the recycling planes
      }
      float rho = aRho;
      if (uFieldOn > 0.5) {
        float rb = mpRadius(x - uOffset * uR0);
        rho = sqrt(aRho * aRho + rb * rb);
      } else {
        // No shield: whatever is aimed at the planet hits it on the dayside and is gone. Behind the
        // planet the wind leaves an empty wake that the flow closes again over a dozen radii, as it
        // does behind the Moon.
        if (aRho < uAtmR && x < 0.0) absorbed = true;
        float fill = smoothstep(0.0, 14.0, -x);
        rho = max(rho - fill * smoothstep(3.0, 1.0, rho), 0.0);
      }
      // magnetosheath = inside the bow shock, outside the magnetopause, not far down the tail
      float bs = bsRadius(x);
      float mp = mpRadius(x);
      float insideShock = bs > 0.0 ? smoothstep(1.22, 0.97, rho / bs) : 0.0;
      float aboveBoundary = smoothstep(0.98, 1.2, rho / max(mp, 1e-3));
      float sheath = insideShock * aboveBoundary * smoothstep(-2.5 * uR0, -0.3 * uR0, x) * step(0.5, uFieldOn);
      float wob = sheath * 0.55;
      float ph = aSeed * 43.0 + uTime * 2.3;
      p = vec3(x + wob * sin(ph) * 0.7, rho * cos(aPhi) + wob * sin(ph * 1.7) * 0.7, rho * sin(aPhi) + wob * cos(ph * 1.3) * 0.7);
      vSheath = sheath;
      vColor = mix(uColdColor, uHotColor, sheath);
      // the shocked, compressed flow that drapes over the magnetopause is what should catch the eye
      vAlpha = uOpacity * edgeFade * (0.42 + 1.3 * sheath);
      if (uFieldOn < 0.5) {
        // no shield: the stream stays visible all the way in and flares as it hits the air – or,
        // with none left, the ground itself
        float hit = smoothstep(4.0, uAtmR, length(p));
        vColor = mix(mix(vColor, vec3(0.85, 0.92, 1.0), 0.45), uHotColor, hit);
        vAlpha *= 1.6 + 2.4 * hit;
      }
    }
    float rr = length(p);
    if (rr < uAtmR || absorbed) {
      // absorbed – hide until the particle is recycled upstream
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uSize * uBoost * (1.0 + 1.1 * vSheath) * (110.0 / max(-mv.z, 0.001)), 1.0, 9.0);
  }
`;

const PARTICLE_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.06, d);
    gl_FragColor = vec4(vColor, a * vAlpha);
    #include <colorspace_fragment>
  }
`;

/** Boundary paraboloid: position and normal are analytic, so nothing is rebuilt. */
const SURFACE_VERTEX = /* glsl */ `
  uniform float uNose;
  uniform float uC;
  uniform float uTail;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying float vXHat;
  varying vec2 vUV;
  void main() {
    float u = position.x;
    float v = position.y;
    float x = mix(uNose, uTail, pow(u, 1.7));
    float rho = sqrt(max(uC * (uNose - x), 0.0));
    float a = v * 6.28318530718;
    vec3 p = vec3(x, rho * cos(a), rho * sin(a));
    vNormalW = normalize(mat3(modelMatrix) * normalize(vec3(uC, 2.0 * p.y, 2.0 * p.z)));
    vec4 world = modelMatrix * vec4(p, 1.0);
    vViewDir = normalize(cameraPosition - world.xyz);
    vXHat = x / max(uNose, 1e-3);
    vUV = vec2(u, v);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SURFACE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uRings;
  uniform float uMeridians;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying float vXHat;
  varying vec2 vUV;
  void main() {
    float fres = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir))), 1.6);
    float fade = smoothstep(-0.85, 0.55, vXHat);        // hint the dayside, dissolve down the tail
    float ring = smoothstep(0.9, 1.0, abs(sin(vUV.x * uRings * 3.14159265)));
    float meridian = smoothstep(0.9, 1.0, abs(sin(vUV.y * uMeridians * 3.14159265)));
    float grid = max(ring, meridian) * 0.4;
    float a = uOpacity * fade * (0.1 + 0.55 * fres + grid);
    gl_FragColor = vec4(uColor * (0.5 + 0.6 * fres), clamp(a, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`;
