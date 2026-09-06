/**
 * Simulation: Earth's orbit & the habitable zone ("solar-orbit").
 *
 * All eight planets orbit the Sun at positions computed from the JPL approximate
 * Keplerian elements (1800–2050). Earth is highlighted, the conservative habitable
 * zone (0.95–1.68 au, from the habitable-zone simulation's physics) is drawn as a
 * translucent annulus, and a hypothetical
 * eccentric Earth orbit (e = 0.3) can be overlaid for comparison.
 *
 * Scene units: 1 au = AU_UNITS. Ecliptic (x, y, z) → scene (x, z, −y) so the
 * ecliptic north pole points up and planets orbit counter-clockwise seen from above.
 */
import * as THREE from 'three';
import { createScene } from '../../lib/scene.js';
import { createPanel, createPanelShift, createCollapsibleSection, createStateToggle, createButton, createNotice, el } from '../../lib/ui.js';
import { createViewPrefs } from '../../lib/prefs.js';
import { t, bindText, bindAttr, onLanguageChange, formatNumber, getLocale } from '../../lib/i18n.js';
import { planetPosition, orbitPath, orbitalPeriodDays, apsides, dateToJD, jdToDate, AU_KM, J2000_JD, DAYS_PER_YEAR, VALID_RANGE } from './kepler.js';
import { SUN, PLANETS, HABITABLE_ZONE_AU, HYPOTHETICAL_ECCENTRICITY } from './planets.js';

const AU_UNITS = 10; // scene units per astronomical unit
const VISUAL_PLANET_SCALE = 1000; // planet radii exaggeration in "visual" mode
const VISUAL_SUN_SCALE = 30; // the Sun gets its own (smaller) exaggeration so Mercury stays outside it
const MAX_DAYS_PER_SECOND = DAYS_PER_YEAR; // 1 year/s
const ORBIT_SEGMENTS = 360;
const HIT_LAYER = 1;
const TEXTURE_BASE = `${import.meta.env.BASE_URL}textures/`;
const KEYS = 'sims.solarOrbit';

const DEFAULTS = Object.freeze({
  speedSlider: 58, // ≈ 30 days/s
});

/** The camera views, in the order the panel's header button steps through them. */
const CAMERA_VIEWS = Object.freeze([
  { id: 'overview', labelKey: `${KEYS}.controls.overview`, icon: '◎' },
  { id: 'followEarth', labelKey: `${KEYS}.controls.followEarth`, icon: '🌍' },
  { id: 'outerSystem', labelKey: `${KEYS}.controls.outerSystem`, icon: '⟳' },
]);

/** Display toggles – remembered per visitor, see ../../lib/prefs.js. */
const VIEW_DEFAULTS = Object.freeze({
  showZone: true,
  showLabels: true,
  trueScale: false,
  showEccentric: false,
});

