/**
 * Simulation: Axial tilt, seasons & day length ("axial-tilt").
 *
 * Earth orbits an emissive Sun. The axial tilt (0–90°) and rotation period
 * (6–300 h) are adjustable; Earth can be dragged along its orbit (in the views
 * that look at the whole orbit – the two close-ups spend the gesture on the
 * camera and on the pinned place) or animated through the year. A shader lights the textured Earth with a soft day/night
 * terminator and city lights on the night side, and paints the climate of the moment onto the
 * surface itself: from each latitude's seasonal mean it lays snow and sea ice over the cold parts,
 * turns the land brown and then to sand where it is hot, lets the shallow seas fall dry to brine
 * and salt in a high-tilt polar summer, and keeps the city lights only where a latitude is livable
 * all year – fronts made ragged by noise, eased over half a second so the picture flows with the
 * slider (./climate.js, SURFACE). It can also overlay either a heat
 * map of the daily mean insolation or temperature bands of the seasonal-mean
 * energy-balance temperature per latitude – both painted at full strength only
 * where the colour ramp turns hostile, so livable values stay a tint the map
 * shows through – plus a livable-region view that darkens the latitudes that are
 * not livable all year. Small temperature labels sit on the globe itself: the day
 * value at local noon of the selected latitude, the night value at local midnight –
 * or, once a place is pinned, one live value on the pin, the temperature it has at
 * this hour – and, on the sun ray label, the temperature where the ray lands, each
 * with its own toggle.
 * Tropics, polar circles, the subsolar point, a readout
 * (day length, insolation, temperature estimate, seasonal extremes, climate
 * zone) for a selectable latitude and the year-round
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
import { createPanel, createPanelShift, createCollapsibleSection, createControlRow, createSlider, createViewToggles, createButton, createResetButton, createInfoCard, createNotice, el } from '../../lib/ui.js';
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
const CLIMATE_ROWS = 128; // latitude rows of the temperature-band and surface textures
const VISUAL_EASE = 0.45; // s – the surface follows the climate with this lag, so tilt drags and season jumps flow instead of popping
const MAX_LIVABLE_BANDS = 4; // shader uniform slots; the model never produces more than 2 bands
const BORDER_RING_POOL = 2 * MAX_LIVABLE_BANDS; // one ring per band edge
const CLICK_THRESHOLD_PX = 6; // pointer travel below which a press counts as a click (pin) rather than a drag
const PIN_DISTANCE = Object.freeze({ min: 2.2, max: 6 }); // camera distance from Earth's centre when flying to a pin
const PIN_SPIN_MAX_RAD_S = 30 * (Math.PI / 180); // visual spin cap while the camera rides on a pinned place
const TEMP_LABEL_SIZE = 0.62; // screen-space size of the temperature labels on the globe – small enough not to cover it
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
  dayTemp: 0xffc089,
  nightTemp: 0x9dbcff,
  season: 0xc7d3ea,
  livable: 0x5adc8c,
  pinHead: 0xe23a2e,
  pinNeedle: 0xcfd4dc,
});

/**
 * The camera views the panel's header button steps through, in that order. The pinned
 * place is a view too, but it is not part of the cycle: it only exists while a place is
 * pinned, and clicking Earth is how it is reached.
 */
const CAMERA_VIEWS = Object.freeze([
  { id: 'earth', labelKey: `${KEYS}.view.cameraEarth`, icon: '🌍' },
  { id: 'overview', labelKey: `${KEYS}.view.cameraOverview`, icon: '◎' },
  { id: 'top', labelKey: `${KEYS}.view.cameraTop`, icon: '⤓' },
]);
const PIN_VIEW = Object.freeze({ id: 'pin', labelKey: `${KEYS}.view.cameraPin`, icon: '📍' });

const DEFAULTS = Object.freeze({
  tiltDeg: S.EARTH_TILT_DEG,
  periodH: S.EARTH_ROTATION_H,
  dayOfYear: 171.5, // June solstice
  playing: true,
  daysPerSecond: 10,
  latitudeDeg: 0,
});

/** Display toggles – remembered per visitor, see ../../lib/prefs.js. Earth arrives with the
 *  climate story already on – the surface conditions painted on the globe, the subsolar point and the
 *  temperature labels that put numbers on them – and everything drawn *over* the globe, the colour
 *  overlays and the livable region's rings and darkening alike, is one tap away in the panel. */
const VIEW_DEFAULTS = Object.freeze({
  showSurface: true, // ice, snow, browning and drying painted per latitude and season
  showHeat: false, // insolation heat map – exclusive with showClimate
  showClimate: false, // seasonal-mean temperature bands – off by default, they would paint over the ice caps
  showLivable: false, // livable-region view – off by default, its darkening and border rings cover the surface
  showTerminator: false,
  showEquator: false,
  showCircles: false, // tropics + polar circles
  showAxis: true,
  showSubsolar: true,
  showTemps: true, // day / night temperature of the selected latitude, on the globe
  showSubsolarTemp: true, // temperature where the sun ray lands
  showGrid: false,
  showLabels: true,
});

