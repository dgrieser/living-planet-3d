/**
 * Shared UI kit. Every component pulls its strings from i18n keys and
 * re-renders on language change. Components return { el, dispose, ... }.
 */
import { t, bindText, bindAttr, onLanguageChange, formatNumber } from './i18n.js';

let idCounter = 0;
const uid = (prefix) => `${prefix}-${++idCounter}`;

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

/**
 * Collapsible control panel.
 *
 * On narrow screens the panel is a bottom sheet, and there its header doubles as a
 * drag handle: press it and pull to resize the sheet anywhere between "closed" and
 * the full height of the canvas, and it stays where it is let go. Releasing close to
 * the default height or to the closed position snaps to it. The toggle button keeps
 * working as a button – a press that starts on it never drags.
 *
 * @param {{ titleKey?: string, collapsedByDefault?: boolean, onToggle?: (collapsed: boolean) => void }} opts
 */
export function createPanel({ titleKey = 'panel.title', collapsedByDefault, onToggle } = {}) {
  const disposers = [];
  const panel = el('aside', 'lp-panel', { 'aria-labelledby': uid('panel-title') });
  const header = el('div', 'lp-panel__header');
  const grip = el('span', 'lp-panel__grip', { 'aria-hidden': 'true' });
  const title = bindText(el('h2', 'lp-panel__title', { id: panel.getAttribute('aria-labelledby') }), titleKey);
  const toggle = el('button', 'lp-panel__toggle', { type: 'button', 'aria-expanded': 'true' });
  toggle.innerHTML = '<span class="lp-panel__chevron" aria-hidden="true"></span>';
  const body = el('div', 'lp-panel__body');
  body.id = uid('panel-body');
  toggle.setAttribute('aria-controls', body.id);

  header.append(grip, title, toggle);
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
    if (drag || !isSheet() || e.button > 0 || e.target.closest('.lp-panel__toggle')) return;
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
    dispose() {
      disposers.forEach((d) => d());
      panel.remove();
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