/** ecliptic → scene */
const toScene = (p, target = new THREE.Vector3()) => target.set(p.x * AU_UNITS, p.z * AU_UNITS, -p.y * AU_UNITS);
const kmToUnits = (km) => (km / AU_KM) * AU_UNITS;
const sliderToDaysPerSecond = (v) => (v <= 0 ? 0 : Math.pow(MAX_DAYS_PER_SECOND, (v - 1) / 99));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export default function mount(container, meta) {
  const viewPrefs = createViewPrefs(meta.id, VIEW_DEFAULTS);
  const state = {
    ...DEFAULTS,
    ...viewPrefs.values,
    jd: clamp(dateToJD(new Date()), VALID_RANGE.minJD, VALID_RANGE.maxJD),
    follow: false,
    selected: null,
  };
  const disposers = [];

  const viewport = el('div', 'lp-sim__viewport');
  container.append(viewport);

  const sim = createScene({
    container: viewport,
    cameraPosition: [0, 30, 38],
    near: 0.01,
    far: 20000,
    stars: { count: 3000, radius: 8000 },
    controls: { minDistance: 0.6, maxDistance: 6000 },
  });
  const { scene, camera, renderer, controls } = sim;
  camera.lookAt(0, 0, 0);
  const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // --- textures ------------------------------------------------------------------
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
      () => console.warn(`[solar-orbit] texture not available: ${file} – using flat colour`),
    );
  }

  // --- lighting ----------------------------------------------------------------------
  const sunLight = new THREE.PointLight(0xfff1dc, 3.2, 0, 0); // decay 0: every planet is lit equally (visual choice)
  scene.add(sunLight, new THREE.AmbientLight(0x8090b8, 0.9)); // generous fill light so backlit night sides stay readable

  // --- Sun ---------------------------------------------------------------------------------
  const sunTrueRadius = kmToUnits(SUN.radiusKm);
  const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xffe0a0, toneMapped: false });
  const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), sunMaterial);
  sunMesh.name = 'sun';
  scene.add(sunMesh);
  loadTexture(SUN.texture, (tex) => {
    sunMaterial.map = tex;
    sunMaterial.color.set(0xffffff);
    sunMaterial.needsUpdate = true;
  });
  const glowTexture = createGlowTexture();
  const sunGlowWorld = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xffc46a, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  const sunGlowScreen = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xffd9a0, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false, sizeAttenuation: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  sunGlowScreen.scale.set(0.09, 0.09, 1);
  sunGlowScreen.renderOrder = 5;
  scene.add(sunGlowWorld, sunGlowScreen);

  // --- habitable zone --------------------------------------------------------------------------
  const zoneGroup = new THREE.Group();
  zoneGroup.rotation.x = -Math.PI / 2;
  const zoneInner = HABITABLE_ZONE_AU.inner * AU_UNITS;
  const zoneOuter = HABITABLE_ZONE_AU.outer * AU_UNITS;
  const zoneFill = new THREE.Mesh(
    new THREE.RingGeometry(zoneInner, zoneOuter, 192),
    new THREE.MeshBasicMaterial({ color: 0x5adc8c, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }),
  );
  zoneFill.renderOrder = -2;
  const zoneEdgeMaterial = new THREE.MeshBasicMaterial({ color: 0x8cf0b0, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const edgeWidth = 0.012 * AU_UNITS;
  const zoneEdgeInner = new THREE.Mesh(new THREE.RingGeometry(zoneInner - edgeWidth, zoneInner, 192), zoneEdgeMaterial);
  const zoneEdgeOuter = new THREE.Mesh(new THREE.RingGeometry(zoneOuter, zoneOuter + edgeWidth, 192), zoneEdgeMaterial);
  zoneEdgeInner.renderOrder = zoneEdgeOuter.renderOrder = -1;
  zoneGroup.add(zoneFill, zoneEdgeInner, zoneEdgeOuter);
  scene.add(zoneGroup);

  // --- planets -------------------------------------------------------------------------------------
  const labelFont = getComputedStyle(document.documentElement).getPropertyValue('--lp-font') || 'sans-serif';
  const bodies = []; // { def, group, tiltGroup, mesh, material, trueRadius, label, hit, orbitLine?, ring? }

  function createLabel(text, color) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: createLabelTexture(text, color, labelFont), transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false }));
    sprite.scale.set(0.2, 0.05, 1);
    sprite.renderOrder = 10;
    return sprite;
  }

  function createBody(def, { trueRadius, geometry, material }) {
    const group = new THREE.Group();
    const tiltGroup = new THREE.Group();
    if (def.axialTiltDeg) tiltGroup.rotation.z = THREE.MathUtils.degToRad(def.axialTiltDeg);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = def.id;
    tiltGroup.add(mesh);
    group.add(tiltGroup);

    const hit = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial());
    hit.layers.set(HIT_LAYER);
    hit.userData.bodyId = def.id;

    const label = createLabel(t(`${KEYS}.planets.${def.id}`), def.orbitColor ?? def.color);
    scene.add(group, label, hit); // hit sphere lives in world space (positioned in updateOverlay)
    return { def, group, tiltGroup, mesh, material, trueRadius, label, hit };
  }

  const sunBody = createBody(SUN, { trueRadius: sunTrueRadius, geometry: new THREE.SphereGeometry(1, 8, 6), material: new THREE.MeshBasicMaterial({ visible: false }) });
  sunBody.mesh.visible = false; // the visible Sun is `sunMesh`; this body only provides label + hit sphere
  bodies.push(sunBody);

  const planetGeometry = new THREE.SphereGeometry(1, 48, 32);
  for (const def of PLANETS) {
    const material = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.9, metalness: 0 });
    const body = createBody(def, { trueRadius: kmToUnits(def.radiusKm), geometry: planetGeometry, material });
    loadTexture(def.texture, (tex) => {
      material.map = tex;
      material.color.set(0xffffff);
      material.needsUpdate = true;
    });
    if (def.ring) {
      const inner = def.ring.innerKm / def.radiusKm;
      const outer = def.ring.outerKm / def.radiusKm;
      const ringGeometry = new THREE.RingGeometry(inner, outer, 128, 1);
      // Solar System Scope's ring texture is a radial strip: map u to the radius.
      const pos = ringGeometry.attributes.position;
      const uv = ringGeometry.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getY(i));
        uv.setXY(i, (r - inner) / (outer - inner), 0.5);
      }
      const ringMaterial = new THREE.MeshStandardMaterial({ color: 0xd8c9a3, roughness: 1, metalness: 0, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      body.tiltGroup.add(ring);
      body.ring = ring;
      loadTexture(def.ring.texture, (tex) => {
        ringMaterial.map = tex;
        ringMaterial.alphaMap = tex;
        ringMaterial.color.set(0xffffff);
        ringMaterial.needsUpdate = true;
      });
    }
    bodies.push(body);
  }
  const earth = bodies.find((b) => b.def.id === 'earth');
  const bodyById = new Map(bodies.map((b) => [b.def.id, b]));

  // --- orbit lines -------------------------------------------------------------------------------------
  const orbitLines = new Map();
  for (const def of PLANETS) {
    const isEarth = def.id === 'earth';
    const material = new THREE.LineBasicMaterial({ color: def.orbitColor, transparent: true, opacity: isEarth ? 0.95 : 0.45, depthWrite: false });
    const line = new THREE.Line(new THREE.BufferGeometry(), material);
    line.renderOrder = isEarth ? 2 : 1;
    line.frustumCulled = false;
    scene.add(line);
    orbitLines.set(def.id, line);
  }
  const eccentricLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({ color: 0xff5a5a, dashSize: 0.3 * AU_UNITS * 0.1, gapSize: 0.18 * AU_UNITS * 0.1, transparent: true, opacity: 0.95, depthWrite: false }),
  );
  eccentricLine.renderOrder = 3;
  eccentricLine.frustumCulled = false;
  scene.add(eccentricLine);
  // ghost Earth travelling on the hypothetical orbit
  const ghostEarth = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.6, depthWrite: false }));
  scene.add(ghostEarth);

  let orbitsJD = -Infinity;
  function rebuildOrbits(jd) {
    orbitsJD = jd;
    for (const def of PLANETS) {
      const pts = orbitPath(def.id, jd, ORBIT_SEGMENTS).map((p) => toScene(p));
      orbitLines.get(def.id).geometry.setFromPoints(pts);
    }
    const eccPts = orbitPath('earth', jd, ORBIT_SEGMENTS, { e: HYPOTHETICAL_ECCENTRICITY }).map((p) => toScene(p));
    eccentricLine.geometry.setFromPoints(eccPts);
    eccentricLine.computeLineDistances();
  }

  // --- Earth highlight -------------------------------------------------------------------------------------
  const earthGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0x7cc4ff, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }));
  earthGlow.renderOrder = 4;
  const earthMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: createRingTexture(), color: 0x9fd8ff, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, sizeAttenuation: false }));
  earthMarker.renderOrder = 9;
  const labelLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false }),
  );
  labelLine.renderOrder = 9;
  labelLine.frustumCulled = false;
  scene.add(earthGlow, earthMarker, labelLine);

  // --- scene update ------------------------------------------------------------------------------------------
  const tmpV = new THREE.Vector3();
  const tmpUp = new THREE.Vector3();
  const tmpDelta = new THREE.Vector3();
  const positions = new Map(); // id → THREE.Vector3 (scene units)
  for (const b of bodies) positions.set(b.def.id, new THREE.Vector3());
  let earthDistanceAU = 1;
  let ghostDistanceAU = 1;

  function updateBodies() {
    const jd = state.jd;
    if (Math.abs(jd - orbitsJD) > DAYS_PER_YEAR * 2) rebuildOrbits(jd);
    const planetScale = state.trueScale ? 1 : VISUAL_PLANET_SCALE;
    const sunRadius = sunTrueRadius * (state.trueScale ? 1 : VISUAL_SUN_SCALE);
    sunMesh.scale.setScalar(sunRadius);
    sunMesh.rotation.y = (2 * Math.PI * (jd - J2000_JD)) / SUN.rotationDays;
    sunGlowWorld.scale.setScalar(sunRadius * 7);
    sunBody.radius = sunRadius;

    for (const body of bodies) {
      if (body === sunBody) continue;
      const def = body.def;
      const p = planetPosition(def.id, jd);
      const pos = toScene(p, positions.get(def.id));
      body.group.position.copy(pos);
      body.radius = body.trueRadius * planetScale;
      body.mesh.scale.setScalar(body.radius);
      if (body.ring) body.ring.scale.setScalar(body.radius);
      body.mesh.rotation.y = (2 * Math.PI * (jd - J2000_JD)) / def.rotationDays;
      if (def.id === 'earth') earthDistanceAU = p.r;
    }
    const ghost = planetPosition('earth', jd, { e: HYPOTHETICAL_ECCENTRICITY });
    ghostDistanceAU = ghost.r;
    toScene(ghost, ghostEarth.position);
    ghostEarth.scale.setScalar(earth.radius * 0.9);
  }

  /** Camera-dependent bits: labels, hit spheres, marker, glow, follow target. */
  function updateOverlay() {
    // screen-space "up" in world coordinates
    tmpUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    for (const body of bodies) {
      const pos = positions.get(body.def.id);
      const dist = Math.max(camera.position.distanceTo(pos), 1e-6);
      body.hit.scale.setScalar(Math.max(body.radius * 1.4, dist * 0.014));
      body.hit.position.copy(pos);
      body.label.visible = state.showLabels;
      if (state.showLabels) {
        // planets: label above; Sun: label below (keeps it clear of Mercury/Venus labels)
        const dir = body === sunBody ? -1 : 1;
        body.label.position.copy(pos).addScaledVector(tmpUp, dir * (body.radius + dist * 0.032));
      }
    }
    const earthPos = positions.get('earth');
    const earthDist = Math.max(camera.position.distanceTo(earthPos), 1e-6);
    earthGlow.position.copy(earthPos);
    earthGlow.scale.setScalar(Math.max(earth.radius * 6, earthDist * 0.03));
    earthMarker.position.copy(earthPos);
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.004);
    earthMarker.scale.setScalar(0.035 + pulse * 0.02);
    earthMarker.material.opacity = 0.9 - pulse * 0.55;
    labelLine.visible = state.showLabels;
    if (state.showLabels) {
      const linePos = labelLine.geometry.attributes.position;
      tmpV.copy(earthPos).addScaledVector(tmpUp, earth.radius);
      linePos.setXYZ(0, tmpV.x, tmpV.y, tmpV.z);
      tmpV.copy(earthPos).addScaledVector(tmpUp, earth.radius + earthDist * 0.012);
      linePos.setXYZ(1, tmpV.x, tmpV.y, tmpV.z);
      linePos.needsUpdate = true;
    }
    // fade the habitable-zone plane out when the camera gets close to a planet (it would slice through it)
    const targetDist = camera.position.distanceTo(controls.target);
    const zoneFade = clamp((targetDist - 1.5) / 6, 0, 1);
    zoneFill.material.opacity = 0.2 * zoneFade;
    zoneEdgeMaterial.opacity = 0.55 * zoneFade;
    // adaptive near plane: keeps depth precision usable from 0.001 au to 40 au
    const near = clamp(targetDist * 0.002, 0.0002, 2);
    if (Math.abs(camera.near - near) / near > 0.2) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
  }

  function applyFollow() {
    if (!state.follow || cameraTween) return;
    const earthPos = positions.get('earth');
    tmpDelta.copy(earthPos).sub(controls.target);
    controls.target.copy(earthPos);
    camera.position.add(tmpDelta);
  }

  function applyView() {
    zoneGroup.visible = state.showZone;
    eccentricLine.visible = state.showEccentric;
    ghostEarth.visible = state.showEccentric;
    controls.minDistance = state.trueScale ? 0.0008 : 0.6;
    updateBodies();
    applyFollow();
    updateOverlay();
    sim.requestRender();
  }

  // --- camera presets ---------------------------------------------------------------------------------------
  let cameraTween = null;
  /**
   * Smoothly move camera + orbit target. With `followEarth` the destination is
   * re-evaluated every frame (Earth keeps moving while the tween runs), using the
   * given offset relative to Earth.
   */
  function tweenCamera(toPosition, toTarget, { duration = 0.9, followEarth = false } = {}) {
    const offset = followEarth ? toPosition.clone().sub(toTarget) : null;
    if (sim.reducedMotion || duration <= 0) {
      camera.position.copy(toPosition);
      controls.target.copy(toTarget);
      cameraTween = null;
      controls.update();
      updateOverlay();
      sim.requestRender();
      return;
    }
    cameraTween = { t: 0, duration, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: toPosition.clone(), toTarget: toTarget.clone(), offset };
  }
  function stepTween(dt) {
    if (!cameraTween) return;
    const tw = cameraTween;
    tw.t = Math.min(1, tw.t + dt / tw.duration);
    if (tw.offset) {
      tw.toTarget.copy(positions.get('earth'));
      tw.toPos.copy(tw.toTarget).add(tw.offset);
    }
    const k = easeInOut(tw.t);
    camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
    controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
    if (tw.t >= 1) cameraTween = null;
  }
  let cameraMode = 'overview';
  const presets = {
    overview() {
      state.follow = false;
      tweenCamera(new THREE.Vector3(0, 30, 38), new THREE.Vector3(0, 0, 0));
    },
    outerSystem() {
      state.follow = false;
      tweenCamera(new THREE.Vector3(0, 360, 480), new THREE.Vector3(0, 0, 0));
    },
    followEarth() {
      state.follow = true;
      const earthPos = positions.get('earth');
      const radial = tmpV.copy(earthPos).normalize();
      const side = new THREE.Vector3().crossVectors(radial, new THREE.Vector3(0, 1, 0)).normalize();
      const k = earth.radius;
      const pos = earthPos.clone().addScaledVector(side, 3.2 * k).addScaledVector(radial, 1.2 * k).add(new THREE.Vector3(0, 1.6 * k, 0));
      tweenCamera(pos, earthPos, { followEarth: true });
    },
  };
  /** Fly to a camera view and keep the panel – its preset row and its header button – in step. */
  function setCamera(id, { announce = false } = {}) {
    cameraMode = id;
    presets[id]?.();
    syncCameraButtons({ announce });
  }

  // --- time ------------------------------------------------------------------------------------------------------------
  let daysPerSecond = sliderToDaysPerSecond(state.speedSlider);
  function setJD(jd, { fromInput = false } = {}) {
    const clamped = clamp(jd, VALID_RANGE.minJD, VALID_RANGE.maxJD);
    const hitLimit = clamped !== jd;
    state.jd = clamped;
    if (hitLimit && !fromInput && daysPerSecond > 0) speedControl.setValue(0); // stop at the table's validity limit
    dateControl.setOutOfRange(hitLimit);
    updateBodies();
    applyFollow();
    updateOverlay();
    dateControl.sync(true);
    updateLiveFacts();
    sim.requestRender();
  }

  function frame(dt) {
    if (daysPerSecond > 0) {
      const next = state.jd + dt * daysPerSecond;
      if (next > VALID_RANGE.maxJD || next < VALID_RANGE.minJD) setJD(next);
      else {
        state.jd = next;
        updateBodies();
      }
    }
    stepTween(dt);
    applyFollow();
    updateOverlay();
    dateControl.sync(false);
    updateLiveFacts();
  }
  sim.onFrame(frame);
  const onControlsChange = () => {
    if (sim.reducedMotion) updateOverlay();
  };
  controls.addEventListener('change', onControlsChange);
  disposers.push(() => controls.removeEventListener('change', onControlsChange));

  // --- picking -----------------------------------------------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  raycaster.layers.set(HIT_LAYER);
  const pointer = new THREE.Vector2();
  let pressStart = null;
  const onPointerDown = (e) => {
    pressStart = { x: e.clientX, y: e.clientY, time: performance.now() };
  };
  const onPointerUp = (e) => {
    if (!pressStart) return;
    const moved = Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y);
    const elapsed = performance.now() - pressStart.time;
    pressStart = null;
    if (moved > 6 || elapsed > 600) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(bodies.map((b) => b.hit), false);
    if (hits.length) selectBody(hits[0].object.userData.bodyId);
    else if (state.selected) selectBody(null);
  };
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  disposers.push(() => {
    renderer.domElement.removeEventListener('pointerdown', onPointerDown);
    renderer.domElement.removeEventListener('pointerup', onPointerUp);
  });

  // --- UI: panel --------------------------------------------------------------------------------------------------------------
  // while the panel is open on a wide screen the picture slides left, so what the
  // simulation shows stays centred in the free part of the canvas
  const viewShift = createPanelShift({ sim, viewport });
  const panel = createPanel({
    onToggle: () => viewShift.sync(),
    camera: { views: CAMERA_VIEWS, onSelect: (id) => setCamera(id) },
  });

  // --- controls: the time speed up front, date, view and camera folded away ------------------------
  const speedControl = createSpeedControl({
    value: state.speedSlider,
    onChange: (v) => {
      state.speedSlider = v;
      daysPerSecond = sliderToDaysPerSecond(v);
      if (v > 0) dateControl.setOutOfRange(false);
    },
  });

  const moreControls = createCollapsibleSection({ titleKey: `${KEYS}.sections.more`, open: false });
  const dateControl = createDateControl({
    getJD: () => state.jd,
    onChange: (jd) => setJD(jd, { fromInput: true }),
  });
  const cameraRow = el('div', 'lp-presets lp-presets--3 lp-presets--compact', { role: 'group' });
  bindAttr(cameraRow, { 'aria-label': `${KEYS}.sections.camera` });
  const cameraButtons = CAMERA_VIEWS.map(({ id, labelKey, icon }) => {
    const btn = createButton({ labelKey, icon, onClick: () => setCamera(id) });
    btn.el.classList.add('lp-presets__btn');
    cameraRow.append(btn.el);
    return { id, el: btn.el };
  });
  function syncCameraButtons({ announce = false } = {}) {
    for (const { id, el: btn } of cameraButtons) btn.setAttribute('aria-pressed', String(cameraMode === id));
    panel.setCameraView(cameraMode, { announce });
  }
  const viewToggle = (name, labelKey, onChange) => createStateToggle({ labelKey, state, name, prefs: viewPrefs, onChange });
  const zoneToggle = viewToggle('showZone', `${KEYS}.controls.habitableZone`, () => applyView());
  const labelsToggle = viewToggle('showLabels', `${KEYS}.controls.labels`, () => applyView());
  const scaleToggle = viewToggle('trueScale', `${KEYS}.controls.trueScale`, () => { applyView(); if (state.follow) presets.followEarth(); });
  const eccentricToggle = viewToggle('showEccentric', `${KEYS}.controls.eccentricOrbit`, () => { applyView(); renderInfo(); });

  const resetBtn = createButton({
    labelKey: 'panel.reset',
    icon: '↺',
    onClick: () => {
      Object.assign(state, DEFAULTS);
      speedControl.setValue(state.speedSlider, { silent: true });
      daysPerSecond = sliderToDaysPerSecond(state.speedSlider);
      selectBody(null);
      setJD(clamp(dateToJD(new Date()), VALID_RANGE.minJD, VALID_RANGE.maxJD), { fromInput: true });
      applyView();
      renderInfo();
      setCamera('overview');
    },
  });
  const resetRow = el('div', 'lp-button-row lp-button-row--full');
  resetRow.append(resetBtn.el);

  moreControls.add(dateControl);
  if (sim.reducedMotion) moreControls.add(createNotice({ textKey: 'motion.reducedNotice' }));
  moreControls.add(
    bindText(el('p', 'lp-subheading'), `${KEYS}.sections.view`), cameraRow,
    zoneToggle, labelsToggle, scaleToggle, eccentricToggle, resetRow,
  );

  const legend = createLegend();
  panel.add(speedControl, moreControls, legend);

  // info card (custom content: facts list + notes)
  const info = el('details', 'lp-info');
  info.open = !window.matchMedia('(max-width: 720px)').matches;
  const infoSummary = el('summary', 'lp-info__summary');
  infoSummary.append(bindText(el('span', 'lp-info__title'), `${KEYS}.info.title`));
  const infoBody = el('div', 'lp-info__body');
  info.append(infoSummary, infoBody);
  let liveDistanceEl = null;
  let liveGhostEl = null;
  function renderInfo() {
    infoBody.replaceChildren();
    const live = el('dl', 'lp-facts lp-facts--accent');
    liveDistanceEl = el('dd');
    live.append(dt(`${KEYS}.card.distanceNow`), liveDistanceEl);
    if (state.showEccentric) {
      liveGhostEl = el('dd');
      liveGhostEl.style.color = 'var(--lp-danger)';
      live.append(dt(`${KEYS}.legend.eccentricOrbit`), liveGhostEl);
    } else liveGhostEl = null;
    const facts = el('dl', 'lp-facts');
    facts.append(
      dt(`${KEYS}.info.earthSun`), dd(t(`${KEYS}.info.earthSunValue`)),
      dt(`${KEYS}.info.eccentricity`), dd(t(`${KEYS}.info.eccentricityValue`)),
      dt(`${KEYS}.info.range`), dd(t(`${KEYS}.info.rangeValue`)),
    );
    infoBody.append(live, facts, para(t(`${KEYS}.info.note`)), para(t(`${KEYS}.info.zoneNote`)));
    if (state.showEccentric) infoBody.append(para(t(`${KEYS}.info.eccentricNote`)));
    infoBody.append(para(t(`${KEYS}.info.scaleNote`)));
    updateLiveFacts(true);
  }
  let lastLiveText = '';
  function updateLiveFacts(force = false) {
    if (!liveDistanceEl) return;
    const text = formatDistance(earthDistanceAU);
    if (force || text !== lastLiveText) {
      lastLiveText = text;
      liveDistanceEl.textContent = text;
      if (liveGhostEl) liveGhostEl.textContent = formatDistance(ghostDistanceAU);
    }
    planetCard.tick(force);
  }
  panel.add({ el: info });
  container.append(panel.el);
  viewShift.attach(panel);
  disposers.push(viewShift.dispose);

  // --- UI: planet card + credit + hint ------------------------------------------------------------------------------------------
  const planetCard = createPlanetCard({
    container,
    getBody: () => (state.selected ? bodyById.get(state.selected) : null),
    getDistanceAU: (id) => (id === 'sun' ? 0 : planetPosition(id, state.jd).r),
    onClose: () => selectBody(null),
  });
  function selectBody(id) {
    state.selected = id;
    planetCard.render();
  }

  const hint = el('div', 'lp-sim__hint', { 'aria-hidden': 'true' });
  hint.append(bindText(el('span'), 'panel.hint'), document.createTextNode(' · '), bindText(el('span'), `${KEYS}.card.clickHint`));
  const credit = el('div', 'lp-sim__credit');
  const creditLink = el('a', '', { href: 'https://www.solarsystemscope.com/textures/', target: '_blank', rel: 'noopener noreferrer license' });
  bindText(creditLink, `${KEYS}.credit`);
  credit.append(creditLink);
  container.append(hint, credit);

  // --- language ------------------------------------------------------------------------------------------------------------------
  disposers.push(
    onLanguageChange(() => {
      for (const body of bodies) {
        body.label.material.map.dispose();
        body.label.material.map = createLabelTexture(t(`${KEYS}.planets.${body.def.id}`), body.def.orbitColor ?? body.def.color, labelFont);
        body.label.material.needsUpdate = true;
      }
      renderInfo();
      planetCard.render();
      dateControl.sync(true);
      sim.requestRender();
    }),
  );

  // --- go ----------------------------------------------------------------------------------------------------------------------------
  renderInfo();
  rebuildOrbits(state.jd);
  applyView();
  dateControl.sync(true);
  syncCameraButtons();
  sim.start();

  // dev-only hook for automated checks (positions, render timing); stripped from production builds
  if (import.meta.env.DEV) window.__lpSolarOrbit = { sim, state, bodies, positions, setJD, presets, setCamera, selectBody, frame };

  return () => {
    if (import.meta.env.DEV) delete window.__lpSolarOrbit;
    disposers.forEach((d) => d());
    panel.dispose();
    planetCard.dispose();
    speedControl.dispose();
    dateControl.dispose();
    legend.dispose();
    hint.remove();
    credit.remove();
    glowTexture.dispose();
    sim.dispose();
    viewport.remove();
  };
}

