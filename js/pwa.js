// Service worker registration + '?' shortcut help overlay.
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

const help = document.getElementById('help');
document.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (e.key === '?') help.hidden = !help.hidden;
  else if (e.key === 'Escape') help.hidden = true;
});
