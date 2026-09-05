/**
 * Shared UI kit. Every component pulls its strings from i18n keys and
 * re-renders on language change. Components return { el, dispose, ... }.
 */
import { t, bindText, bindAttr, onLanguageChange, formatNumber } from './i18n.js';

let idCounter = 0;
const uid = (prefix) => `${prefix}-${++idCounter}`;

/**
 * Inline icons for the places where an emoji glyph is too soft-edged: they are stroked
 * with `currentColor`, so they take the colour and the hover state of their button.
 */
// Each one is balanced by eye on the middle of a round button, not by its bounding box:
// what the eye centres on is the body of the shape – the camera's back, the flask's cone,
// the walls of the house – while the light bits above it (the viewfinder bump, the neck,
// the roof ridge) are allowed to overhang.
export const ICONS = Object.freeze({
  home: '<path d="M3.4 11.3 12 4l8.6 7.3"/><path d="M5.9 10V20h12.2V10"/><path d="M9.9 20v-5.2h4.2V20"/>',
  camera: '<rect x="2.6" y="5.9" width="18.8" height="12.6" rx="2.2"/><path d="M8.4 5.9 9.9 3.3h4.2l1.5 2.6"/><circle cx="12" cy="12.2" r="3.4"/>',
  flask: '<path d="M8.6 3h6.8"/><path d="M9.9 3v6.2L4.2 17.8A1.7 1.7 0 0 0 5.6 20.5h12.8a1.7 1.7 0 0 0 1.4-2.7L14.1 9.2V3"/><path d="M7.2 15h9.6"/>',
});

/** A 24-grid line icon from ICONS, ready to drop into a button. */
export function createIcon(name, className = 'lp-icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = ICONS[name] ?? '';
  return svg;
}

export function el(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    node.setAttribute(k, v === true ? '' : v);
  }
  return node;
}

const SHEET_QUERY = '(max-width: 720px)';
const SHEET_MARGIN = 8; // the sheet's inset from the canvas edge, mirrors the CSS
const SHEET_DEFAULT = 0.7; // its default height as a fraction of the canvas, mirrors the CSS max-height
const SHEET_SNAP = 56; // px – releasing this close to a snap position lands on it
const DRAG_SLOP = 4; // px – below this a press is still a click, not a drag
const ANNOUNCE_MS = 1900; // how long the header names the camera view that was just switched to

/**
 * Collapsible control panel.
 *
 * On narrow screens the panel is a bottom sheet, and there its header doubles as a
 * drag handle: press it and pull to resize the sheet anywhere between "closed" and
 * the full height of the canvas, and it stays where it is let go. Releasing close to
 * the default height or to the closed position snaps to it. The header's buttons keep
 * working as buttons – a press that starts on one of them never drags.
 *
 * With `camera` the header carries a camera button next to the chevron – open or
 * collapsed, so the views stay one tap away while the panel is out of the way. Each
 * press steps to the next view in the list and the header names it for a moment.
 * The simulation keeps the button in step by calling `setCameraView()` whenever its
 * own camera changes (its preset row, a click in the scene, a reset).
 *
 * @param {{ titleKey?: string, collapsedByDefault?: boolean, onToggle?: (collapsed: boolean) => void,
 *           camera?: { views: Array<{ id: string, labelKey: string }>, onSelect: (id: string) => void } }} opts
 */
