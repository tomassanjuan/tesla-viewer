import { groupFiles, groupEvents, tsToDate, CAMS, formatEventInfo, CATEGORIES, EVENT_TYPES, eventType, countBy, filterEvents } from './library.js';
import { init as initInsights } from './insights.js';
import { parseClip, probeSei } from './mp4.js';
import { GEAR, AUTOPILOT, csv } from './sei.js';
import { initExport } from './export.js';
import { init as initBlur } from './blur.js';
import { createMap } from './map.js';
import { createGraph } from './graph.js';
import { t } from './i18n.js';
import { spatialLayout } from './layout.js';
import { parseHeader } from './tesla-crypto.js';
import { initDecryptUi } from './decrypt-ui.js';
import { due, pickDriftFix, shouldPlay, initPerf } from './perf.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const $ = (id) => document.getElementById(id);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const NAMES = { front: 'Front', back: 'Back', left_repeater: 'Left', right_repeater: 'Right', left_pillar: 'L pillar', right_pillar: 'R pillar' };

const map = createMap($('map'));
const graph = createGraph($('graph'), { seek: (t) => ev && seekGlobal(t) });
$('tiles').onchange = (e) => map.setTiles(e.target.checked);
let events = [], ev = null, focusCam = 'front';
const decrypted = new Map();     // original File -> decrypted Blob
const encrypted = new Map();     // original File -> parsed header
const resolve = (f) => decrypted.get(f) ?? f;

// ---------- loading ----------
async function addFiles(list) {
  const items = [...list].map((f) => ({ path: f.webkitRelativePath || f.path || f.name, file: f }));
  for (const { file } of items) {
    if (!/\.mp4$/i.test(file.name)) continue;
    const head = new Uint8Array(await file.slice(0, 0x2000).arrayBuffer());
    try { encrypted.set(file, parseHeader(head, file.size)); } catch (e) { if (e.code === 'TruncatedFile' || e.code === 'UnsupportedVersion') console.warn(file.name, e.message); }
  }
  events = groupFiles(items);
  for (const e of events) if (e.eventJson) { try { const j = JSON.parse(await e.eventJson.text()); e.info = formatEventInfo(j); e.reason = String(j.reason ?? ''); e.city = e.info.city; } catch { /* bad json: ignore */ } }
  filter.category = ''; filter.type = '';
  renderEvents();
  updateCryptUi();
  if (events.length) openEvent(visibleEvents()[0] ?? events[0]);
}

const filter = { category: '', type: '' };
let groupBy = 'day';
const visibleEvents = () => filterEvents(events, filter);

function renderFilters() {
  const CAT_LABEL = { recent: t('Recent'), saved: t('Saved'), sentry: t('Sentry'), loose: t('Loose clips') };
  const TYPE_LABEL = { sentry: t('Sentry trigger'), saved: t('Saved by you'), honk: t('Honk'), other: t('Other') };
  const box = $('cats'); box.innerHTML = '';
  const byCat = countBy(events, (e) => e.category);
  const tabs = [['', t('All'), events.length], ...CATEGORIES.filter((c) => byCat[c]).map((c) => [c, CAT_LABEL[c], byCat[c]])];
  for (const [k, label, n] of tabs) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cat' + (filter.category === k ? ' on' : '');
    b.setAttribute('aria-pressed', filter.category === k); b.textContent = `${label} ${n}`;
    b.onclick = () => { filter.category = k; renderEvents(); };
    box.append(b);
  }
  const tbox = $('evtype'), byType = countBy(filterEvents(events, { category: filter.category }), eventType);
  tbox.innerHTML = '';
  if (!byType[filter.type]) filter.type = '';
  for (const k of EVENT_TYPES) if (byType[k]) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cat' + (filter.type === k ? ' on' : '');
    b.setAttribute('aria-pressed', filter.type === k); b.textContent = `${TYPE_LABEL[k]} ${byType[k]}`;
    b.onclick = () => { filter.type = filter.type === k ? '' : k; renderEvents(); };
    tbox.append(b);
  }
  $('groupby').hidden = !events.length;
}
document.addEventListener('langchange', () => events.length && renderEvents());
$('groupby').onchange = (e) => { groupBy = e.target.value; renderEvents(); };

