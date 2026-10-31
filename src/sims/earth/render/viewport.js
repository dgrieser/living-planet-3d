/**
 * The Living Earth's renderer and frame loop.
 *
 * The other simulations share `createScene()` (lib/scene.js), which builds a WebGLRenderer with
 * OrbitControls. The earth sim needs three.js' WebGPURenderer (TSL, compute, automatic WebGL 2
 * fallback), a reversed float depth buffer for metre-to-Moon depth ranges, CPU float64 model-view
 * matrices for ECEF coordinates, and globe controls – so it brings its own loop with the same
 * behaviour the visitor knows from the others: capped devicePixelRatio, render on demand, pause
 * while the tab is hidden, prefers-reduced-motion, and `setViewShift()` for `createPanelShift()`.
 *
 *   const view = await createViewport({ container, backend: 'auto' | 'webgl' });
 *   view.onFrame((dt) => { ... return true if something changed ... });
 *   view.render = () => pipeline.render();
 *   view.start();
 */
import * as THREE from 'three/webgpu';

const MAX_PIXEL_RATIO = 2;
const MAX_DELTA = 0.1;
const VIEW_SHIFT_MS = 420;

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * @param {{ container: HTMLElement, backend?: 'auto'|'webgl', antialias?: boolean }} opts
 */
export async function createViewport({ container, backend = 'auto', antialias = false }) {
  const renderer = new THREE.WebGPURenderer({
    antialias,
    alpha: false,
    powerPreference: 'high-performance',
    reversedDepthBuffer: true,
    forceWebGL: backend === 'webgl',
  });
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  // ECEF coordinates are millions of metres: build model-view matrices in float64 on the CPU
  // (no InstancedMesh in M0 – the floating origin of docs/earth-sim/01 §3 replaces this for trees)
  renderer.highPrecision = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = 'lp-canvas';
  container.append(renderer.domElement);

  const backendName = renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 1e10);

  // --- loop -----------------------------------------------------------------------------------------
  const frameCallbacks = new Set();
  let running = false;
  let rafId = 0;
  let last = 0;
  let renderRequested = true;
  let reducedMotion = prefersReducedMotion();
  let continuous = false; // something (streaming tiles, a flight, a playing clock) wants frames
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const onMotionChange = (e) => {
    reducedMotion = e.matches;
    requestRender();
  };
  motionQuery.addEventListener('change', onMotionChange);

  const api = {
    renderer,
    scene,
    camera,
    backend: backendName,
    /** Replaced by the simulation with its render pipeline. */
    render: () => renderer.render(scene, camera),
    get reducedMotion() {
      return reducedMotion;
    },
    onFrame(cb) {
      frameCallbacks.add(cb);
      return () => frameCallbacks.delete(cb);
    },
    requestRender,
    /** Keep frames coming (tiles streaming, a camera flight, the clock running). */
    setContinuous(v) {
      continuous = v;
      if (v) requestRender();
    },
    setViewShift,
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      requestRender();
    },
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    },
    dispose() {
      api.stop();
      if (shiftRaf) cancelAnimationFrame(shiftRaf);
      motionQuery.removeEventListener('change', onMotionChange);
      document.removeEventListener('visibilitychange', onVisibility);
      resizeObserver.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };

  let inTick = false;
  function tick(now) {
    rafId = 0;
    if (!running || document.hidden) return;
    inTick = true;
    const dt = Math.min((now - last) / 1000, MAX_DELTA);
    last = now;
    let changed = renderRequested;
    renderRequested = false;
    for (const cb of frameCallbacks) if (cb(dt, { reducedMotion })) changed = true;
    if (changed || continuous) api.render();
    inTick = false;
    // exactly one pending frame at a time
    if ((changed || continuous || renderRequested) && !rafId) rafId = requestAnimationFrame(tick);
  }

  function requestRender() {
    renderRequested = true;
    // inside a tick the follow-up frame is scheduled by tick() itself – a second requestAnimationFrame
    // here would double the ticks every frame
    if (inTick) return;
    if (running && !rafId && !document.hidden) {
      last = performance.now();
      rafId = requestAnimationFrame(tick);
    }
  }

  const onVisibility = () => {
    if (!document.hidden) requestRender();
  };
  document.addEventListener('visibilitychange', onVisibility);

  // --- view shift (see createPanelShift in lib/ui.js) --------------------------------------------------
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
  function setViewShift(px, { animate = true } = {}) {
    const next = Number.isFinite(px) ? px : 0;
    if (next === viewShiftTo && !shiftRaf) return;
    viewShiftTo = next;
    if (shiftRaf) cancelAnimationFrame(shiftRaf);
    shiftRaf = 0;
    if (!animate || reducedMotion) {
      viewShift = next;
      applyViewShift();
      requestRender();
      return;
    }
    shiftFrom = viewShift;
    shiftStart = performance.now();
    shiftRaf = requestAnimationFrame(stepShift);
  }

  // --- resize ------------------------------------------------------------------------------------------
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

  return api;
}
