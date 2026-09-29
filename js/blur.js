// Manual privacy blur: regions per camera (normalized to the video frame), active in [t0,t1] on the event timeline.
// Rendered live on a per-tile overlay canvas and burned into exports via drawBlurs().
// ponytail: regions live in memory only (not persisted across reloads).

// ---------- pure geometry ----------
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Drag corners (px within a W x H box) -> normalized {x,y,w,h}, or null if smaller than min (fraction). */
export function normRect(x0, y0, x1, y1, W, H, min = 0.01) {
  if (!(W > 0 && H > 0)) return null;
  const a = clamp01(Math.min(x0, x1) / W), b = clamp01(Math.min(y0, y1) / H);
  const c = clamp01(Math.max(x0, x1) / W), d = clamp01(Math.max(y0, y1) / H);
  return c - a < min || d - b < min ? null : { x: a, y: b, w: c - a, h: d - b };
}
/** Is normalized point (px,py) inside region r? */
export const hit = (r, px, py) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
/** Region enabled and t within [t0,t1] (t1 null/undefined = to the end). */
export const activeAt = (r, t) => r.on !== false && t >= (r.t0 ?? 0) && (r.t1 == null || t <= r.t1);
/** Largest rect of aspect vw:vh centered in a tw x th box (object-fit: contain). */
export function contentRect(tw, th, vw, vh) {
  if (!(vw > 0 && vh > 0 && tw > 0 && th > 0)) return null;
  const k = Math.min(tw / vw, th / vh), w = vw * k, h = vh * k;
  return { x: (tw - w) / 2, y: (th - h) / 2, w, h };
}
/** Pixelate block math: downscaled size so each block is ~`block` output px (min 1x1). */
export const pixelSize = (w, h, block = 12) => ({ w: Math.max(1, Math.round(w / block)), h: Math.max(1, Math.round(h / block)) });

// ---------- state ----------
let getState = null, enabled = true, drawMode = false, seq = 0, ui = null;
const store = new Map();                       // event name -> { cam -> [region] }
const evKey = () => getState?.().ev?.e?.name ?? '';
const byCam = () => { const k = evKey(); if (!store.has(k)) store.set(k, {}); return store.get(k); };
const regionsOf = (cam) => byCam()[cam] ?? [];

let scratch = null;
/** Pixelate regions of camId over the video drawn at tileRect {x,y,w,h} in ctx; t = event time (s). Safe to call always. */
export function drawBlurs(ctx, camId, tileRect, videoEl, t) {
  if (!enabled || !tileRect || !videoEl?.videoWidth) return;
  const list = regionsOf(camId).filter((r) => activeAt(r, t));
  if (!list.length) return;
  const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
  scratch ??= document.createElement('canvas');
  const sc = scratch.getContext('2d'), smooth = ctx.imageSmoothingEnabled;
  for (const r of list) {
    const dx = tileRect.x + r.x * tileRect.w, dy = tileRect.y + r.y * tileRect.h, dw = r.w * tileRect.w, dh = r.h * tileRect.h;
    const { w, h } = pixelSize(dw, dh);
    scratch.width = w; scratch.height = h;
    sc.drawImage(videoEl, r.x * vw, r.y * vh, r.w * vw, r.h * vh, 0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scratch, 0, 0, w, h, dx, dy, dw, dh);
  }
  ctx.imageSmoothingEnabled = smooth;
}

// ---------- UI ----------
const CSS = `.blur-cv{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3}
.blur-cv.blur-draw{pointer-events:auto;cursor:crosshair}
.blur-panel{font:13px system-ui,sans-serif;padding:8px;display:grid;gap:6px;max-height:40vh;overflow:auto}
.blur-panel[hidden]{display:none}.blur-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.blur-row input[type=number]{width:5em}`;

