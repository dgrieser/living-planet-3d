/**
 * Simulation: Seasons, axial tilt & day length ("seasons").
 *
 * Earth orbits an emissive Sun. The axial tilt (0–90°) and rotation period
 * (6–300 h) are adjustable; Earth can be dragged along its orbit or animated
 * through the year. A shader lights the textured Earth with a soft day/night
 * terminator and can overlay a heat map of the daily mean insolation per
 * latitude. Tropics, polar circles, the subsolar point and a readout (day
 * length, insolation, temperature estimate, climate zone) for a selectable
 * latitude all update live. All physics lives in ./physics.js.
 *
 * Scene: Sun at the origin, ecliptic plane y = 0, Earth orbits counter-clockwise
 * seen from +y. The rotation axis leans towards −x, so the June solstice is at
 * orbit angle 0° (Earth on +x), the December solstice at 180° (Earth on −x).
 */
import * as THREE from 'three';
import { createScene } from '../../lib/scene.js';
import { createPanel, createSection, createSlider, createToggle, createButton, createInfoCard, createNotice, el } from '../../lib/ui.js';
import { t, bindText, bindAttr, onLanguageChange, formatNumber, getLocale } from '../../lib/i18n.js';
import * as S from './physics.js';

const KEYS = 'sims.seasons';
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
});

