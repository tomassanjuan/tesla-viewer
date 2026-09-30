// Telemetry graph: DPR-aware canvas, axes, AP bands, throttle/brake strips, playhead, hover + click/drag seek.
import { t } from './i18n.js';
import { COLOR } from './legend.js';

// ---------- pure helpers ----------
/** "Nice" tick values covering [min,max] with roughly `count` ticks. */
export function niceTicks(min, max, count = 5) {
  if (!(max > min)) max = min + 1;
  const raw = (max - min) / Math.max(1, count), p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  const out = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
/** Time tick positions (seconds) over 0..total, on round m:ss steps. */
export function timeTicks(total, count = 6) {
  if (!(total > 0)) return [0];
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const step = steps.find((s) => total / s <= count) ?? 3600, out = [];
  for (let v = 0; v <= total + 1e-9; v += step) out.push(v);
  return out;
}
export const fmtTime = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** Reduce samples ({t, v}) to at most 2 points per pixel column, keeping each bucket's min and max (in time order). */
export function downsample(samples, pxWidth) {
  if (samples.length <= pxWidth * 2 || pxWidth < 1) return samples.slice();
  const t0 = samples[0].t, span = samples[samples.length - 1].t - t0 || 1, out = [];
  let b = -1, lo, hi;
  const flush = () => { if (lo) out.push(...(lo === hi ? [lo] : lo.t <= hi.t ? [lo, hi] : [hi, lo])); };
  for (const s of samples) {
    const k = Math.min(pxWidth - 1, Math.floor(((s.t - t0) / span) * pxWidth));
    if (k !== b) { flush(); b = k; lo = hi = s; } else { if (s.v < lo.v) lo = s; if (s.v > hi.v) hi = s; }
  }
  flush();
  return out;
}
export const xToTime = (x, x0, x1, total) => Math.min(total, Math.max(0, ((x - x0) / (x1 - x0)) * total));
export const valueToY = (v, vmin, vmax, y0, y1) => y1 - ((v - vmin) / (vmax - vmin || 1)) * (y1 - y0); // y0 top, y1 bottom
/** Contiguous [start,end] spans where pred(sample) holds. */
export function spans(samples, pred) {
  const out = []; let cur = null;
  for (const s of samples) {
    if (pred(s)) { if (cur) cur[1] = s.t; else cur = [s.t, s.t]; } else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

// ---------- DOM part ----------
const THR_LANE = 40; // px height of the throttle/brake lane under the speed curve
const GEAR = ['P', 'D', 'R', 'N'], AP = ['Off', 'Self-driving', 'Autosteer', 'TACC'];

export function createGraph(canvas, opts = {}) {
  const seek = opts.seek ?? opts.ctx?.seek ?? (() => {});
  const sel = document.getElementById('units');
  let units = opts.units ?? sel?.value ?? 'kmh', ev = null, cur = 0, hover = null, drag = false, W = 0, H = 0, raf = 0;
  const wrap = document.createElement('div');
  wrap.className = 'gr-wrap';
  canvas.parentNode?.insertBefore(wrap, canvas); wrap.appendChild(canvas);
  const tip = document.createElement('div'); tip.className = 'gr-tip'; tip.hidden = true; wrap.appendChild(tip);
  if (!document.getElementById('gr-style')) {
    const st = document.createElement('style'); st.id = 'gr-style';
    st.textContent = '.gr-wrap{position:relative;flex:1;min-width:0;height:180px}.gr-wrap>canvas{width:100%!important;height:100%!important;aspect-ratio:auto!important;display:block;touch-action:none;cursor:crosshair}' +
      '.gr-tip{position:absolute;top:4px;left:0;pointer-events:none;background:var(--surface,#181b22);color:var(--fg,#e8eaed);border:1px solid var(--border,var(--b,#2a2f3a));border-radius:6px;padding:3px 7px;font:11px system-ui,sans-serif;white-space:nowrap;z-index:2}.gr-tip[hidden]{display:none}';
    document.head.appendChild(st);
  }
  const css = (n, d) => getComputedStyle(canvas).getPropertyValue(n).trim() || d;
  const mph = () => units === 'mph', conv = (mps) => mps * (mph() ? 2.23694 : 3.6);

  function layout() {
    const padL = 34, padR = 8, padT = 6, axisB = 16, strips = ev?.samples.some((s) => s.accel > 0 || s.brake) ? THR_LANE : 0;
    return { x0: padL, x1: Math.max(padL + 10, W - padR), y0: padT, y1: H - axisB - strips - 3, sy0: H - axisB - strips, sy1: H - axisB };
  }

  function draw() {
    raf = 0;
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = window.devicePixelRatio || 1; W = r.width; H = r.height;
    const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    const x = canvas.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
    const fg = css(COLOR.speed, '#e8eaed'), mut = css('--mut', '#8b93a1'), grid = css('--border', css('--b', '#2a2f3a')), brake = css(COLOR.brake, '#e31937'), playhead = css(COLOR.playhead, '#e31937'), ap = css(COLOR.ap, '#5aa9ff'), thr = css(COLOR.throttle, '#5aa9ff');
    x.font = '10px system-ui,sans-serif'; x.textBaseline = 'middle';
    if (!ev?.samples.length || !(ev.total > 0)) {
      x.fillStyle = mut; x.textAlign = 'center'; x.font = '12px system-ui,sans-serif';
      x.fillText(t('No telemetry in these clips'), W / 2, H / 2); tip.hidden = true; return;
    }
    const L = layout(), S = ev.samples, total = ev.total, pw = L.x1 - L.x0;
    const vmax0 = Math.max(1, ...S.map((s) => conv(s.speedMps)));
    const yt = niceTicks(0, vmax0, Math.max(2, Math.floor((L.y1 - L.y0) / 22))), vmax = Math.max(yt[yt.length - 1], vmax0);
    const X = (tm) => L.x0 + (tm / total) * pw, Y = (v) => valueToY(v, 0, vmax, L.y0, L.y1);
    const tt = timeTicks(total, Math.max(2, Math.floor(pw / 60)));
    // grid + axes
    x.lineWidth = 1; x.strokeStyle = grid; x.globalAlpha = 0.6;
    for (const v of yt) { const y = Math.round(Y(v)) + 0.5; x.beginPath(); x.moveTo(L.x0, y); x.lineTo(L.x1, y); x.stroke(); }
    for (const tm of tt) { const px = Math.round(X(tm)) + 0.5; x.beginPath(); x.moveTo(px, L.y0); x.lineTo(px, L.sy1); x.stroke(); }
    x.globalAlpha = 1; x.fillStyle = mut; x.textAlign = 'right';
    for (const v of yt) x.fillText(String(v), L.x0 - 4, Y(v));
    for (const tm of tt) { const px = X(tm), lw = x.measureText(fmtTime(tm)).width / 2; x.textAlign = 'center'; x.fillText(fmtTime(tm), Math.min(W - lw, Math.max(L.x0 - 6 + lw, px)), H - 7); }
    x.textAlign = 'left'; x.fillText(mph() ? 'mph' : 'km/h', L.x0 + 4, L.y0 + 6);
    // autopilot bands
    const apSpans = spans(S, (s) => s.autopilot), minW = Math.max(0.3, total / pw * 2);
    x.fillStyle = ap; x.globalAlpha = 0.16;
    for (const [a, b] of apSpans) x.fillRect(X(a), L.y0, Math.max(2, X(Math.max(b, a + minW)) - X(a)), L.sy1 - L.y0);
    x.globalAlpha = 1;
    // speed line + area, broken across telemetry gaps
    const dts = S.slice(1).map((s, i) => s.t - S[i].t).sort((a, b) => a - b), gapT = Math.max(1, (dts[dts.length >> 1] || 0.03) * 5);
    const pts = downsample(S.map((s) => ({ t: s.t, v: conv(s.speedMps) })), Math.floor(pw)), runs = [];
    pts.forEach((p, i) => { if (!i || p.t - pts[i - 1].t > gapT) runs.push([]); runs[runs.length - 1].push(p); });
    x.lineJoin = 'round';
    for (const run of runs) {
      x.beginPath(); run.forEach((p, i) => (i ? x.lineTo(X(p.t), Y(p.v)) : x.moveTo(X(p.t), Y(p.v))));
      x.strokeStyle = fg; x.lineWidth = 1.5; x.stroke();
      x.lineTo(X(run[run.length - 1].t), Y(0)); x.lineTo(X(run[0].t), Y(0)); x.closePath();
      x.fillStyle = fg; x.globalAlpha = 0.1; x.fill(); x.globalAlpha = 1;
    }
    // throttle lane: own 0..100% scale under the speed curve, brake drawn as full-height bars in the same lane
    if (L.sy1 > L.sy0 + 4) {
      const h = L.sy1 - L.sy0, bw = Math.max(1, pw / S.length * 1.5);
      x.fillStyle = thr; x.globalAlpha = 0.08; x.fillRect(L.x0, L.sy0, pw, h);
      x.globalAlpha = 0.9; x.fillStyle = thr;
      for (const s of S) if (s.accel > 0.01) { const a = h * Math.min(1, s.accel); x.fillRect(X(s.t), L.sy1 - a, bw, a); }
      x.fillStyle = brake; x.globalAlpha = 0.75;
      for (const s of S) if (s.brake) x.fillRect(X(s.t), L.sy0, bw, h);
      x.globalAlpha = 1; x.strokeStyle = grid; x.beginPath(); x.moveTo(L.x0, Math.round(L.sy0) - 0.5); x.lineTo(L.x1, Math.round(L.sy0) - 0.5); x.stroke();
      x.fillStyle = thr; x.textAlign = 'right'; x.fillText('100%', L.x0 - 4, L.sy0 + 5); x.fillText('0', L.x0 - 4, L.sy1 - 4);
      x.textAlign = 'left'; x.fillText(t('Throttle'), L.x0 + 4, L.sy0 + 7);
    }
    // legend chip
    if (apSpans.length) {
      const lab = t('Autopilot'), w = x.measureText(lab).width + 12;
      x.fillStyle = ap; x.globalAlpha = 0.25; x.fillRect(L.x1 - w - 2, L.y0 + 1, w, 13); x.globalAlpha = 1;
      x.fillStyle = fg; x.textAlign = 'center'; x.fillText(lab, L.x1 - w / 2 - 2, L.y0 + 7.5);
    }
    // hover + playhead
    if (hover != null) { const px = Math.round(X(hover)) + 0.5; x.strokeStyle = mut; x.lineWidth = 1; x.beginPath(); x.moveTo(px, L.y0); x.lineTo(px, L.sy1); x.stroke(); }
    x.strokeStyle = playhead; x.lineWidth = 2; x.beginPath(); x.moveTo(X(cur), L.y0); x.lineTo(X(cur), L.sy1); x.stroke();
    // tooltip
    const s = hover != null && nearest(hover);
    if (s && Math.abs(s.t - hover) < gapT) {
      tip.textContent = `${fmtTime(hover)} · ${Math.round(conv(s.speedMps))} ${mph() ? 'mph' : 'km/h'} · ${GEAR[s.gear] ?? '?'}${s.autopilot ? ' · ' + (AP[s.autopilot] ?? 'AP') : ''} · ${t('Throttle')} ${Math.round(Math.min(1, s.accel || 0) * 100)}%${s.brake ? ' · ' + t('Brake') : ''}`;
      tip.hidden = false;
      const tw = tip.offsetWidth; tip.style.left = Math.max(0, Math.min(W - tw, X(hover) - tw / 2)) + 'px';
    } else tip.hidden = true;
  }
  function nearest(tm) {
    const S = ev.samples; let lo = 0, hi = S.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (S[m].t < tm) lo = m + 1; else hi = m; }
    return lo > 0 && Math.abs(S[lo - 1].t - tm) < Math.abs(S[lo].t - tm) ? S[lo - 1] : S[lo];
  }
  const sched = () => { raf ||= requestAnimationFrame(draw); };
  const timeAt = (e) => { const L = layout(); return xToTime(e.clientX - canvas.getBoundingClientRect().left, L.x0, L.x1, ev.total); };
  const ok = () => ev?.samples.length && ev.total > 0;
  const onMove = (e) => { if (!ok()) return; hover = timeAt(e); if (drag) seek(hover); sched(); };
  const onDown = (e) => { if (!ok()) return; drag = true; canvas.setPointerCapture?.(e.pointerId); hover = timeAt(e); seek(hover); sched(); };
  const onUp = () => { drag = false; };
  const onLeave = () => { if (!drag) { hover = null; sched(); } };
  const onUnits = () => { units = sel.value; sched(); };
  const on = [['pointermove', onMove], ['pointerdown', onDown], ['pointerup', onUp], ['pointercancel', onUp], ['pointerleave', onLeave]];
  for (const [n, f] of on) canvas.addEventListener(n, f);
  addEventListener('themechange', sched); sel?.addEventListener('change', onUnits);
  const ro = new ResizeObserver(sched); ro.observe(canvas);
  sched();
  return {
    update(e, time = 0) { ev = e; cur = time; sched(); },
    setUnits(u) { units = u; sched(); },
    destroy() {
      ro.disconnect(); cancelAnimationFrame(raf);
      for (const [n, f] of on) canvas.removeEventListener(n, f);
      removeEventListener('themechange', sched); sel?.removeEventListener('change', onUnits); tip.remove();
    },
  };
}
