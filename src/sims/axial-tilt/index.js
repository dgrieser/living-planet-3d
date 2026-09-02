/**
 * Simulation: Axial tilt, rotation & seasons.
 * A planet lit by a "sun" that circles it once per (visual) year – the
 * planet-centric view of the orbit. The user tilts the rotation axis and
 * watches the seasons emerge: a colour overlay shows the modelled seasonal
 * mean temperature per latitude, the borders of the year-round livable region
 * can be drawn on the surface, a place on the planet can be pinned (the camera
 * follows it, with a live temperature/season readout), and a panel readout
 * reports how much of the surface stays livable all year (0° tilt = no seasons
 * but frozen poles, ~23.4° = Earth's sweet spot, 90° = Uranus-like extremes).
 * Physics shared with the seasons simulation (../seasons/physics.js).
 */
import * as THREE from 'three';
import { createScene } from '../../lib/scene.js';
import { createPanel, createSlider, createStateToggle, createButton, createInfoCard, createNotice, el } from '../../lib/ui.js';
import { createViewPrefs } from '../../lib/prefs.js';
import { bindText, t, onLanguageChange, formatNumber } from '../../lib/i18n.js';
import { declinationDeg, seasonAt, normalizeDeg, annualMeanInsolation, temperatureEstimate, EARTH_ROTATION_H } from '../seasons/physics.js';
import { seasonalExtremes, isLivable, livableBands, bandsFraction, verdictFor, temperatureColor } from './climate.js';

const TEXTURE_BASE = `${import.meta.env.BASE_URL}textures/`;
const KEYS = 'sims.axialTilt';

const DEFAULTS = Object.freeze({
  tilt: 23.4, // degrees
  rotationSpeed: 30, // degrees per second (visual, not to scale)
  yearSpeed: 12, // orbit degrees per second (one year every 30 s)
  orbitAngle: 0, // 0° = June solstice (north pole towards the sun)
});

/** Display toggles – remembered per visitor, see ../../lib/prefs.js. */
const VIEW_DEFAULTS = Object.freeze({
  showClimate: true,
  showLivable: true,
  showAxis: true,
  showEquator: true,
  showTerminator: false,
});

/** Orbit angles of the season stops (physics convention, see ../seasons/physics.js). */
const SEASON_STOPS = Object.freeze([
  { id: 'june', angleDeg: 0 },
  { id: 'september', angleDeg: 90 },
  { id: 'december', angleDeg: 180 },
  { id: 'march', angleDeg: 270 },
]);

const VERDICT_STATE = Object.freeze({ uniform: 'frozen', moderate: 'habitable', severe: 'scorched', extreme: 'scorched' });
const VERDICT_ZONE = Object.freeze({ uniform: 'is-outer', moderate: 'is-habitable', severe: 'is-inner', extreme: 'is-inner' });

const CLIMATE_ROWS = 128; // latitude bands of the temperature overlay
const BORDER_RING_POOL = 8; // enough for every livable/hostile boundary the model produces
const UP = new THREE.Vector3(0, 1, 0);

