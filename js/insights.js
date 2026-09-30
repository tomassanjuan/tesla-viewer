// Trip insights: pure analysis over telemetry samples + a small DOM hook (init).
import { TICKS } from './legend.js';
import { t } from './i18n.js';
// brakeStrongMps2: decel that counts as braking even with the pedal at 0 (regen alone tops out lower). Tick thresholds are on the
// smoothed (smoothS) value and must hold for minDurS; same-kind events closer than minGapS merge into one tick.
export const DEFAULTS = { brakeMps2: 3, brakeStrongMps2: 5, accelMps2: 2.5, turnMps2: 2.5, minGapS: 5, minDurS: 0.3, smoothS: 0.5, jitterMps: 60 };
const R = 6371000, rad = Math.PI / 180;

export function haversine(a, b) {
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Moving average of f over +-w seconds (sensor noise and one-frame spikes must not make an event).
function smooth(sm, f, w) {
  const out = [];
  for (let i = 0, lo = 0, hi = 0, sum = 0; i < sm.length; i++) {
    for (; hi < sm.length && sm[hi].t <= sm[i].t + w; hi++) sum += f(sm[hi]);
    for (; sm[lo].t < sm[i].t - w; lo++) sum -= f(sm[lo]);
    out.push(sum / (hi - lo));
  }
  return out;
}

// Events = runs of smoothed values >= thr that last >= minDur and pass `ok(run)`; runs closer than minGap merge (peak wins).
function detect(sm, vals, thr, { minDur, minGap }, ok = () => true) {
  const runs = [];
  let cur = null;
  const close = () => { if (cur && cur.last - cur.first >= minDur && ok(cur)) runs.push(cur); cur = null; };
  sm.forEach((s, i) => {
    if (vals[i] < thr) return close();
    cur ??= { first: s.t, last: s.t, v: 0, t: s.t, s, flag: false };
    cur.last = s.t;
    if (vals[i] > cur.v) { cur.v = vals[i]; cur.t = s.t; cur.s = s; }
    cur.flag ||= !!s.brake;
  });
  close();
  return runs.reduce((out, r) => {
    const p = out[out.length - 1];
    if (p && r.first - p.last <= minGap) { p.last = r.last; p.flag ||= r.flag; if (r.v > p.v) Object.assign(p, { v: r.v, t: r.t, s: r.s }); }
    else out.push(r);
    return out;
  }, []);
}

export function analyze(samples, opt = {}) {
  const o = { ...DEFAULTS, ...opt };
  const sm = (samples ?? []).filter((s) => Number.isFinite(s?.t)).sort((a, b) => a.t - b.t);
  const res = { duration: 0, distanceM: 0, maxSpeedMps: 0, avgSpeedMps: 0, autopilotPct: 0, hardBraking: 0, hardAccel: 0, sharpTurns: 0, apEngages: 0, apDisengages: 0, markers: [] };
  if (!sm.length) return res;
  res.duration = sm[sm.length - 1].t - sm[0].t;
  let spdSum = 0, apTime = 0, last = null;
  for (let i = 0; i < sm.length; i++) {
    const s = sm[i], p = sm[i - 1];
    res.maxSpeedMps = Math.max(res.maxSpeedMps, s.speedMps || 0);
    spdSum += s.speedMps || 0;
    if (p) {
      if (p.autopilot) apTime += s.t - p.t;
      if (!!s.autopilot !== !!p.autopilot) {
        if (s.autopilot) { res.apEngages++; res.markers.push({ t: s.t, kind: 'ap-on', label: 'Autopilot engaged' }); }
        else { res.apDisengages++; res.markers.push({ t: s.t, kind: 'ap-off', label: 'Autopilot disengaged' }); }
      }
    }
    if (s.lat || s.lon) {
      // jitter filter: drop fixes implying an impossible speed (> jitterMps) vs the last accepted fix
      if (!last) last = s;
      else {
        const d = haversine(last, s), dt = s.t - last.t;
        if (dt > 0 && d / dt <= o.jitterMps) { res.distanceM += d; last = s; }
      }
    }
  }
  res.avgSpeedMps = spdSum / sm.length;
  res.autopilotPct = res.duration > 0 ? (apTime / res.duration) * 100 : 0;
  // ax: longitudinal accel (m/s2), negative = braking; ay: lateral.
  const d = { minDur: o.minDurS, minGap: o.minGapS };
  const add = (evs, kind, label, note) => { for (const e of evs) res.markers.push({ t: e.t, kind, label: `${label} ${e.v.toFixed(1)} m/s²`, v: e.v, note: note(e) }); return evs.length; };
  const sx = smooth(sm, (s) => s.ax || 0, o.smoothS), sy = smooth(sm, (s) => Math.abs(s.ay || 0), o.smoothS);
  res.hardBraking = add(detect(sm, sx.map((v) => -v), o.brakeMps2, d, (r) => r.flag || r.v >= o.brakeStrongMps2), 'brake', 'Hard braking', (e) => (e.flag ? 'brake pedal' : 'no brake pedal'));
  res.hardAccel = add(detect(sm, sx, o.accelMps2, d, (r) => r.s.accel > 0), 'accel', 'Hard acceleration', (e) => `throttle ${Math.round(Math.min(1, e.s.accel || 0) * 100)}%`);
  res.sharpTurns = add(detect(sm, sy, o.turnMps2, d), 'turn', 'Sharp turn', (e) => `steering ${Math.round(e.s.steering || 0)}°`);
  res.markers.sort((a, b) => a.t - b.t);
  return res;
}

/** Tooltip text: "<category> <peak> · <why> · m:ss"; the note says what backs the event (brake pedal, throttle, steering). */
export function tickText(m) {
  const s = Math.max(0, Math.round(m.t));
  return `${t(TICKS[m.kind]?.label ?? m.label)}${m.v ? ` ${m.v.toFixed(1)} m/s²` : ''}${m.note ? ` · ${t(m.note)}` : ''} · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatSummary(r, units = 'kmh') {
  const mph = units === 'mph';
  const dist = mph ? `${(r.distanceM / 1609.344).toFixed(2)} mi` : `${(r.distanceM / 1000).toFixed(2)} km`;
  const sp = (v) => mph ? `${(v * 2.23694).toFixed(0)} mph` : `${(v * 3.6).toFixed(0)} km/h`;
  const m = Math.floor(r.duration / 60), s = Math.round(r.duration % 60);
  return [['Distance', dist], ['Duration', `${m}:${String(s).padStart(2, '0')}`], ['Max speed', sp(r.maxSpeedMps)], ['Avg speed', sp(r.avgSpeedMps)],
    ['Autopilot', `${r.autopilotPct.toFixed(0)}%`], ['Hard braking', String(r.hardBraking)], ['Hard accel', String(r.hardAccel)], ['Sharp turns', String(r.sharpTurns)],
    ['AP on / off', `${r.apEngages} / ${r.apDisengages}`]];
}

// ---------- DOM hook (browser only) ----------
const CSS = `.ins-panel{font-size:12px;padding:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:4px 12px}
.ins-panel div{display:flex;justify-content:space-between;gap:6px}.ins-panel .k{opacity:.65}
.ins-ticks{position:absolute;left:calc(var(--th,0px) / 2);right:calc(var(--th,0px) / 2);top:0;height:100%;pointer-events:none}
.ins-tick{position:absolute;top:0;width:6px;height:100%;margin-left:-3px;padding:0;border:0;border-radius:2px;cursor:pointer;pointer-events:auto;opacity:.85}
${Object.entries(TICKS).map(([k, v]) => `.ins-tick.${k}{background:${v.color}}`).join('')}
.ins-tip{position:absolute;bottom:100%;transform:translateX(-50%);margin-bottom:4px;padding:2px 8px;border-radius:6px;background:#000c;color:#fff;font-size:12px;white-space:nowrap;pointer-events:none;z-index:5}`;

/** ctx: { getEvent() -> {samples,total}|null, seek(t), onUpdate(fn) registers fn to run when a new event loads }. */
export function init(ctx) {
  const seekEl = document.getElementById('seek'), host = document.getElementById('extras-panels'), units = document.getElementById('units');
  if (!seekEl || !host) return { refresh() {} };
  document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));
  const panel = Object.assign(document.createElement('div'), { className: 'ins-panel', hidden: true }); host.append(panel);
  const par = seekEl.parentElement;
  if (getComputedStyle(par).position === 'static') par.style.position = 'relative';
  const ticks = Object.assign(document.createElement('div'), { className: 'ins-ticks' }); par.append(ticks);
  // tap/click shows the tooltip too (no hover on phones); it fades after a moment
  const tip = Object.assign(document.createElement('div'), { className: 'ins-tip', hidden: true }); ticks.append(tip);
  let tipTimer;
  function showTip(left, text) {
    tip.textContent = text; tip.style.left = left; tip.hidden = false;
    clearTimeout(tipTimer); tipTimer = setTimeout(() => { tip.hidden = true; }, 2500);
  }
  function refresh() {
    const ev = ctx.getEvent?.();
    panel.replaceChildren(); ticks.replaceChildren(tip); tip.hidden = true;
    if (!ev?.samples?.length) { panel.hidden = true; return; }
    const r = analyze(ev.samples);
    panel.hidden = false;
    for (const [k, v] of formatSummary(r, units?.value)) {
      const d = document.createElement('div'), a = document.createElement('span'), b = document.createElement('b');
      a.className = 'k'; a.textContent = k; b.textContent = v; d.append(a, b); panel.append(d);
    }
    for (const m of r.markers) {
      const b = document.createElement('button'), text = tickText(m);
      b.className = `ins-tick ${m.kind}`; b.title = text; b.setAttribute('aria-label', text);
      b.style.left = `${(m.t / ev.total) * 100}%`;
      b.onclick = () => { ctx.seek(m.t); showTip(b.style.left, text); };
      ticks.append(b);
    }
  }
  units?.addEventListener('change', refresh);
  ctx.onUpdate?.(refresh);
  return { refresh };
}
