import test from 'node:test';
import assert from 'node:assert/strict';
import { groupFiles, TRIP_GAP_S } from '../js/library.js';

const f = (path) => ({ path, file: path });
const R = (ts, cam = 'front') => f(`TeslaCam/RecentClips/${ts}-${cam}.mp4`);

test('trips split on gap > threshold, sorted, cams merged', () => {
  assert.equal(TRIP_GAP_S, 120);
  const ev = groupFiles([
    R('2026-06-02_09-03-00'), R('2026-06-02_09-01-00'), R('2026-06-02_09-00-00'), R('2026-06-02_09-01-00', 'back'),
    R('2026-06-02_09-04-00'),
    R('2026-06-02_09-08-00'),          // 3 min gap (>120 s) -> new trip
    R('2026-06-02_09-10-00'),          // adjacent -> same trip
  ]);
  assert.equal(ev.length, 2);
  const [late, early] = ev;           // newest first
  assert.deepEqual(early.segments.map((s) => s.ts.slice(11)), ['09-00-00', '09-01-00', '09-03-00', '09-04-00']);
  assert.deepEqual(Object.keys(early.segments[1].cams).sort(), ['back', 'front']);
  assert.equal(late.segments.length, 2);
  assert.equal(early.kind, 'trip'); assert.equal(early.name, 'Trip 09:00 · 4 min'); assert.equal(early.day, '2026-06-02');
  assert.ok(early.start instanceof Date);
});

test('event dirs stay events; only >10 min gaps split', () => {
  const d = 'TeslaCam/SentryClips/2026-06-01_10-00-00/';
  const ev = groupFiles([f(d + '2026-06-01_10-00-00-front.mp4'), f(d + '2026-06-01_10-05-00-front.mp4'), f(d + '2026-06-01_10-30-00-front.mp4')]);
  assert.equal(ev.length, 2);
  assert.ok(ev.every((e) => e.kind === 'event'));
  assert.equal(ev.find((e) => e.name === '2026-06-01_10-00-00').segments.length, 2);
});

test('a consistent repeating gap keeps clips in one group; a lone or irregular gap still splits', () => {
  const at = (m) => R(`2026-06-03_10-${String(m).padStart(2, '0')}-00`);
  // clips every 5 min (4 min gaps, > 120 s threshold, repeated) -> one trip
  assert.equal(groupFiles([0, 5, 10, 15, 20].map(at)).length, 1);
  // one lone 4 min gap still splits
  assert.equal(groupFiles([0, 1, 5, 6].map(at)).length, 2);
  // repeating pattern, then an outlier gap far outside the cadence -> split there only
  const ev = groupFiles([0, 5, 10, 15, 50, 55].map(at));
  assert.deepEqual(ev.map((e) => e.segments.length).sort(), [2, 4]);
});