const thumbUrls = [];
function renderEvents() {
  renderFilters();
  teleObs?.disconnect();
  $('events').innerHTML = '';
  for (const u of thumbUrls.splice(0)) URL.revokeObjectURL(u);
  const shown = visibleEvents();
  if (events.length && !shown.length) { const p = document.createElement('p'); p.className = 'note'; p.textContent = t('No events match this filter.'); $('events').append(p); }
  const renderOne = (e, into) => {
    const d = document.createElement('div'); d.className = 'ev'; d.tabIndex = 0; d.setAttribute('role', 'listitem');
    const nc = new Set(e.segments.flatMap((s) => Object.keys(s.cams))).size;
    d.innerHTML = `<div class="ttl"><b></b></div><span class="when">${e.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${e.segments.length} min</span><span class="badge">${nc} cam${nc === 1 ? '' : 's'}</span>`;
    d.querySelector('b').textContent = e.name;
    const info = [e.info?.reason, e.info?.place].filter(Boolean).join(' · ');
    if (info) { const s = document.createElement('small'); s.textContent = info; d.append(s); }
    if (e.thumb) {
      const u = URL.createObjectURL(e.thumb); thumbUrls.push(u);
      const im = Object.assign(document.createElement('img'), { src: u, alt: '', loading: 'lazy' });
      im.style.cssText = 'display:block;grid-column:1/-1;width:100%;max-width:160px;border-radius:4px;margin-bottom:4px';
      d.prepend(im);
    }
    d.onclick = () => openEvent(e);
    d.onkeydown = (k) => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); openEvent(e); } };
    e._el = d; into.append(d);
    watchTelemetry(e, d);
  };
  for (const g of groupEvents(shown, groupBy)) {
    let into = $('events');
    if (groupBy !== 'none') {
      const h = document.createElement('h3'); h.className = 'evgroup'; h.textContent = groupBy === 'city' && !g.key ? t('Unknown') : g.key;
      const w = document.createElement('div'); w.className = 'evgroup-list'; w.setAttribute('role', 'group'); w.setAttribute('aria-label', h.textContent);
      $('events').append(h, w); into = w;
    }
    g.events.forEach((e) => renderOne(e, into));
  }
}

// Telemetry hint: probe the head of the first front clip once an event scrolls into view; result cached on the event.
const teleObs = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((es) => {
  for (const x of es) if (x.isIntersecting) { teleObs.unobserve(x.target); probeTelemetry(x.target._ev, x.target); }
});
function watchTelemetry(e, el) {
  if (e.telemetry !== undefined) return showTelemetry(e, el);
  el._ev = e; teleObs ? teleObs.observe(el) : probeTelemetry(e, el);
}
function showTelemetry(e, el) {
  if (e.telemetry !== true || el.querySelector('.tele')) return;
  const s = Object.assign(document.createElement('span'), { className: 'tele', textContent: '∿', title: t('Telemetry available') });
  s.setAttribute('role', 'img'); s.setAttribute('aria-label', t('Telemetry available'));
  el.querySelector('.ttl').append(s);
}
async function probeTelemetry(e, el) {
  const f = e.segments[0].cams.front ?? Object.values(e.segments[0].cams)[0];
  if (e.telemetry === undefined && f && !(encrypted.has(f) && !decrypted.has(f))) {
    try { e.telemetry = await probeSei(resolve(f)); } catch { e.telemetry = null; }
  }
  showTelemetry(e, el);
}

