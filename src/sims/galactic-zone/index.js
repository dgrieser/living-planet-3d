/**
 * Simulation: the galactic habitable zone ("galactic-zone") – where in the
 * Milky Way the Sun lives, and why that is a favourable place.
 *
 * Scene (one unit = 1 kly, the galactic plane is y = 0, +y is the north galactic pole):
 *  - A schematic barred spiral built from ~50 000 GPU points in a single
 *    THREE.Points: bar + bulge, four logarithmic arms (two major, two minor), the
 *    Orion spur that carries the Sun, pink HII regions strung along the arm cores
 *    and a smooth exponential disc. Point positions, colours and sizes are
 *    generated once in ./model.js; per frame only a few uniforms change.
 *  - Dressing that makes it read as a galaxy rather than a dot diagram, each a real
 *    constituent placed with the same geometry: a haze of unresolved starlight
 *    (instanced additive billboards), dust lanes as multiplicative extinction on the
 *    concave edge of the arms and in a thin disc, a warm nucleus glow, and ≈150
 *    globular clusters in a static spheroidal halo.
 *  - Three flat overlays at y = 0: the red "hostile core" inside the zone's inner
 *    edge, the translucent green habitable annulus and the blue-grey metal-poor
 *    outer region. Their radii come from the config object, so the zone edges
 *    are adjustable (and the dev hook can rebuild them at run time).
 *  - The Sun is a pulsing gold sprite at 27 kly on the Orion spur. The radius
 *    slider moves it along its azimuth for what-if exploration; the readouts
 *    (zone, period, supernova hazard, heavy-element abundance) follow. The
 *    "conditions in the solar system" box turns the same model into prose: the odds
 *    of ozone-damaging supernovae and comet-shower passages, whether the Sun would
 *    cross spiral arms here, and what a solar system born here would have got in
 *    terms of a Jupiter and radiogenic heat – every figure set in bold.
 *  - Timeline: the spiral pattern rotates rigidly once per 230 Myr and the Sun
 *    orbits with the period of its current radius (flat rotation curve), so at
 *    27 kly it stays on the spur, further in it overtakes the arms, further out
 *    it lags behind.
 *  - Camera: "overview" sits dead centre on the galactic centre; while the panel is open
 *    on a wide screen the picture slides left by half of what the panel covers instead
 *    (a projection offset – the camera stays put). "The Sun" flies down to the Sun's own
 *    height and aims inward along the radius, so the disc lies across the frame as the
 *    band we see from Earth; it drifts slowly until the visitor takes hold of the view.
 *  - Panel: the controls come first – the radius slider with a small "back to 27 kly"
 *    button inline on its right, then a collapsible group holding the timeline slider
 *    with its play/pause button, the camera presets, the view toggles and the overall
 *    reset. The readouts follow in reading order: the conditions box, its follow-up
 *    stats, the legend, "a favourable address" and the model card, which opens with
 *    the schematic caveat that qualifies every relation in it.
 *
 * Everything quantitative lives in ./model.js; this module maps it to pixels.
 */
import * as THREE from 'three';
import { createScene } from '../../lib/scene.js';
import { createPanel, createPanelShift, createCollapsibleSection, createControlRow, createSlider, createStateToggle, createButton, createInfoCard, createNotice, el } from '../../lib/ui.js';
import { createViewPrefs } from '../../lib/prefs.js';
import { t, bindText, bindAttr, onLanguageChange, formatNumber } from '../../lib/i18n.js';
import * as M from './model.js';

const KEYS = 'sims.galacticZone';
const HIT_LAYER = 1;

/** Adjust the picture here – e.g. `createConfig({ zone: { innerKly: 15, outerKly: 30 } })`. */
const CONFIG = M.createConfig({});

const POINT_COUNT = 50000;
const POINT_COUNT_SMALL = 30000; // phones: fewer points keeps the rotation smooth
const HAZE_COUNT = 4000;
const HAZE_COUNT_SMALL = 2000;
const DUST_COUNT = 6000;
const DUST_COUNT_SMALL = 3000;
const TIME_MAX_MYR = 2 * CONFIG.patternPeriodMyr; // the timeline covers two pattern rotations
const ORBIT_SECONDS = 60; // scene seconds for one 230 Myr pattern rotation while playing (6°/s – a subtle turn)
const MYR_PER_SECOND = CONFIG.patternPeriodMyr / ORBIT_SECONDS;

const COLORS = Object.freeze({
  habitable: 0x5ee08c,
  danger: 0xff5a4a,
  metalPoor: 0x7f9bc4,
  sun: 0xffd166,
  sunCore: 0xfff4d0,
  orbit: 0xffd166,
  label: 0xf0f4ff,
  armLabel: 0xbcd3ff,
  centre: 0xffd9a0,
  nucleus: 0xffc98a,
  dust: 0x9a7660,
  globular: 0xf2e2c4,
});
/** Dust transmission at full strength – reddening: red passes, blue is absorbed. */
const DUST_TINT = new THREE.Color(0.55, 0.42, 0.32);

const DEFAULTS = Object.freeze({
  sunRadiusKly: CONFIG.sun.radiusKly,
  timeMyr: 0,
  playing: true,
});

/** Display toggles – remembered per visitor, see ../../lib/prefs.js. */
const VIEW_DEFAULTS = Object.freeze({
  showRing: true,
  showZones: true,
  showArmLabels: true,
});

// dead centre on the galactic centre – the panel is made room for by shifting the
// projection instead (see panelShiftPx below), which leaves the camera where it belongs
const CAMERA_OVERVIEW = Object.freeze({ position: [0, 104, 82], target: [0, 0, 0] });
/**
 * Sun preset: down at the Sun's own height, a step outside it, aimed inward along the
 * radius – the disc lies across the frame as the band we see from Earth, the bulge glows
 * at the far end of it and the Sun burns in the foreground. `lookKly` is how far inward
 * the camera aims (capped so it never overshoots the centre); the lateral offsets shrink
 * with the aspect ratio so the Sun stays in frame on a portrait phone, and `drift` is the
 * slow parallax the view keeps until the visitor takes hold of it.
 */
const SUN_VIEW = Object.freeze({
  outward: 2.4,
  side: 0.75,
  up: 0.5,
  lookKly: 22,
  drift: { side: 0.35, up: 0.15, periodS: 44 },
});

/** Arm labels sit at these radii (kly) along the centre lines. */
const ARM_LABEL_RADII = Object.freeze({ scutumCentaurus: 26, sagittarius: 31, perseus: 41, norma: 36, orion: 30.5 });

const { clamp, TAU } = M;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const fmt = (v, digits = 1, min = 0) => formatNumber(v, { maximumFractionDigits: digits, minimumFractionDigits: Math.min(min, digits) });

