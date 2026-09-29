import test from 'node:test';
import assert from 'node:assert/strict';
import { normRect, hit, activeAt, contentRect, pixelSize } from '../js/blur.js';

test('normRect normalizes, clamps, rejects tiny', () => {
  assert.deepEqual(normRect(200, 100, 100, 50, 400, 200), { x: 0.25, y: 0.25, w: 0.25, h: 0.25 });
  assert.deepEqual(normRect(-50, -50, 900, 900, 400, 200), { x: 0, y: 0, w: 1, h: 1 });
  assert.equal(normRect(10, 10, 11, 11, 400, 200), null);
  assert.equal(normRect(0, 0, 5, 5, 0, 0), null);
});
test('hit', () => {
  const r = { x: 0.2, y: 0.2, w: 0.2, h: 0.2 };
  assert.ok(hit(r, 0.3, 0.3)); assert.ok(!hit(r, 0.5, 0.3));
});
test('activeAt', () => {
  assert.ok(activeAt({ t0: 0, t1: null }, 999));
  assert.ok(activeAt({ t0: 5, t1: 10 }, 10)); assert.ok(!activeAt({ t0: 5, t1: 10 }, 10.1));
  assert.ok(!activeAt({ t0: 0, t1: null, on: false }, 1));
});
test('contentRect letterboxes', () => {
  assert.deepEqual(contentRect(400, 400, 200, 100), { x: 0, y: 100, w: 400, h: 200 });
  assert.equal(contentRect(0, 10, 10, 10), null);
});
test('pixelSize', () => {
  assert.deepEqual(pixelSize(120, 60, 12), { w: 10, h: 5 });
  assert.deepEqual(pixelSize(3, 3, 12), { w: 1, h: 1 });
});
