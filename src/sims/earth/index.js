/**
 * Living Earth – the real Earth, zoomable from space down to the ground (milestones M0 foundations,
 * M1 the whole Earth from a distance, M2 hero terrain & imagery with walk mode).
 *
 * One clock and one place drive everything (docs/earth-sim/10): the clock gives the instant, the
 * ephemeris turns it into the Sun's and the Moon's positions in the Earth-fixed frame, the globe streams
 * open terrain, sea floor and imagery, the date picks the Blue Marble month, the snow, the sea ice and the
 * GFS clouds, the atmosphere pass lights the sky and the haze for that Sun. The panel follows the
 * repository's panel layout: time up front, places and the water level next, the rest folded away, then
 * the readouts, the essay and the model card.
 */
import * as THREE from 'three/webgpu';
import { pass, uniform, uv, length, smoothstep, vec2, vec3, float, mix, pow, texture } from 'three/tsl';
import { GlobeControls } from '3d-tiles-renderer';
import { t, bindText, bindAttr, onLanguageChange, formatNumber, getLocale } from '../../lib/i18n.js';
import { createPanel, createPanelShift, createCollapsibleSection, createControlRow, createSlider, createViewToggles, createButton, createInfoCard, createNotice, el } from '../../lib/ui.js';
import { createViewPrefs } from '../../lib/prefs.js';
import { createViewport } from './render/viewport.js';
import { createAtmosphereUniforms, updateAtmosphereUniforms, createTransmittanceTexture, createTransmittanceLookup, createTransmittanceToSun, createAtmospherePass } from './render/atmosphere.js';
import { createGlobe } from './render/globe.js';
import { createSurfaceUniforms, createSurfaceColorNode, setSeaLevel } from './render/surface.js';
import { createBathymetry } from './data/gebco.js';
import { createGeoid } from './data/geoid.js';
import { createGlobalLayers } from './data/globalLayers.js';
import { createGfsClouds } from './data/gfs.js';
import { createFanoeWater } from './data/water.js';
import { createClouds, createCloudShadow, createCloudUniforms } from './render/clouds.js';
import { createSky } from './render/sky.js';
import { applyPose, readPose, createFlight, rayEllipsoid } from './render/camera.js';
import { createWalk } from './render/walk.js';
import { PLACES, VIEWS, HERO_BOXES, findPlace, placeAt } from './places.js';
import { NRW_DOP } from './regions.js';
import { TERRAIN, IMAGERY, IMAGERY_NRW, BUILDINGS_NRW, BUILDINGS_OSM, TREES_NRW, TIDES_DMI, BATHYMETRY_EU, BATHYMETRY, BLUE_MARBLE, SNOW, SEA_ICE, NIGHT_LIGHTS, CLOUDS, SOURCES } from './sources.js';
import { createClock, RATE_PRESETS, placeTimeZone, localDayStart, localMinuteOfDay, MS_PER_DAY } from './clock.js';
import { bodyEcef, eqjToEcefMatrix, topocentric, riseSet, moonPhase } from './ephemeris.js';
import { ecefToGeodetic, geodeticToEcef, wrapLongitudeDeg, DEG } from './geodesy.js';

const KEYS = 'sims.earth';
const EXPOSURE = 14; // scene radiance (sunlight = 1) → display, before ACES tone mapping
const READOUT_INTERVAL_MS = 250;

/** Simulation parameters – every visit starts here. */
const DEFAULTS = Object.freeze({ place: 'globe', view: 'globe', rate: 'realtime', seaLevel: 0 });
/** Display settings – remembered per visitor. */
const VIEW_DEFAULTS = Object.freeze({
  showAtmosphere: true, showBuildings: true, showTrees: true, showClouds: true, showSnowIce: true, showLights: true, showStars: true, showMoon: true, showLabels: true, showDepthTint: false, quality: 'auto',
});
/** Altitudes (m) between which the far view fades from the tile imagery to the seasonal Blue Marble. */
const FAR_IMAGERY_FADE = [1.2e6, 4e6];

/**
 * The water level slider (docs/earth-sim/10 §2.1): positions 0…1000 map piecewise linearly onto levels, so
 * the first metres get as much travel as the last kilometres. Named stops snap.
 */
const SEA_LEVEL_SCALE = Object.freeze([
  [0, 0], [100, -10], [220, -50], [340, -120], [440, -200], [600, -1000], [760, -3000], [880, -6000], [1000, -11000],
]);
const SEA_LEVEL_STOPS = Object.freeze([
  { level: 0, id: 'real' }, { level: -10 }, { level: -50 }, { level: -120, id: 'glacial' }, { level: -200, id: 'shelf' }, { level: -11000, id: 'drained' },
]);

/** Quality tiers (docs/earth-sim/01 §5) – screen-space error, pixel ratio cap, atmosphere samples, tile cache. */
const QUALITY = Object.freeze({
  low: { errorTarget: 4, maxPixelRatio: 1, cacheBytes: 0.3 * 1024 ** 3 },
  high: { errorTarget: 2, maxPixelRatio: 1.5, cacheBytes: 0.6 * 1024 ** 3 },
  ultra: { errorTarget: 1.5, maxPixelRatio: 2, cacheBytes: 1.2 * 1024 ** 3 },
});
const QUALITY_IDS = ['auto', 'low', 'high', 'ultra'];

// Fanø's label sits above its dot, Lübbecke's below – from orbit the two are only a few pixels apart
const LABELLED_PLACES = Object.freeze([
  { id: 'luebbecke', latDeg: 52.3028, lonDeg: 8.6183, side: 'below' },
  { id: 'fanoe', latDeg: 55.4446, lonDeg: 8.399, side: 'above' },
]);

