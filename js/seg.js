// Segmented button group: a select replacement. `el` holds <button data-v="..."> children; the group exposes
// `.value` (get/set) and fires a bubbling 'change' event on user clicks, so it drops in where a <select> was.
export function seg(el) {
  const btns = () => [...el.querySelectorAll('button[data-v]')];
  const show = (v) => btns().forEach((b) => { const on = b.dataset.v === String(v); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  let value = (btns().find((b) => b.classList.contains('on')) ?? btns()[0])?.dataset.v;
  Object.defineProperty(el, 'value', { get: () => value, set: (v) => { if (btns().some((b) => b.dataset.v === String(v))) { value = String(v); show(value); } } });
  el.addEventListener('click', (e) => {
    const b = e.target.closest?.('button[data-v]');
    if (!b || b.dataset.v === value) return;
    el.value = b.dataset.v; el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  el.setAttribute('role', 'group'); show(value);
  return el;
}
