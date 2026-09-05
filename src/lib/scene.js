/**
 * Shared scene bootstrap for all simulations.
 *
 * const sim = createScene({ container });
 * sim.onFrame((dt, elapsed) => { ... });   // dt in seconds, clamped
 * sim.start();
 * ...
 * sim.dispose();
 *
 * Features: capped devicePixelRatio (≤ 2), OrbitControls with touch + damping,
 * procedural starfield, resize handling, delta-time loop, auto-pause when the tab
 * is hidden, prefers-reduced-motion support (static frame, render on demand) and
 * an animated horizontal view shift for making room for an overlaying panel.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const MAX_PIXEL_RATIO = 2;
const MAX_DELTA = 0.1; // seconds – avoids huge jumps after a tab was hidden
const VIEW_SHIFT_MS = 420; // how long setViewShift() takes to slide the picture across

export { isWebGLAvailable } from './webgl.js';

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * @param {{
 *   container: HTMLElement,
 *   cameraPosition?: [number, number, number],
 *   fov?: number,
 *   near?: number, far?: number,
 *   stars?: boolean | { count?: number, radius?: number },
 *   controls?: Partial<{ minDistance:number, maxDistance:number, enablePan:boolean, autoRotate:boolean, autoRotateSpeed:number }>,
 *   background?: number,
 * }} opts
 */