// ============================================================================================================
// UI helpers (local to this simulation)
// ============================================================================================================
const dt = (key) => bindText(el('dt'), key);
const dd = (text) => {
  const node = el('dd');
  node.textContent = text;
  return node;
};
const para = (text) => {
  const p = el('p');
  p.textContent = text;
  return p;
};

function formatDistance(au) {
  const millionKm = (au * AU_KM) / 1e6;
  return `${formatNumber(millionKm, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} ${t('units.millionKm')} (${formatNumber(au, { maximumFractionDigits: 3, minimumFractionDigits: 3 })} ${t('units.au')})`;
}

/** Log-scaled time-speed slider: 0 = paused, 1 → 1 day/s … 100 → 1 year/s. */
function createSpeedControl({ value, onChange }) {
  const id = `speed-${Math.random().toString(36).slice(2, 8)}`;
  const wrap = el('div', 'lp-control lp-slider');
  const row = el('div', 'lp-control__row');
  const label = bindText(el('label', 'lp-control__label', { for: id }), `${KEYS}.controls.speed`);
  const output = el('output', 'lp-slider__value', { for: id, 'aria-live': 'off' });
  const input = el('input', 'lp-slider__input', { type: 'range', id, min: 0, max: 100, step: 1, value });
  bindAttr(input, { 'aria-label': `${KEYS}.controls.speed` });
  const ticks = el('div', 'lp-speed__ticks', { 'aria-hidden': 'true' });
  const tickPaused = bindText(el('span'), `${KEYS}.controls.paused`);
  const tickMax = el('span');
  ticks.append(tickPaused, tickMax);

  let current = value;
  const render = () => {
    const dps = sliderToDaysPerSecond(current);
    let text;
    if (dps === 0) text = t(`${KEYS}.controls.paused`);
    else if (dps >= MAX_DAYS_PER_SECOND - 1e-6) text = `1 ${t('units.yearPerSecond')}`;
    else text = `${formatNumber(dps, { maximumFractionDigits: dps < 10 ? 1 : 0 })} ${t('units.daysPerSecond')}`;
    output.textContent = text;
    input.setAttribute('aria-valuetext', text);
    tickMax.textContent = `1 ${t('units.yearPerSecond')}`;
  };
  input.addEventListener('input', () => {
    current = Number(input.value);
    render();
    onChange?.(current);
  });
  const unsub = onLanguageChange(render);
  render();
  row.append(label, output);
  wrap.append(row, input, ticks);
  return {
    el: wrap,
    setValue(v, { silent = false } = {}) {
      current = v;
      input.value = String(v);
      render();
      if (!silent) onChange?.(v);
    },
    dispose: unsub,
  };
}

