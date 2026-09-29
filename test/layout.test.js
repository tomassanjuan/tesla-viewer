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
