import test from 'node:test';
import assert from 'node:assert/strict';
import { spatialLayout } from '../js/layout.js';

test('six cameras: car-shaped 3x2 grid', () => {
  const l = spatialLayout(['front', 'back', 'left_repeater', 'right_repeater', 'left_pillar', 'right_pillar']);
  assert.deepEqual([l.cols, l.rows], [3, 2]);
  assert.deepEqual(l.place.front, { col: 2, row: 1 });
  assert.deepEqual(l.place.back, { col: 2, row: 2 });
  assert.deepEqual(l.place.left_pillar, { col: 1, row: 1 });
  assert.deepEqual(l.place.right_pillar, { col: 3, row: 1 });
  assert.deepEqual(l.place.left_repeater, { col: 1, row: 2 });
  assert.deepEqual(l.place.right_repeater, { col: 3, row: 2 });
});

test('missing cameras collapse empty rows/columns', () => {
  const l = spatialLayout(['front', 'back']);
  assert.deepEqual([l.cols, l.rows], [1, 2]);
  const four = spatialLayout(['front', 'back', 'left_repeater', 'right_repeater']);
  assert.deepEqual([four.cols, four.rows], [3, 2]);
  assert.deepEqual(four.place.front, { col: 2, row: 1 });
  assert.deepEqual(spatialLayout([]).place, {});
});

import { fitStage, DEFAULT_AR } from '../js/layout.js';
const SIX = ['left_pillar', 'front', 'right_pillar', 'left_repeater', 'back', 'right_repeater'];
const place = spatialLayout(SIX).place;
const cams = (ars = {}) => SIX.map((id) => ({ id, ar: ars[id] ?? DEFAULT_AR }));
const inside = (r, W, H) => r.x >= -1e-6 && r.y >= -1e-6 && r.x + r.w <= W + 1e-6 && r.y + r.h <= H + 1e-6;
const overlap = (a, b) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;

for (const [W, H] of [[1920, 1080], [1620, 700], [1140, 620], [800, 900], [390, 300], [2000, 747], [500, 2000]]) {
  test(`fitStage ${W}x${H}: every tile matches its video aspect, stays in the stage and never overlaps`, () => {
    const ars = { back: 1.2, left_pillar: 16 / 9 };
    const r = fitStage({ W, H, cams: cams(ars), place, hero: 'front' });
    for (const c of cams(ars)) {
      const t = r.rects[c.id];
      assert.ok(inside(t, W, H), `${c.id} inside`);
      assert.ok(Math.abs(t.w / t.h - c.ar) < 1e-6, `${c.id} keeps aspect (no crop, no bars)`);
    }
    const all = Object.values(r.rects);
    all.forEach((a, i) => all.slice(i + 1).forEach((b) => assert.ok(!overlap(a, b))));
  });
}

test('fitStage never wastes more than the plain equal-cell grid would', () => {
  for (const [W, H] of [[1920, 1080], [1440, 900], [2000, 747], [700, 1200]]) {
    const cw = (W - 6 - 6) / 3, ch = (H - 6 - 3) / 2, s = Math.min(cw / DEFAULT_AR, ch), naive = 6 * s * DEFAULT_AR * s;
    const r = fitStage({ W, H, cams: cams(), place, hero: 'front' });
    assert.ok(r.area >= naive - 1, `${W}x${H}: ${r.area} >= ${naive}`);
    assert.ok(r.wasted < 0.6);
  }
});

test('fitStage keeps the car-shaped grid on a typical desktop stage', () => {
  const r = fitStage({ W: 1140, H: 620, cams: cams(), place, hero: 'front' });
  assert.equal(r.mode, 'spatial');
  assert.ok(r.rects.left_pillar.x < r.rects.front.x && r.rects.front.x < r.rects.right_pillar.x);
  assert.ok(r.rects.front.y < r.rects.back.y);
});

test('fitStage switches arrangement when the car-shaped grid wastes a lot', () => {
  const tall = fitStage({ W: 500, H: 1400, cams: cams(), place, hero: 'front' });
  assert.notEqual(tall.mode, 'spatial');
  const spatial = fitStage({ W: 500, H: 1400, cams: cams(), place: spatialLayout(SIX).place, hero: null });
  assert.ok(tall.area >= spatial.area);
});

test('fitStage: single camera fills the stage as far as its aspect allows', () => {
  const r = fitStage({ W: 1000, H: 500, cams: [{ id: 'front', ar: DEFAULT_AR }], pad: 0 });
  assert.deepEqual([Math.round(r.rects.front.w), Math.round(r.rects.front.h)], [667, 500]);
  const wide = fitStage({ W: 400, H: 800, cams: [{ id: 'front', ar: DEFAULT_AR }], pad: 0 });
  assert.equal(Math.round(wide.rects.front.w), 400);
  assert.equal(Math.round(wide.rects.front.h), 300);
});

test('fitStage handles missing cameras and empty input', () => {
  const four = ['front', 'back', 'left_repeater', 'right_repeater'].map((id) => ({ id, ar: DEFAULT_AR }));
  const r = fitStage({ W: 1200, H: 700, cams: four, place: spatialLayout(four.map((c) => c.id)).place, hero: 'front' });
  assert.equal(Object.keys(r.rects).length, 4);
  assert.equal(fitStage({ W: 100, H: 100, cams: [] }).mode, 'empty');
});