const { clamp } = S;
const DEG = Math.PI / 180;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
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
  // the screen-space corona ignores depth so the Sun keeps its halo at any distance – Earth has to hide it by hand (see updateOverlay)
  const CORONA_OPACITY = 0.5;
  const sunCorona = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xffd9a0, transparent: true, opacity: CORONA_OPACITY, depthWrite: false, depthTest: false, sizeAttenuation: false, blending: THREE.AdditiveBlending, toneMapped: false }));
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
  // temperature bands: one texel row per latitude (row 0 = south pole), coloured on the −40 … +60 °C
  // ramp, with the overlay strength for that temperature in the alpha channel (see C.overlayAlpha)
  const climateData = new Uint8Array(CLIMATE_ROWS * 4);
  const climateTexture = new THREE.DataTexture(climateData, 1, CLIMATE_ROWS, THREE.RGBAFormat);
  climateTexture.colorSpace = THREE.SRGBColorSpace;
  climateTexture.minFilter = climateTexture.magFilter = THREE.LinearFilter;
  climateTexture.needsUpdate = true;
  // surface conditions: one texel row per latitude again, but data rather than colour (so it stays in
  // linear/no colour space): R = seasonal mean encoded on SURFACE.tempRangeC, G = permanent ice,
  // B = city lights (year-round livability), A = annual mean (same encoding – it thaws the map's own
  // ice sheets). The shader turns the means into snow, sea ice, dormant or parched land, dry seas and
  // melted caps with the ramps of C.SURFACE, on a noise-jittered latitude.
  const surfaceData = new Uint8Array(CLIMATE_ROWS * 4);
  const surfaceTexture = new THREE.DataTexture(surfaceData, 1, CLIMATE_ROWS, THREE.RGBAFormat);
  surfaceTexture.minFilter = surfaceTexture.magFilter = THREE.LinearFilter;
  surfaceTexture.needsUpdate = true;
  const earthMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: placeholder },
      uNightMap: { value: nightPlaceholder },
      uSunPos: { value: new THREE.Vector3() },
      uDecl: { value: 0 },
      uSurfTex: { value: surfaceTexture },
      uSurfaceMix: { value: 0 },
      uTime: { value: 0 },
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
      uniforms: {
        uSunPos: earthMaterial.uniforms.uSunPos,
        uSurfTex: earthMaterial.uniforms.uSurfTex, // the shell reads the same eased rows: warm haze along the hot latitudes
        uSurfaceMix: earthMaterial.uniforms.uSurfaceMix,
        uAxis: { value: new THREE.Vector3(0, 1, 0) }, // Earth's rotation axis in world space – the shell itself does not tilt
      },
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

  // subsolar point marker + sun ray. The marker is a screen-space sprite that ignores depth (it must stay
  // one crisp dot at any zoom), so Earth has to hide it by hand when the point is on the far side (see updateOverlay)
  const SUBSOLAR_OPACITY = 0.95;
  const subsolarMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: COLORS.subsolar, transparent: true, opacity: SUBSOLAR_OPACITY, depthWrite: false, depthTest: false, sizeAttenuation: false, toneMapped: false }));
  subsolarMarker.scale.set(0.045, 0.045, 1);
  subsolarMarker.renderOrder = 8;
  const subsolarLabel = createLabel(COLORS.subsolar, labelFont, 0.85);
  const sunRay = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: COLORS.subsolar, transparent: true, opacity: 0.5, depthWrite: false }),
  );
  sunRay.frustumCulled = false;
  scene.add(subsolarMarker, subsolarLabel.sprite, sunRay);

  // temperature labels on the globe: the day value of the selected latitude at its local noon, its
  // night value at local midnight, and the temperature where the sun ray lands (the subsolar point,
  // where the Sun stands in the zenith). Small, world-positioned, placed anew every frame.
  // A pinned place replaces the pair with a single label on the pin: one place has one temperature –
  // the one it has at this hour – so the day/night pair would only say what the hour already decides.
  const tempLabels = {
    day: createLabel(COLORS.dayTemp, labelFont, TEMP_LABEL_SIZE),
    night: createLabel(COLORS.nightTemp, labelFont, TEMP_LABEL_SIZE),
    pin: createLabel(COLORS.selected, labelFont, TEMP_LABEL_SIZE),
    subsolar: createLabel(COLORS.subsolar, labelFont, TEMP_LABEL_SIZE),
  };
  for (const [id, label] of Object.entries(tempLabels)) label.sprite.name = `temp-${id}`; // named like the Sun and Earth meshes, for the automated checks
  scene.add(tempLabels.day.sprite, tempLabels.night.sprite, tempLabels.pin.sprite, tempLabels.subsolar.sprite);

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
  const tmpCamDir = new THREE.Vector3(); // Earth → camera (unit), for the far-side fade of the temperature labels
  const tmpMeridian = new THREE.Vector3();
  const tmpPin = new THREE.Vector3();
  const tmpPinDir = new THREE.Vector3();
  const dayDirWorld = new THREE.Vector3(); // Earth's centre → local noon at the selected latitude
  const nightDirWorld = new THREE.Vector3(); // … → local midnight
  const tiltQuat = new THREE.Quaternion();
  const tiltQuatInv = new THREE.Quaternion();
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

  /**
   * Unit direction (world space) from Earth's centre to the point at `latitudeDeg` on the meridian
   * facing the Sun (`toward` – local noon, the warmest hour) or on the one opposite it (local
   * midnight, the coldest): where the day and night temperatures of that latitude belong.
   */
  function meridianDirection(out, latitudeDeg, toward) {
    sunMeridian();
    if (!toward) tmpMeridian.multiplyScalar(-1);
    const phi = latitudeDeg * DEG;
    const c = Math.cos(phi);
    return out.set(tmpMeridian.x * c, Math.sin(phi), tmpMeridian.z * c).applyQuaternion(tiltQuat);
  }

  /** The Sun's meridian in Earth's tilted frame (unit, in the equatorial plane) – written to tmpMeridian. */
  function sunMeridian() {
    tiltGroup.getWorldQuaternion(tiltQuat); // the tilted frame – its +y is the rotation axis
    tiltQuatInv.copy(tiltQuat).invert();
    tmpMeridian.copy(sunDir).applyQuaternion(tiltQuatInv);
    tmpMeridian.y = 0; // the Sun's direction projected onto the equatorial plane
    if (tmpMeridian.lengthSq() < 1e-8) tmpMeridian.set(1, 0, 0); // Sun straight above a pole – any meridian will do
    return tmpMeridian.normalize();
  }

  /**
   * The pinned place's local solar hour angle (rad): 0 at its local noon, ±π at local midnight – the
   * angle between its own meridian and the Sun's. The spin group turns about the axis, so the pin's
   * meridian is its direction turned by the spin. Over a pole, where a meridian means nothing, the
   * day–night swing is zero anyway, so any hour gives the same temperature.
   */
  function pinHourAngle() {
    tmpPin.copy(pin.dirLocal).applyAxisAngle(UP, spinGroup.rotation.y);
    const horizontal = Math.hypot(tmpPin.x, tmpPin.z);
    if (horizontal < 1e-6) return 0;
    const px = tmpPin.x / horizontal;
    const pz = tmpPin.z / horizontal;
    sunMeridian();
    return Math.atan2(tmpMeridian.z * px - tmpMeridian.x * pz, tmpMeridian.x * px + tmpMeridian.z * pz);
  }

  // temperature where the sun ray lands: the subsolar latitude is the declination, and the Sun stands
  // there in the zenith, so it is that latitude's local-noon value. Cached – the declination only
  // moves with the date.
  let subsolarTempCache = { key: '', value: 0 };
  function subsolarTempC(declDeg) {
    const key = `${declDeg.toFixed(2)}|${state.tiltDeg}|${state.periodH}`;
    if (subsolarTempCache.key !== key) {
      const annual = S.annualMeanInsolation(declDeg, state.tiltDeg, 90);
      subsolarTempCache = { key, value: S.temperatureEstimate(declDeg, state.tiltDeg, declDeg, state.periodH, annual).dayC };
    }
    return subsolarTempCache.value;
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

  // per-row quantities that depend on the tilt alone – annual-mean insolation, permanent ice and the
  // year-round lights – are cached per tilt; the seasonal rest is recomputed on the declination
  const climateAnnual = { tilt: NaN, values: new Float64Array(CLIMATE_ROWS), annualC: new Float32Array(CLIMATE_ROWS), permIce: new Float32Array(CLIMATE_ROWS), lights: new Float32Array(CLIMATE_ROWS) };
  const rowLatitude = (row) => -90 + ((row + 0.5) / CLIMATE_ROWS) * 180; // row 0 = south pole (texture v = 0)
  function ensureClimateAnnual() {
    if (climateAnnual.tilt === state.tiltDeg) return;
    climateAnnual.tilt = state.tiltDeg;
    for (let row = 0; row < CLIMATE_ROWS; row++) {
      const lat = rowLatitude(row);
      const annual = S.annualMeanInsolation(lat, state.tiltDeg, 90);
      climateAnnual.values[row] = annual;
      climateAnnual.annualC[row] = S.temperatureEstimate(lat, state.tiltDeg, 0, S.EARTH_ROTATION_H, annual).annualC;
      climateAnnual.permIce[row] = S.iceCoverFraction(annual);
      climateAnnual.lights[row] = C.lightsFactor(C.seasonalExtremes(lat, state.tiltDeg, annual));
    }
  }
  let climateKey = '';
  function updateClimateTexture(declDeg) {
    if (!state.showClimate) return;
    const key = `${state.tiltDeg}|${state.periodH}|${declDeg.toFixed(2)}`;
    if (key === climateKey) return;
    climateKey = key;
    ensureClimateAnnual();
    for (let row = 0; row < CLIMATE_ROWS; row++) {
      const { meanC } = S.temperatureEstimate(rowLatitude(row), state.tiltDeg, declDeg, state.periodH, climateAnnual.values[row]);
      const [r, g, b] = C.temperatureColor(meanC);
      // alpha = how hard this band paints over the map: faint where the mean is livable, full at the hostile ends
      climateData.set([r, g, b, Math.round(C.temperatureOverlayAlpha(meanC) * 255)], row * 4);
    }
    climateTexture.needsUpdate = true;
  }

  // surface conditions: the model's seasonal mean per row is the target; the picture eases towards it
  const surfaceTarget = { key: '', tempC: new Float32Array(CLIMATE_ROWS) };
  const surfaceVis = { ready: false, tempC: new Float32Array(CLIMATE_ROWS), annualC: new Float32Array(CLIMATE_ROWS), permIce: new Float32Array(CLIMATE_ROWS), lights: new Float32Array(CLIMATE_ROWS) };
  function updateSurfaceTargets(declDeg) {
    const key = `${state.tiltDeg}|${declDeg.toFixed(2)}`; // the mean does not depend on the rotation period
    if (key === surfaceTarget.key) return;
    surfaceTarget.key = key;
    ensureClimateAnnual();
    for (let row = 0; row < CLIMATE_ROWS; row++) {
      surfaceTarget.tempC[row] = S.temperatureEstimate(rowLatitude(row), state.tiltDeg, declDeg, state.periodH, climateAnnual.values[row]).meanC;
    }
  }
  /** Ease every row towards the model and rewrite the texture only where a byte changed; `dt = null` snaps (start-up, reduced motion, paused). */
  function syncSurface(dt) {
    const k = dt === null || !surfaceVis.ready ? 1 : 1 - Math.exp(-dt / VISUAL_EASE);
    surfaceVis.ready = true;
    let changed = false;
    for (let row = 0; row < CLIMATE_ROWS; row++) {
      surfaceVis.tempC[row] += (surfaceTarget.tempC[row] - surfaceVis.tempC[row]) * k;
      surfaceVis.permIce[row] += (climateAnnual.permIce[row] - surfaceVis.permIce[row]) * k;
      surfaceVis.lights[row] += (climateAnnual.lights[row] - surfaceVis.lights[row]) * k;
      surfaceVis.annualC[row] += (climateAnnual.annualC[row] - surfaceVis.annualC[row]) * k;
      const r = Math.round(C.encodeSurfaceTemp(surfaceVis.tempC[row]) * 255);
      const g = Math.round(surfaceVis.permIce[row] * 255);
      const b = Math.round(surfaceVis.lights[row] * 255);
      const a = Math.round(C.encodeSurfaceTemp(surfaceVis.annualC[row]) * 255);
      const i = row * 4;
      if (surfaceData[i] !== r || surfaceData[i + 1] !== g || surfaceData[i + 2] !== b || surfaceData[i + 3] !== a) {
        surfaceData[i] = r;
        surfaceData[i + 1] = g;
        surfaceData[i + 2] = b;
        surfaceData[i + 3] = a;
        changed = true;
      }
    }
    if (changed) surfaceTexture.needsUpdate = true;
  }

  /** Push the model into the scene graph (camera-independent). */
  function updateScene() {
    const { orbitAngleRad, declDeg } = model;
    earthPos.set(ORBIT_RADIUS * Math.cos(orbitAngleRad), 0, -ORBIT_RADIUS * Math.sin(orbitAngleRad));
    earthPivot.position.copy(earthPos);
    sunDir.copy(earthPos).negate().normalize();
    tiltGroup.rotation.z = state.tiltDeg * DEG;
    tiltGroup.updateWorldMatrix(true, false);
    tiltGroup.getWorldQuaternion(tiltQuat);
    atmosphere.material.uniforms.uAxis.value.copy(UP).applyQuaternion(tiltQuat);
    earthMaterial.uniforms.uSunPos.value.set(0, 0, 0);
    earthMaterial.uniforms.uDecl.value = declDeg * DEG;
    earthMaterial.uniforms.uHeatMix.value = state.showHeat ? 1 : 0;
    earthMaterial.uniforms.uClimateMix.value = state.showClimate ? 1 : 0;
    earthMaterial.uniforms.uLivableMix.value = state.showLivable ? 1 : 0;
    earthMaterial.uniforms.uSurfaceMix.value = state.showSurface ? 1 : 0;
    updateClimateTexture(declDeg);
    updateSurfaceTargets(declDeg);
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

    // temperature labels: day and night of the selected latitude on the two sides of the globe.
    // The zenith value rides with the sun ray label (see below); its own sprite only stands in when
    // that label is switched off, so the toggle never does nothing.
    const showTemps = state.showTemps && state.showLabels;
    const zenithTemp = state.showSubsolarTemp ? formatTemperature(subsolarTempC(declDeg)) : null;
    tempLabels.day.sprite.visible = showTemps && !pin;
    tempLabels.night.sprite.visible = showTemps && !pin;
    tempLabels.pin.sprite.visible = showTemps && !!pin;
    tempLabels.subsolar.sprite.visible = !!zenithTemp && state.showLabels && !state.showSubsolar;
    if (showTemps && pin) {
      // the pinned place, at the hour it is having: the value runs from its night to its day and back
      // as Earth turns under the Sun
      tempLabels.pin.setText(formatTemperature(S.temperatureAtHour(model.temps, pinHourAngle())));
    } else if (showTemps) {
      meridianDirection(dayDirWorld, state.latitudeDeg, true);
      meridianDirection(nightDirWorld, state.latitudeDeg, false);
      tempLabels.day.setText(t(`${KEYS}.labels.dayTemp`, { value: formatTemperature(model.temps.dayC) }));
      tempLabels.night.setText(t(`${KEYS}.labels.nightTemp`, { value: formatTemperature(model.temps.nightC) }));
    }
    if (tempLabels.subsolar.sprite.visible) tempLabels.subsolar.setText(t(`${KEYS}.labels.zenithTemp`, { value: zenithTemp }));

    gridGroup.visible = state.showGrid;
    stopGroup.visible = state.showGrid;
    stopLabels.forEach(({ stop, label }) => label.setText(t(`${KEYS}.stopLabels.${stop.id}`)));
    poleLabels.north.setText(t(`${KEYS}.labels.north`));
    poleLabels.south.setText(t(`${KEYS}.labels.south`));
    const subsolarText = t(`${KEYS}.labels.subsolar`);
    subsolarLabel.setText(zenithTemp ? `${subsolarText} · ${zenithTemp}` : subsolarText);
  }

  /** Camera-dependent bits: hit sphere, drag marker, label offsets, near plane. */
  function updateOverlay() {
    tmpUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const earthDist = Math.max(camera.position.distanceTo(earthPos), 1e-6);
    // the corona draws over everything, so when Earth stands between the camera and the Sun it is faded
    // out by how far behind the limb the Sun sits (the Sun is at the origin)
    tmpCamDir.copy(camera.position).negate(); // camera → Sun
    const toSun = tmpCamDir.length();
    tmpCamDir.divideScalar(Math.max(toSun, 1e-6));
    const along = tmpV.copy(earthPos).sub(camera.position).dot(tmpCamDir); // Earth's centre along that ray
    const miss = along > 0 && along < toSun ? Math.sqrt(Math.max(0, earthPos.distanceToSquared(camera.position) - along * along)) : Infinity;
    sunCorona.material.opacity = CORONA_OPACITY * clamp((miss - EARTH_RADIUS) / (EARTH_RADIUS * 0.12) + 1, 0, 1);
    sunCorona.visible = sunCorona.material.opacity > 0.005;
    earthHit.position.copy(earthPos);
    earthHit.scale.setScalar(Math.max(EARTH_RADIUS * 1.3, earthDist * 0.02));
    dragMarker.position.copy(earthPos);
    dragMarker.scale.setScalar(clamp((EARTH_RADIUS * 2.6) / earthDist, 0.04, 0.5));
    dragMarker.visible = dragging; // hovering only changes the cursor – no ring around Earth
    tmpCamDir.copy(camera.position).sub(earthPos).normalize();
    // the subsolar point is in front of the limb while its direction leans towards the camera by more than
    // the limb's own angle (R / distance): behind it the marker fades out and its label dims like the others
    const facing = sunDir.dot(tmpCamDir) - EARTH_RADIUS / earthDist;
    subsolarMarker.material.opacity = SUBSOLAR_OPACITY * smoothstep(-0.04, 0.08, facing);
    subsolarMarker.visible = state.showSubsolar && subsolarMarker.material.opacity > 0.005;
    subsolarLabel.sprite.position.copy(subsolarMarker.position).addScaledVector(tmpUp, -earthDist * 0.028);
    subsolarLabel.sprite.material.opacity = farSideOpacity(sunDir);
    if (tempLabels.day.sprite.visible || tempLabels.pin.sprite.visible) {
      if (pin) {
        // above the pin's head, on the direction the marker itself stands on
        placeTempLabel(tempLabels.pin, pinMarker.getWorldPosition(tmpPinDir).sub(earthPos).normalize(), 0.05, earthDist);
      } else {
        placeTempLabel(tempLabels.day, dayDirWorld, 0.035, earthDist);
        placeTempLabel(tempLabels.night, nightDirWorld, -0.058, earthDist);
      }
    }
    if (tempLabels.subsolar.sprite.visible) {
      tempLabels.subsolar.sprite.position.copy(subsolarMarker.position).addScaledVector(tmpUp, -earthDist * 0.028);
      tempLabels.subsolar.sprite.material.opacity = farSideOpacity(sunDir);
    }
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

  /**
   * Puts a temperature label on the surface point it describes, lifted along screen-up by `up` (a
   * fraction of the camera's distance, so the offset holds at any zoom): the day value above its
   * point, the night value further below, where it clears the sun ray label. The labels draw over
   * everything, so the one on Earth's far side is dimmed instead of hidden: it is still the
   * temperature of the side turned away, and it stays readable while the planet turns.
   */
  function placeTempLabel(label, dir, up, earthDist) {
    label.sprite.position
      .copy(earthPos)
      .addScaledVector(dir, EARTH_RADIUS * 1.04)
      .addScaledVector(tmpUp, up * earthDist);
    label.sprite.material.opacity = farSideOpacity(dir);
  }

  /** Opacity of a label standing on the surface point in direction `dir`: full on the near side, dimmed – never hidden – on the far side (tmpCamDir must be current). */
  function farSideOpacity(dir) {
    return 0.35 + 0.65 * clamp((dir.dot(tmpCamDir) + 0.2) / 0.4, 0, 1);
  }

  function refresh() {
    model = derive();
    updateScene();
    if (sim.reducedMotion || sim.paused || !surfaceVis.ready) syncSurface(null); // no frames run to ease it, so snap
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
      syncEarthGestures();
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
    syncEarthGestures();
  }
  /** Fly to a camera view and keep the panel – its preset row and its header button – in step. */
  function setCamera(id, { announce = false } = {}) {
    cameraPresets[id]?.();
    syncCameraButtons({ announce });
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
  let hintAction = null; // the second half of the hint line under the canvas – it names the gestures Earth answers to
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
  /**
   * Dragging Earth along its orbit belongs to the views that look at the whole orbit. The two
   * close-ups leave the gesture alone: in the Earth camera it is how one turns the camera around the
   * planet, and while the camera rides on a pinned place the drag would pull that place out from
   * under it. In both only the click – pin a place – stays Earth's.
   */
  const canDragOrbit = () => state.cameraMode !== 'earth' && state.cameraMode !== 'pin';
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
    if (!canDragOrbit()) return; // Earth camera: let the drag rotate the view, the click still pins
    controls.enabled = false; // registered in the capture phase, so OrbitControls sees `enabled === false`
    canvas.setPointerCapture?.(e.pointerId);
    e.stopPropagation();
  };
  const onPointerMove = (e) => {
    if (pressing && !dragging && canDragOrbit() && pressTravelPx(e) > CLICK_THRESHOLD_PX) {
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
      setEarthCursor(over); // cursor only – nothing in the scene changes
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
      // in the Earth camera the press may have rotated the view instead – that is not a click
      if (e?.type === 'pointerup' && pressTravelPx(e) <= CLICK_THRESHOLD_PX) {
        const point = pickSurface(e);
        if (point) setPin(point);
        else if (pin) unpin(); // inside the enlarged hit sphere but past the surface
      }
    } else if (following) {
      // catch up with Earth: same offset, rotated by the angle Earth moved during the drag
      followOffset.copy(camera.position).sub(controls.target);
      rotateY(followOffset, model.orbitAngleRad - (lastFollowAngle ?? model.orbitAngleRad));
      tweenCamera(earthPos.clone().add(followOffset), earthPos.clone(), { duration: 0.6, follow: true });
    }
    updateOverlay();
    sim.requestRender();
  };
  /** Over Earth: grab where dragging moves it along the orbit, pointer where only the pin is left. */
  function setEarthCursor(over) {
    canvas.classList.toggle('is-grab', over && canDragOrbit());
    canvas.classList.toggle('is-pin', over && !canDragOrbit());
  }
  /** Keeps the cursor and the hint line in step with what Earth currently answers to. */
  function syncEarthGestures() {
    setEarthCursor(hovering);
    if (hintAction) bindText(hintAction, canDragOrbit() ? `${KEYS}.hint` : `${KEYS}.hintNoDrag`);
  }
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
    earthMaterial.uniforms.uTime.value += dt;
    syncSurface(dt);
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
  const panel = createPanel({
    onToggle: () => viewShift.sync(),
    onReset: resetAll,
    camera: { views: CAMERA_VIEWS, onSelect: (id) => setCamera(id) },
  });
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
  const tiltRow = createControlRow(tiltSlider, createResetButton({ onClick: () => setTilt(DEFAULTS.tiltDeg) }));

  const moreControls = createCollapsibleSection({ titleKey: `${KEYS}.sections.more`, open: false });

  const periodSlider = createSlider({
    labelKey: `${KEYS}.controls.rotationPeriod`,
    min: Math.log10(S.ROTATION_RANGE_H.min),
    max: Math.log10(S.ROTATION_RANGE_H.max),
    step: 0.002,
    value: Math.log10(state.periodH),
    format: (v) => `${fmt(Math.pow(10, v), Math.pow(10, v) < 10 ? 1 : 0)}\u2009${t('units.hours')}`,
    onChange: (v) => setPeriod(Math.round(Math.pow(10, v) * 10) / 10, { fromSlider: true }),
  });
  const periodRow = createControlRow(periodSlider, createResetButton({ onClick: () => setPeriod(DEFAULTS.periodH) }));
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
  const speedRow = createControlRow(speedSlider, createResetButton({
    onClick: () => {
      state.daysPerSecond = DEFAULTS.daysPerSecond;
      speedSlider.setValue(state.daysPerSecond, { silent: true });
    },
  }));

  // which latitude the readout describes – the slider and its four presets pick it
  const latitudeSlider = createSlider({
    labelKey: `${KEYS}.controls.latitude`,
    min: -90,
    max: 90,
    step: 0.5,
    value: state.latitudeDeg,
    format: (v) => formatLatitude(v, 1),
    onChange: (v) => setLatitude(v, { fromSlider: true }),
  });
  const latitudeSliderRow = createControlRow(latitudeSlider, createResetButton({ onClick: () => setLatitude(DEFAULTS.latitudeDeg) }));
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

  const view = createViewToggles({ state, prefs: viewPrefs, defaults: VIEW_DEFAULTS, onChange: refresh });
  const viewToggle = (name, labelKey, onChange = refresh) => view.toggle(name, labelKey, onChange);
  // the two colour overlays share the hue ramp but mean different things (W/m² vs °C) – only one at a time
  const toggles = {
    showSurface: viewToggle('showSurface', `${KEYS}.view.surface`),
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
    showTemps: viewToggle('showTemps', `${KEYS}.view.temps`),
    showSubsolarTemp: viewToggle('showSubsolarTemp', `${KEYS}.view.subsolarTemp`),
    showGrid: viewToggle('showGrid', `${KEYS}.view.grid`),
    showLabels: viewToggle('showLabels', `${KEYS}.view.labels`),
  };
  const heatLegend = createHeatLegend(`${KEYS}.legend.heatTitle`, `${KEYS}.legend.heatLow`, `${KEYS}.legend.heatHigh`);
  heatLegend.el.hidden = !state.showHeat;
  const climateLegend = createHeatLegend(`${KEYS}.legend.climateTitle`, `${KEYS}.legend.climateLow`, `${KEYS}.legend.climateHigh`);
  climateLegend.el.hidden = !state.showClimate;
  const cameraRow = el('div', 'lp-presets lp-presets--2 lp-presets--compact', { role: 'group' });
  bindAttr(cameraRow, { 'aria-label': `${KEYS}.controls.camera` });
  const cameraButtons = [...CAMERA_VIEWS, PIN_VIEW].map(({ id, labelKey, icon }) => {
    const btn = createButton({ labelKey, icon, onClick: () => setCamera(id) });
    btn.el.classList.add('lp-presets__btn');
    cameraRow.append(btn.el);
    return { id, el: btn.el };
  });
  function syncCameraButtons({ announce = false } = {}) {
    for (const { id, el: btn } of cameraButtons) {
      btn.setAttribute('aria-pressed', String(state.cameraMode === id));
      if (id === 'pin') btn.disabled = !pin;
    }
    panel.setCameraView(state.cameraMode, { announce });
  }

  /** The panel header's reset: the simulation's parameters and the display toggles alike. */
  function resetAll() {
    unpin({ restoreCamera: false });
    Object.assign(state, DEFAULTS, { activePreset: 'earth' });
    view.reset();
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
  }

  moreControls.add(periodRow, presetsTitle, presetRow, presetNote,
    bindText(el('p', 'lp-subheading'), `${KEYS}.sections.orbit`), dayRow, stopRow, speedRow,
    bindText(el('p', 'lp-subheading'), `${KEYS}.sections.readout`), latitudeSliderRow, latitudeRow);
  if (sim.reducedMotion) moreControls.add(createNotice({ textKey: 'motion.reducedNotice' }));
  moreControls.add(
    bindText(el('p', 'lp-subheading'), `${KEYS}.sections.view`), cameraRow,
    toggles.showSurface, toggles.showHeat, heatLegend, toggles.showClimate, climateLegend, toggles.showLivable,
    toggles.showTerminator, toggles.showEquator, toggles.showCircles, toggles.showAxis, toggles.showSubsolar,
    toggles.showTemps, toggles.showSubsolarTemp, toggles.showGrid, toggles.showLabels,
  );

  // --- readouts: one verdict box, then every number in one table --------------------------------------
  // the box carries the year-round livable share of the surface with its verdict, and under it what the
  // chosen latitude makes of that tilt: its climate zone and whether it is livable all year round
  const habReadout = createReadout(`${KEYS}.readout.livableSurface`);
  habReadout.el.classList.add('lp-readout--zone');
  const habState = el('span', 'lp-state', { role: 'status' });
  const habHint = el('p', 'lp-state__hint');
  const zoneRow = el('div', 'lp-zone');
  const zonePill = el('span', 'lp-state', { role: 'status' });
  const zoneHint = el('p', 'lp-state__hint');
  zoneRow.append(bindText(el('span', 'lp-zone__label'), `${KEYS}.readout.zone`), zonePill, zoneHint);
  const livableRow = el('div', 'lp-zone');
  const livablePill = el('span', 'lp-state', { role: 'status' });
  livableRow.append(bindText(el('span', 'lp-zone__label'), `${KEYS}.readout.livableYearRound`), livablePill);
  habReadout.el.append(habState, habHint, zoneRow, livableRow);

  // every figure in one listing: what the year does to the planet first, then the chosen latitude
  const facts = createFacts([
    ['season', `${KEYS}.readout.season`],
    ['subsolar', `${KEYS}.readout.subsolar`],
    ['tropics', `${KEYS}.readout.tropics`],
    ['polarCircles', `${KEYS}.readout.polarCircles`],
    ['pinned', `${KEYS}.readout.pinned`],
    ['dayLength', `${KEYS}.readout.dayLength`],
    ['midnightSun', `${KEYS}.readout.midnightSun`],
    ['polarNight', `${KEYS}.readout.polarNightDays`],
    ['insolation', `${KEYS}.readout.insolation`],
    ['temperature', `${KEYS}.readout.temperature`],
    ['dayNight', `${KEYS}.readout.dayNight`],
    ['seasonalMeans', `${KEYS}.readout.seasonalMeans`],
  ]);
  // two rows carry more than a number: the pinned place its release button, the day length its polar tag
  const pinValue = el('span');
  const unpinBtn = createButton({ labelKey: `${KEYS}.pin.unpin`, icon: '✕', compact: true, onClick: () => unpin() });
  facts.cell('pinned').classList.add('lp-facts__cell');
  facts.cell('pinned').append(pinValue, unpinBtn.el);
  const dayValue = el('span');
  const dayTag = el('span', 'lp-state lp-state--inline', { role: 'status', hidden: true });
  facts.cell('dayLength').classList.add('lp-facts__cell');
  facts.cell('dayLength').append(dayValue, dayTag);
  const pinHint = bindText(el('p', 'lp-section__note'), `${KEYS}.pin.hint`);

  const legend = createLegend();

  const infoCard = createInfoCard({ titleKey: `${KEYS}.info.title`, bodyKey: `${KEYS}.info.body`, open: !isSmallScreen });
  const physicsCard = createPhysicsCard();
  panel.add(
    tiltRow, moreControls,
    habReadout, facts, pinHint,
    legend, infoCard, physicsCard,
  );
  container.append(panel.el);
  viewShift.attach(panel);
  disposers.push(viewShift.dispose);

  const hint = el('div', 'lp-sim__hint', { 'aria-hidden': 'true' });
  hintAction = el('span');
  hint.append(bindText(el('span'), 'panel.hint'), document.createTextNode(' · '), hintAction);
  syncEarthGestures();
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
    facts.set('season', noSeasons ? t(`${KEYS}.readout.noSeasons`) : t(`${KEYS}.readout.seasonLine`, { north: t(`${KEYS}.seasons.${season.north}`), south: t(`${KEYS}.seasons.${season.south}`) }));
    facts.set('subsolar', formatLatitude(declDeg, 1));
    facts.set('tropics', noSeasons ? t(`${KEYS}.readout.none`) : t(`${KEYS}.readout.plusMinus`, { n: fmt(state.tiltDeg, 1) }));
    facts.set('polarCircles', noSeasons ? t(`${KEYS}.readout.none`) : t(`${KEYS}.readout.plusMinus`, { n: fmt(90 - state.tiltDeg, 1) }));

    dayValue.textContent = formatDuration(dayLengthH);
    const polarTag = fraction >= 1 - 1e-6 ? 'polarDay' : fraction <= 1e-6 ? 'polarNight' : null;
    dayTag.hidden = !polarTag;
    if (polarTag) {
      dayTag.textContent = t(`${KEYS}.readout.${polarTag}`);
      dayTag.className = `lp-state lp-state--inline lp-state--${polarTag === 'polarDay' ? 'scorched' : 'frozen'}`;
    }
    const daysText = (n) => (n > 0 ? t(`${KEYS}.readout.${n === 1 ? 'day' : 'days'}`, { n: fmt(n, 0) }) : t(`${KEYS}.readout.none`));
    facts.set('midnightSun', daysText(polar.midnightSun));
    facts.set('polarNight', daysText(polar.polarNight));
    facts.set('insolation', `${fmt(temps.insolation, 0)} ${t('units.wattsPerSquareMeter')}`);
    facts.set('temperature', `≈ ${formatTemperature(temps.meanC)}`);
    facts.set('dayNight', `${formatTemperature(temps.dayC)} / ${formatTemperature(temps.nightC)}`);
    facts.set('seasonalMeans', `${formatTemperature(extremes.summerC)} / ${formatTemperature(extremes.winterC)}`);
    zonePill.textContent = t(`${KEYS}.readout.zones.${zone}`);
    zonePill.className = `lp-state lp-state--zone-${zone}`;
    zoneHint.textContent = t(`${KEYS}.readout.zoneHints.${zone}`);
    livablePill.textContent = t(`${KEYS}.pin.${livable ? 'livable' : 'notLivable'}`);
    livablePill.className = `lp-state lp-state--${livable ? 'habitable' : 'scorched'}`;

    // the pinned place is one row of the table: where it is. Its season, its temperature and whether it
    // is livable are the rows and the box around it – the readout follows the pin's latitude
    unpinBtn.el.hidden = !pin;
    pinHint.hidden = !!pin;
    pinValue.textContent = pin ? formatLatitude(state.latitudeDeg, 1) : '–';
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
    window.__lpAxialTilt = { sim, state, get model() { return model; }, get pin() { return pin; }, get pinHourAngle() { return pin ? pinHourAngle() : null; }, get habitability() { return habitability; }, get surface() { return { target: surfaceTarget, vis: surfaceVis }; }, setTilt, setPeriod, setDayOfYear, setLatitude, setPlaying, applyPreset, setPin, unpin, cameraPresets, frame, refresh, presets: S.WHAT_IF_PRESETS };
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
    Object.values(tempLabels).forEach((label) => label.dispose());
    glowTexture.dispose();
    placeholder.dispose();
    nightPlaceholder.dispose();
    climateTexture.dispose();
    surfaceTexture.dispose();
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
  // --wrap: the labels are long enough to overflow a 340 px panel if they were sized to fit
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
    /** The value cell of a row – for the few that carry a pill or a button beside their text. */
    cell(id) {
      return values.get(id);
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
    item(`${KEYS}.legend.dayTemp`, COLORS.dayTemp),
    item(`${KEYS}.legend.nightTemp`, COLORS.nightTemp),
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
  const entries = ['declination', 'dayLength', 'insolation', 'temperature', 'surface', 'swing', 'seasonalMeans', 'livable', 'livableFraction', 'tiers'];
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
const FADE = C.OVERLAY_FADE; // overlay opacity fade, shared with climate.js
const SURF = C.SURFACE; // surface-condition ramps, shared with climate.js
const glslFloat = (v) => v.toFixed(4);
const coldRamp = (ramp) => `(1.0 - smoothstep(${glslFloat(ramp.fullC)}, ${glslFloat(ramp.onsetC)}, tC))`; // edges must ascend in GLSL
const hotRamp = (ramp) => `smoothstep(${glslFloat(ramp.onsetC)}, ${glslFloat(ramp.fullC)}, tC)`;

/**
 * The day map has no land under the ice it paints, so the two ice-covered lands of the far north are
 * outlined here as coarse coastline polygons in (longitude, latitude) degrees – Greenland, and the
 * Canadian Arctic islands – and everything else the map paints white north of ~70° is the Arctic Ocean
 * (in the far south it is all Antarctica). Padded ~0.3° outwards so the coast itself stays inside.
 */
const ICE_LANDS = Object.freeze({
  greenland: [[-43.5, 59.3], [-50.5, 63], [-53.5, 67], [-55.5, 71], [-58.5, 75.5], [-70.5, 76.3], [-73.5, 78.5], [-68.5, 80.7], [-60, 82.5], [-45, 83.5], [-33, 84.0], [-20, 83.2], [-11, 81.7], [-16.5, 79], [-17.5, 75], [-20.5, 70.5], [-24.5, 68.3], [-32, 66.2], [-40, 64.2], [-42, 61]],
  canadianArctic: [[-128.5, 69.5], [-125.5, 74], [-122.5, 77.8], [-112, 79.3], [-100, 79.8], [-92, 81.8], [-80, 83.4], [-61.5, 82.6], [-59.5, 78], [-64, 75.5], [-61, 67], [-70, 63.5], [-82, 63.5], [-95, 67], [-115, 68]],
});
const lonLatToUv = ([lon, lat]) => `vec2(${glslFloat((lon + 180) / 360)}, ${glslFloat((lat + 90) / 180)})`;
/** GLSL: `float <name>(vec2 uv)` – 1 inside the polygon (even–odd rule), 0 outside. */
const glslPolygon = (name, points) => `
  float ${name}(vec2 uv) {
    const int n = ${points.length};
    vec2 poly[${points.length}] = vec2[${points.length}](${points.map(lonLatToUv).join(', ')});
    bool inside = false;
    for (int i = 0, j = n - 1; i < n; j = i++) {
      vec2 a = poly[i];
      vec2 b = poly[j];
      if ((a.y > uv.y) != (b.y > uv.y) && uv.x < (b.x - a.x) * (uv.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside ? 1.0 : 0.0;
  }`;

/** Value noise for the surface – the same construction the habitable-zone and magnetosphere shaders use. */
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

const EARTH_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vLocal;
  varying float vSinLat;
  void main() {
    vUv = uv;
    vLocal = position; // object space: the sphere spins about its local y axis, so the noise rides with the map
    vSinLat = normal.y; // … and y = sin(latitude)
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

/**
 * Earth's surface. The day map is first taken through the climate of the moment – per latitude, from
 * the surface texture's seasonal mean, on the ramps of C.SURFACE: the ice the map itself paints melts
 * off Greenland, Antarctica and the Arctic where the annual mean has climbed above freezing for good
 * (the map has no land under its ice, so Greenland and the Canadian islands are told from the Arctic
 * Ocean by coarse coastline polygons), the land loses its green for the cold season, goes to sand in the heat,
 * the shallow seas fall dry to brine and salt in a high-tilt polar summer, and snow and sea ice with
 * leads settle over everything cold, thick and blue-white where the ice is permanent, and beyond the
 * livable limit the dead land bakes to red earth, cracks and salt flats under dust storms while the hot
 * seas disappear under a moist-greenhouse cloud deck. Ice is always a layer over the world that is
 * there, never a swap. The
 * latitude the texture is read at is jittered by noise, so every front is ragged and the same way
 * ragged – a locally colder spot is both snowier and browner. Then the Sun lights it with a soft
 * terminator, the optional heat / temperature-band overlays and the livable darkening paint over
 * it, blowing snow and steam drift over ice and hot sea, the city lights come up on the night side
 * only where the latitude is livable all year, the open water glints, and the rim glows.
 */
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
  uniform sampler2D uSurfTex;    // 1 × N rows: R seasonal mean (encoded), G permanent ice, B city lights, A annual mean (encoded)
  uniform float uSurfaceMix;     // 1 = paint the surface conditions
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vLocal;
  varying float vSinLat;
  const float PI = 3.141592653589793;
  ${NOISE_GLSL}
  // palette in linear RGB
  const vec3 SOIL_DARK = vec3(0.16, 0.11, 0.06);
  const vec3 SOIL_PALE = vec3(0.36, 0.25, 0.12);
  const vec3 DORMANT = vec3(0.30, 0.22, 0.10);
  const vec3 SAND = vec3(0.55, 0.44, 0.26);
  const vec3 ICE = vec3(0.80, 0.86, 0.92);
  const vec3 ICE_SHADE = vec3(0.45, 0.58, 0.72);
  const vec3 SEA_ICE = vec3(0.60, 0.72, 0.84);
  const vec3 SEA_ICE_DARK = vec3(0.40, 0.54, 0.70);
  const vec3 LEAD = vec3(0.04, 0.09, 0.18);
  const vec3 HOT_BRINE = vec3(0.03, 0.09, 0.09); // murky teal of a hot, dead sea
  const vec3 BLEACH = vec3(0.68, 0.58, 0.40);    // parched: bleached sand
  const vec3 OCHRE = vec3(0.50, 0.32, 0.12);     // parched: ochre soil
  const vec3 BAKED = vec3(0.30, 0.12, 0.06);     // scorched: dark red-brown baked earth
  const vec3 PLAYA = vec3(0.70, 0.62, 0.50);     // scorched: bleached pale playa
  const vec3 CRACK = vec3(0.09, 0.05, 0.03);     // desiccation cracks
  const vec3 CRUST = vec3(0.88, 0.86, 0.80);     // salt crust in the basins
  const vec3 DECK = vec3(0.92, 0.90, 0.86);      // the moist-greenhouse cloud deck over hot seas
  const vec3 DUST = vec3(0.72, 0.52, 0.28);      // dust veil over baked land
  const vec3 RIM_COOL = vec3(0.25, 0.50, 1.00);
  const vec3 RIM_HOT = vec3(1.00, 0.80, 0.55);
  const vec3 SEABED = vec3(0.075, 0.058, 0.042);
  const vec3 SEABED_PALE = vec3(0.26, 0.20, 0.13);
  const vec3 SALT = vec3(0.72, 0.68, 0.60);
  const vec3 OCEAN = vec3(0.013, 0.045, 0.18); // the map's own deep water, for a thawed Arctic
  const vec3 ROCK = vec3(0.20, 0.18, 0.15);    // bedrock under a melted ice sheet
  const vec3 TUNDRA = vec3(0.22, 0.27, 0.11);  // … greening once the year is warm enough
  // where the map paints ice in the far north it is the Arctic Ocean, except inside the coastlines of
  // Greenland and the Canadian Arctic islands (ICE_LANDS) – in the far south it is Antarctica
  ${glslPolygon('inGreenland', ICE_LANDS.greenland)}
  ${glslPolygon('inCanadianArctic', ICE_LANDS.canadianArctic)}

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

  // Overlay strength for a position on that ramp – mirrors C.overlayAlpha(): the middle of the
  // ramp, where a place lives the temperatures today's Earth has, is only tinted; the frozen and
  // scorching ends paint at full strength. (Edges ascend: GLSL smoothstep needs edge0 < edge1.)
  float overlayAlpha(float x) {
    float cold = 1.0 - smoothstep(${glslFloat(FADE.danger[0])}, ${glslFloat(FADE.comfort[0])}, x);
    float hot = smoothstep(${glslFloat(FADE.comfort[1])}, ${glslFloat(FADE.danger[1])}, x);
    return ${glslFloat(FADE.minAlpha)} + ${glslFloat(1 - FADE.minAlpha)} * max(cold, hot);
  }

  void main() {
    vec3 p = normalize(vLocal);
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunPos - vWorldPos);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float ndl = dot(N, L);
    float day = smoothstep(-0.03, 0.10, ndl);
    vec3 base = texture2D(uMap, vUv).rgb;
    float sinLat = clamp(vSinLat, -1.0, 1.0);
    float lat = asin(sinLat);
    float v = lat / PI + 0.5; // texture row of this latitude (row 0 = south pole)

    // daily mean insolation at this latitude (fraction of the solar constant)
    float cosLat = cos(lat);
    float sd = sin(uDecl);
    float cd = cos(uDecl);
    float cosH0 = clamp(-(sinLat * sd) / max(cosLat * cd, 1e-4), -1.0, 1.0);
    float H0 = acos(cosH0);
    float q = (H0 * sinLat * sd + cosLat * cd * sin(H0)) / PI;

    // --- the surface of the moment -------------------------------------------------------------
    // what the map shows: land is where blue does not dominate, the paler blues are the shelves,
    // green is the vegetation, brightness a stand-in for relief
    float land = 1.0 - smoothstep(0.15, 0.5, (base.b - max(base.r, base.g)) / (base.b + 0.002));
    float lum = dot(base, vec3(0.333));
    float shelf = smoothstep(0.10, 0.34, lum) * (1.0 - land);
    float green = clamp((base.g - max(base.r, base.b)) * 5.0, 0.0, 1.0);
    float relief = clamp(lum * 4.0, 0.0, 1.0);
    float detail = fbm(p * 6.5 + vec3(7.0), 4);
    // the climate is read at a latitude the noise pushes about ±4.5° – that makes every front ragged,
    // and ragged the same way – with a little local weather (±2 K) inside the fronts
    float jitter = (fbm(p * 3.4 + vec3(17.0, 2.0, 41.0), 4) - 0.5) * 0.05;
    vec4 s = texture2D(uSurfTex, vec2(0.5, clamp(v + jitter, 0.0, 1.0)));
    float tC = s.r * ${glslFloat(SURF.tempRangeC.max - SURF.tempRangeC.min)} + ${glslFloat(SURF.tempRangeC.min)} + (detail - 0.5) * 4.0;
    float annualC = s.a * ${glslFloat(SURF.tempRangeC.max - SURF.tempRangeC.min)} + ${glslFloat(SURF.tempRangeC.min)};
    float permIce = s.g;
    float lights = s.b;
    // the ramps of C.surfaceState(), mirrored
    float thaw = smoothstep(${glslFloat(SURF.thaw.onsetC)}, ${glslFloat(SURF.thaw.fullC)}, annualC);
    float dormant = ${coldRamp(SURF.dormant)};
    float snow = max(${coldRamp(SURF.snow)}, permIce);
    // the pack closes just under freezing once the Sun no longer rises (C.seaIceDarkness / seaIceFullC)
    float darkness = 1.0 - smoothstep(0.0, ${glslFloat(SURF.seaIce.darkBelowWm2 / S.SOLAR_CONSTANT_W_M2)}, q);
    float seaIceFull = mix(${glslFloat(SURF.seaIce.fullC)}, ${glslFloat(SURF.seaIce.darkFullC)}, darkness);
    float seaIce = max(1.0 - smoothstep(seaIceFull, ${glslFloat(SURF.seaIce.onsetC)}, tC), permIce);
    float parch = ${hotRamp(SURF.parch)};
    float scorch = ${hotRamp(SURF.scorch)};
    float dry = ${hotRamp(SURF.dry)};
    float hotAir = max(scorch, dry); // 0 on today's Earth (its seasonal means top out near 27 °C)

    // 0. the ice the map itself paints melts away where the year has turned warm for good: the Arctic to open
    //    water, Greenland and Antarctica to bedrock that greens into tundra as the annual mean climbs. In the
    //    polar zone a map pixel is ice when it is bright and cool-tinted (blue ≥ red): that takes the white, the
    //    pale-blue rim and the texels the ice edge blends with the sea, and leaves tundra, rock and sand alone.
    //    Sea ice is only looked for north of ~70°, so the glaciers of Iceland, Alaska and Scandinavia stay.
    float north = step(0.0, p.y);
    float landBox = max(inGreenland(vUv), inCanadianArctic(vUv));
    float iceLand = mix(1.0, landBox, north);
    float polarGate = smoothstep(0.82, 0.88, abs(p.y));
    float seaGate = smoothstep(0.90, 0.95, p.y);
    float gate = mix(polarGate, mix(seaGate, polarGate, landBox), north);
    float cool = smoothstep(-0.06, 0.0, base.b - base.r);
    float mapIce = smoothstep(0.12, 0.45, lum) * cool * gate;
    shelf *= 1.0 - mapIce; // the pale rim of the map's ice is ice, not shallow water
    float melted = mapIce * thaw;
    float warm = smoothstep(2.0, 15.0, annualC);
    vec3 thawed = mix(OCEAN, mix(ROCK, TUNDRA, warm * (0.6 + 0.4 * detail)) * (0.8 + 0.4 * detail), iceLand);
    vec3 ground = mix(base, thawed, melted);
    land = mix(land, iceLand, melted);
    green = max(green, 0.5 * warm * melted * iceLand);
    relief = mix(relief, 0.5, melted);

    // 1. vegetation: brown for the cold season, sand where it is scorched – land only, most where the map is green
    vec3 soil = mix(SOIL_DARK, SOIL_PALE, smoothstep(0.3, 0.75, detail));
    ground = mix(ground, mix(ground * vec3(0.9, 0.7, 0.45), DORMANT, 0.5), dormant * land * (0.3 + 0.7 * green));
    vec3 parched = mix(OCHRE, BLEACH, smoothstep(0.3, 0.75, detail)) * (0.85 + 0.3 * relief);
    ground = mix(ground, parched, parch * land * (0.55 + 0.45 * green));

    // 1b. beyond the livable limit the dead land bakes: dark red earth and bleached playas by relief, salt
    //     crusts collecting in the low ground, and hairline cracks opening as it dries out
    if (scorch > 0.001) {
      float crackField = fbm(p * 30.0 + vec3(3.0, 11.0, 5.0), 3);
      float cracks = pow(1.0 - abs(crackField * 2.0 - 1.0), 14.0) * 0.6; // a fine fissure texture, not drawn borders
      float lowGround = smoothstep(0.55, 0.75, fbm(p * 2.3 + vec3(23.0, 7.0, 3.0), 3)) * (1.0 - 0.6 * relief);
      vec3 baked = mix(BAKED, PLAYA, smoothstep(0.35, 0.80, detail) * (0.35 + 0.65 * relief));
      baked = mix(baked, CRUST, lowGround * smoothstep(0.3, 1.0, scorch) * 0.8);
      baked = mix(baked, CRACK, cracks * 0.7 * smoothstep(0.2, 0.8, scorch));
      ground = mix(ground, baked * (0.85 + 0.3 * detail), scorch * land);
    }

    // 2. hot seas: the water darkens to a murky brine, the shelves fall dry first, the deep basins only half –
    //    one summer cannot evaporate an ocean – with salt where the last water stood
    float dried = 0.0;
    if (dry > 0.001) {
      float basin = smoothstep(0.42, 0.62, fbm(p * 1.7 + vec3(19.0, 4.0, 27.0), 4)) * (1.0 - shelf);
      float pans = smoothstep(0.58, 0.72, fbm(p * 11.0 + vec3(13.0, 2.0, 6.0), 3)) * (0.35 + 0.65 * basin);
      float shelfDry = smoothstep(0.15, 0.7, dry) * shelf;
      float deepDry = smoothstep(0.5, 1.0, dry) * basin * 0.5;
      dried = clamp(shelfDry + deepDry, 0.0, 1.0) * (1.0 - land);
      vec3 brine = mix(ground, HOT_BRINE, 0.75 * dry);
      vec3 seabed = mix(mix(SEABED, SEABED_PALE, shelf) * (0.8 + 0.4 * detail), mix(SALT, CRUST, smoothstep(0.6, 1.0, dry)), pans * 0.7);
      ground = mix(ground, mix(brine, seabed, dried), (1.0 - land) * max(dried, 0.6 * dry));
    }

    // 3. ice over everything: sea ice criss-crossed by leads that close under permanent ice, snow on the
    //    land – patchy at the front, complete when deep – and a blue cast where the ice is old and thick
    float iceAny = max(snow, seaIce);
    vec3 conditioned = ground;
    if (iceAny > 0.001) {
      float leadField = fbm(p * 7.0 + vec3(21.0, 3.0, 8.0), 4);
      float leads = pow(1.0 - abs(leadField * 2.0 - 1.0), 18.0) * (1.0 - permIce * 0.7);
      vec3 seaIceCol = mix(SEA_ICE, SEA_ICE_DARK, smoothstep(0.4, 0.7, fbm(p * 3.5 + vec3(9.0), 3)) * 0.6);
      float pack = seaIce * mix(0.78, 1.0, permIce) * (1.0 - leads * 0.85);
      vec3 icedSea = mix(mix(ground, LEAD, leads * 0.5 * seaIce), seaIceCol, pack);
      float cover = clamp(snow * (0.7 + 0.3 * relief) + (snow - 0.5) * (detail - 0.5) * 0.6, 0.0, 1.0);
      vec3 snowy = mix(ground, mix(ICE_SHADE, ICE, 0.45 + 0.55 * relief), cover);
      conditioned = mix(icedSea, snowy, land);
      conditioned = mix(conditioned, vec3(0.62, 0.74, 0.92), permIce * 0.25);
    }

    // 4. the air over the extremes: a dense convective cloud deck builds over the hot seas – the ocean going
    //    into the air – and the baked land throws up dust, in storm cells and zonal streaks, thickest at the
    //    limb. Part of the surface stack, so the Sun lights it and the overlays paint over it like the rest.
    float fog = 0.0;
    float dust = 0.0;
    if (hotAir > 0.001) {
      float bank = fbm(p * 2.2 + vec3(uTime * 0.05, uTime * 0.02, 5.0), 4);
      float wisp = fbm(p * 6.0 + vec3(uTime * 0.18, -uTime * 0.10, 9.0), 3);
      float field = 0.7 * bank + 0.3 * wisp;
      float threshold = mix(0.60, 0.32, dry); // the hotter the sea, the more of the sky it covers
      fog = smoothstep(threshold, threshold + 0.26, field) * smoothstep(0.0, 0.5, dry);
      fog = max(fog, 0.35 * smoothstep(0.6, 1.0, dry)); // by 80 °C most of the sea lies under cloud, with gaps
      fog *= smoothstep(0.7, 0.2, land); // the deck spills a little over the coasts
      vec3 deck = DECK * (0.70 + 0.45 * smoothstep(0.3, 0.8, bank)) * (0.9 + 0.2 * wisp); // towers lit, bases shaded
      float storm = fbm(p * 3.0 + vec3(uTime * 0.12, 0.0, uTime * 0.05), 3);
      float streaks = smoothstep(0.50, 0.75, fbm(vec3(p.x, p.y * 4.5, p.z) * 3.2 + vec3(uTime * 0.30, 0.0, 0.0), 3));
      float limb = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 1.5);
      dust = (0.10 + 0.35 * smoothstep(0.45, 0.8, storm) + 0.22 * streaks) * scorch * smoothstep(0.3, 0.8, land);
      dust = clamp(dust + 0.35 * limb * scorch, 0.0, 0.55);
      conditioned = mix(conditioned, DUST * (0.9 + 0.2 * storm), dust);
      conditioned = mix(conditioned, deck, fog * 0.92);
    }
    vec3 surf = mix(base, conditioned, uSurfaceMix);

    // --- lighting ---------------------------------------------------------------------------------------
    vec3 dayColor = surf * (0.10 + 1.05 * clamp(ndl, 0.0, 1.0));
    vec3 nightColor = surf * vec3(0.030, 0.040, 0.075);
    vec3 color = mix(nightColor, dayColor, day);

    // the insolation heat map
    float heatT = clamp(q / uHeatScale, 0.0, 1.0);
    vec3 heat = ramp(heatT) * (0.35 + 0.65 * day);
    color = mix(color, heat, uHeatMix * 0.88 * overlayAlpha(heatT));

    // seasonal-mean temperature bands (energy-balance model, −40 … +60 °C ramp);
    // alpha carries the overlay strength for that temperature (climate.js)
    vec4 bandTex = texture2D(uClimateTex, vec2(0.5, v));
    vec3 band = bandTex.rgb * (0.35 + 0.65 * day);
    color = mix(color, band, uClimateMix * 0.7 * bandTex.a);

    // livable-region view: darken every latitude outside the livable bands
    float livable = 0.0;
    for (int i = 0; i < 4; i++) {
      if (i < uBandCount) livable = max(livable, step(uBands[i].x, lat) * step(lat, uBands[i].y));
    }
    color *= 1.0 - uLivableMix * (1.0 - livable) * 0.6;

    // blowing snow over the ice
    if (iceAny * uSurfaceMix > 0.001) {
      float gust = smoothstep(0.55, 0.8, fbm(p * 5.0 + vec3(uTime * 0.25, uTime * 0.12, 0.0), 3));
      color += vec3(0.92, 0.95, 1.0) * gust * iceAny * 0.22 * (0.2 + 0.8 * day) * uSurfaceMix;
    }

    // city lights, fading in across the terminator – only where the latitude is livable all year
    color += texture2D(uNightMap, vUv).rgb * (1.0 - day) * 1.6 * mix(1.0, lights, uSurfaceMix);

    // glints: the Sun on open water – a bright core in a soft halo, as the waves spread it – a little on sea ice, none on dry sea floor
    vec3 H = normalize(L + V);
    float open = (1.0 - land) * (1.0 - seaIce) * (1.0 - dried) * (1.0 - fog);
    float ndh = clamp(dot(N, H), 0.0, 1.0);
    float spec = (0.55 * pow(ndh, 260.0) + 0.10 * pow(ndh, 24.0)) * step(0.0, ndl) * (1.0 - dust);
    color += vec3(1.0, 0.95, 0.85) * spec * uSurfaceMix * (open + 0.35 * seaIce * (1.0 - land));

    // thin atmospheric rim – blue, turning to a warm, brighter haze where the air is loaded with vapour and dust
    float hotRim = hotAir * uSurfaceMix;
    float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
    color += mix(RIM_COOL, RIM_HOT, hotRim) * rim * (0.15 + 0.5 * day) * (1.0 + 0.9 * hotRim);

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

/**
 * The atmosphere shell. Blue, and along the latitudes whose seasonal mean has gone past the livable
 * limit – read from the same surface texture the globe uses, at the latitude the rotation axis gives –
 * it thickens into the warm, bright haze of an air full of vapour and dust.
 */
const ATMOSPHERE_FRAGMENT = /* glsl */ `
  uniform vec3 uSunPos;
  uniform sampler2D uSurfTex; // R = seasonal mean per latitude row (encoded), as in the Earth shader
  uniform float uSurfaceMix;
  uniform vec3 uAxis;         // Earth's rotation axis, world space
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  const float PI = 3.141592653589793;
  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunPos - vWorldPos);
    float sinLat = clamp(dot(N, uAxis), -1.0, 1.0);
    float tC = texture2D(uSurfTex, vec2(0.5, asin(sinLat) / PI + 0.5)).r * ${glslFloat(SURF.tempRangeC.max - SURF.tempRangeC.min)} + ${glslFloat(SURF.tempRangeC.min)};
    float hot = max(${hotRamp(SURF.scorch)}, ${hotRamp(SURF.dry)}) * uSurfaceMix;
    // back-face shell: the rim is where the normal is perpendicular to the view direction; the haze broadens it
    float rim = pow(clamp(1.0 + dot(N, V), 0.0, 1.0), mix(2.5, 1.8, hot));
    float lit = 0.25 + 0.75 * smoothstep(-0.3, 0.3, dot(N, L));
    vec3 color = mix(vec3(0.35, 0.6, 1.0), vec3(1.0, 0.78, 0.50), hot) * rim * lit * 0.9 * (1.0 + 1.2 * hot);
    gl_FragColor = vec4(color, rim * (0.9 + 0.3 * hot));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
