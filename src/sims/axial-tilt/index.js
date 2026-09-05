/**
 * Simulation: Axial tilt, seasons & day length ("axial-tilt").
 *
 * Earth orbits an emissive Sun. The axial tilt (0–90°) and rotation period
 * (6–300 h) are adjustable; Earth can be dragged along its orbit or animated
 * through the year. A shader lights the textured Earth with a soft day/night
 * terminator and city lights on the night side, and can overlay either a heat
 * map of the daily mean insolation or temperature bands of the seasonal-mean
 * energy-balance temperature per latitude, plus a livable-region view that
 * darkens the latitudes that are not livable all year. Tropics, polar circles,
 * the subsolar point, a readout (day length, insolation, temperature estimate,
 * seasonal extremes, climate zone) for a selectable latitude and the year-round
 * livable share of the surface with a verdict all update live. Clicking Earth
 * pins a place: the camera follows it and the readout switches to its latitude.
 * All physics lives in ./physics.js, the habitability estimates in ./climate.js.
 *
 * Scene: Sun at the origin, ecliptic plane y = 0, Earth orbits counter-clockwise
 * seen from +y. The rotation axis leans towards −x, so the June solstice is at
 * orbit angle 0° (Earth on +x), the December solstice at 180° (Earth on −x).
 * The "Earth" camera travels along and keeps the Sun fixed on screen – the
 * planet-centric view in which the Sun appears to circle Earth once per year.
 */
import * as THREE from 'three';
import { createScene } from '../../lib/scene.js';
import { createPanel, createPanelShift, createCollapsibleSection, createControlRow, createSlider, createStateToggle, createButton, createInfoCard, createNotice, el } from '../../lib/ui.js';
import { createViewPrefs } from '../../lib/prefs.js';
import { t, bindText, bindAttr, onLanguageChange, formatNumber, getLocale } from '../../lib/i18n.js';
import * as S from './physics.js';
import * as C from './climate.js';

const KEYS = 'sims.axialTilt';
const ORBIT_RADIUS = 9; // scene units (not to scale)
const EARTH_RADIUS = 1;
const SUN_RADIUS = 1.5;
const AXIS_HALF_LENGTH = 1.75;
const LINE_RADIUS = EARTH_RADIUS * 1.008; // latitude circles sit just above the surface
const SPIN_REV_PER_SECOND_AT_24H = 0.15; // visual spin (a 24 h day takes ≈ 6.7 s), scaled by 24 h / P
const HEAT_SCALE_W_M2 = 550; // heat-map colour ramp saturates at this daily mean insolation
const HIT_LAYER = 1;
const TEXTURE_BASE = `${import.meta.env.BASE_URL}textures/`;
const SPEED_RANGE = Object.freeze({ min: 1, max: 60 }); // days per second
const CLIMATE_ROWS = 128; // latitude rows of the temperature-band texture
const MAX_LIVABLE_BANDS = 4; // shader uniform slots; the model never produces more than 2 bands
const BORDER_RING_POOL = 2 * MAX_LIVABLE_BANDS; // one ring per band edge
const CLICK_THRESHOLD_PX = 6; // pointer travel below which a press counts as a click (pin) rather than a drag
const PIN_DISTANCE = Object.freeze({ min: 2.2, max: 6 }); // camera distance from Earth's centre when flying to a pin
const PIN_SPIN_MAX_RAD_S = 30 * (Math.PI / 180); // visual spin cap while the camera rides on a pinned place
const UP = new THREE.Vector3(0, 1, 0);
const PIN_LEAN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.85); // ≈49° off the vertical, so the needle stays visible from above
const VERDICT_STATE = Object.freeze({ uniform: 'frozen', moderate: 'habitable', severe: 'scorched', extreme: 'scorched' });
const VERDICT_ZONE = Object.freeze({ uniform: 'is-outer', moderate: 'is-habitable', severe: 'is-inner', extreme: 'is-inner' });
const COLORS = Object.freeze({
  equator: 0x7cc4ff,
  tropics: 0xffd166,
  polar: 0x9fe8ff,
  terminator: 0xff8a80,
  selected: 0xff6ad5,
  axis: 0xf0f4ff,
  orbit: 0x7cc4ff,
  grid: 0xa7b4cc,
  subsolar: 0xfff1b0,
  season: 0xc7d3ea,
  livable: 0x5adc8c,
  pinHead: 0xe23a2e,
  pinNeedle: 0xcfd4dc,
});

const DEFAULTS = Object.freeze({
  tiltDeg: S.EARTH_TILT_DEG,
  periodH: S.EARTH_ROTATION_H,
  dayOfYear: 171.5, // June solstice
  playing: true,
  daysPerSecond: 10,
  latitudeDeg: 0,
});

/** Display toggles – remembered per visitor, see ../../lib/prefs.js. Only the axis and the pole
 *  labels to begin with: Earth arrives bare, and every overlay is one tap away in the panel. */
const VIEW_DEFAULTS = Object.freeze({
  showHeat: false, // insolation heat map – exclusive with showClimate
  showClimate: false, // seasonal-mean temperature bands
  showLivable: false, // livable-region view (darkened hostile bands + border rings)
  showTerminator: false,
  showEquator: false,
  showCircles: false, // tropics + polar circles
  showAxis: true,
  showSubsolar: false,
  showGrid: false,
  showLabels: true,
});

const { clamp } = S;
const DEG = Math.PI / 180;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const fmt = (v, digits, min = 0) => formatNumber(v, { maximumFractionDigits: digits, minimumFractionDigits: min });
const rotateY = (v, angle) => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return v.set(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
};

