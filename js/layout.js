// Spatial camera layout that mirrors the car: pillars top corners, front top middle,
// back bottom middle, repeaters (fenders) bottom corners.
const SLOT = {
  left_pillar: [0, 0], front: [1, 0], right_pillar: [2, 0],
  left_repeater: [0, 1], back: [1, 1], right_repeater: [2, 1],
};

/** Returns { cols, rows, place: { cam: {col,row} } } (1-based grid lines), dropping empty rows/columns. */
export function spatialLayout(cams) {
  const used = cams.filter((c) => SLOT[c]);
  const cs = [...new Set(used.map((c) => SLOT[c][0]))].sort(), rs = [...new Set(used.map((c) => SLOT[c][1]))].sort();
  const place = {};
  for (const c of used) place[c] = { col: cs.indexOf(SLOT[c][0]) + 1, row: rs.indexOf(SLOT[c][1]) + 1 };
  return { cols: cs.length || 1, rows: rs.length || 1, place };
}

// ---------- aspect-aware stage fitting ----------
// Tiles are sized to each video's real aspect ratio (never cropped, no letterbox/pillarbox inside a tile), and the
// arrangement (car-shaped grid, plain rows x cols, or a big hero tile beside a grid) is the one that shows the most video.
export const DEFAULT_AR = 4 / 3;

const fitBox = (w, h, ar) => (w / ar <= h ? { w, h: w / ar } : { w: h * ar, h });

/** Packs items ({id,ar,col,row}, 0-based) into cols x rows inside box; every tile is exactly its video's size, centered in its cell, block centered in box. */
function packGrid(items, cols, rows, box, gap) {
  const cw = (box.w - (cols - 1) * gap) / cols, ch = (box.h - (rows - 1) * gap) / rows;
  const fits = items.map((i) => ({ i, ...fitBox(cw, ch, i.ar) }));
  const colW = Array(cols).fill(0), rowH = Array(rows).fill(0);
  for (const f of fits) { colW[f.i.col] = Math.max(colW[f.i.col], f.w); rowH[f.i.row] = Math.max(rowH[f.i.row], f.h); }
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const x0 = box.x + (box.w - sum(colW) - (cols - 1) * gap) / 2, y0 = box.y + (box.h - sum(rowH) - (rows - 1) * gap) / 2;
  const rects = {}; let area = 0; const mean = sum(colW) / cols;
  for (const f of fits) {
    const cx = x0 + sum(colW.slice(0, f.i.col)) + f.i.col * gap, cy = y0 + sum(rowH.slice(0, f.i.row)) + f.i.row * gap;
    rects[f.i.id] = { x: cx + (f.i.shift || 0) * (mean + gap) + (colW[f.i.col] - f.w) / 2, y: cy + (rowH[f.i.row] - f.h) / 2, w: f.w, h: f.h };
    area += f.w * f.h;
  }
  return { rects, area };
}

/** n items in reading order, laid into `cols` columns (a short last row is centered). */
const flow = (cams, cols) => cams.map((c, k) => { const row = Math.floor(k / cols), inRow = Math.min(cols, cams.length - row * cols); return { ...c, col: k % cols, row, shift: (cols - inRow) / 2 }; }); // a short last row is centered, not left with a black hole

/**
 * Chooses the arrangement that maximises displayed video area.
 * cams: [{id, ar}] (ar = width/height of the real video); place: spatialLayout() result for the car-shaped grid;
 * hero: id of the camera that may get the big tile. The car-shaped grid wins unless another arrangement shows >5% more.
 * Returns { mode, rects: {id:{x,y,w,h}}, area, wasted } where wasted = fraction of the box not covered by video.
 */
export function fitStage({ W, H, cams, place, hero, gap = 3, pad = 3 }) {
  const box = { x: pad, y: pad, w: Math.max(1, W - 2 * pad), h: Math.max(1, H - 2 * pad) };
  const total = box.w * box.h, n = cams.length;
  const done = (mode, r) => ({ mode, rects: r.rects, area: r.area, wasted: 1 - r.area / total });
  if (!n) return { mode: 'empty', rects: {}, area: 0, wasted: 1 };
  if (n === 1) return done('single', packGrid([{ ...cams[0], col: 0, row: 0 }], 1, 1, box, 0));
  let spatial = null;
  if (place && cams.every((c) => place[c.id])) {
    const items = cams.map((c) => ({ ...c, col: place[c.id].col - 1, row: place[c.id].row - 1 }));
    spatial = packGrid(items, Math.max(...items.map((i) => i.col)) + 1, Math.max(...items.map((i) => i.row)) + 1, box, gap);
  }
  let best = spatial && { mode: 'spatial', r: spatial };
  const consider = (mode, r) => { if (!best || r.area > best.r.area * (best.mode === 'spatial' ? 1.05 : 1.0001)) best = { mode, r }; };
  for (let c = 1; c <= n; c++) consider('rows', packGrid(flow(cams, c), c, Math.ceil(n / c), box, gap));
  const h = cams.find((c) => c.id === hero);
  if (h && n > 2) {
    const rest = cams.filter((c) => c !== h);
    for (const side of ['left', 'right']) for (let f = 0.2; f <= 0.8; f += 0.025) {
      const hw = box.w * f - gap / 2, rw = box.w - hw - gap;
      const hb = { x: side === 'left' ? box.x : box.x + rw + gap, y: box.y, w: hw, h: box.h }, rb = { x: side === 'left' ? box.x + hw + gap : box.x, y: box.y, w: rw, h: box.h };
      for (let c = 1; c <= rest.length; c++) {
        const a = packGrid([{ ...h, col: 0, row: 0 }], 1, 1, hb, 0), b = packGrid(flow(rest, c), c, Math.ceil(rest.length / c), rb, gap);
        consider('hero', { rects: { ...a.rects, ...b.rects }, area: a.area + b.area });
      }
    }
  }
  return done(best.mode, best.r);
}
