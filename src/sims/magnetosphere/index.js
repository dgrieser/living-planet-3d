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
 *  - 10 000 solar-wind particles, 4 000 CME particles and 1 600 escaping
 *    "erosion" particles are single `THREE.Points` objects whose positions are
 *    computed entirely in the vertex shader from a handful of uniforms, so the
 *    per-frame CPU cost is a few uniform writes.
 *  - The magnetopause and bow-shock paraboloids are also evaluated in a vertex
 *    shader from (u, v) parameters, so changing the wind never rebuilds geometry.
 *
 * All quantitative work lives in ./physics.js; this module only maps it to pixels.
 */
import * as THREE from 'three';
import { createScene } from '../../lib/scene.js';
import { createPanel, createPanelShift, createCollapsibleSection, createSlider, createStateToggle, createButton, createInfoCard, createNotice, el } from '../../lib/ui.js';
import { createViewPrefs } from '../../lib/prefs.js';
import { t, bindText, bindAttr, onLanguageChange, formatNumber } from '../../lib/i18n.js';
import * as P from './physics.js';

const KEYS = 'sims.magnetosphere';
const DEG = Math.PI / 180;

const EARTH_RADIUS = 1;
const ATMOSPHERE_RADIUS = 1.045;
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
const EROSION_PARTICLES = 1600;
const WIND_START_X = 28; // upstream spawn plane (just outside the default view)
const WIND_PATH_LENGTH = 72; // spawn plane → far end of the tail
const WIND_RHO_MAX = 18; // radius of the illuminated wind beam
const WIND_BASE_RATE = 0.135; // path fractions per second at 400 km/s
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
});

/** Display toggles – remembered per visitor, see ../../lib/prefs.js. */
const VIEW_DEFAULTS = Object.freeze({
  showFieldLines: true,
  showBoundaries: true,
  showAurora: true,
  showLabels: true,
});

const CAMERA_PRESETS = Object.freeze({
  side: { position: [2, 12, 32], target: [-3, 0, 0] },
  polar: { position: [0.02, 9, 0.01], target: [0, 0, 0] },
  tail: { position: [-52, 13, 24], target: [-16, 0, 0] },
});

const { clamp } = P;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const fmt = (v, digits = 1, min = 0) => formatNumber(v, { maximumFractionDigits: digits, minimumFractionDigits: Math.min(min, digits) });