export function createPanel({ titleKey = 'panel.title', collapsedByDefault, onToggle, camera } = {}) {
  const disposers = [];
  const panel = el('aside', 'lp-panel', { 'aria-labelledby': uid('panel-title') });
  const header = el('div', 'lp-panel__header');
  const grip = el('span', 'lp-panel__grip', { 'aria-hidden': 'true' });
  const title = bindText(el('h2', 'lp-panel__title', { id: panel.getAttribute('aria-labelledby') }), titleKey);
  const announce = el('span', 'lp-panel__announce', { role: 'status' });
  const actions = el('div', 'lp-panel__actions');
  const toggle = el('button', 'lp-panel__toggle', { type: 'button', 'aria-expanded': 'true' });
  toggle.innerHTML = '<span class="lp-panel__chevron" aria-hidden="true"></span>';
  const body = el('div', 'lp-panel__body');
  body.id = uid('panel-body');
  toggle.setAttribute('aria-controls', body.id);

  // --- the header's camera button: one press, the next view ------------------
  const views = camera?.views ?? [];
  let cameraBtn = null;
  let cursor = -1; // the view the last press landed on – where the next one carries on from
  let activeView = null; // what the simulation says it is showing (null: a view of the visitor's own)
  let announceTimer = 0;

  /** Name a view in the header for a moment, then fade it out again. */
  function announceView(labelKey) {
    bindText(announce, labelKey);
    header.classList.add('is-announcing');
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => header.classList.remove('is-announcing'), ANNOUNCE_MS);
  }
  function syncCameraButton() {
    if (!cameraBtn) return;
    // not aria-pressed: the button steps through the views, it does not switch one on and off
    cameraBtn.classList.toggle('is-active', views.some((v) => v.id === activeView));
  }
  if (views.length) {
    cameraBtn = el('button', 'lp-panel__camera', { type: 'button' });
    bindAttr(cameraBtn, { 'aria-label': 'panel.cameraNext', title: 'panel.cameraNext' });
    cameraBtn.append(createIcon('camera', 'lp-panel__camera-icon'));
    cameraBtn.addEventListener('click', () => {
      cursor = (cursor + 1) % views.length;
      const view = views[cursor];
      activeView = view.id;
      syncCameraButton();
      announceView(view.labelKey);
      camera.onSelect?.(view.id);
    });
    actions.append(cameraBtn);
    syncCameraButton();
    disposers.push(() => clearTimeout(announceTimer));
  }

  actions.append(toggle);
  header.append(grip, title, announce, actions);
  panel.append(header, body);

  const isSheet = () => window.matchMedia(SHEET_QUERY).matches;
  let collapsed = collapsedByDefault ?? isSheet();
  let sheetHeight = null; // px the visitor dragged the sheet to; null = the height CSS gives it

  /** Where the sheet may go: header-only, the whole canvas, and the height it opens to. */
  function sheetBounds() {
    const area = panel.offsetParent ?? panel.parentElement;
    const areaHeight = area?.clientHeight || window.innerHeight;
    const min = header.offsetHeight || 48;
    const max = Math.max(min, areaHeight - 2 * SHEET_MARGIN);
    const preferred = Math.round(areaHeight * SHEET_DEFAULT);
    // while it is collapsed the body has no measurable height – fall back to the CSS default
    const natural = collapsed ? preferred : header.offsetHeight + body.scrollHeight;
    return { min, max, def: Math.min(Math.max(Math.min(preferred, natural), min), max) };
  }

  function applySheetHeight() {
    const sized = isSheet() && !collapsed && sheetHeight != null;
    panel.classList.toggle('lp-panel--sized', sized);
    panel.style.height = sized ? `${sheetHeight}px` : '';
  }

  function render() {
    panel.classList.toggle('is-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    bindAttr(toggle, { 'aria-label': collapsed ? 'panel.expand' : 'panel.collapse', title: collapsed ? 'panel.expand' : 'panel.collapse' });
    applySheetHeight();
    onToggle?.(collapsed);
  }
  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    render();
  });

  // --- drag the header to resize the sheet ---------------------------------
  let drag = null;
  const onPointerDown = (e) => {
    if (drag || !isSheet() || e.button > 0 || e.target.closest('button')) return;
    drag = { id: e.pointerId, y: e.clientY, from: collapsed ? sheetBounds().min : panel.offsetHeight, bounds: null };
    header.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = drag.y - e.clientY; // up is taller
    if (!drag.bounds) {
      if (Math.abs(dy) < DRAG_SLOP) return; // still a click
      panel.classList.add('is-dragging');
      if (collapsed) {
        collapsed = false; // pulling a closed sheet open
        render();
      }
      drag.bounds = sheetBounds();
    }
    const { min, max } = drag.bounds;
    sheetHeight = Math.min(Math.max(drag.from + dy, min), max);
    applySheetHeight();
  };
  const onPointerUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { bounds } = drag;
    header.releasePointerCapture?.(e.pointerId);
    drag = null;
    panel.classList.remove('is-dragging');
    if (!bounds) return; // a click, handled by the toggle button
    if (sheetHeight <= bounds.min + SHEET_SNAP) {
      collapsed = true;
      sheetHeight = null;
    } else if (Math.abs(sheetHeight - bounds.def) <= SHEET_SNAP) {
      sheetHeight = bounds.def;
    }
    render();
  };
  header.addEventListener('pointerdown', onPointerDown);
  header.addEventListener('pointermove', onPointerMove);
  header.addEventListener('pointerup', onPointerUp);
  header.addEventListener('pointercancel', onPointerUp);

  // a dragged height is kept across resizes, but never beyond what still fits
  const onResize = () => {
    if (sheetHeight == null) return;
    const { min, max } = sheetBounds();
    sheetHeight = Math.min(Math.max(sheetHeight, min), max);
    applySheetHeight();
  };
  window.addEventListener('resize', onResize);
  disposers.push(() => window.removeEventListener('resize', onResize));

  render();

  return {
    el: panel,
    body,
    get collapsed() {
      return collapsed;
    },
    add(...components) {
      for (const c of components) {
        body.append(c.el ?? c);
        if (typeof c.dispose === 'function') disposers.push(c.dispose);
      }
      return this;
    },
    setCollapsed(v) {
      collapsed = v;
      render();
    },
    /**
     * Tell the header which camera view is showing – `null` (or an id that is not in the
     * list) for a view the visitor set up themselves, which leaves the next press carrying
     * on from the last preset. Pass `{ announce: true }` to name it in the header as well,
     * for a switch the visitor made somewhere other than this button.
     */
    setCameraView(id, { announce: say = false } = {}) {
      const index = views.findIndex((v) => v.id === id);
      activeView = index >= 0 ? views[index].id : null;
      if (index >= 0) cursor = index;
      syncCameraButton();
      if (say && index >= 0) announceView(views[index].labelKey);
    },
    dispose() {
      disposers.forEach((d) => d());
      panel.remove();
    },
  };
}

