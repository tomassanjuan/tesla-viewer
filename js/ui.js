import { clampSide, SIDE_DEFAULT, SIDE_KEY } from './sidew.js';
// Chrome-only UI: theme toggle, sidebar collapse, help button. No app logic here.
const root = document.documentElement, $ = (id) => document.getElementById(id);
const save = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const dark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : !matchMedia('(prefers-color-scheme: light)').matches);
const sync = () => $('themeToggle').setAttribute('aria-pressed', String(!dark()));
$('themeToggle').onclick = () => {
  root.dataset.theme = dark() ? 'light' : 'dark'; save('tv-theme', root.dataset.theme); sync();
  dispatchEvent(new Event('themechange'));
};
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => dispatchEvent(new Event('themechange')));
$('sideToggle').onclick = () => save('tv-side', root.classList.toggle('side-off') ? '0' : '1');
// desktop: drag / arrow keys / double-click the handle on the sidebar edge to resize (width persists)
const handle = $('sideResize'), setW = (w, persist) => {
  const c = clampSide(w, innerWidth); root.style.setProperty('--side-w', c + 'px'); handle.setAttribute('aria-valuenow', String(c));
  if (persist) save(SIDE_KEY, c); return c;
};
const curW = () => $('side').getBoundingClientRect().width;
try { setW(localStorage.getItem(SIDE_KEY) ?? SIDE_DEFAULT); } catch { setW(SIDE_DEFAULT); }
handle.onpointerdown = (e) => {
  handle.setPointerCapture(e.pointerId); handle.classList.add('drag'); root.classList.add('resizing'); e.preventDefault();
};
handle.onpointermove = (e) => { if (handle.hasPointerCapture(e.pointerId)) setW(e.clientX, false); };
handle.onpointerup = handle.onpointercancel = (e) => {
  if (!handle.hasPointerCapture(e.pointerId)) return;
  handle.classList.remove('drag'); root.classList.remove('resizing'); setW(curW(), true); dispatchEvent(new Event('resize'));
};
handle.ondblclick = () => { setW(SIDE_DEFAULT, false); try { localStorage.removeItem(SIDE_KEY); } catch {} dispatchEvent(new Event('resize')); };
handle.onkeydown = (e) => {
  const d = { ArrowLeft: -16, ArrowRight: 16 }[e.key]; if (!d && e.key !== 'Home') return;
  e.preventDefault(); setW(e.key === 'Home' ? SIDE_DEFAULT : curW() + (e.shiftKey ? 4 * d : d), true); dispatchEvent(new Event('resize'));
};
// phone: library is a slide-over drawer (menu button / scrim / Esc / picking an event closes it)
const drawer = (open) => { root.classList.toggle('side-open', open); $('menuBtn').setAttribute('aria-expanded', String(open)); };
$('menuBtn').onclick = () => drawer(!root.classList.contains('side-open'));
$('scrim').onclick = () => drawer(false);
$('events').addEventListener('click', () => drawer(false));
addEventListener('keydown', (e) => { if (e.key === 'Escape') drawer(false); });
$('helpBtn').onclick = () => { $('help').hidden = !$('help').hidden; };
sync();
