/**
 * Tiny i18n helper.
 *
 * - t(key, params)      → translated string (dot-path lookup, {param} interpolation)
 * - tList(key)          → translated array (e.g. paragraphs)
 * - setLanguage(lang)   → switch language, persist, re-apply DOM bindings, notify listeners
 * - getLanguage()       → current language code ('en' | 'de')
 * - onLanguageChange(cb)→ subscribe; returns unsubscribe function
 * - applyTranslations() → update all elements with data-i18n / data-i18n-attr bindings
 * - formatNumber(n)     → locale-aware number formatting
 *
 * DOM bindings:
 *   <span data-i18n="app.title"></span>
 *   <button data-i18n-attr="aria-label:panel.collapse;title:panel.collapse"></button>
 */
import en from '../i18n/en.json';
import de from '../i18n/de.json';

export const STORAGE_KEY = 'lp-lang';
export const LANGUAGES = ['en', 'de'];
const FALLBACK = 'en';
const LOCALES = { en: 'en-US', de: 'de-DE' };

const dictionaries = { en, de };
const listeners = new Set();
const formatterCache = new Map();

let current = detectLanguage();

function detectLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (LANGUAGES.includes(stored)) return stored;
  } catch {
    /* localStorage unavailable (privacy mode) – fall through to navigator */
  }
  const nav = (navigator.language || navigator.userLanguage || FALLBACK).toLowerCase();
  return nav.startsWith('de') ? 'de' : 'en';
}

function lookup(dict, key) {
  return key.split('.').reduce((node, part) => (node != null ? node[part] : undefined), dict);
}

function interpolate(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

/** Translate a key. Falls back to English, then to the key itself. */
export function t(key, params) {
  let value = lookup(dictionaries[current], key);
  if (value === undefined) value = lookup(dictionaries[FALLBACK], key);
  if (value === undefined) {
    console.warn(`[i18n] Missing key: ${key}`);
    return key;
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(String(v), params));
  return interpolate(String(value), params);
}

/** Translate a key that resolves to an array (e.g. paragraphs). Always returns an array. */
export function tList(key) {
  const v = t(key);
  return Array.isArray(v) ? v : [v];
}

export function getLanguage() {
  return current;
}

export function getLocale() {
  return LOCALES[current] || LOCALES[FALLBACK];
}

export function setLanguage(lang) {
  if (!LANGUAGES.includes(lang) || lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore persistence failure */
  }
  document.documentElement.lang = lang;
  applyTranslations(document);
  for (const cb of listeners) {
    try {
      cb(lang);
    } catch (err) {
      console.error('[i18n] listener failed', err);
    }
  }
}

export function onLanguageChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Apply translations to all bound elements under root. */
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.dataset.i18nAttr.split(';').forEach((pair) => {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });
}

/** Bind an element's text content to a key (also sets it immediately). */
export function bindText(el, key) {
  el.dataset.i18n = key;
  el.textContent = t(key);
  return el;
}

/** Bind one or more attributes to keys: bindAttr(el, { 'aria-label': 'panel.collapse' }). */
export function bindAttr(el, map) {
  const existing = el.dataset.i18nAttr ? el.dataset.i18nAttr.split(';') : [];
  const merged = new Map(existing.map((p) => p.split(':').map((s) => s.trim())));
  for (const [attr, key] of Object.entries(map)) {
    merged.set(attr, key);
    el.setAttribute(attr, t(key));
  }
  el.dataset.i18nAttr = [...merged].map(([a, k]) => `${a}:${k}`).join(';');
  return el;
}

/** Locale-aware number formatting. */
export function formatNumber(value, { minimumFractionDigits = 0, maximumFractionDigits = 1 } = {}) {
  const cacheKey = `${current}|${minimumFractionDigits}|${maximumFractionDigits}`;
  let fmt = formatterCache.get(cacheKey);
  if (!fmt) {
    fmt = new Intl.NumberFormat(getLocale(), { minimumFractionDigits, maximumFractionDigits });
    formatterCache.set(cacheKey, fmt);
  }
  return fmt.format(value);
}

/** Initialise <html lang> on first import. */
document.documentElement.lang = current;
