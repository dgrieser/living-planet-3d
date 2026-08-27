/**
 * Simulation: Axial tilt & rotation.
 * A planet lit by a distant "sun"; the user tilts the rotation axis and
 * changes the rotation speed, toggling helper geometry (axis, equator, terminator).
 */
import * as THREE from 'three';
import { createScene } from '../../lib/scene.js';
import { createPanel, createSlider, createToggle, createButton, createInfoCard, createNotice, el } from '../../lib/ui.js';
import { bindText } from '../../lib/i18n.js';

const DEFAULTS = Object.freeze({
  tilt: 23.4, // degrees
  rotationSpeed: 30, // degrees per second (visual, not to scale)
  showAxis: true,
  showEquator: true,
  showTerminator: false,
});

export default function mount(container, _meta) {
  const state = { ...DEFAULTS };

  const viewport = el('div', 'lp-sim__viewport');
  container.append(viewport);

  const sim = createScene({
    container: viewport,
    cameraPosition: [0, 1.6, 6.5],
    controls: { minDistance: 2.5, maxDistance: 30 },
  });
  const { scene, camera } = sim;
  camera.lookAt(0, 0, 0);

  // --- lighting: a distant sun along +X ----------------------------------------
  const sun = new THREE.DirectionalLight(0xfff4e0, 3.2);
  sun.position.set(40, 0, 0);
  scene.add(sun, new THREE.AmbientLight(0x223355, 0.35));

  // small glowing sun disc for orientation
  const sunDisc = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xffe9a8 }),
  );
  sunDisc.position.set(40, 0, 0);
  scene.add(sunDisc);
  const sunGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: createGlowTexture(), color: 0xffd27a, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  sunGlow.scale.setScalar(6);
  sunGlow.position.copy(sunDisc.position);
  scene.add(sunGlow);

  // --- planet group (tilted) ----------------------------------------------------
  const tiltGroup = new THREE.Group(); // tilt applied here
  const spinGroup = new THREE.Group(); // rotation applied here
  tiltGroup.add(spinGroup);
  scene.add(tiltGroup);

  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 48),
    new THREE.MeshStandardMaterial({
      map: createPlanetTexture(),
      roughness: 0.85,
      metalness: 0.0,
    }),
  );
  spinGroup.add(planet);

  // faint atmosphere rim
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.03, 48, 32),
    new THREE.MeshBasicMaterial({ color: 0x6fb6ff, transparent: true, opacity: 0.08, side: THREE.BackSide }),
  );
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

  // terminator (day/night boundary): great circle perpendicular to sun direction – world space
  const terminator = new THREE.Mesh(
    new THREE.TorusGeometry(1.015, 0.006, 8, 128),
    new THREE.MeshBasicMaterial({ color: 0xff8a80 }),
  );
  terminator.rotation.y = Math.PI / 2; // plane x = 0, perpendicular to sun on +X
  scene.add(terminator);

  // orbital-plane reference: a faint disc/ring in the ecliptic (y = 0)
  const ecliptic = new THREE.Mesh(
    new THREE.RingGeometry(1.9, 1.92, 128),
    new THREE.MeshBasicMaterial({ color: 0xa7b4cc, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
  );
  ecliptic.rotation.x = -Math.PI / 2;
  scene.add(ecliptic);

  // --- state → scene ---------------------------------------------------------------
  function applyState() {
    tiltGroup.rotation.z = THREE.MathUtils.degToRad(-state.tilt); // tilt towards/away from the sun (+X)
    axis.visible = state.showAxis;
    equator.visible = state.showEquator;
    terminator.visible = state.showTerminator;
    sim.requestRender();
  }

  sim.onFrame((dt) => {
    spinGroup.rotation.y += THREE.MathUtils.degToRad(state.rotationSpeed) * dt;
  });

  // --- UI ----------------------------------------------------------------------------
  const panel = createPanel();

  const tiltSlider = createSlider({
    labelKey: 'sims.axialTilt.controls.tilt',
    unitKey: 'units.degrees',
    min: 0, max: 90, step: 0.1, value: state.tilt, decimals: 1,
    onChange: (v) => { state.tilt = v; applyState(); },
  });
  const speedSlider = createSlider({
    labelKey: 'sims.axialTilt.controls.rotationSpeed',
    unitKey: 'units.degreesPerSecond',
    min: 0, max: 180, step: 1, value: state.rotationSpeed, decimals: 0,
    onChange: (v) => { state.rotationSpeed = v; },
  });
  const axisToggle = createToggle({
    labelKey: 'sims.axialTilt.controls.showAxis',
    checked: state.showAxis,
    onChange: (v) => { state.showAxis = v; applyState(); },
  });
  const equatorToggle = createToggle({
    labelKey: 'sims.axialTilt.controls.showEquator',
    checked: state.showEquator,
    onChange: (v) => { state.showEquator = v; applyState(); },
  });
  const terminatorToggle = createToggle({
    labelKey: 'sims.axialTilt.controls.showTerminator',
    checked: state.showTerminator,
    onChange: (v) => { state.showTerminator = v; applyState(); },
  });

  const buttonRow = el('div', 'lp-button-row');
  const resetBtn = createButton({
    labelKey: 'panel.reset',
    icon: '↺',
    onClick: () => {
      Object.assign(state, DEFAULTS);
      tiltSlider.setValue(state.tilt, { silent: true });
      speedSlider.setValue(state.rotationSpeed, { silent: true });
      axisToggle.setChecked(state.showAxis, { silent: true });
      equatorToggle.setChecked(state.showEquator, { silent: true });
      terminatorToggle.setChecked(state.showTerminator, { silent: true });
      spinGroup.rotation.y = 0;
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

  panel.add(tiltSlider, speedSlider, axisToggle, equatorToggle, terminatorToggle, buttonRow);
  if (sim.reducedMotion) panel.add(createNotice({ textKey: 'motion.reducedNotice' }));
  panel.add(createInfoCard({ titleKey: 'sims.axialTilt.info.title', bodyKey: 'sims.axialTilt.info.body', open: !window.matchMedia('(max-width: 720px)').matches }));
  container.append(panel.el);

  const hint = el('div', 'lp-sim__hint', { 'aria-hidden': 'true' });
  hint.append(bindText(el('span'), 'panel.hint'));
  container.append(hint);

  applyState();
  sim.start();

  return () => {
    panel.dispose();
    hint.remove();
    sim.dispose();
    viewport.remove();
  };
}

// --- procedural textures (no external assets) -------------------------------------
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