export default function mount(container, meta) {
  const viewPrefs = createViewPrefs(meta.id, VIEW_DEFAULTS);
  const state = { ...DEFAULTS, ...viewPrefs.values };
  const disposers = [];
  let time = 0; // seconds of animated time (pulse, twinkle)
  let model = null;
  const isSmallScreen = window.matchMedia('(max-width: 720px)').matches;
  const pointCount = isSmallScreen ? POINT_COUNT_SMALL : POINT_COUNT;
  const hazeCount = isSmallScreen ? HAZE_COUNT_SMALL : HAZE_COUNT;
  const dustCount = isSmallScreen ? DUST_COUNT_SMALL : DUST_COUNT;

  const viewport = el('div', 'lp-sim__viewport');
  container.append(viewport);

  const sim = createScene({
    container: viewport,
    cameraPosition: CAMERA_OVERVIEW.position,
    fov: 45,
    near: 0.1,
    far: 6000,
    stars: { count: 1400, radius: 2600 },
    controls: { minDistance: 0.8, maxDistance: 700 },
  });
  const { scene, camera, renderer, controls } = sim;
  const starfield = scene.getObjectByName('starfield');
  if (starfield) {
    starfield.material.size = 1.0;
    starfield.material.opacity = 0.35; // from outside the Milky Way the background is faint distant galaxies
    starfield.renderOrder = -1; // before the haze, so the dust can dim it too
  }
  controls.target.set(...CAMERA_OVERVIEW.target);
  controls.update();
  const labelFont = getComputedStyle(document.documentElement).getPropertyValue('--lp-font') || 'sans-serif';

  // --- the galaxy -------------------------------------------------------------------------------
  const galaxy = new THREE.Group(); // rotates with the spiral pattern
  scene.add(galaxy);

  const data = M.generateGalaxy(CONFIG, pointCount);
  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  pointGeometry.setAttribute('aColor', new THREE.BufferAttribute(data.colors, 3));
  pointGeometry.setAttribute('aSize', new THREE.BufferAttribute(data.sizes, 1));
  pointGeometry.setAttribute('aPhase', new THREE.BufferAttribute(data.phases, 1));
  const pointUniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uSizeScale: { value: 1.8 },
    uOpacity: { value: 0.8 },
  };
  const pointMaterial = new THREE.ShaderMaterial({
    uniforms: pointUniforms,
    vertexShader: GALAXY_VERTEX,
    fragmentShader: GALAXY_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(pointGeometry, pointMaterial);
  points.frustumCulled = false;
  points.renderOrder = 1;
  galaxy.add(points);

  // --- haze: unresolved starlight (additive billboards, drawn under the stars) -----------------------
  const hazeData = M.generateHaze(CONFIG, hazeCount);
  const hazeUniforms = { uOpacity: { value: 0.07 }, uFade: { value: 1 } };
  const haze = createBillboardCloud({
    count: hazeData.count,
    attributes: { aOffset: [hazeData.positions, 3], aColor: [hazeData.colors, 3], aSize: [hazeData.sizes, 1] },
    material: new THREE.ShaderMaterial({
      uniforms: hazeUniforms,
      vertexShader: HAZE_VERTEX,
      fragmentShader: HAZE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }),
  });
  haze.mesh.renderOrder = 0;
  galaxy.add(haze.mesh);

  // --- dust lanes: extinction billboards (framebuffer × transmission) ------------------------------
  const dustData = M.generateDust(CONFIG, dustCount);
  const dustUniforms = { uTint: { value: DUST_TINT }, uFade: { value: 1 }, uStrength: { value: 0.6 } };
  const dust = createBillboardCloud({
    count: dustData.count,
    attributes: { aOffset: [dustData.positions, 3], aStrength: [dustData.strengths, 1], aSize: [dustData.sizes, 1] },
    material: new THREE.ShaderMaterial({
      uniforms: dustUniforms,
      vertexShader: DUST_VERTEX,
      fragmentShader: DUST_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      // result = framebuffer × fragment colour: the fragment is a transmission, 1 = clear
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    }),
  });
  dust.mesh.renderOrder = 2;
  galaxy.add(dust.mesh);

  // --- nucleus: the bright, warm centre (world-sized sprites, tone mapped with the points) ------------
  const glowTexture = createGlowTexture();
  const nucleusGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: COLORS.nucleus, transparent: true, opacity: 0.2, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
  nucleusGlow.scale.set(9, 9, 1);
  const nucleusCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xfff0d0, transparent: true, opacity: 0.22, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
  nucleusCore.scale.set(2.4, 2.4, 1);
  nucleusGlow.renderOrder = 0;
  nucleusCore.renderOrder = 0;
  scene.add(nucleusGlow, nucleusCore);

  // --- globular clusters: a static spheroidal halo (they do not follow the pattern) -------------------
  const globularData = M.generateGlobularClusters(CONFIG);
  const globularGeometry = new THREE.BufferGeometry();
  globularGeometry.setAttribute('position', new THREE.BufferAttribute(globularData.positions, 3));
  const globularColors = new Float32Array(globularData.count * 3);
  const globularPhases = new Float32Array(globularData.count);
  const globularColor = new THREE.Color(COLORS.globular);
  for (let i = 0; i < globularData.count; i++) {
    globularColors[i * 3] = globularColor.r * 0.95;
    globularColors[i * 3 + 1] = globularColor.g * 0.95;
    globularColors[i * 3 + 2] = globularColor.b * 0.95;
    globularPhases[i] = (i * 0.618) % 1;
  }
  globularGeometry.setAttribute('aColor', new THREE.BufferAttribute(globularColors, 3));
  globularGeometry.setAttribute('aSize', new THREE.BufferAttribute(globularData.sizes, 1));
  globularGeometry.setAttribute('aPhase', new THREE.BufferAttribute(globularPhases, 1));
  const globulars = new THREE.Points(globularGeometry, pointMaterial);
  globulars.frustumCulled = false;
  globulars.renderOrder = 1;
  scene.add(globulars);

  // --- zone overlays (static: they are radial, the pattern rotates underneath) --------------------
  const overlays = createZoneOverlays(CONFIG);
  scene.add(overlays.group);

  // --- the Sun ------------------------------------------------------------------------------------
  const sunGroup = new THREE.Group();
  const sunGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture, color: COLORS.sun, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, sizeAttenuation: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  sunGlow.renderOrder = 6;
  const sunCore = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture, color: COLORS.sunCore, transparent: true, opacity: 1, depthWrite: false, depthTest: false, sizeAttenuation: false, toneMapped: false }),
  );
  sunCore.renderOrder = 7;
  sunCore.scale.set(0.022, 0.022, 1);
  const sunHit = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial());
  sunHit.layers.set(HIT_LAYER);
  sunHit.userData.kind = 'sun';
  sunGroup.add(sunGlow, sunCore, sunHit);
  scene.add(sunGroup);

  // the Sun's orbit – a unit circle in the plane, scaled to the current radius
  const orbitRing = new THREE.LineLoop(
    circleGeometry(1, 256),
    new THREE.LineBasicMaterial({ color: COLORS.orbit, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  orbitRing.renderOrder = 4;
  scene.add(orbitRing);

  // --- labels ------------------------------------------------------------------------------------
  const labels = {
    sun: createLabel(COLORS.sun, labelFont, 0.95),
    centre: createLabel(COLORS.centre, labelFont, 0.85),
    habitable: createLabel(COLORS.habitable, labelFont, 0.85),
    inner: createLabel(COLORS.danger, labelFont, 0.8),
    outer: createLabel(COLORS.metalPoor, labelFont, 0.8),
  };
  const armLabels = {};
  for (const arm of [...CONFIG.arms, CONFIG.spur]) {
    const label = createLabel(COLORS.armLabel, labelFont, 0.8);
    const r = ARM_LABEL_RADII[arm.id] ?? arm.crossKly;
    const phi = M.armAzimuth(r, arm, CONFIG);
    label.sprite.position.set(r * Math.cos(phi), 0.4, r * Math.sin(phi));
    galaxy.add(label.sprite); // rotates with the pattern
    armLabels[arm.id] = label;
  }
  for (const l of Object.values(labels)) scene.add(l.sprite);
  // zone labels sit opposite the Sun so they never collide with it
  const zoneLabelAzimuth = CONFIG.sunAzimuth + Math.PI;
  const placeRadial = (sprite, r) => sprite.position.set(r * Math.cos(zoneLabelAzimuth), 0.3, r * Math.sin(zoneLabelAzimuth));
  placeRadial(labels.habitable.sprite, (CONFIG.zone.innerKly + CONFIG.zone.outerKly) / 2);
  placeRadial(labels.inner.sprite, CONFIG.zone.innerKly * 0.5);
  placeRadial(labels.outer.sprite, (CONFIG.zone.outerKly + CONFIG.discRadiusKly) / 2);
  labels.centre.sprite.position.set(0, 0.5, 0);

  const tmpV = new THREE.Vector3();
  const tmpUp = new THREE.Vector3();
  const sunPos = new THREE.Vector3();

  // =============================================================================================
  // derived model
  // =============================================================================================
  function derive() {
    const sun = M.sunState(state.sunRadiusKly, state.timeMyr, CONFIG);
    return { sun, timeMyr: state.timeMyr, patternOrbits: state.timeMyr / CONFIG.patternPeriodMyr };
  }

  // =============================================================================================
  // scene update
  // =============================================================================================
  function applyModel() {
    const m = model;
    // rotation: positive azimuth is clockwise from above, i.e. a negative rotation about +y
    galaxy.rotation.y = -m.sun.patternAngle;

    sunPos.set(m.sun.radiusKly * Math.cos(m.sun.azimuth), 0, m.sun.radiusKly * Math.sin(m.sun.azimuth));
    sunGroup.position.copy(sunPos);
    const pulse = 1 + 0.22 * Math.sin(time * 3.1);
    sunGlow.scale.set(0.075 * pulse, 0.075 * pulse, 1);
    orbitRing.scale.set(m.sun.radiusKly, 1, m.sun.radiusKly);

    pointUniforms.uTime.value = time;
    overlays.uniforms.uTime.value = time;

    overlays.ring.visible = state.showRing;
    overlays.ringEdges.visible = state.showRing;
    overlays.core.visible = state.showZones;
    overlays.outer.visible = state.showZones;

    labels.habitable.sprite.visible = state.showRing;
    labels.inner.sprite.visible = state.showZones;
    labels.outer.sprite.visible = state.showZones;
    for (const l of Object.values(armLabels)) l.sprite.visible = state.showArmLabels;
    labels.centre.sprite.visible = state.showArmLabels;
  }

  /**
   * Camera-dependent bits: label offsets and sizes, overlay fade, hit-sphere size
   * and the near plane. Labels far beyond the orbit target shrink to half size so
   * the horizon does not fill with text in the Sun's-location view; the flat zone
   * overlays fade when the camera dips into the disc, where a plane through the
   * eye would otherwise wash out half the screen.
   */
  const labelWorld = new THREE.Vector3();
  function updateOverlay() {
    tmpUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const camDist = camera.position.distanceTo(controls.target);
    const sunDist = camera.position.distanceTo(sunPos);
    labels.sun.sprite.position.copy(sunPos).addScaledVector(tmpUp, sunDist * 0.045);
    sunHit.scale.setScalar(clamp(sunDist * 0.012, 0.05, 3));
    for (const l of [...Object.values(labels), ...Object.values(armLabels)]) {
      l.sprite.getWorldPosition(labelWorld);
      l.setScale(clamp(camDist / Math.max(camera.position.distanceTo(labelWorld), 1e-3), 0.5, 1));
    }
    overlays.uniforms.uFade.value = clamp((Math.abs(camera.position.y) - 1.5) / 14, 0.22, 1);
    // inside the disc the resolved stars carry the picture: the haze would stack up along grazing lines of
    // sight and burn out, and the depth-less dust would darken foreground stars – both thin out there
    const camHeight = Math.abs(camera.position.y);
    hazeUniforms.uFade.value = clamp((camHeight - 1.0) / 10, 0.12, 1);
    dustUniforms.uFade.value = clamp((camHeight - 1.0) / 12, 0.2, 1);
    const near = clamp(camDist * 0.01, 0.05, 4);
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

  // --- camera -------------------------------------------------------------------------------------
  let cameraTween = null;
  let cameraMode = 'overview';
  let followAzimuth = 0;
  let sunAutopilot = true; // cleared as soon as the visitor grabs the view themselves

  /** Phase of the slow hands-off drift of the Sun view; frozen for reduced motion. */
  const driftPhase = () => (sim.reducedMotion ? 0 : (time / SUN_VIEW.drift.periodS) * TAU);

  /** The point the Sun view aims at: a stretch of the disc between the Sun and the centre. */
  function sunLookTarget(out) {
    const r = Math.max(sunPos.length(), 1e-6);
    return out.copy(sunPos).multiplyScalar(1 - Math.min(SUN_VIEW.lookKly, r * 0.8) / r).setY(0);
  }

  /** Camera end state for the Sun preset, computed from the Sun's current position. */
  function sunPreset(phase = 0) {
    // a portrait frame sees far less to the sides: pull the Sun back towards the view axis
    const frame = clamp((camera.aspect - 0.55) / 1.05, 0.35, 1);
    const side = (SUN_VIEW.side + SUN_VIEW.drift.side * Math.sin(phase)) * frame;
    const up = (SUN_VIEW.up + SUN_VIEW.drift.up * Math.sin(phase * 0.63 + 1.1)) * frame;
    const outward = tmpV.copy(sunPos).setY(0).normalize();
    const across = new THREE.Vector3(-outward.z, 0, outward.x);
    const position = sunPos.clone().addScaledVector(outward, SUN_VIEW.outward).addScaledVector(across, side);
    position.y += up;
    return { position, target: sunLookTarget(new THREE.Vector3()) };
  }
  function presetFor(mode) {
    if (mode === 'sun') return sunPreset(driftPhase());
    return { position: new THREE.Vector3(...CAMERA_OVERVIEW.position), target: new THREE.Vector3(...CAMERA_OVERVIEW.target) };
  }
  function tweenCamera(mode, { duration = 2.2 } = {}) {
    if (sim.reducedMotion || duration <= 0) {
      const end = presetFor(mode);
      camera.position.copy(end.position);
      controls.target.copy(end.target);
      controls.update();
      updateOverlay();
      sim.requestRender();
      return;
    }
    cameraTween = { from: camera.position.clone(), fromTarget: controls.target.clone(), mode, t: 0, duration };
  }
  function stepTween(dt) {
    if (!cameraTween) return;
    cameraTween.t = Math.min(1, cameraTween.t + dt / cameraTween.duration);
    const k = easeInOut(cameraTween.t);
    const end = presetFor(cameraTween.mode); // re-evaluated: the Sun may be moving
    camera.position.lerpVectors(cameraTween.from, end.position, k);
    controls.target.lerpVectors(cameraTween.fromTarget, end.target, k);
    // arc up a little on the way so the flight reads as a descent into the disc
    camera.position.y += Math.sin(Math.PI * k) * 0.12 * cameraTween.from.distanceTo(end.position);
    if (cameraTween.t >= 1) cameraTween = null;
  }
  /**
   * In "Sun" mode the camera rides along with the Sun. Left alone it stays on the
   * drifting preset; once the visitor has grabbed the view it keeps their angle and
   * distance, rotated with the Sun so the framing does not slide away underneath them.
   */
  function followSun() {
    if (cameraMode !== 'sun' || cameraTween) {
      followAzimuth = model.sun.azimuth;
      return;
    }
    const dAz = model.sun.azimuth - followAzimuth;
    followAzimuth = model.sun.azimuth;
    if (sunAutopilot) {
      const end = sunPreset(driftPhase());
      camera.position.copy(end.position);
      controls.target.copy(end.target);
      return;
    }
    const offset = tmpV.copy(camera.position).sub(controls.target);
    if (Math.abs(dAz) > 1e-9) offset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, -dAz);
    sunLookTarget(controls.target);
    camera.position.copy(controls.target).add(offset);
  }
  function setCamera(mode) {
    cameraMode = mode;
    followAzimuth = model ? model.sun.azimuth : CONFIG.sunAzimuth;
    sunAutopilot = true; // a preset always starts on autopilot again
    syncCameraButtons();
    tweenCamera(mode);
  }

  // =============================================================================================
  // frame
  // =============================================================================================
  let sliderSyncAccumulator = 0;
  function frame(dt) {
    time += dt;
    if (state.playing) {
      state.timeMyr = (state.timeMyr + dt * MYR_PER_SECOND) % TIME_MAX_MYR;
      sliderSyncAccumulator += dt;
      if (sliderSyncAccumulator > 0.1) {
        sliderSyncAccumulator = 0;
        timeSlider.setValue(Math.round(state.timeMyr), { silent: true });
      }
    }
    model = derive();
    applyModel();
    stepTween(dt);
    followSun();
    updateOverlay();
    updateReadouts();
  }
  sim.onFrame(frame);
  const onControlsChange = () => {
    if (sim.reducedMotion) updateOverlay();
  };
  const onControlsStart = () => {
    sunAutopilot = false; // the drift stops the moment the view is touched
  };
  controls.addEventListener('change', onControlsChange);
  controls.addEventListener('start', onControlsStart);
  disposers.push(() => {
    controls.removeEventListener('change', onControlsChange);
    controls.removeEventListener('start', onControlsStart);
  });

  // =============================================================================================
  // state setters
  // =============================================================================================
  function setSunRadius(v, { fromSlider = false } = {}) {
    const { min, max, step } = CONFIG.sunRadiusRangeKly;
    state.sunRadiusKly = clamp(Math.round(v / step) * step, min, max);
    if (!fromSlider) radiusSlider.setValue(state.sunRadiusKly, { silent: true });
    refresh();
    if (cameraMode === 'sun' && !cameraTween && sim.reducedMotion) tweenCamera('sun', { duration: 0 });
  }
  function setTime(v, { fromSlider = false } = {}) {
    state.timeMyr = clamp(v, 0, TIME_MAX_MYR);
    if (!fromSlider) timeSlider.setValue(Math.round(state.timeMyr), { silent: true });
    refresh();
  }
  function setPlaying(v) {
    state.playing = v && !sim.reducedMotion;
    syncPlayButton();
    sim.requestRender();
  }
  /** Rebuild the overlays for new zone edges (used by the dev hook / tests). */
  function setZoneEdges(innerKly, outerKly) {
    CONFIG.zone = { innerKly, outerKly };
    overlays.rebuild(CONFIG);
    placeRadial(labels.habitable.sprite, (innerKly + outerKly) / 2);
    placeRadial(labels.inner.sprite, innerKly * 0.5);
    placeRadial(labels.outer.sprite, (outerKly + CONFIG.discRadiusKly) / 2);
    modelCard.render();
    refresh();
  }

  // =============================================================================================
  // control panel
  // =============================================================================================
  // while the panel is open on a wide screen the picture slides left to keep the galaxy
  // centred in the free part of the canvas – the camera stays on the galactic centre
  const viewShift = createPanelShift({ sim, viewport });
  const panel = createPanel({ onToggle: () => viewShift.sync() });

  // --- controls: the distance slider up front, the rest folded away -------------------------------
  const radiusSlider = createSlider({
    labelKey: `${KEYS}.controls.sunRadius`,
    min: CONFIG.sunRadiusRangeKly.min,
    max: CONFIG.sunRadiusRangeKly.max,
    step: CONFIG.sunRadiusRangeKly.step,
    value: state.sunRadiusKly,
    format: (v) => `${fmt(v * 1000, 0)} ${t('units.lightYears')}`,
    onChange: (v) => setSunRadius(v, { fromSlider: true }),
  });
  const sunHome = createButton({ labelKey: `${KEYS}.controls.sunHome`, icon: '↺', compact: true, onClick: () => setSunRadius(CONFIG.sun.radiusKly) });
  const radiusRow = createControlRow(radiusSlider, sunHome);

  const moreControls = createCollapsibleSection({ titleKey: `${KEYS}.sections.more`, open: !isSmallScreen });
  const timeSlider = createSlider({
    labelKey: `${KEYS}.controls.time`,
    min: 0,
    max: TIME_MAX_MYR,
    step: 1,
    value: state.timeMyr,
    format: (v) => `${fmt(v, 0)} ${t('units.millionYears')}`,
    onChange: (v) => setTime(v, { fromSlider: true }),
  });
  const playBtn = createButton({ labelKey: `${KEYS}.controls.play`, icon: '▶', variant: 'primary', compact: true, onClick: () => setPlaying(!state.playing) });
  const timeRow = createControlRow(timeSlider, playBtn);
  const timeHint = bindText(el('p', 'lp-section__note'), `${KEYS}.controls.timeHint`);

  // no visible heading: the group's aria-label names it and the icons carry the meaning
  const cameraRow = el('div', 'lp-presets lp-presets--2 lp-presets--compact', { role: 'group' });
  bindAttr(cameraRow, { 'aria-label': `${KEYS}.controls.camera` });
  const cameraButtons = ['overview', 'sun'].map((id) => {
    const btn = createButton({ labelKey: `${KEYS}.controls.camera${id[0].toUpperCase()}${id.slice(1)}`, icon: id === 'sun' ? '☉' : '🌌', onClick: () => setCamera(id) });
    btn.el.classList.add('lp-presets__btn');
    cameraRow.append(btn.el);
    return { id, el: btn.el };
  });
  function syncCameraButtons() {
    for (const { id, el: btn } of cameraButtons) btn.setAttribute('aria-pressed', String(cameraMode === id));
  }

  const viewToggle = (name, labelKey) => createStateToggle({ labelKey, state, name, prefs: viewPrefs, onChange: refresh });
  const toggles = {
    showRing: viewToggle('showRing', `${KEYS}.controls.ring`),
    showZones: viewToggle('showZones', `${KEYS}.controls.zones`),
    showArmLabels: viewToggle('showArmLabels', `${KEYS}.controls.armLabels`),
  };

  const resetBtn = createButton({ labelKey: 'panel.reset', icon: '↺', onClick: reset });
  const resetRow = el('div', 'lp-button-row lp-button-row--full');
  resetRow.append(resetBtn.el);

  moreControls.add(timeRow, timeHint);
  if (sim.reducedMotion) moreControls.add(createNotice({ textKey: 'motion.reducedNotice' }));
  moreControls.add(cameraRow, toggles.showRing, toggles.showZones, toggles.showArmLabels, resetRow);

  // --- readouts: the conditions box, its follow-up stats, then the legend -------------------------
  const zoneReadout = el('div', 'lp-readout lp-readout--zone');
  const zoneLabel = bindText(el('div', 'lp-readout__label'), `${KEYS}.conditions.label`);
  const zonePill = el('span', 'lp-state');
  // prose paragraphs: zone hint (outside the zone only), catastrophe odds, spiral arms, birthplace chemistry
  const conditionParagraphs = ['zone', 'hazards', 'arms', 'formation'].map(() => el('p', 'lp-state__hint'));
  zoneReadout.append(zoneLabel, zonePill, ...conditionParagraphs);
  const facts = createFacts([
    ['distance', `${KEYS}.facts.distance`],
    ['period', `${KEYS}.facts.period`],
    ['speed', `${KEYS}.facts.speed`],
    ['galacticYears', `${KEYS}.facts.galacticYears`],
    ['orbits', `${KEYS}.facts.orbits`],
    ['supernova', `${KEYS}.facts.supernova`],
    ['metals', `${KEYS}.facts.metals`],
  ]);
  const legend = createLegend([
    [`${KEYS}.legend.bulge`, 0xffc98a],
    [`${KEYS}.legend.arms`, 0xa9c4ff],
    [`${KEYS}.legend.hii`, 0xff80ad],
    [`${KEYS}.legend.dust`, COLORS.dust, 'dust'],
    [`${KEYS}.legend.globulars`, COLORS.globular, 'dot'],
    [`${KEYS}.legend.habitable`, COLORS.habitable, 'zone'],
    [`${KEYS}.legend.danger`, COLORS.danger, 'zone'],
    [`${KEYS}.legend.metalPoor`, COLORS.metalPoor, 'zone'],
    [`${KEYS}.legend.sun`, COLORS.sun],
    [`${KEYS}.legend.orbit`, COLORS.orbit, 'dashed'],
  ]);

  // --- prose: the essay, then the relations behind the numbers (with the schematic caveat) -------
  const infoCard = createInfoCard({ titleKey: `${KEYS}.info.title`, bodyKey: `${KEYS}.info.body`, open: !isSmallScreen });
  const modelCard = createModelCard(CONFIG);
  panel.add(radiusRow, moreControls, zoneReadout, facts, legend, infoCard, modelCard);
  container.append(panel.el);
  viewShift.attach(panel);
  disposers.push(viewShift.dispose);

  // --- on-canvas: schematic badge, tooltip, hint ---------------------------------------------------
  const badge = el('div', 'lp-schematic-badge', { role: 'note' });
  badge.append(bindText(el('span', 'lp-schematic-badge__tag'), `${KEYS}.schematic.tag`), bindText(el('span', 'lp-schematic-badge__text'), `${KEYS}.schematic.text`));
  container.append(badge);

  const tooltip = el('div', 'lp-tooltip', { role: 'tooltip', hidden: true });
  const tooltipTitle = el('strong', 'lp-tooltip__title');
  const tooltipBody = el('span', 'lp-tooltip__body');
  tooltip.append(tooltipTitle, tooltipBody);
  container.append(tooltip);

  const hint = el('div', 'lp-sim__hint', { 'aria-hidden': 'true' });
  hint.append(bindText(el('span'), 'panel.hint'), document.createTextNode(' · '), bindText(el('span'), `${KEYS}.hint`));
  container.append(hint);

  // --- interaction: hover tooltips over the zones and the Sun ---------------------------------------
  const raycaster = new THREE.Raycaster();
  raycaster.layers.set(HIT_LAYER);
  const pointer = new THREE.Vector2();
  const canvas = renderer.domElement;
  let hoverKind = null;
  let touchTimer = 0;

  function pick(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const sunHits = raycaster.intersectObject(sunHit, false);
    if (sunHits.length) return 'sun';
    const hits = raycaster.intersectObjects(overlays.hitMeshes, false);
    for (const h of hits) {
      const kind = h.object.userData.kind;
      if (kind === 'habitable' && !state.showRing) continue;
      if ((kind === 'inner' || kind === 'outer') && !state.showZones) continue;
      return kind;
    }
    return null;
  }
  function showTooltip(kind, e) {
    const rect = container.getBoundingClientRect();
    tooltipTitle.textContent = t(`${KEYS}.tooltip.${kind}Title`);
    tooltipBody.textContent = kind === 'sun' ? t(`${KEYS}.tooltip.sun`, { distance: fmt(model.sun.radiusLy, 0) }) : t(`${KEYS}.tooltip.${kind}`);
    tooltip.className = `lp-tooltip lp-tooltip--${kind}`;
    tooltip.hidden = false;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const flip = x > rect.width - 280;
    tooltip.style.left = `${flip ? x - 16 : x + 16}px`;
    tooltip.style.top = `${y + 14}px`;
    tooltip.style.transform = flip ? 'translateX(-100%)' : '';
  }
  function hideTooltip() {
    tooltip.hidden = true;
    hoverKind = null;
    canvas.classList.remove('is-grab');
  }
  const onPointerMove = (e) => {
    if (e.pointerType === 'touch') return;
    const kind = pick(e);
    if (kind) {
      hoverKind = kind;
      showTooltip(kind, e);
      canvas.classList.toggle('is-grab', kind === 'sun');
    } else if (hoverKind) {
      hideTooltip();
    }
  };
  const onPointerDown = (e) => {
    if (e.pointerType !== 'touch') return;
    const kind = pick(e);
    if (!kind) return hideTooltip();
    showTooltip(kind, e);
    clearTimeout(touchTimer);
    touchTimer = setTimeout(hideTooltip, 3000);
  };
  const onPointerLeave = () => hideTooltip();
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerleave', onPointerLeave);
  disposers.push(() => {
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    clearTimeout(touchTimer);
  });

  // =============================================================================================
  // readouts
  // =============================================================================================
  function syncPlayButton() {
    playBtn.setIcon(state.playing ? '⏸' : '▶');
    playBtn.setLabel(state.playing ? `${KEYS}.controls.pause` : `${KEYS}.controls.play`);
    playBtn.el.setAttribute('aria-pressed', String(state.playing));
    playBtn.el.disabled = sim.reducedMotion;
  }

  let lastReadoutKey = '';
  function updateReadouts(force = false) {
    const m = model;
    const key = [m.sun.radiusKly, m.sun.zone, m.sun.orbits.toFixed(2)].join('|');
    if (!force && key === lastReadoutKey) return;
    lastReadoutKey = key;

    zonePill.textContent = t(`${KEYS}.status.${m.sun.zone}`);
    zonePill.className = `lp-state lp-state--gz-${m.sun.zone}`;
    updateConditions(m.sun.neighbourhood, m.sun.zone);
    zoneReadout.className = `lp-readout lp-readout--zone is-${m.sun.zone}`;

    facts.set('distance', `${fmt(m.sun.radiusLy, 0)} ${t('units.lightYears')} · ${fmt(m.sun.radiusKpc, 1, 1)} ${t('units.kiloparsec')}`);
    facts.set('period', `${fmt(m.sun.periodMyr, 0)} ${t('units.millionYears')}`);
    facts.set('speed', `${fmt(m.sun.speedKmS, 0)} ${t('units.kilometersPerSecond')}`);
    facts.set('galacticYears', fmt(m.sun.galacticYears, m.sun.galacticYears < 10 ? 1 : 0));
    facts.set('supernova', `${fmt(m.sun.supernovaRate, m.sun.supernovaRate < 10 ? 1 : 0, 1)}×`);
    facts.set('metals', `${fmt(m.sun.metallicity, 2, 2)}×`);
    facts.set('orbits', fmt(m.sun.orbits, 2, 2));
  }

  /**
   * The "conditions in the solar system" prose. Every number is a scaled present-day
   * anchor (see neighbourhoodState() in model.js); the reference is today's Earth.
   */
  function updateConditions(n, zone) {
    const C = `${KEYS}.conditions`;
    const today = M.neighbourhoodState(CONFIG.sun.radiusKly);
    const [zoneHint, hazards, arms, formation] = conditionParagraphs;
    zoneHint.textContent = zone === 'habitable' ? '' : t(`${KEYS}.status.${zone}Hint`);
    fillTemplate(hazards, `${C}.${n.isToday ? 'hazardsToday' : 'hazards'}`, {
      supernova: fmtDuration(n.supernovaIntervalMyr),
      supernovaToday: fmtDuration(today.supernovaIntervalMyr),
      chance: `${fmt(n.supernovaChancePercent, 0)} %`,
      chanceToday: `${fmt(today.supernovaChancePercent, 0)} %`,
      passage: fmtDuration(n.encounterIntervalKyr / 1000),
      passageToday: fmtDuration(today.encounterIntervalKyr / 1000),
      oort: `${fmt(n.oortCloudFactor, 2, 2)}×`,
    });
    if (n.armCrossingIntervalMyr > M.NEIGHBOURHOOD.neverCrossingMyr) fillTemplate(arms, `${C}.armsCorotation`, {});
    else fillTemplate(arms, `${C}.arms${n.overtakesPattern ? 'Inside' : 'Outside'}`, { interval: fmtDuration(n.armCrossingIntervalMyr) });
    fillTemplate(formation, `${C}.formation${cap(n.metallicityTier)}`, {
      metals: `${fmt(n.metallicity, 2, 2)}×`,
      giant: `${fmt(n.giantPlanetFactor, n.giantPlanetFactor < 1 ? 2 : 1, 1)}×`,
    });
  }

  /** Durations in Myr rendered as "51,000 years" / "128 million years" / "1.35 billion years". */
  function fmtDuration(myr) {
    const E = `${KEYS}.conditions`;
    if (myr < 1) return t(`${E}.years`, { n: fmt(roundSignificant(myr * 1e6, 2), 0) });
    if (myr < 1000) return t(`${E}.millionYears`, { n: fmt(myr, myr < 10 ? 1 : 0) });
    return t(`${E}.billionYears`, { n: fmt(myr / 1000, 2) });
  }

  function reset() {
    Object.assign(state, DEFAULTS);
    time = 0;
    radiusSlider.setValue(state.sunRadiusKly, { silent: true });
    timeSlider.setValue(state.timeMyr, { silent: true });
    syncPlayButton();
    hideTooltip();
    refresh();
    setCamera('overview');
  }

  // --- language ---------------------------------------------------------------------------------
  function syncLabelText() {
    labels.sun.setText(t(`${KEYS}.labels.sun`));
    labels.centre.setText(t(`${KEYS}.labels.centre`));
    labels.habitable.setText(t(`${KEYS}.labels.habitable`));
    labels.inner.setText(t(`${KEYS}.labels.inner`));
    labels.outer.setText(t(`${KEYS}.labels.outer`));
    for (const [id, label] of Object.entries(armLabels)) label.setText(t(`${KEYS}.arms.${id}`));
  }
  disposers.push(
    onLanguageChange(() => {
      syncLabelText();
      radiusSlider.setValue(radiusSlider.value, { silent: true });
      timeSlider.setValue(timeSlider.value, { silent: true });
      syncPlayButton();
      modelCard.render();
      updateReadouts(true);
      if (!tooltip.hidden && hoverKind) {
        tooltipTitle.textContent = t(`${KEYS}.tooltip.${hoverKind}Title`);
        tooltipBody.textContent = hoverKind === 'sun' ? t(`${KEYS}.tooltip.sun`, { distance: fmt(model.sun.radiusLy, 0) }) : t(`${KEYS}.tooltip.${hoverKind}`);
      }
      sim.requestRender();
    }),
  );

  // --- go ----------------------------------------------------------------------------------------
  syncLabelText();
  syncPlayButton();
  syncCameraButtons();
  refresh();
  sim.start();

  // dev-only hook for automated checks; stripped from production builds
  if (import.meta.env.DEV) {
    window.__lpGalacticZone = {
      sim,
      state,
      config: CONFIG,
      data,
      pointCount,
      get model() {
        return model;
      },
      get cameraMode() {
        return cameraMode;
      },
      get sunPosition() {
        return sunPos.clone();
      },
      setSunRadius,
      setTime,
      setPlaying,
      setCamera,
      setZoneEdges,
      reset,
      frame,
      refresh,
      overlays,
      haze,
      dust,
      globulars,
      hazeData,
      dustData,
      globularData,
    };
  }

  return () => {
    if (import.meta.env.DEV) delete window.__lpGalacticZone;
    disposers.forEach((d) => d());
    panel.dispose();
    badge.remove();
    tooltip.remove();
    hint.remove();
    for (const l of Object.values(labels)) l.dispose();
    for (const l of Object.values(armLabels)) l.dispose();
    overlays.dispose();
    haze.dispose();
    dust.dispose();
    globularGeometry.dispose();
    glowTexture.dispose();
    sim.dispose();
    viewport.remove();
  };
}

// ============================================================================================================
// scene building blocks
// ============================================================================================================
/**
 * The three flat zone overlays plus their invisible hit meshes. Radii come from the
 * config; `rebuild()` swaps the geometries when the zone edges change.
 */
function createZoneOverlays(cfg) {
  const group = new THREE.Group();
  group.rotation.x = -Math.PI / 2; // ring/circle geometries lie in xy → put them into the galactic plane
  const uniforms = { uTime: { value: 0 }, uFade: { value: 1 } };
  const makeMaterial = (color, params, blending = THREE.NormalBlending) =>
    new THREE.ShaderMaterial({
      blending,
      uniforms: {
        uTime: uniforms.uTime,
        uFade: uniforms.uFade,
        uColor: { value: new THREE.Color(color) },
        uR0: { value: params.r0 },
        uR1: { value: params.r1 },
        uFadeIn: { value: params.fadeIn },
        uFadeOut: { value: params.fadeOut },
        uOpacity: { value: params.opacity },
        uRim: { value: params.rim ?? 0 },
        uPulse: { value: params.pulse ?? 0 },
        uCore: { value: params.core ?? 0 },
      },
      vertexShader: ZONE_VERTEX,
      fragmentShader: ZONE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });

  // opacities are kept low so the galaxy's own light reads first; the toggles hide the overlays entirely
  const core = new THREE.Mesh(new THREE.BufferGeometry(), makeMaterial(COLORS.danger, { r0: -5, r1: 1, fadeIn: 0.5, fadeOut: 2.5, opacity: 0.26, pulse: 1, core: 1.0 }));
  const ring = new THREE.Mesh(new THREE.BufferGeometry(), makeMaterial(COLORS.habitable, { r0: 1, r1: 2, fadeIn: 1.2, fadeOut: 1.2, opacity: 0.1, rim: 0.6 }, THREE.AdditiveBlending));
  const outer = new THREE.Mesh(new THREE.BufferGeometry(), makeMaterial(COLORS.metalPoor, { r0: 1, r1: 2, fadeIn: 3, fadeOut: 12, opacity: 0.12 }, THREE.AdditiveBlending));
  const ringEdges = new THREE.Group();
  const edgeMaterial = new THREE.LineBasicMaterial({ color: COLORS.habitable, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false });
  const edgeInner = new THREE.LineLoop(new THREE.BufferGeometry(), edgeMaterial);
  const edgeOuter = new THREE.LineLoop(new THREE.BufferGeometry(), edgeMaterial);
  ringEdges.add(edgeInner, edgeOuter);
  ringEdges.rotation.x = Math.PI / 2; // undo the group rotation: circleGeometry() already lies in xz
  core.renderOrder = 3; // after the dust: extinction must not dim the overlays
  ring.renderOrder = 3;
  outer.renderOrder = 3;
  ringEdges.renderOrder = 4;

  const hitMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const hitMeshes = ['inner', 'habitable', 'outer'].map((kind) => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), hitMaterial);
    mesh.layers.set(HIT_LAYER);
    mesh.userData.kind = kind;
    return mesh;
  });
  group.add(core, ring, outer, ringEdges, ...hitMeshes);

  const disposeGeometries = () => {
    for (const m of [core, ring, outer, edgeInner, edgeOuter, ...hitMeshes]) m.geometry.dispose();
  };
  function rebuild(c) {
    disposeGeometries();
    const inner = c.zone.innerKly;
    const outerEdge = c.zone.outerKly;
    core.geometry = new THREE.CircleGeometry(inner, 128);
    ring.geometry = new THREE.RingGeometry(Math.max(inner - 1.5, 0.1), outerEdge + 1.5, 192, 1);
    outer.geometry = new THREE.RingGeometry(outerEdge, c.outerOverlayKly, 192, 1);
    edgeInner.geometry = circleGeometry(inner, 256);
    edgeOuter.geometry = circleGeometry(outerEdge, 256);
    hitMeshes[0].geometry = new THREE.CircleGeometry(inner, 64);
    hitMeshes[1].geometry = new THREE.RingGeometry(inner, outerEdge, 96, 1);
    hitMeshes[2].geometry = new THREE.RingGeometry(outerEdge, c.outerOverlayKly, 96, 1);
    core.material.uniforms.uR1.value = inner;
    ring.material.uniforms.uR0.value = inner;
    ring.material.uniforms.uR1.value = outerEdge;
    outer.material.uniforms.uR0.value = outerEdge;
    outer.material.uniforms.uR1.value = c.outerOverlayKly;
  }
  rebuild(cfg);

  return {
    group,
    uniforms,
    core,
    ring,
    outer,
    ringEdges,
    hitMeshes,
    rebuild,
    dispose() {
      disposeGeometries();
      for (const m of [core, ring, outer]) m.material.dispose();
      edgeMaterial.dispose();
      hitMaterial.dispose();
    },
  };
}