const MIN_FREE_WIDTH = 480; // px of canvas that must be left over for shifting to be worth it

/**
 * Keeps the picture out from under the control panel.
 *
 * On a wide screen the panel floats over the top-right corner of the canvas; while it is
 * open the picture slides left by half of what the panel covers, so the subject sits
 * centred in the free part of the canvas. The camera, its target and picking all stay
 * where they are – only the projection is offset (see `setViewShift()` in scene.js).
 * Below the breakpoint the panel is a bottom sheet and there is nothing to dodge
 * sideways, and neither is there when the panel would leave too little canvas over.
 *
 *   const viewShift = createPanelShift({ sim, viewport });
 *   const panel = createPanel({ onToggle: () => viewShift.sync() });
 *   …
 *   container.append(panel.el);
 *   viewShift.attach(panel);            // measures from here on
 *   disposers.push(viewShift.dispose);
 *
 * @param {{ sim: { setViewShift: Function }, viewport: HTMLElement, minFreeWidth?: number }} opts
 */
export function createPanelShift({ sim, viewport, minFreeWidth = MIN_FREE_WIDTH }) {
  let panel = null;

  function shiftPx() {
    if (!panel || panel.collapsed || window.matchMedia(SHEET_QUERY).matches) return 0;
    const view = viewport.getBoundingClientRect();
    const rect = panel.el.getBoundingClientRect();
    if (!view.width || !rect.width) return 0;
    const covered = Math.max(0, view.right - rect.left);
    if (view.width - covered < minFreeWidth) return 0;
    return Math.round(covered / 2);
  }

  const sync = (opts) => sim.setViewShift(shiftPx(), opts);
  const onResize = () => sync({ animate: false });
  window.addEventListener('resize', onResize);

  return {
    /** Re-measure and slide the picture; animated unless `{ animate: false }`. */
    sync,
    /** Start following this panel – call once it is in the DOM. */
    attach(p) {
      panel = p;
      sync({ animate: false });
    },
    dispose() {
      window.removeEventListener('resize', onResize);
    },
  };
}

/** Section heading inside a panel. */
export function createSection(titleKey) {
  const section = el('div', 'lp-section');
  section.append(bindText(el('h3', 'lp-section__title'), titleKey));
  return { el: section, add(...c) { c.forEach((x) => section.append(x.el ?? x)); return this; } };
}