export default function mount(container, meta) {
  const viewPrefs = createViewPrefs(meta.id, VIEW_DEFAULTS);
  const state = { ...DEFAULTS, ...viewPrefs.values, activePreset: 'earth', cameraMode: 'earth' }; // cameraMode: earth | overview | top | pin
  if (state.showHeat && state.showClimate) state.showClimate = false; // the two colour overlays are exclusive (hand-edited storage)
  const disposers = [];

  const viewport = el('div', 'lp-sim__viewport');
  container.append(viewport);

  const sim = createScene({
    container: viewport,
    cameraPosition: [0, 16, 20],
    near: 0.05,
    far: 3000,
    stars: { count: 3000, radius: 1200 },
    controls: { minDistance: 1.8, maxDistance: 90 },
  });
  const { scene, camera, renderer, controls } = sim;
  camera.lookAt(0, 0, 0);
  const labelFont = getComputedStyle(document.documentElement).getPropertyValue('--lp-font') || 'sans-serif';
  const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // --- textures ------------------------------------------------------------------------------
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
      () => console.warn(`[axial-tilt] texture not available: ${file} – using flat colour`),
    );
  }

  // --- Sun -----------------------------------------------------------------------------------------
  const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xffe0a0, toneMapped: false });
  const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(SUN_RADIUS, 48, 32), sunMaterial);
  sunMesh.name = 'sun';
  scene.add(sunMesh);
  loadTexture('2k_sun.jpg', (tex) => {
    sunMaterial.map = tex;
    sunMaterial.color.set(0xffffff);
    sunMaterial.needsUpdate = true;
  });
  const glowTexture = createGlowTexture();
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xffc46a, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  sunGlow.scale.setScalar(SUN_RADIUS * 6);
  const sunCorona = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xffd9a0, transparent: true, opacity: 0.5, depthWrite: false, depthTest: false, sizeAttenuation: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  sunCorona.scale.set(0.1, 0.1, 1);
  sunCorona.renderOrder = 5;
  scene.add(sunGlow, sunCorona);

  // --- ecliptic plane grid + orbit ------------------------------------------------------------------------
  const gridGroup = new THREE.Group();
  const gridFine = new THREE.LineBasicMaterial({ color: COLORS.grid, transparent: true, opacity: 0.12, depthWrite: false });
  const gridMedium = new THREE.LineBasicMaterial({ color: COLORS.grid, transparent: true, opacity: 0.22, depthWrite: false });
  for (const r of [3, 6, 12]) gridGroup.add(new THREE.LineLoop(circleGeometry(r, 160), r === 12 ? gridMedium : gridFine));
  const spokes = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    spokes.push(new THREE.Vector3(2 * Math.cos(a), 0, 2 * Math.sin(a)), new THREE.Vector3(12 * Math.cos(a), 0, 12 * Math.sin(a)));
  }
  gridGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(spokes), gridFine));
  const planeFill = new THREE.Mesh(new THREE.CircleGeometry(12, 96), new THREE.MeshBasicMaterial({ color: 0x3a5a9a, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false }));
  planeFill.rotation.x = -Math.PI / 2;
  planeFill.renderOrder = -3;
  gridGroup.add(planeFill);
  scene.add(gridGroup);

  const orbitLine = new THREE.LineLoop(circleGeometry(ORBIT_RADIUS, 256), new THREE.LineBasicMaterial({ color: COLORS.orbit, transparent: true, opacity: 0.85, depthWrite: false }));
  orbitLine.renderOrder = 1;
  scene.add(orbitLine);

  // season stop markers + labels
  const stopGroup = new THREE.Group();
  const stopMaterial = new THREE.MeshBasicMaterial({ color: COLORS.season, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
  const stopLabels = [];
  for (const stop of S.SEASON_STOPS) {
    const marker = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.24, 32), stopMaterial);
    marker.rotation.x = -Math.PI / 2;
    const a = stop.angleDeg * DEG;
    marker.position.set(ORBIT_RADIUS * Math.cos(a), 0, -ORBIT_RADIUS * Math.sin(a));
    stopGroup.add(marker);
    const label = createLabel(COLORS.season, labelFont, 0.85);
    stopLabels.push({ stop, label, anchor: marker.position.clone() });
    stopGroup.add(label.sprite);
  }
  scene.add(stopGroup);

  // --- Earth ------------------------------------------------------------------------------------------------------
  const earthPivot = new THREE.Group(); // translated to the orbit position
  const tiltGroup = new THREE.Group(); // rotation.z = tilt (axis leans towards −x)
  const spinGroup = new THREE.Group(); // rotation.y = spin
  earthPivot.add(tiltGroup);
  tiltGroup.add(spinGroup);
  scene.add(earthPivot);

  const placeholder = new THREE.DataTexture(new Uint8Array([28, 70, 150, 255]), 1, 1);
  placeholder.colorSpace = THREE.SRGBColorSpace;
  placeholder.needsUpdate = true;
  const nightPlaceholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); // no city lights until the map arrives
  nightPlaceholder.needsUpdate = true;
  // temperature bands: one texel row per latitude (row 0 = south pole), coloured on the −40 … +60 °C ramp
  const climateData = new Uint8Array(CLIMATE_ROWS * 4);
  const climateTexture = new THREE.DataTexture(climateData, 1, CLIMATE_ROWS, THREE.RGBAFormat);
  climateTexture.colorSpace = THREE.SRGBColorSpace;
  climateTexture.minFilter = climateTexture.magFilter = THREE.LinearFilter;
  climateTexture.needsUpdate = true;
  const earthMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: placeholder },
      uNightMap: { value: nightPlaceholder },
      uSunPos: { value: new THREE.Vector3() },
      uDecl: { value: 0 },
      uHeatMix: { value: 0 },
      uHeatScale: { value: HEAT_SCALE_W_M2 / S.SOLAR_CONSTANT_W_M2 },
      uClimateTex: { value: climateTexture },
      uClimateMix: { value: 0 },
      uLivableMix: { value: 0 },
      uBands: { value: Array.from({ length: MAX_LIVABLE_BANDS }, () => new THREE.Vector2()) }, // livable [lo, hi] latitude, radians
      uBandCount: { value: 0 },
    },
    vertexShader: EARTH_VERTEX,
    fragmentShader: EARTH_FRAGMENT,
  });
  const earthMesh = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS, 96, 64), earthMaterial);
  earthMesh.name = 'earth';
  spinGroup.add(earthMesh);
  loadTexture('2k_earth_daymap.jpg', (tex) => {
    earthMaterial.uniforms.uMap.value = tex;
  });
  // city lights (NASA Black Marble data via Solar System Scope), shown on the night side only
  loadTexture('2k_earth_nightmap.jpg', (tex) => {
    earthMaterial.uniforms.uNightMap.value = tex;
  });
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS * 1.06, 48, 32),
    new THREE.ShaderMaterial({
      uniforms: { uSunPos: earthMaterial.uniforms.uSunPos },
      vertexShader: ATMOSPHERE_VERTEX,
      fragmentShader: ATMOSPHERE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  earthPivot.add(atmosphere);

  // axis (does not spin)
  const axisLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -AXIS_HALF_LENGTH, 0), new THREE.Vector3(0, AXIS_HALF_LENGTH, 0)]),
    new THREE.LineBasicMaterial({ color: COLORS.axis, transparent: true, opacity: 0.9 }),
  );
  tiltGroup.add(axisLine);
  const poleLabels = { north: createLabel(COLORS.axis, labelFont, 0.9), south: createLabel(COLORS.axis, labelFont, 0.9) };
  poleLabels.north.sprite.position.set(0, AXIS_HALF_LENGTH + 0.22, 0);
  poleLabels.south.sprite.position.set(0, -AXIS_HALF_LENGTH - 0.22, 0);
  tiltGroup.add(poleLabels.north.sprite, poleLabels.south.sprite);

  // latitude circles (unit circle in the xz plane; scaled/positioned per latitude)
  const unitCircle = circleGeometry(1, 192);
  const latitudeMaterials = {
    equator: new THREE.LineBasicMaterial({ color: COLORS.equator, transparent: true, opacity: 0.95 }),
    tropics: new THREE.LineBasicMaterial({ color: COLORS.tropics, transparent: true, opacity: 0.95 }),
    polar: new THREE.LineBasicMaterial({ color: COLORS.polar, transparent: true, opacity: 0.95 }),
    selected: new THREE.LineBasicMaterial({ color: COLORS.selected, transparent: true, opacity: 1 }),
    livable: new THREE.LineBasicMaterial({ color: COLORS.livable, transparent: true, opacity: 0.95 }),
  };
  const makeLatitudeLine = (material) => {
    const line = new THREE.LineLoop(unitCircle, material);
    line.renderOrder = 2;
    tiltGroup.add(line);
    return line;
  };
  const equatorLine = makeLatitudeLine(latitudeMaterials.equator);
  const tropicLines = [makeLatitudeLine(latitudeMaterials.tropics), makeLatitudeLine(latitudeMaterials.tropics)];
  const polarLines = [makeLatitudeLine(latitudeMaterials.polar), makeLatitudeLine(latitudeMaterials.polar)];
  const selectedLine = makeLatitudeLine(latitudeMaterials.selected);
  // borders of the livable latitude bands (pool; a band edge may coincide with a tropic, hence the slightly larger radius)
  const livableLines = Array.from({ length: BORDER_RING_POOL }, () => makeLatitudeLine(latitudeMaterials.livable));
  livableLines.forEach((line) => (line.visible = false));
  function placeLatitudeLine(line, latitudeDeg, radius = LINE_RADIUS) {
    const c = Math.max(1e-3, Math.cos(latitudeDeg * DEG)) * radius;
    line.scale.set(c, 1, c);
    line.position.y = Math.sin(latitudeDeg * DEG) * radius;
  }
  placeLatitudeLine(equatorLine, 0);

  // pin marker: a small map pin (needle + ball head), leaning slightly, its tip anchored at the pinned
  // surface point – in spinGroup so it rotates with Earth. Unlit materials: the scene has no lights.
  const pinMarker = new THREE.Group();
  const pinNeedle = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.075, 10), new THREE.MeshBasicMaterial({ color: COLORS.pinNeedle }));
  pinNeedle.position.y = 0.0375; // tip at the group origin
  const pinHead = new THREE.Mesh(new THREE.SphereGeometry(0.018, 20, 14), new THREE.MeshBasicMaterial({ color: COLORS.pinHead }));
  pinHead.position.y = 0.082; // resting on the needle top
  pinMarker.add(pinNeedle, pinHead);
  pinMarker.visible = false;
  spinGroup.add(pinMarker);

  // terminator ring (world space, perpendicular to the Sun direction)
  const terminatorLine = new THREE.LineLoop(circleGeometryXY(EARTH_RADIUS * 1.012, 192), new THREE.LineBasicMaterial({ color: COLORS.terminator, transparent: true, opacity: 0.95 }));
  terminatorLine.renderOrder = 3;
  scene.add(terminatorLine);

  // subsolar point marker + sun ray
  const subsolarMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: COLORS.subsolar, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, sizeAttenuation: false, toneMapped: false }));
  subsolarMarker.scale.set(0.045, 0.045, 1);
  subsolarMarker.renderOrder = 8;
  const subsolarLabel = createLabel(COLORS.subsolar, labelFont, 0.85);
  const sunRay = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: COLORS.subsolar, transparent: true, opacity: 0.5, depthWrite: false }),
  );
  sunRay.frustumCulled = false;
  scene.add(subsolarMarker, subsolarLabel.sprite, sunRay);

  // hit sphere for dragging Earth along its orbit
  const earthHit = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial());
  earthHit.layers.set(HIT_LAYER);
  scene.add(earthHit);
  const dragMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: createRingTexture(), color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, depthTest: false, sizeAttenuation: false }));
  dragMarker.renderOrder = 9;
  scene.add(dragMarker);

  // --- derived model -------------------------------------------------------------------------------------------------
  const sunDir = new THREE.Vector3(); // Earth → Sun (unit)
  const earthPos = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const tmpUp = new THREE.Vector3();
  const Z_AXIS = new THREE.Vector3(0, 0, 1);
  let model = null;
  let annualCache = { key: '', insolation: 0, polar: null, extremes: null, livable: false };

  function derive() {
    const orbitAngleDeg = S.orbitAngleFromDay(state.dayOfYear);
    const orbitAngleRad = orbitAngleDeg * DEG;
    const declDeg = S.declinationDeg(state.tiltDeg, orbitAngleDeg);
    const cacheKey = `${state.latitudeDeg}|${state.tiltDeg}`;
    if (annualCache.key !== cacheKey) {
      const insolation = S.annualMeanInsolation(state.latitudeDeg, state.tiltDeg);
      const extremes = C.seasonalExtremes(state.latitudeDeg, state.tiltDeg, insolation);
      annualCache = { key: cacheKey, insolation, polar: S.polarDays(state.latitudeDeg, state.tiltDeg), extremes, livable: C.isLivable(extremes) };
    }
    const fraction = S.dayFraction(state.latitudeDeg, declDeg);
    return {
      orbitAngleDeg,
      orbitAngleRad,
      declDeg,
      fraction,
      dayLengthH: fraction * state.periodH,
      temps: S.temperatureEstimate(state.latitudeDeg, state.tiltDeg, declDeg, state.periodH, annualCache.insolation),
      polar: annualCache.polar,
      extremes: annualCache.extremes,
      livable: annualCache.livable,
      zone: S.climateZone(state.latitudeDeg, state.tiltDeg),
      season: S.seasonAt(orbitAngleDeg),
    };
  }

  // --- habitability (tilt-dependent) -----------------------------------------------------------------------------------
  // livable latitude bands, their exact area fraction and the verdict tier; feeds the shader mask, the border rings and the readout
  let habitability = { tilt: NaN, bands: [], fraction: 0, verdict: 'moderate', rings: 0 };
  function ensureHabitability() {
    if (habitability.tilt === state.tiltDeg) return habitability;
    const bands = C.livableBands(state.tiltDeg);
    habitability = { tilt: state.tiltDeg, bands, fraction: C.bandsFraction(bands), verdict: C.verdictFor(state.tiltDeg), rings: 0 };
    const { uBands, uBandCount } = earthMaterial.uniforms;
    uBandCount.value = Math.min(bands.length, MAX_LIVABLE_BANDS);
    bands.slice(0, MAX_LIVABLE_BANDS).forEach(([lo, hi], i) => uBands.value[i].set(lo * DEG, hi * DEG));
    for (const [lo, hi] of bands) {
      for (const lat of [lo, hi]) {
        if (Math.abs(lat) >= 89.9 || habitability.rings >= livableLines.length) continue; // the poles are not a border
        placeLatitudeLine(livableLines[habitability.rings++], lat, LINE_RADIUS * 1.003);
      }
    }
    return habitability;
  }

  // temperature bands: annual-mean insolation per row depends only on the tilt – cache it; the rest on the declination
  const climateAnnual = { tilt: NaN, values: new Float64Array(CLIMATE_ROWS) };
  const rowLatitude = (row) => -90 + ((row + 0.5) / CLIMATE_ROWS) * 180; // row 0 = south pole (texture v = 0)
  let climateKey = '';
  function updateClimateTexture(declDeg) {
    if (!state.showClimate) return;
    const key = `${state.tiltDeg}|${state.periodH}|${declDeg.toFixed(2)}`;
    if (key === climateKey) return;
    climateKey = key;
    if (climateAnnual.tilt !== state.tiltDeg) {
      climateAnnual.tilt = state.tiltDeg;
      for (let row = 0; row < CLIMATE_ROWS; row++) climateAnnual.values[row] = S.annualMeanInsolation(rowLatitude(row), state.tiltDeg, 90);
    }
    for (let row = 0; row < CLIMATE_ROWS; row++) {
      const { meanC } = S.temperatureEstimate(rowLatitude(row), state.tiltDeg, declDeg, state.periodH, climateAnnual.values[row]);
      const [r, g, b] = C.temperatureColor(meanC);
      climateData.set([r, g, b, 255], row * 4);
    }
    climateTexture.needsUpdate = true;
  }

  /** Push the model into the scene graph (camera-independent). */
  function updateScene() {
    const { orbitAngleRad, declDeg } = model;
    earthPos.set(ORBIT_RADIUS * Math.cos(orbitAngleRad), 0, -ORBIT_RADIUS * Math.sin(orbitAngleRad));
    earthPivot.position.copy(earthPos);
    sunDir.copy(earthPos).negate().normalize();
    tiltGroup.rotation.z = state.tiltDeg * DEG;
    earthMaterial.uniforms.uSunPos.value.set(0, 0, 0);
    earthMaterial.uniforms.uDecl.value = declDeg * DEG;
    earthMaterial.uniforms.uHeatMix.value = state.showHeat ? 1 : 0;
    earthMaterial.uniforms.uClimateMix.value = state.showClimate ? 1 : 0;
    earthMaterial.uniforms.uLivableMix.value = state.showLivable ? 1 : 0;
    updateClimateTexture(declDeg);
    const { rings } = ensureHabitability();
    livableLines.forEach((line, i) => (line.visible = state.showLivable && i < rings));
    pinMarker.visible = !!pin;

    placeLatitudeLine(tropicLines[0], state.tiltDeg);
    placeLatitudeLine(tropicLines[1], -state.tiltDeg);
    placeLatitudeLine(polarLines[0], 90 - state.tiltDeg);
    placeLatitudeLine(polarLines[1], -(90 - state.tiltDeg));
    placeLatitudeLine(selectedLine, state.latitudeDeg);
    const circlesVisible = state.showCircles && state.tiltDeg > 0.05;
    tropicLines.forEach((l) => (l.visible = circlesVisible));
    polarLines.forEach((l) => (l.visible = circlesVisible));
    equatorLine.visible = state.showEquator;
    axisLine.visible = state.showAxis;
    poleLabels.north.sprite.visible = poleLabels.south.sprite.visible = state.showAxis && state.showLabels;

    terminatorLine.visible = state.showTerminator;
    terminatorLine.position.copy(earthPos);
    terminatorLine.quaternion.setFromUnitVectors(Z_AXIS, sunDir);

    subsolarMarker.visible = state.showSubsolar;
    sunRay.visible = state.showSubsolar;
    subsolarLabel.sprite.visible = state.showSubsolar && state.showLabels;
    tmpV.copy(earthPos).addScaledVector(sunDir, EARTH_RADIUS * 1.01);
    subsolarMarker.position.copy(tmpV);
    const rayPos = sunRay.geometry.attributes.position;
    rayPos.setXYZ(0, -sunDir.x * SUN_RADIUS * 1.02, -sunDir.y * SUN_RADIUS * 1.02, -sunDir.z * SUN_RADIUS * 1.02);
    rayPos.setXYZ(1, tmpV.x, tmpV.y, tmpV.z);
    rayPos.needsUpdate = true;

    gridGroup.visible = state.showGrid;
    stopGroup.visible = state.showGrid;
    stopLabels.forEach(({ stop, label }) => label.setText(t(`${KEYS}.stopLabels.${stop.id}`)));
    poleLabels.north.setText(t(`${KEYS}.labels.north`));
    poleLabels.south.setText(t(`${KEYS}.labels.south`));
    subsolarLabel.setText(`${t(`${KEYS}.labels.subsolar`)} · ${formatLatitude(declDeg, 1)}`);
  }

  /** Camera-dependent bits: hit sphere, drag marker, label offsets, near plane. */
  function updateOverlay() {
    tmpUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const earthDist = Math.max(camera.position.distanceTo(earthPos), 1e-6);
    earthHit.position.copy(earthPos);
    earthHit.scale.setScalar(Math.max(EARTH_RADIUS * 1.3, earthDist * 0.02));
    dragMarker.position.copy(earthPos);
    dragMarker.scale.setScalar(clamp((EARTH_RADIUS * 2.6) / earthDist, 0.04, 0.5));
    dragMarker.visible = dragging; // hovering only changes the cursor – no ring around Earth
    subsolarLabel.sprite.position.copy(subsolarMarker.position).addScaledVector(tmpUp, -earthDist * 0.028);
    for (const { label, anchor } of stopLabels) {
      // offset along screen-up so the text never sits on its marker, whatever the camera angle
      label.sprite.position.copy(anchor).addScaledVector(tmpUp, camera.position.distanceTo(anchor) * 0.03);
      label.sprite.visible = state.showLabels && anchor.distanceTo(earthPos) > 2.4;
    }
    const targetDist = camera.position.distanceTo(controls.target);
    const near = clamp(targetDist * 0.01, 0.02, 1);
    if (Math.abs(camera.near - near) / near > 0.2) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
  }

  function refresh() {
    model = derive();
    updateScene();
    syncCamera();
    updateOverlay();
    updateReadouts();
    sim.requestRender();
  }

  // --- camera: follow Earth in its co-rotating frame ---------------------------------------------------------------------
  let following = true;
  let lastFollowAngle = null;
  let cameraTween = null;
  const followOffset = new THREE.Vector3();

  /** Per-frame camera update: ride on the pinned place, or follow Earth in its co-rotating frame. */
  function syncCamera() {
    if (state.cameraMode === 'pin' && pin) {
      if (!dragging && !cameraTween) syncPinnedCamera();
      return;
    }
    applyFollow();
  }

  /** Rotate camera + target with Earth so the Sun keeps its place on screen. */
  function applyFollow() {
    if (!following) {
      lastFollowAngle = model.orbitAngleRad;
      return;
    }
    if (dragging || cameraTween) {
      // keep the camera still; the catch-up happens when the drag/tween ends
      if (cameraTween) lastFollowAngle = model.orbitAngleRad;
      return;
    }
    if (lastFollowAngle === null) lastFollowAngle = model.orbitAngleRad;
    const delta = model.orbitAngleRad - lastFollowAngle;
    followOffset.copy(camera.position).sub(controls.target);
    rotateY(followOffset, delta);
    controls.target.copy(earthPos);
    camera.position.copy(earthPos).add(followOffset);
    lastFollowAngle = model.orbitAngleRad;
  }

  /**
   * `follow`: destination moves with Earth's co-rotating frame (Earth camera).
   * `track(toPos, toTarget)`: recomputes the destination every step (pinned place).
   */
  function tweenCamera(toPosition, toTarget, { duration = 0.9, follow = false, track = null } = {}) {
    following = follow;
    const offset = follow ? toPosition.clone().sub(toTarget) : null;
    const angle0 = model.orbitAngleRad;
    if (sim.reducedMotion || duration <= 0) {
      camera.position.copy(toPosition);
      controls.target.copy(toTarget);
      cameraTween = null;
      lastFollowAngle = angle0;
      controls.update();
      updateOverlay();
      sim.requestRender();
      return;
    }
    cameraTween = { t: 0, duration, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: toPosition.clone(), toTarget: toTarget.clone(), offset, track, angle0 };
  }
  function stepTween(dt) {
    if (!cameraTween) return;
    const tw = cameraTween;
    tw.t = Math.min(1, tw.t + dt / tw.duration);
    if (tw.track) {
      tw.track(tw.toPos, tw.toTarget);
    } else if (tw.offset) {
      // destination moves with Earth (translation + rotation of the co-moving frame)
      tw.toTarget.copy(earthPos);
      tw.toPos.copy(tw.offset);
      rotateY(tw.toPos, model.orbitAngleRad - tw.angle0).add(earthPos);
    }
    const k = easeInOut(tw.t);
    camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
    controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
    if (tw.t >= 1) {
      cameraTween = null;
      lastFollowAngle = model.orbitAngleRad;
    }
  }
  /** Position beside Earth in its local frame: radial (away from the Sun), up, tangential (direction of motion). */
  function earthViewPosition(radial, up, tangential) {
    const r = earthPos.clone().normalize();
    const tangent = new THREE.Vector3(-Math.sin(model.orbitAngleRad), 0, -Math.cos(model.orbitAngleRad)); // direction of motion (CCW orbit)
    return earthPos.clone().addScaledVector(r, radial).addScaledVector(tangent, tangential).add(new THREE.Vector3(0, up, 0));
  }
  const cameraPresets = {
    earth(duration) {
      leavePinCamera('earth');
      tweenCamera(earthViewPosition(-1.4, 2.3, -5.6), earthPos.clone(), { duration, follow: true });
    },
    overview(duration) {
      leavePinCamera('overview');
      tweenCamera(new THREE.Vector3(0, 15, 21), new THREE.Vector3(0, 0, 0), { duration, follow: false });
    },
    top(duration) {
      leavePinCamera('top');
      tweenCamera(new THREE.Vector3(0, 30, 0.01), new THREE.Vector3(0, 0, 0), { duration, follow: false });
    },
    /** Fly above the pinned place and stay there (zoom is kept, orbiting the camera is disabled). */
    pin(duration = 0.6) {
      if (!pin) return;
      if (state.cameraMode !== 'pin') pinReturnMode = state.cameraMode;
      state.cameraMode = 'pin';
      controls.enableRotate = false;
      const distance = clamp(camera.position.distanceTo(earthPos), PIN_DISTANCE.min, PIN_DISTANCE.max);
      const track = (toPos, toTarget) => {
        pinCameraPosition(toPos, distance);
        toTarget.copy(earthPos);
      };
      tweenCamera(pinCameraPosition(new THREE.Vector3(), distance), earthPos.clone(), { duration, follow: false, track });
    },
  };
  function leavePinCamera(mode) {
    state.cameraMode = mode;
    pinReturnMode = mode;
    controls.enableRotate = true;
  }

  // --- pinned place ------------------------------------------------------------------------------------------------------
  // pin = { dirLocal: unit vector in spinGroup space, lonRad }; its latitude is state.latitudeDeg, so every
  // per-latitude readout describes the pinned place. Set by clicking Earth, moved along its meridian by the
  // latitude slider, released by Unpin / a click on the sky / Reset.
  let pin = null;
  let pinReturnMode = 'earth'; // camera mode to go back to when the pin is released
  const pinQuat = new THREE.Quaternion();
  const pinDirWorld = new THREE.Vector3();

  /** World-space camera position `distance` above the pinned place; avoids the lookAt singularity over a pole. */
  function pinCameraPosition(out, distance) {
    spinGroup.updateWorldMatrix(true, false); // tilt / orbit / spin were just changed this frame
    spinGroup.getWorldQuaternion(pinQuat);
    pinDirWorld.copy(pin.dirLocal).applyQuaternion(pinQuat);
    const y = clamp(pinDirWorld.y, -0.995, 0.995);
    const radial = Math.sqrt(1 - y * y);
    const xz = Math.hypot(pinDirWorld.x, pinDirWorld.z);
    if (xz < 1e-4) pinDirWorld.set(radial, y, 0);
    else pinDirWorld.set((pinDirWorld.x / xz) * radial, y, (pinDirWorld.z / xz) * radial);
    return out.copy(earthPos).addScaledVector(pinDirWorld, distance);
  }
  /** Keeps the camera above the pinned place; the distance is read first so wheel/pinch zoom survives. */
  function syncPinnedCamera() {
    // Measure against the point the camera currently orbits (`controls.target`, Earth's position from the
    // previous frame), not the freshly advanced `earthPos`: the camera still sits on the old sphere, so
    // measuring against the moved Earth adds Earth's per-frame travel to the radius. That error changes
    // sign as the pin rotates, which made the view breathe in and out while a place was pinned.
    const distance = camera.position.distanceTo(controls.target);
    pinCameraPosition(camera.position, distance);
    controls.target.copy(earthPos);
    camera.lookAt(earthPos);
  }
  function placePinMarker() {
    pinMarker.position.copy(pin.dirLocal).multiplyScalar(EARTH_RADIUS); // tip on the surface
    pinMarker.quaternion.setFromUnitVectors(UP, pin.dirLocal).multiply(PIN_LEAN);
    pinMarker.visible = true;
  }
  function setPin(worldPoint) {
    const dirLocal = spinGroup.worldToLocal(worldPoint.clone()).normalize(); // matrixWorld = the frame the user clicked on
    pin = { dirLocal, lonRad: Math.atan2(dirLocal.z, dirLocal.x) };
    placePinMarker();
    setLatitude(Math.round((Math.asin(clamp(dirLocal.y, -1, 1)) / DEG) * 10) / 10); // readout + selected circle follow the pin
    cameraPresets.pin();
    syncCameraButtons();
  }
  /** Slides the pin along its meridian to the selected latitude (slider, latitude presets). */
  function movePinToLatitude(latitudeDeg) {
    const phi = latitudeDeg * DEG;
    pin.dirLocal.set(Math.cos(phi) * Math.cos(pin.lonRad), Math.sin(phi), Math.cos(phi) * Math.sin(pin.lonRad));
    placePinMarker();
  }
  function unpin({ restoreCamera = true } = {}) {
    if (!pin) return;
    pin = null;
    pinMarker.visible = false;
    controls.enableRotate = true;
    if (restoreCamera && state.cameraMode === 'pin') cameraPresets[pinReturnMode]();
    syncCameraButtons();
    updateReadouts(true);
    sim.requestRender();
  }

  // --- interaction: drag Earth along its orbit, click Earth to pin a place --------------------------------------------------
  const raycaster = new THREE.Raycaster();
  raycaster.layers.set(HIT_LAYER);
  const surfaceRaycaster = new THREE.Raycaster(); // default layer: the visible Earth surface
  const pointer = new THREE.Vector2();
  const eclipticPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let pressing = false; // pointer down on Earth, not (yet) moved past the click threshold
  let dragging = false;
  let hovering = false;
  const pressStart = { x: 0, y: 0 };
  const canvas = renderer.domElement;

  function setPointer(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }
  function pick(e) {
    setPointer(e);
    return raycaster.intersectObject(earthHit, false).length > 0;
  }
  /** Point on the visible Earth surface under the pointer, or null. */
  function pickSurface(e) {
    setPointer(e);
    surfaceRaycaster.setFromCamera(pointer, camera);
    return surfaceRaycaster.intersectObject(earthMesh, false)[0]?.point ?? null;
  }
  const pressTravelPx = (e) => Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y);
  function dragTo(e) {
    setPointer(e);
    if (!raycaster.ray.intersectPlane(eclipticPlane, tmpV)) return;
    if (tmpV.lengthSq() < 1e-6) return;
    const angleDeg = Math.atan2(-tmpV.z, tmpV.x) / DEG;
    setDayOfYear(S.dayFromOrbitAngle(angleDeg));
  }
  const onPointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pressStart.x = e.clientX;
    pressStart.y = e.clientY;
    if (!pick(e)) return; // the sky: OrbitControls takes over
    pressing = true;
    controls.enabled = false; // registered in the capture phase, so OrbitControls sees `enabled === false`
    canvas.setPointerCapture?.(e.pointerId);
    e.stopPropagation();
  };
  const onPointerMove = (e) => {
    if (pressing && !dragging && pressTravelPx(e) > CLICK_THRESHOLD_PX) {
      dragging = true;
      canvas.classList.add('is-dragging');
    }
    if (dragging) {
      dragTo(e);
      return;
    }
    const over = pick(e);
    if (over !== hovering) {
      hovering = over;
      canvas.classList.toggle('is-grab', over); // cursor only – nothing in the scene changes
    }
  };
  const endPress = (e) => {
    if (!pressing) {
      // a short click on the sky (no orbit rotation happened) releases the pin
      if (pin && e?.type === 'pointerup' && e.button === 0 && pressTravelPx(e) <= CLICK_THRESHOLD_PX) unpin();
      return;
    }
    const wasDragging = dragging;
    pressing = false;
    dragging = false;
    controls.enabled = true;
    canvas.classList.remove('is-dragging');
    if (e && canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (!wasDragging) {
      if (e?.type === 'pointerup') {
        const point = pickSurface(e);
        if (point) setPin(point);
        else if (pin) unpin(); // inside the enlarged hit sphere but past the surface
      }
    } else if (state.cameraMode === 'pin' && pin) {
      cameraPresets.pin(0.6); // catch up with the place that moved on during the drag
    } else if (following) {
      // catch up with Earth: same offset, rotated by the angle Earth moved during the drag
      followOffset.copy(camera.position).sub(controls.target);
      rotateY(followOffset, model.orbitAngleRad - (lastFollowAngle ?? model.orbitAngleRad));
      tweenCamera(earthPos.clone().add(followOffset), earthPos.clone(), { duration: 0.6, follow: true });
    }
    updateOverlay();
    sim.requestRender();
  };
  canvas.addEventListener('pointerdown', onPointerDown, { capture: true });
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endPress);
  canvas.addEventListener('pointercancel', endPress);
  canvas.addEventListener('lostpointercapture', endPress);
  disposers.push(() => {
    canvas.removeEventListener('pointerdown', onPointerDown, { capture: true });
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', endPress);
    canvas.removeEventListener('pointercancel', endPress);
    canvas.removeEventListener('lostpointercapture', endPress);
  });

  // --- animation -----------------------------------------------------------------------------------------------------------
  function frame(dt) {
    if (state.playing && !dragging) {
      const before = Math.floor(state.dayOfYear * 2);
      state.dayOfYear = S.normalizeDay(state.dayOfYear + dt * state.daysPerSecond);
      if (Math.floor(state.dayOfYear * 2) !== before) daySlider.setValue(state.dayOfYear, { silent: true });
    }
    let spinStep = 2 * Math.PI * SPIN_REV_PER_SECOND_AT_24H * (S.EARTH_ROTATION_H / state.periodH) * dt;
    if (state.cameraMode === 'pin' && pin) spinStep = Math.min(spinStep, PIN_SPIN_MAX_RAD_S * dt); // the camera rides along – keep it calm
    spinGroup.rotation.y = (spinGroup.rotation.y + spinStep) % (2 * Math.PI);
    model = derive();
    updateScene();
    syncCamera();
    stepTween(dt);
    updateOverlay();
    updateReadouts();
  }
  sim.onFrame(frame);
  const onControlsChange = () => {
    if (sim.reducedMotion || sim.paused) updateOverlay();
  };
  controls.addEventListener('change', onControlsChange);
  disposers.push(() => controls.removeEventListener('change', onControlsChange));

  // --- state setters ------------------------------------------------------------------------------------------------------------
  function setTilt(deg, { fromSlider = false } = {}) {
    state.tiltDeg = clamp(Math.round(deg * 10) / 10, S.TILT_RANGE_DEG.min, S.TILT_RANGE_DEG.max);
    if (!fromSlider) tiltSlider.setValue(state.tiltDeg, { silent: true });
    syncPresets();
    syncLatitudeButtons();
    refresh();
  }
  function setPeriod(hours, { fromSlider = false } = {}) {
    state.periodH = clamp(hours, S.ROTATION_RANGE_H.min, S.ROTATION_RANGE_H.max);
    if (!fromSlider) periodSlider.setValue(Math.log10(state.periodH), { silent: true });
    syncPresets();
    refresh();
  }
  function setDayOfYear(day, { fromSlider = false } = {}) {
    state.dayOfYear = S.normalizeDay(day);
    if (!fromSlider) daySlider.setValue(state.dayOfYear, { silent: true });
    refresh();
  }
  function setLatitude(deg, { fromSlider = false } = {}) {
    state.latitudeDeg = clamp(deg, -90, 90);
    if (!fromSlider) latitudeSlider.setValue(state.latitudeDeg, { silent: true });
    if (pin) movePinToLatitude(state.latitudeDeg);
    syncLatitudeButtons();
    refresh();
  }
  function setPlaying(v) {
    state.playing = v;
    syncPlayButton();
  }
  function applyPreset(preset) {
    state.activePreset = preset.id;
    if (preset.tiltDeg !== undefined) {
      state.tiltDeg = preset.tiltDeg;
      tiltSlider.setValue(state.tiltDeg, { silent: true });
    }
    if (preset.periodH !== undefined) {
      state.periodH = preset.periodH;
      periodSlider.setValue(Math.log10(state.periodH), { silent: true });
    }
    syncPresets();
    syncLatitudeButtons();
    refresh();
  }
  const presetMatches = (preset) =>
    (preset.tiltDeg === undefined || Math.abs(state.tiltDeg - preset.tiltDeg) < 0.05) && (preset.periodH === undefined || Math.abs(state.periodH - preset.periodH) < 0.05);

  // --- UI ----------------------------------------------------------------------------------------------------------------------
  // while the panel is open on a wide screen the picture slides left, so what the
  // simulation shows stays centred in the free part of the canvas
  const viewShift = createPanelShift({ sim, viewport });
  const panel = createPanel({ onToggle: () => viewShift.sync() });
  const isSmallScreen = window.matchMedia('(max-width: 720px)').matches;

  // --- controls: the tilt up front, the rest folded away ---------------------------------------------
  const tiltSlider = createSlider({
    labelKey: `${KEYS}.controls.tilt`,
    unitKey: 'units.degrees',
    min: S.TILT_RANGE_DEG.min,
    max: S.TILT_RANGE_DEG.max,
    step: 0.1,
    value: state.tiltDeg,
    decimals: 1,
    onChange: (v) => setTilt(v, { fromSlider: true }),
  });

  const moreControls = createCollapsibleSection({ titleKey: `${KEYS}.sections.more`, open: !isSmallScreen });

  const periodSlider = createSlider({
    labelKey: `${KEYS}.controls.rotationPeriod`,
    min: Math.log10(S.ROTATION_RANGE_H.min),
    max: Math.log10(S.ROTATION_RANGE_H.max),
    step: 0.002,
    value: Math.log10(state.periodH),
    format: (v) => `${fmt(Math.pow(10, v), Math.pow(10, v) < 10 ? 1 : 0)}\u2009${t('units.hours')}`,
    onChange: (v) => setPeriod(Math.round(Math.pow(10, v) * 10) / 10, { fromSlider: true }),
  });
  const presetRow = el('div', 'lp-whatif', { role: 'group' });
  bindAttr(presetRow, { 'aria-label': `${KEYS}.controls.presets` });
  const presetButtons = S.WHAT_IF_PRESETS.map((preset) => {
    const btn = createButton({ labelKey: `${KEYS}.presets.${preset.id}`, onClick: () => applyPreset(preset) });
    btn.el.classList.add('lp-whatif__btn');
    presetRow.append(btn.el);
    return { preset, el: btn.el };
  });
  const presetNote = el('p', 'lp-preset-note', { role: 'status' });
  function syncPresets() {
    if (!S.WHAT_IF_PRESETS.some((p) => p.id === state.activePreset && presetMatches(p))) {
      state.activePreset = S.WHAT_IF_PRESETS.find(presetMatches)?.id ?? null;
    }
    for (const { preset, el: btn } of presetButtons) btn.setAttribute('aria-pressed', String(preset.id === state.activePreset));
    presetNote.hidden = !state.activePreset;
    if (state.activePreset) presetNote.textContent = t(`${KEYS}.presetNotes.${state.activePreset}`);
  }
  const presetsTitle = bindText(el('p', 'lp-subheading'), `${KEYS}.controls.presets`);

  const daySlider = createSlider({
    labelKey: `${KEYS}.controls.dayOfYear`,
    min: 0,
    max: 365,
    step: 0.5,
    value: state.dayOfYear,
    format: (v) => formatDate(v),
    onChange: (v) => setDayOfYear(v, { fromSlider: true }),
  });
  const playBtn = createButton({ labelKey: `${KEYS}.controls.pause`, icon: '⏸', variant: 'primary', compact: true, onClick: () => setPlaying(!state.playing) });
  function syncPlayButton() {
    playBtn.setIcon(state.playing ? '⏸' : '▶');
    playBtn.setLabel(state.playing ? `${KEYS}.controls.pause` : `${KEYS}.controls.play`);
    playBtn.el.setAttribute('aria-pressed', String(state.playing));
  }
  const dayRow = createControlRow(daySlider, playBtn);
  const stopRow = el('div', 'lp-presets lp-presets--compact', { role: 'group' });
  bindAttr(stopRow, { 'aria-label': `${KEYS}.controls.stops` });
  for (const stop of S.SEASON_STOPS) {
    const btn = createButton({ labelKey: `${KEYS}.seasons.${stop.season}`, onClick: () => setDayOfYear(stop.dayOfYear) });
    btn.el.classList.add('lp-presets__btn', 'lp-presets__btn--stack');
    btn.el.append(bindText(el('span', 'lp-presets__value'), `${KEYS}.stopDates.${stop.id}`));
    stopRow.append(btn.el);
  }
  const speedSlider = createSlider({
    labelKey: `${KEYS}.controls.speed`,
    unitKey: 'units.daysPerSecond',
    min: SPEED_RANGE.min,
    max: SPEED_RANGE.max,
    step: 1,
    value: state.daysPerSecond,
    decimals: 0,
    onChange: (v) => {
      state.daysPerSecond = v;
    },
  });

  const viewToggle = (name, labelKey, onChange = refresh) => createStateToggle({ labelKey, state, name, prefs: viewPrefs, onChange });
  // the two colour overlays share the hue ramp but mean different things (W/m² vs °C) – only one at a time
  const toggles = {
    showHeat: viewToggle('showHeat', `${KEYS}.view.heatMap`, (v) => {
      if (v && state.showClimate) toggles.showClimate.setChecked(false);
      heatLegend.el.hidden = !v;
      refresh();
    }),
    showClimate: viewToggle('showClimate', `${KEYS}.view.climateBands`, (v) => {
      if (v && state.showHeat) toggles.showHeat.setChecked(false);
      climateLegend.el.hidden = !v;
      refresh();
    }),
    showLivable: viewToggle('showLivable', `${KEYS}.view.livable`),
    showTerminator: viewToggle('showTerminator', `${KEYS}.view.terminator`),
    showEquator: viewToggle('showEquator', `${KEYS}.view.equator`),
    showCircles: viewToggle('showCircles', `${KEYS}.view.circles`),
    showAxis: viewToggle('showAxis', `${KEYS}.view.axis`),
    showSubsolar: viewToggle('showSubsolar', `${KEYS}.view.subsolar`),
    showGrid: viewToggle('showGrid', `${KEYS}.view.grid`),
    showLabels: viewToggle('showLabels', `${KEYS}.view.labels`),
  };
  const heatLegend = createHeatLegend(`${KEYS}.legend.heatTitle`, `${KEYS}.legend.heatLow`, `${KEYS}.legend.heatHigh`);
  heatLegend.el.hidden = !state.showHeat;
  const climateLegend = createHeatLegend(`${KEYS}.legend.climateTitle`, `${KEYS}.legend.climateLow`, `${KEYS}.legend.climateHigh`);
  climateLegend.el.hidden = !state.showClimate;
  const cameraRow = el('div', 'lp-presets lp-presets--2 lp-presets--compact', { role: 'group' });
  bindAttr(cameraRow, { 'aria-label': `${KEYS}.controls.camera` });
  const cameraButtons = [
    ['earth', '🌍'],
    ['overview', '◎'],
    ['top', '⤓'],
    ['pin', '📍'],
  ].map(([id, icon]) => {
    const btn = createButton({ labelKey: `${KEYS}.view.camera${id[0].toUpperCase()}${id.slice(1)}`, icon, onClick: () => { cameraPresets[id](); syncCameraButtons(); } });
    btn.el.classList.add('lp-presets__btn');
    cameraRow.append(btn.el);
    return { id, el: btn.el };
  });
  function syncCameraButtons() {
    for (const { id, el: btn } of cameraButtons) {
      btn.setAttribute('aria-pressed', String(state.cameraMode === id));
      if (id === 'pin') btn.disabled = !pin;
    }
  }

  const resetBtn = createButton({
    labelKey: 'panel.reset',
    icon: '↺',
    onClick: () => {
      unpin({ restoreCamera: false });
      Object.assign(state, DEFAULTS, { activePreset: 'earth' });
      tiltSlider.setValue(state.tiltDeg, { silent: true });
      periodSlider.setValue(Math.log10(state.periodH), { silent: true });
      daySlider.setValue(state.dayOfYear, { silent: true });
      speedSlider.setValue(state.daysPerSecond, { silent: true });
      latitudeSlider.setValue(state.latitudeDeg, { silent: true });
      spinGroup.rotation.y = 0;
      syncPresets();
      syncLatitudeButtons();
      syncPlayButton();
      refresh();
      cameraPresets.earth();
      syncCameraButtons();
    },
  });
  const resetRow = el('div', 'lp-button-row lp-button-row--full');
  resetRow.append(resetBtn.el);

  moreControls.add(periodSlider, presetsTitle, presetRow, presetNote,
    bindText(el('p', 'lp-subheading'), `${KEYS}.sections.orbit`), dayRow, stopRow, speedSlider);
  if (sim.reducedMotion) moreControls.add(createNotice({ textKey: 'motion.reducedNotice' }));
  moreControls.add(
    bindText(el('p', 'lp-subheading'), `${KEYS}.sections.view`), cameraRow,
    toggles.showHeat, heatLegend, toggles.showClimate, climateLegend, toggles.showLivable,
    toggles.showTerminator, toggles.showEquator, toggles.showCircles, toggles.showAxis, toggles.showSubsolar, toggles.showGrid, toggles.showLabels,
    resetRow,
  );

  // --- readouts: what the tilt does to the planet, then the year, then one chosen latitude -----------
  // year-round livable share of the surface + verdict tier for the current tilt
  const habReadout = createReadout(`${KEYS}.readout.livableSurface`);
  habReadout.el.classList.add('lp-readout--zone');
  const habState = el('span', 'lp-state', { role: 'status' });
  const habHint = el('p', 'lp-state__hint');
  habReadout.el.append(habState, habHint);
  const orbitFacts = createFacts([
    ['season', `${KEYS}.readout.season`],
    ['subsolar', `${KEYS}.readout.subsolar`],
    ['tropics', `${KEYS}.readout.tropics`],
    ['polarCircles', `${KEYS}.readout.polarCircles`],
  ]);

  // the latitude block stays one unit: its slider and presets only make sense beside their readouts
  const latitudeSlider = createSlider({
    labelKey: `${KEYS}.controls.latitude`,
    min: -90,
    max: 90,
    step: 0.5,
    value: state.latitudeDeg,
    format: (v) => formatLatitude(v, 1),
    onChange: (v) => setLatitude(v, { fromSlider: true }),
  });
  const latitudeRow = el('div', 'lp-presets lp-presets--compact', { role: 'group' });
  bindAttr(latitudeRow, { 'aria-label': `${KEYS}.controls.latitudePresets` });
  const presetLatitude = (preset) => (preset.id === 'polarCircle' ? Math.round((90 - state.tiltDeg) * 10) / 10 : preset.latitudeDeg);
  const latitudeButtons = S.LATITUDE_PRESETS.map((preset) => {
    const btn = createButton({ labelKey: `${KEYS}.latitudes.${preset.id}`, onClick: () => setLatitude(presetLatitude(preset)) });
    btn.el.classList.add('lp-presets__btn', 'lp-presets__btn--stack');
    const value = el('span', 'lp-presets__value');
    btn.el.append(value);
    latitudeRow.append(btn.el);
    return { preset, el: btn.el, value };
  });
  function syncLatitudeButtons() {
    for (const { preset, el: btn, value } of latitudeButtons) {
      const lat = presetLatitude(preset);
      value.textContent = formatLatitude(lat, 1);
      btn.setAttribute('aria-pressed', String(Math.abs(state.latitudeDeg - lat) < 0.01));
    }
  }
  // pinned place: latitude · season · seasonal-mean temperature, livable verdict, unpin
  const pinReadout = createReadout(`${KEYS}.readout.pinned`);
  pinReadout.el.classList.add('lp-readout--zone');
  const pinState = el('span', 'lp-state', { role: 'status' });
  const unpinBtn = createButton({ labelKey: `${KEYS}.pin.unpin`, icon: '✕', onClick: () => unpin() });
  const pinHint = bindText(el('p', 'lp-state__hint'), `${KEYS}.pin.hint`);
  pinReadout.el.append(pinState, unpinBtn.el, pinHint);
  const dayReadout = el('div', 'lp-readout');
  const dayReadoutLabel = bindText(el('div', 'lp-readout__label'), `${KEYS}.readout.dayLength`);
  const dayReadoutValue = el('div', 'lp-readout__value', { 'aria-live': 'off' });
  const dayReadoutTag = el('span', 'lp-state', { role: 'status', hidden: true });
  dayReadout.append(dayReadoutLabel, dayReadoutValue, dayReadoutTag);
  const latitudeFacts = createFacts([
    ['midnightSun', `${KEYS}.readout.midnightSun`],
    ['polarNight', `${KEYS}.readout.polarNightDays`],
    ['insolation', `${KEYS}.readout.insolation`],
    ['temperature', `${KEYS}.readout.temperature`],
    ['dayNight', `${KEYS}.readout.dayNight`],
    ['seasonalMeans', `${KEYS}.readout.seasonalMeans`],
  ]);
  const zoneRow = el('div', 'lp-zone');
  const zoneLabel = bindText(el('span', 'lp-zone__label'), `${KEYS}.readout.zone`);
  const zonePill = el('span', 'lp-state', { role: 'status' });
  const zoneHint = el('p', 'lp-state__hint');
  zoneRow.append(zoneLabel, zonePill, zoneHint);
  const livableRow = el('div', 'lp-zone');
  const livablePill = el('span', 'lp-state', { role: 'status' });
  livableRow.append(bindText(el('span', 'lp-zone__label'), `${KEYS}.readout.livableYearRound`), livablePill);
  const legend = createLegend();

  const infoCard = createInfoCard({ titleKey: `${KEYS}.info.title`, bodyKey: `${KEYS}.info.body`, open: !isSmallScreen });
  const physicsCard = createPhysicsCard();
  panel.add(
    tiltSlider, moreControls,
    habReadout, orbitFacts,
    bindText(el('p', 'lp-subheading'), `${KEYS}.sections.readout`), latitudeSlider, latitudeRow,
    pinReadout, dayReadout, latitudeFacts, zoneRow, livableRow,
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

  // --- readouts -------------------------------------------------------------------------------------------------------------------------
  let lastReadoutKey = '';
  function updateReadouts(force = false) {
    const { declDeg, dayLengthH, fraction, temps, polar, extremes, livable, zone, season } = model;
    const key = `${declDeg.toFixed(2)}|${dayLengthH.toFixed(2)}|${state.tiltDeg}|${state.periodH}|${state.latitudeDeg}|${Math.floor(state.dayOfYear)}|${pin ? 1 : 0}`;
    if (!force && key === lastReadoutKey) return;
    lastReadoutKey = key;

    const { fraction: livableFraction, verdict } = ensureHabitability();
    habReadout.value.textContent = `${fmt(livableFraction * 100, 0)}${t('units.percent')}`;
    habState.className = `lp-state lp-state--${VERDICT_STATE[verdict]}`;
    habState.textContent = t(`${KEYS}.verdictLabel.${verdict}`);
    habHint.textContent = t(`${KEYS}.verdict.${verdict}`);
    habReadout.el.classList.remove('is-inner', 'is-habitable', 'is-outer');
    habReadout.el.classList.add(VERDICT_ZONE[verdict]);

    const noSeasons = state.tiltDeg < 0.05;
    orbitFacts.set('season', noSeasons ? t(`${KEYS}.readout.noSeasons`) : t(`${KEYS}.readout.seasonLine`, { north: t(`${KEYS}.seasons.${season.north}`), south: t(`${KEYS}.seasons.${season.south}`) }));
    orbitFacts.set('subsolar', formatLatitude(declDeg, 1));
    orbitFacts.set('tropics', noSeasons ? t(`${KEYS}.readout.none`) : t(`${KEYS}.readout.plusMinus`, { n: fmt(state.tiltDeg, 1) }));
    orbitFacts.set('polarCircles', noSeasons ? t(`${KEYS}.readout.none`) : t(`${KEYS}.readout.plusMinus`, { n: fmt(90 - state.tiltDeg, 1) }));

    dayReadoutValue.textContent = formatDuration(dayLengthH);
    const polarTag = fraction >= 1 - 1e-6 ? 'polarDay' : fraction <= 1e-6 ? 'polarNight' : null;
    dayReadoutTag.hidden = !polarTag;
    if (polarTag) {
      dayReadoutTag.textContent = t(`${KEYS}.readout.${polarTag}`);
      dayReadoutTag.className = `lp-state lp-state--${polarTag === 'polarDay' ? 'scorched' : 'frozen'}`;
    }
    const daysText = (n) => (n > 0 ? t(`${KEYS}.readout.${n === 1 ? 'day' : 'days'}`, { n: fmt(n, 0) }) : t(`${KEYS}.readout.none`));
    latitudeFacts.set('midnightSun', daysText(polar.midnightSun));
    latitudeFacts.set('polarNight', daysText(polar.polarNight));
    latitudeFacts.set('insolation', `${fmt(temps.insolation, 0)} ${t('units.wattsPerSquareMeter')}`);
    latitudeFacts.set('temperature', `≈ ${formatTemperature(temps.meanC)}`);
    latitudeFacts.set('dayNight', `${formatTemperature(temps.dayC)} / ${formatTemperature(temps.nightC)}`);
    latitudeFacts.set('seasonalMeans', `${formatTemperature(extremes.summerC)} / ${formatTemperature(extremes.winterC)}`);
    zonePill.textContent = t(`${KEYS}.readout.zones.${zone}`);
    zonePill.className = `lp-state lp-state--zone-${zone}`;
    zoneHint.textContent = t(`${KEYS}.readout.zoneHints.${zone}`);
    livablePill.textContent = t(`${KEYS}.pin.${livable ? 'livable' : 'notLivable'}`);
    livablePill.className = `lp-state lp-state--${livable ? 'habitable' : 'scorched'}`;

    pinReadout.el.classList.remove('is-inner', 'is-habitable');
    pinState.hidden = !pin;
    unpinBtn.el.hidden = !pin;
    pinHint.hidden = !!pin;
    if (pin) {
      const hemisphere = state.latitudeDeg >= 0 ? 'north' : 'south';
      pinReadout.value.textContent = `${formatLatitude(state.latitudeDeg, 0)} · ${t(`${KEYS}.seasons.${season[hemisphere]}`)} · ${formatTemperature(temps.meanC)}`;
      pinState.className = `lp-state lp-state--${livable ? 'habitable' : 'scorched'}`;
      pinState.textContent = t(`${KEYS}.pin.${livable ? 'livable' : 'notLivable'}`);
      pinReadout.el.classList.add(livable ? 'is-habitable' : 'is-inner');
    } else {
      pinReadout.value.textContent = '–';
    }
  }

  // --- language -------------------------------------------------------------------------------------------------------------------------
  disposers.push(
    onLanguageChange(() => {
      updateScene();
      updateReadouts(true);
      syncPresets();
      syncLatitudeButtons();
      syncPlayButton();
      physicsCard.render();
      sim.requestRender();
    }),
  );

  // --- go ------------------------------------------------------------------------------------------------------------------------------------
  model = derive();
  updateScene();
  syncPresets();
  syncLatitudeButtons();
  syncPlayButton();
  syncCameraButtons();
  refresh();
  updateReadouts(true);
  cameraPresets.earth(0);
  sim.start();

  // dev-only hook for automated checks; stripped from production builds
  if (import.meta.env.DEV) {
    window.__lpAxialTilt = { sim, state, get model() { return model; }, get pin() { return pin; }, get habitability() { return habitability; }, setTilt, setPeriod, setDayOfYear, setLatitude, setPlaying, applyPreset, setPin, unpin, cameraPresets, frame, refresh, presets: S.WHAT_IF_PRESETS };
  }

  return () => {
    if (import.meta.env.DEV) delete window.__lpAxialTilt;
    disposers.forEach((d) => d());
    panel.dispose();
    hint.remove();
    credit.remove();
    stopLabels.forEach(({ label }) => label.dispose());
    Object.values(poleLabels).forEach((l) => l.dispose());
    subsolarLabel.dispose();
    glowTexture.dispose();
    placeholder.dispose();
    nightPlaceholder.dispose();
    climateTexture.dispose();
    sim.dispose();
    viewport.remove();
  };
}

