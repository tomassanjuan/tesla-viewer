// Trip insights: pure analysis over telemetry samples + a small DOM hook (init).
import { TICKS } from './legend.js';
import { t } from './i18n.js';
export const DEFAULTS = { brakeMps2: 3, accelMps2: 2.5, turnMps2: 3.5, minGapS: 3, jitterMps: 60 };
const R = 6371000, rad = Math.PI / 180;

export function haversine(a, b) {
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Group consecutive above-threshold samples into one event (peak time); events closer than minGap merge.
function detect(samples, val, thr, minGap) {
  const out = [];
  let cur = null;
  for (const s of samples) {
    const v = val(s);
    if (v < thr) continue;
    if (cur && s.t - cur.last <= minGap) { cur.last = s.t; if (v > cur.v) { cur.v = v; cur.t = s.t; } }
    else { if (cur) out.push(cur); cur = { t: s.t, last: s.t, v }; }
  }
  if (cur) out.push(cur);
  return out;
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
  const add = (evs, kind, label) => { for (const e of evs) res.markers.push({ t: e.t, kind, label: `${label} ${e.v.toFixed(1)} m/s²` }); return evs.length; };
  res.hardBraking = add(detect(sm, (s) => -(s.ax || 0), o.brakeMps2, o.minGapS), 'brake', 'Hard braking');
  res.hardAccel = add(detect(sm, (s) => s.ax || 0, o.accelMps2, o.minGapS), 'accel', 'Hard acceleration');
  res.sharpTurns = add(detect(sm, (s) => Math.abs(s.ay || 0), o.turnMps2, o.minGapS), 'turn', 'Sharp turn');
  res.markers.sort((a, b) => a.t - b.t);
  return res;
}

/** Tooltip text: "<category> · m:ss" plus the peak value where the marker has one. */
export function tickText(m) {
  const s = Math.max(0, Math.round(m.t));
  return `${t(TICKS[m.kind]?.label ?? m.label)}${m.label.match(/ [\d.]+ m\/s²$/)?.[0] ?? ''} · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
.ins-ticks{position:absolute;left:0;right:0;top:0;height:100%;pointer-events:none}
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
  const tip = Object.assign(document.createElement('div'), { className: 'ins-tip', hidden: true }); par.append(tip);
  let tipTimer;
  function showTip(left, text) {
    tip.textContent = text; tip.style.left = left; tip.hidden = false;
    clearTimeout(tipTimer); tipTimer = setTimeout(() => { tip.hidden = true; }, 2500);
  }
  function refresh() {
    const ev = ctx.getEvent?.();
    panel.replaceChildren(); ticks.replaceChildren(); tip.hidden = true;
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
