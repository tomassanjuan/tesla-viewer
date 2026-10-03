// Per-file telemetry cache shared by the library badge (probe: does the clip carry SEI?) and event open (full parse).
// Memory first, IndexedDB behind it (survives reloads, keyed by name+size+lastModified). Every path degrades to memory-only.
const V = 1, DB = 'tv-telemetry', STORE = 'clips', MAX = 400;
const mem = new Map(); // key -> { probe?: boolean, clip?: object }

/** Stable identity for a picked File; null for anything we can't identify (plain Blobs), which is then never cached. */
export const clipKey = (f) => (f && typeof f.name === 'string' && f.lastModified != null ? `v${V}|${f.webkitRelativePath || f.name}|${f.size}|${f.lastModified}` : null);

let dbp;
const db = () => dbp ??= new Promise((res) => {
  try {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE).createIndex('at', 'at'); };
    r.onsuccess = () => res(r.result);
    r.onerror = r.onblocked = () => res(null);
  } catch { res(null); }
});
const tx = async (mode, fn) => {
  const d = await db(); if (!d) return null;
  return new Promise((res) => {
    try { const t = d.transaction(STORE, mode), out = fn(t.objectStore(STORE)); t.oncomplete = () => res(out?.result ?? null); t.onerror = t.onabort = () => res(null); } catch { res(null); }
  });
};

async function load(key) {
  if (!key) return null;
  if (mem.has(key)) return mem.get(key);
  const e = await tx('readonly', (s) => s.get(key));
  if (e && !mem.has(key)) mem.set(key, { probe: e.probe, clip: e.clip });
  return mem.get(key) ?? null;
}
async function save(key, entry) {
  mem.set(key, entry);
  await tx('readwrite', (s) => {
    s.put({ ...entry, at: Date.now() }, key);
    const c = s.count();
    c.onsuccess = () => {
      let extra = c.result - MAX; if (extra <= 0) return;
      s.index('at').openKeyCursor().onsuccess = (ev) => { const cur = ev.target.result; if (cur && extra-- > 0) { s.delete(cur.primaryKey); cur.continue(); } };
    };
  });
}

/** true / false, or undefined when unknown. A cached full parse answers too. */
export async function getProbe(key) {
  const e = await load(key);
  if (!e) return undefined;
  return e.probe ?? (e.clip ? clipHasTelemetry(e.clip) : undefined);
}
export const setProbe = async (key, probe) => { if (key && typeof probe === 'boolean') await save(key, { ...(await load(key)), probe }); };
export const getClip = async (key) => (await load(key))?.clip ?? null;
export async function setClip(key, clip) {
  if (!key) return;
  const probe = clipHasTelemetry(clip);
  await save(key, { probe: probe ?? undefined, clip });
}
/** Full parse -> badge answer: samples => true; none on H.264 => false; HEVC without samples can't prove absence => null. */
export const clipHasTelemetry = (c) => (c.samples.length ? true : c.hevc ? null : false);
export const clearMemory = () => mem.clear();