export default function mount(container, meta) {
  const viewPrefs = createViewPrefs(meta.id, VIEW_DEFAULTS);
  const state = { ...DEFAULTS, ...viewPrefs.values };

  const viewport = el('div', 'lp-sim__viewport');
  container.append(viewport);

  const sim = createScene({
    container: viewport,
    cameraPosition: [0, 1.6, 6.5],
    controls: { minDistance: 2.5, maxDistance: 30 },
  });
  const { scene, camera, renderer, controls } = sim;
  camera.lookAt(0, 0, 0);
  const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // --- lighting: a distant sun that circles the planet once per year ------------
  const sunGroup = new THREE.Group(); // rotation.y = orbit angle
  scene.add(sunGroup);

  const sun = new THREE.DirectionalLight(0xfff4e0, 3.2);
  sun.position.set(40, 0, 0);
  sunGroup.add(sun);
  scene.add(new THREE.AmbientLight(0x223355, 0.35));

  // small glowing sun disc for orientation
  const sunDisc = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xffe9a8 }),
  );
  sunDisc.position.set(40, 0, 0);
  sunGroup.add(sunDisc);
  const sunGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: createGlowTexture(), color: 0xffd27a, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  sunGlow.scale.setScalar(6);
  sunGlow.position.copy(sunDisc.position);
  sunGroup.add(sunGlow);

  // the sun's yearly path around the planet (ecliptic circle)
  const sunPath = new THREE.Mesh(
    new THREE.RingGeometry(39.6, 40.0, 256),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.15, side: THREE.DoubleSide }),
  );
  sunPath.rotation.x = -Math.PI / 2;
  scene.add(sunPath);

  // --- planet group (tilted) ----------------------------------------------------
  const tiltGroup = new THREE.Group(); // tilt applied here
  const spinGroup = new THREE.Group(); // rotation applied here
  tiltGroup.add(spinGroup);
  scene.add(tiltGroup);

  // Earth's day map; the procedural texture stays as a fallback if the asset is missing.
  const fallbackTexture = createPlanetTexture();
  const planetMaterial = new THREE.MeshStandardMaterial({
    map: fallbackTexture,
    roughness: 0.85,
    metalness: 0.0,
  });
  // City lights (NASA Black Marble data via Solar System Scope) as an emissive map,
  // gated to the night side: the emissive term is faded out across the terminator.
  const sunDirUniform = { value: new THREE.Vector3(1, 0, 0) }; // world-space, updated with the orbit
  planetMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDir = sunDirUniform;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunDir;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 sunViewDir = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
        totalEmissiveRadiance *= smoothstep(0.08, -0.12, dot(normalize(normal), sunViewDir));`,
      );
  };
  const planet = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), planetMaterial);
  spinGroup.add(planet);

  const textureLoader = new THREE.TextureLoader();
  textureLoader.load(
    `${TEXTURE_BASE}2k_earth_daymap.jpg`,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = maxAnisotropy;
      planetMaterial.map = tex;
      planetMaterial.needsUpdate = true;
      fallbackTexture.dispose();
      sim.requestRender();
    },
    undefined,
    () => console.warn('[axial-tilt] earth texture not available - using procedural fallback'),
  );
  textureLoader.load(
    `${TEXTURE_BASE}2k_earth_nightmap.jpg`,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = maxAnisotropy;
      planetMaterial.emissiveMap = tex;
      planetMaterial.emissive.set(0xffffff);
      planetMaterial.emissiveIntensity = 2.8; // punch through the climate overlay and ACES tone mapping
      planetMaterial.needsUpdate = true; // recompile with USE_EMISSIVEMAP
      sim.requestRender();
    },
    undefined,
    () => console.warn('[axial-tilt] night texture not available - night side stays dark'),
  );

  // temperature overlay: one canvas row per latitude band, tinted by the model
  const climateCanvas = document.createElement('canvas');
  climateCanvas.width = 2;
  climateCanvas.height = CLIMATE_ROWS;
  const climateCtx = climateCanvas.getContext('2d');
  const climateTexture = new THREE.CanvasTexture(climateCanvas);
  climateTexture.colorSpace = THREE.SRGBColorSpace;
  // lit (Lambert) so the day/night shading stays visible through the overlay
  const climateOverlay = new THREE.Mesh(
    new THREE.SphereGeometry(1.008, 96, 64),
    new THREE.MeshLambertMaterial({ map: climateTexture, transparent: true, opacity: 0.4, depthWrite: false }),
  );
  climateOverlay.renderOrder = 1;
  tiltGroup.add(climateOverlay);

  // livable-region view: darken the latitude bands that are not livable year-round …
  const shadeCanvas = document.createElement('canvas');
  shadeCanvas.width = 2;
  shadeCanvas.height = CLIMATE_ROWS;
  const shadeCtx = shadeCanvas.getContext('2d');
  const shadeTexture = new THREE.CanvasTexture(shadeCanvas);
  const livableShade = new THREE.Mesh(
    new THREE.SphereGeometry(1.012, 96, 64),
    new THREE.MeshBasicMaterial({ map: shadeTexture, transparent: true, depthWrite: false }),
  );
  livableShade.renderOrder = 2;
  tiltGroup.add(livableShade);

  // … and mark its borders with latitude rings (a fixed pool, repositioned per tilt)
  const livableBorders = new THREE.Group();
  const borderRings = [];
  for (let i = 0; i < BORDER_RING_POOL; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.007, 8, 128),
      new THREE.MeshBasicMaterial({ color: 0x5adc8c }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.visible = false;
    borderRings.push(ring);
    livableBorders.add(ring);
  }
  tiltGroup.add(livableBorders);

  // faint atmosphere rim
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.03, 48, 32),
    new THREE.MeshBasicMaterial({ color: 0x6fb6ff, transparent: true, opacity: 0.08, side: THREE.BackSide }),
  );
  atmosphere.renderOrder = 3;
  tiltGroup.add(atmosphere);

  // rotation axis (line through poles) – in tiltGroup so it tilts but doesn't spin
  const axis = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -1.6, 0), new THREE.Vector3(0, 1.6, 0)]),
    new THREE.LineBasicMaterial({ color: 0xffd166 }),
  );
  tiltGroup.add(axis);

  // equator ring
  const equator = new THREE.Mesh(
    new THREE.TorusGeometry(1.012, 0.006, 8, 128),
    new THREE.MeshBasicMaterial({ color: 0x7cc4ff }),
  );
  equator.rotation.x = Math.PI / 2;
  tiltGroup.add(equator);

  // terminator (day/night boundary): great circle perpendicular to the sun direction – world space
  const terminator = new THREE.Mesh(
    new THREE.TorusGeometry(1.015, 0.006, 8, 128),
    new THREE.MeshBasicMaterial({ color: 0xff8a80 }),
  );
  scene.add(terminator);

  // orbital-plane reference: a faint disc/ring in the ecliptic (y = 0)
  const ecliptic = new THREE.Mesh(
    new THREE.RingGeometry(1.9, 1.92, 128),
    new THREE.MeshBasicMaterial({ color: 0xa7b4cc, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
  );
  ecliptic.rotation.x = -Math.PI / 2;
  scene.add(ecliptic);

  // pin marker: a small 3D red map pin (needle + ball head), leaning slightly,
  // its tip anchored at the pinned surface point – in spinGroup so it rotates
  // with the planet. Slight emissive keeps it readable on the night side.
  const pinMarker = new THREE.Group();
  const pinHeadMaterial = new THREE.MeshStandardMaterial({ color: 0xe23a2e, roughness: 0.35, metalness: 0.15, emissive: 0x6b1611 });
  const pinNeedleMaterial = new THREE.MeshStandardMaterial({ color: 0xcfd4dc, roughness: 0.25, metalness: 0.9, emissive: 0x2a2d33 });
  const pinNeedle = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.075, 10), pinNeedleMaterial);
  pinNeedle.position.y = 0.0375; // tip at the group origin
  const pinHead = new THREE.Mesh(new THREE.SphereGeometry(0.018, 20, 14), pinHeadMaterial);
  pinHead.position.y = 0.082; // resting on the needle top
  pinMarker.add(pinNeedle, pinHead);
  pinMarker.visible = false;
  spinGroup.add(pinMarker);
  const PIN_LEAN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.85); // ≈49° off the vertical, so the needle stays visible from above

  // --- climate & livable-region textures ---------------------------------------
  // annual-mean insolation per latitude row depends only on the tilt – cache it
  let annualCache = { tilt: NaN, values: new Float64Array(CLIMATE_ROWS) };
  const rowLatitude = (row) => 90 - ((row + 0.5) / CLIMATE_ROWS) * 180; // canvas top = north pole

  function updateClimateTexture() {
    if (!state.showClimate) return;
    if (annualCache.tilt !== state.tilt) {
      annualCache.tilt = state.tilt;
      for (let row = 0; row < CLIMATE_ROWS; row++) {
        annualCache.values[row] = annualMeanInsolation(rowLatitude(row), state.tilt, 90);
      }
    }
    const decl = declinationDeg(state.tilt, state.orbitAngle);
    for (let row = 0; row < CLIMATE_ROWS; row++) {
      const { meanC } = temperatureEstimate(rowLatitude(row), state.tilt, decl, EARTH_ROTATION_H, annualCache.values[row]);
      const [r, g, b] = temperatureColor(meanC);
      climateCtx.fillStyle = `rgb(${r},${g},${b})`;
      climateCtx.fillRect(0, row, climateCanvas.width, 1);
    }
    climateTexture.needsUpdate = true;
  }

  function updateLivableVisuals(bands) {
    shadeCtx.clearRect(0, 0, shadeCanvas.width, CLIMATE_ROWS);
    shadeCtx.fillStyle = 'rgba(4, 6, 14, 0.55)';
    for (let row = 0; row < CLIMATE_ROWS; row++) {
      const lat = rowLatitude(row);
      if (!bands.some(([lo, hi]) => lat >= lo && lat <= hi)) shadeCtx.fillRect(0, row, shadeCanvas.width, 1);
    }
    shadeTexture.needsUpdate = true;

    let used = 0;
    for (const [lo, hi] of bands) {
      for (const lat of [lo, hi]) {
        if (Math.abs(lat) >= 89.9 || used >= borderRings.length) continue;
        const ring = borderRings[used++];
        const phi = THREE.MathUtils.degToRad(lat);
        ring.scale.setScalar(Math.max(0.02, Math.cos(phi) * 1.02));
        ring.position.y = Math.sin(phi) * 1.02;
        ring.visible = true;
      }
    }
    for (let i = used; i < borderRings.length; i++) borderRings[i].visible = false;
  }

  // --- pinned location -----------------------------------------------------------
  // pin = { dirLocal (unit vector in spinGroup space), latDeg, annual, annualTilt }
  let pin = null;
  let lastPinAngle = Infinity;
  const _pinQuat = new THREE.Quaternion();
  const _pinDir = new THREE.Vector3();

  function pinAnnualInsolation() {
    if (pin.annualTilt !== state.tilt) {
      pin.annualTilt = state.tilt;
      pin.annual = annualMeanInsolation(pin.latDeg, state.tilt);
    }
    return pin.annual;
  }

  /** Keeps the camera above the pinned place (zoom distance is preserved). */
  function syncPinnedCamera() {
    if (!pin) return;
    spinGroup.getWorldQuaternion(_pinQuat);
    _pinDir.copy(pin.dirLocal).applyQuaternion(_pinQuat);
    // avoid the lookAt singularity straight above a pole
    const y = THREE.MathUtils.clamp(_pinDir.y, -0.995, 0.995);
    const radial = Math.sqrt(1 - y * y);
    const xz = Math.hypot(_pinDir.x, _pinDir.z);
    if (xz < 1e-4) _pinDir.set(radial, y, 0);
    else _pinDir.set((_pinDir.x / xz) * radial, y, (_pinDir.z / xz) * radial);
    const distance = camera.position.length(); // read before overwriting the position
    camera.position.copy(_pinDir).multiplyScalar(distance);
    camera.lookAt(0, 0, 0);
  }

  function setPin(worldPoint) {
    const dirLocal = spinGroup.worldToLocal(worldPoint.clone()).normalize();
    pin = {
      dirLocal,
      latDeg: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dirLocal.y, -1, 1))),
      annual: 0,
      annualTilt: NaN,
    };
    pinMarker.position.copy(dirLocal); // tip on the surface (radius 1)
    pinMarker.quaternion.setFromUnitVectors(UP, dirLocal).multiply(PIN_LEAN);
    pinMarker.visible = true;
    controls.enableRotate = false;
    syncPinnedCamera();
    updatePinReadout(true);
    sim.requestRender();
  }

  function unpin() {
    pin = null;
    pinMarker.visible = false;
    controls.enableRotate = true;
    updatePinReadout(true);
    sim.requestRender();
  }

  // click (not drag) on the planet pins a place
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let downX = 0;
  let downY = 0;
  const onPointerDown = (e) => {
    downX = e.clientX;
    downY = e.clientY;
  };
  const onPointerUp = (e) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return; // was a drag
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    scene.updateMatrixWorld();
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.intersectObject(planet, false)[0];
    if (hit) setPin(hit.point);
    else if (pin) unpin(); // clicking past the planet releases the pin
  };
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);

  // --- state → scene -----------------------------------------------------------
  function applyOrbit() {
    const theta = THREE.MathUtils.degToRad(state.orbitAngle);
    sunGroup.rotation.y = theta;
    terminator.rotation.y = Math.PI / 2 + theta; // keep the ring perpendicular to the sun
    sunDirUniform.value.set(Math.cos(theta), 0, -Math.sin(theta)); // for the city-lights shader
    updateClimateTexture();
    updateSeasonReadout();
    updatePinReadout();
    sim.requestRender();
  }

  function applyState() {
    tiltGroup.rotation.z = THREE.MathUtils.degToRad(-state.tilt);
    axis.visible = state.showAxis;
    equator.visible = state.showEquator;
    terminator.visible = state.showTerminator;
    climateOverlay.visible = state.showClimate;
    livableShade.visible = state.showLivable;
    livableBorders.visible = state.showLivable;
    updateHabitability();
    applyOrbit();
    syncPinnedCamera();
  }

  sim.onFrame((dt) => {
    spinGroup.rotation.y += THREE.MathUtils.degToRad(state.rotationSpeed) * dt;
    if (state.yearSpeed > 0) {
      state.orbitAngle = normalizeDeg(state.orbitAngle + state.yearSpeed * dt);
      applyOrbit();
    }
    syncPinnedCamera();
  });

  // --- readouts ------------------------------------------------------------------
  const formatC = (v) => `${formatNumber(v, { maximumFractionDigits: 0 })}\u2009${t('units.celsius')}`;

  const seasonReadout = createReadout(`${KEYS}.readout.season`);
  const midReadout = createReadout(`${KEYS}.readout.midLatitude`);

  const habReadout = createReadout(`${KEYS}.readout.habitable`);
  habReadout.el.classList.add('lp-readout--zone');
  const habState = el('span', 'lp-state');
  const habHint = el('p', 'lp-state__hint');
  habReadout.el.append(habState, habHint);

  const pinReadout = createReadout(`${KEYS}.readout.pinned`);
  pinReadout.el.classList.add('lp-readout--zone');
  const pinState = el('span', 'lp-state');
  const unpinBtn = createButton({ labelKey: `${KEYS}.pin.unpin`, icon: '✕', onClick: unpin });
  const pinHint = bindText(el('p', 'lp-state__hint'), `${KEYS}.pin.hint`);
  pinReadout.el.append(pinState, unpinBtn.el, pinHint);

  let seasonQuadrant = -1;
  function updateSeasonReadout(force = false) {
    const quadrant = Math.floor(normalizeDeg(state.orbitAngle) / 90) % 4;
    if (!force && quadrant === seasonQuadrant) return;
    seasonQuadrant = quadrant;
    const seasons = seasonAt(state.orbitAngle);
    seasonReadout.value.textContent =
      `N ${t(`sims.seasons.seasons.${seasons.north}`)} · S ${t(`sims.seasons.seasons.${seasons.south}`)}`;
  }

  function updatePinReadout(force = false) {
    if (!pin) {
      pinReadout.value.textContent = '–';
      pinState.hidden = true;
      unpinBtn.el.hidden = true;
      pinHint.hidden = false;
      pinReadout.el.classList.remove('is-inner', 'is-habitable', 'is-outer');
      return;
    }
    if (!force && Math.abs(state.orbitAngle - lastPinAngle) < 1) return;
    lastPinAngle = state.orbitAngle;
    const annual = pinAnnualInsolation();
    const decl = declinationDeg(state.tilt, state.orbitAngle);
    const { meanC } = temperatureEstimate(pin.latDeg, state.tilt, decl, EARTH_ROTATION_H, annual);
    const season = seasonAt(state.orbitAngle)[pin.latDeg >= 0 ? 'north' : 'south'];
    const latText = `${formatNumber(Math.abs(pin.latDeg), { maximumFractionDigits: 0 })}° ${pin.latDeg >= 0 ? 'N' : 'S'}`;
    pinReadout.value.textContent = `${latText} · ${t(`sims.seasons.seasons.${season}`)} · ${formatC(meanC)}`;
    const livable = isLivable(seasonalExtremes(pin.latDeg, state.tilt, annual));
    pinState.hidden = false;
    pinState.className = `lp-state lp-state--${livable ? 'habitable' : 'scorched'}`;
    pinState.textContent = t(`${KEYS}.pin.${livable ? 'livable' : 'notLivable'}`);
    pinReadout.el.classList.toggle('is-habitable', livable);
    pinReadout.el.classList.toggle('is-inner', !livable);
    unpinBtn.el.hidden = false;
    pinHint.hidden = true;
  }

  function updateHabitability() {
    const bands = livableBands(state.tilt);
    updateLivableVisuals(bands);
    const fraction = bandsFraction(bands);
    const verdict = verdictFor(state.tilt);
    habReadout.value.textContent = `${formatNumber(fraction * 100, { maximumFractionDigits: 0 })}${t('units.percent')}`;
    habState.className = `lp-state lp-state--${VERDICT_STATE[verdict]}`;
    habState.textContent = t(`${KEYS}.verdictLabel.${verdict}`);
    habHint.textContent = t(`${KEYS}.verdict.${verdict}`);
    habReadout.el.classList.remove('is-inner', 'is-habitable', 'is-outer');
    habReadout.el.classList.add(VERDICT_ZONE[verdict]);

    const mid = seasonalExtremes(45, state.tilt);
    midReadout.value.textContent = `${formatC(mid.summerC)} / ${formatC(mid.winterC)}`;

    updatePinReadout(true);
  }

  const unsubscribeLanguage = onLanguageChange(() => {
    updateSeasonReadout(true);
    updateHabitability();
  });

  // --- UI ----------------------------------------------------------------------------
  const panel = createPanel();

  const tiltSlider = createSlider({
    labelKey: `${KEYS}.controls.tilt`,
    unitKey: 'units.degrees',
    min: 0, max: 90, step: 0.1, value: state.tilt, decimals: 1,
    onChange: (v) => { state.tilt = v; applyState(); },
  });
  const yearSlider = createSlider({
    labelKey: `${KEYS}.controls.yearSpeed`,
    unitKey: 'units.degreesPerSecond',
    min: 0, max: 60, step: 1, value: state.yearSpeed, decimals: 0,
    onChange: (v) => { state.yearSpeed = v; },
  });
  const speedSlider = createSlider({
    labelKey: `${KEYS}.controls.rotationSpeed`,
    unitKey: 'units.degreesPerSecond',
    min: 0, max: 180, step: 1, value: state.rotationSpeed, decimals: 0,
    onChange: (v) => { state.rotationSpeed = v; },
  });

  // jump to a season stop (also the only way to move through the year with the animation off)
  const stopRow = el('div', 'lp-presets');
  for (const stop of SEASON_STOPS) {
    const btn = el('button', 'lp-button lp-button--ghost lp-presets__btn', { type: 'button' });
    btn.append(bindText(el('span'), `${KEYS}.seasonStops.${stop.id}`));
    btn.addEventListener('click', () => {
      state.orbitAngle = stop.angleDeg;
      applyOrbit();
    });
    stopRow.append(btn);
  }

  const climateToggle = createStateToggle({
    labelKey: `${KEYS}.controls.showClimate`,
    state, name: 'showClimate', prefs: viewPrefs,
    onChange: (v) => {
      heatLegend.el.hidden = !v;
      applyState();
    },
  });
  const heatLegend = createHeatLegend();
  heatLegend.el.hidden = !state.showClimate;

  const livableToggle = createStateToggle({
    labelKey: `${KEYS}.controls.showLivable`,
    state, name: 'showLivable', prefs: viewPrefs,
    onChange: () => applyState(),
  });
  const axisToggle = createStateToggle({
    labelKey: `${KEYS}.controls.showAxis`,
    state, name: 'showAxis', prefs: viewPrefs,
    onChange: () => applyState(),
  });
  const equatorToggle = createStateToggle({
    labelKey: `${KEYS}.controls.showEquator`,
    state, name: 'showEquator', prefs: viewPrefs,
    onChange: () => applyState(),
  });
  const terminatorToggle = createStateToggle({
    labelKey: `${KEYS}.controls.showTerminator`,
    state, name: 'showTerminator', prefs: viewPrefs,
    onChange: () => applyState(),
  });

  const buttonRow = el('div', 'lp-button-row');
  const resetBtn = createButton({
    labelKey: 'panel.reset',
    icon: '↺',
    onClick: () => {
      Object.assign(state, DEFAULTS);
      tiltSlider.setValue(state.tilt, { silent: true });
      yearSlider.setValue(state.yearSpeed, { silent: true });
      speedSlider.setValue(state.rotationSpeed, { silent: true });
      spinGroup.rotation.y = 0;
      seasonQuadrant = -1;
      unpin();
      applyState();
    },
  });
  const playBtn = createButton({
    labelKey: 'motion.pause',
    icon: '⏸',
    onClick: () => {
      sim.setPaused(!sim.paused);
      syncPlayButton();
    },
  });
  const syncPlayButton = () => {
    const paused = sim.paused;
    playBtn.el.querySelector('.lp-button__icon').textContent = paused ? '▶' : '⏸';
    bindText(playBtn.el.querySelector('[data-i18n]'), paused ? 'motion.play' : 'motion.pause');
  };
  buttonRow.append(playBtn.el, resetBtn.el);

  const modelNote = bindText(el('p', 'lp-section__note'), `${KEYS}.readout.modelNote`);

  panel.add(
    tiltSlider, yearSlider, speedSlider, stopRow,
    seasonReadout, pinReadout, habReadout, midReadout, modelNote,
    climateToggle, heatLegend, livableToggle, axisToggle, equatorToggle, terminatorToggle,
    buttonRow,
  );
  if (sim.reducedMotion) panel.add(createNotice({ textKey: 'motion.reducedNotice' }));
  panel.add(createInfoCard({ titleKey: `${KEYS}.info.title`, bodyKey: `${KEYS}.info.body`, open: !window.matchMedia('(max-width: 720px)').matches }));
  container.append(panel.el);

  const hint = el('div', 'lp-sim__hint', { 'aria-hidden': 'true' });
  hint.append(bindText(el('span'), 'panel.hint'));
  const credit = el('div', 'lp-sim__credit');
  const creditLink = el('a', '', { href: 'https://www.solarsystemscope.com/textures/', target: '_blank', rel: 'noopener noreferrer license' });
  bindText(creditLink, `${KEYS}.credit`);
  credit.append(creditLink);
  container.append(hint, credit);

  applyState();
  sim.start();

  return () => {
    renderer.domElement.removeEventListener('pointerdown', onPointerDown);
    renderer.domElement.removeEventListener('pointerup', onPointerUp);
    unsubscribeLanguage();
    panel.dispose();
    hint.remove();
    credit.remove();
    sim.dispose();
    viewport.remove();
  };
}

// --- small UI helpers ---------------------------------------------------------------
function createReadout(labelKey) {
  const box = el('div', 'lp-readout');
  const value = el('span', 'lp-readout__value');
  box.append(bindText(el('span', 'lp-readout__label'), labelKey), value);
  return { el: box, value, dispose() {} };
}

function createHeatLegend() {
  const wrap = el('div', 'lp-heat-legend');
  const scale = el('div', 'lp-heat-legend__scale');
  scale.append(bindText(el('span'), `${KEYS}.legend.low`), bindText(el('span'), `${KEYS}.legend.high`));
  wrap.append(
    bindText(el('span'), `${KEYS}.legend.title`),
    el('div', 'lp-heat-legend__bar', { 'aria-hidden': 'true' }),
    scale,
  );
  return { el: wrap, dispose() {} };
}

// --- procedural textures (fallbacks, no external assets) --------------------------
function createPlanetTexture(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size * 2;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  // ocean gradient
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, '#9cc9ff');
  g.addColorStop(0.15, '#2a63b8');
  g.addColorStop(0.5, '#1d4f9c');
  g.addColorStop(0.85, '#2a63b8');
  g.addColorStop(1, '#dbe9ff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // pseudo-random continents (seeded so every load looks the same)
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = '#4f8a3c';
  for (let i = 0; i < 140; i++) {
    const x = rnd() * canvas.width;
    const y = size * (0.12 + rnd() * 0.76);
    const r = 12 + rnd() * 60;
    ctx.globalAlpha = 0.75 + rnd() * 0.25;
    ctx.beginPath();
    ctx.ellipse(x, y, r * (0.6 + rnd()), r * (0.4 + rnd() * 0.6), rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // meridian grid
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 24; i++) {
    const x = (i / 24) * canvas.width;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
  }
  for (let i = 0; i <= 12; i++) {
    const y = (i / 12) * size;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function createGlowTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,220,150,0.6)');
  g.addColorStop(1, 'rgba(255,200,100,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
