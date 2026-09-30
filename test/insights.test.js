import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, formatSummary, haversine, signalSpans, signalText } from '../js/insights.js';
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
  const r = analyze(drive(61, (t) => ({ ay: t >= 10 && t <= 11 ? 5 : 0, ax: t >= 40 && t <= 41 ? 4 : 0, autopilot: t >= 30 && t < 50 ? 2 : 0 })));
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
  const r = analyze(drive(61, (t) => ({ ax: t >= 20 && t <= 22 ? -6 : 0, ay: t >= 10 && t <= 11 ? 5 : 0, autopilot: t >= 30 ? 2 : 0 })));
  assert.equal(new Set(r.markers.map((m) => m.kind)).size, 3);
  for (const m of r.markers) assert.ok(TICKS[m.kind], m.kind);
  assert.match(tickText(r.markers.find((m) => m.kind === 'brake')), /^Hard braking 6\.0 m\/s² · no brake pedal · 0:2\d$/);
  assert.equal(tickText(r.markers.find((m) => m.kind === 'ap-on')), 'Autopilot engaged · 0:30');
  const legend = LEGEND.find((g) => g.id === 'timeline').items.map((i) => `${i.label}:${i.color}`);
  for (const k of Object.values(TICKS)) assert.ok(legend.includes(`${k.label}:${k.color}`), k.label);
});

test('regen-only decel is not hard braking; pedal or a clearly higher decel is', () => {
  const at = (fn) => analyze(drive(61, (t) => (t >= 20 && t <= 24 ? fn : {})));
  assert.equal(at({ ax: -3.5 }).hardBraking, 0);                            // lift-off / regen, pedal at 0
  const p = at({ ax: -3.5, brake: true }).markers[0];
  assert.equal(p.kind, 'brake'); assert.equal(p.note, 'brake pedal');
  const h = at({ ax: -6 }).markers[0];
  assert.equal(h.note, 'no brake pedal');                                    // hard enough without the pedal
});

test('one-frame spikes are smoothed away and neighbouring events merge', () => {
  assert.equal(analyze(drive(61, (t) => (t === 20 ? { ax: -9, brake: true } : {}))).hardBraking, 0);
  const cluster = analyze(drive(61, (t) => ((t >= 20 && t <= 21) || (t >= 24 && t <= 25) ? { ax: -6, brake: true } : {})));
  assert.equal(cluster.hardBraking, 1);                                      // 3 s apart < minGapS
  const far = analyze(drive(61, (t) => ((t >= 10 && t <= 11) || (t >= 30 && t <= 31) ? { ax: -6, brake: true } : {})));
  assert.equal(far.hardBraking, 2);
});

test('hard acceleration needs throttle; turn and accel tooltips say why', async () => {
  const { tickText } = await import('../js/insights.js');
  const a = (accel) => analyze(drive(61, (t) => (t >= 20 && t <= 22 ? { ax: 4, accel } : {})));
  assert.equal(a(0).hardAccel, 0);
  assert.match(tickText(a(0.5).markers[0]), /^Hard acceleration 4\.0 m\/s² · throttle 50% · 0:2\d$/);
  const r = analyze(drive(61, (t) => (t >= 10 && t <= 12 ? { ay: -3, steering: -72 } : {})));
  assert.match(tickText(r.markers[0]), /^Sharp turn 3\.0 m\/s² · steering -72° · 0:1\d$/);
});

test('signalSpans: merges blinker flicker, keeps sides separate, sorted', () => {
  const flicker = [23, 23.5, 24.5, 25, 26, 26.5, 27]; // blinker ticking on/off at 2 Hz sampling: one span
  const S = drive(61, () => ({})).flatMap((s) => [s, { ...s, t: s.t + 0.5 }]).map((s) => ({ ...s, blinkerLeft: flicker.includes(s.t) || (s.t >= 31 && s.t <= 31.5), blinkerRight: s.t >= 40 && s.t <= 41 }));
  assert.deepEqual(signalSpans(S), [{ side: 'left', start: 23, end: 27 }, { side: 'left', start: 31, end: 31.5 }, { side: 'right', start: 40, end: 41 }]);
  assert.deepEqual(analyze(S).signals, signalSpans(S));
  assert.deepEqual(signalSpans(drive(10)), []);
  assert.equal(signalText({ side: 'left', start: 23, end: 31 }), 'Left indicator 0:23 to 0:31');
});