// ---------- clip parsing (worker, main-thread fallback) ----------
let worker, jobs = new Map(), jobId = 0;
function parseOffThread(blob) {
  if (typeof Worker === 'undefined') return blob.arrayBuffer().then(parseClip);
  try {
    if (!worker) {
      worker = new Worker(new URL('./telemetry-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => { const j = jobs.get(data.id); jobs.delete(data.id); data.error ? j.rej(new Error(data.error)) : j.res(data.clip); };
      worker.onerror = () => { worker = null; for (const j of jobs.values()) j.rej(new Error('worker failed')); jobs.clear(); };
    }
    return new Promise((res, rej) => { const id = ++jobId; jobs.set(id, { res, rej }); worker.postMessage({ id, blob }); });
  } catch { return blob.arrayBuffer().then(parseClip); }
}

// ---------- event / player ----------
const vids = {};          // cam -> <video>
let segIdx = 0, playing = false, wantPlay = false;

async function openEvent(e) {
  for (const x of events) x._el?.classList.toggle('on', x === e);
  stop();
  const cams = CAMS.filter((c) => e.segments.some((s) => s.cams[c]));
  const segs = e.segments.map((s) => ({ ...s, dur: 0, start: 0 }));
  const samples = [];
  let blocked = 0, t0 = 0, hevc = false, withTel = 0, codec = '', firstErr = '';
  for (const s of segs) {
    s.start = t0;
    const order = [...CAMS.filter((c) => s.cams[c]), ...Object.keys(s.cams).filter((c) => !CAMS.includes(c))];
    if (order.every((c) => encrypted.has(s.cams[c]) && !decrypted.has(s.cams[c]))) { blocked++; s.dur = 60; t0 += 60; continue; }
    let dur = null;
    for (const c of order) {
      const f = s.cams[c];
      if (encrypted.has(f) && !decrypted.has(f)) continue;
      try {
        const p = await parseOffThread(resolve(f));
        codec ||= p.codec; dur ??= p.duration; hevc ||= p.hevc;
        if (p.samples.length) { for (const m of p.samples) samples.push({ ...m, t: m.t + t0 }); withTel++; s.telCam = c; break; }
      } catch (err) { s.err = `${c}: ${err.message}`; firstErr ||= `${s.ts} ${s.err}`; }
    }
    s.dur = dur ?? await probeDuration(resolve(s.cams[order.find((c) => !(encrypted.has(s.cams[c]) && !decrypted.has(s.cams[c])))]));
    t0 += s.dur;
  }
  const diag = { withTelemetry: withTel, total: segs.length, codec, firstError: firstErr };
  const geo = samples.filter((m) => m.lat || m.lon);
  let maxKmh = 1; for (const m of samples) maxKmh = Math.max(maxKmh, m.speedMps * 3.6);
  ev = { e, cams, segs, samples, total: t0, geo, maxKmh, codec, diag };
  focusCam = cams.includes('front') ? 'front' : cams[0];
  buildGrid();
  $('empty').hidden = true;
  $('hud').hidden = !samples.length;
  drawGraph(); drawMap(0);
  insightsRefresh.forEach((f) => f());
  $('status').textContent = hevc && !samples.length ? 'HEVC clip: video plays if your browser supports it; no telemetry found'
    : withTel < segs.length - blocked ? `${withTel}/${segs.length - blocked} clips have telemetry${firstErr ? ` (${firstErr})` : ''}` : '';
  console.info('telemetry', diag);
  if (blocked) $('cryptMsg').textContent = `${blocked} segment(s) are encrypted; open "Encrypted clips" to decrypt.`;
  await loadSeg(0, 0);
}

function probeDuration(blob) {
  return new Promise((res) => {
    const v = document.createElement('video'); v.preload = 'metadata';
    v.onloadedmetadata = () => { res(v.duration || 60); URL.revokeObjectURL(v.src); };
    v.onerror = () => res(60); v.src = URL.createObjectURL(blob);
  });
}

function buildGrid() {
  const g = $('grid'); g.innerHTML = ''; for (const k in vids) delete vids[k];
  for (const c of ev.cams) {
    const d = document.createElement('div'); d.className = 'cam';
    d.innerHTML = `<video muted playsinline preload="auto"></video><span>${NAMES[c]}</span>`;
    d.tabIndex = 0; d.title = d.ariaLabel = `${NAMES[c]}: ${t('Click to enlarge')}`;
    d.onclick = () => toggleFocus(c);
    d.onkeydown = (k) => { if (k.key === 'Enter') toggleFocus(c); };
    d.ondblclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else d.requestFullscreen?.().catch(() => {}); };
    vids[c] = d.querySelector('video'); d._cam = c; g.append(d);
  }
  applyLayout();
}

// click a camera to enlarge it; click the enlarged camera to return to the grid
function toggleFocus(c) {
  const sel = $('layout'), at = master()?.currentTime;
  focusCam = c;
  sel.value = sel.value === 'focus' ? 'auto' : 'focus';
  applyLayout(); resync(at); // hidden tiles are paused in focus layout; re-sync them on any change
}

function applyLayout() {
  const g = $('grid'), focus = $('layout').value === 'focus';
  g.classList.toggle('focus', focus);
  if (focus) { g.style.gridTemplateColumns = '1fr'; g.style.gridTemplateRows = '1fr'; }
  else buildGridTemplate();
  for (const d of g.children) { const p = focus ? null : layout.place[d._cam]; d.style.gridColumn = p ? p.col : ''; d.style.gridRow = p ? p.row : ''; }
  for (const d of g.children) d.classList.toggle('main', d._cam === focusCam);
}
let layout = { place: {} };
function buildGridTemplate() {
  layout = spatialLayout(ev.cams); const g = $('grid');
  g.style.gridTemplateColumns = `repeat(${layout.cols},1fr)`;
  g.style.gridTemplateRows = `repeat(${layout.rows},1fr)`;
}

const solo = () => lowLoad || $('layout').value === 'focus'; // only the focused tile is visible/needed
const master = () => (solo() && vids[focusCam]?.src ? vids[focusCam] : vids[ev.cams.find((c) => vids[c]?.src)] ?? Object.values(vids)[0]);

async function loadSeg(i, at) {
  segIdx = i;
  const s = ev.segs[i];
  await Promise.all(ev.cams.map((c) => new Promise((res) => {
    const v = vids[c], f = s.cams[c];
    if (v.src) URL.revokeObjectURL(v.src);
    if (!f || (encrypted.has(f) && !decrypted.has(f))) { v.removeAttribute('src'); v.load(); return res(); }
    v.onloadedmetadata = () => { v.currentTime = at; v.playbackRate = +$('speed').value; res(); };
    v.onerror = () => res();
    v.src = URL.createObjectURL(resolve(f));
  })));
  if (wantPlay) playAll();
}

let lowLoad = false, lastUi = 0, lastDrift = 0, lastHud = '';
const UI_HZ = 12, DRIFT_MS = 500;
// bring paused/hidden tiles back to the master's time and apply play state (after solo mode changes)
function resync(at = master()?.currentTime) { if (at != null) for (const v of Object.values(vids)) if (v.src && Math.abs(v.currentTime - at) > 0.05) v.currentTime = at; syncPlayState(); }
const syncPlayState = () => { for (const [c, v] of Object.entries(vids)) { if (!v.src) continue; if (playing && shouldPlay(c, focusCam, solo())) v.play().catch(() => {}); else v.pause(); } };
function playAll() { playing = true; $('play').classList.add('is-playing'); syncPlayState(); requestAnimationFrame(tick); }
function pauseAll() { playing = false; $('play').classList.remove('is-playing'); for (const v of Object.values(vids)) v.pause(); }
function stop() { wantPlay = false; if (ev) pauseAll(); }

// the master must keep playing, so in low-load mode it is the focused camera
function globalTime() { const m = master(); return ev.segs[segIdx].start + (m?.currentTime ?? 0); }

async function tick() {
  if (!ev || !playing) return;
  const m = master(), s = ev.segs[segIdx];
  const now = performance.now();
  if (!solo() && now - lastDrift > DRIFT_MS) {
    lastDrift = now;
    const fix = pickDriftFix(Object.entries(vids).filter(([, v]) => v !== m && v.src).map(([id, v]) => ({ id, time: v.currentTime, paused: v.paused, seeking: v.seeking })), m.currentTime);
    if (fix) vids[fix].currentTime = m.currentTime;
  }
  if (m.ended || m.currentTime >= s.dur - 0.03) {
    if (segIdx + 1 < ev.segs.length) { wantPlay = true; await loadSeg(segIdx + 1, 0); }
    else pauseAll();
  }
  if (due(now, lastUi, UI_HZ)) { lastUi = now; updateUi(); }
  if (playing) requestAnimationFrame(tick);
}

async function seekGlobal(t) {
  t = Math.max(0, Math.min(ev.total - 0.01, t));
  const i = ev.segs.findIndex((s) => t < s.start + s.dur);
  const at = t - ev.segs[i].start;
  if (i !== segIdx) { wantPlay = playing; await loadSeg(i, at); }
  else for (const v of Object.values(vids)) if (v.src) v.currentTime = at;
  updateUi();
}

// ---------- telemetry UI ----------
function sampleAt(t) {
  const a = ev.samples; if (!a.length) return null;
  let lo = 0, hi = a.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (a[mid].t <= t) lo = mid; else hi = mid - 1; }
  return a[lo];
}

