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

export const REGULAR_GAP_MAX_S = 900; // a repeating gap up to this long (e.g. a clip every 5 min) does not split a group

/** Split sorted segments where start - (prevStart + 60 s) > gapS, except gaps that repeat with a consistent length
 *  (>= 2 within +-25 % of their median, median <= REGULAR_GAP_MAX_S): those keep the clips in one group. */
function splitByGap(segs, gapS) {
  const ts = segs.map((s) => tsToDate(s.ts).getTime());
  const gaps = ts.map((t, i) => (i ? (t - ts[i - 1]) / 1000 - SEG_S : 0));
  const big = gaps.filter((g) => g > gapS).sort((a, b) => a - b);
  const med = big[big.length >> 1];
  const regular = (g) => g > gapS && med <= REGULAR_GAP_MAX_S && Math.abs(g - med) <= med * 0.25;
  const keep = big.filter(regular).length >= 2;
  const runs = [];
  segs.forEach((s, i) => { if (!i || (gaps[i] > gapS && !(keep && regular(gaps[i])))) runs.push([]); runs[runs.length - 1].push(s); });
  return runs;
}

export const CATEGORIES = ['recent', 'saved', 'sentry', 'loose'];
/** TeslaCam folder an event came from; 'loose' = clips outside the standard folders. */
export function categoryOf(path) {
  const m = /(^|\/)(Recent|Saved|Sentry)Clips(\/|$)/i.exec(path);
  return m ? m[2].toLowerCase() : 'loose';
}

export const EVENT_TYPES = ['emergency_braking', 'collision', 'handle', 'person', 'motion', 'honk', 'saved'];
export const RAW_PREFIX = 'raw:';
/** Event type from event.json `reason`: a known type, `raw:<reason>` for any other reason (shown under its own text), or null without a reason. */
export function eventType(e) {
  const r = String(e.reason ?? '');
  if (/emergency_brak/i.test(r)) return 'emergency_braking';
  if (/collision|crash|accident|airbag/i.test(r)) return 'collision';
  if (/handle_pulled/i.test(r)) return 'handle';
  if (/^sentry.*(object|person)/i.test(r)) return 'person';
  if (/^sentry.*(motion|accel)/i.test(r)) return 'motion';
  if (/honk/i.test(r)) return 'honk';
  if (/^user_interaction/i.test(r)) return 'saved';
  return r ? RAW_PREFIX + r : e.category === 'saved' ? 'saved' : null;
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
  vehicle_auto_emergency_braking: 'Emergency braking',
  sentry_locked_handle_pulled: 'Door handle pulled while locked',
  sentry_accel: 'Sentry: motion detected',
  user_interaction_honk: 'Honk',
  user_interaction_dashcam_icon_tapped: 'Saved: dashcam icon tap',
};

/** Parsed Tesla event.json -> { reason, place } display strings ('' when unknown). */
export function formatEventInfo(j) {
  if (!j || typeof j !== 'object') return { reason: '', place: '', city: '' };
  const r = String(j.reason ?? '');
  const reason = REASONS[r] ?? r.replace(/^user_interaction_/, '').replace(/_/g, ' ');
  const lat = +j.est_lat, lon = +j.est_lon;
  const place = [j.street, j.city].filter(Boolean).join(', ') ||
    (Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon) ? `${lat.toFixed(4)}, ${lon.toFixed(4)}` : '');
  return { reason, place, city: String(j.city ?? '').trim() };
}

export const GROUPS = ['none', 'day', 'month', 'city', 'type', 'kind', 'cams', 'length'];
export const SORTS = ['newest', 'oldest', 'longest', 'shortest', 'cams'];
export const camCount = (e) => new Set(e.segments.flatMap((s) => Object.keys(s.cams))).size;
export const LENGTH_BUCKETS = ['10+', '5-10', '2-5', '<2'];
const lengthBucket = (e) => { const n = e.segments.length; return n >= 10 ? '10+' : n >= 5 ? '5-10' : n >= 2 ? '2-5' : '<2'; };
const typeRank = (k) => { const i = EVENT_TYPES.indexOf(k); return i >= 0 ? i : k ? EVENT_TYPES.length : EVENT_TYPES.length + 1; };

/** Sorted copy of events: newest/oldest by start time, longest/shortest by segment count, cams = most cameras first (ties newest first). */
export function sortEvents(events, by = 'newest') {
  const t = (e) => +e.start;
  const cmp = {
    newest: (a, b) => t(b) - t(a),
    oldest: (a, b) => t(a) - t(b),
    longest: (a, b) => b.segments.length - a.segments.length || t(b) - t(a),
    shortest: (a, b) => a.segments.length - b.segments.length || t(b) - t(a),
    cams: (a, b) => camCount(b) - camCount(a) || t(b) - t(a),
  }[by] ?? ((a, b) => t(b) - t(a));
  return [...events].sort(cmp);
}

/** Group key of one event: '' = unknown/none (rendered last where it applies). */
function groupKey(e, by) {
  switch (by) {
    case 'day': return e.segments[0]?.ts.slice(0, 10) ?? '';
    case 'month': return e.segments[0]?.ts.slice(0, 7) ?? '';
    case 'city': return e.city ?? '';
    case 'type': return eventType(e) ?? '';
    case 'kind': return e.kind;
    case 'cams': return String(camCount(e));
    case 'length': return lengthBucket(e);
    default: return '';
  }
}

/** Split events into [{ key, events }] by one of GROUPS, keeping the incoming event order inside each group.
 *  day/month keep first-appearance order (follows the sort); city is alphabetical, unknown last; type follows EVENT_TYPES
 *  (other reasons alphabetical, no type last); kind = trips then events; cams = most first; length = longest first. 'none' = one group. */
export function groupEvents(events, by = 'none') {
  if (!GROUPS.includes(by) || by === 'none') return [{ key: '', events }];
  const m = new Map();
  for (const e of events) {
    const k = groupKey(e, by);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(e);
  }
  const out = [...m].map(([key, events]) => ({ key, events }));
  const order = {
    city: (a, b) => !a.key - !b.key || a.key.localeCompare(b.key),
    type: (a, b) => typeRank(a.key) - typeRank(b.key) || a.key.localeCompare(b.key),
    kind: (a, b) => (a.key === 'trip' ? -1 : 1) - (b.key === 'trip' ? -1 : 1),
    cams: (a, b) => b.key - a.key,
    length: (a, b) => LENGTH_BUCKETS.indexOf(a.key) - LENGTH_BUCKETS.indexOf(b.key),
  }[by];
  return order ? out.sort(order) : out;
}

export function tsToDate(ts) {
  const [d, t] = ts.split('_');
  return new Date(`${d}T${t.replace(/-/g, ':')}`);
}