export default function mount(container, meta) {
  const viewPrefs = createViewPrefs(meta.id, VIEW_DEFAULTS);
  const state = { ...DEFAULTS, ...viewPrefs.values };
  const disposers = [];
  let time = 0; // seconds of animated time
  let cme = null; // { t, x, impacted, sinceImpact }
  let staticStorm = false; // reduced-motion fallback for the CME button
  let model = null;

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

  // --- Earth, atmosphere, light -----------------------------------------------------------------
  const loader = new THREE.TextureLoader();
  const earthMaterial = new THREE.MeshStandardMaterial({ color: 0x1c4696, roughness: 0.9, metalness: 0 });
  loader.load(
    `${TEXTURE_BASE}2k_earth_daymap.jpg`,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = maxAnisotropy;
      earthMaterial.map = tex;
      earthMaterial.color.set(0xffffff);
      earthMaterial.needsUpdate = true;
      sim.requestRender();
    },
    undefined,
    () => console.warn('[magnetosphere] earth texture not available – using flat colour'),
  );

  const earthSpin = new THREE.Group();
  const earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS, 96, 64), earthMaterial);
  earth.name = 'earth';
  earthSpin.add(earth);
  scene.add(earthSpin);

  const sunLight = new THREE.DirectionalLight(0xfff4e2, 2.5);
  sunLight.position.set(1, 0, 0);
  scene.add(sunLight, new THREE.AmbientLight(0x6a7fb0, 0.4));

  const atmosphereMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(COLORS.atmosphere) },
      uHotColor: { value: new THREE.Color(0xff8a5c) },
      uErosion: { value: 0 },
      uOpacity: { value: 1 },
    },
    vertexShader: ATMOSPHERE_VERTEX,
    fragmentShader: ATMOSPHERE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(ATMOSPHERE_RADIUS, 96, 64), atmosphereMaterial);
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
    if (
      !lastLineEnv ||
      Math.abs(env.r0 - lastLineEnv.r0) / lastLineEnv.r0 > 0.0015 ||
      Math.abs(env.alpha - lastLineEnv.alpha) > 0.002 ||
      Math.abs(env.tailStretch - lastLineEnv.tailStretch) > 0.004
    ) {
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
    const r0 = m.standoff;
    const alpha = m.alpha;
    const c = r0 * Math.pow(4, alpha);
    const bsNose = m.bowShock;

    // field lines
    fieldLines.visible = shield && state.showFieldLines;
    if (fieldLines.visible) syncFieldLines(m.env);

    // boundaries
    magnetopause.mesh.visible = shield && state.showBoundaries;
    bowShock.mesh.visible = shield && state.showBoundaries;
    magnetopause.set({ nose: r0, c, tail: -SURFACE_TAIL * r0 });
    bowShock.set({ nose: bsNose, c: 4 * r0, tail: -SURFACE_TAIL * r0 });

    // aurora
    const auroraOn = shield && state.showAurora;
    auroraNorth.visible = auroraOn;
    auroraSouth.visible = auroraOn;
    auroraMaterial.uniforms.uColat.value = m.aurora.centreColat;
    auroraMaterial.uniforms.uWidth.value = Math.max(m.aurora.halfWidth, 0.045);
    auroraMaterial.uniforms.uIntensity.value = m.auroraIntensity * (1 + 0.55 * m.envelope);
    auroraMaterial.uniforms.uTime.value = time;

    // atmosphere reacts to unshielded impact
    atmosphereMaterial.uniforms.uErosion.value = shield ? 0 : 1;

    // particles
    const rate = WIND_BASE_RATE * (m.speed / P.WIND_NOMINAL.speed);
    for (const sys of [wind, cmeCloud, erosion]) {
      const u = sys.uniforms;
      u.uTime.value = time;
      u.uR0.value = r0;
      u.uC.value = c;
      u.uBsNose.value = bsNose;
      u.uFieldOn.value = shield ? 1 : 0;
    }
    wind.uniforms.uRate.value = rate;
    wind.uniforms.uOpacity.value = clamp(0.4 + 0.5 * Math.min(m.density / 30, 1), 0.4, 0.9);
    wind.points.visible = m.density > 0;

    cmeCloud.uniforms.uRate.value = rate;
    cmeCloud.uniforms.uCmeX.value = m.cmeX;
    cmeCloud.uniforms.uOpacity.value = m.cmeOpacity;
    cmeCloud.points.visible = m.cmeOpacity > 0.01;

    erosion.uniforms.uRate.value = 0.16 * (m.speed / P.WIND_NOMINAL.speed);
    erosion.uniforms.uOpacity.value = shield ? 0 : clamp(0.25 + 0.75 * Math.min(m.pressureRatio, 3) / 3, 0.25, 1);
    erosion.points.visible = !shield;

    // labels
    const showLabels = state.showLabels;
    labels.sun.sprite.visible = showLabels;
    labels.bowShock.sprite.visible = showLabels && bowShock.mesh.visible;
    labels.magnetopause.sprite.visible = showLabels && magnetopause.mesh.visible;
    labels.tail.sprite.visible = showLabels && shield;
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

  function refresh() {
    model = derive();
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
  function setCamera(mode) {
    cameraMode = mode;
    syncCameraButtons();
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
        const nose = model ? model.standoff : 10.5;
        cme.x = WIND_START_X + (nose - WIND_START_X) * (travel * travel * (3 - 2 * travel));
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
    model = derive();
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
  const panel = createPanel({ onToggle: () => viewShift.sync() });
  const isSmallScreen = window.matchMedia('(max-width: 720px)').matches;

  // --- controls: the shield switch and the wind up front, the rest folded away ---------------------
  const fieldButton = createButton({ labelKey: `${KEYS}.controls.fieldOff`, icon: '🧲', slim: true, onClick: () => setFieldOn(!state.fieldOn) });
  const fieldRow = el('div', 'lp-button-row lp-button-row--full');
  fieldRow.append(fieldButton.el);
  const fieldOffNotice = createNotice({ textKey: `${KEYS}.warn.fieldOff`, tone: 'warn' });
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

  const cmeButton = createButton({ labelKey: `${KEYS}.controls.launchCme`, icon: '☀', variant: 'primary', slim: true, onClick: launchCme });
  const cmeRow = el('div', 'lp-button-row lp-button-row--full');
  cmeRow.append(cmeButton.el);

  const moreControls = createCollapsibleSection({ titleKey: `${KEYS}.sections.more`, open: !isSmallScreen });

  const viewToggle = (name, labelKey) => createStateToggle({ labelKey, state, name, prefs: viewPrefs, onChange: refresh });
  const toggles = {
    showFieldLines: viewToggle('showFieldLines', `${KEYS}.controls.fieldLines`),
    showBoundaries: viewToggle('showBoundaries', `${KEYS}.controls.boundaries`),
    showAurora: viewToggle('showAurora', `${KEYS}.controls.aurora`),
  };
  const labelsToggle = viewToggle('showLabels', `${KEYS}.controls.labels`);
  const cameraRow = el('div', 'lp-presets lp-presets--3 lp-presets--compact', { role: 'group' });
  bindAttr(cameraRow, { 'aria-label': `${KEYS}.controls.camera` });
  const cameraButtons = ['side', 'polar', 'tail'].map((id) => {
    const btn = createButton({ labelKey: `${KEYS}.controls.camera${id[0].toUpperCase()}${id.slice(1)}`, onClick: () => setCamera(id) });
    btn.el.classList.add('lp-presets__btn');
    cameraRow.append(btn.el);
    return { id, el: btn.el };
  });
  function syncCameraButtons() {
    for (const { id, el: btn } of cameraButtons) btn.setAttribute('aria-pressed', String(cameraMode === id));
  }

  const resetBtn = createButton({ labelKey: 'panel.reset', icon: '↺', onClick: reset });
  const resetRow = el('div', 'lp-button-row lp-button-row--full');
  resetRow.append(resetBtn.el);

  if (sim.reducedMotion) moreControls.add(createNotice({ textKey: 'motion.reducedNotice' }));
  moreControls.add(
    cameraRow,
    toggles.showFieldLines, toggles.showBoundaries, toggles.showAurora, labelsToggle, resetRow,
  );

  // --- readouts: what that wind does to the magnetosphere -----------------------------------------
  // the space-weather readout: the index the whole scene drives, then the numbers behind it
  const stormReadout = el('div', 'lp-readout lp-readout--storm');
  const stormKpValue = el('div', 'lp-readout__value', { 'aria-live': 'off' });
  const stormPill = el('span', 'lp-state');
  const stormPhase = el('span', 'lp-state lp-state--phase', { hidden: true });
  stormReadout.append(bindText(el('div', 'lp-readout__label'), `${KEYS}.storm.kp`), stormKpValue, stormPill, stormPhase);
  // density and speed are the sliders right above, and the boundary rows already carry the standoff
  const stormFacts = createFacts([
    ['pressure', `${KEYS}.facts.pressure`],
    ['ratio', `${KEYS}.facts.pressureRatio`],
    ['standoff', `${KEYS}.facts.standoff`],
    ['bowShock', `${KEYS}.facts.bowShock`],
    ['transit', `${KEYS}.facts.transit`],
    ['aurora', `${KEYS}.storm.aurora`],
    ['geosync', `${KEYS}.storm.geosync`],
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
    fieldRow, fieldOffNotice, densitySlider, speedSlider, cmeRow, moreControls,
    bindText(el('p', 'lp-subheading'), `${KEYS}.storm.title`), stormReadout, stormFacts,
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
    fieldOffNotice.el.hidden = state.fieldOn;
    toggles.showFieldLines.el.hidden = !state.fieldOn;
    toggles.showBoundaries.el.hidden = !state.fieldOn;
    toggles.showAurora.el.hidden = !state.fieldOn;
  }

  function syncCmeButton() {
    const running = staticStorm || !!cme;
    cmeButton.setLabel(running ? `${KEYS}.controls.cmeRunning` : `${KEYS}.controls.launchCme`);
    cmeButton.el.disabled = !!cme && !sim.reducedMotion;
    cmeButton.el.setAttribute('aria-pressed', String(running));
  }

  function reset() {
    Object.assign(state, DEFAULTS);
    cme = null;
    staticStorm = false;
    time = 0;
    earthSpin.rotation.y = 0;
    densitySlider.setValue(state.density, { silent: true });
    speedSlider.setValue(state.speed, { silent: true });
    syncFieldButton();
    syncCmeButton();
    setCamera('side');
    refresh();
  }

  // =============================================================================================
  // readouts
  // =============================================================================================
  let lastReadoutKey = '';
  function updateReadouts(force = false) {
    const m = model;
    const key = [
      state.fieldOn,
      m.pressureNPa.toFixed(2),
      m.standoff.toFixed(2),
      m.kp.toFixed(2),
      m.phase,
      m.level,
      m.speed.toFixed(0),
      m.density.toFixed(0),
    ].join('|');
    if (!force && key === lastReadoutKey) return;
    lastReadoutKey = key;

    stormFacts.set('pressure', `${fmt(m.pressureNPa, m.pressureNPa < 10 ? 2 : 1, 1)} ${t('units.nanopascal')}`);
    stormFacts.set('ratio', `${fmt(m.pressureRatio, m.pressureRatio < 10 ? 1 : 0, 1)}×`);
    const noBoundary = t(`${KEYS}.storm.noBoundary`);
    stormFacts.set('standoff', state.fieldOn ? `${fmt(m.standoff, 1, 1)} ${t('units.earthRadii')} · ${fmt(m.standoffKm, 0)} ${t('units.kilometers')}` : noBoundary);
    stormFacts.set('bowShock', state.fieldOn ? `${fmt(m.bowShock, 1, 1)} ${t('units.earthRadii')}` : noBoundary);
    stormFacts.set('transit', formatDuration(m.transitHours));

    if (state.fieldOn) {
      stormKpValue.textContent = `Kp ${fmt(m.kp, 1, 1)}`;
      stormPill.textContent = t(`${KEYS}.storm.level.${m.level}`);
      stormPill.className = `lp-state lp-state--kp-${m.level}`;
      stormFacts.set('aurora', `${fmt(m.aurora.equatorwardLatDeg, 1, 1)}° ${t(`${KEYS}.storm.latitude`)}`);
      stormFacts.set('geosync', t(`${KEYS}.storm.${m.geosyncExposed ? 'geosyncExposed' : 'geosyncSafe'}`));
    } else {
      stormKpValue.textContent = '—';
      stormPill.textContent = t(`${KEYS}.storm.level.unshielded`);
      stormPill.className = 'lp-state lp-state--kp-unshielded';
      stormFacts.set('aurora', t(`${KEYS}.storm.noOval`));
      stormFacts.set('geosync', t(`${KEYS}.storm.geosyncExposed`));
    }
    stormReadout.classList.toggle('is-storm', m.cmeActive || m.kp >= 4.5);
    stormPhase.hidden = m.phase === 'none';
    if (m.phase !== 'none') stormPhase.textContent = t(`${KEYS}.storm.phase.${m.phase}`);
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
      syncFieldButton();
      syncCmeButton();
      physicsCard.render();
      updateReadouts(true);
      sim.requestRender();
    }),
  );

  // --- go ----------------------------------------------------------------------------------------
  syncLabelText();
  model = derive();
  rebuildFieldLines({ ...model.env });
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
      setDensity,
      setSpeed,
      setFieldOn,
      launchCme,
      setCamera,
      reset,
      frame,
      refresh,
      windUniforms: wind.uniforms,
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
    uRate: { value: 0.14 },
    uStartX: { value: WIND_START_X },
    uLength: { value: WIND_PATH_LENGTH },
    uR0: { value: 10.9 },
    uC: { value: 24 },
    uBsNose: { value: 14.2 },
    uOffset: { value: DEFLECTION_OFFSET },
    uFieldOn: { value: 1 },
    uAtmR: { value: ATMOSPHERE_RADIUS },
    uSize: { value: size },
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
    uOpacity: { value: opacity },
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
    set({ nose, c, tail }) {
      uniforms.uNose.value = nose;
      uniforms.uC.value = c;
      uniforms.uTail.value = tail;
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
  const entries = ['pressure', 'standoff', 'shue', 'shock', 'kp', 'aurora'];
  function render() {
    body.replaceChildren();
    // the caveats behind the on-canvas storm index and the CME's scene timing
    for (const key of [`${KEYS}.storm.schematic`, `${KEYS}.controls.cmeHint`]) {
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
/** Thin translucent shell: fresnel rim, brighter where the Sun hits, hot when the shield is off. */
const ATMOSPHERE_VERTEX = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const ATMOSPHERE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHotColor;
  uniform float uErosion;
  uniform float uOpacity;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vec3 N = normalize(vNormalW);
    float fres = pow(1.0 - max(dot(N, normalize(vViewDir)), 0.0), 2.2);
    float lit = smoothstep(-0.35, 0.45, N.x); // the Sun sits towards +x
    vec3 col = mix(uColor, uHotColor, uErosion * (0.35 + 0.65 * lit));
    float alpha = uOpacity * fres * (0.25 + 0.9 * lit) * (1.0 + 0.7 * uErosion);
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
 * Deflection: the transverse radius follows ρ(x) = √(ρ∞² + ρ_mp(x + Δ)²), which
 * can never enter the magnetopause and starts bending at the bow shock (Δ).
 */
const PARTICLE_VERTEX = /* glsl */ `
  attribute float aRho;
  attribute float aPhi;
  attribute float aSeed;
  attribute float aDepth;

  uniform float uTime;
  uniform float uRate;
  uniform float uStartX;
  uniform float uLength;
  uniform float uR0;
  uniform float uC;
  uniform float uBsNose;
  uniform float uOffset;
  uniform float uFieldOn;
  uniform float uAtmR;
  uniform float uSize;
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
    vColor = uColdColor;
    vAlpha = uOpacity;
    vSheath = 0.0;
    if (uMode == 2) {
      // atmospheric erosion: escape from the sunlit hemisphere, then blow downwind
      float s = fract(aSeed + uTime * uRate);
      float sn = sin(aRho);
      vec3 dir = vec3(cos(aRho), sn * cos(aPhi), sn * sin(aPhi));
      float travel = s * s;
      p = dir * (uAtmR + travel * 14.0) + vec3(-1.0, 0.0, 0.0) * travel * 30.0;
      vColor = mix(uColdColor, uHotColor, aDepth);
      vAlpha = uOpacity * (1.0 - s) * (0.35 + 0.65 * aDepth);
    } else {
      float x;
      float edgeFade = 1.0;
      if (uMode == 1) {
        float lag = aRho / 20.0;
        x = uCmeX - aDepth * 14.0 - lag * lag * 9.0;   // convex leading edge
      } else {
        float s = fract(aSeed + uTime * uRate * (0.85 + 0.3 * aDepth));
        x = uStartX - s * uLength;
        edgeFade = smoothstep(0.0, 0.06, s) * smoothstep(1.0, 0.94, s); // hide the recycling planes
      }
      float rho = aRho;
      if (uFieldOn > 0.5) {
        float rb = mpRadius(x - uOffset * uR0);
        rho = sqrt(aRho * aRho + rb * rb);
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
        // no shield: brighten just before the particle hits the atmosphere
        float hit = smoothstep(4.0, uAtmR, length(p));
        vColor = mix(vColor, uHotColor, hit);
        vAlpha *= 0.6 + 1.6 * hit;
      }
    }
    float rr = length(p);
    if (rr < uAtmR) {
      // absorbed – hide until the particle is recycled upstream
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uSize * (1.0 + 1.1 * vSheath) * (110.0 / max(-mv.z, 0.001)), 1.0, 7.0);
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