/** Circle in the xz plane (y = 0). */
function circleGeometry(radius, segments) {
  const positions = new Float32Array(segments * 3);
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * TAU;
    positions[i * 3] = radius * Math.cos(a);
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = radius * Math.sin(a);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

/**
 * Instanced camera-facing quads – one draw call for thousands of soft blobs whose
 * size is in world units. Used for the haze and the dust; point sprites would be
 * capped at 64 device pixels on some GPUs and pop when their centre leaves the view.
 * `attributes` maps instanced attribute names to [typedArray, itemSize].
 */
function createBillboardCloud({ count, attributes, material }) {
  const base = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute('position', base.getAttribute('position'));
  for (const [name, [array, itemSize]] of Object.entries(attributes)) {
    geometry.setAttribute(name, new THREE.InstancedBufferAttribute(array, itemSize));
  }
  geometry.instanceCount = count;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    geometry,
    material,
    dispose() {
      base.dispose();
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

const cap = (s) => s[0].toUpperCase() + s.slice(1);

/**
 * Render an i18n template into `node`, setting every interpolated value in bold:
 * the text between placeholders becomes text nodes, each {name} a <strong>.
 */
function fillTemplate(node, key, params) {
  const template = t(key);
  const parts = template.split(/\{(\w+)\}/g);
  node.replaceChildren();
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i]) node.append(document.createTextNode(parts[i]));
    } else {
      const strong = el('strong', 'lp-state__figure');
      strong.textContent = parts[i] in params ? String(params[parts[i]]) : `{${parts[i]}}`;
      node.append(strong);
    }
  }
}

