import test from 'node:test';
import assert from 'node:assert/strict';
import { waitLoaded } from '../js/videoload.js';

// minimal <video> stand-in: an EventTarget that counts listeners
const fakeVideo = () => { const t = new EventTarget(), n = { add: 0, rm: 0 }, a = t.addEventListener.bind(t), r = t.removeEventListener.bind(t); t.addEventListener = (...x) => (n.add++, a(...x)); t.removeEventListener = (...x) => (n.rm++, r(...x)); t.n = n; return t; };

test('waitLoaded: ok / error / timeout / abort all settle and remove every listener', async () => {
  for (const [how, expected] of [['loadedmetadata', 'ok'], ['error', 'error'], ['none', 'timeout'], ['abort', 'aborted']]) {
    const v = fakeVideo(), ctl = new AbortController();
    const p = waitLoaded(v, { signal: ctl.signal, ms: 30 });
    if (how === 'abort') ctl.abort(); else if (how !== 'none') v.dispatchEvent(new Event(how));
    assert.equal(await p, expected);
    assert.equal(v.n.rm, v.n.add, `${how}: leaked listeners`);
  }
});

test('waitLoaded: already-aborted signal settles immediately', async () => {
  const ctl = new AbortController(); ctl.abort();
  assert.equal(await waitLoaded(fakeVideo(), { signal: ctl.signal, ms: 5000 }), 'aborted');
});
