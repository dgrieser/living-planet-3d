/**
 * Entry point: renders the app shell (header with language toggle) and a tiny
 * hash router that loads either the overview page or a simulation module.
 *
 * Routes:  #/            overview
 *          #/sim/<id>    simulation
 */
import './style.css';
import { t, setLanguage, getLanguage, onLanguageChange, applyTranslations, bindText, bindAttr, LANGUAGES } from './lib/i18n.js';
import { el, createIcon, createMessage, createButton } from './lib/ui.js';
import { isWebGLAvailable } from './lib/webgl.js';
import { listSimulations, findSimulation } from './sims/index.js';

const app = document.getElementById('app');
let disposeCurrentPage = null;

// Work-in-progress simulations are kept off the overview grid; the header toggle lists them again.
const HIDDEN_STORAGE_KEY = 'lp-show-wip';
let showHidden = readShowHidden();

function readShowHidden() {
  try {
    return localStorage.getItem(HIDDEN_STORAGE_KEY) === '1';
  } catch {
    /* localStorage unavailable (privacy mode) – stay in memory */
    return false;
  }
}
function writeShowHidden(value) {
  try {
    localStorage.setItem(HIDDEN_STORAGE_KEY, value ? '1' : '0');
  } catch {
    /* ignore persistence failure */
  }
}

// ---------- shell ------------------------------------------------------------
function renderShell() {
  const skip = bindText(el('a', 'lp-skip', { href: '#main' }), 'app.skipToContent');

  const header = el('header', 'lp-header');
  const brand = el('a', 'lp-brand', { href: '#/' });
  const logo = el('img', 'lp-brand__logo', { src: './favicon.svg', alt: '', width: 26, height: 26 });
  brand.append(logo, bindText(el('span'), 'app.title'), bindText(el('span', 'lp-brand__sub'), 'app.tagline'));

  const nav = el('nav', 'lp-header__nav');
  // icon only: the house is the way back to the overview on every simulation page
  const back = el('a', 'lp-icon-btn lp-header__back', { href: '#/', hidden: true });
  back.append(createIcon('home'), bindText(el('span', 'visually-hidden'), 'app.backToOverview'));
  bindAttr(back, { 'aria-label': 'app.backToOverview', title: 'app.backToOverview' });
  nav.append(back, createLanguageToggle(), createHiddenToggle());
  header.append(brand, nav);

  const main = el('main', 'lp-main', { id: 'main', tabindex: '-1' });
  app.append(skip, header, main);
  return { main, back };
}

function createLanguageToggle() {
  const wrap = el('div', 'lp-lang', { role: 'group' });
  bindAttr(wrap, { 'aria-label': 'app.language' });
  const buttons = LANGUAGES.map((lang, i) => {
    const btn = el('button', 'lp-lang__btn', { type: 'button', lang });
    btn.textContent = lang.toUpperCase();
    bindAttr(btn, { 'aria-label': lang === 'de' ? 'app.switchToDe' : 'app.switchToEn' });
    btn.addEventListener('click', () => setLanguage(lang));
    if (i > 0) {
      const sep = el('span', 'lp-lang__sep', { 'aria-hidden': 'true' });
      sep.textContent = '|';
      wrap.append(sep);
    }
    wrap.append(btn);
    return btn;
  });
  const sync = () => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('lang') === getLanguage())));
  onLanguageChange(sync);
  sync();
  return wrap;
}

/** Tiny header button that lists / unlists the work-in-progress simulations on the overview. */
function createHiddenToggle() {
  const btn = el('button', 'lp-icon-btn lp-wip-toggle', { type: 'button' });
  btn.textContent = '⚗';
  const sync = () => {
    btn.setAttribute('aria-pressed', String(showHidden));
    bindAttr(btn, { 'aria-label': showHidden ? 'app.hideWip' : 'app.showWip', title: showHidden ? 'app.hideWip' : 'app.showWip' });
    applyTranslations(btn);
  };
  btn.addEventListener('click', () => {
    showHidden = !showHidden;
    writeShowHidden(showHidden);
    sync();
    if (parseRoute().name === 'home') route(shell); // relist the grid
  });
  onLanguageChange(sync);
  sync();
  return btn;
}

