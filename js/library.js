// Group dropped files into events: { name, segments:[{ts, cams:{front:File,...}}] }
export const CAMS = ['front', 'back', 'left_repeater', 'right_repeater', 'left_pillar', 'right_pillar'];
const RE = /(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})-(front|back|left_repeater|right_repeater|left_pillar|right_pillar)\.mp4$/i;

export function parseName(path) {
  const m = RE.exec(path);
  return m ? { ts: m[1], cam: m[2].toLowerCase() } : null;
}

/** files: [{path, file}] where path is the relative path (folders give event names). */
export function groupFiles(files) {
  const events = new Map();
  for (const { path, file } of files) {
    const p = parseName(path);
    if (!p) continue;
    const parts = path.split('/');
    const dir = parts.length > 1 ? parts.slice(-2, -1)[0] : '';
    const isRecent = /RecentClips/i.test(path) || !/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(dir);
    const key = isRecent ? 'Recent / loose clips' : dir;
    const ev = events.get(key) ?? { name: key, segMap: new Map() };
    events.set(key, ev);
    const seg = ev.segMap.get(p.ts) ?? { ts: p.ts, cams: {} };
    ev.segMap.set(p.ts, seg);
    seg.cams[p.cam] = file;
  }
  return [...events.values()]
    .map((e) => ({ name: e.name, segments: [...e.segMap.values()].sort((a, b) => a.ts.localeCompare(b.ts)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function tsToDate(ts) {
  const [d, t] = ts.split('_');
  return new Date(`${d}T${t.replace(/-/g, ':')}`);
}