// ============================================================================================================
// formatting helpers
// ============================================================================================================
let dateFormatter = null;
let dateFormatterLocale = null;
const DATE_EPOCH_MS = Date.UTC(2001, 0, 1); // any non-leap year; only month + day are shown
function formatDate(dayOfYear) {
  const locale = getLocale();
  if (!dateFormatter || dateFormatterLocale !== locale) {
    dateFormatter = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    dateFormatterLocale = locale;
  }
  return dateFormatter.format(new Date(DATE_EPOCH_MS + Math.floor(S.normalizeDay(dayOfYear)) * 86400000));
}

function formatLatitude(deg, digits) {
  const abs = Math.abs(deg);
  const hemisphere = abs < 0.05 ? '' : ` ${t(`${KEYS}.hemisphere.${deg > 0 ? 'north' : 'south'}`)}`;
  return `${fmt(abs, digits)}°${hemisphere}`;
}

function formatDuration(hours) {
  let h = Math.floor(hours);
  let m = Math.round((hours - h) * 60);
  if (m === 60) {
    h += 1;
    m = 0;
  }
  return `${fmt(h, 0)}\u2009${t('units.hours')} ${String(m).padStart(2, '0')}\u2009${t('units.minutes')}`;
}

function formatTemperature(c) {
  return `${fmt(c, 0)}\u2009${t('units.celsius')}`;
}

