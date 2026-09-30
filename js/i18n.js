// i18n without a build step. Keys are the English strings (js/locales/en.js). Static markup is translated at
// runtime by matching trimmed text nodes / title, placeholder, aria-label attributes; JS strings go through t().
import en from './locales/en.js';
import { seg } from './seg.js';

export const LANGS = { en: 'English', es: 'Español', de: 'Deutsch', fr: 'Français', pt: 'Português', it: 'Italiano', nl: 'Nederlands', pl: 'Polski', ja: '日本語', zh: '中文' };
const ATTRS = ['title', 'placeholder', 'aria-label'];
let dict = en, lang = 'en';
const orig = new WeakMap();   // text node -> English text; element -> {attr: English}

/** Translate key (falls back to English, then the key itself); {name} placeholders filled from vars. */
export function t(key, vars) {
  const s = dict[key] ?? en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
}
export const getLang = () => lang;

export function detect() {
  let saved; try { saved = localStorage.getItem('lang'); } catch {}
  if (saved in LANGS) return saved;
  const ls = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const l of ls) { const c = String(l).toLowerCase().split('-')[0]; if (c in LANGS) return c; }
  return 'en';
}

const tr = (s) => dict[s] ?? en[s] ?? s;
function applyNode(n) {
  if (n.nodeType === 3) {
    const o = orig.get(n) ?? n.data, k = o.trim();
    if (!k) return;
    const v = tr(k);
    if (v !== k || orig.has(n)) { orig.set(n, o); n.data = o.replace(k, () => v); }
  } else if (n.nodeType === 1) {
    for (const a of ATTRS) if (n.hasAttribute(a)) {
      const m = orig.get(n) ?? {}, o = m[a] ?? n.getAttribute(a), k = o.trim(), v = tr(k);
      if (v !== k || a in m) { m[a] = o; orig.set(n, m); n.setAttribute(a, o.replace(k, () => v)); }
    }
  }
}
export function apply(root = document.documentElement) {
  applyNode(root);
  const w = document.createTreeWalker(root, 5); // SHOW_ELEMENT | SHOW_TEXT
  for (let n = w.nextNode(); n; n = w.nextNode()) applyNode(n);
}

/** Switch language (en reverts to the source strings). Persists the choice unless persist=false. */
export async function setLang(l, persist = true) {
  if (!(l in LANGS)) l = 'en';
  dict = l === 'en' ? en : (await import(`./locales/${l}.js`)).default;
  lang = l;
  if (persist) try { localStorage.setItem('lang', l); } catch {}
  if (typeof document !== 'undefined') { document.documentElement.lang = l; apply(); document.dispatchEvent(new CustomEvent('langchange')); }
}

if (typeof document !== 'undefined') {
  const sel = document.createElement('div'); sel.id = 'lang'; sel.className = 'seg'; sel.setAttribute('aria-label', 'Language');
  for (const [k, v] of Object.entries(LANGS)) { const b = Object.assign(document.createElement('button'), { type: 'button', textContent: k.toUpperCase(), title: v }); b.dataset.v = k; sel.append(b); }
  seg(sel);
  sel.onchange = () => setLang(sel.value);
  (document.getElementById('mbar') ?? document.body).append(sel);
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) apply(n); })
    .observe(document.documentElement, { childList: true, subtree: true });
  const l = detect();
  await setLang(l, false); sel.value = l;
}
