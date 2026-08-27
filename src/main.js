/**
 * Entry point: renders the app shell (header with language toggle) and a tiny
 * hash router that loads either the overview page or a simulation module.
 *
 * Routes:  #/            overview
 *          #/sim/<id>    simulation
 */
import './style.css';
import { t, setLanguage, getLanguage, onLanguageChange, applyTranslations, bindText, bindAttr, LANGUAGES } from './lib/i18n.js';
import { el, createMessage, createButton } from './lib/ui.js';
import { isWebGLAvailable } from './lib/webgl.js';
import { simulations, findSimulation } from './sims/index.js';

const app = document.getElementById('app');
let disposeCurrentPage = null;

// ---------- shell ------------------------------------------------------------
function renderShell() {
  const skip = bindText(el('a', 'lp-skip', { href: '#main' }), 'app.skipToContent');

  const header = el('header', 'lp-header');
  const brand = el('a', 'lp-brand', { href: '#/' });
  const logo = el('img', 'lp-brand__logo', { src: './favicon.svg', alt: '', width: 26, height: 26 });
  brand.append(logo, bindText(el('span'), 'app.title'), bindText(el('span', 'lp-brand__sub'), 'app.tagline'));

  const nav = el('nav', 'lp-header__nav');
  const back = el('a', 'lp-header__back', { href: '#/', hidden: true });
  back.append(bindText(el('span', 'lp-header__back-text'), 'app.backToOverview'));
  back.prepend('← ');
  bindAttr(back, { 'aria-label': 'app.backToOverview' });
  nav.append(back, createLanguageToggle());
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

// ---------- pages ------------------------------------------------------------
function renderHome(main) {
  const page = el('section', 'lp-home');
  page.append(bindText(el('h1', 'lp-home__heading'), 'home.heading'), bindText(el('p', 'lp-home__intro'), 'home.intro'));

  const grid = el('div', 'lp-grid');
  for (const sim of simulations) {
    const card = el('a', 'lp-card', { href: `#/sim/${sim.id}` });
    const icon = el('div', 'lp-card__icon', { 'aria-hidden': 'true' });
    icon.textContent = sim.icon ?? '✦';
    card.append(
      icon,
      bindText(el('h2', 'lp-card__title'), sim.titleKey),
      bindText(el('p', 'lp-card__desc'), sim.descriptionKey),
      bindText(el('span', 'lp-card__cta'), 'home.open'),
    );
    grid.append(card);
  }
  page.append(grid);
  main.append(page);

  const footer = el('footer', 'lp-footer');
  footer.append(bindText(el('span'), 'app.footer'));
  main.append(footer);

  document.title = t('app.title');
  return () => {
    page.remove();
    footer.remove();
  };
}

async function renderSimulation(main, id) {
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