// ============================================================================================================
// UI helpers (local to this simulation)
// ============================================================================================================
/** Definition list of live facts: set(id, text) updates a value. */
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

/** Labelled headline value (label above, value + optional pills beside it). */
function createReadout(labelKey) {
  const box = el('div', 'lp-readout');
  const value = el('div', 'lp-readout__value', { 'aria-live': 'off' });
  box.append(bindText(el('div', 'lp-readout__label'), labelKey), value);
  return { el: box, value, dispose() {} };
}

function createLegend() {
  const wrap = el('div', 'lp-legend');
  const item = (key, color) => {
    const li = el('div', 'lp-legend__item');
    const swatch = el('span', 'lp-legend__swatch', { 'aria-hidden': 'true' });
    swatch.style.color = `#${new THREE.Color(color).getHexString()}`;
    li.append(swatch, bindText(el('span'), key));
    return li;
  };
  wrap.append(
    item(`${KEYS}.legend.equator`, COLORS.equator),
    item(`${KEYS}.legend.tropics`, COLORS.tropics),
    item(`${KEYS}.legend.polarCircles`, COLORS.polar),
    item(`${KEYS}.legend.terminator`, COLORS.terminator),
    item(`${KEYS}.legend.selected`, COLORS.selected),
    item(`${KEYS}.legend.subsolar`, COLORS.subsolar),
    item(`${KEYS}.legend.livableBorder`, COLORS.livable),
  );
  return { el: wrap, dispose() {} };
}

