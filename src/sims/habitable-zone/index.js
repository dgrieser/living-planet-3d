/**
 * Simulation: The habitable zone ("habitable-zone").
 *
 * A main-sequence star (type/luminosity adjustable) with a single planet whose
 * distance can be set by slider or by dragging it in the orbital plane. The
 * conservative habitable zone (Kopparapu et al. 2013) is drawn as a translucent
 * annulus (optionally as a 3D shell) and scales live with the luminosity. The
 * planet's surface morphs between frozen / habitable / scorched according to its
 * equilibrium temperature. An evolution mode ages a Sun-like star from 0 to 10 Gyr
 * and shows the zone migrating outward past Earth.
 *
 * Scene units: 1 AU = AU_UNITS; the orbital plane is y = 0, the planet orbits
 * counter-clockwise seen from above (+y). All physics lives in ./physics.js.
 */
import * as THREE from 'three';
import { createScene } from '../../lib/scene.js';
import { createPanel, createSection, createSlider, createToggle, createButton, createInfoCard, createNotice, el } from '../../lib/ui.js';
import { t, bindText, bindAttr, onLanguageChange, formatNumber } from '../../lib/i18n.js';
import * as HZ from './physics.js';

const KEYS = 'sims.habitableZone';
const AU_UNITS = 10; // scene units per astronomical unit
const PLANET_RADIUS = 0.16; // scene units (strongly exaggerated for visibility)
const STAR_UNIT_RADIUS = 0.5; // scene units for 1 R☉ (≈ 11× exaggerated)
const STAR_MAX_RADIUS = 0.8; // keeps very luminous stars clear of a planet at 0.1 AU
const SECONDS_PER_ORBIT_YEAR = 20; // visual time: a 1-year orbit takes 20 s
const MAX_ANGULAR_SPEED = Math.PI; // rad/s – close-in planets would otherwise flicker
const EVOLUTION_GYR_PER_SECOND = 0.4; // 10 Gyr in 25 s
const HIT_LAYER = 1;
const ZONE_COLOR = 0x5adc8c;
const STATE_COLORS = Object.freeze({ frozen: 0x9fd8ff, habitable: 0x5adc8c, scorched: 0xff6b4a });
const LABEL_DIRECTION = new THREE.Vector3(-0.62, 0, 0.78).normalize(); // where zone-edge labels sit (lower left in the default view)
const GRID_LABEL_DIRECTION = new THREE.Vector3(0.92, 0, 0.4).normalize(); // right of the star, clear of its temperature label
const GRID_LABEL_AU = [0.5, 1, 2, 3, 4, 5];

const DEFAULTS = Object.freeze({
  luminosity: 1,
  distanceAU: 1,
  ageGyr: HZ.SUN_AGE_GYR,
  evolution: false,
  showZone: true,
  showShell: false,
  showTempLabels: true,
  showGrid: true,
});

const { clamp } = HZ;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const fmt = (v, digits, min = digits) => formatNumber(v, { maximumFractionDigits: digits, minimumFractionDigits: min });

