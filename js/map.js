// Map panel: OpenStreetMap tiles by default (toggle, persisted); offline canvas track when off/offline/tile fails.
import { t } from './i18n.js';
const css = (v) => (typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888' : '#888');
const TS = 256;

// Web Mercator: lat/lon -> world pixel coords at zoom z (256px tiles).
export function project(lat, lon, z) {
  const n = TS * 2 ** z, s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}
export const latLonToTile = (lat, lon, z) => {
  const [x, y] = project(lat, lon, z), m = 2 ** z;
  return { x: Math.min(m - 1, Math.floor(x / TS)), y: Math.min(m - 1, Math.floor(y / TS)), z };
};
// Largest integer zoom at which the bounds fit in w x h (with pad px margin).
export function fitZoom(b, w, h, pad = 10, maxZ = 18) {
  for (let z = maxZ; z > 0; z--) {
    const [x0, y0] = project(b.maxLat, b.minLon, z), [x1, y1] = project(b.minLat, b.maxLon, z);
    if (x1 - x0 <= w - 2 * pad && y1 - y0 <= h - 2 * pad) return z;
  }
  return 0;
}
export function unproject(px, py, z) {
  const n = TS * 2 ** z, lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / n))) * 180) / Math.PI;
  return [lat, (px / n) * 360 - 180];
}
// Fractional zoom (0..maxZ) at which bounds fit w x h with pad px margin; mercator spans scale exactly by 2^z.
export function fitZoomFrac(b, w, h, pad = 10, maxZ = 18) {
  const [x0, y0] = project(b.maxLat, b.minLon, 0), [x1, y1] = project(b.minLat, b.maxLon, 0);
  const r = Math.min((w - 2 * pad) / (x1 - x0 || 1e-9), (h - 2 * pad) / (y1 - y0 || 1e-9));
  return Math.max(0, Math.min(maxZ, Math.log2(Math.max(r, 1e-9))));
}
export function bounds(pts) {
  const la = pts.map((p) => p.lat), lo = pts.map((p) => p.lon);
  return { minLat: Math.min(...la), maxLat: Math.max(...la), minLon: Math.min(...lo), maxLon: Math.max(...lo) };
}
// Tiles covering a w x h view centred on (lat,lon) at zoom z, with pixel offsets on canvas.
export function tilesForView(lat, lon, z, w, h) {
  const [cx, cy] = project(lat, lon, z), ox = cx - w / 2, oy = cy - h / 2, m = 2 ** z, out = [];
  for (let ty = Math.floor(oy / TS); ty <= Math.floor((oy + h) / TS); ty++)
    for (let tx = Math.floor(ox / TS); tx <= Math.floor((ox + w) / TS); tx++)
      if (ty >= 0 && ty < m) out.push({ x: ((tx % m) + m) % m, y: ty, z, px: tx * TS - ox, py: ty * TS - oy });
  return out;
}

const CSS = '#mapbox{position:relative}.mp-re{position:absolute;top:4px;right:4px;font:11px sans-serif;padding:2px 6px;border-radius:4px;border:1px solid #fff5;background:#000a;color:#fff;cursor:pointer;z-index:1}.mp-re[hidden]{display:none}#map.mp-drag{cursor:grabbing}';
const KEY = 'tiles', MAXC = 200;
const NOTE = ' Show map tiles. Loads OpenStreetMap tiles; sends map area to tile server';
const store = { get() { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } }, set(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch {} } };

