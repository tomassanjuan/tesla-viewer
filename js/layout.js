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
