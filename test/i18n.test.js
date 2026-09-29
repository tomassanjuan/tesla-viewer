import test from 'node:test';
import assert from 'node:assert/strict';
import en from '../js/locales/en.js';
import { t, setLang, getLang, LANGS } from '../js/i18n.js';

const others = Object.keys(LANGS).filter((l) => l !== 'en');

test('t: english source, interpolation, unknown key passthrough', async () => {
  await setLang('en', false);
  assert.equal(t('Close'), 'Close');
  assert.equal(t('Decrypted {ok}, no key for {missing}.', { ok: 2, missing: 1 }), 'Decrypted 2, no key for 1.');
  assert.equal(t('{n} min-clips', { n: 0 }), '0 min-clips');
  assert.equal(t('not in dict'), 'not in dict');
  assert.equal(t('{x}', {}), '{x}');
});

test('setLang switches and falls back to English', async () => {
  await setLang('es', false);
  assert.equal(getLang(), 'es');
  assert.equal(t('Close'), 'Cerrar');
  assert.equal(t('{n} min-clips', { n: 3 }), '3 clips de 1 min');
  assert.equal(t('made-up key'), 'made-up key');
  await setLang('xx', false);
  assert.equal(getLang(), 'en');
  assert.equal(t('Close'), 'Close');
});

for (const l of others) {
  test(`locale ${l}: same keys as en, same placeholders`, async () => {
    const d = (await import(`../js/locales/${l}.js`)).default;
    assert.deepEqual(Object.keys(d).filter((k) => !(k in en)), [], 'keys absent from en');
    assert.deepEqual(Object.keys(en).filter((k) => !(k in d)), [], 'untranslated keys');
    const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of Object.keys(d)) assert.equal(ph(d[k]), ph(k), k);
  });
}
