import { groupFiles, tsToDate, CAMS } from './library.js';
import { parseClip } from './mp4.js';
import { GEAR, AUTOPILOT, csv } from './sei.js';
import { isEncrypted, parseHeader, decrypt, fetchKeys, parseKeyJson } from './tesla-crypto.js';

const $ = (id) => document.getElementById(id);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const NAMES = { front: 'Front', back: 'Back', left_repeater: 'Left', right_repeater: 'Right', left_pillar: 'L pillar', right_pillar: 'R pillar' };

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
    if (isEncrypted(head)) encrypted.set(file, parseHeader(head));
  }
  events = groupFiles(items);
  renderEvents();
  updateCryptUi();
  if (events.length) openEvent(events[0]);
}

function renderEvents() {
  $('events').innerHTML = '';
  for (const e of events) {
    const d = document.createElement('div'); d.className = 'ev';
    const first = tsToDate(e.segments[0].ts);
    d.innerHTML = `<b>${e.name}</b><small>${first.toLocaleString()} · ${e.segments.length} min-clips</small>`;
    d.onclick = () => openEvent(e);
    e._el = d; $('events').append(d);
  }
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
  let blocked = 0, t0 = 0;
  for (const s of segs) {
    s.start = t0;
    const f = s.cams.front ?? Object.values(s.cams)[0];
    if (encrypted.has(f) && !decrypted.has(f)) { blocked++; s.dur = 60; t0 += 60; continue; }
    try {
      const c = parseClip(await resolve(f).arrayBuffer());
      s.dur = c.duration;
      for (const m of c.samples) samples.push({ ...m, t: m.t + t0 });
    } catch { s.dur = await probeDuration(resolve(f)); }
    t0 += s.dur;
  }
  ev = { e, cams, segs, samples, total: t0 };
  focusCam = cams.includes('front') ? 'front' : cams[0];
  buildGrid();
  $('empty').hidden = true;
  $('hud').hidden = !samples.length;
  drawGraph(); drawMap(0);
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
  const n = ev.cams.length, cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  g.style.gridTemplateColumns = `repeat(${cols},1fr)`;
  g.style.gridTemplateRows = `repeat(${Math.ceil(n / cols)},1fr)`;
  for (const c of ev.cams) {
    const d = document.createElement('div'); d.className = 'cam';
    d.innerHTML = `<video muted playsinline preload="auto"></video><span>${NAMES[c]}</span>`;
    d.onclick = () => { focusCam = c; applyLayout(); };
    vids[c] = d.querySelector('video'); d._cam = c; g.append(d);
  }
  applyLayout();
}

function applyLayout() {
  const g = $('grid'), focus = $('layout').value === 'focus';
  g.classList.toggle('focus', focus);
  if (focus) { g.style.gridTemplateColumns = '1fr'; g.style.gridTemplateRows = '1fr'; }
  else buildGridTemplate();
  for (const d of g.children) d.classList.toggle('main', d._cam === focusCam);
}
function buildGridTemplate() {
  const n = ev.cams.length, cols = n <= 1 ? 1 : n <= 4 ? 2 : 3, g = $('grid');
  g.style.gridTemplateColumns = `repeat(${cols},1fr)`;
  g.style.gridTemplateRows = `repeat(${Math.ceil(n / cols)},1fr)`;
}

const master = () => vids[ev.cams.find((c) => vids[c]?.src)] ?? Object.values(vids)[0];

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

function playAll() { playing = true; $('play').textContent = '⏸'; for (const v of Object.values(vids)) v.src && v.play().catch(() => {}); requestAnimationFrame(tick); }
function pauseAll() { playing = false; $('play').textContent = '▶'; for (const v of Object.values(vids)) v.pause(); }
function stop() { wantPlay = false; if (ev) pauseAll(); }

function globalTime() { const m = master(); return ev.segs[segIdx].start + (m?.currentTime ?? 0); }

async function tick() {
  if (!ev || !playing) return;
  const m = master(), s = ev.segs[segIdx];
  for (const v of Object.values(vids)) if (v !== m && v.src && Math.abs(v.currentTime - m.currentTime) > 0.15) v.currentTime = m.currentTime;
  if (m.ended || m.currentTime >= s.dur - 0.03) {
    if (segIdx + 1 < ev.segs.length) { wantPlay = true; await loadSeg(segIdx + 1, 0); }
    else pauseAll();
  }
  updateUi();
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
  $('time').textContent = `${fmt(t)} / ${fmt(ev.total)}`;
  const m = sampleAt(t);
  if (m) {
    const kmh = m.speedMps * 3.6, mph = m.speedMps * 2.23694, u = $('units').value;
    $('hud').innerHTML =
      `<div><span class="spd">${Math.round(u === 'kmh' ? kmh : mph)}</span> <span class="k">${u === 'kmh' ? 'km/h' : 'mph'}</span></div>` +
      `<div><span class="k">GEAR</span> ${GEAR[m.gear] ?? '?'}</div>` +
      `<div><span class="k">STEER</span> ${m.steering.toFixed(0)}°</div>` +
      `<div><span class="k">THROTTLE</span> ${(m.accel * 100).toFixed(0)}%</div>` +
      `<div class="${m.brake ? 'on-brake' : ''}"><span class="k">BRAKE</span> ${m.brake ? 'ON' : '–'}</div>` +
      `<div class="on-b">${m.blinkerLeft ? '◀' : ''}${m.blinkerRight ? '▶' : ''}</div>` +
      `<div class="ap">${m.autopilot ? AUTOPILOT[m.autopilot] : ''}</div>` +
      `<div><span class="k">G</span> ${(m.ax / 9.81).toFixed(2)} / ${(m.ay / 9.81).toFixed(2)}</div>`;
  }
  drawGraph(t); drawMap(t);
}

