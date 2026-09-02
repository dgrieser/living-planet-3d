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
 *  - Three flat overlays at y = 0: the red "hostile core" inside the zone's inner
 *    edge, the translucent green habitable annulus and the blue-grey metal-poor
 *    outer region. Their radii come from the config object, so the zone edges
 *    are adjustable (and the dev hook can rebuild them at run time).
 *  - The Sun is a pulsing gold sprite at 27 kly on the Orion spur. The radius
 *    slider moves it along its azimuth for what-if exploration; the readouts
 *    (zone, period, supernova hazard, heavy-element abundance) follow.
 *  - Timeline: the spiral pattern rotates rigidly once per 230 Myr and the Sun
 *    orbits with the period of its current radius (flat rotation curve), so at
 *    27 kly it stays on the spur, further in it overtakes the arms, further out
 *    it lags behind.
 *
 * Everything quantitative lives in ./model.js; this module maps it to pixels.
 */
import * as THREE from 'three';
import { createScene } from '../../lib/scene.js';
import { createPanel, createSection, createSlider, createStateToggle, createButton, createInfoCard, createNotice, el } from '../../lib/ui.js';
import { createViewPrefs } from '../../lib/prefs.js';
import { t, bindText, bindAttr, onLanguageChange, formatNumber } from '../../lib/i18n.js';
import * as M from './model.js';

const KEYS = 'sims.galacticZone';
const HIT_LAYER = 1;

/** Adjust the picture here – e.g. `createConfig({ zone: { innerKly: 15, outerKly: 30 } })`. */
const CONFIG = M.createConfig({});

const POINT_COUNT = 50000;
const POINT_COUNT_SMALL = 30000; // phones: fewer points keeps the rotation smooth
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
});

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

