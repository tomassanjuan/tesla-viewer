import test from 'node:test';
import assert from 'node:assert/strict';
import { formatClipTime, apStretch, apPercent } from '../js/topbar.js';

test('formatClipTime adds offset to segment timestamp', () => {
  assert.equal(formatClipTime({ ts: '2026-06-01_10-00-00' }, 90), new Date(2026, 5, 1, 10, 1, 30).toLocaleString());
  assert.equal(formatClipTime({ ts: '2026-06-01_10-00-00' }), new Date(2026, 5, 1, 10, 0, 0).toLocaleString());
});

test('apStretch finds start of current AP stretch', () => {
  const s = [0, 1, 2, 3, 4, 5].map((t) => ({ t, autopilot: [0, 2, 2, 2, 0, 3][t] }));
  assert.equal(apStretch(s, 0.5), null);
  assert.deepEqual(apStretch(s, 3.5), { state: 2, start: 1, elapsed: 2.5 });
  assert.equal(apStretch(s, 4), null);
  assert.deepEqual(apStretch(s, 5), { state: 3, start: 5, elapsed: 0 });
  assert.equal(apStretch([], 1), null);
  assert.equal(apPercent(s), 400 / 6);
});