export default async function mount(container, meta) {
  const viewPrefs = createViewPrefs(meta.id, VIEW_DEFAULTS);
  const state = { ...DEFAULTS, ...viewPrefs.values };
  if (!QUALITY_IDS.includes(state.quality)) state.quality = VIEW_DEFAULTS.quality;
  const disposers = [];

  const viewport = el('div', 'lp-sim__viewport');
  container.append(viewport);
  const backend = new URLSearchParams(location.search).get('renderer') === 'webgl' ? 'webgl' : 'auto';
  const view = await createViewport({ container: viewport, backend });
  const { renderer, scene, camera } = view;
  disposers.push(() => view.dispose());

  // --- atmosphere, globe, sky ------------------------------------------------------------------------------
  const u = createAtmosphereUniforms();
  const lut = createTransmittanceTexture();
  const toSun = createTransmittanceToSun(createTransmittanceLookup(lut));
  const nightFloor = uniform(new THREE.Color(0.0006, 0.0008, 0.0012));
  const surface = createSurfaceUniforms();
  const geoid = createGeoid({ baseUrl: import.meta.env.BASE_URL });
  const bathymetry = createBathymetry({ url: BATHYMETRY.url, baseUrl: import.meta.env.BASE_URL });
  const globalLayers = createGlobalLayers({ onChange: () => view.requestRender() });
  const layerNodes = Object.fromEntries(Object.entries(globalLayers.textures).map(([k, tex]) => [k, texture(tex)]));
  const unsubscribeLayers = globalLayers.subscribe((key, tex) => {
    layerNodes[key].value = tex;
  });
  const bmngMix = uniform(0);
  // plate carrée lookup: row 0 = north
  const equirect = (latLon) => vec2(latLon.y.div(2 * Math.PI).add(0.5), float(0.5).sub(latLon.x.div(Math.PI)));
  const layers = {
    farImagery: (latLon) => mix(layerNodes.bmngA.sample(equirect(latLon)).rgb, layerNodes.bmngB.sample(equirect(latLon)).rgb, bmngMix),
    snow: (latLon) => smoothstep(0.08, 0.55, layerNodes.snow.sample(equirect(latLon)).r),
    seaIce: (latLon) => smoothstep(0.1, 0.85, layerNodes.seaIce.sample(equirect(latLon)).r),
    // Black Marble's PNG is a display rendering of radiance: decode its gamma, tint it sodium-orange
    lights: (latLon) => pow(layerNodes.lights.sample(equirect(latLon)).r, 2.2).mul(vec3(1, 0.72, 0.42)).mul(0.03),
  };
  // clouds: GFS cover in two textures (the bracketing forecast steps), shared by the shells and the shadows
  const gfs = createGfsClouds({ onChange: () => view.requestRender() });
  const cloudNodes = { a: texture(gfs.textures.a), b: texture(gfs.textures.b) };
  const unsubscribeGfs = gfs.subscribe((slot, tex) => {
    cloudNodes[slot].value = tex;
  });
  // the water level around Fanø: DMI gauge, DMI prediction or our harmonic model (data/water.js)
  const fanoeWater = createFanoeWater({ onChange: () => view.requestRender() });
  disposers.push(() => fanoeWater.dispose());
  const cloudCover = createCloudUniforms();
  layers.sunShadow = createCloudShadow({ u, nodes: cloudNodes, cover: cloudCover });
  const clouds = createClouds({ u, toSun, nodes: cloudNodes, nightFloor, cover: cloudCover });
  scene.add(clouds.group);
  disposers.push(unsubscribeGfs, () => gfs.dispose(), () => clouds.dispose());
  const colorNode = createSurfaceColorNode(u, toSun, surface, { nightFloor, geoid, layers });
  const quality = () => QUALITY[state.quality === 'auto' ? 'high' : state.quality];
  const globe = createGlobe({
    terrain: TERRAIN, imagery: IMAGERY, hero: IMAGERY_NRW, colorNode, camera, renderer, bathymetry, geoid,
    errorTarget: quality().errorTarget, cacheBytes: quality().cacheBytes,
  });
  scene.add(globe.tiles.group);
  disposers.push(() => globe.dispose(), () => lut.dispose(), () => geoid.dispose(), () => bathymetry.dispose(), unsubscribeLayers, () => globalLayers.dispose());

  // buildings: NRW LoD2 (3D Tiles) and Fanø's OSM footprints, set onto the terrain
  // (its own chunk: the LoD2 metadata plugins and the roof generator load with the simulation, not the app)
  const { createBuildings } = await import('./render/buildings.js');
  const buildings = createBuildings({
    u, toSun, sunShadow: layers.sunShadow, nightFloor, camera, renderer,
    groundHeight: (lat, lon) => globe.sampleElevation(lat, lon),
    baseUrl: import.meta.env.BASE_URL, nrwUrl: BUILDINGS_NRW.url, osm: { file: BUILDINGS_OSM.file, box: HERO_BOXES.fanoe },
    onChange: () => view.requestRender(),
  });
  scene.add(buildings.group);
  disposers.push(() => buildings.dispose());
  // trees: found in NRW's canopy height model around the camera (own chunk, like the buildings)
  const { createTrees } = await import('./render/trees.js');
  const trees = createTrees({
    u, toSun, sunShadow: layers.sunShadow, nightFloor, camera,
    groundHeight: (lat, lon) => globe.sampleElevation(lat, lon),
    onChange: () => view.requestRender(),
  });
  scene.add(trees.group);
  disposers.push(() => trees.dispose());

  const sky = createSky({ sunIlluminance: u.sunIlluminance, sunDirection: u.sunDirection, starBrightness: u.starBrightness });
  scene.add(sky.group);
  disposers.push(() => sky.dispose());

  const exposure = uniform(EXPOSURE);
  const scenePass = pass(scene, camera);
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputNode = createAtmospherePass({
    colorNode: scenePass.getTextureNode('output'),
    depthNode: scenePass.getTextureNode('depth'),
    camera,
    uniforms: u,
    lutTexture: lut,
    exposure,
  });
  view.render = () => pipeline.render();
  disposers.push(() => pipeline.dispose());

  // --- controls -----------------------------------------------------------------------------------------------
  const controls = new GlobeControls(scene, camera, renderer.domElement, null);
  controls.setEllipsoid(globe.tiles.ellipsoid, globe.tiles.group);
  controls.setScene(globe.tiles.group);
  controls.enableDamping = true;
  // the controls' pivot marker is a GLSL ShaderMaterial, which WebGPURenderer cannot build – a ring sprite
  // in TSL takes its place
  const pivot = createPivotMarker();
  controls.pivotMesh = pivot;
  disposers.push(() => pivot.material.dispose());
  let controlsMoved = false;
  const onControlsChange = () => {
    controlsMoved = true;
    view.requestRender();
  };
  const onControlsStart = () => {
    flight = null; // a drag takes the camera back from a flight
    if (state.view) {
      state.view = null;
      syncCameraButtons();
    }
  };
  controls.addEventListener('change', onControlsChange);
  controls.addEventListener('start', onControlsStart);
  disposers.push(() => {
    controls.removeEventListener('change', onControlsChange);
    controls.removeEventListener('start', onControlsStart);
    controls.dispose();
  });
  // walk mode (first person on the terrain): the globe controls rest while it runs
  const walk = createWalk({
    camera,
    dom: renderer.domElement,
    groundHeight: (lat, lon) => globe.sampleElevation(lat, lon),
    onChange: () => view.requestRender(),
  });
  disposers.push(() => walk.dispose());
  const onTilesUpdate = () => view.requestRender();
  globe.tiles.addEventListener('needs-render', onTilesUpdate);
  globe.tiles.addEventListener('needs-update', onTilesUpdate);
  globe.tiles.addEventListener('load-model', onTilesUpdate);
  const onTerrainLoaded = () => {
    buildings.terrainChanged();
    trees.terrainChanged();
  };
  globe.tiles.addEventListener('load-model', onTerrainLoaded);
  disposers.push(() => globe.tiles.removeEventListener('load-model', onTerrainLoaded));

  // --- clock ----------------------------------------------------------------------------------------------------
  const clock = createClock();
  const liveTimer = setInterval(() => {
    if (clock.live) view.requestRender(); // the Sun moves by 15″ a second – one frame a second shows it
  }, 1000);
  disposers.push(() => clearInterval(liveTimer));

  // --- camera flights ---------------------------------------------------------------------------------------------
  let flight = null;
  let flightTime = 0;
  /** A view of the whole planet backs off on a narrow (portrait) screen until the globe fits. */
  function fitPose(pose) {
    if (!pose.fitGlobe) return pose;
    const vHalf = (camera.fov * DEG) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    const half = Math.min(vHalf, hHalf) * 0.85;
    const radius = 6371000;
    return { ...pose, heightM: Math.max(pose.heightM, radius / Math.sin(half) - radius) };
  }
  function setCamera(id, { animate = true } = {}) {
    const preset = VIEWS[id];
    if (!preset) return;
    if (walk.state.active) setWalking(false);
    buildingCard.hidden = true;
    const target = fitPose(preset);
    state.view = id;
    if (target.place !== state.place) setPlace(target.place, { fly: false });
    if (!animate || view.reducedMotion) {
      flight = null;
      applyPose(camera, target);
    } else {
      flight = createFlight(readPose(camera), target);
      flightTime = 0;
    }
    syncCameraButtons();
    view.requestRender();
  }

  // --- labels on the globe ------------------------------------------------------------------------------------------
  const labelLayer = el('div', 'lp-earth-labels', { 'aria-hidden': 'true' });
  viewport.append(labelLayer);
  const labels = LABELLED_PLACES.map((p) => {
    const node = bindText(el('span', `lp-earth-label lp-earth-label--${p.side}`), `${KEYS}.places.${p.id}`);
    labelLayer.append(node);
    const ecef = geodeticToEcef(p.latDeg * DEG, p.lonDeg * DEG, 60);
    return { ...p, node, position: new THREE.Vector3(...ecef) };
  });
  const _proj = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  function updateLabels() {
    labelLayer.hidden = !state.showLabels;
    if (!state.showLabels) return;
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    const altitude = cameraAltitude();
    for (const label of labels) {
      // hidden behind the globe: the ray from the camera meets the ellipsoid before the label
      _dir.copy(label.position).sub(camera.position);
      const distance = _dir.length();
      _dir.divideScalar(distance);
      const hit = rayEllipsoid(camera.position, _dir, -200);
      const occluded = hit && hit.distanceTo(camera.position) < distance - 5000;
      _proj.copy(label.position).project(camera);
      const onScreen = _proj.z > -1 && _proj.z < 1 && Math.abs(_proj.x) < 1.1 && Math.abs(_proj.y) < 1.1;
      // only from far away – close up the town fills the view itself
      const show = onScreen && !occluded && altitude > 25000;
      label.node.hidden = !show;
      if (show) label.node.style.transform = `translate(${((_proj.x + 1) / 2) * w}px, ${((1 - _proj.y) / 2) * h}px)`;
    }
  }

  // --- UI ---------------------------------------------------------------------------------------------------------
  const isSmallScreen = window.matchMedia('(max-width: 720px)').matches;
  const viewShift = createPanelShift({ sim: view, viewport });
  const cameraViewsFor = (placeId) => findPlace(placeId).views.map((id) => ({ id, labelKey: `${KEYS}.views.${id}`, icon: VIEWS[id].icon }));
  const panel = createPanel({
    onToggle: () => viewShift.sync(),
    onReset: resetAll,
    camera: { views: cameraViewsFor(state.place), onSelect: (id) => setCamera(id) },
  });

  // 1. headline: time of day with play/pause and "now", the date and the speed, the place
  const placeZone = () => placeTimeZone({ timeZone: findPlace(state.place).timeZone, lonDeg: 0 });
  const timeSlider = createSlider({
    labelKey: `${KEYS}.controls.time`,
    min: 0,
    max: 1439,
    step: 1,
    value: 720,
    format: (v) => `${formatClock(v)} ${placeZone().label(clock.simTime)}`,
    onChange: (v) => {
      const zone = placeZone();
      const offset = zone.offsetMinutes(clock.simTime);
      clock.setTime(localDayStart(clock.simTime, offset) + v * 60000);
      onClockChanged();
    },
  });
  const playBtn = createButton({ labelKey: `${KEYS}.controls.pause`, icon: '⏸', variant: 'primary', compact: true, onClick: () => setPlaying(!clock.playing) });
  const nowBtn = createButton({ labelKey: `${KEYS}.controls.now`, icon: '◉', compact: true, onClick: () => goLive() });
  const timeRow = createControlRow(timeSlider, playBtn, nowBtn);

  const dateRow = el('div', 'lp-earth-date');
  const dateId = `earth-date-${Math.random().toString(36).slice(2, 8)}`;
  const dateLabel = bindText(el('label', 'lp-control__label', { for: dateId }), `${KEYS}.controls.date`);
  const dateInput = el('input', 'lp-date__input', { type: 'date', id: dateId, min: '1800-01-01', max: '2200-12-31', required: true });
  const rateId = `${dateId}-rate`;
  const rateSelect = el('select', 'lp-date__input lp-earth-rate', { id: rateId });
  bindAttr(rateSelect, { 'aria-label': `${KEYS}.controls.rate`, title: `${KEYS}.controls.rate` });
  function renderRateOptions() {
    rateSelect.replaceChildren(
      ...RATE_PRESETS.map((r) => {
        const o = el('option', null, { value: r.id });
        o.textContent = t(`${KEYS}.rates.${r.id}`);
        return o;
      }),
    );
    rateSelect.value = state.rate;
  }
  renderRateOptions();
  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    const [y, m, d] = dateInput.value.split('-').map(Number);
    const zone = placeZone();
    const minute = localMinuteOfDay(clock.simTime, zone.offsetMinutes(clock.simTime));
    const utcMidnight = Date.UTC(y, m - 1, d);
    clock.setTime(utcMidnight - zone.offsetMinutes(utcMidnight) * 60000 + minute * 60000);
    onClockChanged();
  });
  rateSelect.addEventListener('change', () => {
    state.rate = rateSelect.value;
    const preset = RATE_PRESETS.find((r) => r.id === state.rate) ?? RATE_PRESETS[0];
    clock.setRate(preset.rate);
    onClockChanged();
  });
  const dateFields = el('div', 'lp-date__row');
  dateFields.append(dateInput, rateSelect);
  dateRow.append(dateLabel, dateFields);

  const placeRow = el('div', 'lp-presets lp-presets--3 lp-presets--compact', { role: 'group' });
  bindAttr(placeRow, { 'aria-label': `${KEYS}.controls.place` });
  const placeButtons = PLACES.map((p) => {
    const btn = createButton({ labelKey: `${KEYS}.places.${p.id}`, onClick: () => setPlace(p.id) });
    btn.el.classList.add('lp-presets__btn');
    placeRow.append(btn.el);
    return { id: p.id, el: btn.el };
  });

  const seaLevelSlider = createSlider({
    labelKey: `${KEYS}.controls.seaLevel`,
    min: 0,
    max: 1000,
    step: 1,
    value: 0,
    format: () => formatSeaLevel(state.seaLevel),
    onChange: (v) => setWaterLevel(snapSeaLevel(positionToSeaLevel(v))),
  });
  const seaResetBtn = createButton({ labelKey: `${KEYS}.controls.seaLevelReset`, icon: '↺', compact: true, onClick: () => setWaterLevel(0) });
  const seaLevelRow = createControlRow(seaLevelSlider, seaResetBtn);

  // 2. everything else, folded away
  const moreControls = createCollapsibleSection({ titleKey: `${KEYS}.sections.more`, open: !isSmallScreen });
  const cameraRow = el('div', 'lp-presets lp-presets--3 lp-presets--compact', { role: 'group' });
  bindAttr(cameraRow, { 'aria-label': `${KEYS}.controls.camera` });
  let cameraButtons = [];
  function renderCameraRow() {
    cameraRow.replaceChildren();
    cameraButtons = cameraViewsFor(state.place).map(({ id, labelKey, icon }) => {
      const btn = createButton({ labelKey, icon, onClick: () => setCamera(id) });
      btn.el.classList.add('lp-presets__btn');
      cameraRow.append(btn.el);
      return { id, el: btn.el };
    });
  }
  renderCameraRow();
  // walking is a camera mode, not a step of the view cycle – its own button (docs/earth-sim/10 §2.2)
  const walkBtn = createButton({ labelKey: `${KEYS}.controls.walk`, icon: '🚶', onClick: () => setWalking(!walk.state.active) });
  walkBtn.el.classList.add('lp-earth-walk');
  const qualityRow = el('div', 'lp-presets lp-presets--tight lp-presets--compact', { role: 'group' });
  bindAttr(qualityRow, { 'aria-label': `${KEYS}.controls.quality` });
  const qualityButtons = QUALITY_IDS.map((id) => {
    const btn = createButton({ labelKey: `${KEYS}.quality.${id}`, onClick: () => setQuality(id) });
    btn.el.classList.add('lp-presets__btn');
    qualityRow.append(btn.el);
    return { id, el: btn.el };
  });
  const viewToggles = createViewToggles({ state, prefs: viewPrefs, defaults: VIEW_DEFAULTS, onChange: () => applyDisplay() });
  const toggles = {
    showAtmosphere: viewToggles.toggle('showAtmosphere', `${KEYS}.view.atmosphere`),
    showBuildings: viewToggles.toggle('showBuildings', `${KEYS}.view.buildings`),
    showTrees: viewToggles.toggle('showTrees', `${KEYS}.view.trees`),
    showClouds: viewToggles.toggle('showClouds', `${KEYS}.view.clouds`),
    showSnowIce: viewToggles.toggle('showSnowIce', `${KEYS}.view.snowIce`),
    showLights: viewToggles.toggle('showLights', `${KEYS}.view.lights`),
    showStars: viewToggles.toggle('showStars', `${KEYS}.view.stars`),
    showMoon: viewToggles.toggle('showMoon', `${KEYS}.view.moon`),
    showLabels: viewToggles.toggle('showLabels', `${KEYS}.view.labels`),
    showDepthTint: viewToggles.toggle('showDepthTint', `${KEYS}.view.depthTint`),
  };
  moreControls.add(
    bindText(el('p', 'lp-subheading'), `${KEYS}.controls.camera`), cameraRow, walkBtn.el,
    bindText(el('p', 'lp-subheading'), `${KEYS}.controls.quality`), qualityRow,
    bindText(el('p', 'lp-subheading'), `${KEYS}.sections.view`),
    toggles.showAtmosphere, toggles.showBuildings, toggles.showTrees, toggles.showClouds, toggles.showSnowIce, toggles.showLights, toggles.showStars, toggles.showMoon, toggles.showLabels, toggles.showDepthTint,
  );
  if (view.reducedMotion) moreControls.add(createNotice({ textKey: 'motion.reducedNotice' }));

  // 3. readouts: the moment (time, data mode) in the box, every figure in one listing
  const momentBox = el('div', 'lp-readout');
  const momentValue = el('div', 'lp-readout__value', { 'aria-live': 'off' });
  const modePill = el('span', 'lp-state', { role: 'status' });
  const modeHint = el('p', 'lp-state__hint');
  momentBox.append(bindText(el('div', 'lp-readout__label'), `${KEYS}.readout.localTime`), momentValue, modePill, modeHint);
  const facts = createFacts([
    ['place', `${KEYS}.readout.place`],
    ['ground', `${KEYS}.readout.ground`],
    ['altitude', `${KEYS}.readout.altitude`],
    ['sun', `${KEYS}.readout.sun`],
    ['sunriseSunset', `${KEYS}.readout.sunriseSunset`],
    ['moon', `${KEYS}.readout.moon`],
    ['clouds', `${KEYS}.readout.clouds`],
    ['water', `${KEYS}.readout.water`],
    ['renderer', `${KEYS}.readout.renderer`],
  ]);
  const infoCard = createInfoCard({ titleKey: `${KEYS}.info.title`, bodyKey: `${KEYS}.info.body`, open: false });
  const modelCard = createInfoCard({ titleKey: `${KEYS}.model.title`, bodyKey: `${KEYS}.model.body`, open: false });
  modelCard.el.classList.add('lp-physics');

  panel.add(timeRow, dateRow, placeRow, seaLevelRow, moreControls, momentBox, facts, infoCard, modelCard);
  container.append(panel.el);
  viewShift.attach(panel);
  disposers.push(viewShift.dispose, () => panel.dispose());

  // the attribution strip: the providers of everything on screen, and the full list behind a button
  const attribution = el('div', 'lp-earth-attribution');
  const attributionText = el('span', 'lp-earth-attribution__text');
  const sourcesBtn = el('button', 'lp-earth-attribution__more', { type: 'button', 'aria-expanded': 'false' });
  bindText(sourcesBtn, `${KEYS}.attribution.sources`);
  const sourcesList = el('div', 'lp-earth-sources', { hidden: true, role: 'region' });
  bindAttr(sourcesList, { 'aria-label': `${KEYS}.attribution.sources` });
  sourcesBtn.addEventListener('click', () => {
    sourcesList.hidden = !sourcesList.hidden;
    sourcesBtn.setAttribute('aria-expanded', String(!sourcesList.hidden));
  });
  attribution.append(attributionText, sourcesBtn);
  const hint = el('div', 'lp-sim__hint', { 'aria-hidden': 'true' });
  const hintGlobe = bindText(el('span'), `${KEYS}.hint`);
  const hintWalk = bindText(el('span', null, { hidden: true }), `${KEYS}.hintWalk`);
  hint.append(hintGlobe, hintWalk);
  // on-screen pad for touch screens while walking
  const walkPad = el('div', 'lp-earth-walkpad', { hidden: true, role: 'group' });
  bindAttr(walkPad, { 'aria-label': `${KEYS}.controls.walk` });
  for (const [name, icon] of [['turnLeft', '↶'], ['forward', '▲'], ['turnRight', '↷'], ['back', '▼']]) {
    const b = el('button', `lp-earth-walkpad__btn lp-earth-walkpad__btn--${name}`, { type: 'button' });
    b.textContent = icon;
    bindAttr(b, { 'aria-label': `${KEYS}.walk.${name}`, title: `${KEYS}.walk.${name}` });
    const on = (e) => {
      e.preventDefault();
      walk.press(name, true);
    };
    const off = () => walk.press(name, false);
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointerleave', off);
    b.addEventListener('pointercancel', off);
    walkPad.append(b);
  }
  viewport.append(walkPad);

  // building info card: a click (not a drag) on a building picks it
  const buildingCard = el('div', 'lp-earth-building', { hidden: true, role: 'region', 'aria-live': 'polite' });
  bindAttr(buildingCard, { 'aria-label': `${KEYS}.building.title` });
  const buildingTitle = el('h3', 'lp-earth-building__title');
  const buildingFacts = el('dl', 'lp-facts lp-facts--wrap');
  const buildingClose = createButton({ labelKey: `${KEYS}.building.close`, slim: true, onClick: () => { buildingCard.hidden = true; } });
  buildingCard.append(buildingTitle, buildingFacts, buildingClose.el);
  viewport.append(buildingCard);
  let lastPicked = null;
  function renderBuildingCard(info) {
    lastPicked = info;
    if (!info) {
      buildingCard.hidden = true;
      return;
    }
    const row = (labelKey, value) => {
      buildingFacts.append(bindText(el('dt'), labelKey));
      const dd = el('dd');
      dd.textContent = value;
      buildingFacts.append(dd);
    };
    buildingFacts.replaceChildren();
    if (info.source === 'nrw') {
      const a = info.alkis;
      const code = String(a?.code ?? '').replace(/^31001_/, '');
      const use = a ? tOr(`${KEYS}.buildingFunctions.${code}`, a.functionText || t(`${KEYS}.building.alkisCode`, { code: a.code || '–' })) : t(`${KEYS}.building.${info.alkisFailed ? 'alkisUnavailable' : 'alkisLoading'}`);
      buildingTitle.textContent = a?.name || info.name || (a ? use : t(`${KEYS}.building.title`));
      row(`${KEYS}.building.use`, use);
      if (a?.address) row(`${KEYS}.building.address`, a.address);
      row(`${KEYS}.building.roof`, tOr(`${KEYS}.roofTypes.${info.roofType}`, String(info.roofType)));
      row(`${KEYS}.building.height`, t(`${KEYS}.building.heightMeasured`, { h: fmt(info.height, 1) }));
      row(`${KEYS}.building.source`, t(`${KEYS}.building.sourceNrw`, { id: info.id }));
      if (!a && !info.alkisFailed && !info.alkisPending) {
        info.alkisPending = true;
        buildings.alkis(info).then((res) => {
          info.alkis = res;
          if (!res) info.alkisFailed = true;
        }, () => {
          info.alkisFailed = true;
        }).finally(() => {
          info.alkisPending = false;
          if (lastPicked === info && !buildingCard.hidden) renderBuildingCard(info);
        });
      }
    } else {
      buildingTitle.textContent = tOr(`${KEYS}.osmTypes.${info.type}`, info.type);
      row(`${KEYS}.building.use`, tOr(`${KEYS}.osmTypes.${info.type}`, info.type));
      row(`${KEYS}.building.roof`, tOr(`${KEYS}.osmRoofs.${info.roof}`, info.roof) + (info.roofMaterial ? ` (${tOr(`${KEYS}.osmRoofMaterials.${info.roofMaterial}`, info.roofMaterial)})` : ''));
      row(`${KEYS}.building.height`, t(`${KEYS}.building.${info.tagged ? 'heightMeasured' : 'heightGenerated'}`, { h: fmt(info.height, 1) }));
      row(`${KEYS}.building.source`, t(`${KEYS}.building.sourceOsm`));
    }
    buildingCard.hidden = false;
  }
  let pressAt = null;
  const onPickDown = (e) => {
    pressAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onPickUp = (e) => {
    if (!pressAt || Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > 6 || performance.now() - pressAt.t > 500) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    renderBuildingCard(buildings.pick(ndc));
  };
  renderer.domElement.addEventListener('pointerdown', onPickDown);
  renderer.domElement.addEventListener('pointerup', onPickUp);
  disposers.push(() => {
    renderer.domElement.removeEventListener('pointerdown', onPickDown);
    renderer.domElement.removeEventListener('pointerup', onPickUp);
  });
  container.append(attribution, sourcesList, hint);
  disposers.push(() => {
    attribution.remove();
    sourcesList.remove();
    hint.remove();
    labelLayer.remove();
    walkPad.remove();
    buildingCard.remove();
  });
  let attributionKey = '';
  let lastCentre = null; // the centre of the view from the last readout update
  /** The strip names the providers of what is on screen right now (cheap; called with the readouts). */
  function updateAttributionStrip() {
    // the far view shows the Blue Marble month, closer the EOX tiles; snow, ice and lights are on top
    const onScreen = [TERRAIN, surface.farBlend.value > 0.5 ? BLUE_MARBLE : IMAGERY];
    // the state's orthophotos once the view is over North Rhine-Westphalia and close enough for them
    const c = lastCentre;
    if (c && cameraAltitude() < 300000 && c.latDeg > NRW_DOP.south && c.latDeg < NRW_DOP.north && c.lonDeg > NRW_DOP.west && c.lonDeg < NRW_DOP.east) onScreen.push(IMAGERY_NRW);
    if (state.seaLevel < 0 || state.showDepthTint) onScreen.push(BATHYMETRY);
    if (state.showSnowIce) onScreen.push(SNOW, SEA_ICE);
    if (state.showLights) onScreen.push(NIGHT_LIGHTS);
    if (state.showClouds && gfs.state.available) onScreen.push(CLOUDS);
    if (state.showBuildings && c && cameraAltitude() < 60000) {
      const lb = HERO_BOXES.fanoe;
      if (c.latDeg > NRW_DOP.south && c.latDeg < NRW_DOP.north && c.lonDeg > NRW_DOP.west && c.lonDeg < NRW_DOP.east) onScreen.push(BUILDINGS_NRW);
      if (c.latDeg > lb.south && c.latDeg < lb.north && c.lonDeg > lb.west && c.lonDeg < lb.east) onScreen.push(BUILDINGS_OSM);
    }
    if (state.showTrees && trees.stats.trees > 0 && cameraAltitude() < 2500) onScreen.push(TREES_NRW);
    const fb2 = HERO_BOXES.fanoe;
    if (c && cameraAltitude() < 200000 && c.latDeg > fb2.south - 0.15 && c.latDeg < fb2.north + 0.15 && c.lonDeg > fb2.west - 0.3 && c.lonDeg < fb2.east + 0.3) onScreen.push(TIDES_DMI, BATHYMETRY_EU);
    const key = onScreen.map((x) => x.id).join('|');
    if (key === attributionKey) return;
    attributionKey = key;
    attributionText.textContent = onScreen.map((x) => x.short ?? x.attribution).join(' · ');
  }
  function renderAttribution() {
    attributionKey = '';
    updateAttributionStrip();
    sourcesList.replaceChildren();
    const title = bindText(el('h3', 'lp-earth-sources__title'), `${KEYS}.attribution.title`);
    const list = el('ul', 'lp-earth-sources__list');
    for (const s of SOURCES) {
      const li = el('li');
      const a = el('a', null, { href: s.href, target: '_blank', rel: 'noopener noreferrer' });
      a.textContent = s.name;
      const meta_ = el('span', 'lp-earth-sources__meta');
      meta_.textContent = ` – ${t(`${KEYS}.provenance.${s.provenance}`)} · ${t(`${KEYS}.attribution.licence`)}: ${s.licence}`;
      const credit = el('div', 'lp-earth-sources__credit');
      credit.textContent = s.attribution;
      li.append(a, meta_, credit);
      for (const notice of s.notices ?? []) {
        const n = el('div', 'lp-earth-sources__notice');
        n.textContent = notice;
        li.append(n);
      }
      list.append(li);
    }
    const close = createButton({ labelKey: `${KEYS}.attribution.close`, slim: true, onClick: () => sourcesBtn.click() });
    sourcesList.append(title, list, close.el);
  }
  renderAttribution();

  // --- state changes ------------------------------------------------------------------------------------------------
  function setPlace(id, { fly = true } = {}) {
    if (fly && walk.state.active) setWalking(false);
    state.place = findPlace(id).id;
    renderCameraRow();
    panel.setCameraViews(cameraViewsFor(state.place), state.view);
    syncPlaceButtons();
    if (fly) setCamera(findPlace(id).views[0]);
    onClockChanged(); // the slider shows the new place's local time
  }
  function setWaterLevel(level) {
    state.seaLevel = level;
    setSeaLevel(surface, level);
    seaLevelSlider.setValue(seaLevelToPosition(level), { silent: true }); // a snapped level moves the thumb
    seaResetBtn.el.setAttribute('aria-pressed', String(level === 0));
    lastReadout = 0;
    view.requestRender();
  }
  function setWalking(on) {
    if (on && !walk.state.active) {
      flight = null;
      const centre = viewCentre();
      const camGeo = ecefToGeodetic(camera.position.x, camera.position.y, camera.position.z);
      const where = centre ?? { latDeg: camGeo.lat / DEG, lonDeg: camGeo.lon / DEG };
      walk.enter({ latDeg: where.latDeg, lonDeg: where.lonDeg, headingDeg: readPose(camera).headingDeg });
      controls.enabled = false;
      state.view = null;
      syncCameraButtons();
    } else if (!on && walk.state.active) {
      walk.exit();
      // step back up a little, so the globe controls start above the ground
      const pose = readPose(camera);
      applyPose(camera, { ...pose, heightM: pose.heightM + 120, pitchDeg: -25 });
      controls.enabled = true;
    }
    const walking = walk.state.active;
    walkBtn.setLabel(walking ? `${KEYS}.controls.walkStop` : `${KEYS}.controls.walk`);
    walkBtn.el.setAttribute('aria-pressed', String(walking));
    walkPad.hidden = !walking;
    hintGlobe.hidden = walking;
    hintWalk.hidden = !walking;
    view.requestRender();
  }
  function setPlaying(v) {
    clock.setPlaying(v);
    onClockChanged();
  }
  function goLive() {
    clock.goLive();
    state.rate = 'realtime';
    rateSelect.value = state.rate;
    onClockChanged();
  }
  function setQuality(id) {
    state.quality = id;
    viewPrefs.set('quality', id);
    applyQuality();
    syncQualityButtons();
  }
  function applyQuality() {
    const q = quality();
    globe.tiles.errorTarget = q.errorTarget;
    globe.tiles.lruCache.maxBytesSize = q.cacheBytes;
    globe.tiles.lruCache.minBytesSize = q.cacheBytes / 2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.maxPixelRatio));
    view.requestRender();
  }
  function applyDisplay() {
    u.haze.value = state.showAtmosphere ? 1 : 0;
    surface.depthTint.value = state.showDepthTint ? 1 : 0;
    surface.snowIce.value = state.showSnowIce ? 1 : 0;
    surface.nightLights.value = state.showLights ? 1 : 0;
    if (!state.showBuildings) buildingCard.hidden = true;
    clouds.group.visible = state.showClouds;
    sky.setStarsVisible(state.showStars);
    sky.moon.visible = state.showMoon;
    updateLabels();
    view.requestRender();
  }
  function resetAll() {
    if (walk.state.active) setWalking(false);
    Object.assign(state, DEFAULTS);
    viewToggles.reset();
    state.quality = VIEW_DEFAULTS.quality;
    viewPrefs.set('quality', state.quality);
    applyQuality();
    syncQualityButtons();
    clock.goLive();
    rateSelect.value = state.rate;
    setWaterLevel(DEFAULTS.seaLevel);
    setPlace(DEFAULTS.place, { fly: false });
    setCamera(DEFAULTS.view);
    onClockChanged();
  }

  function syncPlaceButtons() {
    for (const { id, el: b } of placeButtons) b.setAttribute('aria-pressed', String(id === state.place));
  }
  function syncCameraButtons({ announce = false } = {}) {
    for (const { id, el: b } of cameraButtons) b.setAttribute('aria-pressed', String(id === state.view));
    panel.setCameraView(state.view, { announce });
  }
  function syncQualityButtons() {
    for (const { id, el: b } of qualityButtons) b.setAttribute('aria-pressed', String(id === state.quality));
  }
  function syncClockControls() {
    const playing = clock.playing;
    playBtn.setIcon(playing ? '⏸' : '▶');
    playBtn.setLabel(playing ? `${KEYS}.controls.pause` : `${KEYS}.controls.play`);
    playBtn.el.setAttribute('aria-pressed', String(playing));
    nowBtn.el.setAttribute('aria-pressed', String(clock.live));
    const zone = placeZone();
    const offset = zone.offsetMinutes(clock.simTime);
    timeSlider.setValue(Math.floor(localMinuteOfDay(clock.simTime, offset)), { silent: true });
    const local = new Date(clock.simTime + offset * 60000);
    const iso = local.toISOString().slice(0, 10);
    if (document.activeElement !== dateInput && dateInput.value !== iso) dateInput.value = iso;
  }
  function onClockChanged() {
    syncClockControls();
    lastReadout = 0;
    view.requestRender();
  }

  // --- readouts -------------------------------------------------------------------------------------------------------
  let lastReadout = 0;
  let lastSunTimesKey = '';
  let sunTimes = null;
  const _fwd = new THREE.Vector3();
  function viewCentre() {
    if (walk.state.active) {
      // walking: the place under the walker's feet
      const { latDeg, lonDeg } = walk.state;
      const h = globe.sampleElevation(latDeg * DEG, lonDeg * DEG);
      return { latDeg, lonDeg, elevation: h === null ? null : h - geoid.sample(latDeg, lonDeg) };
    }
    camera.getWorldDirection(_fwd);
    let hit = rayEllipsoid(camera.position, _fwd, 0);
    if (!hit) return null;
    let g = ecefToGeodetic(hit.x, hit.y, hit.z);
    // once more against the ellipsoid lifted to the terrain under the first hit
    const elevation = globe.sampleElevation(g.lat, g.lon);
    if (elevation !== null) {
      hit = rayEllipsoid(camera.position, _fwd, elevation) ?? hit;
      g = ecefToGeodetic(hit.x, hit.y, hit.z);
    }
    const ellipsoidal = globe.sampleElevation(g.lat, g.lon);
    const latDeg = g.lat / DEG;
    const lonDeg = g.lon / DEG;
    // the grids hold heights above the ellipsoid; the readout gives them above mean sea level
    return { latDeg, lonDeg, elevation: ellipsoidal === null ? null : ellipsoidal - geoid.sample(latDeg, lonDeg) };
  }
  function waterReadout(where, offset) {
    const b = HERO_BOXES.fanoe;
    if (!(where.latDeg > b.south - 0.1 && where.latDeg < b.north + 0.1 && where.lonDeg > b.west - 0.1 && where.lonDeg < b.east + 0.1)) return t(`${KEYS}.readout.waterElsewhere`);
    const w = fanoeWater.level(clock.simTime);
    const nxt = fanoeWater.next(clock.simTime);
    const ev = w.rising ? nxt.high : nxt.low;
    return t(`${KEYS}.readout.waterValue`, {
      level: `${w.level >= 0 ? '+' : '−'}${fmt(Math.abs(w.level), 2)}`,
      trend: t(`${KEYS}.readout.${w.rising ? 'rising' : 'falling'}`),
      source: t(`${KEYS}.readout.waterSource.${w.source}`),
      next: t(`${KEYS}.readout.${w.rising ? 'nextHigh' : 'nextLow'}`, { time: ev ? formatClock(localMinuteOfDay(ev.time, offset)) : '–' }),
    });
  }
  function cloudReadout() {
    if (!state.showClouds) return t(`${KEYS}.readout.cloudsOff`);
    const g = gfs.state;
    if (!g.available) return t(`${KEYS}.readout.${clock.simTime < Date.UTC(2021, 0, 1) || g.latestRun === null ? 'cloudsNone' : g.loading ? 'cloudsLoading' : 'cloudsNone'}`);
    const run = new Date(g.run);
    const date = run.toLocaleDateString(getLocale(), { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const step = g.steps[0] + g.mix * (g.steps[1] - g.steps[0]);
    return t(`${KEYS}.readout.cloudsValue`, { run: `${date} ${String(run.getUTCHours()).padStart(2, '0')}`, step: fmt(step, 1) });
  }
  function cameraAltitude() {
    const g = ecefToGeodetic(camera.position.x, camera.position.y, camera.position.z);
    const ground = globe.sampleElevation(g.lat, g.lon) ?? 0;
    return g.h - ground;
  }
  function updateReadouts(now) {
    if (now - lastReadout < READOUT_INTERVAL_MS) return;
    lastReadout = now;
    if (clock.playing) syncClockControls(); // the slider and the date follow a running clock
    const date = clock.date;
    const centre = viewCentre();
    lastCentre = centre;
    const camGeo = ecefToGeodetic(camera.position.x, camera.position.y, camera.position.z);
    const where = centre ?? { latDeg: camGeo.lat / DEG, lonDeg: camGeo.lon / DEG, elevation: null };
    const hero = placeAt(where.latDeg, where.lonDeg);
    const zone = placeTimeZone({ timeZone: hero?.timeZone ?? findPlace(state.place).timeZone, lonDeg: where.lonDeg });
    const offset = zone.offsetMinutes(clock.simTime);

    momentValue.textContent = `${formatClock(localMinuteOfDay(clock.simTime, offset))} ${zone.label(clock.simTime)}`;
    const mode = clock.mode;
    modePill.textContent = t(`${KEYS}.readout.modes.${mode}`);
    modePill.className = `lp-state lp-state--${mode === 'live' ? 'habitable' : mode === 'climatology' ? 'scorched' : 'frozen'}`;
    modeHint.textContent = t(`${KEYS}.readout.modeHints.${mode}`);

    facts.set('place', formatLatLon(where.latDeg, where.lonDeg));
    facts.set('ground', where.elevation === null ? '–' : t(`${KEYS}.readout.${where.elevation < 0 ? 'belowSea' : 'aboveSea'}`, { h: fmt(Math.abs(where.elevation), 0) }));
    facts.set('altitude', formatDistance(cameraAltitude()));
    const sun = topocentric('sun', date, where.latDeg, where.lonDeg, where.elevation ?? 0, { refraction: true });
    facts.set('sun', t(`${KEYS}.readout.${sun.altitudeDeg >= 0 ? 'sunUp' : 'sunDown'}`, { alt: fmt(Math.abs(sun.altitudeDeg), 1), az: fmt(sun.azimuthDeg, 0) }));
    const dayStart = localDayStart(clock.simTime, offset);
    const key = `${dayStart}|${where.latDeg.toFixed(2)}|${where.lonDeg.toFixed(2)}`;
    if (key !== lastSunTimesKey) {
      lastSunTimesKey = key;
      sunTimes = riseSet('sun', new Date(dayStart), where.latDeg, where.lonDeg, Math.max(0, where.elevation ?? 0));
    }
    const fmtEvent = (d) => (d && d.getTime() < dayStart + MS_PER_DAY ? formatClock(localMinuteOfDay(d.getTime(), offset)) : null);
    const rise = fmtEvent(sunTimes.rise);
    const set = fmtEvent(sunTimes.set);
    if (!rise && !set) facts.set('sunriseSunset', t(`${KEYS}.readout.${sun.altitudeDeg > 0 ? 'polarDay' : 'polarNight'}`));
    else facts.set('sunriseSunset', `${rise ?? '–'} / ${set ?? '–'}`);
    const moonPos = topocentric('moon', date, where.latDeg, where.lonDeg, where.elevation ?? 0, { refraction: true });
    const phase = moonPhase(date);
    facts.set('moon', t(`${KEYS}.readout.moonValue`, { phase: t(`${KEYS}.moonPhases.${phase.name}`), lit: fmt(phase.fraction * 100, 0), alt: fmt(moonPos.altitudeDeg, 0) }));
    facts.set('clouds', cloudReadout());
    facts.set('water', waterReadout(where, offset));
    facts.set('renderer', t(`${KEYS}.readout.${view.backend}`));
    updateAttributionStrip();
  }

  // --- frame ------------------------------------------------------------------------------------------------------------
  const sunDir = new THREE.Vector3();
  let lastCloudUpdate = -Infinity;
  let lastCloudCall = 0;
  view.onFrame((dt) => {
    let changed = controlsMoved;
    controlsMoved = false;
    if (clock.tick(dt)) changed = true;
    if (walk.state.active) {
      walk.update(dt);
      if (walk.moving) changed = true;
    } else if (flight) {
      flightTime += dt;
      applyPose(camera, flight.at(flightTime));
      controls.enabled = false;
      if (flightTime >= flight.duration) {
        flight = null;
        controls.enabled = true;
      }
      changed = true;
    } else {
      controls.update(dt);
    }
    // Clip planes from the height above the ground, every frame (GlobeControls only adjusts them while it
    // drives the camera, so a flight would keep a near plane from orbit). The far plane holds the Moon
    // and the stars – the reversed float depth buffer resolves centimetres to the Moon without help.
    camera.near = Math.min(Math.max(cameraAltitude() * 0.2, 0.3), 2e6);
    camera.far = 1e10;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    const date = clock.date;
    const m = eqjToEcefMatrix(date);
    const sun = bodyEcef('sun', date, m);
    const moon = bodyEcef('moon', date, m);
    sunDir.set(sun.direction[0], sun.direction[1], sun.direction[2]);
    updateAtmosphereUniforms(u, { cameraPosition: camera.position, sunDirection: sunDir, camera });
    // the date-driven layers (loads run in the background) and the far view's seasonal imagery
    globalLayers.update(clock.simTime);
    if (Math.abs(clock.simTime - lastCloudUpdate) > 30000 || performance.now() - lastCloudCall > 1000) {
      lastCloudUpdate = clock.simTime;
      lastCloudCall = performance.now();
      gfs.update(clock.simTime);
    }
    // tide: fetch the day's DMI series unless the clock races (then the harmonic model answers)
    fanoeWater.update(clock.simTime, { allowFetch: Math.abs(clock.effectiveRate) <= 3600 });
    surface.tideLevel.value = fanoeWater.level(clock.simTime).level;
    surface.time.value = view.reducedMotion ? 0 : performance.now() / 1000;
    cloudCover.mix.value = gfs.state.mix;
    cloudCover.on.value = state.showClouds && gfs.state.available ? 1 : 0;
    bmngMix.value = globalLayers.state.bmngMix;
    const altitude = cameraAltitude();
    const [f0, f1] = FAR_IMAGERY_FADE;
    const f = Math.min(1, Math.max(0, (altitude - f0) / (f1 - f0)));
    surface.farBlend.value = f * f * (3 - 2 * f);
    sky.update({ cameraPosition: camera.position, eqjToEcef: m, moonPosition: moon.position });
    globe.tiles.setResolutionFromRenderer(camera, renderer);
    globe.tiles.update();
    const camGeoNow = ecefToGeodetic(camera.position.x, camera.position.y, camera.position.z);
    const fb = HERO_BOXES.fanoe;
    const nearFanoe = camGeoNow.lat / DEG > fb.south - 0.3 && camGeoNow.lat / DEG < fb.north + 0.3 && camGeoNow.lon / DEG > fb.west - 0.5 && camGeoNow.lon / DEG < fb.east + 0.5;
    const buildingsBusy = buildings.update({ active: state.showBuildings && altitude < 60000, nearOsm: nearFanoe && altitude < 80000 });
    // trees around the centre of the view (the walker's feet when walking), in NRW, below 2.5 km
    const tc = lastCentre ?? { latDeg: camGeoNow.lat / DEG, lonDeg: camGeoNow.lon / DEG };
    const inNrw = camGeoNow.lat / DEG > NRW_DOP.south && camGeoNow.lat / DEG < NRW_DOP.north && camGeoNow.lon / DEG > NRW_DOP.west && camGeoNow.lon / DEG < NRW_DOP.east && tc.latDeg > NRW_DOP.south && tc.latDeg < NRW_DOP.north && tc.lonDeg > NRW_DOP.west && tc.lonDeg < NRW_DOP.east;
    const localNow = new Date(clock.simTime + placeZone().offsetMinutes(clock.simTime) * 60000);
    const doy = Math.floor((localNow - Date.UTC(localNow.getUTCFullYear(), 0, 1)) / MS_PER_DAY) + 1;
    const treesBusy = trees.update({ active: state.showTrees && inNrw && altitude < 2500, latDeg: tc.latDeg, lonDeg: tc.lonDeg, camLatDeg: camGeoNow.lat / DEG, camLonDeg: camGeoNow.lon / DEG, doy, seconds: view.reducedMotion ? 0 : performance.now() / 1000 });
    const stats = globe.tiles.stats;
    const loading = stats.downloading + stats.parsing + stats.queued > 0;
    view.setContinuous(loading || buildingsBusy || treesBusy || (!view.reducedMotion && altitude < 5000) || (!view.reducedMotion && state.showTrees && trees.stats.trees > 0 && altitude < 2500) || !!flight || walk.moving || (clock.playing && !clock.live && clock.effectiveRate !== 0));
    updateLabels();
    updateReadouts(performance.now());
    return changed || loading;
  });

  // --- language ------------------------------------------------------------------------------------------------------
  disposers.push(
    onLanguageChange(() => {
      renderRateOptions();
      renderAttribution();
      if (lastPicked && !buildingCard.hidden) renderBuildingCard(lastPicked);
      syncClockControls();
      lastReadout = 0;
      updateReadouts(performance.now());
    }),
  );

  // --- go ---------------------------------------------------------------------------------------------------------------
  applyDisplay();
  applyQuality();
  syncPlaceButtons();
  syncQualityButtons();
  syncClockControls();
  setCamera(state.view, { animate: false });
  view.start();

  if (import.meta.env.DEV) {
    window.__lpEarth = {
      view, globe, controls, clock, state, u, surface, geoid, bathymetry, globalLayers, gfs, clouds, trees, exposure, sky, VIEWS,
      setCamera, setPlace, setQuality, goLive, setPlaying, setWaterLevel, setWalking, walk, buildings,
      pickBuilding: (x, y) => { const info = buildings.pick(new THREE.Vector2(x, y)); renderBuildingCard(info); return info; },
      setTime: (ms) => { clock.setTime(ms); onClockChanged(); },
      readPose: () => readPose(camera),
      applyPose: (pose) => { applyPose(camera, typeof pose === 'string' ? VIEWS[pose] : pose); view.requestRender(); },
      finishFlight: () => { if (flight) { applyPose(camera, flight.at(flight.duration)); flight = null; controls.enabled = true; view.requestRender(); } },
      refresh: () => { lastReadout = 0; updateReadouts(performance.now()); },
    };
  }

  return () => {
    if (import.meta.env.DEV) delete window.__lpEarth;
    globe.tiles.removeEventListener('needs-render', onTilesUpdate);
    globe.tiles.removeEventListener('needs-update', onTilesUpdate);
    globe.tiles.removeEventListener('load-model', onTilesUpdate);
    for (let i = disposers.length - 1; i >= 0; i--) disposers[i]();
  };
}

// ---------- water level ---------------------------------------------------------------------------------------------------
function positionToSeaLevel(pos) {
  for (let i = 1; i < SEA_LEVEL_SCALE.length; i++) {
    const [p1, l1] = SEA_LEVEL_SCALE[i];
    const [p0, l0] = SEA_LEVEL_SCALE[i - 1];
    if (pos <= p1) return l0 + ((pos - p0) / (p1 - p0)) * (l1 - l0);
  }
  return SEA_LEVEL_SCALE.at(-1)[1];
}

function seaLevelToPosition(level) {
  for (let i = 1; i < SEA_LEVEL_SCALE.length; i++) {
    const [p1, l1] = SEA_LEVEL_SCALE[i];
    const [p0, l0] = SEA_LEVEL_SCALE[i - 1];
    if (level >= l1) return Math.round(p0 + ((level - l0) / (l1 - l0)) * (p1 - p0));
  }
  return SEA_LEVEL_SCALE.at(-1)[0];
}

/** Snaps to a named stop within 12 slider steps; otherwise rounds to a tidy number of metres. */
function snapSeaLevel(level) {
  const pos = seaLevelToPosition(level);
  for (const stop of SEA_LEVEL_STOPS) {
    if (Math.abs(seaLevelToPosition(stop.level) - pos) <= 12) return stop.level;
  }
  const step = level > -100 ? 1 : level > -1000 ? 10 : 100;
  return Math.round(level / step) * step;
}

function formatSeaLevel(level) {
  const stop = SEA_LEVEL_STOPS.find((s) => s.level === level && s.id);
  if (level === 0) return t(`${KEYS}.seaLevel.real`);
  const value = `${formatNumber(level, { maximumFractionDigits: 0 })}\u2009${t('units.meters')}`;
  return stop ? `${value} · ${t(`${KEYS}.seaLevel.${stop.id}`)}` : value;
}

// ---------- formatting ----------------------------------------------------------------------------------------------------
/** Codes that have a translated label (the rest shows the raw code – t() would warn on a missing key). */
const LABELLED = Object.freeze({
  buildingFunctions: new Set(['1000', '1010', '1020', '1100', '1120', '1313', '2000', '2020', '2050', '2100', '2463', '2700', '2723', '3000', '3021', '3041', '9998']),
  roofTypes: new Set(['0', '1000', '2100', '2200', '3100', '3200', '3300', '3400', '3500', '3600', '3700', '3800', '3900', '4000', '5000', '9999']),
  osmTypes: new Set(['yes', 'house', 'detached', 'bungalow', 'semidetached_house', 'terrace', 'apartments', 'residential', 'farm', 'cabin', 'allotment_house', 'garage', 'shed', 'barn', 'industrial', 'church', 'school', 'hotel', 'bunker', 'commercial', 'retail']),
  osmRoofs: new Set(['gabled', 'hipped', 'half-hipped', 'flat', 'skillion', 'pyramidal', 'mansard']),
  osmRoofMaterials: new Set(['thatch', 'roof_tiles', 'tar_paper', 'metal', 'concrete', 'glass', 'grass']),
});

/** A translation of a code, or the fallback when the code has no label. */
function tOr(key, fallback) {
  const [, group, code] = key.match(/\.(\w+)\.([^.]+)$/) ?? [];
  return LABELLED[group]?.has(String(code)) ? t(key) : fallback;
}

function fmt(value, digits = 1) {
  return formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatClock(minutes) {
  const m = Math.floor(((minutes % 1440) + 1440) % 1440);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function formatLatLon(latDeg, lonDeg) {
  const lon = wrapLongitudeDeg(lonDeg);
  const ns = t(`${KEYS}.hemisphere.${latDeg >= 0 ? 'north' : 'south'}`);
  const ew = t(`${KEYS}.hemisphere.${lon >= 0 ? 'east' : 'west'}`);
  return `${fmt(Math.abs(latDeg), 4)}° ${ns}, ${fmt(Math.abs(lon), 4)}° ${ew}`;
}

function formatDistance(m) {
  if (Math.abs(m) >= 10000) return `${formatNumber(m / 1000, { maximumFractionDigits: 0 })} ${t('units.kilometers')}`;
  if (Math.abs(m) >= 1000) return `${fmt(m / 1000, 1)} ${t('units.kilometers')}`;
  return `${fmt(m, 0)} ${t('units.meters')}`;
}


/** A small white ring shown where a drag or zoom pivots (screen-sized, drawn over the terrain). */
function createPivotMarker() {
  const material = new THREE.SpriteNodeMaterial({ sizeAttenuation: false, transparent: true, depthTest: false, depthWrite: false });
  const d = length(uv().sub(0.5)).mul(2);
  material.colorNode = vec3(0.07); // ≈ white after the exposure of the atmosphere pass
  material.opacityNode = smoothstep(1, 0.8, d).sub(smoothstep(0.62, 0.45, d)).mul(float(0.9));
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(0.035);
  sprite.renderOrder = 10;
  sprite.raycast = () => {};
  return sprite;
}

/** Definition list of live facts (as in the other simulations). */
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
