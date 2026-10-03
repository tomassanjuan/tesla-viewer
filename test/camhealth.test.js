import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newHealth, stepHealth, pickMaster, STALL_MS } from '../js/camhealth.js';

const snap = (o = {}) => ({ time: 1, paused: false, ended: false, seeking: false, readyState: 4, error: false, duration: 60, ...o });

test('a cam whose clock advances is playing', () => {
  const h = newHealth();
  for (let i = 0; i < 20; i++) assert.equal(stepHealth(h, snap({ time: i * 0.25 }), 1000 + i * 250, true).state, i ? 'playing' : 'buffering');
});

test('frozen clock: buffering, then one recover, then error (never loops)', () => {
  const h = newHealth(); let t = 1000; const actions = [];
  for (let i = 0; i < 40; i++, t += 250) { stepHealth(h, snap({ time: 5 }), t, true); actions.push(h.action); }
  assert.equal(actions.filter((a) => a === 'recover').length, 1);
  assert.equal(h.state, 'error');
  // sticky: even if the clock moves again, error stays until the segment is reloaded
  assert.equal(stepHealth(h, snap({ time: 6 }), t, true).state, 'error');
});

test('stalled state is reported at the recover step, buffering before it', () => {
  const h = newHealth(); stepHealth(h, snap({ time: 5 }), 0, true);
  assert.equal(stepHealth(h, snap({ time: 5 }), STALL_MS - 1, true).state, 'buffering');
  assert.equal(stepHealth(h, snap({ time: 5 }), STALL_MS + 1, true).state, 'stalled');
  assert.equal(h.action, 'recover');
});

test('a recovered cam returns to playing and keeps its retry spent', () => {
  const h = newHealth(); stepHealth(h, snap({ time: 5 }), 0, true); stepHealth(h, snap({ time: 5 }), STALL_MS + 1, true);
  assert.equal(stepHealth(h, snap({ time: 5.4 }), STALL_MS + 300, true).state, 'playing');
  assert.equal(h.tries, 1);
});

test('play() rejected (element paused while it should play) is treated as a stall', () => {
  const h = newHealth(); let t = 0;
  for (; t < STALL_MS * 3; t += 250) stepHealth(h, snap({ time: 2, paused: true }), t, true);
  assert.equal(h.state, 'error');
});

test('intentionally idle, ended and errored cams are not stalls', () => {
  const h = newHealth();
  for (let t = 0; t < 10000; t += 250) assert.equal(stepHealth(h, snap({ time: 3 }), t, false).state, 'paused');
  const e = newHealth();
  for (let t = 0; t < 10000; t += 250) assert.equal(stepHealth(e, snap({ time: 59.95 }), t, true).state, 'ended');
  assert.equal(stepHealth(newHealth(), snap({ error: true }), 0, true).state, 'error');
});

test('master: first healthy cam wins; a stalled or errored front is skipped', () => {
  const order = ['front', 'back', 'left'], has = () => true;
  assert.equal(pickMaster(order, {}, has), 'front');
  assert.equal(pickMaster(order, { front: 'stalled' }, has), 'back');
  assert.equal(pickMaster(order, { front: 'error', back: 'buffering' }, has), 'left');
  assert.equal(pickMaster(order, { front: 'error', back: 'buffering', left: 'stalled' }, has), 'back');
  assert.equal(pickMaster(order, { front: 'error', back: 'error', left: 'error' }, has), 'front');
  assert.equal(pickMaster(order, {}, (c) => c !== 'front'), 'back');
});
