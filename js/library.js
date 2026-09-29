// Group dropped files into events: { name, segments:[{ts, cams:{front:File,...}}] }
export const CAMS = ['front', 'back', 'left_repeater', 'right_repeater', 'left_pillar', 'right_pillar'];
const RE = /(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})-(front|back|left_repeater|right_repeater|left_pillar|right_pillar)\.mp4$/i;

export function parseName(path) {
  const m = RE.exec(path);
  return m ? { ts: m[1], cam: m[2].toLowerCase() } : null;
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
    const key = isRecent ? 'Recent / loose clips' : dir;
    const ev = events.get(key) ?? { name: key, segMap: new Map() };
    events.set(key, ev);
    const seg = ev.segMap.get(p.ts) ?? { ts: p.ts, cams: {} };
    ev.segMap.set(p.ts, seg);
    seg.cams[p.cam] = file;
  }
  for (const x of extras) { const ev = events.get(x.dir); if (ev) ev[x.kind] = x.file; }
  return [...events.values()]
    .map((e) => ({ name: e.name, eventJson: e.eventJson, thumb: e.thumb, segments: [...e.segMap.values()].sort((a, b) => a.ts.localeCompare(b.ts)) }))
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
