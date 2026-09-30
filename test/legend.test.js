import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEGEND, COLOR, TICKS } from '../js/legend.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('legend covers graph, timeline and map with unique labels per group', () => {
  assert.deepEqual(LEGEND.map((g) => g.id), ['graph', 'timeline', 'map']);
  for (const g of LEGEND) {
    assert.ok(g.items.length);
    assert.equal(new Set(g.items.map((i) => i.label)).size, g.items.length);
  }
});

test('every legend color is a COLOR token that the drawing code reads', () => {
  const tokens = new Set([...Object.values(COLOR), ...Object.values(TICKS).map((k) => k.color)]);
  for (const { items } of LEGEND) for (const i of items) assert.ok(tokens.has(i.color), i.label);
  const graph = read('js/graph.js'), map = read('js/map.js');
  for (const k of ['speed', 'ap', 'throttle', 'brake', 'playhead']) assert.ok(graph.includes(`COLOR.${k}`), `graph.js ignores COLOR.${k}`);
  for (const k of ['driven', 'ahead', 'position']) assert.ok(map.includes(`COLOR.${k}`), `map.js ignores COLOR.${k}`);
});

test('route colors are theme-aware CSS vars, defined once in legend.js', () => {
  const css = read('style.css'), map = read('js/map.js');
  for (const v of [COLOR.driven, COLOR.ahead]) assert.ok(css.includes(`${v}:`), `${v} not in style.css`);
  assert.ok(!/ROUTE_COLORS|ROUTE_AHEAD/.test(map));
});

test('legend mount point and swatch styles exist', () => {
  assert.ok(read('index.html').includes('id="legend"'));
  const css = read('style.css');
  for (const k of new Set(LEGEND.flatMap((g) => g.items.map((i) => i.kind)))) assert.ok(css.includes(`.lg-${k}`), `.lg-${k} missing`);
});
