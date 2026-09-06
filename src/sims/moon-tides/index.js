/**
 * Simulation: The Moon & the tides ("moon-tides").
 *
 * Two linked views of the Earth–Moon system:
 *  A) Tides – a displaced ocean shell shows the two equilibrium tidal bulges
 *     (h = h₀ · P₂(cos θ), h₀ = 2GMR/r³ · R/(2g)) raised by the Moon and,
 *     optionally, the Sun (spring / neap tides). Earth rotates beneath the
 *     bulges; a tide gauge on the equator records the semi-diurnal cycle.
 *  B) Axis stability – Earth's spin axis precesses on a neat cone while the
 *     tilt breathes 23.4° ± 1.3° (with Moon); "Remove Moon" switches to a
 *     clearly flagged schematic chaotic wobble (0°–60°).
 * The Moon distance (0.5×–2× today's) and its presence are shared by both
 * views. All physics lives in ./physics.js.
 *
 * Scene: Earth at the origin, radius 1. The Sun is in direction +x (fixed);
 * Moon and Sun lie in the xz plane. Earth's spin axis is +y in view A; in
 * view B the ecliptic pole is +y and the axis is tilted from it.
 */
import * as THREE from 'three';
import { createScene } from '../../lib/scene.js';
import { createPanel, createPanelShift, createCollapsibleSection, createControlRow, createSlider, createToggle, createStateToggle, createButton, createInfoCard, createNotice, el } from '../../lib/ui.js';
import { createViewPrefs } from '../../lib/prefs.js';
import { t, bindText, bindAttr, onLanguageChange, formatNumber } from '../../lib/i18n.js';
import * as P from './physics.js';

const KEYS = 'sims.moonTides';
const EARTH_RADIUS = 1;
const MOON_RADIUS = (EARTH_RADIUS * P.MOON.radius) / P.EARTH.radius; // ≈ 0.27 – size ratio is always to scale
const OCEAN_BASE = 1.03; // undisturbed ocean shell radius (scene units)
const COMPRESSED_MOON_DISTANCE = 6; // scene units at k = 1 when "to scale" is off
const TRUE_MOON_DISTANCE = (EARTH_RADIUS * P.MOON.distance) / P.EARTH.radius; // ≈ 60.3
const SUN_SPRITE_DISTANCE = 400;
const MARKER_LONGITUDE = 0; // in Earth's rotating frame (rad)
const AXIS_LEN = 2.1;
const AXIS_MOON_DISTANCE = 5.5; // decorative Moon orbit in view B
const TRACE_POINTS = 720;
const TIDE_CHART_WINDOW_H = 48;
const AXIS_CHART_WINDOW_YR = 400000;
const TILT_BLEND_YR = 30000; // smooth hand-over between the stable and the chaotic model
const TEXTURE_BASE = `${import.meta.env.BASE_URL}textures/`;
const DEG = Math.PI / 180;
const COLORS = Object.freeze({
  ocean: 0x4fb3ff,
  seaLevel: 0xa7b4cc,
  marker: 0xff6ad5,
  moonLine: 0xffd166,
  sun: 0xffd9a0,
  axis: 0xf0f4ff,
  trace: 0x7cc4ff,
  cone: 0x7cc4ff,
  ecliptic: 0xa7b4cc,
  orbit: 0x9fe8ff,
  chaos: 0xff8a80,
});

const DEFAULTS = Object.freeze({
  view: 'tides',
  distanceFactor: 1,
  moonPresent: true,
  exaggeration: P.EXAGGERATION_RANGE.default,
  tideSpeed: P.TIDE_SPEED_RANGE_H_PER_S.default, // simulated hours per second
  axisSpeed: P.AXIS_SPEED_RANGE_KYR_PER_S.default, // simulated kyr per second
  playing: true,
  sunTide: false,
});

/** Display toggles – remembered per visitor, see ../../lib/prefs.js. */
const VIEW_DEFAULTS = Object.freeze({
  toScale: false,
  showLabels: true,
  showTrace: true,
  showCone: true,
  showOrbitPlane: true,
});
const DEFAULT_ELONGATION = 215 * (Math.PI / 180); // rad – Moon starts front-left of Earth as seen from the default camera

const { clamp } = P;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const smoothstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const fmt = (v, digits, min = 0) => formatNumber(v, { maximumFractionDigits: digits, minimumFractionDigits: min });
/** The views in the order the panel's header button steps through them. */
const CAMERA_VIEWS = Object.freeze([
  { id: 'side', labelKey: `${KEYS}.controls.cameraSide` },
  { id: 'top', labelKey: `${KEYS}.controls.cameraTop` },
]);
const PHASE_PRESETS = Object.freeze([
  { id: 'new', elongation: 0 },
  { id: 'firstQuarter', elongation: Math.PI / 2 },
  { id: 'full', elongation: Math.PI },
  { id: 'lastQuarter', elongation: 1.5 * Math.PI },
]);