// ---------- pages ------------------------------------------------------------
function renderHome(main) {
  const page = el('section', 'lp-home');
  page.append(bindText(el('h1', 'lp-home__heading'), 'home.heading'), bindText(el('p', 'lp-home__intro'), 'home.intro'));

  const grid = el('div', 'lp-grid');
  for (const sim of listSimulations({ includeHidden: showHidden })) {
    const card = el('a', 'lp-card', { href: `#/sim/${sim.id}` });
    const icon = el('div', 'lp-card__icon', { 'aria-hidden': 'true' });
    icon.textContent = sim.icon ?? '✦';
    card.append(
      icon,
      bindText(el('h2', 'lp-card__title'), sim.titleKey),
      bindText(el('p', 'lp-card__desc'), sim.descriptionKey),
      bindText(el('span', 'lp-card__cta'), 'home.open'),
    );
    if (sim.hidden) card.prepend(bindText(el('span', 'lp-card__badge'), 'home.workInProgress'));
    grid.append(card);
  }
  page.append(grid);
  main.append(page);

  const footer = el('footer', 'lp-footer');
  const credit = el('a', 'lp-footer__credit', { href: 'https://www.solarsystemscope.com/textures/', target: '_blank', rel: 'noopener noreferrer license' });
  footer.append(bindText(el('span'), 'app.footer'), el('br'), bindText(credit, 'app.footerCredit'));
  main.append(footer);

  document.title = t('app.title');
  return () => {
    page.remove();
    footer.remove();
  };
}

/** Former simulation ids that now live on under another id (keeps published deep links working). */
const ROUTE_ALIASES = Object.freeze({ seasons: 'axial-tilt' });

async function renderSimulation(main, id) {
  if (ROUTE_ALIASES[id]) {
    location.replace(`#/sim/${ROUTE_ALIASES[id]}`);
    return () => {};
  }
  const sim = findSimulation(id);
  if (!sim) return renderError(main, 'errors.notFoundTitle', 'errors.notFoundBody');
  if (!isWebGLAvailable()) return renderError(main, 'errors.webglTitle', 'errors.webglBody');

  const page = el('section', 'lp-sim');
  const loading = el('div', 'lp-loading');
  loading.append(bindText(el('span'), 'app.loading'));
  page.append(loading);
  main.append(page);

  const updateTitle = () => {
    document.title = `${t(sim.titleKey)} · ${t('app.title')}`;
  };
  const unsubTitle = onLanguageChange(updateTitle);
  updateTitle();

  let disposeSim = null;
  let cancelled = false;
  try {
    const mod = await sim.load();
    if (cancelled) return () => {};
    loading.remove();
    disposeSim = await mod.default(page, sim);
  } catch (err) {
    console.error(`[living-planet] failed to load simulation "${id}"`, err);
    loading.remove();
    if (!cancelled) {
      const msg = createMessage({ titleKey: 'errors.loadFailedTitle', bodyKey: 'errors.loadFailedBody' });
      page.append(msg.el);
    }
  }
  return () => {
    cancelled = true;
    unsubTitle();
    if (typeof disposeSim === 'function') disposeSim();
    page.remove();
  };
}

function renderError(main, titleKey, bodyKey) {
  const page = el('section', 'lp-home');
  const home = createButton({ labelKey: 'app.backToOverview', variant: 'primary', onClick: () => (location.hash = '#/') });
  const msg = createMessage({ titleKey, bodyKey, actions: [home] });
  page.append(msg.el);
  main.append(page);
  document.title = `${t(titleKey)} · ${t('app.title')}`;
  return () => page.remove();
}

// ---------- router -------------------------------------------------------------
function parseRoute() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const match = hash.match(/^\/sim\/([\w-]+)\/?$/);
  if (match) return { name: 'sim', id: match[1] };
  return { name: 'home' };
}

async function route({ main, back }) {
  if (typeof disposeCurrentPage === 'function') disposeCurrentPage();
  disposeCurrentPage = null;
  main.replaceChildren();
  const r = parseRoute();
  back.hidden = r.name === 'home';
  disposeCurrentPage = r.name === 'sim' ? await renderSimulation(main, r.id) : renderHome(main);
  applyTranslations(main);
}

const shell = renderShell();
// Keep the document title in sync with the language on the home page.
onLanguageChange(() => {
  if (parseRoute().name === 'home') document.title = t('app.title');
});
window.addEventListener('hashchange', () => route(shell));
route(shell);
