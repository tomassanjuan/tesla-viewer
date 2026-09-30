import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBusy } from '../js/progress.js';

test('busy: counted task reports fraction, ends to null', () => {
  const seen = [], b = createBusy((v) => seen.push(v));
  const k = b.begin('Scanning', 4);
  k.set(1); k.set(4);
  assert.equal(seen[1].fraction, 0.25);
  assert.equal(seen[2].fraction, 1);
  k.end();
  assert.equal(seen.at(-1), null);
  k.end(); k.set(2);                         // idempotent, no revival
  assert.equal(seen.at(-1), null);
});

test('busy: no total is indeterminate; newest concurrent task is shown; fraction clamped', () => {
  const b = createBusy();
  const a = b.begin('Loading video'), c = b.begin('Reading', 2);
  assert.equal(b.view().label, 'Reading');
  assert.equal(b.view().count, 2);
  c.set(9); assert.equal(b.view().fraction, 1);
  c.end();
  assert.equal(b.view().fraction, null);
  a.end(); assert.equal(b.view(), null);
});

test('busy.run always ends the task, even when fn throws', async () => {
  const b = createBusy();
  await assert.rejects(b.run('x', 1, async () => { throw new Error('boom'); }), /boom/);
  assert.equal(b.view(), null);
});

test('busy bar: wired into app + export, centered click-through overlay, safe-area aware, cached by sw', () => {
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const app = read('js/app.js');
  for (const label of ['Scanning files', 'Reading telemetry', 'Loading video']) assert.ok(app.includes(label), label);
  assert.ok(read('js/export.js').includes('Exporting video'));
  const css = read('style.css');
  assert.match(css, /#busy\{[^}]*inset:0[^}]*align-items:center[^}]*justify-content:center[^}]*pointer-events:none/);
  assert.ok(css.includes('safe-area-inset-bottom'));
  assert.ok(read('sw.js').includes("'js/progress.js'"));
});
