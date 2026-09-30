import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEGEND, COLOR, ROUTE_AHEAD } from '../js/legend.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('legend covers graph, timeline and map with unique labels per group', () => {
  assert.deepEqual(LEGEND.map((g) => g.id), ['graph', 'timeline', 'map']);
  for (const g of LEGEND) {
    assert.ok(g.items.length);
    assert.equal(new Set(g.items.map((i) => i.label)).size, g.items.length);
  }
});

test('every legend color is a COLOR token (or the map route-ahead literal) that the drawing code reads', () => {
  const tokens = new Set(Object.values(COLOR));
  for (const { items } of LEGEND) for (const i of items) assert.ok(tokens.has(i.color) || i.color === ROUTE_AHEAD, i.label);
  const graph = read('js/graph.js'), map = read('js/map.js');
  for (const k of ['speed', 'ap', 'throttle', 'brake', 'playhead']) assert.ok(graph.includes(`COLOR.${k}`), `graph.js ignores COLOR.${k}`);
  for (const k of ['trail', 'position']) assert.ok(map.includes(`COLOR.${k}`), `map.js ignores COLOR.${k}`);
  assert.ok(map.includes('ROUTE_AHEAD'));
});

test('legend mount point and swatch styles exist', () => {
  assert.ok(read('index.html').includes('id="legend"'));
  const css = read('style.css');
  for (const k of new Set(LEGEND.flatMap((g) => g.items.map((i) => i.kind)))) assert.ok(css.includes(`.lg-${k}`), `.lg-${k} missing`);
});
