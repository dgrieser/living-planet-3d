/**
 * Walk mode: the first-person camera of docs/earth-sim/10 §3 – eye height above the terrain, walking
 * pace, the arrow keys or W A S D to move (Shift runs), dragging to look around, and an on-screen pad for
 * touch screens. The ground is the finest loaded terrain under the walker (`groundHeight`, metres above
 * the ellipsoid); where none is loaded yet the walker keeps its last height.
 *
 * The pose is geodetic (render/camera.js), so walking a long way follows the curve of the Earth.
 */
import { applyPose } from './camera.js';
import { DEG } from '../geodesy.js';

export const WALK = Object.freeze({ eyeHeightM: 1.7, walkMps: 1.4, runMps: 6, turnDegPerPx: 0.25, keyTurnDegPerS: 90 });
const R_EARTH = 6371008.8;

const KEYS = {
  forward: ['ArrowUp', 'KeyW'],
  back: ['ArrowDown', 'KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  turnLeft: ['ArrowLeft', 'KeyQ'],
  turnRight: ['ArrowRight', 'KeyE'],
};

/**
 * @param {{ camera: THREE.Camera, dom: HTMLElement, groundHeight: (latRad: number, lonRad: number) => number|null,
 *           onChange: () => void }} opts
 */
export function createWalk({ camera, dom, groundHeight, onChange }) {
  const state = { active: false, latDeg: 0, lonDeg: 0, heightM: 0, headingDeg: 0, pitchDeg: 0, run: false };
  const held = new Set();
  const pad = new Set(); // on-screen buttons held down
  let drag = null;

  const isTyping = (e) => {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  };
  const onKeyDown = (e) => {
    if (!state.active || isTyping(e)) return;
    const known = Object.values(KEYS).some((list) => list.includes(e.code));
    if (known) {
      held.add(e.code);
      e.preventDefault();
      onChange();
    }
    if (e.key === 'Shift') state.run = true;
  };
  const onKeyUp = (e) => {
    held.delete(e.code);
    if (e.key === 'Shift') state.run = false;
  };
  const onPointerDown = (e) => {
    if (!state.active) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    dom.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const onPointerMove = (e) => {
    if (!state.active || !drag || e.pointerId !== drag.id) return;
    state.headingDeg = (state.headingDeg - (e.clientX - drag.x) * WALK.turnDegPerPx + 360) % 360;
    state.pitchDeg = Math.max(-80, Math.min(80, state.pitchDeg + (e.clientY - drag.y) * WALK.turnDegPerPx));
    drag.x = e.clientX;
    drag.y = e.clientY;
    e.stopImmediatePropagation();
    onChange();
  };
  const onPointerUp = (e) => {
    if (drag && e.pointerId === drag.id) drag = null;
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  // capture phase, so the globe controls never see the walker's drags
  dom.addEventListener('pointerdown', onPointerDown, true);
  dom.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp);

  const down = (name) => KEYS[name].some((k) => held.has(k)) || pad.has(name);

  function ground() {
    const g = groundHeight(state.latDeg * DEG, state.lonDeg * DEG);
    return g === null ? null : g + WALK.eyeHeightM;
  }

  return {
    state,
    /** Starts walking at a place (degrees), facing a heading. */
    enter({ latDeg, lonDeg, headingDeg = 0 }) {
      Object.assign(state, { active: true, latDeg, lonDeg, headingDeg, pitchDeg: 0 });
      state.heightM = ground() ?? state.heightM;
      held.clear();
      pad.clear();
      applyPose(camera, state);
      onChange();
    },
    exit() {
      state.active = false;
      held.clear();
      pad.clear();
      drag = null;
    },
    /** Press or release an on-screen pad button ('forward', 'back', 'turnLeft', 'turnRight'). */
    press(name, on) {
      if (on) pad.add(name);
      else pad.delete(name);
      onChange();
    },
    /** Whether a key or pad button is held (the frame loop keeps rendering while it is). */
    get moving() {
      return state.active && (held.size > 0 || pad.size > 0 || drag !== null);
    },
    /** Advances the walker by dt seconds and places the camera. */
    update(dt) {
      if (!state.active) return false;
      const turn = (down('turnRight') ? 1 : 0) - (down('turnLeft') ? 1 : 0);
      state.headingDeg = (state.headingDeg + turn * WALK.keyTurnDegPerS * dt + 360) % 360;
      const fwd = (down('forward') ? 1 : 0) - (down('back') ? 1 : 0);
      const side = (down('right') ? 1 : 0) - (down('left') ? 1 : 0);
      if (fwd || side) {
        const speed = state.run ? WALK.runMps : WALK.walkMps;
        const len = Math.hypot(fwd, side);
        const h = state.headingDeg * DEG;
        // north and east components of the step (heading clockwise from north)
        const north = ((fwd * Math.cos(h) - side * Math.sin(h)) / len) * speed * dt;
        const east = ((fwd * Math.sin(h) + side * Math.cos(h)) / len) * speed * dt;
        state.latDeg += (north / R_EARTH) / DEG;
        state.lonDeg += (east / (R_EARTH * Math.cos(state.latDeg * DEG))) / DEG;
      }
      const g = ground();
      if (g !== null) state.heightM = g;
      applyPose(camera, state);
      return true;
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      dom.removeEventListener('pointerdown', onPointerDown, true);
      dom.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp);
    },
  };
}
