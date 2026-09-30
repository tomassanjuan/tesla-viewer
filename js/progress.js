// One shared busy indicator: a card centered mid-screen while anything loads (click-through, phone/safe-area aware).
// task = busy.begin(label, total?) -> { set(done, total?, label?), end() }. No total => indeterminate.

/** Pure state: tracks concurrent tasks; the newest one is shown. render(view|null) is called on every change. */
export function createBusy(render = () => {}) {
  const tasks = new Set();
  const view = () => {
    const k = [...tasks].at(-1);
    if (!k) return null;
    return { label: k.label, done: k.done, total: k.total, fraction: k.total ? Math.min(1, k.done / k.total) : null, count: tasks.size };
  };
  const emit = () => render(view());
  return {
    view,
    begin(label, total = 0) {
      const k = { label, total, done: 0 };
      tasks.add(k); emit();
      return {
        set(done, t = k.total, l = k.label) { k.done = done; k.total = t; k.label = l; if (tasks.has(k)) emit(); },
        end() { if (tasks.delete(k)) emit(); },
      };
    },
    /** Run fn(task) with a task that always ends, even on throw. */
    async run(label, total, fn) { const k = this.begin(label, total); try { return await fn(k); } finally { k.end(); } },
  };
}

/** DOM overlay: #busy fills the viewport (click-through) and centers a card with a label and a bar. */
export function mountBusy(doc = document) {
  const box = doc.createElement('div'); box.id = 'busy'; box.hidden = true;
  box.setAttribute('role', 'progressbar'); box.setAttribute('aria-live', 'polite');
  const label = doc.createElement('span'), fill = doc.createElement('i');
  const track = doc.createElement('div'); track.className = 'busy-track'; track.append(fill);
  const card = doc.createElement('div'); card.className = 'busy-card'; card.append(label, track);
  box.append(card); doc.body.append(box);
  return createBusy((v) => {
    box.hidden = !v;
    if (!v) return;
    const pct = v.fraction == null ? null : Math.round(v.fraction * 100);
    // total 1 = fractional task (shown as %), total > 1 = counted task (done/total), no total = indeterminate
    label.textContent = v.total === 1 ? `${v.label} ${pct}%` : v.total ? `${v.label} ${v.done}/${v.total}` : v.label;
    box.classList.toggle('indet', pct == null);
    fill.style.width = pct == null ? '' : `${pct}%`;
    if (pct == null) box.removeAttribute('aria-valuenow'); else box.setAttribute('aria-valuenow', pct);
    box.setAttribute('aria-valuemin', 0); box.setAttribute('aria-valuemax', 100); box.setAttribute('aria-label', v.label);
  });
}