function updateUi() {
  const t = globalTime();
  $('seek').value = ev.total ? (t / ev.total) * 1000 : 0;
  $('seekwrap').style.setProperty('--p', `${ev.total ? (t / ev.total) * 100 : 0}%`);
  $('time').textContent = `${fmt(t)} / ${fmt(ev.total)}`;
  const m = sampleAt(t);
  if (m) {
    const kmh = m.speedMps * 3.6, mph = m.speedMps * 2.23694, u = $('units').value;
    const cl = (v) => Math.max(-1, Math.min(1, v));
    const arrow = (dir, on) => `<svg viewBox="0 0 24 24" class="${on ? 'on' : ''}"><path d="${dir ? 'M4 7l9 5-9 5z M13 7l7 5-7 5z' : 'M20 7l-9 5 9 5z M11 7l-7 5 7 5z'}" fill="currentColor"/></svg>`;
    const html =
      `<div class="h-speed"><b>${Math.round(u === 'kmh' ? kmh : mph)}</b><small>${u === 'kmh' ? 'km/h' : 'mph'}</small></div>` +
      `<div class="h-gear" title="Gear">${['P', 'R', 'N', 'D'].map((g) => `<i class="${GEAR[m.gear] === g ? 'on' : ''}">${g}</i>`).join('')}</div>` +
      `<div class="h-wheel"><svg viewBox="0 0 48 48" style="transform:rotate(${m.steering}deg)"><circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="24" cy="24" r="4" fill="currentColor"/><path d="M4.5 22h13.5M30 22h13.5M24 28v16" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg><b>${m.steering.toFixed(0)}°</b></div>` +
      `<div class="h-pedals"><div class="h-bar"><i style="--v:${Math.round(m.accel * 100)}%"></i><span class="k">Thr</span></div>` +
      `<div class="h-bar brake"><i style="--v:${m.brake ? 100 : 0}%"></i><span class="k">Brk</span></div></div>` +
      `<div class="h-turn">${arrow(0, m.blinkerLeft)}${arrow(1, m.blinkerRight)}</div>` +
      (m.autopilot ? `<div class="h-ap">${AUTOPILOT[m.autopilot]}</div>` : '') +
      `<div class="h-g" title="G-force"><i><u style="--x:${50 + cl(m.ay / 9.81) * 40}%;--y:${50 - cl(m.ax / 9.81) * 40}%"></u></i><span class="k">${(m.ax / 9.81).toFixed(2)} / ${(m.ay / 9.81).toFixed(2)} G</span></div>`;
    if (html !== lastHud) { lastHud = html; $('hud').innerHTML = html; }
  }
  drawGraph(t); drawMap(t);
}