export default function mount(container, meta) {
  const viewPrefs = createViewPrefs(meta.id, VIEW_DEFAULTS);
  const state = { ...DEFAULTS, ...viewPrefs.values };
  // simulated clocks
  let tideTimeH = 0; // hours (view A)
  let elongation0 = DEFAULT_ELONGATION; // Moon–Sun angle at tideTimeH = 0
  let axisTimeYr = 0; // years (view B)
  let precessionAngle = 0; // rad, integrated because the rate changes with the Moon
  let tiltBlend = { fromDeg: P.tiltWithMoonDeg(0), sinceYr: -Infinity, switchYr: 0 }; // hand-over when the Moon is removed / restored
  let spinB = 0; // visual spin of Earth in view B
  let moonAngleB = 0.8;
  const disposers = [];

  const viewport = el('div', 'lp-sim__viewport');
  container.append(viewport);

  const sim = createScene({
    container: viewport,
    cameraPosition: [5.5, 3.4, 9.5],
    near: 0.05,
    far: 5000,
    stars: { count: 3000, radius: 1500 },
    controls: { minDistance: 1.6, maxDistance: 320 },
  });
  const { scene, camera, renderer, controls } = sim;
  camera.lookAt(0, 0, 0);
  const labelFont = getComputedStyle(document.documentElement).getPropertyValue('--lp-font') || 'sans-serif';
  const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // --- textures & lights -----------------------------------------------------------------------
  const loader = new THREE.TextureLoader();
  const earthMaterial = new THREE.MeshStandardMaterial({ color: 0x1c4696, roughness: 0.85, metalness: 0 });
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
    () => console.warn('[moon-tides] earth texture not available – using flat colour'),
  );
  const moonTexture = createMoonTexture();
  const moonMaterial = new THREE.MeshStandardMaterial({ map: moonTexture, roughness: 1, metalness: 0 });
  const sunLight = new THREE.DirectionalLight(0xfff2dc, 2.6);
  sunLight.position.set(1, 0, 0);
  scene.add(sunLight, new THREE.AmbientLight(0x6a7fb0, 0.35));
  const glowTexture = createGlowTexture();
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: COLORS.sun, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, sizeAttenuation: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  sunSprite.scale.set(0.12, 0.12, 1);
  sunSprite.position.set(SUN_SPRITE_DISTANCE, 0, 0);
  sunSprite.renderOrder = 6;
  const sunLabel = createLabel(COLORS.sun, labelFont, 0.9);
  scene.add(sunSprite, sunLabel.sprite);

  // =============================================================================================
  // View A – tides
  // =============================================================================================
  const tidesGroup = new THREE.Group();
  scene.add(tidesGroup);

  const spinGroupA = new THREE.Group();
  const earthA = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS, 96, 64), earthMaterial);
  earthA.name = 'earth';
  spinGroupA.add(earthA);
  tidesGroup.add(spinGroupA);

  const oceanMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uMoonDir: { value: new THREE.Vector3(1, 0, 0) },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uAmpMoon: { value: 0 }, // scene units
      uAmpSun: { value: 0 },
      uBase: { value: OCEAN_BASE },
      uLightDir: { value: new THREE.Vector3(1, 0, 0) },
    },
    vertexShader: OCEAN_VERTEX,
    fragmentShader: OCEAN_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  const ocean = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 100), oceanMaterial);
  ocean.name = 'ocean';
  ocean.renderOrder = 1;
  ocean.frustumCulled = false;
  tidesGroup.add(ocean);

  // undisturbed sea level (dashed ring at the equator) + a faint meridian ring through the Moon direction
  const seaLevelRing = new THREE.LineLoop(circleGeometry(OCEAN_BASE, 256), new THREE.LineDashedMaterial({ color: COLORS.seaLevel, dashSize: 0.08, gapSize: 0.05, transparent: true, opacity: 0.8 }));
  seaLevelRing.computeLineDistances();
  seaLevelRing.renderOrder = 2;
  tidesGroup.add(seaLevelRing);

  // Moon (view A)
  const moonA = new THREE.Mesh(new THREE.SphereGeometry(MOON_RADIUS, 48, 32), moonMaterial);
  moonA.name = 'moon';
  const moonOrbitA = new THREE.LineLoop(circleGeometry(1, 256), new THREE.LineBasicMaterial({ color: COLORS.orbit, transparent: true, opacity: 0.35, depthWrite: false }));
  const moonLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]),
    new THREE.LineBasicMaterial({ color: COLORS.moonLine, transparent: true, opacity: 0.45, depthWrite: false }),
  );
  moonLine.frustumCulled = false;
  const moonLabelA = createLabel(0xf0f4ff, labelFont, 0.9);
  tidesGroup.add(moonA, moonOrbitA, moonLine, moonLabelA.sprite);

  // tide gauge marker (rotates with Earth, sits on the ocean surface)
  const markerSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: COLORS.marker, transparent: true, opacity: 1, depthWrite: false, depthTest: false, sizeAttenuation: false, toneMapped: false }));
  markerSprite.scale.set(0.05, 0.05, 1);
  markerSprite.renderOrder = 8;
  const markerStem = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: COLORS.marker, transparent: true, opacity: 0.9 }),
  );
  markerStem.frustumCulled = false;
  const markerLabel = createLabel(COLORS.marker, labelFont, 0.85);
  tidesGroup.add(markerSprite, markerStem, markerLabel.sprite);

  // =============================================================================================
  // View B – axis stability
  // =============================================================================================
  const axisGroup = new THREE.Group();
  axisGroup.visible = false;
  scene.add(axisGroup);

  // ecliptic plane + Moon orbit
  const planeGroup = new THREE.Group();
  const gridMaterial = new THREE.LineBasicMaterial({ color: COLORS.ecliptic, transparent: true, opacity: 0.16, depthWrite: false });
  for (const r of [2, 4, 8]) planeGroup.add(new THREE.LineLoop(circleGeometry(r, 160), gridMaterial));
  const planeFill = new THREE.Mesh(new THREE.CircleGeometry(8, 96), new THREE.MeshBasicMaterial({ color: 0x3a5a9a, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
  planeFill.rotation.x = -Math.PI / 2;
  planeFill.renderOrder = -3;
  planeGroup.add(planeFill);
  const moonOrbitB = new THREE.LineLoop(circleGeometry(AXIS_MOON_DISTANCE, 256), new THREE.LineBasicMaterial({ color: COLORS.orbit, transparent: true, opacity: 0.4, depthWrite: false }));
  planeGroup.add(moonOrbitB);
  axisGroup.add(planeGroup);

  // ecliptic pole line (orbit normal)
  const poleLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -AXIS_LEN * 1.15, 0), new THREE.Vector3(0, AXIS_LEN * 1.15, 0)]),
    new THREE.LineDashedMaterial({ color: COLORS.ecliptic, dashSize: 0.1, gapSize: 0.07, transparent: true, opacity: 0.7 }),
  );
  poleLine.computeLineDistances();
  const poleLabel = createLabel(COLORS.ecliptic, labelFont, 0.8);
  poleLabel.sprite.position.set(0, AXIS_LEN * 1.15 + 0.18, 0);
  axisGroup.add(poleLine, poleLabel.sprite);

  // Earth with tilted axis
  const orientGroup = new THREE.Group(); // quaternion: +y → axis direction
  const spinGroupB = new THREE.Group();
  const earthB = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS, 96, 64), earthMaterial);
  spinGroupB.add(earthB);
  orientGroup.add(spinGroupB);
  const axisLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -AXIS_LEN, 0), new THREE.Vector3(0, AXIS_LEN, 0)]),
    new THREE.LineBasicMaterial({ color: COLORS.axis, transparent: true, opacity: 0.95 }),
  );
  orientGroup.add(axisLine);
  const northLabel = createLabel(COLORS.axis, labelFont, 0.85);
  northLabel.sprite.position.set(0, AXIS_LEN + 0.2, 0);
  const southLabel = createLabel(COLORS.axis, labelFont, 0.85);
  southLabel.sprite.position.set(0, -AXIS_LEN - 0.2, 0);
  orientGroup.add(northLabel.sprite, southLabel.sprite);
  axisGroup.add(orientGroup);

  // precession cone (unit cone, apex at the origin, scaled per frame)
  const coneGeometry = new THREE.ConeGeometry(1, 1, 96, 1, true);
  coneGeometry.rotateX(Math.PI); // apex → −y … then shift so the apex sits at the origin
  coneGeometry.translate(0, 0.5, 0);
  const coneMaterial = new THREE.MeshBasicMaterial({ color: COLORS.cone, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false });
  const cone = new THREE.Mesh(coneGeometry, coneMaterial);
  cone.renderOrder = -1;
  const coneWire = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.ConeGeometry(1, 1, 24, 1, true).rotateX(Math.PI).translate(0, 0.5, 0), 1), new THREE.LineBasicMaterial({ color: COLORS.cone, transparent: true, opacity: 0.18, depthWrite: false }));
  axisGroup.add(cone, coneWire);

  // precession trace (ring buffer of axis-tip positions, copied into draw order each frame)
  const traceRing = new Float32Array(TRACE_POINTS * 3);
  const tracePositions = new Float32Array(TRACE_POINTS * 3);
  const traceColors = new Float32Array(TRACE_POINTS * 3);
  const traceGeometry = new THREE.BufferGeometry();
  traceGeometry.setAttribute('position', new THREE.BufferAttribute(tracePositions, 3));
  traceGeometry.setAttribute('color', new THREE.BufferAttribute(traceColors, 3));
  traceGeometry.setDrawRange(0, 0);
  const traceLine = new THREE.Line(traceGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
  traceLine.frustumCulled = false;
  traceLine.renderOrder = 3;
  axisGroup.add(traceLine);
  let traceCount = 0;
  let traceHead = 0;
  let traceAccumulator = 0;
  const traceColor = new THREE.Color();

  // decorative Moon (view B)
  const moonB = new THREE.Mesh(new THREE.SphereGeometry(MOON_RADIUS, 48, 32), moonMaterial);
  const moonLabelB = createLabel(0xf0f4ff, labelFont, 0.9);
  axisGroup.add(moonB, moonLabelB.sprite);

  // =============================================================================================
  // derived model
  // =============================================================================================
  const moonDir = new THREE.Vector3(1, 0, 0);
  const sunDir = new THREE.Vector3(1, 0, 0);
  const tmpV = new THREE.Vector3();
  const tmpUp = new THREE.Vector3();
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  let model = null;

  function derive() {
    const lunar = P.lunarTide(state.distanceFactor);
    const solar = P.solarTide();
    const geometry = P.tideGeometry(tideTimeH, state.distanceFactor, elongation0);
    const elongation = geometry.moonAngle - geometry.sunAngle;
    const moonHeight = state.moonPresent ? lunar.height : 0;
    const sunHeight = state.sunTide ? solar.height : 0;
    const bodies = [];
    if (state.moonPresent) bodies.push({ angle: geometry.moonAngle, height: lunar.height });
    if (state.sunTide) bodies.push({ angle: geometry.sunAngle, height: solar.height });
    const markerAngle = geometry.earthAngle + MARKER_LONGITUDE;
    const markerLevel = P.seaLevel(markerAngle, bodies);
    const markerSlope = P.seaLevel(markerAngle + 1e-4, bodies) - markerLevel; // Earth spins → the marker moves east
    const range = P.tidalRange(moonHeight, sunHeight, elongation);
    let rangeKind = 'none';
    if (state.moonPresent && state.sunTide) rangeKind = P.springNeap(elongation).kind;
    else if (state.moonPresent) rangeKind = 'lunarOnly';
    else if (state.sunTide) rangeKind = 'solarOnly';

    // axis (view B)
    const stableTilt = P.tiltWithMoonDeg(axisTimeYr);
    const targetTilt = state.moonPresent ? stableTilt : P.tiltWithoutMoonDeg(axisTimeYr - tiltBlend.switchYr);
    const w = smoothstep((axisTimeYr - tiltBlend.sinceYr) / TILT_BLEND_YR);
    const tiltDeg = tiltBlend.fromDeg * (1 - w) + targetTilt * w;
    const precessionPeriodYr = state.moonPresent ? P.PRECESSION_PERIOD_YR.withMoon : P.PRECESSION_PERIOD_YR.withoutMoon;

    return {
      lunar,
      solar,
      geometry,
      elongation,
      phase: P.moonPhase(elongation),
      markerLevel,
      rising: markerSlope > 0,
      range,
      rangeKind,
      sceneMoonDistance: (state.toScale ? TRUE_MOON_DISTANCE : COMPRESSED_MOON_DISTANCE) * state.distanceFactor,
      tiltDeg,
      precessionPeriodYr,
      siderealMonthDays: P.siderealMonthDays(state.distanceFactor),
      lunarDayHours: P.lunarDayHours(state.distanceFactor),
    };
  }

  /** Metres of real tide → scene units on the exaggerated ocean shell. */
  const toScene = (metres) => (metres * state.exaggeration * EARTH_RADIUS) / P.EARTH.radius;

  function updateTidesScene() {
    const { geometry, lunar, solar, sceneMoonDistance, markerLevel } = model;
    moonDir.set(Math.cos(geometry.moonAngle), 0, -Math.sin(geometry.moonAngle));
    sunDir.set(1, 0, 0);
    spinGroupA.rotation.y = geometry.earthAngle;

    oceanMaterial.uniforms.uMoonDir.value.copy(moonDir);
    oceanMaterial.uniforms.uSunDir.value.copy(sunDir);
    oceanMaterial.uniforms.uAmpMoon.value = state.moonPresent ? toScene(lunar.height) : 0;
    oceanMaterial.uniforms.uAmpSun.value = state.sunTide ? toScene(solar.height) : 0;

    moonA.visible = state.moonPresent;
    moonLine.visible = state.moonPresent;
    moonOrbitA.visible = state.moonPresent;
    moonLabelA.sprite.visible = state.moonPresent && state.showLabels;
    moonA.position.copy(moonDir).multiplyScalar(sceneMoonDistance);
    moonA.rotation.y = geometry.moonAngle + Math.PI; // the Moon keeps the same face towards Earth
    moonOrbitA.scale.set(sceneMoonDistance, 1, sceneMoonDistance);
    const linePos = moonLine.geometry.attributes.position;
    linePos.setXYZ(0, moonDir.x * OCEAN_BASE * 1.05, 0, moonDir.z * OCEAN_BASE * 1.05);
    linePos.setXYZ(1, moonA.position.x - moonDir.x * MOON_RADIUS * 1.1, 0, moonA.position.z - moonDir.z * MOON_RADIUS * 1.1);
    linePos.needsUpdate = true;

    // marker on the ocean surface
    const markerAngle = geometry.earthAngle + MARKER_LONGITUDE;
    const radial = tmpV.set(Math.cos(markerAngle), 0, -Math.sin(markerAngle));
    const surface = OCEAN_BASE + toScene(markerLevel);
    markerSprite.position.copy(radial).multiplyScalar(surface + 0.02);
    const stem = markerStem.geometry.attributes.position;
    stem.setXYZ(0, radial.x * EARTH_RADIUS * 0.98, 0, radial.z * EARTH_RADIUS * 0.98);
    stem.setXYZ(1, radial.x * (surface + 0.02), 0, radial.z * (surface + 0.02));
    stem.needsUpdate = true;
    markerLabel.sprite.visible = state.showLabels;
    sunSprite.visible = true;
    sunLabel.sprite.visible = state.showLabels;
  }

  function updateAxisScene() {
    const { tiltDeg } = model;
    const tilt = tiltDeg * DEG;
    const axisDir = tmpV.set(Math.sin(tilt) * Math.cos(precessionAngle), Math.cos(tilt), Math.sin(tilt) * Math.sin(precessionAngle));
    orientGroup.quaternion.setFromUnitVectors(Y_AXIS, axisDir);
    spinGroupB.rotation.y = spinB;

    const showCone = state.showCone && state.moonPresent;
    cone.visible = showCone;
    coneWire.visible = showCone;
    if (showCone) {
      const s = Math.max(Math.sin(tilt) * AXIS_LEN, 1e-3);
      cone.scale.set(s, Math.cos(tilt) * AXIS_LEN, s);
      coneWire.scale.copy(cone.scale);
    }
    traceLine.visible = state.showTrace;
    planeGroup.visible = state.showOrbitPlane;
    poleLine.visible = state.showOrbitPlane;
    poleLabel.sprite.visible = state.showOrbitPlane && state.showLabels;
    northLabel.sprite.visible = southLabel.sprite.visible = state.showLabels;

    moonB.visible = state.moonPresent;
    moonOrbitB.visible = state.moonPresent && state.showOrbitPlane;
    moonLabelB.sprite.visible = state.moonPresent && state.showLabels;
    moonB.position.set(Math.cos(moonAngleB) * AXIS_MOON_DISTANCE, 0, -Math.sin(moonAngleB) * AXIS_MOON_DISTANCE);
    moonB.rotation.y = moonAngleB + Math.PI;
    sunSprite.visible = true;
    sunLabel.sprite.visible = state.showLabels;
  }

  function pushTracePoint() {
    const tilt = model.tiltDeg * DEG;
    const i = traceHead;
    traceRing[i * 3] = Math.sin(tilt) * Math.cos(precessionAngle) * AXIS_LEN;
    traceRing[i * 3 + 1] = Math.cos(tilt) * AXIS_LEN;
    traceRing[i * 3 + 2] = Math.sin(tilt) * Math.sin(precessionAngle) * AXIS_LEN;
    traceHead = (traceHead + 1) % TRACE_POINTS;
    traceCount = Math.min(traceCount + 1, TRACE_POINTS);
    rebuildTrace();
  }

  /** Copy the ring buffer into draw order (oldest → newest) and fade the tail. */
  function rebuildTrace() {
    const start = (traceHead - traceCount + TRACE_POINTS) % TRACE_POINTS;
    const base = state.moonPresent ? COLORS.trace : COLORS.chaos;
    for (let n = 0; n < traceCount; n++) {
      const src = (start + n) % TRACE_POINTS;
      tracePositions[n * 3] = traceRing[src * 3];
      tracePositions[n * 3 + 1] = traceRing[src * 3 + 1];
      tracePositions[n * 3 + 2] = traceRing[src * 3 + 2];
      const fade = 0.08 + 0.92 * (n / Math.max(traceCount - 1, 1));
      traceColor.set(base).multiplyScalar(fade);
      traceColors[n * 3] = traceColor.r;
      traceColors[n * 3 + 1] = traceColor.g;
      traceColors[n * 3 + 2] = traceColor.b;
    }
    traceGeometry.attributes.position.needsUpdate = true;
    traceGeometry.attributes.color.needsUpdate = true;
    traceGeometry.setDrawRange(0, traceCount);
  }
  function clearTrace() {
    traceCount = 0;
    traceHead = 0;
    traceGeometry.setDrawRange(0, 0);
  }

  /** Camera-dependent bits: label offsets, marker size. */
  function updateOverlay() {
    tmpUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const camDist = camera.position.length();
    sunLabel.sprite.position.copy(sunSprite.position).addScaledVector(tmpUp, -SUN_SPRITE_DISTANCE * 0.045);
    if (state.view === 'tides') {
      const d = Math.max(camera.position.distanceTo(moonA.position), 1e-3);
      moonLabelA.sprite.position.copy(moonA.position).addScaledVector(tmpUp, MOON_RADIUS + d * 0.03);
      markerLabel.sprite.position.copy(markerSprite.position).addScaledVector(tmpUp, camDist * 0.035);
      markerSprite.scale.setScalar(clamp(0.6 / camDist, 0.012, 0.06));
    } else {
      const d = Math.max(camera.position.distanceTo(moonB.position), 1e-3);
      moonLabelB.sprite.position.copy(moonB.position).addScaledVector(tmpUp, MOON_RADIUS + d * 0.03);
    }
    const near = clamp(camDist * 0.01, 0.02, 2);
    if (Math.abs(camera.near - near) / near > 0.2) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
  }

  function updateScene() {
    tidesGroup.visible = state.view === 'tides';
    axisGroup.visible = state.view === 'axis';
    if (state.view === 'tides') updateTidesScene();
    else updateAxisScene();
  }

  function refresh() {
    model = derive();
    updateScene();
    updateOverlay();
    updateReadouts(true);
    sim.requestRender();
  }

  // --- camera tween ------------------------------------------------------------------------------
  let cameraTween = null;
  function tweenCamera(toPosition, { duration = 0.9 } = {}) {
    if (sim.reducedMotion || duration <= 0) {
      camera.position.copy(toPosition);
      controls.target.set(0, 0, 0);
      controls.update();
      sim.requestRender();
      return;
    }
    cameraTween = { from: camera.position.clone(), to: toPosition.clone(), t: 0, duration };
  }
  function stepTween(dt) {
    if (!cameraTween) return;
    cameraTween.t = Math.min(1, cameraTween.t + dt / cameraTween.duration);
    camera.position.lerpVectors(cameraTween.from, cameraTween.to, easeInOut(cameraTween.t));
    controls.target.set(0, 0, 0);
    if (cameraTween.t >= 1) cameraTween = null;
  }
  const CAMERA = {
    tides: { side: [5.5, 3.4, 9.5], top: [0.01, 11, 0] },
    tidesToScale: { side: [20, 28, 95], top: [0.01, 100, 0] },
    axis: { side: [6.5, 3.6, 7.5], top: [0.01, 10.5, 0] },
  };
  let cameraMode = 'side';
  const cameraFor = () => new THREE.Vector3(...(state.view === 'axis' ? CAMERA.axis : state.toScale ? CAMERA.tidesToScale : CAMERA.tides)[cameraMode]);
  function setCamera(mode, { announce = false } = {}) {
    cameraMode = mode;
    syncCameraButtons({ announce });
    tweenCamera(cameraFor());
  }

  // --- frame ---------------------------------------------------------------------------------------
  function frame(dt) {
    if (state.playing) {
      if (state.view === 'tides') {
        tideTimeH += dt * state.tideSpeed;
        const elongationDeg = Math.round(normalizeDeg(P.tideGeometry(tideTimeH, state.distanceFactor, elongation0).moonAngle / DEG));
        if (elongationDeg !== elongationSlider.value) elongationSlider.setValue(elongationDeg, { silent: true });
      } else {
        const dYears = dt * state.axisSpeed * 1000;
        axisTimeYr += dYears;
        precessionAngle = (precessionAngle + (2 * Math.PI * dYears) / model.precessionPeriodYr) % (2 * Math.PI);
        spinB = (spinB + dt * 0.6) % (2 * Math.PI);
        moonAngleB = (moonAngleB + dt * 0.35) % (2 * Math.PI);
      }
    }
    model = derive();
    updateScene();
    stepTween(dt);
    updateOverlay();
    if (state.playing && state.view === 'axis') {
      traceAccumulator += dt;
      if (traceAccumulator >= 1 / 60) {
        traceAccumulator = 0;
        pushTracePoint();
      }
    }
    updateReadouts();
  }
  sim.onFrame(frame);
  const onControlsChange = () => {
    if (sim.reducedMotion || sim.paused) updateOverlay();
  };
  controls.addEventListener('change', onControlsChange);
  disposers.push(() => controls.removeEventListener('change', onControlsChange));

  // =============================================================================================
  // state setters
  // =============================================================================================
  function setView(view) {
    if (state.view === view) return;
    state.view = view;
    syncViewButtons();
    tweenCamera(cameraFor());
    refresh();
  }
  function setDistance(k, { fromSlider = false } = {}) {
    state.distanceFactor = clamp(Math.round(k * 100) / 100, P.DISTANCE_RANGE.min, P.DISTANCE_RANGE.max);
    if (!fromSlider) distanceSlider.setValue(state.distanceFactor, { silent: true });
    // keep the Moon where it is on screen when the month length changes
    const before = model ? model.geometry.moonAngle : elongation0;
    elongation0 = before - (2 * Math.PI * tideTimeH) / (P.synodicMonthDays(state.distanceFactor) * 24);
    refresh();
  }
  function setExaggeration(v, { fromSlider = false } = {}) {
    state.exaggeration = clamp(v, P.EXAGGERATION_RANGE.min, P.EXAGGERATION_RANGE.max);
    if (!fromSlider) exaggerationSlider.setValue(Math.log10(state.exaggeration), { silent: true });
    refresh();
  }
  function setElongation(deg, { fromSlider = false } = {}) {
    const target = deg * DEG;
    elongation0 = target - (2 * Math.PI * tideTimeH) / (P.synodicMonthDays(state.distanceFactor) * 24);
    if (!fromSlider) elongationSlider.setValue(normalizeDeg(deg), { silent: true });
    refresh();
  }
  function setPlaying(v) {
    state.playing = v;
    syncPlayButtons();
    sim.requestRender();
  }
  function setMoonPresent(present) {
    if (state.moonPresent === present) return;
    tiltBlend = { fromDeg: model.tiltDeg, sinceYr: axisTimeYr, switchYr: axisTimeYr };
    state.moonPresent = present;
    clearTrace();
    syncMoonButton();
    refresh();
  }
  function setSunTide(v) {
    state.sunTide = v;
    refresh();
  }
  function setToScale(v) {
    state.toScale = v;
    viewPrefs.set('toScale', v);
    if (state.view === 'tides') tweenCamera(cameraFor());
    refresh();
  }

  // =============================================================================================
  // control panel
  // =============================================================================================
  // while the panel is open on a wide screen the picture slides left, so what the
  // simulation shows stays centred in the free part of the canvas
  const viewShift = createPanelShift({ sim, viewport });
  const panel = createPanel({
    onToggle: () => viewShift.sync(),
    camera: { views: CAMERA_VIEWS, onSelect: (id) => setCamera(id) },
  });
  const isSmallScreen = window.matchMedia('(max-width: 720px)').matches;

  // view switch
  const viewSwitch = el('div', 'lp-view-switch', { role: 'group' });
  bindAttr(viewSwitch, { 'aria-label': `${KEYS}.views.label` });
  const viewButtons = ['tides', 'axis'].map((id) => {
    const btn = createButton({ labelKey: `${KEYS}.views.${id}`, icon: id === 'tides' ? '🌊' : '🧭', onClick: () => setView(id) });
    btn.el.classList.add('lp-view-switch__btn');
    viewSwitch.append(btn.el);
    return { id, el: btn.el };
  });
  function syncViewButtons() {
    for (const { id, el: btn } of viewButtons) btn.setAttribute('aria-pressed', String(state.view === id));
    for (const group of [tidesControls, tidesReadouts]) group.hidden = state.view !== 'tides';
    for (const group of [axisControls, axisReadouts]) group.hidden = state.view !== 'axis';
    tidesLegend.hidden = state.view !== 'tides';
    axisLegend.hidden = state.view !== 'axis';
  }

  // --- controls: the Moon's distance up front, the per-view controls folded away -------------------
  const distanceSlider = createSlider({
    labelKey: `${KEYS}.controls.distance`,
    min: P.DISTANCE_RANGE.min,
    max: P.DISTANCE_RANGE.max,
    step: 0.01,
    value: state.distanceFactor,
    format: (v) => `${fmt(v * P.MOON.distanceKm, 0)} ${t('units.kilometers')} (${fmt(v, 2, 2)}×)`,
    onChange: (v) => setDistance(v, { fromSlider: true }),
  });
  const moonBtn = createButton({ labelKey: `${KEYS}.controls.removeMoon`, icon: '🌑', variant: 'primary', compact: true, onClick: () => setMoonPresent(!state.moonPresent) });
  function syncMoonButton() {
    moonBtn.setIcon(state.moonPresent ? '🌑' : '🌕');
    moonBtn.setLabel(state.moonPresent ? `${KEYS}.controls.removeMoon` : `${KEYS}.controls.restoreMoon`);
    moonBtn.el.classList.toggle('lp-button--primary', state.moonPresent);
    moonBtn.el.classList.toggle('lp-button--ghost', !state.moonPresent);
    moonRemovedNote.hidden = state.moonPresent;
  }
  const moonRow = createControlRow(distanceSlider, moonBtn);
  const moonRemovedNote = bindText(el('p', 'lp-preset-note lp-preset-note--warn'), `${KEYS}.moonFacts.removed`);

  const moreControls = createCollapsibleSection({ titleKey: `${KEYS}.sections.more`, open: false });

  // tides controls (view A)
  const tidesControls = el('div', 'lp-group');
  const exaggerationSlider = createSlider({
    labelKey: `${KEYS}.controls.exaggeration`,
    min: Math.log10(P.EXAGGERATION_RANGE.min),
    max: Math.log10(P.EXAGGERATION_RANGE.max),
    step: 0.05,
    value: Math.log10(state.exaggeration),
    format: (v) => `${fmt(Math.round(Math.pow(10, v) / 1000) * 1000, 0)}×`,
    onChange: (v) => setExaggeration(Math.round(Math.pow(10, v) / 1000) * 1000, { fromSlider: true }),
  });
  const speedSlider = createSlider({
    labelKey: `${KEYS}.controls.speed`,
    min: Math.log10(P.TIDE_SPEED_RANGE_H_PER_S.min),
    max: Math.log10(P.TIDE_SPEED_RANGE_H_PER_S.max),
    step: 0.01,
    value: Math.log10(state.tideSpeed),
    format: (v) => `${fmt(Math.pow(10, v), Math.pow(10, v) < 2 ? 2 : 1)} ${t('units.hoursPerSecond')}`,
    onChange: (v) => {
      state.tideSpeed = Math.pow(10, v);
    },
  });
  const playBtn = createButton({ labelKey: `${KEYS}.controls.pause`, icon: '⏸', variant: 'primary', compact: true, onClick: () => setPlaying(!state.playing) });
  const sunToggle = createToggle({ labelKey: `${KEYS}.controls.sun`, checked: state.sunTide, onChange: setSunTide });
  const sunHint = bindText(el('p', 'lp-section__note'), `${KEYS}.tides.sunHint`);
  const elongationSlider = createSlider({
    labelKey: `${KEYS}.controls.elongation`,
    unitKey: 'units.degrees',
    min: 0,
    max: 360,
    step: 1,
    value: normalizeDeg(DEFAULT_ELONGATION / DEG),
    decimals: 0,
    onChange: (v) => setElongation(v, { fromSlider: true }),
  });
  const phaseRow = el('div', 'lp-presets lp-presets--compact', { role: 'group' });
  bindAttr(phaseRow, { 'aria-label': `${KEYS}.controls.phases` });
  const phaseButtons = PHASE_PRESETS.map((preset) => {
    const btn = createButton({ labelKey: `${KEYS}.phases.${preset.id}`, onClick: () => setElongation(preset.elongation / DEG) });
    btn.el.classList.add('lp-presets__btn', 'lp-presets__btn--stack');
    const value = el('span', 'lp-presets__value');
    value.textContent = ['🌑', '🌓', '🌕', '🌗'][PHASE_PRESETS.indexOf(preset)];
    btn.el.prepend(value);
    phaseRow.append(btn.el);
    return { preset, el: btn.el };
  });
  function syncPhaseButtons() {
    for (const { preset, el: btn } of phaseButtons) {
      const diff = Math.abs(normalizeDeg((model.elongation - preset.elongation) / DEG + 180) - 180);
      btn.setAttribute('aria-pressed', String(diff < 12));
    }
  }
  const toScaleToggle = createToggle({ labelKey: `${KEYS}.controls.toScale`, checked: state.toScale, onChange: setToScale });
  tidesControls.append(exaggerationSlider.el, createControlRow(speedSlider, playBtn).el, sunToggle.el, sunHint, elongationSlider.el, phaseRow, toScaleToggle.el);

  // axis controls (view B)
  const axisControls = el('div', 'lp-group');
  const axisSpeedSlider = createSlider({
    labelKey: `${KEYS}.controls.axisSpeed`,
    unitKey: 'units.kyrPerSecond',
    min: P.AXIS_SPEED_RANGE_KYR_PER_S.min,
    max: P.AXIS_SPEED_RANGE_KYR_PER_S.max,
    step: 0.5,
    value: state.axisSpeed,
    decimals: 1,
    onChange: (v) => {
      state.axisSpeed = v;
    },
  });
  const playBtnB = createButton({ labelKey: `${KEYS}.controls.pause`, icon: '⏸', variant: 'primary', compact: true, onClick: () => setPlaying(!state.playing) });
  function syncPlayButtons() {
    for (const btn of [playBtn, playBtnB]) {
      btn.setIcon(state.playing ? '⏸' : '▶');
      btn.setLabel(state.playing ? `${KEYS}.controls.pause` : `${KEYS}.controls.play`);
      btn.el.setAttribute('aria-pressed', String(state.playing));
    }
  }
  const viewToggle = (name, labelKey, onChange = refresh) => createStateToggle({ labelKey, state, name, prefs: viewPrefs, onChange });
  const axisToggles = {
    showTrace: viewToggle('showTrace', `${KEYS}.controls.trace`),
    showCone: viewToggle('showCone', `${KEYS}.controls.cone`),
    showOrbitPlane: viewToggle('showOrbitPlane', `${KEYS}.controls.orbitPlane`),
  };
  axisControls.append(createControlRow(axisSpeedSlider, playBtnB).el, axisToggles.showTrace.el, axisToggles.showCone.el, axisToggles.showOrbitPlane.el);

  // shared view controls
  const labelsToggle = viewToggle('showLabels', `${KEYS}.controls.labels`);
  const cameraRow = el('div', 'lp-presets lp-presets--2 lp-presets--compact', { role: 'group' });
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

  const resetBtn = createButton({ labelKey: 'panel.reset', icon: '↺', onClick: reset });
  const resetRow = el('div', 'lp-button-row lp-button-row--full');
  resetRow.append(resetBtn.el);

  moreControls.add(tidesControls, axisControls);
  if (sim.reducedMotion) moreControls.add(createNotice({ textKey: 'motion.reducedNotice' }));
  moreControls.add(bindText(el('p', 'lp-subheading'), `${KEYS}.sections.view`), cameraRow, labelsToggle, resetRow);

  // --- readouts: the Moon's numbers, then whichever view is showing --------------------------------
  const moonFacts = createFacts([
    ['distance', `${KEYS}.moonFacts.distance`],
    ['acceleration', `${KEYS}.moonFacts.acceleration`],
    ['height', `${KEYS}.moonFacts.height`],
    ['relative', `${KEYS}.moonFacts.relative`],
    ['month', `${KEYS}.moonFacts.month`],
    ['lunarDay', `${KEYS}.moonFacts.lunarDay`],
  ]);

  const tidesReadouts = el('div', 'lp-group');
  const rangeReadout = el('div', 'lp-readout');
  const rangeLabel = bindText(el('div', 'lp-readout__label'), `${KEYS}.tides.range`);
  const rangeValue = el('div', 'lp-readout__value', { 'aria-live': 'off' });
  const rangePill = el('span', 'lp-state');
  const phaseNote = el('p', 'lp-state__hint');
  rangeReadout.append(rangeLabel, rangeValue, rangePill, phaseNote);
  const gaugeReadout = el('div', 'lp-readout lp-readout--gauge');
  const gaugeLabel = bindText(el('div', 'lp-readout__label'), `${KEYS}.tides.gaugeTitle`);
  const gaugeValue = el('div', 'lp-readout__value', { 'aria-live': 'off' });
  const gaugePill = el('span', 'lp-state');
  const tideChart = createStripChart({ labelKey: `${KEYS}.tides.chartLabel`, window: TIDE_CHART_WINDOW_H, yPadding: 0.05, zeroLine: true, formatY: (v) => `${v >= 0 ? '+' : '−'}${fmt(Math.abs(v), 2, 2)} m` });
  const gaugeTime = el('p', 'lp-state__hint');
  gaugeReadout.append(gaugeLabel, gaugeValue, gaugePill, tideChart.el, gaugeTime);
  tidesReadouts.append(rangeReadout, gaugeReadout);

  const axisReadouts = el('div', 'lp-group');
  const tiltReadout = el('div', 'lp-readout');
  const tiltLabel = bindText(el('div', 'lp-readout__label'), `${KEYS}.axis.tilt`);
  const tiltValue = el('div', 'lp-readout__value', { 'aria-live': 'off' });
  const tiltPill = el('span', 'lp-state');
  const tiltChart = createStripChart({
    labelKey: `${KEYS}.axis.chartLabel`,
    window: AXIS_CHART_WINDOW_YR,
    fixedRange: [0, 62],
    band: [P.EARTH.tiltMinDeg, P.EARTH.tiltMaxDeg],
    formatY: (v) => `${fmt(v, 1, 1)}°`,
  });
  const axisFacts = createFacts([
    ['elapsed', `${KEYS}.axis.elapsed`],
    ['precession', `${KEYS}.axis.precession`],
  ]);
  const bandNote = bindText(el('p', 'lp-state__hint'), `${KEYS}.axis.stableBand`);
  tiltReadout.append(tiltLabel, tiltValue, tiltPill, tiltChart.el, bandNote);
  // the pair states what the axis does with the Moon and without it – live, so it stays with the readout
  const stableNote = createNotice({ textKey: `${KEYS}.axis.stableNote`, tone: 'info' });
  const schematicNotice = createNotice({ textKey: `${KEYS}.axis.schematic`, tone: 'warn' });
  axisReadouts.append(tiltReadout, axisFacts.el, stableNote.el, schematicNotice.el);

  const tidesLegend = createLegend([
    [`${KEYS}.legend.bulge`, COLORS.ocean],
    [`${KEYS}.legend.seaLevel`, COLORS.seaLevel, 'dashed'],
    [`${KEYS}.legend.marker`, COLORS.marker],
    [`${KEYS}.legend.moonLine`, COLORS.moonLine],
  ]);
  const axisLegend = createLegend([
    [`${KEYS}.legend.axis`, COLORS.axis],
    [`${KEYS}.legend.trace`, COLORS.trace],
    [`${KEYS}.legend.eclipticPole`, COLORS.ecliptic, 'dashed'],
  ]);

  const infoCard = createInfoCard({ titleKey: `${KEYS}.info.title`, bodyKey: `${KEYS}.info.body`, open: !isSmallScreen });
  const comparisonCard = createComparisonCard();
  const physicsCard = createPhysicsCard();
  panel.add(
    viewSwitch, moonRow, moonRemovedNote, moreControls,
    bindText(el('p', 'lp-subheading'), `${KEYS}.sections.moon`), moonFacts,
    tidesReadouts, axisReadouts, tidesLegend, axisLegend,
    infoCard, comparisonCard, physicsCard,
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

  function reset() {
    const view = state.view;
    Object.assign(state, DEFAULTS, { view });
    tideTimeH = 0;
    elongation0 = DEFAULT_ELONGATION;
    axisTimeYr = 0;
    precessionAngle = 0;
    tiltBlend = { fromDeg: P.tiltWithMoonDeg(0), sinceYr: -Infinity, switchYr: 0 };
    spinB = 0;
    clearTrace();
    tideChart.clear();
    tiltChart.clear();
    distanceSlider.setValue(state.distanceFactor, { silent: true });
    exaggerationSlider.setValue(Math.log10(state.exaggeration), { silent: true });
    speedSlider.setValue(Math.log10(state.tideSpeed), { silent: true });
    axisSpeedSlider.setValue(state.axisSpeed, { silent: true });
    elongationSlider.setValue(normalizeDeg(DEFAULT_ELONGATION / DEG), { silent: true });
    sunToggle.setChecked(state.sunTide, { silent: true });
    syncMoonButton();
    syncPlayButtons();
    syncViewButtons();
    setCamera('side');
    refresh();
  }

  // =============================================================================================
  // readouts
  // =============================================================================================
  let lastReadoutKey = '';
  let lastTideSample = -Infinity;
  let lastTiltSample = -Infinity;
  function updateReadouts(force = false) {
    const m = model;
    // charts sample on their own clocks
    if (state.view === 'tides' && (force || tideTimeH - lastTideSample >= 0.1 || tideTimeH < lastTideSample)) {
      lastTideSample = tideTimeH;
      tideChart.push(tideTimeH, m.markerLevel);
    }
    if (state.view === 'axis' && (force || axisTimeYr - lastTiltSample >= 500 || axisTimeYr < lastTiltSample)) {
      lastTiltSample = axisTimeYr;
      tiltChart.push(axisTimeYr, m.tiltDeg);
    }
    if (state.view === 'tides') tideChart.draw();
    else tiltChart.draw();

    const key = [state.view, state.distanceFactor, state.moonPresent, state.sunTide, m.markerLevel.toFixed(3), m.rising, m.range.toFixed(3), m.phase, m.tiltDeg.toFixed(1), Math.floor(axisTimeYr / 1000), Math.floor(tideTimeH)].join('|');
    if (!force && key === lastReadoutKey) return;
    lastReadoutKey = key;

    // Moon facts
    const none = t(`${KEYS}.moonFacts.none`);
    moonFacts.set('distance', `${fmt(state.distanceFactor * P.MOON.distanceKm, 0)} ${t('units.kilometers')}`);
    moonFacts.set('acceleration', state.moonPresent ? `${formatSci(m.lunar.acceleration)} ${t('units.metersPerSecondSquared')}` : none);
    moonFacts.set('height', state.moonPresent ? `${fmt(m.lunar.height, 2, 2)} ${t('units.meters')}` : none);
    moonFacts.set('relative', state.moonPresent ? `${fmt(m.lunar.relativeToToday, m.lunar.relativeToToday < 1 ? 2 : 1)}×` : none);
    moonFacts.set('month', state.moonPresent ? `${fmt(m.siderealMonthDays, 1, 1)} ${t('units.days')}` : none);
    moonFacts.set('lunarDay', state.moonPresent ? formatHours(m.lunarDayHours) : none);

    if (state.view === 'tides') {
      rangeValue.textContent = `${fmt(m.range, 2, 2)} ${t('units.meters')}`;
      rangePill.textContent = t(`${KEYS}.tides.rangeKind.${m.rangeKind}`);
      rangePill.className = `lp-state lp-state--${m.rangeKind}`;
      if (state.moonPresent) phaseNote.textContent = `${t(`${KEYS}.phases.${m.phase}`)} · ${fmt(normalizeDeg(m.elongation / DEG), 0)}°`;
      else phaseNote.textContent = t(`${KEYS}.tides.${state.sunTide ? 'noMoon' : 'noBodies'}`);
      gaugeValue.textContent = `${m.markerLevel >= 0 ? '+' : '−'}${fmt(Math.abs(m.markerLevel), 2, 2)} ${t('units.meters')}`;
      const quiet = !state.moonPresent && !state.sunTide;
      gaugePill.hidden = quiet;
      gaugePill.textContent = t(`${KEYS}.tides.${m.rising ? 'rising' : 'falling'}`);
      gaugePill.className = `lp-state lp-state--${m.rising ? 'rising' : 'falling'}`;
      const days = Math.floor(tideTimeH / 24);
      gaugeTime.textContent = `${t(`${KEYS}.tides.simTime`)}: ${t(`${KEYS}.tides.time`, { days: fmt(days, 0), hours: fmt(Math.floor(tideTimeH - days * 24), 0) })}`;
      syncPhaseButtons();
    } else {
      tiltValue.textContent = `${fmt(m.tiltDeg, 1, 1)}°`;
      tiltPill.textContent = t(`${KEYS}.axis.${state.moonPresent ? 'stable' : 'chaotic'}`);
      tiltPill.className = `lp-state lp-state--${state.moonPresent ? 'stable' : 'chaotic'}`;
      axisFacts.set('elapsed', formatYears(axisTimeYr));
      axisFacts.set('precession', formatYears(m.precessionPeriodYr));
      stableNote.el.hidden = !state.moonPresent;
      schematicNotice.el.hidden = state.moonPresent;
    }
  }

  // --- language ---------------------------------------------------------------------------------------
  disposers.push(
    onLanguageChange(() => {
      sunLabel.setText(t(`${KEYS}.labels.sun`));
      moonLabelA.setText(t(`${KEYS}.labels.moon`));
      moonLabelB.setText(t(`${KEYS}.labels.moon`));
      markerLabel.setText(t(`${KEYS}.labels.marker`));
      northLabel.setText(t(`${KEYS}.labels.north`));
      southLabel.setText(t(`${KEYS}.labels.south`));
      poleLabel.setText(t(`${KEYS}.labels.eclipticPole`));
      distanceSlider.setValue(distanceSlider.value, { silent: true });
      exaggerationSlider.setValue(exaggerationSlider.value, { silent: true });
      speedSlider.setValue(speedSlider.value, { silent: true });
      syncMoonButton();
      syncPlayButtons();
      comparisonCard.render();
      physicsCard.render();
      updateReadouts(true);
      sim.requestRender();
    }),
  );

  // --- go ---------------------------------------------------------------------------------------------------
  sunLabel.setText(t(`${KEYS}.labels.sun`));
  moonLabelA.setText(t(`${KEYS}.labels.moon`));
  moonLabelB.setText(t(`${KEYS}.labels.moon`));
  markerLabel.setText(t(`${KEYS}.labels.marker`));
  northLabel.setText(t(`${KEYS}.labels.north`));
  southLabel.setText(t(`${KEYS}.labels.south`));
  poleLabel.setText(t(`${KEYS}.labels.eclipticPole`));
  model = derive();
  syncMoonButton();
  syncPlayButtons();
  syncViewButtons();
  syncCameraButtons();
  refresh();
  sim.start();

  // dev-only hook for automated checks; stripped from production builds
  if (import.meta.env.DEV) {
    window.__lpMoonTides = {
      sim,
      state,
      get model() {
        return model;
      },
      get tideTimeH() {
        return tideTimeH;
      },
      get axisTimeYr() {
        return axisTimeYr;
      },
      setView,
      setDistance,
      setExaggeration,
      setElongation,
      setPlaying,
      setMoonPresent,
      setSunTide,
      setToScale,
      setCamera,
      reset,
      frame,
      refresh,
      oceanUniforms: oceanMaterial.uniforms,
    };
  }

  return () => {
    if (import.meta.env.DEV) delete window.__lpMoonTides;
    disposers.forEach((d) => d());
    panel.dispose();
    hint.remove();
    credit.remove();
    for (const l of [sunLabel, moonLabelA, moonLabelB, markerLabel, northLabel, southLabel, poleLabel]) l.dispose();
    glowTexture.dispose();
    moonTexture.dispose();
    sim.dispose();
    viewport.remove();
  };
}

// ============================================================================================================
// formatting helpers
// ============================================================================================================
const SUPERSCRIPT = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
/** 1.0992e-6 → "1.10 × 10⁻⁶" */
function formatSci(v) {
  const exp = Math.floor(Math.log10(Math.abs(v)));
  const mantissa = v / Math.pow(10, exp);
  const sup = String(exp).split('').map((c) => SUPERSCRIPT[c] ?? c).join('');
  return `${formatNumber(mantissa, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} × 10${sup}`;
}
function formatHours(h) {
  const whole = Math.floor(h);
  const minutes = Math.round((h - whole) * 60);
  return `${formatNumber(whole, { maximumFractionDigits: 0 })} ${t('units.hours')} ${formatNumber(minutes, { maximumFractionDigits: 0 })} ${t('units.minutes')}`;
}
function formatYears(yr) {
  if (yr >= 1e6) return t(`${KEYS}.axis.myr`, { n: formatNumber(yr / 1e6, { maximumFractionDigits: 2, minimumFractionDigits: 2 }) });
  return t(`${KEYS}.axis.kyr`, { n: formatNumber(yr / 1000, { maximumFractionDigits: 1, minimumFractionDigits: yr >= 1e5 ? 0 : 1 }) });
}
const normalizeDeg = (d) => ((d % 360) + 360) % 360;

// ============================================================================================================
// DOM helpers
// ============================================================================================================
function createFacts(rows) {
  const dl = el('dl', 'lp-facts lp-facts--accent');
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

/**
 * Small canvas strip chart of (x, y) samples inside a sliding x window.
 * Options: window (x span), fixedRange [min,max] or auto with yPadding, band [lo,hi] shading, zeroLine, formatY.
 */
function createStripChart({ labelKey, window: xWindow, fixedRange, yPadding = 0.1, band, zeroLine = false, formatY }) {
  const wrap = el('div', 'lp-chart-wrap');
  const canvas = el('canvas', 'lp-chart', { role: 'img' });
  bindAttr(canvas, { 'aria-label': labelKey });
  const label = bindText(el('span', 'lp-chart__label'), labelKey);
  wrap.append(canvas, label);
  const ctx = canvas.getContext('2d');
  const xs = [];
  const ys = [];
  let dirty = true;
  const accent = '#7cc4ff';
  return {
    el: wrap,
    push(x, y) {
      if (xs.length && x < xs[xs.length - 1]) {
        xs.length = 0;
        ys.length = 0;
      }
      xs.push(x);
      ys.push(y);
      const cutoff = x - xWindow;
      let drop = 0;
      while (drop < xs.length - 1 && xs[drop + 1] < cutoff) drop++;
      if (drop) {
        xs.splice(0, drop);
        ys.splice(0, drop);
      }
      dirty = true;
    },
    clear() {
      xs.length = 0;
      ys.length = 0;
      dirty = true;
    },
    draw() {
      if (!dirty || !canvas.isConnected) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || 300;
      const h = canvas.clientHeight || 72;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const padL = 44;
      const padR = 8;
      const padY = 8;
      let lo;
      let hi;
      if (fixedRange) [lo, hi] = fixedRange;
      else {
        lo = Math.min(0, ...ys);
        hi = Math.max(0, ...ys);
        const span = Math.max(hi - lo, 1e-3);
        lo -= span * yPadding;
        hi += span * yPadding;
      }
      const xEnd = xs.length ? xs[xs.length - 1] : 0;
      const xStart = xEnd - xWindow;
      const px = (x) => padL + ((x - xStart) / xWindow) * (w - padL - padR);
      const py = (y) => h - padY - ((y - lo) / (hi - lo)) * (h - 2 * padY);
      if (band) {
        ctx.fillStyle = 'rgba(90, 220, 140, 0.18)';
        ctx.fillRect(padL, py(band[1]), w - padL - padR, py(band[0]) - py(band[1]));
      }
      ctx.strokeStyle = 'rgba(167, 180, 204, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, padY);
      ctx.lineTo(padL, h - padY);
      ctx.stroke();
      if (zeroLine && lo < 0 && hi > 0) {
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(padL, py(0));
        ctx.lineTo(w - padR, py(0));
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = '#a7b4cc';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const labelHi = fixedRange ? hi : Math.max(...ys, 0);
      const labelLo = fixedRange ? lo : Math.min(...ys, 0);
      if (formatY && xs.length) {
        ctx.fillText(formatY(labelHi), padL - 4, py(labelHi) + (fixedRange ? 6 : 0));
        if (Math.abs(py(labelLo) - py(labelHi)) > 14) ctx.fillText(formatY(labelLo), padL - 4, py(labelLo) - (fixedRange ? 6 : 0));
      }
      if (xs.length > 1) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.8;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < xs.length; i++) {
          const x = px(xs[i]);
          const y = py(ys[i]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(px(xs[xs.length - 1]), py(ys[ys.length - 1]), 3, 0, Math.PI * 2);
        ctx.fill();
      }
      dirty = false;
    },
    dispose() {},
  };
}

/** Collapsible card with the bilingual moon-size comparison table. */
function createComparisonCard() {
  const details = el('details', 'lp-info');
  const summary = el('summary', 'lp-info__summary');
  summary.append(bindText(el('span', 'lp-info__title'), `${KEYS}.comparison.title`));
  const body = el('div', 'lp-info__body');
  details.append(summary, body);
  function render() {
    body.replaceChildren();
    const intro = el('p');
    intro.textContent = t(`${KEYS}.comparison.intro`);
    const wrap = el('div', 'lp-table-wrap');
    const table = el('table', 'lp-compare');
    const thead = el('thead');
    const hr = el('tr');
    for (const k of ['system', 'ratio']) {
      const th = el('th', '', { scope: 'col' });
      th.textContent = t(`${KEYS}.comparison.${k}`);
      hr.append(th);
    }
    thead.append(hr);
    const tbody = el('tbody');
    const maxRatio = Math.max(...P.MOON_COMPARISON.map((r) => r.ratio));
    for (const row of P.MOON_COMPARISON) {
      const tr = el('tr', row.id === 'earthMoon' ? 'is-highlight' : '');
      const name = el('td');
      const title = el('span', 'lp-compare__name');
      title.textContent = `${t(`${KEYS}.comparison.names.${row.planet}`)} / ${t(`${KEYS}.comparison.names.${row.moon}`)}`;
      const diameters = el('span', 'lp-compare__sub');
      diameters.textContent = `${t(`${KEYS}.comparison.diameters`)}: ${formatNumber(row.moonKm, { maximumFractionDigits: row.moonKm < 100 ? 1 : 0 })} / ${formatNumber(row.planetKm, { maximumFractionDigits: 0 })} ${t('units.kilometers')}`;
      name.append(title, diameters);
      const ratio = el('td', 'lp-compare__ratio');
      const pct = row.ratio * 100;
      ratio.textContent = `${formatNumber(pct, { maximumFractionDigits: pct < 1 ? 2 : 1, minimumFractionDigits: pct < 1 ? 2 : 1 })} ${t('units.percent')}`;
      const bar = el('span', 'lp-compare__bar', { 'aria-hidden': 'true' });
      bar.style.width = `${Math.max(2, (row.ratio / maxRatio) * 100)}%`;
      const barWrap = el('span', 'lp-compare__bar-wrap', { 'aria-hidden': 'true' });
      barWrap.append(bar);
      ratio.append(barWrap);
      tr.append(name, ratio);
      tbody.append(tr);
    }
    table.append(thead, tbody);
    wrap.append(table);
    const note = el('p');
    note.textContent = t(`${KEYS}.comparison.note`);
    body.append(intro, wrap, note);
  }
  render();
  return { el: details, render, dispose() {} };
}

/** Collapsible "Physics" card listing the formulas used. */
function createPhysicsCard() {
  const details = el('details', 'lp-info lp-physics');
  const summary = el('summary', 'lp-info__summary');
  summary.append(bindText(el('span', 'lp-info__title'), `${KEYS}.physics.title`));
  const body = el('div', 'lp-info__body');
  details.append(summary, body);
  const entries = ['acceleration', 'height', 'range', 'kepler', 'stability'];
  function render() {
    body.replaceChildren();
    // the caveat behind every height in the panel: the numbers are real, the 3D bulge is not
    const caveat = el('div', 'lp-notice lp-notice--info', { role: 'note' });
    caveat.textContent = t(`${KEYS}.tides.realHeightNote`);
    body.append(caveat);
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

// ============================================================================================================
// geometry / textures
// ============================================================================================================
/** Circle in the xz plane. */
function circleGeometry(radius, segments = 192) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(radius * Math.cos(a), 0, radius * Math.sin(a)));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

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

/** Procedural grey Moon: mottled base with soft craters (deterministic). */
function createMoonTexture(width = 1024, height = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  let seed = 1234567;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  ctx.fillStyle = '#8d8d90';
  ctx.fillRect(0, 0, width, height);
  // mottling (maria)
  for (let i = 0; i < 220; i++) {
    const r = 20 + rand() * 90;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    const shade = 95 + Math.floor(rand() * 60);
    g.addColorStop(0, `rgba(${shade},${shade},${shade + 4},0.55)`);
    g.addColorStop(1, `rgba(${shade},${shade},${shade + 4},0)`);
    ctx.save();
    ctx.translate(rand() * width, rand() * height);
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, 2 * r, 2 * r);
    ctx.restore();
  }
  // craters: dark floor + bright rim
  for (let i = 0; i < 420; i++) {
    const r = 2 + rand() * rand() * 22;
    const x = rand() * width;
    const y = rand() * height;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(60,60,64,${0.25 + rand() * 0.3})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - r * 0.15, y - r * 0.15, r * 0.95, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(215,215,220,${0.25 + rand() * 0.35})`;
    ctx.lineWidth = Math.max(1, r * 0.18);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ============================================================================================================
// shaders
// ============================================================================================================
/**
 * Ocean shell: every vertex of the unit sphere is pushed out by the exaggerated
 * equilibrium tide h = Aₘ·P₂(n·m̂) + Aₛ·P₂(n·ŝ). The normal is corrected with the
 * tangential gradient of h so lighting follows the bulge.
 */
const OCEAN_VERTEX = /* glsl */ `
  uniform vec3 uMoonDir;
  uniform vec3 uSunDir;
  uniform float uAmpMoon;
  uniform float uAmpSun;
  uniform float uBase;
  varying float vDisp;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  float p2(float c) { return (3.0 * c * c - 1.0) * 0.5; }
  void main() {
    vec3 n = normalize(position);
    float cm = dot(n, uMoonDir);
    float cs = dot(n, uSunDir);
    float d = uAmpMoon * p2(cm) + uAmpSun * p2(cs);
    vDisp = d;
    float r = uBase + d;
    // tangential gradient of d: ∇ₛ P₂(n·b) = 3 (n·b) (b − (n·b) n)
    vec3 grad = uAmpMoon * 3.0 * cm * (uMoonDir - cm * n) + uAmpSun * 3.0 * cs * (uSunDir - cs * n);
    vec3 nn = normalize(n - grad / r);
    vNormalW = normalize(mat3(modelMatrix) * nn);
    vec4 wp = modelMatrix * vec4(n * r, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const OCEAN_FRAGMENT = /* glsl */ `
  uniform vec3 uLightDir;
  uniform float uAmpMoon;
  uniform float uAmpSun;
  varying float vDisp;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float ndl = dot(N, uLightDir);
    float day = smoothstep(-0.08, 0.2, ndl);
    float ref = max(uAmpMoon + uAmpSun, 1e-6);
    float rel = clamp(vDisp / ref, -0.5, 1.0); // −0.5 in the troughs … 1 on the bulge crest
    vec3 low = vec3(0.04, 0.22, 0.55);
    vec3 high = vec3(0.35, 0.85, 1.0);
    vec3 base = mix(low, high, clamp((rel + 0.5) / 1.5, 0.0, 1.0));
    vec3 H = normalize(uLightDir + V);
    float spec = pow(max(dot(N, H), 0.0), 60.0) * 0.45;
    vec3 color = base * (0.18 + 0.9 * max(ndl, 0.0)) + spec * day;
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);
    color += vec3(0.3, 0.6, 1.0) * fres * 0.3;
    float alpha = 0.5 + 0.4 * fres;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
