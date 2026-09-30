import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clampSide, SIDE_MIN, SIDE_MAX, SIDE_DEFAULT } from '../js/sidew.js';

test('clampSide keeps width within min/max and falls back on junk', () => {
  assert.equal(clampSide(100), SIDE_MIN);
  assert.equal(clampSide(9999), SIDE_MAX);
  assert.equal(clampSide(345.4), 345);
  assert.equal(clampSide('abc'), SIDE_DEFAULT);
  assert.equal(clampSide(null), SIDE_MIN); // Number(null) === 0 -> clamped up
  assert.equal(clampSide(500, 600), 360); // never more than 60% of the viewport
  assert.equal(clampSide(500, 200), SIDE_MIN);
});

test('sidebar resize handle: markup, desktop-only CSS, keyboard-accessible', () => {
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const html = read('index.html'), css = read('style.css');
  assert.match(html, /id="sideResize"[^>]*role="separator"[^>]*tabindex="0"/);
  const phone = css.match(/@media \(max-width:860px\)[^{]*\{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(/#sideResize\{display:none\}/.test(phone.replace(/#sideToggle,/, '')) || phone.includes('#sideResize'), 'handle hidden in phone layout');
});