function drawGraph(tm = 0) { graph.update(ev, tm); }

function drawMap(t) {
  map.update(ev?.geo ?? [], sampleAt(t));
}

// ---------- encryption ----------
const cryptUi = initDecryptUi({ encrypted, decrypted, onUnlocked: () => ev && openEvent(ev.e) });
const updateCryptUi = () => cryptUi.update();

// ---------- wiring ----------
$('reopen').onclick = () => $('pickDir').click();
addEventListener('themechange', () => ev && updateUi());
$('pickDir').onchange = (e) => addFiles(e.target.files);
$('pickFiles').onchange = (e) => addFiles(e.target.files);
const drop = $('drop');
document.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
document.addEventListener('dragleave', () => drop.classList.remove('over'));
document.addEventListener('drop', async (e) => {
  e.preventDefault(); drop.classList.remove('over');
  const out = [];
  const walk = async (en, base) => {
    if (en.isFile) { const f = await new Promise((r) => en.file(r)); f.path = base + f.name; out.push(f); }
    else if (en.isDirectory) {
      const r = en.createReader(); let batch;
      do { batch = await new Promise((res) => r.readEntries(res)); for (const c of batch) await walk(c, base + en.name + '/'); } while (batch.length);
    }
  };
  for (const it of e.dataTransfer.items) { const en = it.webkitGetAsEntry?.(); if (en) await walk(en, ''); }
  addFiles(out);
});