/** Date picker (1800–2050) with live, locale-formatted current simulation date. */
function createDateControl({ getJD, onChange }) {
  const id = `date-${Math.random().toString(36).slice(2, 8)}`;
  const wrap = el('div', 'lp-control lp-date');
  const row = el('div', 'lp-control__row');
  const label = bindText(el('label', 'lp-control__label', { for: id }), `${KEYS}.controls.date`);
  const current = el('output', 'lp-date__current', { for: id, 'aria-live': 'off' });
  row.append(label, current);
  const inputRow = el('div', 'lp-date__row');
  const input = el('input', 'lp-date__input', { type: 'date', id, min: '1800-01-01', max: '2050-12-31', required: true });
  bindAttr(input, { 'aria-label': `${KEYS}.controls.date` });
  const today = createButton({ labelKey: `${KEYS}.controls.today`, onClick: () => onChange(dateToJD(new Date())) });
  inputRow.append(input, today.el);
  const warning = bindText(el('p', 'lp-date__warning', { role: 'status' }), `${KEYS}.controls.dateOutOfRange`);
  wrap.append(row, inputRow, warning);

  let formatter = null;
  let formatterLocale = null;
  const format = (date) => {
    const locale = getLocale();
    if (!formatter || formatterLocale !== locale) {
      formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
      formatterLocale = locale;
    }
    return formatter.format(date);
  };
  let lastIso = '';
  const sync = (force) => {
    const date = jdToDate(getJD());
    const iso = toISODate(date);
    if (!force && iso === lastIso) return;
    lastIso = iso;
    current.textContent = format(date);
    if (document.activeElement !== input) input.value = iso;
  };
  input.addEventListener('change', () => {
    if (!input.value) return;
    const [y, m, d] = input.value.split('-').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return;
    const date = new Date(Date.UTC(2000, 0, 1, 12));
    date.setUTCFullYear(y, m - 1, d);
    onChange(dateToJD(date));
  });
  return {
    el: wrap,
    sync,
    setOutOfRange(v) {
      warning.classList.toggle('is-visible', v);
    },
    dispose() {},
  };
}

