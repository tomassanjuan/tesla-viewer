// Map panel: offline canvas track by default; optional OpenStreetMap tiles (opt-in).
import { t } from './i18n.js';
const TS = 256;
const css = (v) => (typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888' : '#888');

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

export function createMap(canvas) {
  const x = canvas.getContext('2d'), imgs = new Map();
  let tiles = false, big = false, last = [null, null];
  const [W0, H0] = [canvas.width, canvas.height];

  function tileImg(t) {
    const k = `${t.z}/${t.x}/${t.y}`;
    if (!imgs.has(k)) {
      const im = new Image(); im.onload = () => { bump(); draw(...last); };
      im.src = `https://tile.openstreetmap.org/${k}.png`;
      imgs.set(k, im);
    }
    return imgs.get(k);
  }

  // The track and tiles are static per event: render them once to an offscreen canvas and
  // only blit it plus the position dot on each update (called ~12x/s during playback).
  let base = null, baseKey = null, baseP = null, gen = 0, ptsSrc, pts = [], accent = '#e31937';
  const bump = () => { gen++; };
  if (typeof addEventListener === 'function') addEventListener('themechange', bump); // repaint with new theme colours

  function paintBase(pts, W, H) {
    base ??= document.createElement('canvas');
    base.width = W; base.height = H;
    const g = base.getContext('2d');
    let P;
    if (tiles) {
      const b = bounds(pts), clat = (b.minLat + b.maxLat) / 2, clon = (b.minLon + b.maxLon) / 2;
      const z = fitZoom(b, W, H), [cx, cy] = project(clat, clon, z);
      for (const t of tilesForView(clat, clon, z, W, H)) {
        const im = tileImg(t); if (im.complete && im.naturalWidth) g.drawImage(im, t.px, t.py);
      }
      P = (p) => { const [a, c] = project(p.lat, p.lon, z); return [a - cx + W / 2, c - cy + H / 2]; };
      const s = '© OpenStreetMap contributors'; g.font = '10px sans-serif';
      const w = g.measureText(s).width;
      g.fillStyle = '#000a'; g.fillRect(W - w - 8, H - 15, w + 8, 15); g.fillStyle = '#fff'; g.fillText(s, W - w - 4, H - 4);
    } else {
      const k = Math.cos((pts[0].lat * Math.PI) / 180);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of pts) { const X = p.lon * k, Y = -p.lat; if (X < minX) minX = X; if (X > maxX) maxX = X; if (Y < minY) minY = Y; if (Y > maxY) maxY = Y; }
      const sc = Math.min((W - 20) / (maxX - minX || 1e-6), (H - 20) / (maxY - minY || 1e-6));
      P = (p) => [10 + (p.lon * k - minX) * sc, 10 + (-p.lat - minY) * sc];
    }
    g.strokeStyle = css('--info'); g.lineWidth = 2; g.beginPath();
    pts.forEach((p, i) => { const [a, b] = P(p); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.stroke();
    baseP = P; accent = css('--accent');
  }

  function draw(points, cur) {
    last = [points, cur];
    const W = canvas.width, H = canvas.height;
    x.clearRect(0, 0, W, H);
    if (points !== ptsSrc) { ptsSrc = points; pts = (points || []).filter((s) => s.lat || s.lon); baseKey = null; }
    if (!pts.length) { x.fillStyle = css('--mut'); x.fillText('No GPS', 10, 20); return; }
    const key = `${W}x${H}|${tiles}|${gen}`;
    if (key !== baseKey) { paintBase(pts, W, H); baseKey = key; }
    x.drawImage(base, 0, 0);
    const [a, b] = baseP(cur && (cur.lat || cur.lon) ? cur : pts[0]);
    x.fillStyle = accent; x.beginPath(); x.arc(a, b, 4, 0, 7); x.fill();
  }

  canvas.addEventListener('click', () => {
    big = !big; canvas.width = big ? W0 * 3 : W0; canvas.height = big ? H0 * 3 : H0;
    canvas.classList.toggle('big', big); draw(...last);
  });
  return { update: draw, setTiles(on) { tiles = !!on; draw(...last); } };
}
