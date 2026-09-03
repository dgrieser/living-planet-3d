/**
 * Simulation: The habitable zone ("habitable-zone").
 *
 * A main-sequence star (type/luminosity adjustable) with a single planet whose
 * distance can be set by slider or by dragging it in the orbital plane; the star
 * itself can be grown or shrunk by pulling its limb. The conservative habitable
 * zone (Kopparapu et al. 2013) is drawn as a translucent annulus and/or a 3D shell
 * and scales live with the luminosity. The planet's surface morphs between a
 * snowball, the real Earth (day map + city lights on the night side, as in the
 * axial-tilt simulation) and a Venus-like cloud world that melts into a lava world
 * according to its equilibrium temperature. An evolution mode ages a Sun-like star
 * from 0 to 10 Gyr and shows the zone migrating outward past Earth.
 *
 * Scene units: 1 AU = AU_UNITS; the orbital plane is y = 0, the planet orbits
 * counter-clockwise seen from above (+y). All physics lives in ./physics.js.
 */
import * as THREE from 'three';
import { createScene } from '../../lib/scene.js';
import { createPanel, createSection, createSlider, createStateToggle, createButton, createInfoCard, createNotice, el } from '../../lib/ui.js';
import { createViewPrefs } from '../../lib/prefs.js';
import { t, bindText, bindAttr, onLanguageChange, formatNumber } from '../../lib/i18n.js';
import * as HZ from './physics.js';

const KEYS = 'sims.habitableZone';
const TEXTURE_BASE = `${import.meta.env.BASE_URL}textures/`;
const AU_UNITS = 10; // scene units per astronomical unit
const PLANET_RADIUS = 0.16; // scene units (strongly exaggerated for visibility)
const PLANET_TILT_RAD = THREE.MathUtils.degToRad(23.4); // Earth-like axial tilt, fixed in space while the planet orbits
const PLANET_ROTATION_SPEED_RANGE = Object.freeze({ min: 0, max: 180, step: 1, default: 20 }); // visual degrees per second
const STAR_UNIT_RADIUS = 0.5; // scene units for 1 R☉ (≈ 11× exaggerated)
const STAR_MAX_RADIUS = 0.8; // keeps very luminous stars clear of a planet at 0.1 AU
const CORONA_EXTENT = 5; // corona billboard half-size in star radii
const STAR_PULL_MIN_PX_PER_DECADE = 70; // pull gain for a tiny star disc: 70 px of radial drag per decade of luminosity
const SECONDS_PER_ORBIT_YEAR = 20; // visual time: a 1-year orbit takes 20 s
const MAX_ANGULAR_SPEED = Math.PI; // rad/s – close-in planets would otherwise flicker
const EVOLUTION_GYR_PER_SECOND = 0.4; // 10 Gyr in 25 s
const HIT_LAYER = 1;
const ZONE_COLOR = 0x5adc8c;
const STATE_COLORS = Object.freeze({ frozen: 0x9fd8ff, habitable: 0x5adc8c, scorched: 0xff6b4a });
const LABEL_DIRECTION = new THREE.Vector3(-0.62, 0, 0.78).normalize(); // where zone-edge labels sit (lower left in the default view)
const GRID_LABEL_DIRECTION = new THREE.Vector3(0.92, 0, 0.4).normalize(); // right of the star, clear of its temperature label
const GRID_LABEL_AU = [0.5, 1, 2, 3, 4, 5];
const TEMP_UNITS = Object.freeze(['both', 'kelvin', 'celsius']);

const DEFAULTS = Object.freeze({
  luminosity: 1,
  distanceAU: 1,
  ageGyr: HZ.SUN_AGE_GYR,
  evolution: false,
  rotationSpeed: PLANET_ROTATION_SPEED_RANGE.default, // visual degrees per second
});

/** Display toggles – remembered per visitor, see ../../lib/prefs.js. */
const VIEW_DEFAULTS = Object.freeze({
  showZone: true,
  showZoneSurface: true, // flat annulus with its edge lines
  showZoneShell: false, // translucent 3D shell
  showTempLabels: true,
  showGrid: true,
  tempUnit: 'both', // 'both' | 'kelvin' | 'celsius' – for the star and the planet alike
});

const { clamp } = HZ;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const fmt = (v, digits, min = digits) => formatNumber(v, { maximumFractionDigits: digits, minimumFractionDigits: min });