/** Colour-ramp legend (the bar's gradient in style.css matches both the shader ramp and climate.js). */
function createHeatLegend(titleKey, lowKey, highKey) {
  const wrap = el('div', 'lp-heat-legend');
  const title = bindText(el('span', 'lp-heat-legend__title'), titleKey);
  const bar = el('div', 'lp-heat-legend__bar', { 'aria-hidden': 'true' });
  const scale = el('div', 'lp-heat-legend__scale');
  scale.append(bindText(el('span'), lowKey), bindText(el('span'), highKey));
  wrap.append(title, bar, scale);
  return { el: wrap, dispose() {} };
}

/** Collapsible "Physics" card listing the formulas used. */
function createPhysicsCard() {
  const details = el('details', 'lp-info lp-physics');
  const summary = el('summary', 'lp-info__summary');
  summary.append(bindText(el('span', 'lp-info__title'), `${KEYS}.physics.title`));
  const body = el('div', 'lp-info__body');
  details.append(summary, body);
  const entries = ['declination', 'dayLength', 'insolation', 'temperature', 'swing', 'seasonalMeans', 'livable', 'livableFraction', 'tiers'];
  function render() {
    body.replaceChildren();
    // the caveat that qualifies every temperature the panel shows
    const caveat = el('div', 'lp-notice lp-notice--info', { role: 'note' });
    caveat.textContent = t(`${KEYS}.readout.modelNote`);
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
/** Circle in the xz plane (ecliptic). */
function circleGeometry(radius, segments = 192) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(radius * Math.cos(a), 0, radius * Math.sin(a)));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

/** Circle in the xy plane (normal +z) – oriented with a quaternion at runtime. */
function circleGeometryXY(radius, segments = 192) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(radius * Math.cos(a), radius * Math.sin(a), 0));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

