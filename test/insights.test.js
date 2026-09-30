import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, formatSummary, haversine } from '../js/insights.js';
import { groupFiles, formatEventInfo } from '../js/library.js';

// steady 20 m/s drive due north for 60 s at 1 Hz (~1 deg lat = 111195 m)
const drive = (n = 61, f = () => ({})) => Array.from({ length: n }, (_, t) => ({
  t, speedMps: 20, accel: 0.2, brake: false, steering: 0, autopilot: 0, gear: 1, ax: 0, ay: 0,
  lat: 40 + (20 * t) / 111195, lon: -3, ...f(t),
}));

test('haversine ~ 111 km per degree latitude', () => {
  assert.ok(Math.abs(haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 111195) < 200);
});

test('steady drive: distance, speeds, no false positives', () => {
  const r = analyze(drive());
  assert.ok(Math.abs(r.distanceM - 1200) < 5);
  assert.equal(r.duration, 60);
  assert.equal(r.maxSpeedMps, 20);
  assert.equal(r.hardBraking + r.hardAccel + r.sharpTurns + r.apEngages, 0);
  assert.deepEqual(r.markers, []);
});

test('GPS jitter spike is ignored', () => {
  const r = analyze(drive(61, (t) => (t === 30 ? { lat: 41 } : {})));
  assert.ok(Math.abs(r.distanceM - 1200) < 5);
});

test('hard braking detected once, with marker', () => {
  const r = analyze(drive(61, (t) => (t >= 20 && t <= 22 ? { ax: -6 } : {})));
  assert.equal(r.hardBraking, 1);
  assert.equal(r.markers[0].kind, 'brake');
  assert.ok(r.markers[0].t >= 20 && r.markers[0].t <= 22);
});

test('sharp turn, hard accel and autopilot transitions', () => {
  const r = analyze(drive(61, (t) => ({ ay: t === 10 ? 5 : 0, ax: t === 40 ? 4 : 0, autopilot: t >= 30 && t < 50 ? 2 : 0 })));
  assert.equal(r.sharpTurns, 1);
  assert.equal(r.hardAccel, 1);
  assert.equal([r.apEngages, r.apDisengages].join(), '1,1');
  assert.ok(Math.abs(r.autopilotPct - (20 / 60) * 100) < 0.01);
});

test('empty input', () => {
  for (const x of [[], undefined]) {
    const r = analyze(x);
    assert.equal(r.distanceM, 0); assert.equal(r.duration, 0); assert.deepEqual(r.markers, []);
  }
});

test('formatSummary honours units', () => {
  const r = analyze(drive());
  assert.equal(formatSummary(r, 'kmh')[2][1], '72 km/h');
  assert.equal(formatSummary(r, 'mph')[2][1], '45 mph');
});

test('groupFiles attaches event.json and thumb.png to their event', () => {
  const f = (path) => ({ path, file: path });
  const d = 'TeslaCam/SentryClips/2026-06-01_10-00-00/';
  const [e] = groupFiles([f(d + '2026-06-01_10-00-00-front.mp4'), f(d + 'event.json'), f(d + 'thumb.png'), f('lonely/event.json')]);
  assert.equal(e.eventJson, d + 'event.json');
  assert.equal(e.thumb, d + 'thumb.png');
});

test('formatEventInfo', () => {
  assert.deepEqual(formatEventInfo({ reason: 'sentry_aware_object_detection', city: 'Oslo', street: 'Main St' }),
    { reason: 'Sentry: object detected', place: 'Main St, Oslo', city: 'Oslo' });
  assert.equal(formatEventInfo({ reason: 'user_interaction_foo_bar', est_lat: '59.9', est_lon: '10.75' }).place, '59.9000, 10.7500');
  assert.deepEqual(formatEventInfo(null), { reason: '', place: '', city: '' });
});

test('tick tooltips and legend share one definition', async () => {
  const { tickText } = await import('../js/insights.js');
  const { TICKS, LEGEND } = await import('../js/legend.js');
  const r = analyze(drive(61, (t) => ({ ax: t >= 20 && t <= 22 ? -6 : 0, ay: t === 10 ? 5 : 0, autopilot: t >= 30 ? 2 : 0 })));
  assert.equal(new Set(r.markers.map((m) => m.kind)).size, 3);
  for (const m of r.markers) assert.ok(TICKS[m.kind], m.kind);
  assert.match(tickText(r.markers.find((m) => m.kind === 'brake')), /^Hard braking .* m\/s² · 0:2\d$/);
  assert.equal(tickText(r.markers.find((m) => m.kind === 'ap-on')), 'Autopilot engaged · 0:30');
  const legend = LEGEND.find((g) => g.id === 'timeline').items.map((i) => `${i.label}:${i.color}`);
  for (const k of Object.values(TICKS)) assert.ok(legend.includes(`${k.label}:${k.color}`), k.label);
});
