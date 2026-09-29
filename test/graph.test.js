import test from 'node:test';
import assert from 'node:assert/strict';
import { niceTicks, timeTicks, downsample, xToTime, valueToY, spans, fmtTime } from '../js/graph.js';

test('niceTicks', () => {
  assert.deepEqual(niceTicks(0, 119, 5), [0, 50, 100]);
  assert.deepEqual(niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
  assert.ok(niceTicks(3, 3, 4).length > 0);
});
test('timeTicks cover 0..total', () => {
  assert.deepEqual(timeTicks(60, 6), [0, 10, 20, 30, 40, 50, 60]);
  assert.equal(timeTicks(0)[0], 0);
  assert.equal(fmtTime(75), '1:15');
});
test('downsample keeps min/max per bucket', () => {
  const s = Array.from({ length: 1000 }, (_, i) => ({ t: i, v: i === 500 ? 99 : 1 }));
  const d = downsample(s, 10);
  assert.ok(d.length <= 20 && d.some((p) => p.v === 99));
  assert.ok(d.every((p, i) => !i || p.t >= d[i - 1].t));
  assert.equal(downsample(s.slice(0, 5), 10).length, 5);
});
test('xToTime / valueToY', () => {
  assert.equal(xToTime(50, 0, 100, 60), 30);
  assert.equal(xToTime(-5, 0, 100, 60), 0);
  assert.equal(xToTime(500, 0, 100, 60), 60);
  assert.equal(valueToY(0, 0, 100, 10, 110), 110);
  assert.equal(valueToY(100, 0, 100, 10, 110), 10);
});
test('spans', () => {
  const s = [0, 1, 1, 0, 2].map((autopilot, t) => ({ t, autopilot }));
  assert.deepEqual(spans(s, (x) => x.autopilot), [[1, 2], [4, 4]]);
});