/** Screen-space text label whose text/colour can be updated in place. */
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

function createRingTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineWidth = size * 0.05;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ============================================================================================================
// shaders
// ============================================================================================================
const EARTH_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying float vSinLat;
  void main() {
    vUv = uv;
    vSinLat = normal.y; // object space: the sphere spins about its local y axis, so y = sin(latitude)
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
  uniform float uDecl;      // solar declination (rad)
  uniform float uHeatMix;   // 0 = texture, 1 = insolation heat map
  uniform float uHeatScale; // insolation (fraction of S0) at which the ramp saturates
  uniform sampler2D uClimateTex; // 1 × N rows: seasonal-mean temperature colour per latitude (row 0 = south pole)
  uniform float uClimateMix;     // 1 = temperature bands on
  uniform float uLivableMix;     // 1 = darken latitudes outside the livable bands
  uniform vec2 uBands[4];        // livable latitude bands [lo, hi] (rad)
  uniform int uBandCount;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying float vSinLat;
  const float PI = 3.141592653589793;

  vec3 ramp(float x) {
    // deep blue → blue → green → yellow → red (linear RGB)
    vec3 c0 = vec3(0.010, 0.020, 0.160);
    vec3 c1 = vec3(0.020, 0.200, 0.700);
    vec3 c2 = vec3(0.100, 0.650, 0.200);
    vec3 c3 = vec3(0.950, 0.650, 0.050);
    vec3 c4 = vec3(0.800, 0.040, 0.010);
    x = clamp(x, 0.0, 1.0) * 4.0;
    if (x < 1.0) return mix(c0, c1, x);
    if (x < 2.0) return mix(c1, c2, x - 1.0);
    if (x < 3.0) return mix(c2, c3, x - 2.0);
    return mix(c3, c4, x - 3.0);
  }

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunPos - vWorldPos);
    float ndl = dot(N, L);
    float day = smoothstep(-0.03, 0.10, ndl);
    vec3 base = texture2D(uMap, vUv).rgb;
    vec3 dayColor = base * (0.10 + 1.05 * clamp(ndl, 0.0, 1.0));
    vec3 nightColor = base * vec3(0.030, 0.040, 0.075);
    vec3 color = mix(nightColor, dayColor, day);

    // daily mean insolation at this latitude (fraction of the solar constant)
    float sinLat = clamp(vSinLat, -1.0, 1.0);
    float lat = asin(sinLat);
    float cosLat = cos(lat);
    float sd = sin(uDecl);
    float cd = cos(uDecl);
    float cosH0 = clamp(-(sinLat * sd) / max(cosLat * cd, 1e-4), -1.0, 1.0);
    float H0 = acos(cosH0);
    float q = (H0 * sinLat * sd + cosLat * cd * sin(H0)) / PI;
    vec3 heat = ramp(q / uHeatScale) * (0.35 + 0.65 * day);
    color = mix(color, heat, uHeatMix * 0.88);

    // seasonal-mean temperature bands (energy-balance model, −40 … +60 °C ramp)
    vec3 band = texture2D(uClimateTex, vec2(0.5, lat / PI + 0.5)).rgb * (0.35 + 0.65 * day);
    color = mix(color, band, uClimateMix * 0.7);

    // livable-region view: darken every latitude outside the livable bands
    float livable = 0.0;
    for (int i = 0; i < 4; i++) {
      if (i < uBandCount) livable = max(livable, step(uBands[i].x, lat) * step(lat, uBands[i].y));
    }
    color *= 1.0 - uLivableMix * (1.0 - livable) * 0.6;

    // city lights, fading in across the terminator
    color += texture2D(uNightMap, vUv).rgb * (1.0 - day) * 1.6;

    // thin atmospheric rim
    vec3 V = normalize(cameraPosition - vWorldPos);
    float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
    color += vec3(0.25, 0.5, 1.0) * rim * (0.15 + 0.5 * day);

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const ATMOSPHERE_VERTEX = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const ATMOSPHERE_FRAGMENT = /* glsl */ `
  uniform vec3 uSunPos;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunPos - vWorldPos);
    // back-face shell: the rim is where the normal is perpendicular to the view direction
    float rim = pow(clamp(1.0 + dot(N, V), 0.0, 1.0), 2.5);
    float lit = 0.25 + 0.75 * smoothstep(-0.3, 0.3, dot(N, L));
    vec3 color = vec3(0.35, 0.6, 1.0) * rim * lit * 0.9;
    gl_FragColor = vec4(color, rim * 0.9);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