export default function mount(container, _meta) {
  const state = { ...DEFAULTS, playing: false, angle: Math.PI * 0.15 };
  const disposers = [];

  const viewport = el('div', 'lp-sim__viewport');
  container.append(viewport);

  const sim = createScene({
    container: viewport,
    cameraPosition: [0, 22, 30],
    near: 0.01,
    far: 5000,
    stars: { count: 3000, radius: 3000 },
    controls: { minDistance: 0.4, maxDistance: 400 },
  });
  const { scene, camera, renderer, controls } = sim;
  camera.lookAt(0, 0, 0);
  const labelFont = getComputedStyle(document.documentElement).getPropertyValue('--lp-font') || 'sans-serif';

  // --- star ------------------------------------------------------------------------------
  const starMaterial = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xfff0c8) }, uTime: { value: 0 }, uContrast: { value: 0.3 } },
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
  });
  const starMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), starMaterial);
  starMesh.name = 'star';
  scene.add(starMesh);
  const glowTexture = createGlowTexture();
  const starGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  const starCorona = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, transparent: true, opacity: 0.45, depthWrite: false, depthTest: false, sizeAttenuation: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  starCorona.scale.set(0.12, 0.12, 1);
  starCorona.renderOrder = 5;
  scene.add(starGlow, starCorona);

  // --- habitable zone (built for L = 1, scaled by √L) -------------------------------------------
  const zoneGroup = new THREE.Group();
  const unitZone = HZ.zoneEdgesAU(1);
  const annulus = new THREE.Group();
  annulus.rotation.x = -Math.PI / 2;
  const zoneFillMaterial = new THREE.MeshBasicMaterial({ color: ZONE_COLOR, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  const zoneFill = new THREE.Mesh(new THREE.RingGeometry(unitZone.inner * AU_UNITS, unitZone.outer * AU_UNITS, 256), zoneFillMaterial);
  zoneFill.renderOrder = -2;
  const zoneEdgeMaterial = new THREE.LineBasicMaterial({ color: 0x9ff5bd, transparent: true, opacity: 0.85, depthWrite: false });
  const zoneEdgeInner = new THREE.LineLoop(circleGeometry(unitZone.inner * AU_UNITS), zoneEdgeMaterial);
  const zoneEdgeOuter = new THREE.LineLoop(circleGeometry(unitZone.outer * AU_UNITS), zoneEdgeMaterial);
  annulus.add(zoneFill, zoneEdgeInner, zoneEdgeOuter);
  const shellMaterial = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(ZONE_COLOR) }, uOpacity: { value: 0.4 } },
    vertexShader: SHELL_VERTEX,
    fragmentShader: SHELL_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shellInner = new THREE.Mesh(new THREE.SphereGeometry(unitZone.inner * AU_UNITS, 64, 40), shellMaterial);
  const shellOuter = new THREE.Mesh(new THREE.SphereGeometry(unitZone.outer * AU_UNITS, 64, 40), shellMaterial);
  shellInner.renderOrder = shellOuter.renderOrder = -1;
  const shellGroup = new THREE.Group();
  shellGroup.add(shellInner, shellOuter);
  zoneGroup.add(annulus, shellGroup);
  scene.add(zoneGroup);

  // present-day zone (dashed) shown while the star evolves
  const todayMaterial = new THREE.LineDashedMaterial({ color: 0x9ff5bd, dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.5, depthWrite: false });
  const todayGroup = new THREE.Group();
  todayGroup.rotation.x = -Math.PI / 2;
  for (const r of [unitZone.inner, unitZone.outer]) {
    const loop = new THREE.LineLoop(circleGeometry(r * AU_UNITS), todayMaterial);
    loop.computeLineDistances();
    todayGroup.add(loop);
  }
  scene.add(todayGroup);

  // --- orbit grid ------------------------------------------------------------------------------------
  const gridGroup = new THREE.Group();
  gridGroup.rotation.x = -Math.PI / 2;
  const gridFine = new THREE.LineBasicMaterial({ color: 0xa7b4cc, transparent: true, opacity: 0.1, depthWrite: false });
  const gridMedium = new THREE.LineBasicMaterial({ color: 0xa7b4cc, transparent: true, opacity: 0.2, depthWrite: false });
  const gridStrong = new THREE.LineBasicMaterial({ color: 0xa7b4cc, transparent: true, opacity: 0.38, depthWrite: false });
  for (let i = 1; i <= 9; i++) gridGroup.add(new THREE.LineLoop(circleGeometry(i * 0.1 * AU_UNITS, 128), gridFine)); // 0.1 AU steps inside 1 AU
  for (let au = 0.5; au <= HZ.DISTANCE_RANGE_AU.max; au += 0.5) {
    gridGroup.add(new THREE.LineLoop(circleGeometry(au * AU_UNITS), Number.isInteger(au) ? gridStrong : gridMedium));
  }
  const spokes = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    spokes.push(new THREE.Vector3(0.1 * AU_UNITS * Math.cos(a), 0.1 * AU_UNITS * Math.sin(a), 0), new THREE.Vector3(HZ.DISTANCE_RANGE_AU.max * AU_UNITS * Math.cos(a), HZ.DISTANCE_RANGE_AU.max * AU_UNITS * Math.sin(a), 0));
  }
  gridGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(spokes), gridFine));
  scene.add(gridGroup);

  // --- planet ---------------------------------------------------------------------------------------------
  const orbitLine = new THREE.LineLoop(circleGeometry(1, 256), new THREE.LineBasicMaterial({ color: 0x7cc4ff, transparent: true, opacity: 0.8, depthWrite: false }));
  orbitLine.rotation.x = -Math.PI / 2;
  orbitLine.renderOrder = 1;
  scene.add(orbitLine);

  const planetGroup = new THREE.Group();
  const planetMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uThaw: { value: 1 },
      uScorch: { value: 0 },
      uLightColor: { value: new THREE.Color(0xffffff) },
      uLightIntensity: { value: 1.6 },
      uTime: { value: 0 },
    },
    vertexShader: PLANET_VERTEX,
    fragmentShader: PLANET_FRAGMENT,
  });
  const planetMesh = new THREE.Mesh(new THREE.SphereGeometry(PLANET_RADIUS, 64, 48), planetMaterial);
  planetMesh.name = 'planet';
  const atmosphereMaterial = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0x6fb6ff) }, uStrength: { value: 1 } },
    vertexShader: ATMOSPHERE_VERTEX,
    fragmentShader: ATMOSPHERE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  });
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(PLANET_RADIUS * 1.18, 48, 32), atmosphereMaterial);
  planetGroup.add(planetMesh, atmosphere);
  scene.add(planetGroup);
  const planetHit = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial());
  planetHit.layers.set(HIT_LAYER);
  planetHit.userData.kind = 'planet';
  scene.add(planetHit);
  const planetMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: createRingTexture(), color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, depthTest: false, sizeAttenuation: false }));
  planetMarker.renderOrder = 9;
  planetMarker.scale.set(0.05, 0.05, 1);
  scene.add(planetMarker);

  // --- labels -------------------------------------------------------------------------------------------------
  const labels = {
    planetName: createLabel(0xffffff, labelFont),
    planetTemp: createLabel(0xffffff, labelFont),
    starTemp: createLabel(0xffffff, labelFont),
    zoneInner: createLabel(0x9ff5bd, labelFont),
    zoneOuter: createLabel(0x9ff5bd, labelFont),
    grid: GRID_LABEL_AU.map(() => createLabel(0xa7b4cc, labelFont, 0.75)),
  };
  scene.add(labels.planetName.sprite, labels.planetTemp.sprite, labels.starTemp.sprite, labels.zoneInner.sprite, labels.zoneOuter.sprite, ...labels.grid.map((l) => l.sprite));

  // --- derived model -------------------------------------------------------------------------------------------------
  let model = derive();
  function derive() {
    const star = state.evolution ? HZ.sunAtAge(state.ageGyr) : HZ.mainSequenceStar(state.luminosity);
    const zone = HZ.zoneEdgesAU(star.luminosity);
    const teqK = HZ.equilibriumTemperatureK(star.luminosity, state.distanceAU);
    return {
      star,
      zone,
      teqK,
      status: HZ.classify(teqK),
      mix: HZ.stateMix(teqK),
      type: HZ.spectralType(star.teffK),
      insolation: HZ.insolation(star.luminosity, state.distanceAU),
      periodYears: HZ.orbitalPeriodYears(state.distanceAU, star.massSolar),
      starRadius: Math.min(STAR_MAX_RADIUS, STAR_UNIT_RADIUS * star.radiusSolar),
      isEarth: Math.abs(state.distanceAU - 1) < 0.005 && (state.evolution || Math.abs(state.luminosity - 1) < 1e-9),
    };
  }

  const tmpV = new THREE.Vector3();
  const tmpUp = new THREE.Vector3();
  const tmpColor = new THREE.Color();
  const starColor = new THREE.Color();
  const planetPos = new THREE.Vector3();

  /** Push the model into the scene graph (everything that does not depend on the camera). */
  function updateScene() {
    const { star, zone, mix, starRadius } = model;
    const [r, g, b] = HZ.starColorRGB(star.teffK);
    starColor.setRGB(r, g, b, THREE.SRGBColorSpace);
    starMaterial.uniforms.uColor.value.copy(starColor);
    starMaterial.uniforms.uContrast.value = clamp(0.2 + (4500 - star.teffK) / 6000, 0.15, 0.45);
    starMesh.scale.setScalar(starRadius); // refined per frame in updateOverlay()
    starGlow.material.color.copy(starColor);
    starCorona.material.color.copy(starColor);

    const zoneScale = Math.sqrt(star.luminosity);
    zoneGroup.scale.setScalar(zoneScale);
    zoneGroup.visible = state.showZone;
    shellGroup.visible = state.showShell;
    todayGroup.visible = state.showZone && state.evolution && Math.abs(state.ageGyr - HZ.SUN_AGE_GYR) > 0.03;
    gridGroup.visible = state.showGrid;

    const d = state.distanceAU * AU_UNITS;
    orbitLine.scale.setScalar(d);
    planetPos.set(d * Math.cos(state.angle), 0, -d * Math.sin(state.angle));
    planetGroup.position.copy(planetPos);
    planetMaterial.uniforms.uThaw.value = mix.thaw;
    planetMaterial.uniforms.uScorch.value = mix.scorch;
    // light the planet with a desaturated version of the star colour so the surface state stays readable around red stars
    planetMaterial.uniforms.uLightColor.value.copy(starColor).lerp(tmpColor.set(0xffffff), 0.6);
    planetMaterial.uniforms.uLightIntensity.value = 1.7 * Math.pow(clamp(model.insolation, 0.02, 8), 0.25);
    const atm = atmosphereMaterial.uniforms.uColor.value;
    atm.setHex(STATE_COLORS.frozen).lerp(tmpColor.setHex(0x4f9dff), mix.thaw).lerp(tmpColor.setHex(0xff7a30), mix.scorch);
    atmosphereMaterial.uniforms.uStrength.value = 0.7 + 0.5 * mix.thaw;

    labels.zoneInner.setText(`${fmt(zone.inner, 2)} ${t('units.au')}`);
    labels.zoneOuter.setText(`${fmt(zone.outer, 2)} ${t('units.au')}`);
    labels.planetName.setText(t(`${KEYS}.planet.${model.isEarth ? 'earth' : 'name'}`));
    labels.planetName.setColor(STATE_COLORS[model.status]);
    labels.planetTemp.setText(`${fmt(model.teqK, 0)} ${t('units.kelvin')} · ${fmt(model.teqK - 273.15, 0)} ${t('units.celsius')}`);
    labels.starTemp.setText(`${fmt(star.teffK, 0)} ${t('units.kelvin')} · ${model.type}`);
    labels.grid.forEach((l, i) => l.setText(`${fmt(GRID_LABEL_AU[i], GRID_LABEL_AU[i] % 1 ? 1 : 0)} ${t('units.au')}`));
  }

  /** Camera-dependent bits: label placement, hit-sphere size, marker, near plane. */
  function updateOverlay() {
    tmpUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const planetDist = Math.max(camera.position.distanceTo(planetPos), 1e-6);
    const starDist = Math.max(camera.position.length(), 1e-6);
    // keep the bodies legible at any zoom: never smaller than ~1 % of the viewing distance
    const planetRadius = Math.max(PLANET_RADIUS, planetDist * 0.014);
    planetGroup.scale.setScalar(planetRadius / PLANET_RADIUS);
    const starRadius = Math.max(model.starRadius, starDist * 0.009);
    starMesh.scale.setScalar(starRadius);
    starGlow.scale.setScalar(starRadius * 7);
    planetHit.position.copy(planetPos);
    planetHit.scale.setScalar(Math.max(planetRadius * 1.6, planetDist * 0.02));
    planetMarker.position.copy(planetPos);
    planetMarker.visible = dragging || hovering;

    labels.planetName.sprite.position.copy(planetPos).addScaledVector(tmpUp, planetRadius + planetDist * 0.03);
    labels.planetTemp.sprite.visible = state.showTempLabels;
    labels.planetTemp.sprite.position.copy(planetPos).addScaledVector(tmpUp, -(planetRadius + planetDist * 0.03));
    labels.starTemp.sprite.visible = state.showTempLabels;
    labels.starTemp.sprite.position.copy(tmpUp).multiplyScalar(-(starRadius + starDist * 0.035));

    const zoneScale = Math.sqrt(model.star.luminosity) * AU_UNITS;
    labels.zoneInner.sprite.visible = labels.zoneOuter.sprite.visible = state.showZone;
    labels.zoneInner.sprite.position.copy(LABEL_DIRECTION).multiplyScalar(unitZone.inner * zoneScale).addScaledVector(tmpUp, -starDist * 0.012);
    labels.zoneOuter.sprite.position.copy(LABEL_DIRECTION).multiplyScalar(unitZone.outer * zoneScale).addScaledVector(tmpUp, starDist * 0.012);
    const targetDist = camera.position.distanceTo(controls.target);
    labels.grid.forEach((l, i) => {
      const r = GRID_LABEL_AU[i] * AU_UNITS;
      // hide grid labels that are too small or too large to read at the current zoom
      l.sprite.visible = state.showGrid && r > targetDist * 0.08 && r < targetDist * 2.5;
      l.sprite.position.copy(GRID_LABEL_DIRECTION).multiplyScalar(r).addScaledVector(tmpUp, targetDist * 0.008);
    });

    const near = clamp(targetDist * 0.004, 0.005, 2);
    if (Math.abs(camera.near - near) / near > 0.2) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
  }

  function refresh() {
    model = derive();
    updateScene();
    updateOverlay();
    updateReadouts();
    sim.requestRender();
  }

  // --- camera ----------------------------------------------------------------------------------------------------------
  let cameraTween = null;
  function tweenCamera(toPosition, toTarget, duration = 0.9) {
    if (sim.reducedMotion || duration <= 0) {
      camera.position.copy(toPosition);
      controls.target.copy(toTarget);
      cameraTween = null;
      controls.update();
      updateOverlay();
      sim.requestRender();
      return;
    }
    cameraTween = { t: 0, duration, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: toPosition.clone(), toTarget: toTarget.clone() };
  }
  function stepTween(dt) {
    if (!cameraTween) return;
    const tw = cameraTween;
    tw.t = Math.min(1, tw.t + dt / tw.duration);
    const k = easeInOut(tw.t);
    camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
    controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
    if (tw.t >= 1) cameraTween = null;
  }
  /** Distance at which a ring of radius r (scene units) in the orbital plane fits the view. */
  function fitDistance(r) {
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const tanH = tanV * camera.aspect;
    return Math.max(1.2, (r * 1.3) / Math.min(tanH, tanV * 1.6));
  }
  function frameRadius(r, duration) {
    // keep the current viewing direction, only change the distance (feels less jarring than snapping)
    const dir = tmpV.copy(camera.position).sub(controls.target);
    if (dir.lengthSq() < 1e-6 || dir.y < 0.15 * dir.length()) dir.set(0, 0.72, 1);
    dir.normalize().multiplyScalar(fitDistance(r));
    tweenCamera(dir, new THREE.Vector3(0, 0, 0), duration);
  }
  const frameZone = (duration) => frameRadius(model.zone.outer * AU_UNITS, duration);
  const frameOverview = (duration) => frameRadius(HZ.DISTANCE_RANGE_AU.max * AU_UNITS, duration);
  /** Re-frame only when the zone became unreadably small or overflows the view. */
  function frameZoneIfNeeded() {
    const r = model.zone.outer * AU_UNITS;
    const dist = camera.position.distanceTo(controls.target);
    const ideal = fitDistance(r);
    if (dist > ideal * 2.2 || dist < ideal * 0.45) frameZone();
  }

  // --- interaction: drag the planet ----------------------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  raycaster.layers.set(HIT_LAYER);
  const pointer = new THREE.Vector2();
  const orbitalPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let dragging = false;
  let hovering = false;
  const canvas = renderer.domElement;

  function pick(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(planetHit, false);
    return hit.length > 0;
  }
  function dragTo(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectPlane(orbitalPlane, tmpV)) return;
    const dAU = clamp(tmpV.length() / AU_UNITS, HZ.DISTANCE_RANGE_AU.min, HZ.DISTANCE_RANGE_AU.max);
    if (tmpV.lengthSq() > 1e-8) state.angle = Math.atan2(-tmpV.z, tmpV.x);
    state.distanceAU = Math.round(dAU * 1000) / 1000;
    distanceSlider.setValue(state.distanceAU, { silent: true });
    refresh();
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

  // --- animation ------------------------------------------------------------------------------------------------------------
  function frame(dt) {
    if (state.playing) {
      const next = state.ageGyr + dt * EVOLUTION_GYR_PER_SECOND;
      if (next >= HZ.MAX_AGE_GYR) {
        state.ageGyr = HZ.MAX_AGE_GYR;
        setPlaying(false);
      } else state.ageGyr = next;
      ageSlider.setValue(state.ageGyr, { silent: true });
      model = derive();
    }
    if (!dragging) {
      const omega = Math.min(MAX_ANGULAR_SPEED, (2 * Math.PI) / (model.periodYears * SECONDS_PER_ORBIT_YEAR));
      state.angle = (state.angle + omega * dt) % (Math.PI * 2);
    }
    starMaterial.uniforms.uTime.value += dt;
    planetMaterial.uniforms.uTime.value += dt;
    stepTween(dt);
    updateScene();
    updateOverlay();
    updateReadouts();
  }
  sim.onFrame(frame);
  const onControlsChange = () => {
    updateOverlay();
  };
  controls.addEventListener('change', onControlsChange);
  disposers.push(() => controls.removeEventListener('change', onControlsChange));

  // --- state setters ---------------------------------------------------------------------------------------------------------------
  function setLuminosity(L, { silent = false } = {}) {
    state.luminosity = clamp(L, HZ.LUMINOSITY_RANGE.min, HZ.LUMINOSITY_RANGE.max);
    if (state.evolution) {
      state.evolution = false;
      setPlaying(false);
    }
    if (!silent) luminositySlider.setValue(Math.log10(state.luminosity), { silent: true });
    syncPresetButtons();
    refresh();
  }
  function setAge(age) {
    state.ageGyr = clamp(age, 0, HZ.MAX_AGE_GYR);
    state.evolution = true;
    ageSlider.setValue(state.ageGyr, { silent: true });
    model = derive();
    luminositySlider.setValue(Math.log10(model.star.luminosity), { silent: true });
    syncPresetButtons();
    refresh();
  }
  function setPlaying(v) {
    state.playing = v;
    if (v) {
      state.evolution = true;
      if (state.ageGyr >= HZ.MAX_AGE_GYR - 1e-6) state.ageGyr = 0;
      syncPresetButtons();
    }
    syncPlayButton();
  }
  function setDistance(dAU) {
    state.distanceAU = clamp(dAU, HZ.DISTANCE_RANGE_AU.min, HZ.DISTANCE_RANGE_AU.max);
    distanceSlider.setValue(state.distanceAU, { silent: true });
    refresh();
  }

  // --- UI ---------------------------------------------------------------------------------------------------------------------------------
  const panel = createPanel();

  // star section
  const starSection = createSection(`${KEYS}.sections.star`);
  const presetRow = el('div', 'lp-presets', { role: 'group' });
  bindAttr(presetRow, { 'aria-label': `${KEYS}.star.presets` });
  const presetButtons = HZ.STAR_PRESETS.map((preset) => {
    const btn = createButton({
      labelKey: `${KEYS}.star.preset${preset.id}`,
      ariaKey: `${KEYS}.star.preset${preset.id}Aria`,
      onClick: () => {
        setLuminosity(preset.luminosity);
        frameZone();
      },
    });
    btn.el.classList.add('lp-presets__btn');
    const swatch = el('span', 'lp-presets__swatch', { 'aria-hidden': 'true' });
    const [r, g, b] = HZ.starColorRGB(HZ.mainSequenceStar(preset.luminosity).teffK);
    swatch.style.background = `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
    btn.el.prepend(swatch);
    presetRow.append(btn.el);
    return { preset, el: btn.el };
  });
  function syncPresetButtons() {
    for (const { preset, el: btn } of presetButtons) {
      const active = !state.evolution && Math.abs(Math.log10(state.luminosity) - Math.log10(preset.luminosity)) < 0.005;
      btn.setAttribute('aria-pressed', String(active));
    }
  }
  const luminositySlider = createSlider({
    labelKey: `${KEYS}.star.luminosity`,
    min: Math.log10(HZ.LUMINOSITY_RANGE.min),
    max: Math.log10(HZ.LUMINOSITY_RANGE.max),
    step: 0.01,
    value: Math.log10(state.luminosity),
    format: (v) => formatLuminosity(Math.pow(10, v)),
    onChange: (v) => setLuminosity(Math.pow(10, v), { silent: true }),
  });
  luminositySlider.input.addEventListener('change', frameZoneIfNeeded);
  const starFacts = createFacts([
    ['type', `${KEYS}.star.type`],
    ['teff', `${KEYS}.star.temperature`],
    ['mass', `${KEYS}.star.mass`],
    ['radius', `${KEYS}.star.radius`],
    ['zone', `${KEYS}.zone.edges`],
    ['width', `${KEYS}.zone.width`],
  ]);
  starSection.add(presetRow, luminositySlider, starFacts);

  // planet section
  const planetSection = createSection(`${KEYS}.sections.planet`);
  const distanceSlider = createSlider({
    labelKey: `${KEYS}.planet.distance`,
    unitKey: 'units.au',
    min: HZ.DISTANCE_RANGE_AU.min,
    max: HZ.DISTANCE_RANGE_AU.max,
    step: 0.01,
    value: state.distanceAU,
    decimals: 2,
    onChange: (v) => {
      state.distanceAU = v;
      refresh();
    },
  });
  const readout = el('div', 'lp-readout');
  const readoutValue = el('div', 'lp-readout__value', { 'aria-live': 'off' });
  const readoutLabel = bindText(el('div', 'lp-readout__label'), `${KEYS}.planet.teq`);
  const statePill = el('span', 'lp-state', { role: 'status' });
  const stateHint = el('p', 'lp-state__hint');
  readout.append(readoutLabel, readoutValue, statePill, stateHint);
  const planetFacts = createFacts([
    ['insolation', `${KEYS}.planet.insolation`],
    ['period', `${KEYS}.planet.period`],
  ]);
  const dragNotice = el('p', 'lp-drag-hint');
  bindText(dragNotice, `${KEYS}.planet.dragHint`);
  planetSection.add(distanceSlider, readout, planetFacts, dragNotice);

  // evolution section
  const evolutionSection = createSection(`${KEYS}.sections.evolution`);
  const ageSlider = createSlider({
    labelKey: `${KEYS}.evolution.age`,
    min: 0,
    max: HZ.MAX_AGE_GYR,
    step: 0.01,
    value: state.ageGyr,
    format: (v) => `${fmt(v, 2)} ${t('units.gigayears')}${Math.abs(v - HZ.SUN_AGE_GYR) < 0.03 ? ` (${t(`${KEYS}.evolution.today`)})` : ''}`,
    onChange: (v) => {
      setPlaying(false);
      setAge(v);
    },
  });
  const playBtn = createButton({ labelKey: `${KEYS}.evolution.play`, icon: '▶', variant: 'primary', onClick: () => setPlaying(!state.playing) });
  function syncPlayButton() {
    playBtn.el.querySelector('.lp-button__icon').textContent = state.playing ? '⏸' : '▶';
    bindText(playBtn.el.querySelector('[data-i18n]'), state.playing ? `${KEYS}.evolution.pause` : `${KEYS}.evolution.play`);
  }
  const todayBtn = createButton({
    labelKey: `${KEYS}.evolution.resetToday`,
    onClick: () => {
      setPlaying(false);
      setAge(HZ.SUN_AGE_GYR);
    },
  });
  const evolutionRow = el('div', 'lp-button-row');
  evolutionRow.append(playBtn.el, todayBtn.el);
  const windowNote = el('p', 'lp-window-note', { role: 'status' });
  const evolutionNote = bindText(el('p', 'lp-section__note'), `${KEYS}.evolution.note`);
  evolutionSection.add(ageSlider, evolutionRow, windowNote, evolutionNote);

  // view section
  const viewSection = createSection(`${KEYS}.sections.view`);
  const zoneToggle = createToggle({ labelKey: `${KEYS}.view.zone`, checked: state.showZone, onChange: (v) => { state.showZone = v; refresh(); } });
  const shellToggle = createToggle({ labelKey: `${KEYS}.view.shell`, checked: state.showShell, onChange: (v) => { state.showShell = v; refresh(); } });
  const tempToggle = createToggle({ labelKey: `${KEYS}.view.tempLabels`, checked: state.showTempLabels, onChange: (v) => { state.showTempLabels = v; refresh(); } });
  const gridToggle = createToggle({ labelKey: `${KEYS}.view.grid`, checked: state.showGrid, onChange: (v) => { state.showGrid = v; refresh(); } });
  const cameraRow = el('div', 'lp-button-row');
  const frameBtn = createButton({ labelKey: `${KEYS}.view.frameZone`, icon: '◎', onClick: () => frameZone() });
  const overviewBtn = createButton({ labelKey: `${KEYS}.view.overview`, icon: '⤢', onClick: () => frameOverview() });
  cameraRow.append(frameBtn.el, overviewBtn.el);
  const legend = createLegend();
  viewSection.add(zoneToggle, shellToggle, tempToggle, gridToggle, cameraRow, legend);

  const resetBtn = createButton({
    labelKey: 'panel.reset',
    icon: '↺',
    onClick: () => {
      setPlaying(false);
      Object.assign(state, DEFAULTS);
      luminositySlider.setValue(Math.log10(state.luminosity), { silent: true });
      distanceSlider.setValue(state.distanceAU, { silent: true });
      ageSlider.setValue(state.ageGyr, { silent: true });
      zoneToggle.setChecked(state.showZone, { silent: true });
      shellToggle.setChecked(state.showShell, { silent: true });
      tempToggle.setChecked(state.showTempLabels, { silent: true });
      gridToggle.setChecked(state.showGrid, { silent: true });
      syncPresetButtons();
      refresh();
      frameZone();
    },
  });
  const resetRow = el('div', 'lp-button-row');
  resetRow.append(resetBtn.el);

  panel.add(starSection, planetSection, evolutionSection, viewSection, resetRow);
  if (sim.reducedMotion) panel.add(createNotice({ textKey: 'motion.reducedNotice' }));
  const infoCard = createInfoCard({ titleKey: `${KEYS}.info.title`, bodyKey: `${KEYS}.info.body`, open: !window.matchMedia('(max-width: 720px)').matches });
  const physicsCard = createPhysicsCard();
  panel.add(infoCard, physicsCard);
  container.append(panel.el);

  const hint = el('div', 'lp-sim__hint', { 'aria-hidden': 'true' });
  hint.append(bindText(el('span'), 'panel.hint'), document.createTextNode(' · '), bindText(el('span'), `${KEYS}.hint`));
  container.append(hint);

  // --- readouts ------------------------------------------------------------------------------------------------------------------------------
  let lastReadoutKey = '';
  function updateReadouts(force = false) {
    const { star, zone, teqK, status } = model;
    const key = `${star.luminosity.toFixed(5)}|${state.distanceAU.toFixed(3)}|${state.evolution}|${status}`;
    if (!force && key === lastReadoutKey) return;
    lastReadoutKey = key;
    starFacts.set('type', t(`${KEYS}.star.types.${model.type}`));
    starFacts.set('teff', `${fmt(star.teffK, 0)} ${t('units.kelvin')}`);
    starFacts.set('mass', `${fmt(star.massSolar, 2)} ${t('units.solarMass')}`);
    starFacts.set('radius', `${fmt(star.radiusSolar, 2)} ${t('units.solarRadius')}`);
    const zoneDigits = zone.outer < 0.2 ? 3 : 2;
    starFacts.set('zone', `${fmt(zone.inner, zoneDigits)} – ${fmt(zone.outer, zoneDigits)} ${t('units.au')}`);
    starFacts.set('width', `${fmt(zone.outer - zone.inner, zoneDigits)} ${t('units.au')}`);
    readoutValue.textContent = `${fmt(teqK, 0)} ${t('units.kelvin')} · ${fmt(teqK - 273.15, 0)} ${t('units.celsius')}`;
    statePill.textContent = t(`${KEYS}.planet.${status}`);
    statePill.className = `lp-state lp-state--${status}`;
    stateHint.textContent = t(`${KEYS}.planet.${status}Hint`);
    planetFacts.set('insolation', `${fmt(model.insolation, model.insolation < 0.1 ? 3 : 2)} ${t('units.solarFlux')}`);
    const days = model.periodYears * 365.25;
    planetFacts.set('period', days < 1000 ? t(`${KEYS}.planet.days`, { n: fmt(days, days < 10 ? 1 : 0, 0) }) : t(`${KEYS}.planet.years`, { n: fmt(model.periodYears, 2) }));
    const win = HZ.habitableWindowGyr(state.distanceAU);
    const dText = fmt(state.distanceAU, 2);
    windowNote.textContent = win
      ? t(`${KEYS}.evolution.window`, { d: dText, from: fmt(win.from, 1), to: fmt(win.to, 1) })
      : t(`${KEYS}.evolution.never`, { d: dText });
  }

  // --- language --------------------------------------------------------------------------------------------------------------------------------
  disposers.push(
    onLanguageChange(() => {
      updateScene();
      updateReadouts(true);
      physicsCard.render();
      syncPlayButton();
      sim.requestRender();
    }),
  );

  // --- go ------------------------------------------------------------------------------------------------------------------------------------------
  syncPresetButtons();
  syncPlayButton();
  refresh();
  updateReadouts(true);
  frameZone(0);
  sim.start();

  // dev-only hook for automated checks; stripped from production builds
  if (import.meta.env.DEV) window.__lpHabitableZone = { sim, state, get model() { return model; }, setLuminosity, setDistance, setAge, setPlaying, frame, frameZone, frameOverview, refresh };

  return () => {
    if (import.meta.env.DEV) delete window.__lpHabitableZone;
    disposers.forEach((d) => d());
    panel.dispose();
    hint.remove();
    Object.values(labels).flat().forEach((l) => l.dispose());
    glowTexture.dispose();
    sim.dispose();
    viewport.remove();
  };
}

// ============================================================================================================
// UI helpers (local to this simulation)
// ============================================================================================================
function formatLuminosity(L) {
  const digits = L < 0.01 ? 4 : L < 0.1 ? 3 : 2;
  return `${formatNumber(L, { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${t('units.solarLuminosity')}`;
}

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
  const item = (key, swatchClass, color) => {
    const li = el('div', 'lp-legend__item');
    const swatch = el('span', `lp-legend__swatch ${swatchClass}`, { 'aria-hidden': 'true' });
    if (color) swatch.style.color = color;
    li.append(swatch, bindText(el('span'), key));
    return li;
  };
  wrap.append(
    item(`${KEYS}.legend.zone`, 'lp-legend__swatch--zone'),
    item(`${KEYS}.legend.orbit`, '', '#7cc4ff'),
    item(`${KEYS}.legend.todayZone`, 'lp-legend__swatch--dashed', '#9ff5bd'),
  );
  return { el: wrap, dispose() {} };
}

/** Collapsible "Physics" card listing the formulas used. */
function createPhysicsCard() {
  const details = el('details', 'lp-info lp-physics');
  const summary = el('summary', 'lp-info__summary');
  summary.append(bindText(el('span', 'lp-info__title'), `${KEYS}.physics.title`));
  const body = el('div', 'lp-info__body');
  details.append(summary, body);
  const entries = [
    ['zone', true],
    ['teq', true],
    ['state', true],
    ['evolution', true],
    ['star', false],
    ['period', false],
  ];
  function render() {
    body.replaceChildren();
    for (const [id, hasNote] of entries) {
      const block = el('div', 'lp-formula');
      const label = el('p', 'lp-formula__label');
      label.textContent = t(`${KEYS}.physics.${id}Label`);
      const code = el('code', 'lp-formula__code');
      code.textContent = t(`${KEYS}.physics.${id}Formula`);
      block.append(label, code);
      if (hasNote) {
        const note = el('p', 'lp-formula__note');
        note.textContent = t(`${KEYS}.physics.${id}Note`);
        block.append(note);
      }
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
function circleGeometry(radius, segments = 192) {
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
  let currentColor = `#${new THREE.Color(color).getHexString()}`;
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
    setColor(c) {
      const hex = `#${new THREE.Color(c).getHexString()}`;
      if (hex === currentColor) return;
      currentColor = hex;
      if (currentText !== null) draw();
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

const STAR_VERTEX = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vPos = position;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const STAR_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uContrast;
  varying vec3 vPos;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  ${NOISE_GLSL}
  void main() {
    vec3 p = normalize(vPos);
    float granules = fbm(p * 9.0 + vec3(uTime * 0.03), 4);
    float spots = smoothstep(0.66, 0.74, fbm(p * 2.6 - vec3(uTime * 0.008), 3));
    float limb = pow(clamp(dot(normalize(vNormalW), normalize(vViewDir)), 0.0, 1.0), 0.45);
    vec3 col = uColor * (0.82 + uContrast * (granules - 0.5) * 2.0);
    col *= 1.0 - 0.55 * spots;
    col *= mix(0.4, 1.0, limb);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const PLANET_VERTEX = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  void main() {
    vPos = position;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const PLANET_FRAGMENT = /* glsl */ `
  uniform float uThaw;      // 0 = frozen, 1 = temperate
  uniform float uScorch;    // 0 = temperate, 1 = scorched
  uniform vec3 uLightColor;
  uniform float uLightIntensity;
  uniform float uTime;
  varying vec3 vPos;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  ${NOISE_GLSL}
  // palettes in linear RGB
  const vec3 OCEAN_DEEP = vec3(0.004, 0.035, 0.16);
  const vec3 OCEAN_SHALLOW = vec3(0.012, 0.11, 0.26);
  const vec3 LAND_GREEN = vec3(0.03, 0.14, 0.03);
  const vec3 LAND_BROWN = vec3(0.20, 0.13, 0.05);
  const vec3 ICE = vec3(0.80, 0.86, 0.92);
  const vec3 ICE_SHADE = vec3(0.45, 0.58, 0.72);
  const vec3 ROCK_DARK = vec3(0.045, 0.012, 0.006);
  const vec3 ROCK_RED = vec3(0.16, 0.035, 0.012);
  const vec3 LAVA = vec3(1.0, 0.22, 0.02);
  void main() {
    vec3 p = normalize(vPos);
    float continents = fbm(p * 1.9 + vec3(3.1, 1.7, 5.3), 5);
    float land = smoothstep(0.47, 0.53, continents);
    float detail = fbm(p * 6.5 + vec3(7.0), 4);
    float lat = abs(normalize(vPos).y);

    // temperate (Earth-like)
    vec3 ocean = mix(OCEAN_DEEP, OCEAN_SHALLOW, smoothstep(0.35, 0.5, continents));
    vec3 landCol = mix(LAND_GREEN, LAND_BROWN, smoothstep(0.35, 0.75, detail));
    landCol = mix(landCol, LAND_BROWN * 1.3, smoothstep(0.6, 0.85, continents)); // highlands
    float polar = smoothstep(0.80, 0.90, lat + (detail - 0.5) * 0.12);
    vec3 temperate = mix(mix(ocean, landCol, land), ICE, polar);
    float clouds = smoothstep(0.52, 0.68, fbm(p * 3.0 + vec3(uTime * 0.01, 0.0, 11.0), 4));
    temperate = mix(temperate, vec3(0.85), clouds * 0.75);

    // frozen: everything iced over, faint continental relief
    vec3 frozen = mix(ICE, ICE_SHADE, clamp((1.0 - land) * 0.45 + (0.5 - detail) * 0.4 + (continents - 0.5) * 0.3, 0.0, 1.0));
    frozen = mix(frozen, vec3(0.62, 0.72, 0.82), smoothstep(0.55, 0.75, fbm(p * 4.0 + vec3(21.0), 3)) * 0.4);

    // scorched: dark cracked rock with glowing fissures
    vec3 rock = mix(ROCK_DARK, ROCK_RED, detail);
    float veins = fbm(p * 5.0 + vec3(13.0, 4.0, 2.0), 4);
    float cracks = pow(1.0 - abs(veins * 2.0 - 1.0), 14.0);
    vec3 scorched = rock + LAVA * cracks * 0.9;
    vec3 emissive = LAVA * cracks * uScorch * 0.9;

    vec3 albedo = mix(frozen, temperate, uThaw);
    albedo = mix(albedo, scorched, uScorch);

    // lighting: star at the origin
    vec3 N = normalize(vNormalW);
    vec3 L = normalize(-vWorldPos);
    float diffuse = clamp((dot(N, L) + 0.12) / 1.12, 0.0, 1.0);
    diffuse = pow(diffuse, 0.9);
    vec3 nightAmbient = vec3(0.05, 0.07, 0.12) * 0.25;
    vec3 col = albedo * (uLightColor * uLightIntensity * diffuse + nightAmbient) + emissive;
    // specular glint on open water (temperate only)
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 H = normalize(L + V);
    float spec = pow(clamp(dot(N, H), 0.0, 1.0), 60.0) * (1.0 - land) * uThaw * (1.0 - uScorch) * (1.0 - clouds);
    col += uLightColor * spec * 0.35 * step(0.0, dot(N, L));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const ATMOSPHERE_VERTEX = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying vec3 vWorldPos;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const ATMOSPHERE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying vec3 vWorldPos;
  void main() {
    // back-face rim: bright where the surface normal is perpendicular to the view
    float rim = pow(1.0 - clamp(dot(normalize(-vNormalW), normalize(vViewDir)), 0.0, 1.0), 3.0);
    float lit = clamp(dot(normalize(-vNormalW), normalize(-vWorldPos)) * 0.5 + 0.6, 0.15, 1.0);
    gl_FragColor = vec4(uColor * rim * lit * uStrength, rim * 0.9);
    #include <colorspace_fragment>
  }
`;

const SHELL_VERTEX = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

/** Fresnel-weighted translucency: the shell is densest where it is seen edge-on, so its silhouettes read as rings. */
const SHELL_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    float edge = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir))), 2.5);
    gl_FragColor = vec4(uColor, (0.04 + edge) * uOpacity);
    #include <colorspace_fragment>
  }
`;