export function createScene({
  container,
  cameraPosition = [0, 2, 8],
  fov = 45,
  near = 0.1,
  far = 2000,
  stars = true,
  controls: controlOpts = {},
  background = 0x030510,
} = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.className = 'lp-canvas';
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);

  const camera = new THREE.PerspectiveCamera(fov, 1, near, far);
  camera.position.set(...cameraPosition);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = controlOpts.enablePan ?? false;
  controls.minDistance = controlOpts.minDistance ?? 2;
  controls.maxDistance = controlOpts.maxDistance ?? 60;
  controls.autoRotate = controlOpts.autoRotate ?? false;
  controls.autoRotateSpeed = controlOpts.autoRotateSpeed ?? 0.4;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  if (stars) scene.add(createStarfield(typeof stars === 'object' ? stars : {}));

  // --- animation loop -------------------------------------------------------
  const timer = new THREE.Timer();
  const frameCallbacks = new Set();
  let elapsed = 0; // seconds of *animated* time (excludes pauses)
  let running = false;
  let rafId = 0;
  let renderRequested = false;
  let reducedMotion = prefersReducedMotion();
  let userPaused = false;
  let inTick = false;

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const onMotionChange = (e) => {
    reducedMotion = e.matches;
    syncLoop();
    requestRender();
  };
  motionQuery.addEventListener('change', onMotionChange);

  /** Animation is active only when running, visible, not user-paused and motion is allowed. */
  const animating = () => running && !document.hidden && !userPaused && !reducedMotion;

  function tick(timestamp) {
    rafId = 0;
    if (!running) return;
    inTick = true;
    timer.update(timestamp);
    const shouldAnimate = animating();
    const dt = shouldAnimate ? Math.min(timer.getDelta(), MAX_DELTA) : 0;
    if (shouldAnimate) {
      elapsed += dt;
      for (const cb of frameCallbacks) cb(dt, elapsed);
    }
    // OrbitControls dispatches "change" from inside update() while damping settles (and when the
    // camera was moved programmatically); that only flags renderRequested while inTick is set.
    const controlsMoved = controls.update(dt || 1 / 60);
    const needsFrame = shouldAnimate || controlsMoved || renderRequested;
    if (needsFrame) {
      renderer.render(scene, camera);
      renderRequested = false;
    }
    inTick = false;
    // Keep looping while animating or while damping still settles – exactly one pending frame at a time.
    if (needsFrame && !rafId) rafId = requestAnimationFrame(tick);
  }

  function requestRender() {
    renderRequested = true;
    // During a tick the render (and the follow-up frame) is handled by tick() itself; scheduling a
    // second requestAnimationFrame here would double the number of ticks per frame.
    if (inTick) return;
    if (running && !rafId) rafId = requestAnimationFrame(tick);
  }

  function syncLoop() {
    if (animating()) {
      timer.reset(); // avoid a large delta after a pause
      if (!rafId) rafId = requestAnimationFrame(tick);
    }
  }

  const onVisibility = () => syncLoop();
  document.addEventListener('visibilitychange', onVisibility);
  controls.addEventListener('change', requestRender);
  controls.addEventListener('start', requestRender);

  // --- view shift -----------------------------------------------------------
  // A panel floating over one side of the canvas can be compensated for by sliding
  // the projection sideways: the scene keeps its own centre – the orbit target, the
  // controls and picking all stay where they are – while the picture moves out from
  // under the panel. Positive values move the picture to the left, in CSS pixels.
  let viewShift = 0;
  let viewShiftTo = 0;
  let shiftRaf = 0;
  let shiftFrom = 0;
  let shiftStart = 0;

  function applyViewShift() {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    if (Math.abs(viewShift) < 0.5) camera.clearViewOffset();
    else camera.setViewOffset(width, height, viewShift, 0, width, height);
  }

  function stepShift(now) {
    shiftRaf = 0;
    const k = Math.min(1, (now - shiftStart) / VIEW_SHIFT_MS);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    viewShift = shiftFrom + (viewShiftTo - shiftFrom) * e;
    applyViewShift();
    requestRender();
    if (k < 1) shiftRaf = requestAnimationFrame(stepShift);
  }

  // --- resize ---------------------------------------------------------------
  function resize() {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    applyViewShift();
    requestRender();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  return {
    scene,
    camera,
    renderer,
    controls,
    get reducedMotion() {
      return reducedMotion;
    },
    get paused() {
      return userPaused;
    },
    get elapsed() {
      return elapsed;
    },
    setPaused(v) {
      userPaused = v;
      syncLoop();
      requestRender();
    },
    onFrame(cb) {
      frameCallbacks.add(cb);
      return () => frameCallbacks.delete(cb);
    },
    requestRender,
    /**
     * Slide the rendered picture sideways without moving the camera or its target.
     * @param {number} px  CSS pixels to move the picture to the left (0 = centred).
     */
    setViewShift(px, { animate = true } = {}) {
      const next = Number.isFinite(px) ? px : 0;
      if (next === viewShiftTo && !shiftRaf) return;
      viewShiftTo = next;
      if (shiftRaf) {
        cancelAnimationFrame(shiftRaf);
        shiftRaf = 0;
      }
      if (!animate || reducedMotion) {
        viewShift = next;
        applyViewShift();
        requestRender();
        return;
      }
      shiftFrom = viewShift;
      shiftStart = performance.now();
      shiftRaf = requestAnimationFrame(stepShift);
    },
    start() {
      if (running) return;
      running = true;
      syncLoop();
      requestRender();
    },
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    },
    dispose() {
      this.stop();
      if (shiftRaf) cancelAnimationFrame(shiftRaf);
      motionQuery.removeEventListener('change', onMotionChange);
      document.removeEventListener('visibilitychange', onVisibility);
      resizeObserver.disconnect();
      timer.dispose();
      controls.dispose();
      disposeSceneGraph(scene);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/** Points-based starfield on a large sphere; sizeAttenuation off keeps stars crisp. */
export function createStarfield({ count = 2500, radius = 900 } = {}) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // uniform distribution on sphere
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = radius * (0.85 + Math.random() * 0.15);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
    // slight colour temperature variation (bluish → warm white)
    const temp = Math.random();
    color.setHSL(0.6 - temp * 0.1, 0.4, 0.75 + Math.random() * 0.25);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 1.6,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'starfield';
  points.frustumCulled = false;
  return points;
}

/** Recursively free geometries, materials and textures. */
export function disposeSceneGraph(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    const materials = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const m of materials) {
      for (const value of Object.values(m)) {
        if (value && value.isTexture) value.dispose();
      }
      m.dispose();
    }
  });
  root.clear();
}
