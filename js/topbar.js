import { tsToDate } from './library.js';
import { GEAR, AUTOPILOT } from './sei.js';

/** Wall-clock string for `offset` seconds into library segment `seg` (seg.ts like 2026-06-01_10-00-00). */
export function formatClipTime(seg, offset = 0) {
  return new Date(tsToDate(seg.ts).getTime() + offset * 1000).toLocaleString();
}

/** Current autopilot stretch at time t: {state, start, elapsed} or null when AP is off / no samples. */
export function apStretch(samples, t) {
  let lo = 0, hi = samples.length - 1;
  if (hi < 0 || samples[0].t > t) return null;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (samples[mid].t <= t) lo = mid; else hi = mid - 1; }
  const state = samples[lo].autopilot;
  if (!state) return null;
  let i = lo; while (i > 0 && samples[i - 1].autopilot === state) i--;
  return { state, start: samples[i].t, elapsed: t - samples[i].t };
}

const pctCache = new WeakMap();
/** Share (0..100) of samples with autopilot active; cached per samples array. */
export function apPercent(samples) {
  if (!samples.length) return 0;
  if (!pctCache.has(samples)) pctCache.set(samples, (100 * samples.filter((s) => s.autopilot).length) / samples.length);
  return pctCache.get(samples);
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

/** Fill #topbar. ev = app event state, t = global time, m = current sample (or null). */
export function updateTopbar(ev, segIdx, t, m, units) {
  const seg = ev.segs[segIdx], u = units === 'kmh';
  const ap = apStretch(ev.samples, t), st = ap?.state ?? 0;
  const pct = ev.samples.length ? ` · ${apPercent(ev.samples).toFixed(0)}% of trip` : '';
  document.getElementById('topbar').innerHTML =
    `<b class="tb-name">${esc(ev.e.name)}</b>` +
    `<span>${formatClipTime(seg, t - seg.start)}</span>` +
    `<span>clip ${segIdx + 1}/${ev.segs.length}</span><span>${ev.cams.length} cam${ev.cams.length === 1 ? '' : 's'}</span>` +
    (m ? `<span>${Math.round(m.speedMps * (u ? 3.6 : 2.23694))} ${u ? 'km/h' : 'mph'}</span><span>${GEAR[m.gear] ?? '?'}</span>` : '') +
    `<span class="apchip ap${st}"><i></i>${AUTOPILOT[st] ?? '?'}${ap ? ` · engaged ${mmss(ap.elapsed)}` : ''}${pct}</span>`;
}
