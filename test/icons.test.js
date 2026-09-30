import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_TYPES, RAW_PREFIX } from '../js/library.js';
import { EVENT_ICONS, GENERIC_ICON, NO_TYPE_ICON, iconMarkup, typeIcon } from '../js/icons.js';

test('every event type has its own icon, no more, no less', () => {
  assert.deepEqual(Object.keys(EVENT_ICONS).sort(), [...EVENT_TYPES].sort());
  const m = EVENT_TYPES.map(iconMarkup);
  assert.equal(new Set(m).size, m.length, 'icons are distinct');
  assert.ok(!m.includes(GENERIC_ICON) && !m.includes(NO_TYPE_ICON));
});

test('unknown reasons get the generic icon, no type gets its own', () => {
  assert.equal(iconMarkup(RAW_PREFIX + 'something_new'), GENERIC_ICON);
  assert.equal(iconMarkup(null), NO_TYPE_ICON);
  assert.notEqual(GENERIC_ICON, NO_TYPE_ICON);
});

test('typeIcon is decorative svg (name comes from the button/aria-label)', () => {
  const s = typeIcon('honk');
  assert.match(s, /^<svg [^>]*aria-hidden="true"/);
  assert.ok(s.includes(EVENT_ICONS.honk));
});