export function createMap(canvas) {
  const x = canvas.getContext('2d'), cache = new Map();
  let tiles = store.get(), big = false, last = [null, null], W = canvas.width, H = canvas.height, dpr = 1;
  let mode = 'fit', view = null; // mode: fit | follow | free; view: {lat, lon, z}
  const doc = typeof document !== 'undefined' ? document : null;
  let re = null;
  if (doc) {
    const st = doc.createElement('style'); st.textContent = CSS; doc.head.append(st);
    re = doc.createElement('button'); re.className = 'mp-re'; re.textContent = 'Recenter'; re.hidden = true; re.type = 'button';
    canvas.after(re);
    const cb = doc.getElementById('tiles');
    if (cb) {
      cb.checked = tiles; cb.addEventListener('change', () => { tiles = cb.checked; store.set(tiles); draw(...last); });
      const l = cb.closest('label'); if (l) l.lastChild.textContent = NOTE;
    }
  }

  function tileImg(t) {
    const k = `${t.z}/${t.x}/${t.y}`;
    let e = cache.get(k);
    if (e) { cache.delete(k); cache.set(k, e); return e; } // LRU bump
    e = { im: new Image(), tries: 0, failed: false };
    e.im.onload = () => draw(...last);
    e.im.onerror = () => { if (e.tries++ < 1) e.im.src = `https://tile.openstreetmap.org/${k}.png?r=1`; else e.failed = true; };
    e.im.src = `https://tile.openstreetmap.org/${k}.png`;
    cache.set(k, e);
    if (cache.size > MAXC) cache.delete(cache.keys().next().value);
    return e;
  }

  function resize() {
    const r = canvas.getBoundingClientRect(); if (!r.width || !r.height) return;
    dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
    W = r.width; H = r.height;
    const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; draw(...last); }
  }

  function draw(points, cur) {
    last = [points, cur];
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, W, H);
    const pts = (points || []).filter((s) => s.lat || s.lon);
    x.font = '10px sans-serif';
    if (!pts.length) { x.fillStyle = css('--mut'); x.fillText(t('No GPS'), 10, 20); return; }
    const ci = Math.max(0, pts.indexOf(cur)), me = pts[ci], b = bounds(pts);
    const fit = { lat: (b.minLat + b.maxLat) / 2, lon: (b.minLon + b.maxLon) / 2, z: fitZoomFrac(b, W, H, 14) };
    if (!view) view = { ...fit };
    if (mode === 'fit') view = fit; else if (mode === 'follow') view = { ...view, lat: me.lat, lon: me.lon };
    const z = view.z, [cx, cy] = project(view.lat, view.lon, z);
    const P = (p) => { const [a, c] = project(p.lat, p.lon, z); return [a - cx + W / 2, c - cy + H / 2]; };
    x.fillStyle = '#161b22'; x.fillRect(0, 0, W, H); // offline backdrop
    if (tiles && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
      const tz = Math.max(0, Math.min(19, Math.round(z))), s = 2 ** (z - tz);
      x.save(); x.scale(s, s);
      for (const t of tilesForView(view.lat, view.lon, tz, W / s, H / s)) {
        const e = tileImg(t); if (!e.failed && e.im.complete && e.im.naturalWidth) x.drawImage(e.im, t.px, t.py, TS, TS);
      }
      x.restore();
      const a = '© OpenStreetMap contributors', w = x.measureText(a).width;
      x.fillStyle = '#000a'; x.fillRect(W - w - 8, H - 15, w + 8, 15); x.fillStyle = '#fff'; x.fillText(a, W - w - 4, H - 4);
    }
    const line = (arr, col, lw) => {
      if (arr.length < 2) return;
      x.strokeStyle = col; x.lineWidth = lw; x.lineJoin = 'round'; x.beginPath();
      arr.forEach((p, i) => { const [a, c] = P(p); i ? x.lineTo(a, c) : x.moveTo(a, c); }); x.stroke();
    };
    line(pts.slice(ci), 'rgba(139,147,161,.55)', 2); // future, dimmed
    line(pts.slice(0, ci + 1), css('--info'), 3); // trail so far
    const [a, c] = P(me);
    x.save(); x.translate(a, c); x.lineWidth = 1.5; x.strokeStyle = '#fff'; x.fillStyle = css('--accent'); x.beginPath();
    if (typeof me.heading === 'number' && isFinite(me.heading)) {
      x.rotate((me.heading * Math.PI) / 180); x.moveTo(0, -8); x.lineTo(5, 6); x.lineTo(0, 3); x.lineTo(-5, 6); x.closePath();
    } else x.arc(0, 0, 4, 0, 7);
    x.fill(); x.stroke(); x.restore();
    if (re) re.hidden = mode !== 'free';
  }

  // drag to pan, wheel to zoom, click (without drag) to enlarge
  let drag = null, moved = false;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; moved = false; canvas.setPointerCapture?.(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || !view) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true; mode = 'free'; canvas.classList.add('mp-drag');
    const [cx, cy] = project(view.lat, view.lon, view.z); [view.lat, view.lon] = unproject(cx - dx, cy - dy, view.z);
    drag = { x: e.clientX, y: e.clientY }; draw(...last);
  });
  const end = () => { drag = null; canvas.classList.remove('mp-drag'); };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    if (!view) return; e.preventDefault(); mode = 'free';
    view.z = Math.max(0, Math.min(18, view.z - Math.sign(e.deltaY) * 0.5)); draw(...last);
  }, { passive: false });
  canvas.addEventListener('click', () => {
    if (moved) { moved = false; return; }
    big = !big; canvas.classList.toggle('big', big); resize();
  });
  re?.addEventListener('click', () => { mode = 'follow'; draw(...last); });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(canvas);
  resize();
  return { update: draw, setTiles(on) { tiles = !!on; store.set(tiles); draw(...last); } };
}