// shifted a little to the left so the galaxy is centred in the space beside the control panel
const CAMERA_OVERVIEW = Object.freeze({ position: [-9, 104, 82], target: [-9, 0, 0] });
/** Sun preset: outside the Sun, looking inward with the bulge in the background. */
const SUN_VIEW = Object.freeze({ outward: 5.4, up: 1.7, side: 1.4 });

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
    starfield.material.opacity = 0.45;
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

  // --- zone overlays (static: they are radial, the pattern rotates underneath) --------------------
  const overlays = createZoneOverlays(CONFIG);
  scene.add(overlays.group);

  // --- the Sun ------------------------------------------------------------------------------------
  const glowTexture = createGlowTexture();
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
  orbitRing.renderOrder = 3;
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

  /** Camera end state for the Sun preset, computed from the Sun's current position. */
  function sunPreset() {
    const outward = tmpV.copy(sunPos).setY(0).normalize();
    const side = new THREE.Vector3(-outward.z, 0, outward.x);
    const position = sunPos.clone().addScaledVector(outward, SUN_VIEW.outward).addScaledVector(side, SUN_VIEW.side);
    position.y += SUN_VIEW.up;
    return { position, target: sunPos.clone() };
  }
  function presetFor(mode) {
    if (mode === 'sun') return sunPreset();
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
  /** In "Sun" mode the camera rides along: the offset from the target is rotated with the Sun. */
  function followSun() {
    if (cameraMode !== 'sun' || cameraTween) {
      followAzimuth = model.sun.azimuth;
      return;
    }
    const dAz = model.sun.azimuth - followAzimuth;
    followAzimuth = model.sun.azimuth;
    const offset = tmpV.copy(camera.position).sub(controls.target);
    if (Math.abs(dAz) > 1e-9) offset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, -dAz);
    controls.target.copy(sunPos);
    camera.position.copy(sunPos).add(offset);
  }
  function setCamera(mode) {
    cameraMode = mode;
    followAzimuth = model ? model.sun.azimuth : CONFIG.sunAzimuth;
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
  controls.addEventListener('change', onControlsChange);
  disposers.push(() => controls.removeEventListener('change', onControlsChange));

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
  const panel = createPanel();

  const sunSection = createSection(`${KEYS}.sections.sun`);
  const radiusSlider = createSlider({
    labelKey: `${KEYS}.controls.sunRadius`,
    min: CONFIG.sunRadiusRangeKly.min,
    max: CONFIG.sunRadiusRangeKly.max,
    step: CONFIG.sunRadiusRangeKly.step,
    value: state.sunRadiusKly,
    format: (v) => `${fmt(v * 1000, 0)} ${t('units.lightYears')}`,
    onChange: (v) => setSunRadius(v, { fromSlider: true }),
  });
  const zoneReadout = el('div', 'lp-readout lp-readout--zone');
  const zoneLabel = bindText(el('div', 'lp-readout__label'), `${KEYS}.status.label`);
  const zonePill = el('span', 'lp-state');
  const zoneHint = el('p', 'lp-state__hint');
  zoneReadout.append(zoneLabel, zonePill, zoneHint);
  const sunFacts = createFacts([
    ['distance', `${KEYS}.facts.distance`],
    ['period', `${KEYS}.facts.period`],
    ['speed', `${KEYS}.facts.speed`],
    ['galacticYears', `${KEYS}.facts.galacticYears`],
    ['supernova', `${KEYS}.facts.supernova`],
    ['metals', `${KEYS}.facts.metals`],
  ]);
  const sunHome = createButton({ labelKey: `${KEYS}.controls.sunHome`, icon: '☉', onClick: () => setSunRadius(CONFIG.sun.radiusKly) });
  const sunRow = el('div', 'lp-button-row');
  sunRow.append(sunHome.el);
  sunSection.add(radiusSlider, zoneReadout, sunFacts, sunRow);

  const timeSection = createSection(`${KEYS}.sections.time`);
  const timeSlider = createSlider({
    labelKey: `${KEYS}.controls.time`,
    min: 0,
    max: TIME_MAX_MYR,
    step: 1,
    value: state.timeMyr,
    format: (v) => `${fmt(v, 0)} ${t('units.millionYears')}`,
    onChange: (v) => setTime(v, { fromSlider: true }),
  });
  const playBtn = createButton({ labelKey: `${KEYS}.controls.play`, icon: '▶', variant: 'primary', onClick: () => setPlaying(!state.playing) });
  const playRow = el('div', 'lp-button-row');
  playRow.append(playBtn.el);
  const timeFacts = createFacts([
    ['orbits', `${KEYS}.facts.orbits`],
  ]);
  const timeHint = bindText(el('p', 'lp-section__note'), `${KEYS}.controls.timeHint`);
  timeSection.add(timeSlider, playRow, timeFacts, timeHint);

  const viewSection = createSection(`${KEYS}.sections.view`);
  const viewToggle = (name, labelKey) => createStateToggle({ labelKey, state, name, prefs: viewPrefs, onChange: refresh });
  const toggles = {
    showRing: viewToggle('showRing', `${KEYS}.controls.ring`),
    showZones: viewToggle('showZones', `${KEYS}.controls.zones`),
    showArmLabels: viewToggle('showArmLabels', `${KEYS}.controls.armLabels`),
  };
  const cameraTitle = bindText(el('p', 'lp-subheading'), `${KEYS}.controls.camera`);
  const cameraRow = el('div', 'lp-presets lp-presets--2', { role: 'group' });
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
  const legend = createLegend([
    [`${KEYS}.legend.bulge`, 0xffc98a],
    [`${KEYS}.legend.arms`, 0xa9c4ff],
    [`${KEYS}.legend.hii`, 0xff80ad],
    [`${KEYS}.legend.habitable`, COLORS.habitable, 'zone'],
    [`${KEYS}.legend.danger`, COLORS.danger, 'zone'],
    [`${KEYS}.legend.metalPoor`, COLORS.metalPoor, 'zone'],
    [`${KEYS}.legend.sun`, COLORS.sun],
    [`${KEYS}.legend.orbit`, COLORS.orbit, 'dashed'],
  ]);
  viewSection.add(toggles.showRing, toggles.showZones, toggles.showArmLabels, cameraTitle, cameraRow, legend);

  const resetBtn = createButton({ labelKey: 'panel.reset', icon: '↺', onClick: reset });
  const resetRow = el('div', 'lp-button-row');
  resetRow.append(resetBtn.el);

  panel.add(createNotice({ textKey: `${KEYS}.notice`, tone: 'info' }), sunSection, timeSection, viewSection, resetRow);
  if (sim.reducedMotion) panel.add(createNotice({ textKey: 'motion.reducedNotice' }));
  const infoCard = createInfoCard({ titleKey: `${KEYS}.info.title`, bodyKey: `${KEYS}.info.body`, open: !isSmallScreen });
  const modelCard = createModelCard(CONFIG);
  panel.add(infoCard, modelCard);
  container.append(panel.el);

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
    playBtn.el.querySelector('.lp-button__icon').textContent = state.playing ? '⏸' : '▶';
    bindText(playBtn.el.querySelector('[data-i18n]'), state.playing ? `${KEYS}.controls.pause` : `${KEYS}.controls.play`);
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
    zoneHint.textContent = t(`${KEYS}.status.${m.sun.zone}Hint`);
    zoneReadout.className = `lp-readout lp-readout--zone is-${m.sun.zone}`;

    sunFacts.set('distance', `${fmt(m.sun.radiusLy, 0)} ${t('units.lightYears')} · ${fmt(m.sun.radiusKpc, 1, 1)} ${t('units.kiloparsec')}`);
    sunFacts.set('period', `${fmt(m.sun.periodMyr, 0)} ${t('units.millionYears')}`);
    sunFacts.set('speed', `${fmt(m.sun.speedKmS, 0)} ${t('units.kilometersPerSecond')}`);
    sunFacts.set('galacticYears', fmt(m.sun.galacticYears, m.sun.galacticYears < 10 ? 1 : 0));
    sunFacts.set('supernova', `${fmt(m.sun.supernovaRate, m.sun.supernovaRate < 10 ? 1 : 0, 1)}×`);
    sunFacts.set('metals', `${fmt(m.sun.metallicity, 2, 2)}×`);
    timeFacts.set('orbits', fmt(m.sun.orbits, 2, 2));
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

  const core = new THREE.Mesh(new THREE.BufferGeometry(), makeMaterial(COLORS.danger, { r0: -5, r1: 1, fadeIn: 0.5, fadeOut: 2.5, opacity: 0.3, pulse: 1, core: 1.4 }));
  const ring = new THREE.Mesh(new THREE.BufferGeometry(), makeMaterial(COLORS.habitable, { r0: 1, r1: 2, fadeIn: 1.2, fadeOut: 1.2, opacity: 0.13, rim: 0.6 }, THREE.AdditiveBlending));
  const outer = new THREE.Mesh(new THREE.BufferGeometry(), makeMaterial(COLORS.metalPoor, { r0: 1, r1: 2, fadeIn: 3, fadeOut: 12, opacity: 0.16 }, THREE.AdditiveBlending));
  const ringEdges = new THREE.Group();
  const edgeMaterial = new THREE.LineBasicMaterial({ color: COLORS.habitable, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false });
  const edgeInner = new THREE.LineLoop(new THREE.BufferGeometry(), edgeMaterial);
  const edgeOuter = new THREE.LineLoop(new THREE.BufferGeometry(), edgeMaterial);
  ringEdges.add(edgeInner, edgeOuter);
  ringEdges.rotation.x = Math.PI / 2; // undo the group rotation: circleGeometry() already lies in xz
  core.renderOrder = 2;
  ring.renderOrder = 2;
  outer.renderOrder = 2;
  ringEdges.renderOrder = 3;

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

// ============================================================================================================
// DOM helpers
// ============================================================================================================
function createFacts(rows) {
  const dl = el('dl', 'lp-facts lp-facts--accent lp-facts--gz');
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
    const swatch = el('span', `lp-legend__swatch${style ? ` lp-legend__swatch--${style}` : ''}`, { 'aria-hidden': 'true' });
    const hex = `#${new THREE.Color(color).getHexString()}`;
    swatch.style.color = hex;
    if (style === 'zone') swatch.style.background = `${hex}55`;
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
  const entries = ['zone', 'period', 'galacticYear', 'supernova', 'metals', 'spiral'];
  function render() {
    body.replaceChildren();
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
    float twinkle = 0.86 + 0.14 * sin(uTime * 1.7 + aPhase * 6.28318530718);
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
    float a = smoothstep(0.5, 0.04, d);
    a *= a;
    gl_FragColor = vec4(vColor * (0.5 + 0.6 * (1.0 - 2.0 * d)), a * vAlpha);
    #include <tonemapping_fragment>
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
