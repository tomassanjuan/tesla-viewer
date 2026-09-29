import test from 'node:test';
import assert from 'node:assert/strict';
import { due, pickDriftFix, shouldPlay, dropRate } from '../js/perf.js';

test('due throttles to hz', () => {
  assert.equal(due(100, 0, 10), true);
  assert.equal(due(50, 0, 10), false);
});
test('pickDriftFix returns only the worst camera beyond tolerance', () => {
  const cams = [{ id: 'a', time: 10.1 }, { id: 'b', time: 10.5 }, { id: 'c', time: 11 }, { id: 'd', time: 10, paused: true }];
  assert.equal(pickDriftFix(cams, 10), 'c');
  assert.equal(pickDriftFix([{ id: 'a', time: 10.2 }], 10), null);
  assert.equal(pickDriftFix([{ id: 'a', time: 12, seeking: true }], 10), null);
});
test('low load plays only focus', () => {
  assert.equal(shouldPlay('front', 'front', true), true);
  assert.equal(shouldPlay('back', 'front', true), false);
  assert.equal(shouldPlay('back', 'front', false), true);
});
test('dropRate', () => {
  assert.equal(dropRate({ totalVideoFrames: 0, droppedVideoFrames: 0 }, { totalVideoFrames: 100, droppedVideoFrames: 25 }), 25);
  assert.equal(dropRate({ totalVideoFrames: 5, droppedVideoFrames: 0 }, { totalVideoFrames: 5, droppedVideoFrames: 0 }), 0);
});
