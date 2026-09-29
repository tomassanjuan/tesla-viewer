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
$('helpBtn').onclick = () => { $('help').hidden = !$('help').hidden; };
sync();