export default function mount(container, meta) {
  const viewPrefs = createViewPrefs(meta.id, VIEW_DEFAULTS);
  const state = { ...DEFAULTS, ...viewPrefs.values, playing: false, angle: Math.PI * 0.15 };
  if (!TEMP_UNITS.includes(state.tempUnit)) state.tempUnit = VIEW_DEFAULTS.tempUnit;
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
  const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // --- star ------------------------------------------------------------------------------
  const starMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0xfff0c8) },
      uTime: { value: 0 },
      uContrast: { value: 0.15 },
      uSpots: { value: 0.35 },
      uFlare: { value: 0 },
    },
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
  });
  const starMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), starMaterial);
  starMesh.name = 'star';
  scene.add(starMesh);
  // corona: a camera-facing quad with animated streamers, drawn outside the disc only
  const coronaMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0xfff0c8) },
      uTime: { value: 0 },
      uFlare: { value: 0 },
      uStarFrac: { value: 1 / CORONA_EXTENT },
      uIntensity: { value: 1 },
    },
    vertexShader: CORONA_VERTEX,
    fragmentShader: CORONA_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const corona = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), coronaMaterial);
  corona.renderOrder = 2;
  scene.add(corona);
  const glowTexture = createGlowTexture();
  const starGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  const starHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, transparent: true, opacity: 0.4, depthWrite: false, depthTest: false, sizeAttenuation: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  starHalo.scale.set(0.12, 0.12, 1);
  starHalo.renderOrder = 5;
  scene.add(starGlow, starHalo);
  const starHit = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial());
  starHit.layers.set(HIT_LAYER);
  starHit.userData.kind = 'star';
  scene.add(starHit);
  const ringTexture = createRingTexture();
  const starMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture, color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, depthTest: false, sizeAttenuation: false }));
  starMarker.renderOrder = 9;
  scene.add(starMarker);

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

  const planetGroup = new THREE.Group(); // translated to the orbit position, scaled for legibility
  const planetTilt = new THREE.Group(); // axial tilt (axis leans towards −x, fixed in space)
  planetTilt.rotation.z = -PLANET_TILT_RAD;
  const planetSpin = new THREE.Group(); // rotation about the tilted axis
  const placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  placeholder.needsUpdate = true;
  const planetMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uThaw: { value: 1 },
      uScorch: { value: 0 },
      uCold: { value: 0 },
      uHeat: { value: 0 },
      uLightColor: { value: new THREE.Color(0xffffff) },
      uLightIntensity: { value: 1.6 },
      uTime: { value: 0 },
      uDayMap: { value: placeholder },
      uNightMap: { value: placeholder },
      uHasDay: { value: 0 },
      uHasNight: { value: 0 },
    },
    vertexShader: PLANET_VERTEX,
    fragmentShader: PLANET_FRAGMENT,
  });
  const planetMesh = new THREE.Mesh(new THREE.SphereGeometry(PLANET_RADIUS, 96, 64), planetMaterial);
  planetMesh.name = 'planet';
  planetSpin.add(planetMesh);
  planetTilt.add(planetSpin);
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
  planetGroup.add(planetTilt, atmosphere);
  scene.add(planetGroup);
  const planetHit = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial());
  planetHit.layers.set(HIT_LAYER);
  planetHit.userData.kind = 'planet';
  scene.add(planetHit);
  const planetMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture, color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, depthTest: false, sizeAttenuation: false }));
  planetMarker.renderOrder = 9;
  planetMarker.scale.set(0.05, 0.05, 1);
  scene.add(planetMarker);

  // Earth maps (Solar System Scope, CC BY 4.0) – the same assets as the axial-tilt simulation.
  // The procedural surface stays as a fallback while they load or if they are missing.
  const textureLoader = new THREE.TextureLoader();
  const loadMap = (file, mapUniform, flagUniform) => {
    textureLoader.load(
      `${TEXTURE_BASE}${file}`,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = maxAnisotropy;
        planetMaterial.uniforms[mapUniform].value = tex;
        planetMaterial.uniforms[flagUniform].value = 1;
        sim.requestRender();
      },
      undefined,
      () => console.warn(`[habitable-zone] texture not available: ${file} – using the procedural surface`),
    );
  };
  loadMap('2k_earth_daymap.jpg', 'uDayMap', 'uHasDay');
  loadMap('2k_earth_nightmap.jpg', 'uNightMap', 'uHasNight');

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

  /** Temperature in the visitor's chosen unit(s). */
  function formatTemp(kelvin) {
    const k = `${fmt(kelvin, 0)} ${t('units.kelvin')}`;
    const c = `${fmt(kelvin - 273.15, 0)} ${t('units.celsius')}`;
    if (state.tempUnit === 'kelvin') return k;
    if (state.tempUnit === 'celsius') return c;
    return `${k} · ${c}`;
  }

  /** Push the model into the scene graph (everything that does not depend on the camera). */
  function updateScene() {
    const { star, zone, mix, starRadius } = model;
    const [r, g, b] = HZ.starColorRGB(star.teffK);
    starColor.setRGB(r, g, b, THREE.SRGBColorSpace);
    starMaterial.uniforms.uColor.value.copy(starColor);
    starMaterial.uniforms.uContrast.value = clamp(0.35 + (4500 - star.teffK) / 6000, 0.3, 0.55);
    // cooler stars are more heavily spotted; M dwarfs are flare stars
    starMaterial.uniforms.uSpots.value = clamp((7200 - star.teffK) / 4200, 0.1, 1);
    starMaterial.uniforms.uFlare.value = HZ.smoothstep(4300, 3300, star.teffK);
    coronaMaterial.uniforms.uColor.value.copy(starColor);
    coronaMaterial.uniforms.uFlare.value = starMaterial.uniforms.uFlare.value;
    starMesh.scale.setScalar(starRadius); // refined per frame in updateOverlay()
    starGlow.material.color.copy(starColor);
    starHalo.material.color.copy(starColor);

    const zoneScale = Math.sqrt(star.luminosity);
    zoneGroup.scale.setScalar(zoneScale);
    zoneGroup.visible = state.showZone;
    annulus.visible = state.showZoneSurface;
    shellGroup.visible = state.showZoneShell;
    todayGroup.visible = state.showZone && state.showZoneSurface && state.evolution && Math.abs(state.ageGyr - HZ.SUN_AGE_GYR) > 0.03;
    gridGroup.visible = state.showGrid;

    const d = state.distanceAU * AU_UNITS;
    orbitLine.scale.setScalar(d);
    planetPos.set(d * Math.cos(state.angle), 0, -d * Math.sin(state.angle));
    planetGroup.position.copy(planetPos);
    planetMaterial.uniforms.uThaw.value = mix.thaw;
    planetMaterial.uniforms.uScorch.value = mix.scorch;
    planetMaterial.uniforms.uCold.value = mix.cold;
    planetMaterial.uniforms.uHeat.value = mix.heat;
    // light the planet with a desaturated version of the star colour so the surface state stays readable around red stars
    planetMaterial.uniforms.uLightColor.value.copy(starColor).lerp(tmpColor.set(0xffffff), 0.6);
    planetMaterial.uniforms.uLightIntensity.value = 1.7 * Math.pow(clamp(model.insolation, 0.02, 8), 0.25);
    const atm = atmosphereMaterial.uniforms.uColor.value;
    atm.setHex(STATE_COLORS.frozen).lerp(tmpColor.setHex(0x4f9dff), mix.thaw).lerp(tmpColor.setHex(0xff7a30), mix.scorch);
    // a Venus-like cloud world has a thick, bright haze; a lava world only a thin, hot glow
    atmosphereMaterial.uniforms.uStrength.value = (0.7 + 0.5 * mix.thaw) * (1 - mix.scorch) + mix.scorch * (1.3 - 0.7 * mix.heat);

    labels.zoneInner.setText(`${fmt(zone.inner, 2)} ${t('units.au')}`);
    labels.zoneOuter.setText(`${fmt(zone.outer, 2)} ${t('units.au')}`);
    labels.planetName.setText(t(`${KEYS}.planet.${model.isEarth ? 'earth' : 'name'}`));
    labels.planetName.setColor(STATE_COLORS[model.status]);
    labels.planetTemp.setText(formatTemp(model.teqK));
    labels.starTemp.setText(`${formatTemp(star.teffK)} · ${model.type}`);
    labels.grid.forEach((l, i) => l.setText(`${fmt(GRID_LABEL_AU[i], GRID_LABEL_AU[i] % 1 ? 1 : 0)} ${t('units.au')}`));
  }

  /** Camera-dependent bits: label placement, hit-sphere sizes, markers, corona billboard, near plane. */
  function updateOverlay() {
    tmpUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const planetDist = Math.max(camera.position.distanceTo(planetPos), 1e-6);
    const starDist = Math.max(camera.position.length(), 1e-6);
    // keep the bodies legible at any zoom: never smaller than ~1 % of the viewing distance
    const planetRadius = Math.max(PLANET_RADIUS, planetDist * 0.014);
    planetGroup.scale.setScalar(planetRadius / PLANET_RADIUS);
    const starRadius = Math.max(model.starRadius, starDist * 0.009);
    starMesh.scale.setScalar(starRadius);
    // the glow grows a little with the luminosity (≈ +1 star radius per decade)
    starGlow.scale.setScalar(starRadius * (5.5 + 1.5 * clamp(Math.log10(model.star.luminosity) + 2, 0, 3)));
    corona.scale.setScalar(starRadius * CORONA_EXTENT);
    corona.quaternion.copy(camera.quaternion);
    coronaMaterial.uniforms.uStarFrac.value = 1 / CORONA_EXTENT;
    planetHit.position.copy(planetPos);
    planetHit.scale.setScalar(Math.max(planetRadius * 1.6, planetDist * 0.02));
    starHit.scale.setScalar(Math.max(starRadius * 1.2, starDist * 0.03)); // a little generous: the pull may start anywhere on the disc
    planetMarker.position.copy(planetPos);
    planetMarker.visible = drag?.kind === 'planet' || hovering === 'planet';
    // sizeAttenuation is off: a scale of 2·r/d spans the star's apparent diameter, the ring sits at 0.42 of the sprite
    const starMarkerScale = Math.max(0.05, (3.1 * starRadius) / starDist);
    starMarker.scale.setScalar(starMarkerScale);
    starMarker.visible = (drag?.kind === 'star' || hovering === 'star') && starMarkerScale < 0.6; // pointless once the disc fills the view

    labels.planetName.sprite.position.copy(planetPos).addScaledVector(tmpUp, planetRadius + planetDist * 0.03);
    labels.planetTemp.sprite.visible = state.showTempLabels;
    labels.planetTemp.sprite.position.copy(planetPos).addScaledVector(tmpUp, -(planetRadius + planetDist * 0.03));
    labels.starTemp.sprite.visible = state.showTempLabels;
    labels.starTemp.sprite.position.copy(tmpUp).multiplyScalar(-(starRadius + starDist * 0.035));

    const zoneScale = Math.sqrt(model.star.luminosity) * AU_UNITS;
    labels.zoneInner.sprite.visible = labels.zoneOuter.sprite.visible = state.showZone && (state.showZoneSurface || state.showZoneShell);
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

  // --- interaction: drag the planet, pull the star -----------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  raycaster.layers.set(HIT_LAYER);
  const pointer = new THREE.Vector2();
  const orbitalPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let drag = null; // null | { kind: 'planet' } | { kind: 'star', dirX, dirY, startPx, startLog, pxPerDecade }
  let hovering = null; // null | 'planet' | 'star'
  const canvas = renderer.domElement;

  function setPointer(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }
  /** Which body is under the pointer ('planet' | 'star' | null) – the nearer one wins where they overlap. */
  function pick(e) {
    setPointer(e);
    const hits = raycaster.intersectObjects([planetHit, starHit], false);
    return hits.length ? hits[0].object.userData.kind : null;
  }
  /** Pointer offset (CSS px) from the star's centre on screen, and the star's apparent radius in px. */
  function starScreenOffset(e) {
    const rect = canvas.getBoundingClientRect();
    tmpV.set(0, 0, 0).project(camera);
    const cx = rect.left + ((tmpV.x + 1) / 2) * rect.width;
    const cy = rect.top + ((1 - tmpV.y) / 2) * rect.height;
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const radiusPx = ((starMesh.scale.x / Math.max(camera.position.length(), 1e-6)) / tanV) * (rect.height / 2);
    return { dx: e.clientX - cx, dy: e.clientY - cy, radiusPx };
  }
  /**
   * The pull works in screen space along the radial line through the first touch: moving outward grows
   * the star (and brightens it along the main sequence, R ∝ L^0.24), moving inward – past the centre if
   * need be – shrinks it. The gain follows the star's apparent size, so on a large disc the limb roughly
   * tracks the pointer, while a tiny disc at overview zoom still gets a usable 70 px per decade.
   */
  function startStarPull(e) {
    const { dx, dy, radiusPx } = starScreenOffset(e);
    const len = Math.hypot(dx, dy);
    return {
      kind: 'star',
      dirX: len > 1 ? dx / len : 1,
      dirY: len > 1 ? dy / len : 0,
      startPx: len,
      startLog: Math.log10(model.star.luminosity),
      pxPerDecade: Math.max(STAR_PULL_MIN_PX_PER_DECADE, 0.8 * radiusPx),
    };
  }
  function dragPlanetTo(e) {
    setPointer(e);
    if (!raycaster.ray.intersectPlane(orbitalPlane, tmpV)) return;
    const dAU = clamp(tmpV.length() / AU_UNITS, HZ.DISTANCE_RANGE_AU.min, HZ.DISTANCE_RANGE_AU.max);
    if (tmpV.lengthSq() > 1e-8) state.angle = Math.atan2(-tmpV.z, tmpV.x);
    state.distanceAU = Math.round(dAU * 1000) / 1000;
    distanceSlider.setValue(state.distanceAU, { silent: true });
    refresh();
  }
  function pullStarTo(e) {
    const { dx, dy } = starScreenOffset(e);
    const signed = dx * drag.dirX + dy * drag.dirY; // radial displacement along the initial pull direction
    setLuminosity(Math.pow(10, drag.startLog + (signed - drag.startPx) / drag.pxPerDecade));
  }
  const onPointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const kind = pick(e);
    if (!kind) return;
    drag = kind === 'star' ? startStarPull(e) : { kind };
    controls.enabled = false; // registered in the capture phase, so OrbitControls sees `enabled === false`
    canvas.classList.add('is-dragging');
    try {
      canvas.setPointerCapture?.(e.pointerId);
    } catch {
      /* synthetic or already-released pointer – the drag still works, it just cannot follow outside the canvas */
    }
    e.stopPropagation();
    if (kind === 'planet') dragPlanetTo(e);
    else updateOverlay();
    sim.requestRender();
  };
  const onPointerMove = (e) => {
    if (drag) {
      if (drag.kind === 'planet') dragPlanetTo(e);
      else pullStarTo(e);
      return;
    }
    const over = pick(e);
    if (over !== hovering) {
      hovering = over;
      canvas.classList.toggle('is-grab', over !== null);
      updateOverlay();
      sim.requestRender();
    }
  };
  const endDrag = (e) => {
    if (!drag) return;
    const wasStar = drag.kind === 'star';
    drag = null;
    controls.enabled = true;
    canvas.classList.remove('is-dragging');
    if (e && canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (wasStar) frameZoneIfNeeded();
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
    if (drag?.kind !== 'planet') {
      const omega = Math.min(MAX_ANGULAR_SPEED, (2 * Math.PI) / (model.periodYears * SECONDS_PER_ORBIT_YEAR));
      state.angle = (state.angle + omega * dt) % (Math.PI * 2);
    }
    planetSpin.rotation.y = (planetSpin.rotation.y + THREE.MathUtils.degToRad(state.rotationSpeed) * dt) % (Math.PI * 2);
    starMaterial.uniforms.uTime.value += dt;
    coronaMaterial.uniforms.uTime.value += dt;
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
  function setRotationSpeed(degreesPerSecond, { silent = false } = {}) {
    state.rotationSpeed = clamp(degreesPerSecond, PLANET_ROTATION_SPEED_RANGE.min, PLANET_ROTATION_SPEED_RANGE.max);
    if (!silent) rotationSpeedSlider.setValue(state.rotationSpeed, { silent: true });
  }
  function setDistance(dAU) {
    state.distanceAU = clamp(dAU, HZ.DISTANCE_RANGE_AU.min, HZ.DISTANCE_RANGE_AU.max);
    distanceSlider.setValue(state.distanceAU, { silent: true });
    refresh();
  }
  function setTempUnit(unit) {
    if (!TEMP_UNITS.includes(unit)) return;
    state.tempUnit = unit;
    viewPrefs.set('tempUnit', unit);
    unitSwitch.set(unit);
    updateScene();
    updateReadouts(true);
    sim.requestRender();
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
  const starDragNotice = bindText(el('p', 'lp-drag-hint'), `${KEYS}.star.dragHint`);
  starSection.add(presetRow, luminositySlider, starFacts, starDragNotice);

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
  const rotationSpeedSlider = createSlider({
    labelKey: `${KEYS}.planet.rotationSpeed`,
    unitKey: 'units.degreesPerSecond',
    min: PLANET_ROTATION_SPEED_RANGE.min,
    max: PLANET_ROTATION_SPEED_RANGE.max,
    step: PLANET_ROTATION_SPEED_RANGE.step,
    value: state.rotationSpeed,
    decimals: 0,
    onChange: (v) => setRotationSpeed(v, { silent: true }),
  });
  const dragNotice = bindText(el('p', 'lp-drag-hint'), `${KEYS}.planet.dragHint`);
  planetSection.add(distanceSlider, rotationSpeedSlider, readout, planetFacts, dragNotice);

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
  const viewToggle = (name, labelKey, onChange = refresh) => createStateToggle({ labelKey, state, name, prefs: viewPrefs, onChange });
  // the zone toggle owns two sub-toggles (flat annulus / 3D shell) so either representation can be shown alone
  const zoneToggle = viewToggle('showZone', `${KEYS}.view.zone`, (on) => {
    if (on && !state.showZoneSurface && !state.showZoneShell) {
      // switching the zone on with both representations off would show nothing – bring the annulus back
      state.showZoneSurface = true;
      viewPrefs.set('showZoneSurface', true);
      surfaceToggle.setChecked(true, { silent: true });
    }
    syncZoneToggles();
    refresh();
  });
  const surfaceToggle = viewToggle('showZoneSurface', `${KEYS}.view.zoneSurface`);
  const shellToggle = viewToggle('showZoneShell', `${KEYS}.view.zoneShell`);
  surfaceToggle.el.classList.add('lp-toggle--sub');
  shellToggle.el.classList.add('lp-toggle--sub');
  function syncZoneToggles() {
    surfaceToggle.input.disabled = shellToggle.input.disabled = !state.showZone;
  }
  syncZoneToggles();
  const tempToggle = viewToggle('showTempLabels', `${KEYS}.view.tempLabels`);
  const unitSwitch = createSegmented({
    labelKey: `${KEYS}.view.tempUnit`,
    value: state.tempUnit,
    options: [
      { id: 'kelvin', labelKey: `${KEYS}.view.unitKelvin`, ariaKey: `${KEYS}.view.unitKelvinAria` },
      { id: 'celsius', labelKey: `${KEYS}.view.unitCelsius`, ariaKey: `${KEYS}.view.unitCelsiusAria` },
      { id: 'both', labelKey: `${KEYS}.view.unitBoth`, ariaKey: `${KEYS}.view.unitBothAria` },
    ],
    onChange: setTempUnit,
  });
  const gridToggle = viewToggle('showGrid', `${KEYS}.view.grid`);
  const cameraRow = el('div', 'lp-button-row');
  const frameBtn = createButton({ labelKey: `${KEYS}.view.frameZone`, icon: '◎', onClick: () => frameZone() });
  const overviewBtn = createButton({ labelKey: `${KEYS}.view.overview`, icon: '⤢', onClick: () => frameOverview() });
  cameraRow.append(frameBtn.el, overviewBtn.el);
  const legend = createLegend();
  viewSection.add(zoneToggle, surfaceToggle, shellToggle, tempToggle, unitSwitch, gridToggle, cameraRow, legend);

  const resetBtn = createButton({
    labelKey: 'panel.reset',
    icon: '↺',
    onClick: () => {
      setPlaying(false);
      Object.assign(state, DEFAULTS);
      luminositySlider.setValue(Math.log10(state.luminosity), { silent: true });
      distanceSlider.setValue(state.distanceAU, { silent: true });
      ageSlider.setValue(state.ageGyr, { silent: true });
      rotationSpeedSlider.setValue(state.rotationSpeed, { silent: true });
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
  const credit = el('div', 'lp-sim__credit');
  const creditLink = el('a', '', { href: 'https://www.solarsystemscope.com/textures/', target: '_blank', rel: 'noopener noreferrer license' });
  bindText(creditLink, `${KEYS}.credit`);
  credit.append(creditLink);
  container.append(hint, credit);

  // --- readouts ------------------------------------------------------------------------------------------------------------------------------
  let lastReadoutKey = '';
  function updateReadouts(force = false) {
    const { star, zone, teqK, status } = model;
    const key = `${star.luminosity.toFixed(5)}|${state.distanceAU.toFixed(3)}|${state.evolution}|${status}|${state.tempUnit}`;
    if (!force && key === lastReadoutKey) return;
    lastReadoutKey = key;
    starFacts.set('type', t(`${KEYS}.star.types.${model.type}`));
    starFacts.set('teff', formatTemp(star.teffK));
    starFacts.set('mass', `${fmt(star.massSolar, 2)} ${t('units.solarMass')}`);
    starFacts.set('radius', `${fmt(star.radiusSolar, 2)} ${t('units.solarRadius')}`);
    const zoneDigits = zone.outer < 0.2 ? 3 : 2;
    starFacts.set('zone', `${fmt(zone.inner, zoneDigits)} – ${fmt(zone.outer, zoneDigits)} ${t('units.au')}`);
    starFacts.set('width', `${fmt(zone.outer - zone.inner, zoneDigits)} ${t('units.au')}`);
    readoutValue.textContent = formatTemp(teqK);
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
  if (import.meta.env.DEV) window.__lpHabitableZone = { sim, state, get model() { return model; }, setLuminosity, setDistance, setAge, setPlaying, setRotationSpeed, setTempUnit, frame, frameZone, frameOverview, refresh, planetMaterial, starMaterial };

  return () => {
    if (import.meta.env.DEV) delete window.__lpHabitableZone;
    disposers.forEach((d) => d());
    panel.dispose();
    hint.remove();
    credit.remove();
    Object.values(labels).flat().forEach((l) => l.dispose());
    glowTexture.dispose();
    ringTexture.dispose();
    placeholder.dispose();
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

/**
 * Segmented control: a labelled row of mutually exclusive buttons (aria-pressed marks the active one).
 * @param {{ labelKey: string, value: string, options: { id: string, labelKey: string, ariaKey?: string }[], onChange: (id: string) => void }} opts
 */
function createSegmented({ labelKey, value, options, onChange }) {
  const wrap = el('div', 'lp-control lp-unit-switch');
  const row = el('div', 'lp-control__row');
  row.append(bindText(el('span', 'lp-control__label'), labelKey));
  const group = el('div', `lp-presets lp-presets--${options.length}`, { role: 'group' });
  bindAttr(group, { 'aria-label': labelKey });
  let current = value;
  const buttons = options.map((opt) => {
    const btn = createButton({ labelKey: opt.labelKey, ariaKey: opt.ariaKey, onClick: () => onChange(opt.id) });
    btn.el.classList.add('lp-presets__btn');
    group.append(btn.el);
    return { id: opt.id, el: btn.el };
  });
  const set = (id) => {
    current = id;
    for (const b of buttons) b.el.setAttribute('aria-pressed', String(b.id === id));
  };
  set(value);
  wrap.append(row, group);
  return {
    el: wrap,
    set,
    get value() {
      return current;
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
    ['appearance', true],
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
  vec3 rotateY(vec3 p, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  }
  // occasional short bursts (0 most of the time, spikes up to ≈ 1) – shared by the star surface and its corona
  float flareBurst(float time) {
    float clock = time * 0.35;
    return pow(max(0.0, noise(vec3(clock, 17.3, 4.2)) * 1.9 - 0.95), 3.0) * 1.2;
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

/**
 * Photosphere: churning granulation (bright convection cells, dark intergranular lanes),
 * sunspots with umbra + penumbra in an activity belt, bright faculae near the limb,
 * limb darkening with a slight reddening, and – for cool stars – flares.
 */
const STAR_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uContrast;  // granulation contrast
  uniform float uSpots;     // 0…1 how spotted the star is (F ≈ 0.15, Sun ≈ 0.35, M dwarf ≈ 1)
  uniform float uFlare;     // 0…1 flare activity (M dwarfs)
  varying vec3 vPos;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  ${NOISE_GLSL}
  void main() {
    vec3 p = rotateY(normalize(vPos), uTime * 0.02); // slow stellar rotation
    float mu = clamp(dot(normalize(vNormalW), normalize(vViewDir)), 0.0, 1.0);

    // granulation: a fine carpet of bright cells outlined by dark lanes (zero-crossings of a churning noise
    // field), plus a gentle large-scale brightness variation (supergranulation / faculae network)
    float g1 = fbm(p * 30.0 + vec3(uTime * 0.05, 0.0, -uTime * 0.04), 3);
    float g2 = fbm(p * 70.0 - vec3(0.0, uTime * 0.12, uTime * 0.07), 2);
    float big = fbm(p * 3.0 + vec3(0.0, uTime * 0.01, 0.0), 3);
    float lanes = 1.0 - smoothstep(0.0, 0.3, abs(g1 * 2.0 - 1.0));
    float granules = 1.0 - uContrast * (0.55 * lanes + 0.35 * (0.5 - g2)) + 0.08 * (big - 0.5);

    // sunspots: cool umbra with a lighter penumbra, kept away from the poles on Sun-like stars
    float spotField = fbm(p * 2.8 + vec3(5.0, 1.0, 2.0) - vec3(uTime * 0.006), 3);
    float belt = mix(1.0 - smoothstep(0.45, 0.75, abs(p.y)), 1.0, smoothstep(0.6, 1.0, uSpots));
    float threshold = mix(0.74, 0.58, uSpots);
    float penumbra = smoothstep(threshold - 0.07, threshold - 0.01, spotField) * belt;
    float umbra = smoothstep(threshold - 0.01, threshold + 0.03, spotField) * belt;
    float faculae = smoothstep(threshold - 0.18, threshold - 0.08, spotField) * (1.0 - penumbra) * belt * (1.0 - mu) * 0.45;

    // limb darkening (≈ 0.6 in the visible) with a slight reddening towards the edge
    float limb = 1.0 - 0.62 * (1.0 - pow(mu, 0.8));
    vec3 limbTint = mix(vec3(1.0), vec3(1.0, 0.82, 0.62), (1.0 - mu) * 0.5);

    // flare stars: brief white-hot brightenings of an active region
    float burst = flareBurst(uTime);
    float site = smoothstep(0.55, 0.7, fbm(p * 3.5 + vec3(floor(uTime * 0.35) * 7.1), 3));
    float flare = uFlare * burst * site;

    vec3 col = uColor * granules;
    col *= 1.0 - 0.28 * penumbra - 0.5 * umbra;
    col += uColor * faculae;
    col *= limb * limbTint;
    col += vec3(1.0, 0.96, 0.9) * flare * 1.2;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const CORONA_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Corona billboard: a thin chromospheric rim at the limb, then streamers that fade steeply with distance. */
const CORONA_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uFlare;
  uniform float uStarFrac;  // star radius as a fraction of the quad's half-size
  uniform float uIntensity;
  varying vec2 vUv;
  ${NOISE_GLSL}
  void main() {
    vec2 q = vUv * 2.0 - 1.0;
    float r = length(q);
    if (r >= 1.0 || r < uStarFrac * 0.9) discard;
    float a = atan(q.y, q.x);
    float inner = smoothstep(uStarFrac - 0.015, uStarFrac + 0.005, r); // nothing inside the disc
    float rr = max(r - uStarFrac, 0.0) / (1.0 - uStarFrac);            // 0 at the limb, 1 at the quad edge
    // streamers: radial structure drifting slowly outward, plus fine filaments
    float streamers = fbm(vec3(cos(a) * 2.5, sin(a) * 2.5, rr * 3.0 - uTime * 0.05), 4);
    float fine = fbm(vec3(cos(a) * 7.0, sin(a) * 7.0, rr * 6.0 - uTime * 0.09), 3);
    float structure = 0.45 + 1.1 * smoothstep(0.3, 0.8, streamers) + 0.5 * (fine - 0.5);
    float falloff = pow(1.0 - rr, 2.0) / (1.0 + rr * 11.0);
    float burst = flareBurst(uTime) * uFlare;
    float glow = falloff * structure * inner * uIntensity * (1.0 + burst * 2.0) * 1.1;
    // chromosphere: thin, slightly reddish rim right above the limb
    float rimX = (r - uStarFrac) / 0.012;
    float rim = exp(-rimX * rimX) * inner * 0.7;
    vec3 col = mix(uColor, vec3(1.0), 0.3) * glow + uColor * vec3(1.0, 0.7, 0.55) * rim;
    gl_FragColor = vec4(col, min(1.0, glow + rim));
    #include <colorspace_fragment>
  }
`;

const PLANET_VERTEX = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  varying vec2 vUv;
  void main() {
    vPos = position;
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

/**
 * Planet surface. Three looks blended by the state mix from ./physics.js:
 *  - temperate: the real Earth day map, city lights gated to the night side (as in the axial-tilt
 *    simulation); a procedural Earth with drifting clouds while the maps are unavailable
 *  - frozen: a snowball – sea ice with dark refrozen leads, snow-covered continents, blowing snow;
 *    bare tundra shows through at the equator just past the outer edge (uCold → 0)
 *  - scorched: a Venus-like banded cloud deck just past the inner edge (uHeat → 0) that burns off to
 *    baked, cracked rock with pulsing glowing fissures and, on the star-facing side, lava seas (uHeat → 1)
 */
const PLANET_FRAGMENT = /* glsl */ `
  uniform float uThaw;      // 0 = frozen, 1 = temperate
  uniform float uScorch;    // 0 = temperate, 1 = scorched
  uniform float uCold;      // 0 = just frozen, 1 = deep-frozen
  uniform float uHeat;      // 0 = just scorched (cloud world), 1 = lava world
  uniform vec3 uLightColor;
  uniform float uLightIntensity;
  uniform float uTime;
  uniform sampler2D uDayMap;
  uniform sampler2D uNightMap;
  uniform float uHasDay;
  uniform float uHasNight;
  varying vec3 vPos;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  varying vec2 vUv;
  ${NOISE_GLSL}
  // palettes in linear RGB
  const vec3 OCEAN_DEEP = vec3(0.004, 0.035, 0.16);
  const vec3 OCEAN_SHALLOW = vec3(0.012, 0.11, 0.26);
  const vec3 LAND_GREEN = vec3(0.03, 0.14, 0.03);
  const vec3 LAND_BROWN = vec3(0.20, 0.13, 0.05);
  const vec3 ICE = vec3(0.80, 0.86, 0.92);
  const vec3 ICE_SHADE = vec3(0.45, 0.58, 0.72);
  const vec3 SEA_ICE = vec3(0.60, 0.72, 0.84);
  const vec3 SEA_ICE_DARK = vec3(0.40, 0.54, 0.70);
  const vec3 LEAD = vec3(0.04, 0.09, 0.18);
  const vec3 TUNDRA = vec3(0.16, 0.12, 0.08);
  const vec3 ROCK_DARK = vec3(0.045, 0.012, 0.006);
  const vec3 ROCK_RED = vec3(0.16, 0.035, 0.012);
  const vec3 LAVA = vec3(1.0, 0.22, 0.02);
  const vec3 LAVA_DARK = vec3(0.30, 0.04, 0.004);
  const vec3 HAZE_LIGHT = vec3(0.82, 0.62, 0.34);
  const vec3 HAZE_DARK = vec3(0.42, 0.29, 0.13);
  void main() {
    vec3 p = normalize(vPos);
    vec3 N = normalize(vNormalW);
    vec3 L = normalize(-vWorldPos); // the star sits at the origin
    vec3 V = normalize(cameraPosition - vWorldPos);
    float ndl = dot(N, L);
    float lat = abs(p.y);
    float detail = fbm(p * 6.5 + vec3(7.0), 4);

    // continents: from the Earth map when available (ocean = blue-dominant), procedural otherwise
    vec3 dayTex = texture2D(uDayMap, vUv).rgb;
    float land;
    float continents = 0.5;
    if (uHasDay > 0.5) {
      land = 1.0 - smoothstep(0.15, 0.5, (dayTex.b - max(dayTex.r, dayTex.g)) / (dayTex.b + 0.002));
    } else {
      continents = fbm(p * 1.9 + vec3(3.1, 1.7, 5.3), 5);
      land = smoothstep(0.47, 0.53, continents);
    }

    // --- temperate: Earth -----------------------------------------------------------------------
    vec3 temperate = vec3(0.0);
    vec3 lights = vec3(0.0);
    float clouds = 0.0;
    if (uThaw > 0.001 && uScorch < 0.999) {
      if (uHasDay > 0.5) {
        temperate = dayTex;
      } else {
        vec3 ocean = mix(OCEAN_DEEP, OCEAN_SHALLOW, smoothstep(0.35, 0.5, continents));
        vec3 landCol = mix(LAND_GREEN, LAND_BROWN, smoothstep(0.35, 0.75, detail));
        landCol = mix(landCol, LAND_BROWN * 1.3, smoothstep(0.6, 0.85, continents)); // highlands
        float polar = smoothstep(0.80, 0.90, lat + (detail - 0.5) * 0.12);
        temperate = mix(mix(ocean, landCol, land), ICE, polar);
        clouds = smoothstep(0.52, 0.68, fbm(p * 3.0 + vec3(uTime * 0.01, 0.0, 11.0), 4));
        temperate = mix(temperate, vec3(0.85), clouds * 0.75);
      }
      if (uHasNight > 0.5) {
        // city lights, faded out across the terminator so they only show on the night side
        lights = texture2D(uNightMap, vUv).rgb * smoothstep(0.08, -0.12, ndl) * 1.8;
      }
    }

    // --- frozen: snowball ---------------------------------------------------------------------------
    vec3 frozen = vec3(0.0);
    if (uThaw < 0.999) {
      float relief = (uHasDay > 0.5) ? clamp(dot(dayTex, vec3(0.33)) * 4.0, 0.0, 1.0) : detail;
      // sea ice: gently mottled, criss-crossed by thin dark leads (refrozen cracks)
      float leadField = fbm(p * 7.0 + vec3(21.0, 3.0, 8.0), 4);
      float leads = pow(1.0 - abs(leadField * 2.0 - 1.0), 18.0);
      vec3 seaIce = mix(SEA_ICE, SEA_ICE_DARK, smoothstep(0.4, 0.7, fbm(p * 3.5 + vec3(9.0), 3)) * 0.6);
      seaIce = mix(seaIce, LEAD, leads * 0.85);
      // land: snow over the relief; just past the edge bare tundra pokes through near the equator
      vec3 landIce = mix(ICE_SHADE, ICE, 0.45 + 0.55 * relief);
      float bare = (1.0 - uCold) * smoothstep(0.4, 0.08, lat) * smoothstep(0.42, 0.55, detail);
      landIce = mix(landIce, TUNDRA, bare * 0.95);
      vec3 surface = mix(seaIce, landIce, land);
      surface = mix(surface, vec3(0.62, 0.74, 0.92), uCold * 0.3); // deep freeze: thicker, bluer ice
      // blowing snow and ice fog drifting across the surface
      float wisps = smoothstep(0.55, 0.78, fbm(rotateY(p, uTime * 0.03) * 4.0 + vec3(0.0, uTime * 0.01, 31.0), 4));
      frozen = mix(surface, vec3(0.9, 0.93, 0.97), wisps * 0.5);
    }

    // --- scorched: cloud world → cracked rock → lava world ----------------------------------------------
    vec3 scorched = vec3(0.0);
    vec3 emissive = vec3(0.0);
    if (uScorch > 0.001) {
      vec3 rock = mix(ROCK_DARK, ROCK_RED, detail);
      // fissures that slowly shift and pulse
      float veins = fbm(p * 5.0 + vec3(13.0, 4.0, 2.0) + vec3(uTime * 0.012), 4);
      float cracks = pow(1.0 - abs(veins * 2.0 - 1.0), 14.0);
      float pulse = 0.72 + 0.28 * sin(uTime * 1.3 + veins * 25.0);
      // molten seas: grow with the heat and pool on the star-facing side
      float seaField = fbm(p * 2.2 + vec3(2.0, 8.0, 5.0) + vec3(0.0, uTime * 0.004, 0.0), 4);
      float seaLevel = mix(0.78, 0.44, uHeat);
      float sea = smoothstep(seaLevel, seaLevel + 0.08, seaField) * smoothstep(-0.25, 0.35, ndl) * smoothstep(0.12, 0.5, uHeat);
      float ripple = fbm(p * 14.0 + vec3(uTime * 0.15, 0.0, uTime * 0.1), 3);
      vec3 lava = mix(LAVA_DARK, LAVA, 0.45 + 0.55 * ripple);
      vec3 surface = mix(rock, LAVA_DARK * 0.5, sea);
      float glowCracks = cracks * mix(0.35, 1.0, uHeat) * pulse;
      emissive = LAVA * glowCracks * (1.0 - sea) + lava * sea * (0.8 + 0.4 * ripple);
      // Venus-like cloud deck: banded, slowly circulating; burns off as the heat rises
      float cover = 1.0 - smoothstep(0.05, 0.45, uHeat);
      vec3 hp = rotateY(p, uTime * 0.05);
      float bands = fbm(vec3(hp.x, hp.y * 3.5, hp.z) * 2.2 + vec3(0.0, 0.0, uTime * 0.01), 4);
      float swirl = fbm(hp * 5.0 + vec3(3.0), 3);
      vec3 haze = mix(HAZE_DARK, HAZE_LIGHT, smoothstep(0.25, 0.75, bands)) * (0.8 + 0.4 * swirl);
      scorched = mix(surface, haze, cover);
      emissive *= (1.0 - cover * 0.95) * uScorch;
    }

    vec3 albedo = mix(frozen, temperate, uThaw);
    albedo = mix(albedo, scorched, uScorch);

    // lighting: star at the origin
    float diffuse = clamp((ndl + 0.12) / 1.12, 0.0, 1.0);
    diffuse = pow(diffuse, 0.9);
    vec3 nightAmbient = vec3(0.05, 0.07, 0.12) * 0.25;
    vec3 col = albedo * (uLightColor * uLightIntensity * diffuse + nightAmbient) + emissive + lights * uThaw * (1.0 - uScorch);
    // specular glint: open water (temperate) and glossy ice (frozen)
    vec3 H = normalize(L + V);
    float spec = pow(clamp(dot(N, H), 0.0, 1.0), 60.0) * step(0.0, ndl) * (1.0 - land) * (1.0 - uScorch);
    col += uLightColor * spec * (0.35 * (1.0 - clouds) * uThaw + 0.3 * (1.0 - uThaw));
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
