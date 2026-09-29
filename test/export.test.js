import test from 'node:test';
import assert from 'node:assert/strict';
import { clampRange, segmentRanges, exportFilename, pickMime, layoutRects } from '../js/export.js';

test('clampRange', () => {
  assert.deepEqual(clampRange(-5, 500, 120), { start: 0, end: 120 });
  assert.deepEqual(clampRange(30, 10, 120), { start: 10, end: 30 });
  assert.equal(clampRange(5, 5.05, 120), null);
});
test('segmentRanges', () => {
  const segs = [{ start: 0, dur: 60 }, { start: 60, dur: 60 }, { start: 120, dur: 30 }];
  assert.deepEqual(segmentRanges(segs, 50, 130), [{ i: 0, from: 50, to: 60 }, { i: 1, from: 0, to: 60 }, { i: 2, from: 0, to: 10 }]);
  assert.deepEqual(segmentRanges(segs, 60, 61), [{ i: 1, from: 0, to: 1 }]);
});
test('exportFilename', () => assert.equal(exportFilename('2025 06/01', 65, 130.5, 'webm'), '2025_06_01_1m05s-2m10s.webm'));
test('pickMime', () => {
  assert.deepEqual(pickMime((t) => t === 'video/webm'), { mime: 'video/webm', ext: 'webm' });
  assert.equal(pickMime((t) => t === 'video/mp4').ext, 'mp4');
  assert.equal(pickMime(() => false), null);
});
test('layoutRects', () => {
  assert.equal(layoutRects(['a', 'b', 'c', 'd', 'e', 'f'], 'a', false, 300, 200).length, 6);
  assert.deepEqual(layoutRects(['a', 'b'], 'b', true, 100, 50), [['b', 0, 0, 100, 50]]);
  assert.deepEqual(layoutRects(['a', 'b', 'c', 'd'], 'a', false, 100, 100)[3], ['d', 50, 50, 50, 50]);
});
