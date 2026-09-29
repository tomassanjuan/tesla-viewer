// Group dropped files into events: { name, segments:[{ts, cams:{front:File,...}}] }
export const CAMS = ['front', 'back', 'left_repeater', 'right_repeater', 'left_pillar', 'right_pillar'];
const RE = /(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})-(front|back|left_repeater|right_repeater|left_pillar|right_pillar)\.mp4$/i;

export function parseName(path) {
  const m = RE.exec(path);
  return m ? { ts: m[1], cam: m[2].toLowerCase() } : null;
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
  const events = new Map(), extras = [];
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
    const key = isRecent ? (cat === 'recent' ? 'Recent clips' : 'Loose clips') : dir;
    const ev = events.get(key) ?? { name: key, category: cat, segMap: new Map() };
    events.set(key, ev);
    const seg = ev.segMap.get(p.ts) ?? { ts: p.ts, cams: {} };
    ev.segMap.set(p.ts, seg);
    seg.cams[p.cam] = file;
  }
  for (const x of extras) { const ev = events.get(x.dir); if (ev) ev[x.kind] = x.file; }
  return [...events.values()]
    .map((e) => ({ name: e.name, category: e.category, eventJson: e.eventJson, thumb: e.thumb, segments: [...e.segMap.values()].sort((a, b) => a.ts.localeCompare(b.ts)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
