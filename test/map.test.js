import test from 'node:test';
import assert from 'node:assert/strict';
import { latLonToTile, fitZoom, fitZoomFrac, unproject, project, tilesForView, bounds, splitRoute } from '../js/map.js';

test('latLonToTile known values', () => {
  assert.deepEqual(latLonToTile(0, 0, 1), { x: 1, y: 1, z: 1 });
  assert.deepEqual(latLonToTile(51.5074, -0.1278, 10), { x: 511, y: 340, z: 10 });
  assert.deepEqual(latLonToTile(90, 180, 3), { x: 7, y: 0, z: 3 });
});
test('fitZoom shrinks as bounds grow', () => {
  const small = { minLat: 37.0, maxLat: 37.001, minLon: -122.0, maxLon: -121.999 };
  const big = { minLat: 30, maxLat: 40, minLon: -120, maxLon: -110 };
  assert.equal(fitZoom(small, 240, 120), 16);
  assert.ok(fitZoom(big, 240, 120) < 6);
  assert.equal(fitZoom({ minLat: -80, maxLat: 80, minLon: -179, maxLon: 179 }, 240, 120), 0);
});
test('tilesForView covers the view', () => {
  const t = tilesForView(37, -122, 12, 240, 120);
  assert.ok(t.length >= 1 && t.length <= 4);
  for (const q of t) assert.ok(q.px < 240 && q.px + 256 > 0 && q.py < 120 && q.py + 256 > 0);
});
test('bounds', () => {
  assert.deepEqual(bounds([{ lat: 1, lon: 2 }, { lat: 3, lon: -4 }]), { minLat: 1, maxLat: 3, minLon: -4, maxLon: 2 });
});
test('unproject inverts project', () => {
  const [a, o] = unproject(...project(37.5, -122.3, 12), 12);
  assert.ok(Math.abs(a - 37.5) < 1e-9 && Math.abs(o + 122.3) < 1e-9);
});
test('fitZoomFrac is fractional, monotonic, >= integer fit, clamped', () => {
  const b = { minLat: 37.0, maxLat: 37.003, minLon: -122.0, maxLon: -121.997 };
  const f = fitZoomFrac(b, 240, 120, 10), i = fitZoom(b, 240, 120, 10);
  assert.ok(f >= i && f < i + 1);
  assert.ok(fitZoomFrac(b, 480, 240, 10) > f);
  assert.equal(fitZoomFrac({ minLat: 1, maxLat: 1, minLon: 1, maxLon: 1 }, 240, 120), 18);
  assert.equal(fitZoomFrac({ minLat: -80, maxLat: 80, minLon: -179, maxLon: 179 }, 240, 120), 0);
});
test('splitRoute splits by time, even when cur has no GPS point of its own', () => {
  const pts = [0, 1, 2, 3, 4].map((t) => ({ t, lat: 37 + t / 1e4, lon: -122 }));
  const r = splitRoute(pts, { t: 2.5, lat: 0, lon: 0 });
  assert.equal(r.ci, 2);
  assert.deepEqual(r.driven.map((p) => p.t), [0, 1, 2]);
  assert.deepEqual(r.ahead.map((p) => p.t), [2, 3, 4]);
  assert.equal(splitRoute(pts, { t: -1 }).ci, 0);
  assert.equal(splitRoute(pts, { t: 99 }).ahead.length, 1);
  assert.equal(splitRoute(pts, pts[3]).ci, 3);
});