function drawGraph(t = 0) {
  const c = $('graph'), x = c.getContext('2d'), W = c.width, H = c.height;
  x.clearRect(0, 0, W, H);
  if (!ev?.samples.length) { x.fillStyle = '#8b93a1'; x.fillText('No telemetry in these clips', 10, 20); return; }
  const max = Math.max(1, ...ev.samples.map((s) => s.speedMps * 3.6));
  x.strokeStyle = '#5aa9ff'; x.beginPath();
  ev.samples.forEach((s, i) => { const px = (s.t / ev.total) * W, py = H - (s.speedMps * 3.6 / max) * (H - 10) - 5; i ? x.lineTo(px, py) : x.moveTo(px, py); });
  x.stroke();
  x.strokeStyle = '#e31937'; x.beginPath(); x.moveTo((t / ev.total) * W, 0); x.lineTo((t / ev.total) * W, H); x.stroke();
  x.fillStyle = '#8b93a1'; x.fillText(`speed, max ${max.toFixed(0)} km/h`, 6, 12);
}

function drawMap(t) {
  const c = $('map'), x = c.getContext('2d'), W = c.width, H = c.height;
  x.clearRect(0, 0, W, H);
  const pts = ev?.samples.filter((s) => s.lat || s.lon) ?? [];
  if (!pts.length) { x.fillStyle = '#8b93a1'; x.fillText('No GPS', 10, 20); return; }
  const lat0 = pts[0].lat, k = Math.cos((lat0 * Math.PI) / 180);
  const X = pts.map((p) => p.lon * k), Y = pts.map((p) => -p.lat);
  const minX = Math.min(...X), maxX = Math.max(...X), minY = Math.min(...Y), maxY = Math.max(...Y);
  const sc = Math.min((W - 20) / (maxX - minX || 1e-6), (H - 20) / (maxY - minY || 1e-6));
  const P = (i) => [10 + (X[i] - minX) * sc, 10 + (Y[i] - minY) * sc];
  x.strokeStyle = '#5aa9ff'; x.beginPath(); pts.forEach((_, i) => { const [a, b] = P(i); i ? x.lineTo(a, b) : x.moveTo(a, b); }); x.stroke();
  const cur = sampleAt(t); const i = Math.max(0, pts.indexOf(cur));
  const [a, b] = P(i); x.fillStyle = '#e31937'; x.beginPath(); x.arc(a, b, 4, 0, 7); x.fill();
}

// ---------- encryption ----------
function updateCryptUi() {
  const n = [...encrypted.keys()].filter((f) => !decrypted.has(f)).length;
  $('cryptCount').textContent = encrypted.size ? `${n} of ${encrypted.size} encrypted clips still locked.` : 'No encrypted clips loaded.';
  if (n) $('crypt').open = true;
}

async function decryptAll(keys) {
  let ok = 0, missing = 0;
  for (const [f, h] of encrypted) {
    if (decrypted.has(f)) continue;
    const key = keys[h.id];
    if (!key) { missing++; continue; }
    try {
      const out = await decrypt(new Uint8Array(await f.arrayBuffer()), key);
      decrypted.set(f, new Blob([out], { type: 'video/mp4' })); ok++;
      $('cryptMsg').textContent = `Decrypted ${ok}…`;
    } catch (e) { $('cryptMsg').textContent = 'Decrypt failed: ' + e.message; }
  }
  $('cryptMsg').textContent = `Decrypted ${ok}, no key for ${missing}.`;
  updateCryptUi();
  if (ok && ev) openEvent(ev.e);
}

$('fetchKeys').onclick = async () => {
  try {
    const hs = [...encrypted.entries()].filter(([f]) => !decrypted.has(f)).map(([, h]) => h);
    $('cryptMsg').textContent = 'Requesting keys…';
    await decryptAll(await fetchKeys(hs, $('token').value.trim()));
  } catch (e) { $('cryptMsg').textContent = `${e.message}. If this is a CORS/network error, fetch keys another way and paste them as JSON.`; }
};
$('useKeys').onclick = () => { try { decryptAll(parseKeyJson($('keyJson').value)); } catch (e) { $('cryptMsg').textContent = 'Bad JSON: ' + e.message; } };

// ---------- wiring ----------
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
$('layout').onchange = () => ev && applyLayout();
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
  else if (e.key === '.') $('stepF').click(); else if (e.key === ',') $('stepB').click();
  else if (e.key === 'ArrowRight') ev && seekGlobal(globalTime() + 5); else if (e.key === 'ArrowLeft') ev && seekGlobal(globalTime() - 5);
});
