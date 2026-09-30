// Resizable library sidebar: width clamping + persistence. Wired to the drag handle in ui.js.
export const SIDE_MIN = 220, SIDE_MAX = 560, SIDE_DEFAULT = 300, SIDE_KEY = 'tv-side-w';
export const clampSide = (w, vw = Infinity) => {
  const n = Math.round(Number(w));
  return Number.isFinite(n) ? Math.min(SIDE_MAX, Math.max(SIDE_MIN, n), Math.max(SIDE_MIN, vw * 0.6)) : SIDE_DEFAULT;
};
