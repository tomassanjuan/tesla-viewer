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
// phone: library is a slide-over drawer (menu button / scrim / Esc / picking an event closes it)
const drawer = (open) => { root.classList.toggle('side-open', open); $('menuBtn').setAttribute('aria-expanded', String(open)); };
$('menuBtn').onclick = () => drawer(!root.classList.contains('side-open'));
$('scrim').onclick = () => drawer(false);
$('events').addEventListener('click', () => drawer(false));
addEventListener('keydown', (e) => { if (e.key === 'Escape') drawer(false); });
$('helpBtn').onclick = () => { $('help').hidden = !$('help').hidden; };
sync();