/** Round to `digits` significant figures. */
function roundSignificant(v, digits) {
  if (v === 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(Math.abs(v))) - digits + 1);
  return Math.round(v / p) * p;
}

function createLegend(items) {
  const wrap = el('div', 'lp-legend');
  for (const [key, color, style] of items) {
    const li = el('div', 'lp-legend__item');
    const swatch = el('span', `lp-legend__swatch${style ? ` lp-legend__swatch--${style}` : ''}`, { 'aria-hidden': 'true' });
    const hex = `#${new THREE.Color(color).getHexString()}`;
    swatch.style.color = hex;
    if (style === 'zone') swatch.style.background = `${hex}55`;
    if (style === 'dust') swatch.style.background = `${hex}99`;
    li.append(swatch, bindText(el('span'), key));
    wrap.append(li);
  }
  return wrap;
}

/** Collapsible "About the model" card listing the relations used (values filled from the config). */
function createModelCard(cfg) {
  const details = el('details', 'lp-info lp-physics');
  const summary = el('summary', 'lp-info__summary');
  summary.append(bindText(el('span', 'lp-info__title'), `${KEYS}.model.title`));
  const body = el('div', 'lp-info__body');
  details.append(summary, body);
  const entries = ['zone', 'period', 'galacticYear', 'supernova', 'metals', 'spiral', 'nearestStar', 'encounters', 'supernovaInterval', 'giantPlanets', 'armCrossings'];
  function render() {
    body.replaceChildren();
    // the schematic caveat first: it qualifies every relation listed below it
    const caveat = el('div', 'lp-notice lp-notice--info', { role: 'note' });
    caveat.textContent = t(`${KEYS}.notice`);
    body.append(caveat);
    const params = {
      inner: fmt(cfg.zone.innerKly * 1000, 0),
      outer: fmt(cfg.zone.outerKly * 1000, 0),
      innerKpc: fmt(cfg.zone.innerKly / M.LY_PER_KPC, 1, 1),
      outerKpc: fmt(cfg.zone.outerKly / M.LY_PER_KPC, 1, 1),
      sun: fmt(cfg.sun.radiusKly * 1000, 0),
      period: fmt(cfg.sun.orbitPeriodMyr, 0),
      speed: fmt(M.sunSpeedKmS(cfg), 0),
      galacticYears: fmt(M.galacticYearsSinceFormation(cfg.sun.radiusKly, cfg), 0),
      scaleLength: fmt(cfg.discScaleLengthKly, 1, 1),
      pitch: fmt(cfg.pitchDeg, 1, 1),
      arms: String(cfg.arms.length),
      nearest: fmt(M.NEIGHBOURHOOD.nearestStarLy, 2, 2),
      nakedEye: fmt(M.NEIGHBOURHOOD.nakedEyeStars, 0),
      encounters: fmt(M.NEIGHBOURHOOD.encountersPerMyr, 1, 1),
      snPerGyr: fmt(M.NEIGHBOURHOOD.supernovaPerGyr, 1, 1),
      slope: fmt(M.NEIGHBOURHOOD.giantPlanetSlopeDex, 1, 1),
      patternPeriod: fmt(cfg.patternPeriodMyr, 0),
    };
    for (const id of entries) {
      const block = el('div', 'lp-formula');
      const label = el('p', 'lp-formula__label');
      label.textContent = t(`${KEYS}.model.${id}Label`, params);
      const code = el('code', 'lp-formula__code');
      code.textContent = t(`${KEYS}.model.${id}Formula`, params);
      const note = el('p', 'lp-formula__note');
      note.textContent = t(`${KEYS}.model.${id}Note`, params);
      block.append(label, code, note);
      body.append(block);
    }
    const scale = el('p', 'lp-formula__note');
    scale.textContent = t(`${KEYS}.model.scaleNote`, params);
    body.append(scale);
  }
  render();
  return { el: details, render, dispose() {} };
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
  let currentScale = 1;
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
    /** Relative on-screen size (1 = default). */
    setScale(k) {
      if (Math.abs(k - currentScale) < 0.01) return;
      currentScale = k;
      sprite.scale.set(0.4 * size * k, 0.05 * size * k, 1);
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
/**
 * Galaxy points: colour and size are per-point attributes generated once; the
 * shader only adds perspective sizing, a faint twinkle and a fade for points that
 * come very close to the camera (so the Sun's neighbourhood does not fill with blobs).
 */
const GALAXY_VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aPhase;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSizeScale;
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float d = max(-mv.z, 0.3);
    // stars do not scintillate in space – a very faint shimmer only keeps the picture alive
    float twinkle = 0.95 + 0.05 * sin(uTime * 1.7 + aPhase * 6.28318530718);
    float px = aSize * uSizeScale * twinkle * (90.0 / d);
    gl_PointSize = clamp(px, 1.0, 9.0) * uPixelRatio;
    vColor = aColor;
    // near fade: points passing within a few hundred light-years of the camera dissolve
    vAlpha = uOpacity * twinkle * smoothstep(0.3, 2.5, d) * (px > 9.0 ? 9.0 / px : 1.0);
  }
`;

const GALAXY_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    // sharp core with a faint wider halo, like a slightly defocused star image
    float core = smoothstep(0.5, 0.04, d);
    float a = core * core * 0.85 + 0.15 * (1.0 - smoothstep(0.1, 0.5, d));
    gl_FragColor = vec4(vColor * (0.5 + 0.6 * (1.0 - 2.0 * d)), a * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Shared billboard vertex code: the quad is expanded in view space around the
 * instance offset (so it always faces the camera), sized in world units. Instances
 * closer than a few kly to the camera fade out and are moved outside the clip
 * volume, so the Sun's-location view never rasterises giant near blobs.
 */
const BILLBOARD_VERTEX_COMMON = /* glsl */ `
  attribute vec3 aOffset;
  attribute float aSize;
  varying vec2 vUv;
  varying float vNear;
  vec4 billboard() {
    vec4 centre = modelViewMatrix * vec4(aOffset, 1.0);
    float d = length(centre.xyz);
    vNear = smoothstep(3.0, 8.0, d);
    vUv = position.xy;
    if (vNear <= 0.001) return vec4(0.0, 0.0, 2.0, 1.0);
    return projectionMatrix * vec4(centre.xyz + vec3(position.xy * aSize, 0.0), 1.0);
  }
`;

/** Soft radial profile on the unit quad (position.xy in −0.5…0.5): a Gaussian that reaches zero at the edge. */
const BILLBOARD_PROFILE = /* glsl */ `
  float profile(vec2 uv) {
    float r2 = dot(uv, uv) * 4.0;
    return clamp((exp(-4.5 * r2) - 0.0111) / 0.9889, 0.0, 1.0);
  }
`;

const HAZE_VERTEX = /* glsl */ `
  ${BILLBOARD_VERTEX_COMMON}
  attribute vec3 aColor;
  varying vec3 vColor;
  void main() {
    gl_Position = billboard();
    vColor = aColor;
  }
`;

const HAZE_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  uniform float uFade;
  varying vec3 vColor;
  varying vec2 vUv;
  varying float vNear;
  ${BILLBOARD_PROFILE}
  void main() {
    float a = profile(vUv) * uOpacity * uFade * vNear;
    gl_FragColor = vec4(vColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const DUST_VERTEX = /* glsl */ `
  ${BILLBOARD_VERTEX_COMMON}
  attribute float aStrength;
  varying float vStrength;
  void main() {
    gl_Position = billboard();
    vStrength = aStrength;
  }
`;

/**
 * Dust is drawn with framebuffer × fragment blending, so the fragment is a
 * transmission: 1 leaves the light alone, uTint is full extinction (red passes,
 * blue is absorbed). No tone mapping – that would darken even a clear fragment.
 */
const DUST_FRAGMENT = /* glsl */ `
  uniform vec3 uTint;
  uniform float uFade;
  uniform float uStrength;
  varying float vStrength;
  varying vec2 vUv;
  varying float vNear;
  ${BILLBOARD_PROFILE}
  void main() {
    float k = profile(vUv) * vStrength * uStrength * uFade * vNear;
    gl_FragColor = vec4(mix(vec3(1.0), uTint, k), 1.0);
    #include <colorspace_fragment>
  }
`;

/** Flat radial overlay: soft-edged band between uR0 and uR1 with optional rims, pulse and core boost. */
const ZONE_VERTEX = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ZONE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uR0;
  uniform float uR1;
  uniform float uFadeIn;
  uniform float uFadeOut;
  uniform float uOpacity;
  uniform float uRim;
  uniform float uPulse;
  uniform float uCore;
  uniform float uTime;
  uniform float uFade;
  varying vec2 vLocal;
  void main() {
    float r = length(vLocal);
    float band = smoothstep(uR0, uR0 + max(uFadeIn, 1e-3), r) * (1.0 - smoothstep(uR1 - max(uFadeOut, 1e-3), uR1, r));
    float rim = uRim * (exp(-pow((r - uR0) / 0.5, 2.0)) + exp(-pow((r - uR1) / 0.5, 2.0)));
    float pulse = 1.0 + uPulse * 0.18 * sin(uTime * 1.4);
    float core = 1.0 + uCore * exp(-r * 0.22);
    float a = uOpacity * uFade * (band * pulse * core + rim);
    gl_FragColor = vec4(uColor, clamp(a, 0.0, 0.85));
    #include <colorspace_fragment>
  }
`;