function attach(tile) {
  const cv = document.createElement('canvas'); cv.className = 'blur-cv'; tile.append(cv);
  cv.classList.toggle('blur-draw', drawMode);
  const cam = tile._cam, vid = tile.querySelector('video'); let drag = null;
  const pos = (e) => { const b = cv.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  cv.onpointerdown = (e) => { if (!drawMode) return; e.stopPropagation(); cv.setPointerCapture(e.pointerId); const [x, y] = pos(e); drag = { x0: x, y0: y, x1: x, y1: y }; };
  cv.onpointermove = (e) => { if (drag) [drag.x1, drag.y1] = pos(e); };
  cv.onpointerup = (e) => {
    if (!drag) return; e.stopPropagation();
    const c = contentRect(cv.clientWidth, cv.clientHeight, vid.videoWidth, vid.videoHeight);
    if (c) { // tile px -> content-normalized
      const r = normRect(drag.x0 - c.x, drag.y0 - c.y, drag.x1 - c.x, drag.y1 - c.y, c.w, c.h);
      if (r) { (byCam()[cam] ??= []).push({ id: ++seq, ...r, t0: 0, t1: null, on: true }); renderList(); }
    }
    drag = null;
  };
  tile.addEventListener('click', (e) => { if (drawMode) e.stopPropagation(); }, true);
  tile._blur = { cv, vid, cam, get drag() { return drag; } };
}

function frame() {
  const st = getState?.(), t = st?.ev ? st.globalTime() : 0;
  for (const tile of document.querySelectorAll('.cam')) {
    if (!tile._cam) continue;
    if (!tile._blur) attach(tile);
    const { cv, vid, cam, drag } = tile._blur;
    const active = drag || (enabled && regionsOf(cam).length);
    if (!active && tile._blurClean) continue; // nothing to draw: skip canvas work and layout reads
    tile._blurClean = !active;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const x = cv.getContext('2d'); x.clearRect(0, 0, w, h);
    const c = st?.ev && contentRect(w, h, vid.videoWidth, vid.videoHeight);
    if (c) drawBlurs(x, cam, c, vid, t);
    if (drag) { x.strokeStyle = '#e31937'; x.lineWidth = 2; x.strokeRect(drag.x0, drag.y0, drag.x1 - drag.x0, drag.y1 - drag.y0); }
  }
  requestAnimationFrame(frame);
}

function renderList() {
  if (!ui) return;
  const st = getState?.(), rows = ui.list; rows.innerHTML = '';
  for (const [cam, arr] of Object.entries(byCam())) for (const r of arr) {
    const d = document.createElement('div'); d.className = 'blur-row';
    d.innerHTML = `<input type="checkbox" ${r.on ? 'checked' : ''} aria-label="Toggle region"><span>${cam}</span>
      <input type="number" min="0" step="1" value="${Math.round(r.t0)}" aria-label="Start s"> – <input type="number" min="0" step="1" value="${Math.round(r.t1 ?? st?.ev?.total ?? 0)}" aria-label="End s"><button type="button">Delete</button>`;
    const [on, a, b] = d.querySelectorAll('input');
    on.onchange = () => (r.on = on.checked);
    a.onchange = () => (r.t0 = Math.max(0, +a.value || 0));
    b.onchange = () => (r.t1 = +b.value >= r.t0 ? +b.value : null);
    d.querySelector('button').onclick = () => { arr.splice(arr.indexOf(r), 1); renderList(); };
    rows.append(d);
  }
  if (!rows.children.length) rows.textContent = 'Drag on a camera tile to add a blur region.';
}

async function autoDetect() { // experimental; silently does nothing on failure
  try {
    const st = getState(); if (!st.ev) return;
    const cam = st.focusCam, v = st.vids[cam], t = st.globalTime();
    const found = await new window.TextDetector().detect(v);
    for (const f of found) {
      const b = f.boundingBox, r = normRect(b.x, b.y, b.x + b.width, b.y + b.height, v.videoWidth, v.videoHeight);
      if (r) (byCam()[cam] ??= []).push({ id: ++seq, ...r, t0: Math.max(0, t - 1), t1: t + 1, on: true });
    }
    renderList();
  } catch { /* unsupported or failed: ignore */ }
}

/** getState: () => {ev, vids, focusCam, globalTime}. Call once from app.js. */
export function init(state) {
  getState = state;
  if (typeof document === 'undefined') return;
  document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));
  const dock = document.getElementById('extras-dock') ?? document.body;
  const stage = document.getElementById('extras-stage') ?? document.body;
  const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'blur-btn', textContent: 'Blur' });
  const panel = Object.assign(document.createElement('div'), { className: 'blur-panel', hidden: true });
  panel.innerHTML = `<label class="blur-row"><input type="checkbox" checked> Privacy blur</label><div class="blur-list"></div>`;
  const tog = panel.querySelector('input'); ui = { list: panel.querySelector('.blur-list') };
  tog.onchange = () => (enabled = tog.checked);
  if ('TextDetector' in window) {
    const d = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Auto-detect text (experimental)' });
    d.onclick = autoDetect; panel.insertBefore(d, ui.list);
  }
  btn.onclick = () => {
    drawMode = panel.hidden; panel.hidden = !panel.hidden; btn.setAttribute('aria-pressed', drawMode);
    for (const t of document.querySelectorAll('.cam')) t._blur?.cv.classList.toggle('blur-draw', drawMode);
    renderList();
  };
  dock.append(btn); stage.append(panel);
  requestAnimationFrame(frame);
}