function toISODate(date) {
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function createLegend() {
  const wrap = el('div', 'lp-legend');
  const item = (key, swatchClass, color) => {
    const li = el('div', 'lp-legend__item');
    const swatch = el('span', `lp-legend__swatch ${swatchClass}`, { 'aria-hidden': 'true' });
    if (color) swatch.style.color = color;
    li.append(swatch, bindText(el('span'), key));
    return li;
  };
  wrap.append(
    item(`${KEYS}.legend.habitableZone`, 'lp-legend__swatch--zone'),
    item(`${KEYS}.legend.earthOrbit`, '', '#7cc4ff'),
    item(`${KEYS}.legend.eccentricOrbit`, 'lp-legend__swatch--dashed', '#ff5a5a'),
  );
  return { el: wrap, dispose() {} };
}

/** Bilingual info card for the clicked body (bottom-left overlay). */
function createPlanetCard({ container, getBody, getDistanceAU, onClose }) {
  const card = el('section', 'lp-planet-card', { hidden: true });
  bindAttr(card, { 'aria-label': `${KEYS}.card.clickHint` });
  const header = el('div', 'lp-planet-card__header');
  const title = el('h2', 'lp-planet-card__title');
  const dot = el('span', 'lp-planet-card__dot', { 'aria-hidden': 'true' });
  const name = el('span');
  title.append(dot, name);
  const close = el('button', 'lp-planet-card__close', { type: 'button' });
  close.textContent = '×';
  bindAttr(close, { 'aria-label': `${KEYS}.card.close`, title: `${KEYS}.card.close` });
  close.addEventListener('click', () => onClose());
  header.append(title, close);
  const sub = el('p', 'lp-planet-card__sub');
  const facts = el('dl', 'lp-facts');
  card.append(header, sub, facts);
  container.append(card);

  let distanceEl = null;
  let lastDistance = '';
  function render() {
    const body = getBody();
    if (!body) {
      card.hidden = true;
      distanceEl = null;
      return;
    }
    const def = body.def;
    const jd = dateToJD(new Date());
    name.textContent = t(`${KEYS}.planets.${def.id}`);
    dot.style.color = `#${new THREE.Color(def.orbitColor ?? def.color).getHexString()}`;
    facts.replaceChildren();
    if (def.id === 'sun') {
      sub.textContent = t(`${KEYS}.card.sunType`);
      facts.append(dt(`${KEYS}.card.sunRadius`), dd(`${formatNumber(def.radiusKm, { maximumFractionDigits: 0 })} ${t('units.kilometers')} (${t(`${KEYS}.card.earthRadii`, { n: formatNumber(def.radiusKm / 6371, { maximumFractionDigits: 0 }) })})`));
      distanceEl = null;
    } else {
      const { perihelion, aphelion } = apsides(def.id, jd);
      const meanAU = (perihelion + aphelion) / 2;
      const periodDays = orbitalPeriodDays(def.id);
      const periodText = periodDays < 1000
        ? t(`${KEYS}.card.days`, { n: formatNumber(periodDays, { maximumFractionDigits: 1 }) })
        : t(`${KEYS}.card.years`, { n: formatNumber(periodDays / DAYS_PER_YEAR, { maximumFractionDigits: 1 }) });
      sub.textContent = `${formatNumber(perihelion, { maximumFractionDigits: 2, minimumFractionDigits: 2 })} – ${formatNumber(aphelion, { maximumFractionDigits: 2, minimumFractionDigits: 2 })} ${t('units.au')}`;
      distanceEl = dd('');
      const radiusText = `${formatNumber(def.radiusKm, { maximumFractionDigits: 0 })} ${t('units.kilometers')}`;
      const radiusExtra = def.id === 'earth' ? '' : ` (${t(`${KEYS}.card.earthRadii`, { n: formatNumber(def.radiusKm / 6371, { maximumFractionDigits: 2 }) })})`;
      facts.append(
        dt(`${KEYS}.card.distanceNow`), distanceEl,
        dt(`${KEYS}.card.meanDistance`), dd(formatDistance(meanAU)),
        dt(`${KEYS}.card.period`), dd(periodText),
        dt(`${KEYS}.card.eccentricity`), dd(formatNumber(planetPosition(def.id, jd).elements.e, { maximumFractionDigits: 4, minimumFractionDigits: 4 })),
        dt(`${KEYS}.card.radius`), dd(radiusText + radiusExtra),
      );
      lastDistance = '';
    }
    card.hidden = false;
    tick(true);
  }
  function tick(force) {
    if (card.hidden || !distanceEl) return;
    const body = getBody();
    if (!body) return;
    const text = formatDistance(getDistanceAU(body.def.id));
    if (force || text !== lastDistance) {
      lastDistance = text;
      distanceEl.textContent = text;
    }
  }
  return { el: card, render, tick, dispose: () => card.remove() };
}

// ============================================================================================================
// procedural textures
// ============================================================================================================
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

function createLabelTexture(text, color, font) {
  const width = 512;
  const height = 128;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.font = `600 56px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(6,9,19,0.85)';
  ctx.strokeText(text, width / 2, height / 2);
  ctx.fillStyle = `#${new THREE.Color(color).getHexString()}`;
  ctx.fillText(text, width / 2, height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
