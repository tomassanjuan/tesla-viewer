// Group dropped files into events: { name, segments:[{ts, cams:{front:File,...}}] }
export const CAMS = ['front', 'back', 'left_repeater', 'right_repeater', 'left_pillar', 'right_pillar'];
const RE = /(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})-(front|back|left_repeater|right_repeater|left_pillar|right_pillar)\.mp4$/i;

export function parseName(path) {
  const m = RE.exec(path);
  return m ? { ts: m[1], cam: m[2].toLowerCase() } : null;
}

export const TRIP_GAP_S = 120;    // new trip when a segment starts > this long after the previous one ended (~60 s clips)
export const EVENT_GAP_S = 600;   // same rule, inside SavedClips/SentryClips event dirs
const SEG_S = 60;
const p2 = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const dur = (n) => { const m = n; return m >= 60 ? `${Math.floor(m / 60)} h ${p2(m % 60)} min` : `${m} min`; };

/** Split sorted segments where start - (prevStart + 60 s) > gapS. */
function splitByGap(segs, gapS) {
  const runs = [];
  let prev = null;
  for (const s of segs) {
    const t = tsToDate(s.ts).getTime();
    if (!prev || (t - prev) / 1000 - SEG_S > gapS) runs.push([]);
    runs[runs.length - 1].push(s); prev = t;
  }
  return runs;
}

export const CATEGORIES = ['recent', 'saved', 'sentry', 'loose'];
/** TeslaCam folder an event came from; 'loose' = clips outside the standard folders. */
export function categoryOf(path) {
  const m = /(^|\/)(Recent|Saved|Sentry)Clips(\/|$)/i.exec(path);
  return m ? m[2].toLowerCase() : 'loose';
}

export const EVENT_TYPES = ['sentry', 'saved', 'honk', 'other'];
/** Event type from event.json `reason`; falls back to the folder when there is no event.json. null for continuous recording. */
export function eventType(e) {
  const r = String(e.reason ?? '');
  if (/^sentry/i.test(r)) return 'sentry';
  if (/honk/i.test(r)) return 'honk';
  if (/^user_interaction/i.test(r)) return 'saved';
  if (r) return 'other';
  return e.category === 'sentry' ? 'sentry' : e.category === 'saved' ? 'saved' : e.category === 'recent' ? null : 'other';
}

/** Counts per category / type over `events` (for badges). */
export function countBy(events, fn) {
  const c = {};
  for (const e of events) { const k = fn(e); if (k) c[k] = (c[k] ?? 0) + 1; }
  return c;
}

/** events filtered by category ('' = all) and type ('' = all). Events carry `reason` (raw event.json reason) once loaded. */
export function filterEvents(events, { category = '', type = '' } = {}) {
  return events.filter((e) => (!category || e.category === category) && (!type || eventType(e) === type));
}

/** files: [{path, file}] where path is the relative path (folders give event names). */
export function groupFiles(files) {
  const dirs = new Map(), dirCat = new Map(), recent = new Map(), loose = new Map(), extras = [];
  for (const { path, file } of files) {
    const p = parseName(path);
    const parts = path.split('/');
    const dir = parts.length > 1 ? parts.slice(-2, -1)[0] : '';
    if (!p) {
      const x = /(^|\/)(event\.json|thumb\.png)$/i.exec(path);
      if (x) extras.push({ dir, kind: x[2].toLowerCase() === 'thumb.png' ? 'thumb' : 'eventJson', file });
      continue;
    }
    const isRecent = /RecentClips/i.test(path) || !/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(dir);
    const cat = categoryOf(path);
    const m = isRecent ? (cat === 'recent' ? recent : loose) : (dirs.get(dir) ?? dirs.set(dir, new Map()).get(dir));
    if (!isRecent) dirCat.set(dir, cat);
    const seg = m.get(p.ts) ?? { ts: p.ts, cams: {} };
    m.set(p.ts, seg);
    seg.cams[p.cam] = file;
  }
  const sorted = (m) => [...m.values()].sort((a, b) => a.ts.localeCompare(b.ts));
  const mk = (kind, name, segments, category) => {
    const start = tsToDate(segments[0].ts);
    return { name: name ?? `Trip ${p2(start.getHours())}:${p2(start.getMinutes())} · ${dur(segments.length)}`, segments, start, kind, category, day: dayKey(start) };
  };
  const out = [];
  for (const [dir, m] of dirs)
    splitByGap(sorted(m), EVENT_GAP_S).forEach((r, i) => out.push(mk('event', i ? `${dir} (${i + 1})` : dir, r, dirCat.get(dir))));
  for (const [m, cat] of [[recent, 'recent'], [loose, 'loose']])
    if (m.size) for (const r of splitByGap(sorted(m), TRIP_GAP_S)) out.push(mk('trip', null, r, cat));
  for (const x of extras) { const ev = out.find((e) => e.kind === 'event' && e.name === x.dir); if (ev) ev[x.kind] = x.file; }
  return out.sort((a, b) => b.start - a.start);
}

const REASONS = {
  sentry_aware_object_detection: 'Sentry: object detected',
  user_interaction_dashcam_icon_tap: 'Saved: dashcam icon tap',
  user_interaction_dashcam_panel_save: 'Saved: dashcam panel',
};

/** Parsed Tesla event.json -> { reason, place } display strings ('' when unknown). */
export function formatEventInfo(j) {
  if (!j || typeof j !== 'object') return { reason: '', place: '' };
  const r = String(j.reason ?? '');
  const reason = REASONS[r] ?? r.replace(/^user_interaction_/, '').replace(/_/g, ' ');
  const lat = +j.est_lat, lon = +j.est_lon;
  const place = [j.street, j.city].filter(Boolean).join(', ') ||
    (Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon) ? `${lat.toFixed(4)}, ${lon.toFixed(4)}` : '');
  return { reason, place };
}

export function tsToDate(ts) {
  const [d, t] = ts.split('_');
  return new Date(`${d}T${t.replace(/-/g, ':')}`);
}