/**
 * Section whose body folds away behind its heading – for secondary controls that
 * should not push the readouts down. Mirrors createSection's API.
 * @param {{ titleKey: string, open?: boolean }} opts
 */
export function createCollapsibleSection({ titleKey, open = true }) {
  const disposers = [];
  const details = el('details', 'lp-collapse');
  if (open) details.open = true;
  const summary = el('summary', 'lp-collapse__summary');
  summary.append(bindText(el('span', 'lp-section__title'), titleKey));
  const body = el('div', 'lp-collapse__body');
  details.append(summary, body);
  return {
    el: details,
    body,
    add(...components) {
      for (const c of components) {
        body.append(c.el ?? c);
        if (typeof c.dispose === 'function') disposers.push(c.dispose);
      }
      return this;
    },
    dispose() {
      disposers.forEach((d) => d());
    },
  };
}

/**
 * A control (usually a slider) with small action buttons sitting inline on its right,
 * e.g. a slider plus the button that resets it.
 */
export function createControlRow(control, ...actions) {
  const row = el('div', 'lp-control-row');
  for (const c of [control, ...actions]) row.append(c.el ?? c);
  return {
    el: row,
    dispose() {
      for (const c of [control, ...actions]) c.dispose?.();
    },
  };
}

/**
 * Range slider with live, locale-formatted value + unit.
 * @param {{ labelKey: string, unitKey?: string, min: number, max: number, step?: number,
 *           value: number, decimals?: number, format?: (v:number)=>string, onChange: (v:number)=>void }} opts
 *   `format` replaces the default "number + unit" readout (e.g. for log-scaled sliders).
 */
export function createSlider({ labelKey, unitKey, min, max, step = 1, value, decimals = 1, format, onChange }) {
  const id = uid('slider');
  const wrap = el('div', 'lp-control lp-slider');
  const row = el('div', 'lp-control__row');
  const label = bindText(el('label', 'lp-control__label', { for: id }), labelKey);
  const output = el('output', 'lp-slider__value', { for: id, 'aria-live': 'off' });
  const input = el('input', 'lp-slider__input', { type: 'range', id, min, max, step, value });
  bindAttr(input, { 'aria-label': labelKey });

  let current = value;
  const renderValue = () => {
    if (format) {
      output.textContent = format(current);
    } else {
      const unit = unitKey ? t(unitKey) : '';
      const num = formatNumber(current, { maximumFractionDigits: decimals });
      // Degree sign and percent stick to the number; other units get a normal space.
      output.textContent = unit === '°' || unit === '%' ? `${num}${unit}` : `${num}\u2009${unit}`.trimEnd();
    }
    input.setAttribute('aria-valuetext', output.textContent);
  };
  input.addEventListener('input', () => {
    current = Number(input.value);
    renderValue();
    onChange?.(current);
  });
  const unsub = onLanguageChange(renderValue);
  renderValue();

  row.append(label, output);
  wrap.append(row, input);

  return {
    el: wrap,
    input,
    get value() {
      return current;
    },
    setValue(v, { silent = false } = {}) {
      current = v;
      input.value = String(v);
      renderValue();
      if (!silent) onChange?.(current);
    },
    dispose: unsub,
  };
}

/** Switch-style toggle (checkbox). */
export function createToggle({ labelKey, checked = false, onChange }) {
  const id = uid('toggle');
  const wrap = el('div', 'lp-control lp-toggle');
  const input = el('input', 'lp-toggle__input', { type: 'checkbox', id, role: 'switch' });
  input.checked = checked;
  input.setAttribute('aria-checked', String(checked));
  const label = el('label', 'lp-toggle__label', { for: id });
  const track = el('span', 'lp-toggle__track', { 'aria-hidden': 'true' });
  const text = bindText(el('span', 'lp-toggle__text'), labelKey);
  label.append(track, text);
  input.addEventListener('change', () => {
    input.setAttribute('aria-checked', String(input.checked));
    onChange?.(input.checked);
  });
  wrap.append(input, label);
  return {
    el: wrap,
    input,
    get checked() {
      return input.checked;
    },
    setChecked(v, { silent = false } = {}) {
      input.checked = v;
      input.setAttribute('aria-checked', String(v));
      if (!silent) onChange?.(v);
    },
    dispose() {},
  };
}