const DEFAULTS = Object.freeze({
  tiltDeg: S.EARTH_TILT_DEG,
  periodH: S.EARTH_ROTATION_H,
  dayOfYear: 171.5, // June solstice
  playing: true,
  daysPerSecond: 10,
  latitudeDeg: 45,
  showHeat: false,
  showTerminator: true,
  showCircles: true,
  showAxis: true,
  showSubsolar: true,
  showGrid: true,
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

export default function mount(container, _meta) {
  const state = { ...DEFAULTS, activePreset: 'earth', cameraMode: 'earth' };
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
      () => console.warn(`[seasons] texture not available: ${file} – using flat colour`),
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
  const earthMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: placeholder },
      uSunPos: { value: new THREE.Vector3() },
      uDecl: { value: 0 },
      uHeatMix: { value: 0 },
      uHeatScale: { value: HEAT_SCALE_W_M2 / S.SOLAR_CONSTANT_W_M2 },
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
  function placeLatitudeLine(line, latitudeDeg) {
    const c = Math.max(1e-3, Math.cos(latitudeDeg * DEG)) * LINE_RADIUS;
    line.scale.set(c, 1, c);
    line.position.y = Math.sin(latitudeDeg * DEG) * LINE_RADIUS;
  }
  placeLatitudeLine(equatorLine, 0);

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
  let annualCache = { key: '', insolation: 0, polar: null };

  function derive() {
    const orbitAngleDeg = S.orbitAngleFromDay(state.dayOfYear);
    const orbitAngleRad = orbitAngleDeg * DEG;
    const declDeg = S.declinationDeg(state.tiltDeg, orbitAngleDeg);
    const cacheKey = `${state.latitudeDeg}|${state.tiltDeg}`;
    if (annualCache.key !== cacheKey) {
      annualCache = { key: cacheKey, insolation: S.annualMeanInsolation(state.latitudeDeg, state.tiltDeg), polar: S.polarDays(state.latitudeDeg, state.tiltDeg) };
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
      zone: S.climateZone(state.latitudeDeg, state.tiltDeg),
      season: S.seasonAt(orbitAngleDeg),
    };
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

    placeLatitudeLine(tropicLines[0], state.tiltDeg);
    placeLatitudeLine(tropicLines[1], -state.tiltDeg);
    placeLatitudeLine(polarLines[0], 90 - state.tiltDeg);
    placeLatitudeLine(polarLines[1], -(90 - state.tiltDeg));
    placeLatitudeLine(selectedLine, state.latitudeDeg);
    const circlesVisible = state.showCircles && state.tiltDeg > 0.05;
    tropicLines.forEach((l) => (l.visible = circlesVisible));
    polarLines.forEach((l) => (l.visible = circlesVisible));
    equatorLine.visible = state.showCircles;
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
    dragMarker.visible = dragging || hovering;
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
    applyFollow();
    updateOverlay();
    updateReadouts();
    sim.requestRender();
  }

  // --- camera: follow Earth in its co-rotating frame ---------------------------------------------------------------------
  let following = true;
  let lastFollowAngle = null;
  let cameraTween = null;
  const followOffset = new THREE.Vector3();

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

  function tweenCamera(toPosition, toTarget, { duration = 0.9, follow = false } = {}) {
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
    cameraTween = { t: 0, duration, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: toPosition.clone(), toTarget: toTarget.clone(), offset, angle0 };
  }
  function stepTween(dt) {
    if (!cameraTween) return;
    const tw = cameraTween;
    tw.t = Math.min(1, tw.t + dt / tw.duration);
    if (tw.offset) {
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
      state.cameraMode = 'earth';
      tweenCamera(earthViewPosition(-1.4, 2.3, -5.6), earthPos.clone(), { duration, follow: true });
    },
    overview(duration) {
      state.cameraMode = 'overview';
      tweenCamera(new THREE.Vector3(0, 15, 21), new THREE.Vector3(0, 0, 0), { duration, follow: false });
    },
    top(duration) {
      state.cameraMode = 'top';
      tweenCamera(new THREE.Vector3(0, 30, 0.01), new THREE.Vector3(0, 0, 0), { duration, follow: false });
    },
  };

  // --- interaction: drag Earth along its orbit --------------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  raycaster.layers.set(HIT_LAYER);
  const pointer = new THREE.Vector2();
  const eclipticPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let dragging = false;
  let hovering = false;
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
  function dragTo(e) {
    setPointer(e);
    if (!raycaster.ray.intersectPlane(eclipticPlane, tmpV)) return;
    if (tmpV.lengthSq() < 1e-6) return;
    const angleDeg = Math.atan2(-tmpV.z, tmpV.x) / DEG;
    setDayOfYear(S.dayFromOrbitAngle(angleDeg));
  }
  const onPointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (!pick(e)) return;
    dragging = true;
    controls.enabled = false; // registered in the capture phase, so OrbitControls sees `enabled === false`
    canvas.classList.add('is-dragging');
    canvas.setPointerCapture?.(e.pointerId);
    e.stopPropagation();
    dragTo(e);
  };
  const onPointerMove = (e) => {
    if (dragging) {
      dragTo(e);
      return;
    }
    const over = pick(e);
    if (over !== hovering) {
      hovering = over;
      canvas.classList.toggle('is-grab', over);
      updateOverlay();
      sim.requestRender();
    }
  };
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    controls.enabled = true;
    canvas.classList.remove('is-dragging');
    if (e && canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (following) {
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
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);
  disposers.push(() => {
    canvas.removeEventListener('pointerdown', onPointerDown, { capture: true });
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', endDrag);
    canvas.removeEventListener('pointercancel', endDrag);
    canvas.removeEventListener('lostpointercapture', endDrag);
  });

  // --- animation -----------------------------------------------------------------------------------------------------------
  function frame(dt) {
    if (state.playing && !dragging) {
      const before = Math.floor(state.dayOfYear * 2);
      state.dayOfYear = S.normalizeDay(state.dayOfYear + dt * state.daysPerSecond);
      if (Math.floor(state.dayOfYear * 2) !== before) daySlider.setValue(state.dayOfYear, { silent: true });
    }
    spinGroup.rotation.y = (spinGroup.rotation.y + 2 * Math.PI * SPIN_REV_PER_SECOND_AT_24H * (S.EARTH_ROTATION_H / state.periodH) * dt) % (2 * Math.PI);
    model = derive();
    updateScene();
    applyFollow();
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

  // --- UI ----------------------------------------------------------------------------------------------------------------------------
  const panel = createPanel();

  // Earth section
  const earthSection = createSection(`${KEYS}.sections.earth`);
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
  earthSection.add(tiltSlider, periodSlider, presetsTitle, presetRow, presetNote);

  // Year / orbit section
  const orbitSection = createSection(`${KEYS}.sections.orbit`);
  const daySlider = createSlider({
    labelKey: `${KEYS}.controls.dayOfYear`,
    min: 0,
    max: 365,
    step: 0.5,
    value: state.dayOfYear,
    format: (v) => formatDate(v),
    onChange: (v) => setDayOfYear(v, { fromSlider: true }),
  });
  const stopRow = el('div', 'lp-presets', { role: 'group' });
  bindAttr(stopRow, { 'aria-label': `${KEYS}.controls.stops` });
  for (const stop of S.SEASON_STOPS) {
    const btn = createButton({ labelKey: `${KEYS}.seasons.${stop.season}`, onClick: () => setDayOfYear(stop.dayOfYear) });
    btn.el.classList.add('lp-presets__btn', 'lp-presets__btn--stack');
    btn.el.append(bindText(el('span', 'lp-presets__value'), `${KEYS}.stopDates.${stop.id}`));
    stopRow.append(btn.el);
  }
  const playBtn = createButton({ labelKey: `${KEYS}.controls.pause`, icon: '⏸', variant: 'primary', onClick: () => setPlaying(!state.playing) });
  function syncPlayButton() {
    playBtn.el.querySelector('.lp-button__icon').textContent = state.playing ? '⏸' : '▶';
    bindText(playBtn.el.querySelector('[data-i18n]'), state.playing ? `${KEYS}.controls.pause` : `${KEYS}.controls.play`);
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
  const playRow = el('div', 'lp-button-row');
  playRow.append(playBtn.el);
  const orbitFacts = createFacts([
    ['season', `${KEYS}.readout.season`],
    ['subsolar', `${KEYS}.readout.subsolar`],
    ['tropics', `${KEYS}.readout.tropics`],
    ['polarCircles', `${KEYS}.readout.polarCircles`],
  ]);
  orbitSection.add(daySlider, stopRow, playRow, speedSlider, orbitFacts);

  // Readout section
  const readoutSection = createSection(`${KEYS}.sections.readout`);
  const latitudeSlider = createSlider({
    labelKey: `${KEYS}.controls.latitude`,
    min: -90,
    max: 90,
    step: 0.5,
    value: state.latitudeDeg,
    format: (v) => formatLatitude(v, 1),
    onChange: (v) => setLatitude(v, { fromSlider: true }),
  });
  const latitudeRow = el('div', 'lp-presets', { role: 'group' });
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
  ]);
  const zoneRow = el('div', 'lp-zone');
  const zoneLabel = bindText(el('span', 'lp-zone__label'), `${KEYS}.readout.zone`);
  const zonePill = el('span', 'lp-state', { role: 'status' });
  const zoneHint = el('p', 'lp-state__hint');
  zoneRow.append(zoneLabel, zonePill, zoneHint);
  const modelNote = bindText(el('p', 'lp-section__note'), `${KEYS}.readout.modelNote`);
  readoutSection.add(latitudeSlider, latitudeRow, dayReadout, latitudeFacts, zoneRow, modelNote);

  // View section
  const viewSection = createSection(`${KEYS}.sections.view`);
  const toggles = {
    showHeat: createToggle({ labelKey: `${KEYS}.view.heatMap`, checked: state.showHeat, onChange: (v) => { state.showHeat = v; heatLegend.hidden = !v; refresh(); } }),
    showTerminator: createToggle({ labelKey: `${KEYS}.view.terminator`, checked: state.showTerminator, onChange: (v) => { state.showTerminator = v; refresh(); } }),
    showCircles: createToggle({ labelKey: `${KEYS}.view.circles`, checked: state.showCircles, onChange: (v) => { state.showCircles = v; refresh(); } }),
    showAxis: createToggle({ labelKey: `${KEYS}.view.axis`, checked: state.showAxis, onChange: (v) => { state.showAxis = v; refresh(); } }),
    showSubsolar: createToggle({ labelKey: `${KEYS}.view.subsolar`, checked: state.showSubsolar, onChange: (v) => { state.showSubsolar = v; refresh(); } }),
    showGrid: createToggle({ labelKey: `${KEYS}.view.grid`, checked: state.showGrid, onChange: (v) => { state.showGrid = v; refresh(); } }),
    showLabels: createToggle({ labelKey: `${KEYS}.view.labels`, checked: state.showLabels, onChange: (v) => { state.showLabels = v; refresh(); } }),
  };
  const heatLegend = createHeatLegend();
  heatLegend.el.hidden = !state.showHeat;
  const cameraTitle = bindText(el('p', 'lp-subheading'), `${KEYS}.controls.camera`);
  const cameraRow = el('div', 'lp-button-row');
  const cameraButtons = [
    ['earth', '🌍'],
    ['overview', '◎'],
    ['top', '⤓'],
  ].map(([id, icon]) => {
    const btn = createButton({ labelKey: `${KEYS}.view.camera${id[0].toUpperCase()}${id.slice(1)}`, icon, onClick: () => { cameraPresets[id](); syncCameraButtons(); } });
    cameraRow.append(btn.el);
    return { id, el: btn.el };
  });
  function syncCameraButtons() {
    for (const { id, el: btn } of cameraButtons) btn.setAttribute('aria-pressed', String(state.cameraMode === id));
  }
  const legend = createLegend();
  viewSection.add(toggles.showHeat, heatLegend, toggles.showTerminator, toggles.showCircles, toggles.showAxis, toggles.showSubsolar, toggles.showGrid, toggles.showLabels, cameraTitle, cameraRow, legend);

  const resetBtn = createButton({
    labelKey: 'panel.reset',
    icon: '↺',
    onClick: () => {
      Object.assign(state, DEFAULTS, { activePreset: 'earth' });
      tiltSlider.setValue(state.tiltDeg, { silent: true });
      periodSlider.setValue(Math.log10(state.periodH), { silent: true });
      daySlider.setValue(state.dayOfYear, { silent: true });
      speedSlider.setValue(state.daysPerSecond, { silent: true });
      latitudeSlider.setValue(state.latitudeDeg, { silent: true });
      for (const [key, toggle] of Object.entries(toggles)) toggle.setChecked(state[key], { silent: true });
      heatLegend.el.hidden = !state.showHeat;
      spinGroup.rotation.y = 0;
      syncPresets();
      syncLatitudeButtons();
      syncPlayButton();
      refresh();
      cameraPresets.earth();
      syncCameraButtons();
    },
  });
  const resetRow = el('div', 'lp-button-row');
  resetRow.append(resetBtn.el);

  panel.add(earthSection, orbitSection, readoutSection, viewSection, resetRow);
  if (sim.reducedMotion) panel.add(createNotice({ textKey: 'motion.reducedNotice' }));
  const infoCard = createInfoCard({ titleKey: `${KEYS}.info.title`, bodyKey: `${KEYS}.info.body`, open: !window.matchMedia('(max-width: 720px)').matches });
  const physicsCard = createPhysicsCard();
  panel.add(infoCard, physicsCard);
  container.append(panel.el);

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
    const { declDeg, dayLengthH, fraction, temps, polar, zone, season } = model;
    const key = `${declDeg.toFixed(2)}|${dayLengthH.toFixed(2)}|${state.tiltDeg}|${state.periodH}|${state.latitudeDeg}|${Math.floor(state.dayOfYear)}`;
    if (!force && key === lastReadoutKey) return;
    lastReadoutKey = key;

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
    zonePill.textContent = t(`${KEYS}.readout.zones.${zone}`);
    zonePill.className = `lp-state lp-state--zone-${zone}`;
    zoneHint.textContent = t(`${KEYS}.readout.zoneHints.${zone}`);
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
    window.__lpSeasons = { sim, state, get model() { return model; }, setTilt, setPeriod, setDayOfYear, setLatitude, setPlaying, applyPreset, cameraPresets, frame, refresh, presets: S.WHAT_IF_PRESETS };
  }

  return () => {
    if (import.meta.env.DEV) delete window.__lpSeasons;
    disposers.forEach((d) => d());
    panel.dispose();
    hint.remove();
    credit.remove();
    stopLabels.forEach(({ label }) => label.dispose());
    Object.values(poleLabels).forEach((l) => l.dispose());
    subsolarLabel.dispose();
    glowTexture.dispose();
    placeholder.dispose();
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
  );
  return { el: wrap, dispose() {} };
}

function createHeatLegend() {
  const wrap = el('div', 'lp-heat-legend');
  const title = bindText(el('span', 'lp-heat-legend__title'), `${KEYS}.legend.heatTitle`);
  const bar = el('div', 'lp-heat-legend__bar', { 'aria-hidden': 'true' });
  const scale = el('div', 'lp-heat-legend__scale');
  scale.append(bindText(el('span'), `${KEYS}.legend.heatLow`), bindText(el('span'), `${KEYS}.legend.heatHigh`));
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
  const entries = ['declination', 'dayLength', 'insolation', 'temperature', 'swing'];
  function render() {
    body.replaceChildren();
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
  uniform vec3 uSunPos;
  uniform float uDecl;      // solar declination (rad)
  uniform float uHeatMix;   // 0 = texture, 1 = insolation heat map
  uniform float uHeatScale; // insolation (fraction of S0) at which the ramp saturates
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
