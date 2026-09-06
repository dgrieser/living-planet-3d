/**
 * Simulation: The habitable zone ("habitable-zone").
 *
 * A main-sequence star (type/luminosity adjustable) with a single planet whose
 * distance can be set by slider or by dragging it in the orbital plane; the star is dragged up
 * and down for its type, which carries its temperature, size and brightness together along the
 * main sequence, while a slider can inflate it off that sequence into a subgiant or a giant.
 * A "frame zone" mode keeps the star, the planet and the zone in view,
 * re-framing whenever a gesture ends (pointer up / touch released). The conservative habitable
 * zone (Kopparapu et al. 2014, with their temperature-dependent flux limits) is drawn as a
 * translucent annulus and/or a 3D shell and follows the star live. The planet's surface morphs between a
 * snowball, the real Earth (day map + city lights on the night side, as in the
 * axial-tilt simulation) and a Venus-like cloud world that melts into a lava world
 * according to its equilibrium temperature. An evolution mode ages a Sun-like star
 * from 0 to 10 Gyr and shows the zone migrating outward past Earth. A single speed
 * slider scales the whole animation – planet spin, orbital motion, stellar evolution
 * and the star/corona/surface shader time – so 0× freezes the scene and 5× runs it
 * five times faster.
 *
 * Scene units: 1 AU = AU_UNITS; the orbital plane is y = 0, the planet orbits
 * counter-clockwise seen from above (+y). All physics lives in ./physics.js.
 */
import * as THREE from 'three';
import { createScene } from '../../lib/scene.js';
import { createPanel, createPanelShift, createCollapsibleSection, createControlRow, createSlider, createStateToggle, createButton, createInfoCard, createNotice, el } from '../../lib/ui.js';
import { createViewPrefs } from '../../lib/prefs.js';
import { t, bindText, bindAttr, onLanguageChange, formatNumber } from '../../lib/i18n.js';
import * as HZ from './physics.js';

const KEYS = 'sims.habitableZone';
const TEXTURE_BASE = `${import.meta.env.BASE_URL}textures/`;
const AU_UNITS = 10; // scene units per astronomical unit
// Everything drawn in the scene is to scale except the two bodies, and their exaggeration is
// stated rather than hidden: both are built from their true radii times a factor.
const PLANET_EXAGGERATION = 375; // Earth is drawn 375× too large, or it would be a speck
const PLANET_RADIUS = HZ.EARTH_RADIUS_AU * AU_UNITS * PLANET_EXAGGERATION; // ≈ 0.16 scene units
const PLANET_TILT_RAD = THREE.MathUtils.degToRad(23.4); // Earth-like axial tilt, fixed in space while the planet orbits
const PLANET_SPIN_RAD_PER_S = 0.35; // visual spin at 1× speed, one rotation every ≈ 18 s
const STAR_TRUE_UNIT_RADIUS = HZ.SOLAR_RADIUS_AU * AU_UNITS; // 1 R☉ at true scale: 0.0465 scene units
const CORONA_EXTENT = 5; // corona billboard half-size in star radii
/** How far the star's disc is drawn larger than life. 1× is the truth (a barely visible dot at
 *  this zoom), the default 11× keeps its surface legible without swallowing a close-in orbit. */
const STAR_SCALE_RANGE = Object.freeze({ min: 1, max: 60, default: 11 });
// Dragging the star: sideways picks its type (luminosity), up/down its display size. Both are
// log-linear, and the gain is taken from the canvas so one comfortable gesture spans the whole
// range on a phone as well as on a desktop.
const STAR_DRAG_TYPE_SPAN = 0.6; // fraction of the canvas height the whole temperature range takes
const STAR_DRAG_TRAVEL_PX = Object.freeze({ min: 260, max: 900 }); // ... but never a shorter or longer gesture than this
/**
 * The planet close-up: where the camera sits relative to the planet, in planet radii, so the
 * planet keeps the same apparent size at any orbit. It stands outside the orbit and a little to
 * the side and above it, and aims between the two bodies so the planet sits `frame` of the way
 * from the centre to the right edge with the star further left – measured against the frame's
 * own half-angle, so a narrow phone screen gets the same picture as a wide one, and the planet
 * gives way towards the edge when a distant star would otherwise fall outside `starFrame`.
 */
const PLANET_VIEW = Object.freeze({
  dist: 7.5, // camera distance from the planet, in planet radii
  fov: 66, // wider than the scene's own: it takes room to hold a lit planet and its star at once
  swing: 70, // degrees off the anti-star direction at most – see planetView() for what sets it
  tilt: 12, // degrees of extra height on a wide frame, so the view looks down on the orbital plane
  frame: 0.45, // the planet sits this far from the centre towards the edge, the star the other way
  starFrame: 0.75,
  edge: 0.72, // the planet's centre never goes further out than this, so its disc stays whole
  margin: 0.9, // ... and the swing stops short of the very limit, so neither body sits on an edge
  starClearance: 1.4,
});
const CAMERA_MODES = Object.freeze(['fit', 'follow', 'free']);
/**
 * The camera views the panel's header button steps through, in the order of their buttons
 * in the panel. "Overview" is not a mode of its own: it flies out wide and hands the camera
 * back to the visitor ('free'), so the header button shows no view as active afterwards.
 */
const CAMERA_VIEWS = Object.freeze([
  { id: 'fit', labelKey: `${KEYS}.view.frameZone` },
  { id: 'follow', labelKey: `${KEYS}.view.followPlanet` },
  { id: 'overview', labelKey: `${KEYS}.view.overview` },
]);
const FIT_TOLERANCE = 1.06; // how far the framing may drift before the fit mode re-frames
const FIT_TOLERANCE_PLAYING = 1.3; // ... and while stellar evolution runs, so the camera does not creep along with it
const SECONDS_PER_ORBIT_YEAR = 20; // visual time: at 1× speed a 1-year orbit takes 20 s
const MAX_ANGULAR_SPEED = Math.PI; // rad/s at 1× speed – close-in planets would otherwise flicker
/**
 * Dragging the planet. The pointer's travel is read in a frame fixed when the planet is picked up
 * (see `planetDragFrame()`) and the planet eases towards where that puts it over this time
 * constant, which takes the twitch out of a gesture that spans two and a half decades of
 * temperature. Crossing the whole 0.1–5 AU range always takes at least `DRAG_RANGE_TRAVEL` canvas
 * heights of travel: a roomy view then drags one-to-one, while a phone – where the whole system is
 * squeezed into a few hundred pixels, and pointing at a place in the plane turns a nudge into a
 * sweep across the zone – is slowed to something steerable.
 */
const DRAG_EASE_S = 0.13;
const DRAG_RANGE_TRAVEL = 1.4;
/** How fast the planet may travel while it catches up, so a flick cannot fling it across the system. */
const DRAG_MAX_AU_PER_S = 3.5;
const DRAG_MAX_RAD_PER_S = 5;
/** The ease lands on the target rather than approaching it forever. */
const DRAG_SNAP_AU = 0.002;
const DRAG_SNAP_RAD = 0.002;
const EVOLUTION_GYR_PER_SECOND = 0.4; // at 1× speed: 10 Gyr in 25 s
const SPEED_RANGE = Object.freeze({ min: 0, max: 5, step: 0.1, default: 1 }); // overall animation speed, 0 freezes the scene
const HIT_LAYER = 1;
// Hit spheres are sized in screen pixels, not in a fraction of the viewing distance: what makes a
// body easy to grab is how big it is under a fingertip, and a phone's canvas is a third the height
// of a desktop's. Radii, so 22 px is a 44 px target – about a fingertip.
const PLANET_TARGET_PX = 22;
const STAR_TARGET_PX = 26;
const ZONE_COLOR = 0x5adc8c;
const STATE_COLORS = Object.freeze({ frozen: 0x9fd8ff, habitable: 0x5adc8c, scorched: 0xff6b4a });
const LABEL_DIRECTION = new THREE.Vector3(-0.62, 0, 0.78).normalize(); // where zone-edge labels sit (lower left in the default view)
const GRID_LABEL_DIRECTION = new THREE.Vector3(0.92, 0, 0.4).normalize(); // right of the star, clear of its temperature label
const GRID_LABEL_AU = [0.5, 1, 2, 3, 4, 5];
const TEMP_UNITS = Object.freeze(['both', 'kelvin', 'celsius']);

const DEFAULTS = Object.freeze({
  // the star is set by what a visitor can point at: how hot it is and how big it is.
  // Its luminosity follows from those two (Stefan–Boltzmann), not the other way round.
  teffK: HZ.SOLAR_TEFF_K,
  radiusSolar: 1,
  distanceAU: 1,
  ageGyr: HZ.SUN_AGE_GYR,
  evolution: false,
  speed: SPEED_RANGE.default, // overall animation speed multiplier
});

/** Display settings – remembered per visitor, see ../../lib/prefs.js. The scene starts on the
 *  star and its planet alone; switching the zone back on brings the flat annulus with it. */
const VIEW_DEFAULTS = Object.freeze({
  showZone: false,
  showZoneSurface: false, // flat annulus with its edge lines
  showZoneShell: false, // translucent 3D shell
  showTempLabels: true,
  showGrid: false,
  tempUnit: 'celsius', // 'both' | 'kelvin' | 'celsius' – for the star and the planet alike
  starScale: STAR_SCALE_RANGE.default, // how far the star's disc is drawn larger than life (display only)
  // 'fit' keeps the star, the planet and the zone framed by themselves, 'follow' rides along
  // with the planet, 'free' leaves the camera to the visitor
  cameraMode: 'fit',
});

const { clamp } = HZ;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const fmt = (v, digits, min = digits) => formatNumber(v, { maximumFractionDigits: digits, minimumFractionDigits: min });