/**
 * Toggle wired to a state object and, optionally, persisted view prefs.
 * Keeps `state[name]`, storage and the checkbox in sync; `onChange` only has to
 * carry the side effects (a refresh, hiding a legend, …).
 * @param {{ labelKey: string, state: object, name: string,
 *           prefs?: { set: (name: string, value: boolean) => void },
 *           onChange?: (v: boolean) => void }} opts
 */
export function createStateToggle({ labelKey, state, name, prefs, onChange }) {
  return createToggle({
    labelKey,
    checked: state[name],
    onChange: (v) => {
      state[name] = v;
      prefs?.set(name, v);
      onChange?.(v);
    },
  });
}

/**
 * Button. variant: 'primary' | 'ghost'
 * `compact` shrinks it to an icon-sized square and hides the label visually – the
 * label still names the button for screen readers and as its tooltip.
 * `slim` keeps the label but trims the button's height, for a full-width action.
 */
export function createButton({ labelKey, ariaKey, onClick, variant = 'ghost', icon, compact = false, slim = false }) {
  const btn = el('button', `lp-button lp-button--${variant}${compact ? ' lp-button--compact' : ''}${slim ? ' lp-button--slim' : ''}`, { type: 'button' });
  let iconEl = null;
  if (icon) {
    iconEl = el('span', 'lp-button__icon', { 'aria-hidden': 'true' });
    iconEl.textContent = icon;
    btn.append(iconEl);
  }
  const label = bindText(el('span', compact ? 'visually-hidden' : null), labelKey);
  btn.append(label);
  if (compact) bindAttr(btn, { 'aria-label': labelKey, title: labelKey });
  if (ariaKey) bindAttr(btn, { 'aria-label': ariaKey });
  btn.addEventListener('click', (e) => onClick?.(e));
  return {
    el: btn,
    /** Re-point the label at another key – for buttons that flip meaning (play ↔ pause). */
    setLabel(key) {
      bindText(label, key);
      if (compact && !ariaKey) bindAttr(btn, { 'aria-label': key, title: key });
    },
    setIcon(next) {
      if (iconEl) iconEl.textContent = next;
    },
    dispose() {},
  };
}

/**
 * Info card with title + paragraphs (bodyKey may resolve to a string or an array).
 * Collapsible via <details> so it stays out of the way on small screens.
 */
export function createInfoCard({ titleKey, bodyKey, open = true }) {
  const details = el('details', 'lp-info');
  if (open) details.open = true;
  const summary = el('summary', 'lp-info__summary');
  const heading = bindText(el('span', 'lp-info__title'), titleKey);
  summary.append(heading);
  const body = el('div', 'lp-info__body');
  details.append(summary, body);

  const render = () => {
    body.replaceChildren();
    const value = t(bodyKey);
    for (const paragraph of Array.isArray(value) ? value : [value]) {
      const p = el('p');
      p.textContent = paragraph;
      body.append(p);
    }
  };
  render();
  const unsub = onLanguageChange(render);
  return { el: details, dispose: unsub };
}

/** Small status pill / notice, e.g. reduced-motion hint. */
export function createNotice({ textKey, tone = 'info' }) {
  const box = el('div', `lp-notice lp-notice--${tone}`, { role: 'status' });
  box.append(bindText(el('span'), textKey));
  return { el: box, dispose() {} };
}

/** Full-screen message (errors, WebGL fallback). */
export function createMessage({ titleKey, bodyKey, actions = [] }) {
  const wrap = el('div', 'lp-message', { role: 'alert' });
  const card = el('div', 'lp-message__card');
  card.append(bindText(el('h2', 'lp-message__title'), titleKey), bindText(el('p', 'lp-message__body'), bodyKey));
  if (actions.length) {
    const row = el('div', 'lp-message__actions');
    actions.forEach((a) => row.append(a.el ?? a));
    card.append(row);
  }
  wrap.append(card);
  return { el: wrap, dispose() {} };
}