$('play').onclick = () => { if (!ev) return; playing ? (wantPlay = false, pauseAll()) : (wantPlay = true, playAll()); };
$('seek').oninput = (e) => ev && seekGlobal((e.target.value / 1000) * ev.total);
$('speed').onchange = () => { for (const v of Object.values(vids)) v.playbackRate = +$('speed').value; };
$('layout').onchange = () => { if (!ev) return; const at = master()?.currentTime; applyLayout(); resync(at); };
$('units').onchange = () => ev && updateUi();
$('stepF').onclick = () => { if (ev) { pauseAll(); seekGlobal(globalTime() + 1 / 36); } };
$('stepB').onclick = () => { if (ev) { pauseAll(); seekGlobal(globalTime() - 1 / 36); } };
$('csv').onclick = () => {
  if (!ev?.samples.length) return;
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv(ev.samples)], { type: 'text/csv' })), download: `${ev.e.name}.csv` });
  a.click();
};
document.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); $('play').click(); }
  else if (e.key === 'Escape' && $('layout').value === 'focus') { $('layout').value = 'auto'; applyLayout(); }
  else if (e.key === '.') $('stepF').click(); else if (e.key === ',') $('stepB').click();
  else if (e.key === 'ArrowRight') ev && seekGlobal(globalTime() + 5); else if (e.key === 'ArrowLeft') ev && seekGlobal(globalTime() - 5);
});
const insightsRefresh = [];
initInsights({ getEvent: () => ev, seek: (t) => ev && seekGlobal(t), onUpdate: (f) => insightsRefresh.push(f) });
initBlur(() => ({ get ev() { return ev; }, vids, get focusCam() { return focusCam; }, globalTime }));
initExport({ get ev() { return ev; }, vids, get focusCam() { return focusCam; }, seekGlobal, globalTime, sampleAt,
  units: () => $('units').value, play: () => { wantPlay = true; playAll(); }, pause: () => { wantPlay = false; pauseAll(); }, playing: () => playing });
initPerf({ vids, codec: () => ev?.codec, setLowLoad: (on) => { lowLoad = on; if (ev) resync(); } });