export default function mount(container, meta) {
  const viewPrefs = createViewPrefs(meta.id, VIEW_DEFAULTS);
  const state = { ...DEFAULTS, ...viewPrefs.values, playing: false, angle: Math.PI * 0.15 };
  if (!TEMP_UNITS.includes(state.tempUnit)) state.tempUnit = VIEW_DEFAULTS.tempUnit;
  state.starScale = Number.isFinite(state.starScale) ? clamp(state.starScale, STAR_SCALE_RANGE.min, STAR_SCALE_RANGE.max) : VIEW_DEFAULTS.starScale;
  if (!CAMERA_MODES.includes(state.cameraMode)) state.cameraMode = VIEW_DEFAULTS.cameraMode;
  const TEFF_DECADES = Math.log10(HZ.TEFF_RANGE_K.max / HZ.TEFF_RANGE_K.min); // ≈ 0.44
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

  // --- habitable zone -------------------------------------------------------------------------
  // The two edges move independently: their ratio depends on the star's temperature, so the
  // annulus cannot be one shape scaled by √L. The edge loops and shells are unit geometry scaled
  // to each radius, and the fill is a unit disc whose shader drops everything inside the inner
  // edge – exact at any ratio, with nothing to rebuild while the star is being dragged.
  const zoneGroup = new THREE.Group();
  const annulus = new THREE.Group();
  annulus.rotation.x = -Math.PI / 2;
  const zoneFillMaterial = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(ZONE_COLOR) }, uOpacity: { value: 0.22 }, uInnerRatio: { value: 0.5 } },
    vertexShader: ANNULUS_VERTEX,
    fragmentShader: ANNULUS_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const zoneFill = new THREE.Mesh(new THREE.CircleGeometry(1, 256), zoneFillMaterial);
  zoneFill.renderOrder = -2;
  const zoneEdgeMaterial = new THREE.LineBasicMaterial({ color: 0x9ff5bd, transparent: true, opacity: 0.85, depthWrite: false });
  const zoneEdgeInner = new THREE.LineLoop(circleGeometry(1), zoneEdgeMaterial);
  const zoneEdgeOuter = new THREE.LineLoop(circleGeometry(1), zoneEdgeMaterial);
  annulus.add(zoneFill, zoneEdgeInner, zoneEdgeOuter);
  const shellMaterial = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(ZONE_COLOR) }, uOpacity: { value: 0.4 } },
    vertexShader: SHELL_VERTEX,
    fragmentShader: SHELL_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shellInner = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), shellMaterial);
  const shellOuter = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), shellMaterial);
  shellInner.renderOrder = shellOuter.renderOrder = -1;
  const shellGroup = new THREE.Group();
  shellGroup.add(shellInner, shellOuter);
  zoneGroup.add(annulus, shellGroup);
  scene.add(zoneGroup);

  // present-day zone (dashed) shown while the star evolves
  const todayMaterial = new THREE.LineDashedMaterial({ color: 0x9ff5bd, dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.5, depthWrite: false });
  const todayGroup = new THREE.Group();
  todayGroup.rotation.x = -Math.PI / 2;
  const sunToday = HZ.sunAtAge(HZ.SUN_AGE_GYR);
  const todayZone = HZ.zoneEdgesAU(sunToday.luminosity, sunToday.teffK);
  for (const r of [todayZone.inner, todayZone.outer]) {
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
      uLivable: { value: 1 },
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
    const star = state.evolution ? HZ.sunAtAge(state.ageGyr) : HZ.starFromTeffRadius(state.teffK, state.radiusSolar);
    // both zone edges follow the star's temperature, not only its luminosity (Kopparapu et al. 2014)
    const zone = HZ.zoneEdgesAU(star.luminosity, star.teffK);
    const teqK = HZ.equilibriumTemperatureK(star.luminosity, state.distanceAU);
    return {
      star,
      zone,
      edgeTemps: HZ.edgeTemperaturesK(star.teffK),
      teqK,
      status: HZ.classify(teqK, star.teffK),
      mix: HZ.stateMix(teqK, star.teffK),
      type: HZ.spectralType(star.teffK),
      insolation: HZ.insolation(star.luminosity, state.distanceAU),
      periodYears: HZ.orbitalPeriodYears(state.distanceAU, star.massSolar),
      // the star's true radius, times the exaggeration the visitor has chosen
      starRadius: STAR_TRUE_UNIT_RADIUS * star.radiusSolar * state.starScale,
      apparentDiameterDeg: HZ.angularDiameterDeg(star.radiusSolar, state.distanceAU),
      luminosityClass: HZ.luminosityClass(star.radiusSolar, star.teffK),
      inflation: HZ.inflationFactor(star.radiusSolar, star.teffK),
      isEarth: Math.abs(state.distanceAU - 1) < 0.005 && Math.abs(star.luminosity - 1) < 1e-6,
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

    zoneEdgeInner.scale.setScalar(zone.inner * AU_UNITS);
    zoneEdgeOuter.scale.setScalar(zone.outer * AU_UNITS);
    zoneFill.scale.setScalar(zone.outer * AU_UNITS);
    zoneFillMaterial.uniforms.uInnerRatio.value = zone.inner / zone.outer;
    shellInner.scale.setScalar(zone.inner * AU_UNITS);
    shellOuter.scale.setScalar(zone.outer * AU_UNITS);
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
    planetMaterial.uniforms.uLivable.value = mix.livable;
    // light the planet with a desaturated version of the star colour so the surface state stays readable around red stars
    planetMaterial.uniforms.uLightColor.value.copy(starColor).lerp(tmpColor.set(0xffffff), 0.6);
    planetMaterial.uniforms.uLightIntensity.value = 1.7 * Math.pow(clamp(model.insolation, 0.02, 8), 0.25);
    const atm = atmosphereMaterial.uniforms.uColor.value;
    atm.setHex(STATE_COLORS.frozen).lerp(tmpColor.setHex(0x4f9dff), mix.thaw).lerp(tmpColor.setHex(0xff7a30), mix.scorch);
    // the lava world's own light reaches its air: the haze goes from Venus yellow to a deep ember red
    atm.lerp(tmpColor.setHex(0xff3c08), mix.scorch * mix.heat * 0.85);
    // a Venus-like cloud world has a thick, bright haze; a lava world a thinner one, lit from below and
    // breathing with the magma underneath it
    const ember = 0.28 * mix.heat * Math.sin(planetMaterial.uniforms.uTime.value * 1.1);
    atmosphereMaterial.uniforms.uStrength.value =
      (0.7 + 0.5 * mix.thaw) * (1 - mix.scorch) + mix.scorch * (1.15 - 0.4 * mix.heat) * (1 + ember);

    labels.zoneInner.setText(`${fmt(zone.inner, 2)} ${t('units.au')}`);
    labels.zoneOuter.setText(`${fmt(zone.outer, 2)} ${t('units.au')}`);
    labels.planetName.setText(t(`${KEYS}.planet.${model.isEarth ? 'earth' : 'name'}`));
    labels.planetName.setColor(STATE_COLORS[model.status]);
    labels.planetTemp.setText(formatTemp(model.teqK));
    labels.starTemp.setText(`${formatTemp(star.teffK)} · ${model.type}`);
    labels.grid.forEach((l, i) => l.setText(`${fmt(GRID_LABEL_AU[i], GRID_LABEL_AU[i] % 1 ? 1 : 0)} ${t('units.au')}`));
  }

  /** How much of the world one CSS pixel covers at `distance` from the camera. */
  function worldPerPixel(distance) {
    return (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / (renderer.domElement.clientHeight || 1);
  }

  /** Camera-dependent bits: label placement, hit-sphere sizes, markers, corona billboard, near plane. */
  function updateOverlay() {
    tmpUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const planetDist = Math.max(camera.position.distanceTo(planetPos), 1e-6);
    const starDist = Math.max(camera.position.length(), 1e-6);
    // Both bodies keep the size their own exaggeration gives them. Nothing here grows because the
    // camera pulled back or because the other body grew, so a bigger star reads as a bigger star
    // and the planet stays the same speck it was – only the hit spheres below stay generous, and
    // its name and temperature labels mark it when it is small.
    const planetRadius = PLANET_RADIUS;
    const starRadius = model.starRadius;
    starMesh.scale.setScalar(starRadius);
    // the glow grows a little with the luminosity (≈ +1 star radius per decade)
    starGlow.scale.setScalar(starRadius * (5.5 + 1.5 * clamp(Math.log10(model.star.luminosity) + 2, 0, 3)));
    corona.scale.setScalar(starRadius * CORONA_EXTENT);
    corona.quaternion.copy(camera.quaternion);
    coronaMaterial.uniforms.uStarFrac.value = 1 / CORONA_EXTENT;
    planetHit.position.copy(planetPos);
    planetHit.scale.setScalar(Math.max(planetRadius * 1.6, worldPerPixel(planetDist) * PLANET_TARGET_PX)); // easy to grab even when it is a speck
    starHit.scale.setScalar(Math.max(starRadius * 1.2, worldPerPixel(starDist) * STAR_TARGET_PX)); // a little generous: the pull may start anywhere on the disc
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

    labels.zoneInner.sprite.visible = labels.zoneOuter.sprite.visible = state.showZone && (state.showZoneSurface || state.showZoneShell);
    labels.zoneInner.sprite.position.copy(LABEL_DIRECTION).multiplyScalar(model.zone.inner * AU_UNITS).addScaledVector(tmpUp, -starDist * 0.012);
    labels.zoneOuter.sprite.position.copy(LABEL_DIRECTION).multiplyScalar(model.zone.outer * AU_UNITS).addScaledVector(tmpUp, starDist * 0.012);
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
    applyCamera();
    updateOverlay();
    updateReadouts();
    sim.requestRender();
  }

  // --- camera ----------------------------------------------------------------------------------------------------------
  let cameraTween = null;
  /**
   * Fly the camera somewhere. `destination` is either a fixed { position, target } or a function
   * returning one, so a flight can end on something that is still moving – the planet.
   */
  function tweenCamera(destination, duration = 0.9) {
    const end = () => (typeof destination === 'function' ? destination() : destination);
    if (sim.reducedMotion || duration <= 0) {
      const { position, target } = end();
      camera.position.copy(position);
      controls.target.copy(target);
      cameraTween = null;
      controls.update();
      updateOverlay();
      sim.requestRender();
      return;
    }
    cameraTween = { t: 0, duration, end, fromPos: camera.position.clone(), fromTarget: controls.target.clone() };
  }
  function stepTween(dt) {
    if (!cameraTween) return;
    const tw = cameraTween;
    tw.t = Math.min(1, tw.t + dt / tw.duration);
    const k = easeInOut(tw.t);
    const { position, target } = tw.end();
    camera.position.lerpVectors(tw.fromPos, position, k);
    controls.target.lerpVectors(tw.fromTarget, target, k);
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
    tweenCamera({ position: dir.clone(), target: new THREE.Vector3(0, 0, 0) }, duration);
  }
  /**
   * Radius (scene units) the fit mode has to cover: the planet's orbit, the star's own disc
   * and – while it is shown – the outer edge of the habitable zone. So a planet dragged out
   * to 5 AU, a star grown to six times its size and a bright star's wide zone each pull the
   * camera back, and everything moving in makes it zoom in again.
   */
  function fitRadiusUnits() {
    const planet = state.distanceAU * AU_UNITS;
    const zone = state.showZone ? model.zone.outer * AU_UNITS : 0;
    const star = model.starRadius * (CORONA_EXTENT * 0.5); // the disc plus a little of its corona
    return Math.max(planet, zone, star);
  }
  const fitView = (duration) => frameRadius(fitRadiusUnits(), duration);
  const frameOverview = (duration) => frameRadius(HZ.DISTANCE_RANGE_AU.max * AU_UNITS, duration);

  /**
   * The close-up trades a little perspective for the room to hold the planet's lit face and the
   * star at once; every other mode keeps the scene's own field of view.
   */
  const defaultFov = camera.fov;
  function setFieldOfView(fov) {
    if (Math.abs(camera.fov - fov) < 1e-6) return;
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  /**
   * Where the camera stands for the planet close-up: swung off the line away from the star, far
   * enough that a good part of the planet's lit face is turned towards us, and at a distance
   * measured in planet radii so the planet keeps its apparent size wherever it orbits. It aims
   * between the two, which puts the planet large on one side of the frame and the star small in
   * the distance on the other.
   */
  function planetView() {
    const outward = tmpV.copy(planetPos).setY(0);
    if (outward.lengthSq() < 1e-12) outward.set(1, 0, 0);
    outward.normalize();
    const across = new THREE.Vector3(-outward.z, 0, outward.x);
    // How far the camera stands off the line away from the star is one angle doing two jobs: it is
    // the phase angle, so it decides how much of the planet's face is lit for us, and it is the
    // separation between the two bodies in the frame. Both want it large, so take as much as the
    // picture actually on show can hold – the frame's half-angle along the swing, minus the part
    // the panel covers, since the view shift slides the picture into the free canvas rather than
    // moving the camera. A wide frame has that room beside the planet, a tall one above it.
    const wide = clamp((camera.aspect - 0.55) / 1.05, 0, 1);
    const halfV = THREE.MathUtils.degToRad(camera.fov / 2);
    const halfAngle = THREE.MathUtils.lerp(halfV, Math.atan(Math.tan(halfV) * camera.aspect), wide);
    const covered = camera.view?.enabled ? (2 * camera.view.offsetX) / (camera.view.fullWidth || 1) : 0;
    const usable = clamp(1 - covered, 0.35, 1) * Math.tan(halfAngle);
    const edgeLimit = Math.atan(PLANET_VIEW.edge * usable); // the planet's disc stays whole inside this
    const starLimit = Math.atan(PLANET_VIEW.starFrame * usable); // and the star inside this, the other way
    const swing = Math.min(THREE.MathUtils.degToRad(PLANET_VIEW.swing), (edgeLimit + starLimit) * PLANET_VIEW.margin);
    const axis = new THREE.Vector3().copy(THREE.Object3D.DEFAULT_UP).multiplyScalar(-wide).addScaledVector(across, 1 - wide).normalize();
    const dir = outward.clone()
      .applyAxisAngle(axis, swing) // sideways on a wide frame, upwards on a tall one
      .applyAxisAngle(across, THREE.MathUtils.degToRad(PLANET_VIEW.tilt) * wide); // a little above the plane either way
    const position = planetPos.clone().addScaledVector(dir, PLANET_VIEW.dist * PLANET_RADIUS);
    // a swollen star could otherwise reach past the camera – stand clear of its drawn disc
    const clearance = model.starRadius * PLANET_VIEW.starClearance;
    if (position.length() < clearance) position.addScaledVector(outward, clearance - position.length());
    const toPlanet = planetPos.clone().sub(position).normalize();
    const toStar = position.clone().negate().normalize();
    // Aim between the two: the planet sits `frame` of the way from the centre towards the edge and
    // the star the other way, the planet giving way further out – as far as `edge` – when a nearby
    // star would otherwise fall outside `starFrame`.
    const separation = Math.acos(clamp(toPlanet.dot(toStar), -1, 1));
    const off = Math.min(edgeLimit, Math.max(Math.atan(PLANET_VIEW.frame * usable), separation - starLimit));
    const aimAxis = toPlanet.clone().cross(toStar);
    const aim = aimAxis.lengthSq() > 1e-12
      ? toPlanet.clone().applyAxisAngle(aimAxis.normalize(), Math.min(off, separation))
      : toPlanet.clone();
    return { position, target: position.clone().addScaledVector(aim, position.distanceTo(planetPos)) };
  }
  /**
   * Riding along with the planet. Left alone the camera stays on the close-up above; once the
   * visitor has taken hold of the view it keeps their own angle and distance, carried around
   * with the planet (the offsets are re-read from the live camera every frame, so orbiting and
   * zooming keep working), and a planet dragged to another orbit takes the view with it.
   */
  let followAutopilot = true;
  const followFrom = new THREE.Vector3();
  let followAngle = 0;
  function followPlanetCamera() {
    if (state.cameraMode !== 'follow' || cameraTween) {
      followFrom.copy(planetPos);
      followAngle = state.angle;
      return;
    }
    if (followAutopilot) {
      const view = planetView();
      camera.position.copy(view.position);
      controls.target.copy(view.target);
    } else {
      const turn = state.angle - followAngle;
      const carry = (v) => v.sub(followFrom).applyAxisAngle(THREE.Object3D.DEFAULT_UP, turn).add(planetPos);
      carry(camera.position);
      carry(controls.target);
    }
    followFrom.copy(planetPos);
    followAngle = state.angle;
  }
  /** Point the camera at whatever the current mode asks for. Runs after the scene has moved. */
  function applyCamera() {
    followPlanetCamera();
  }
  /**
   * The fit mode's re-frame, called when a gesture ends (pointer up / touch released) rather
   * than while it runs, so the view does not pump in and out under the visitor's finger.
   * A small tolerance keeps it from tweening over a fraction of a percent.
   */
  function fitViewIfAuto(tolerance = FIT_TOLERANCE) {
    if (state.cameraMode !== 'fit') return;
    const ideal = fitDistance(fitRadiusUnits());
    const dist = camera.position.distanceTo(controls.target);
    if (dist > ideal * tolerance || dist < ideal / tolerance) fitView();
  }

  // --- interaction: drag the planet, drag the star (type × size) ---------------------------------------------------
  const raycaster = new THREE.Raycaster();
  raycaster.layers.set(HIT_LAYER);
  const pointer = new THREE.Vector2();
  const ORIGIN = new THREE.Vector3(); // the star, for measuring a ray against its disc
  const dragRadial = new THREE.Vector3(); // scratch: the outward direction at the planet
  const dragAcross = new THREE.Vector3(); // scratch: the way the orbit runs there
  const dragProbe = new THREE.Vector3(); // scratch: a point a small step from the planet, in the plane
  const dragScreen = new THREE.Vector2(); // scratch: where that point lands on screen
  let drag = null; // null | { kind: 'planet', frame } | { kind: 'star', y, startTeffLog, startInflation, pxPerTypeDecade }
  let dragTarget = null; // where the pointer wants the planet: { distanceAU, angle } – it eases there
  let hovering = null; // null | 'planet' | 'star'
  const canvas = renderer.domElement;

  function setPointer(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }
  /**
   * Which body is under the pointer ('planet' | 'star' | null). Both hit spheres are generous, and
   * an orbit near the inner limit puts the planet *inside* the star's, where the ray meets the star
   * first: the planet is the small target and the one the visitor means, so it wins wherever the two
   * overlap – unless it has gone behind the star's drawn disc, where it cannot be what was aimed at.
   */
  function pick(e) {
    setPointer(e);
    const hits = raycaster.intersectObjects([planetHit, starHit], false);
    if (!hits.length) return null;
    const onPlanet = hits.some((h) => h.object === planetHit);
    const onStar = hits.some((h) => h.object === starHit);
    if (onPlanet && onStar) {
      const behindStar = camera.position.distanceTo(planetPos) > camera.position.length()
        && raycaster.ray.distanceToPoint(ORIGIN) < model.starRadius;
      return behindStar ? 'star' : 'planet';
    }
    return hits[0].object.userData.kind;
  }
  /** Drag gain: `span` of a canvas edge `edgePx` wide covers `decades` of a log-scaled quantity. */
  function pxPerDecade(edgePx, span, decades) {
    return clamp(edgePx * span, STAR_DRAG_TRAVEL_PX.min, STAR_DRAG_TRAVEL_PX.max) / decades;
  }
  /**
   * The star is dragged up and down, and that one axis moves the whole star: up towards hotter,
   * larger and brighter, down towards cooler, smaller and fainter, the way the types follow one
   * another along the main sequence. Sideways movement is ignored, so the gesture cannot be
   * pulled off course. What it keeps fixed is the star's place relative to the main sequence –
   * the radius stays at the same ratio to the main-sequence radius of the temperature under the
   * pointer – so a dwarf stays a dwarf and a giant stays a giant while its type changes; taking
   * a star off the main sequence in the first place is the radius slider's job. The axis is
   * log-linear in temperature and spans the whole range in one comfortable sweep whatever the
   * canvas. Dragging leaves evolution mode.
   */
  function startStarDrag(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      kind: 'star',
      y: e.clientY,
      startTeffLog: Math.log10(model.star.teffK),
      startInflation: model.inflation,
      pxPerTypeDecade: pxPerDecade(rect.height, STAR_DRAG_TYPE_SPAN, TEFF_DECADES),
    };
  }
  /** Where a world point lands on screen, in the CSS pixels a pointer event speaks in. */
  function toScreen(world, out) {
    tmpV.copy(world).project(camera);
    const rect = canvas.getBoundingClientRect();
    return out.set(rect.left + ((tmpV.x + 1) / 2) * rect.width, rect.top + ((1 - tmpV.y) / 2) * rect.height);
  }
  /**
   * The frame a planet drag is read in, measured once at the planet when it is picked up: a map from
   * pointer travel in pixels to the planet's movement in its own plane – outwards along the radius,
   * and around the orbit.
   *
   * Reading the plane *under the pointer* afresh on every move is what made this gesture wild. A view
   * that lies near the orbital plane makes a pixel worth astronomical units towards the horizon and
   * nothing at all past it; a pointer crossing the star reverses the direction it means, flipping the
   * planet to the far side; and in the close-up, where the camera rides along with the planet, moving
   * the planet moved the ground under the finger with it. Measured once, none of that can happen.
   *
   * The gain is capped too: crossing the whole range takes at least DRAG_RANGE_TRAVEL canvas heights,
   * so a roomy view drags one-to-one while a phone's cramped one is slowed to something steerable.
   */
  function planetDragFrame(e) {
    const step = Math.max(0.02, state.distanceAU * 0.05) * AU_UNITS; // a small move to measure with
    const radial = dragRadial.copy(planetPos).setY(0);
    if (radial.lengthSq() < 1e-9) radial.set(1, 0, 0);
    radial.normalize();
    const across = dragAcross.set(-radial.z, 0, radial.x); // the way the orbit runs, at the planet
    const at = toScreen(planetPos, dragScreen);
    const outward = toScreen(dragProbe.copy(planetPos).addScaledVector(radial, step), new THREE.Vector2()).sub(at);
    const around = toScreen(dragProbe.copy(planetPos).addScaledVector(across, step), new THREE.Vector2()).sub(at);
    const det = outward.x * around.y - around.x * outward.y;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null; // exactly edge-on: nothing to read
    const auPerPixel = step / AU_UNITS / Math.max(outward.length(), 1e-6);
    const roomy = (HZ.DISTANCE_RANGE_AU.max - HZ.DISTANCE_RANGE_AU.min) / (DRAG_RANGE_TRAVEL * (canvas.clientHeight || 1));
    return {
      x: e.clientX,
      y: e.clientY,
      distanceAU: state.distanceAU,
      angle: state.angle,
      gain: Math.min(1, roomy / auPerPixel),
      stepAU: step / AU_UNITS,
      // the arc is turned into an angle at the distance the planet was picked up from, so a sweep
      // keeps its rate as the planet travels in and out
      radPerStep: step / (Math.max(state.distanceAU, HZ.DISTANCE_RANGE_AU.min) * AU_UNITS),
      // Cramer's rule on [outward around], so a screen delta becomes a movement in the plane
      ax: around.y / det,
      ay: -around.x / det,
      bx: -outward.y / det,
      by: outward.x / det,
    };
  }
  function startPlanetDrag(e) {
    dragTarget = null; // a fresh grab starts from where the planet is, not from an ease still in flight
    return { kind: 'planet', frame: planetDragFrame(e) };
  }
  /** Point the drag at the pointer; the planet eases the rest of the way in stepPlanetDrag(). */
  function dragPlanetTo(e) {
    const f = drag.frame;
    if (!f) return;
    const dx = e.clientX - f.x;
    const dy = e.clientY - f.y;
    const outwards = (f.ax * dx + f.ay * dy) * f.gain;
    const around = (f.bx * dx + f.by * dy) * f.gain;
    dragTarget = dragTarget ?? { distanceAU: state.distanceAU, angle: state.angle };
    dragTarget.distanceAU = Math.round(clamp(f.distanceAU + outwards * f.stepAU, HZ.DISTANCE_RANGE_AU.min, HZ.DISTANCE_RANGE_AU.max) * 1000) / 1000;
    // +x on the orbit runs the other way round than the angle does (see planetPos in updateScene)
    dragTarget.angle = f.angle - around * f.radPerStep;
    // with motion reduced there are no frames to ease over, so land on the target and redraw here
    if (sim.reducedMotion) {
      stepPlanetDrag(1);
      refresh();
    } else {
      sim.requestRender();
    }
  }
  /**
   * Move the planet a step towards the drag target. `dt` in seconds, or 1 to land on it at once.
   * Returns true when the planet moved – which is also what holds its orbital motion back until the
   * ease has finished, so a flick released mid-flight coasts to a stop instead of jumping.
   */
  function stepPlanetDrag(dt) {
    if (!dragTarget) return false;
    const dDistance = dragTarget.distanceAU - state.distanceAU;
    // shortest way round, so a drag across the +x axis does not send the planet the long way
    const dAngle = Math.atan2(Math.sin(dragTarget.angle - state.angle), Math.cos(dragTarget.angle - state.angle));
    const k = dt === 1 || sim.reducedMotion ? 1 : 1 - Math.exp(-dt / DRAG_EASE_S);
    const landed = k >= 1 || (Math.abs(dDistance) < DRAG_SNAP_AU && Math.abs(dAngle) < DRAG_SNAP_RAD);
    if (landed) {
      // the target is already on the three-decimal grid the readouts and the slider work in
      state.distanceAU = dragTarget.distanceAU;
      state.angle = dragTarget.angle;
      if (!drag) dragTarget = null; // released and settled – the orbit takes over again
    } else {
      state.distanceAU += clamp(dDistance * k, -DRAG_MAX_AU_PER_S * dt, DRAG_MAX_AU_PER_S * dt);
      state.angle += clamp(dAngle * k, -DRAG_MAX_RAD_PER_S * dt, DRAG_MAX_RAD_PER_S * dt);
    }
    distanceSlider.setValue(state.distanceAU, { silent: true });
    return dDistance !== 0 || dAngle !== 0;
  }
  function dragStarTo(e) {
    // up = hotter, and the size and brightness come with the type
    const teffK = clamp(Math.pow(10, drag.startTeffLog - (e.clientY - drag.y) / drag.pxPerTypeDecade), HZ.TEFF_RANGE_K.min, HZ.TEFF_RANGE_K.max);
    setStar(teffK, HZ.mainSequenceRadius(teffK) * drag.startInflation);
  }
  const onPointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const kind = pick(e);
    if (!kind) return;
    drag = kind === 'star' ? startStarDrag(e) : startPlanetDrag(e);
    controls.enabled = false; // registered in the capture phase, so OrbitControls sees `enabled === false`
    canvas.classList.add('is-dragging');
    try {
      canvas.setPointerCapture?.(e.pointerId);
    } catch {
      /* synthetic or already-released pointer – the drag still works, it just cannot follow outside the canvas */
    }
    e.stopPropagation();
    updateOverlay();
    sim.requestRender();
  };
  const onPointerMove = (e) => {
    if (drag) {
      if (drag.kind === 'planet') dragPlanetTo(e);
      else dragStarTo(e);
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
    if (drag.kind === 'planet' && sim.reducedMotion) dragTarget = null; // nothing eases without frames
    drag = null;
    controls.enabled = true;
    canvas.classList.remove('is-dragging');
    if (e && canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    fitViewIfAuto(); // pointer up / touch released – this is where the fit mode re-frames
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
    // one slider scales scene time, so planet spin, orbit, stellar evolution and the shader animations stay in step
    const sdt = dt * state.speed;
    if (state.playing) {
      const next = state.ageGyr + sdt * EVOLUTION_GYR_PER_SECOND;
      if (next >= HZ.MAX_AGE_GYR) {
        state.ageGyr = HZ.MAX_AGE_GYR;
        setPlaying(false);
      } else state.ageGyr = next;
      ageSlider.setValue(state.ageGyr, { silent: true });
      model = derive();
    }
    // the drag eases on real time – it is the visitor's hand, not scene time – and holds the orbit
    // still until it has landed, so a flick released mid-flight coasts to a stop instead of jumping
    if (stepPlanetDrag(dt)) model = derive();
    else if (!drag) {
      const omega = Math.min(MAX_ANGULAR_SPEED, (2 * Math.PI) / (model.periodYears * SECONDS_PER_ORBIT_YEAR));
      state.angle = (state.angle + omega * sdt) % (Math.PI * 2);
    }
    planetSpin.rotation.y = (planetSpin.rotation.y + PLANET_SPIN_RAD_PER_S * sdt) % (Math.PI * 2);
    starMaterial.uniforms.uTime.value += sdt;
    coronaMaterial.uniforms.uTime.value += sdt;
    planetMaterial.uniforms.uTime.value += sdt;
    // while evolution runs there is no pointer to wait for, so the fit mode follows the growing
    // zone – with a wide tolerance, so the camera settles instead of creeping along with it
    if (state.playing && !drag && !cameraTween) fitViewIfAuto(FIT_TOLERANCE_PLAYING);
    stepTween(dt); // camera framing is interface motion, not scene time
    updateScene();
    applyCamera();
    updateOverlay();
    updateReadouts();
  }
  sim.onFrame(frame);
  const onControlsChange = () => {
    updateOverlay();
  };
  const onControlsStart = () => {
    followAutopilot = false; // the close-up keeps the visitor's own angle from here on
  };
  controls.addEventListener('change', onControlsChange);
  controls.addEventListener('start', onControlsStart);
  disposers.push(() => {
    controls.removeEventListener('change', onControlsChange);
    controls.removeEventListener('start', onControlsStart);
  });
  // a rotated phone or a resized window changes what fits on screen
  const onWindowResize = () => fitViewIfAuto(FIT_TOLERANCE_PLAYING);
  window.addEventListener('resize', onWindowResize);
  disposers.push(() => window.removeEventListener('resize', onWindowResize));

  // --- state setters ---------------------------------------------------------------------------------------------------------------
  /** Leaving evolution mode: the star stays where the Sun's track had put it. */
  function leaveEvolution() {
    if (!state.evolution) return;
    state.teffK = model.star.teffK;
    state.radiusSolar = model.star.radiusSolar;
    state.evolution = false;
    setPlaying(false);
  }
  /**
   * The star's two physical controls. Temperature is bounded by the range Kopparapu's flux
   * limits are fitted over; the radius by what that temperature allows – never less than half
   * the main-sequence radius, never so large that the zone leaves the scene (see radiusRangeFor).
   */
  function applyStar(teffK, radiusSolar) {
    leaveEvolution();
    state.teffK = clamp(teffK, HZ.TEFF_RANGE_K.min, HZ.TEFF_RANGE_K.max);
    const range = HZ.radiusRangeFor(state.teffK);
    state.radiusSolar = clamp(radiusSolar, range.min, range.max);
  }
  function setStar(teffK, radiusSolar) {
    applyStar(teffK, radiusSolar);
    refresh(); // the sliders quote the model (spectral type, luminosity class), so recompute it first
    syncStarSliders();
    syncPresetButtons();
  }
  const setTemperature = (teffK) => setStar(teffK, state.radiusSolar);
  const setRadius = (radiusSolar) => setStar(state.teffK, radiusSolar);
  /** Put the star back on the main sequence, keeping its temperature. */
  const setMainSequence = () => setStar(state.teffK, HZ.mainSequenceRadius(state.teffK));
  /** The main-sequence star of this luminosity – what the presets and the reset button set. */
  function setLuminosity(L) {
    const ms = HZ.mainSequenceStar(clamp(L, HZ.LUMINOSITY_RANGE.min, HZ.LUMINOSITY_RANGE.max));
    setStar(ms.teffK, ms.radiusSolar);
  }
  function setAge(age) {
    state.ageGyr = clamp(age, 0, HZ.MAX_AGE_GYR);
    state.evolution = true;
    ageSlider.setValue(state.ageGyr, { silent: true });
    refresh();
    syncStarSliders(); // both follow the Sun's track while it runs
    syncPresetButtons();
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
  function setSpeed(multiplier, { silent = false } = {}) {
    state.speed = clamp(multiplier, SPEED_RANGE.min, SPEED_RANGE.max);
    if (!silent) speedSlider.setValue(state.speed, { silent: true });
  }
  function setDistance(dAU) {
    state.distanceAU = clamp(dAU, HZ.DISTANCE_RANGE_AU.min, HZ.DISTANCE_RANGE_AU.max);
    distanceSlider.setValue(state.distanceAU, { silent: true });
    refresh();
  }
  /** How far the disc is drawn larger than the star really is – display only, no physics depends on it. */
  function applyStarScale(scale) {
    state.starScale = clamp(scale, STAR_SCALE_RANGE.min, STAR_SCALE_RANGE.max);
    starScaleSlider.setValue(Math.log10(state.starScale), { silent: true });
  }
  function setStarScale(scale, { persist = true } = {}) {
    applyStarScale(scale);
    if (persist) viewPrefs.set('starScale', state.starScale);
    refresh();
  }
  /**
   * The camera modes. 'fit' re-frames the star, the planet and the zone whenever a gesture or a
   * slider ends; 'follow' rides along with the planet; 'free' leaves the camera alone. Switching
   * into a mode flies there, so pressing the button shows what it does.
   */
  function setCameraMode(mode, { fly = true, duration, announce = false } = {}) {
    state.cameraMode = CAMERA_MODES.includes(mode) ? mode : 'free';
    viewPrefs.set('cameraMode', state.cameraMode);
    setFieldOfView(state.cameraMode === 'follow' ? PLANET_VIEW.fov : defaultFov);
    followAutopilot = true; // a mode always starts on its own framing again
    syncCameraButtons({ announce });
    if (fly && state.cameraMode === 'fit') fitView(duration);
    if (fly && state.cameraMode === 'follow') tweenCamera(planetView, duration ?? 1.2);
    sim.requestRender();
  }
  /** The header button's view ids – 'overview' is the wide shot, not a mode. */
  function selectCameraView(id) {
    if (id !== 'overview') return setCameraMode(id);
    setCameraMode('free', { fly: false }); // an explicit wide view: the camera is the visitor's again
    frameOverview();
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
  // while the panel is open on a wide screen the picture slides left, so what the
  // simulation shows stays centred in the free part of the canvas
  const viewShift = createPanelShift({ sim, viewport });
  const panel = createPanel({
    onToggle: () => viewShift.sync(),
    camera: { views: CAMERA_VIEWS, onSelect: selectCameraView },
  });
  const isSmallScreen = window.matchMedia('(max-width: 720px)').matches;

  // --- controls: the planet's distance up front, the rest folded away -----------------------------
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
  distanceSlider.input.addEventListener('change', () => fitViewIfAuto());

  const moreControls = createCollapsibleSection({ titleKey: `${KEYS}.sections.more`, open: false });

  const presetRow = el('div', 'lp-presets lp-presets--tight', { role: 'group' });
  bindAttr(presetRow, { 'aria-label': `${KEYS}.star.presets` });
  const presetButtons = HZ.STAR_PRESETS.map((preset) => {
    const btn = createButton({
      labelKey: `${KEYS}.star.preset${preset.id}`,
      ariaKey: `${KEYS}.star.preset${preset.id}Aria`,
      onClick: () => {
        setLuminosity(preset.luminosity);
        fitViewIfAuto();
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
      // a preset is a main-sequence star, so both controls have to match it
      const ms = HZ.mainSequenceStar(preset.luminosity);
      const active = !state.evolution
        && Math.abs(Math.log10(state.teffK / ms.teffK)) < 0.002
        && Math.abs(Math.log10(state.radiusSolar / ms.radiusSolar)) < 0.005;
      btn.setAttribute('aria-pressed', String(active));
    }
  }
  // The star's two physical controls, the same pair the drag gesture moves: how hot it is
  // (its spectral type) and how large it is. Its luminosity follows from both and is a readout.
  const teffSlider = createSlider({
    labelKey: `${KEYS}.star.temperatureControl`,
    min: Math.log10(HZ.TEFF_RANGE_K.min),
    max: Math.log10(HZ.TEFF_RANGE_K.max),
    step: 0.001,
    value: Math.log10(state.teffK),
    format: (v) => {
      const teff = Math.pow(10, v);
      return `${formatTemp(teff)} · ${HZ.spectralType(teff)}`;
    },
    onChange: (v) => setTemperature(Math.pow(10, v)),
  });
  teffSlider.input.addEventListener('change', () => fitViewIfAuto());
  const radiusSlider = createSlider({
    labelKey: `${KEYS}.star.radiusControl`,
    min: Math.log10(HZ.RADIUS_RANGE_SOLAR.min),
    max: Math.log10(HZ.RADIUS_RANGE_SOLAR.max),
    step: 0.002,
    value: Math.log10(state.radiusSolar),
    format: (v) => `${fmt(Math.pow(10, v), 2)} ${t('units.solarRadius')} · ${t(`${KEYS}.star.classes.${model.luminosityClass}`)}`,
    onChange: (v) => setRadius(Math.pow(10, v)),
  });
  radiusSlider.input.addEventListener('change', () => fitViewIfAuto());
  const mainSequenceBtn = createButton({
    labelKey: `${KEYS}.star.backToMainSequence`,
    icon: '↺',
    compact: true,
    onClick: () => {
      setMainSequence();
      fitViewIfAuto();
    },
  });
  const radiusRow = createControlRow(radiusSlider, mainSequenceBtn);
  /**
   * Both star sliders, refreshed from the current model – so they also follow the star while
   * evolution mode drives it. The radius a star may take depends on its temperature, so that
   * slider's own bounds move with it: a hot star runs into the scene's luminosity ceiling long
   * before a red one does.
   */
  function syncStarSliders() {
    const { teffK, radiusSolar } = model.star;
    const range = HZ.radiusRangeFor(teffK);
    teffSlider.setValue(Math.log10(teffK), { silent: true });
    radiusSlider.input.min = String(Math.log10(range.min));
    radiusSlider.input.max = String(Math.log10(range.max));
    radiusSlider.setValue(Math.log10(radiusSolar), { silent: true });
    mainSequenceBtn.el.disabled = Math.abs(Math.log10(model.inflation)) < 0.01;
  }

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
  ageSlider.input.addEventListener('change', () => fitViewIfAuto());
  const playBtn = createButton({ labelKey: `${KEYS}.evolution.play`, icon: '▶', variant: 'primary', compact: true, onClick: () => setPlaying(!state.playing) });
  function syncPlayButton() {
    playBtn.setIcon(state.playing ? '⏸' : '▶');
    playBtn.setLabel(state.playing ? `${KEYS}.evolution.pause` : `${KEYS}.evolution.play`);
    playBtn.el.setAttribute('aria-pressed', String(state.playing));
  }
  const todayBtn = createButton({
    labelKey: `${KEYS}.evolution.resetToday`,
    icon: '↺',
    compact: true,
    onClick: () => {
      setPlaying(false);
      setAge(HZ.SUN_AGE_GYR);
    },
  });
  const ageRow = createControlRow(ageSlider, playBtn, todayBtn);

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
    fitViewIfAuto(); // the zone joins or leaves what has to fit on screen
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
  // the star's size is the one number in the picture that is not to scale, so the control says by how much
  const starScaleSlider = createSlider({
    labelKey: `${KEYS}.view.starSize`,
    min: Math.log10(STAR_SCALE_RANGE.min),
    max: Math.log10(STAR_SCALE_RANGE.max),
    step: 0.005,
    value: Math.log10(state.starScale),
    format: (v) => {
      const scale = Math.pow(10, v);
      const label = `${fmt(scale, scale < 10 ? 1 : 0)}${t('units.times')}`;
      return scale < 1.02 ? `${label} · ${t(`${KEYS}.view.starSizeTrue`)}` : label;
    },
    onChange: (v) => setStarScale(Math.pow(10, v), { persist: false }),
  });
  starScaleSlider.input.addEventListener('change', () => {
    viewPrefs.set('starScale', state.starScale);
    fitViewIfAuto();
  });
  const starScaleNote = bindText(el('p', 'lp-section__note'), `${KEYS}.view.starSizeNote`);
  const speedSlider = createSlider({
    labelKey: `${KEYS}.view.speed`,
    min: SPEED_RANGE.min,
    max: SPEED_RANGE.max,
    step: SPEED_RANGE.step,
    value: state.speed,
    format: (v) => `${fmt(v, 1)}${t('units.times')}`,
    onChange: (v) => setSpeed(v, { silent: true }),
  });
  const speedNote = bindText(el('p', 'lp-section__note'), `${KEYS}.view.speedNote`);
  const cameraRow = el('div', 'lp-presets lp-presets--3 lp-presets--compact', { role: 'group' });
  bindAttr(cameraRow, { 'aria-label': `${KEYS}.view.camera` });
  // "Frame zone" and "Planet" are modes, not one-offs: the first keeps the star, the planet and
  // the zone framed, the second rides along with the planet. "Overview" hands the camera back.
  const frameBtn = createButton({
    labelKey: `${KEYS}.view.frameZone`,
    ariaKey: `${KEYS}.view.frameZoneAria`,
    icon: '◎',
    onClick: () => setCameraMode(state.cameraMode === 'fit' ? 'free' : 'fit'),
  });
  const followBtn = createButton({
    labelKey: `${KEYS}.view.followPlanet`,
    ariaKey: `${KEYS}.view.followPlanetAria`,
    icon: '◐',
    onClick: () => setCameraMode(state.cameraMode === 'follow' ? 'free' : 'follow'),
  });
  function syncCameraButtons({ announce = false } = {}) {
    frameBtn.el.setAttribute('aria-pressed', String(state.cameraMode === 'fit'));
    followBtn.el.setAttribute('aria-pressed', String(state.cameraMode === 'follow'));
    panel.setCameraView(state.cameraMode, { announce });
  }
  const overviewBtn = createButton({
    labelKey: `${KEYS}.view.overview`,
    icon: '⤢',
    onClick: () => selectCameraView('overview'),
  });
  for (const btn of [frameBtn, followBtn, overviewBtn]) {
    btn.el.classList.add('lp-presets__btn');
    cameraRow.append(btn.el);
  }

  const resetBtn = createButton({
    labelKey: 'panel.reset',
    icon: '↺',
    onClick: () => {
      setPlaying(false);
      Object.assign(state, DEFAULTS);
      distanceSlider.setValue(state.distanceAU, { silent: true });
      ageSlider.setValue(state.ageGyr, { silent: true });
      speedSlider.setValue(state.speed, { silent: true });
      refresh();
      syncStarSliders();
      syncPresetButtons();
      fitView();
    },
  });
  const resetRow = el('div', 'lp-button-row lp-button-row--full');
  resetRow.append(resetBtn.el);

  moreControls.add(bindText(el('p', 'lp-subheading'), `${KEYS}.sections.evolution`), ageRow);
  if (sim.reducedMotion) moreControls.add(createNotice({ textKey: 'motion.reducedNotice' }));
  moreControls.add(
    bindText(el('p', 'lp-subheading'), `${KEYS}.sections.view`),
    cameraRow, zoneToggle, surfaceToggle, shellToggle, tempToggle, unitSwitch, gridToggle,
    starScaleSlider, starScaleNote, speedSlider, speedNote, resetRow,
  );

  // --- readouts: the planet's temperature, then the numbers behind it ------------------------------
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
  const windowNote = el('p', 'lp-window-note', { role: 'status' });
  const starFacts = createFacts([
    ['type', `${KEYS}.star.type`],
    ['teff', `${KEYS}.star.temperature`],
    ['radius', `${KEYS}.star.radius`],
    ['luminosity', `${KEYS}.star.luminosity`],
    ['mass', `${KEYS}.star.mass`],
    ['apparent', `${KEYS}.star.apparent`],
    ['zone', `${KEYS}.zone.edges`],
    ['width', `${KEYS}.zone.width`],
  ]);
  const legend = createLegend();

  const infoCard = createInfoCard({ titleKey: `${KEYS}.info.title`, bodyKey: `${KEYS}.info.body`, open: !isSmallScreen });
  // the thresholds and the exaggerations are not fixed numbers – they follow the star and the view
  const physicsCard = createPhysicsCard(() => {
    const limits = HZ.zoneFluxLimits(model.star.teffK);
    return {
      teff: fmt(model.star.teffK, 0),
      sInner: fmt(limits.inner, 2),
      sOuter: fmt(limits.outer, 2),
      frozen: fmt(model.edgeTemps.frozen, 0),
      scorched: fmt(model.edgeTemps.scorched, 0),
      lava: fmt(model.edgeTemps.scorched + HZ.HEAT_RAMP_K, 0),
      starScale: fmt(state.starScale, state.starScale < 10 ? 1 : 0),
      inflation: fmt(model.inflation, model.inflation < 10 ? 1 : 0),
      planetScale: formatNumber(PLANET_EXAGGERATION, { maximumFractionDigits: 0 }),
    };
  });
  panel.add(
    distanceSlider, presetRow, teffSlider, radiusRow, moreControls,
    readout, planetFacts, windowNote,
    bindText(el('p', 'lp-subheading'), `${KEYS}.sections.star`), starFacts,
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

  // --- readouts ------------------------------------------------------------------------------------------------------------------------------
  let lastReadoutKey = '';
  function updateReadouts(force = false) {
    const { star, zone, teqK, status } = model;
    // the star exaggeration is in the key because the physics card states it
    const key = `${star.teffK.toFixed(2)}|${star.radiusSolar.toFixed(5)}|${state.distanceAU.toFixed(3)}|${state.evolution}|${status}|${state.tempUnit}|${state.starScale.toFixed(3)}`;
    if (!force && key === lastReadoutKey) return;
    lastReadoutKey = key;
    // the spectral type says how hot the star is, the luminosity class how far it has left the main sequence
    starFacts.set('type', `${t(`${KEYS}.star.types.${model.type}`)} · ${t(`${KEYS}.star.classes.${model.luminosityClass}`)}`);
    starFacts.set('teff', formatTemp(star.teffK));
    starFacts.set('mass', `${fmt(star.massSolar, 2)} ${t('units.solarMass')}`);
    starFacts.set('radius', `${fmt(star.radiusSolar, 2)} ${t('units.solarRadius')}`);
    starFacts.set('luminosity', formatLuminosity(star.luminosity)); // L = R²·(T/T☉)⁴, not an input
    // the true angular size of the star in the planet's sky – the disc on screen is exaggerated, this is not
    const apparent = model.apparentDiameterDeg;
    starFacts.set('apparent', `${fmt(apparent, apparent < 0.1 ? 3 : 2)}${t('units.degrees')}`);
    const zoneDigits = zone.outer < 0.2 ? 3 : 2;
    starFacts.set('zone', `${fmt(zone.inner, zoneDigits)} – ${fmt(zone.outer, zoneDigits)} ${t('units.au')}`);
    starFacts.set('width', `${fmt(zone.outer - zone.inner, zoneDigits)} ${t('units.au')}`);
    readoutValue.textContent = formatTemp(teqK);
    statePill.textContent = t(`${KEYS}.planet.${status}`);
    statePill.className = `lp-state lp-state--${status}`;
    stateHint.textContent = t(`${KEYS}.planet.${status}Hint`);
    planetFacts.set('insolation', `${fmt(model.insolation, model.insolation < 0.1 ? 3 : 2)} ${t('units.solarFlux')}`);
    physicsCard.update(); // its thresholds and flux limits belong to this star
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
  syncCameraButtons();
  refresh();
  syncStarSliders();
  updateReadouts(true);
  // start in whatever camera mode the visitor left behind, already framed
  if (state.cameraMode === 'follow') tweenCamera(planetView, 0);
  else fitView(0);
  sim.start();

  // dev-only hook for automated checks; stripped from production builds
  if (import.meta.env.DEV) window.__lpHabitableZone = { sim, state, get model() { return model; }, setLuminosity, setDistance, setAge, setPlaying, setSpeed, setTempUnit, setStarScale, setCameraMode, setStar, setTemperature, setRadius, setMainSequence, frame, fitView, fitViewIfAuto, fitRadiusUnits, frameOverview, planetView, refresh, planetMaterial, starMaterial };

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
/**
 * Physics card. Every line is translated *and* interpolated with `values()`, so the numbers that
 * depend on the star (its flux limits and the temperatures they map to) or on the view (how far
 * the bodies are exaggerated) stay honest instead of being frozen into the copy.
 */
function createPhysicsCard(values = () => ({})) {
  const details = el('details', 'lp-info lp-physics');
  const summary = el('summary', 'lp-info__summary');
  summary.append(bindText(el('span', 'lp-info__title'), `${KEYS}.physics.title`));
  const body = el('div', 'lp-info__body');
  details.append(summary, body);
  const live = new Map(); // node → i18n key, re-interpolated by update()
  const entries = [
    ['zone', true],
    ['teq', true],
    ['state', true],
    ['appearance', true],
    ['evolution', true],
    ['star', true],
    ['period', false],
  ];
  const liveText = (node, key) => {
    live.set(node, key);
    node.textContent = t(key, values());
    return node;
  };
  function render() {
    body.replaceChildren();
    live.clear();
    for (const [id, hasNote] of entries) {
      const block = el('div', 'lp-formula');
      const label = el('p', 'lp-formula__label');
      label.textContent = t(`${KEYS}.physics.${id}Label`);
      block.append(label, liveText(el('code', 'lp-formula__code'), `${KEYS}.physics.${id}Formula`));
      if (hasNote) block.append(liveText(el('p', 'lp-formula__note'), `${KEYS}.physics.${id}Note`));
      // the plain-language consequence of the brightening, next to the relation it follows from
      if (id === 'evolution') block.append(liveText(el('p', 'lp-formula__note'), `${KEYS}.evolution.note`));
      body.append(block);
    }
    body.append(liveText(el('p', 'lp-formula__note'), `${KEYS}.physics.scaleNote`));
  }
  /** Refresh only the interpolated numbers – no DOM is rebuilt. */
  function update() {
    const params = values();
    for (const [node, key] of live) node.textContent = t(key, params);
  }
  render();
  return { el: details, render, update, dispose() {} };
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
 * Planet surface. Three looks, blended by the state mix from ./physics.js:
 *  - temperate: the real Earth day map, city lights gated to the night side (as in the axial-tilt
 *    simulation); a procedural Earth with drifting clouds while the maps are unavailable
 *  - frozen: a snowball – sea ice with dark refrozen leads, snow-covered continents, blowing snow;
 *    bare tundra shows through at the equator just past the outer edge (uCold → 0)
 *  - hot: the same world drying out past the inner edge – the green goes out of the land, then the
 *    sea level falls and leaves pale seabed and salt pans (uScorch → 1) – under a Venus-like banded
 *    cloud deck once the water is in the air, which burns off again to a cracked crust drifting on
 *    magma, with convecting lava seas and flaring vents (uHeat → 1)
 *
 * The looks do not cross-fade as whole pictures: `uThaw` and `uScorch` move a *climate belt* across
 * the globe. Ice grows from the poles towards the equator, scorched ground spreads from the equator
 * towards the poles, both behind a front made ragged by noise, and along the boiling front the
 * oceans go up in steam. So a planet dragged out of the zone changes the way a climate changes –
 * from one end of the globe – instead of dissolving into another planet.
 */
const PLANET_FRAGMENT = /* glsl */ `
  uniform float uThaw;      // 0 = frozen, 1 = temperate
  uniform float uScorch;    // 0 = temperate, 1 = scorched
  uniform float uCold;      // 0 = just frozen, 1 = deep-frozen
  uniform float uHeat;      // 0 = just scorched (cloud world), 1 = lava world
  uniform float uLivable;   // 1 inside the zone, 0 once it is no place to live
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
  const vec3 SAND = vec3(0.36, 0.22, 0.08);
  const vec3 SAND_PALE = vec3(0.58, 0.42, 0.21);
  const vec3 SEABED = vec3(0.065, 0.050, 0.038);
  const vec3 SEABED_PALE = vec3(0.22, 0.17, 0.11);
  const vec3 SALT = vec3(0.70, 0.66, 0.58);
  const vec3 BRINE = vec3(0.025, 0.055, 0.035);
  const vec3 ROCK_DARK = vec3(0.045, 0.012, 0.006);
  const vec3 ROCK_RED = vec3(0.16, 0.035, 0.012);
  const vec3 LAVA_DARK = vec3(0.30, 0.04, 0.004);
  const vec3 LAVA_CRUST = vec3(0.030, 0.010, 0.007);
  const vec3 HAZE_LIGHT = vec3(0.82, 0.62, 0.34);
  const vec3 HAZE_DARK = vec3(0.42, 0.29, 0.13);
  const vec3 STEAM = vec3(0.92, 0.88, 0.84);
  /** Incandescence: dark red → orange → yellow-white. Above 1 on purpose – the tone mapper takes it from there. */
  vec3 glow(float x) {
    x = clamp(x, 0.0, 1.0);
    vec3 c = mix(vec3(0.30, 0.020, 0.004), vec3(1.10, 0.22, 0.015), smoothstep(0.0, 0.45, x));
    c = mix(c, vec3(1.90, 0.80, 0.10), smoothstep(0.42, 0.80, x));
    return mix(c, vec3(2.60, 1.85, 0.90), smoothstep(0.80, 1.0, x));
  }
  void main() {
    vec3 p = normalize(vPos);
    vec3 N = normalize(vNormalW);
    vec3 L = normalize(-vWorldPos); // the star sits at the origin
    vec3 V = normalize(cameraPosition - vWorldPos);
    float ndl = dot(N, L);
    float lat = abs(p.y);
    float detail = fbm(p * 6.5 + vec3(7.0), 4);

    // --- where each look sits on the globe ------------------------------------------------------
    // Both transitions are a belt whose edge travels: the ice line runs from beyond the poles
    // (nothing frozen) to past the equator (frozen over), the scorch line the other way. Noise
    // roughens both fronts so they follow the terrain rather than a circle of latitude.
    float coldFront = clamp(lat + (fbm(p * 3.4 + vec3(17.0, 2.0, 41.0), 4) - 0.5) * 0.30, 0.0, 1.25);
    float hotFront = clamp(lat + (fbm(p * 3.1 + vec3(5.0, 23.0, 8.0), 4) - 0.5) * 0.30, 0.0, 1.25);
    // ice reaches down to this latitude, scorched ground up to that one; -0.22 is "nothing", 1.42 "all of it"
    float iceLine = mix(-0.22, 1.42, uThaw);
    float scorchLine = mix(-0.22, 1.42, uScorch);
    float mThaw = 1.0 - smoothstep(iceLine - 0.13, iceLine + 0.13, coldFront);  // 1 temperate, 0 frozen over
    float mScorch = 1.0 - smoothstep(scorchLine - 0.13, scorchLine + 0.13, hotFront); // 1 scorched, 0 not yet

    // --- the world underneath: the Earth maps when they are loaded, procedural otherwise --------
    // Both the temperate and the frozen look are built on this one surface, so freezing never
    // swaps the planet for a different one – it only lays ice over the world that is already there.
    vec3 dayTex = texture2D(uDayMap, vUv).rgb;
    float land;
    float continents = 0.5;
    vec3 bare;
    if (uHasDay > 0.5) {
      land = 1.0 - smoothstep(0.15, 0.5, (dayTex.b - max(dayTex.r, dayTex.g)) / (dayTex.b + 0.002));
      bare = dayTex;
    } else {
      continents = fbm(p * 1.9 + vec3(3.1, 1.7, 5.3), 5);
      land = smoothstep(0.47, 0.53, continents);
      vec3 ocean = mix(OCEAN_DEEP, OCEAN_SHALLOW, smoothstep(0.35, 0.5, continents));
      vec3 landCol = mix(LAND_GREEN, LAND_BROWN, smoothstep(0.35, 0.75, detail));
      landCol = mix(landCol, LAND_BROWN * 1.3, smoothstep(0.6, 0.85, continents)); // highlands
      float polar = smoothstep(0.80, 0.90, lat + (detail - 0.5) * 0.12);
      bare = mix(mix(ocean, landCol, land), ICE, polar);
    }

    // --- temperate: the world as it is ------------------------------------------------------------
    vec3 temperate = bare;
    vec3 lights = vec3(0.0);
    float clouds = 0.0;
    if (mThaw > 0.001 && uScorch < 0.999) {
      if (uHasDay < 0.5) {
        clouds = smoothstep(0.52, 0.68, fbm(p * 3.0 + vec3(uTime * 0.01, 0.0, 11.0), 4));
        temperate = mix(temperate, vec3(0.85), clouds * 0.75);
      }
      if (uHasNight > 0.5 && uLivable > 0.001) {
        // city lights, faded out across the terminator so they only show on the night side – and
        // only while the planet is a place to live at all: a frozen or a scorched world goes dark
        lights = texture2D(uNightMap, vUv).rgb * smoothstep(0.08, -0.12, ndl) * 1.8 * uLivable;
      }
    }

    // --- frozen: the same world, iced over ----------------------------------------------------------
    // Ice as a layer over that surface, not a replacement for it: the oceans whiten but keep their
    // coastlines, and the land shows through the snow, so the planet stays recognisably itself while
    // the ice is on its way. Only a deep freeze buries the lot.
    vec3 frozen = bare;
    if (mThaw < 0.999) {
      float relief = (uHasDay > 0.5) ? clamp(dot(dayTex, vec3(0.33)) * 4.0, 0.0, 1.0) : detail;
      // sea ice: gently mottled, criss-crossed by thin leads where it has cracked open again
      float leadField = fbm(p * 7.0 + vec3(21.0, 3.0, 8.0), 4);
      float leads = pow(1.0 - abs(leadField * 2.0 - 1.0), 18.0);
      vec3 seaIce = mix(SEA_ICE, SEA_ICE_DARK, smoothstep(0.4, 0.7, fbm(p * 3.5 + vec3(9.0), 3)) * 0.6);
      // young ice is thin enough for the water below to darken it, and the leads open right through
      // to it; the deeper the freeze, the more it piles up until nothing shows through at all
      float pack = mix(0.80, 1.0, uCold) * (1.0 - leads * 0.85);
      vec3 iced = mix(mix(bare, LEAD, leads * 0.5), seaIce, pack);
      // snow on land: it takes to the high ground first and covers everything as the cold deepens
      float cover = clamp(mix(0.50, 1.0, uCold) + (relief - 0.5) * 0.35, 0.0, 1.0);
      vec3 snowy = mix(bare, mix(ICE_SHADE, ICE, 0.45 + 0.55 * relief), cover);
      // just past the ice edge, ground near the equator stays clear of it
      float clear = (1.0 - uCold) * smoothstep(0.4, 0.08, lat) * smoothstep(0.42, 0.55, detail);
      snowy = mix(snowy, mix(bare, TUNDRA, 0.45), clear * 0.9);
      vec3 surface = mix(iced, snowy, land);
      surface = mix(surface, vec3(0.62, 0.74, 0.92), uCold * 0.28); // deep freeze: thicker, bluer ice
      // blowing snow and ice fog drifting across the surface
      float wisps = smoothstep(0.55, 0.78, fbm(rotateY(p, uTime * 0.03) * 4.0 + vec3(0.0, uTime * 0.01, 31.0), 4));
      frozen = mix(surface, vec3(0.9, 0.93, 0.97), wisps * 0.5 * (0.35 + 0.65 * uCold));
    }

    // --- hot: the same world drying out → cloud deck → cracked crust → lava world -------------------
    vec3 scorched = bare;
    vec3 emissive = vec3(0.0);
    if (uScorch > 0.001) {
      float t = uTime;
      // Before anything burns, the world simply loses its water, and it does that on the same map
      // the temperate planet uses: first the green goes out of the land, then the sea level falls
      // and the shelves come up as damp sediment and salt pans. It is this planet drying out, not
      // a different one arriving.
      float parch = smoothstep(0.0, 0.35, uScorch); // the land dries first
      float fall = smoothstep(0.35, 1.0, uScorch); // and only then does the sea level go down
      float green = clamp((bare.g - max(bare.r, bare.b)) * 5.0, 0.0, 1.0);
      vec3 sand = mix(SAND, SAND_PALE, smoothstep(0.35, 0.75, detail));
      vec3 parched = mix(bare, sand, parch * (0.30 + 0.70 * green));
      // The map has no bathymetry – its ocean is one flat blue – so the basins are a smooth noise
      // field of their own: the shallows go first and the water pulls back into the deep ones,
      // which is the shape a drying ocean takes.
      float depth = smoothstep(0.35, 0.68, fbm(p * 1.7 + vec3(19.0, 4.0, 27.0), 4));
      float exposed = smoothstep(fall + 0.12, fall - 0.12, depth);
      // the floor it leaves behind: pale on the shelves, dark in the basins, and crusted with salt
      // where the water has only just gone
      float pans = smoothstep(0.45, 0.85, fbm(p * 4.5 + vec3(13.0, 2.0, 6.0), 3));
      float justLeft = smoothstep(0.30, 0.0, abs(depth - fall));
      vec3 seabed = mix(SEABED, SEABED_PALE, 1.0 - depth);
      seabed = mix(seabed, SALT, pans * (0.20 + 0.80 * justLeft));
      vec3 shrinking = mix(mix(bare, BRINE, fall * 0.75), seabed, exposed); // what is left turns briny
      vec3 dried = mix(shrinking, parched, land);
      // The crust is a raft of plates riding on the magma below, so the pattern has to *move*, not
      // just brighten: a domain warp whose offset drifts pulls the plates apart and pushes them back
      // together, and the lanes between them open, glow and close again.
      vec3 q = p * 2.6;
      vec3 warp = vec3(
        fbm(q + vec3(0.0, t * 0.035, 0.0), 3),
        fbm(q + vec3(5.2, -t * 0.028, 2.1), 3),
        fbm(q + vec3(9.1, t * 0.031, 7.4), 3)) - 0.5;
      float plates = fbm(q * 1.5 + warp * 2.4, 4);
      float lane = pow(1.0 - abs(plates * 2.0 - 1.0), 8.0);          // the glowing lanes between plates
      float hairline = pow(1.0 - abs(fbm(q * 5.5 + warp * 1.2, 3) * 2.0 - 1.0), 16.0);
      float welling = 0.60 + 0.40 * sin(t * 1.1 + plates * 22.0);    // magma welling up under a lane
      float crack = clamp((lane * welling + hairline * 0.5) * mix(0.40, 1.15, uHeat), 0.0, 1.4);

      vec3 rock = mix(ROCK_DARK, ROCK_RED, detail);
      rock = mix(rock, LAVA_CRUST, uHeat * 0.75); // the crust bakes darker the hotter it gets

      // Molten seas: they rise with the heat, and while there is still a cool side to pool away from
      // they gather on the star-facing one; a lava world glows the whole way round.
      float seaField = fbm(p * 2.0 + vec3(2.0, 8.0, 5.0) + vec3(0.0, t * 0.006, 0.0), 4);
      float seaLevel = mix(0.74, 0.46, uHeat);
      float dayBias = mix(smoothstep(-0.25, 0.35, ndl), 1.0, uHeat * 0.9);
      float sea = smoothstep(seaLevel, seaLevel + 0.07, seaField) * dayBias * smoothstep(0.08, 0.42, uHeat);
      // convection inside them: cooled rafts drifting apart, white-hot seams opening between them
      float cells = fbm(p * 6.5 + warp * 1.1 + vec3(0.0, t * 0.05, 0.0), 3);
      float rafts = smoothstep(0.38, 0.62, cells);
      float seams = pow(1.0 - abs(cells * 2.0 - 1.0), 6.0);
      float shimmer = fbm(p * 15.0 + vec3(t * 0.35, 0.0, t * 0.22), 2);
      float seaHeat = mix(1.0, 0.16, rafts) * (0.62 + 0.40 * shimmer) + seams * 0.7;
      // vents that flare every few seconds, the way a lava lake spatters
      float vents = pow(smoothstep(0.66, 0.98, fbm(p * 3.2 + vec3(31.0, 5.0, 12.0), 3)), 2.0);
      float burst = flareBurst(t * 0.7 + 4.0) * vents * uHeat;

      // The whole thing has to stay a *surface*: only the seams and the vents reach white, everything
      // else sits in the orange half of the ramp, or the planet turns into one blown-out lamp.
      vec3 surface = mix(rock, LAVA_DARK * 0.4, sea);
      emissive = glow(0.25 + 0.60 * crack) * crack * (1.0 - sea * 0.85) * 0.85
        + glow(clamp(seaHeat * 0.55, 0.0, 1.0)) * sea * (0.5 + 0.35 * uHeat)
        + glow(1.0) * burst * 0.9;

      // Venus-like cloud deck: it is the oceans, now in the air, so it thickens as the last of them
      // goes; banded and slowly circulating, and it burns off again as the heat rises
      float cover = smoothstep(0.55, 0.98, uScorch) * (1.0 - smoothstep(0.05, 0.45, uHeat));
      vec3 hp = rotateY(p, t * 0.05);
      float bands = fbm(vec3(hp.x, hp.y * 3.5, hp.z) * 2.2 + vec3(0.0, 0.0, t * 0.01), 4);
      float swirl = fbm(hp * 5.0 + vec3(3.0), 3);
      vec3 haze = mix(HAZE_DARK, HAZE_LIGHT, smoothstep(0.25, 0.75, bands)) * (0.8 + 0.4 * swirl);
      // the dry world gives way to bare rock once there is no water left to keep it a landscape
      float bake = smoothstep(0.70, 1.0, uScorch);
      scorched = mix(mix(dried, surface, bake), haze, cover);
      emissive *= bake * (1.0 - cover * 0.95);
    }

    vec3 albedo = mix(frozen, temperate, mThaw);
    albedo = mix(albedo, scorched, mScorch);
    // the front itself: where the scorched belt is passing over, the oceans are going up in steam
    float front = smoothstep(0.06, 0.40, mScorch) * smoothstep(0.94, 0.60, mScorch) * uThaw;
    float steam = smoothstep(0.40, 0.72, fbm(rotateY(p, uTime * 0.03) * 5.0 + vec3(0.0, uTime * 0.06, 3.0), 3));
    albedo = mix(albedo, STEAM, front * steam * 0.8);
    emissive *= mScorch;

    // lighting: star at the origin
    float diffuse = clamp((ndl + 0.12) / 1.12, 0.0, 1.0);
    diffuse = pow(diffuse, 0.9);
    vec3 nightAmbient = vec3(0.05, 0.07, 0.12) * 0.25;
    vec3 col = albedo * (uLightColor * uLightIntensity * diffuse + nightAmbient) + emissive + lights * mThaw * (1.0 - mScorch);
    // specular glint: open water (temperate) and glossy ice (frozen)
    vec3 H = normalize(L + V);
    float spec = pow(clamp(dot(N, H), 0.0, 1.0), 60.0) * step(0.0, ndl) * (1.0 - land) * (1.0 - mScorch);
    col += uLightColor * spec * (0.35 * (1.0 - clouds) * mThaw + 0.3 * (1.0 - mThaw));
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

/** The flat zone: a unit disc scaled to the outer edge, hollowed out at the inner/outer ratio. */
const ANNULUS_VERTEX = /* glsl */ `
  varying float vRadius;
  void main() {
    vRadius = length(position.xy);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ANNULUS_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uInnerRatio;
  varying float vRadius;
  void main() {
    if (vRadius < uInnerRatio) discard;
    gl_FragColor = vec4(uColor, uOpacity);
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
