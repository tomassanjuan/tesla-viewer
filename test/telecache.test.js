import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClip, parseClipBlob } from '../js/mp4.js';
import { clipKey, getClip, setClip, getProbe, setProbe, clearMemory, clipHasTelemetry } from '../js/telecache.js';
import { makeClip } from './e2e/fixtures.js';

/** Blob wrapper that counts bytes sliced/read, to prove what was (not) read. */
const counted = (buf) => {
  const b = new Blob([buf]); let bytes = 0;
  return { size: b.size, get bytes() { return bytes; },
    slice: (s, e) => { const x = b.slice(s, e); bytes += x.size; return x; },
    arrayBuffer: () => { bytes += b.size; return b.arrayBuffer(); } };
};
const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.length);

test('parseClipBlob gives the same result as parseClip when telemetry is present', async () => {
  const c = makeClip({ frames: 60, moovPad: 300000 });
  assert.deepEqual(await parseClipBlob(new Blob([c])), parseClip(ab(c)));
});

test('parseClipBlob proves absence from moov + the head of mdat only', async () => {
  const c = makeClip({ sei: false, frames: 60000 });
  const blob = counted(c);
  const r = await parseClipBlob(blob);
  const full = parseClip(ab(c));
  assert.equal(r.samples.length, 0);
  assert.ok(Math.abs(r.duration - full.duration) < 1e-9);
  assert.deepEqual([r.codec, r.width, r.height, r.created], [full.codec, full.width, full.height, full.created]);
  assert.ok(blob.bytes < c.length / 2, `read ${blob.bytes} of ${c.length} bytes`);
  assert.ok(blob.bytes < 200000);
});

test('parseClipBlob still reads everything when the head is inconclusive or not MP4', async () => {
  await assert.rejects(parseClipBlob(new Blob([Buffer.alloc(64)])), /Not an MP4/);
});

test('clipKey identifies Files but not anonymous Blobs', () => {
  const f = new File(['x'], 'a.mp4', { lastModified: 5 });
  assert.equal(clipKey(f), clipKey(new File(['x'], 'a.mp4', { lastModified: 5 })));
  assert.notEqual(clipKey(f), clipKey(new File(['x'], 'a.mp4', { lastModified: 6 })));
  assert.notEqual(clipKey(f), clipKey(new File(['xy'], 'a.mp4', { lastModified: 5 })));
  assert.equal(clipKey(new Blob(['x'])), null);
});

test('cache: a full parse answers the badge probe; probes and clips share one entry', async () => {
  clearMemory();
  assert.equal(await getProbe('k1'), undefined);
  await setProbe('k1', false);
  assert.equal(await getProbe('k1'), false);
  await setClip('k2', parseClip(ab(makeClip({ frames: 5 }))));
  assert.equal(await getProbe('k2'), true);
  assert.equal((await getClip('k2')).samples.length, 5);
  await setClip('k3', parseClip(ab(makeClip({ sei: false, frames: 5 }))));
  assert.equal(await getProbe('k3'), false);
  await setClip(null, {});           // uncacheable: ignored
  assert.equal(await getClip(null), null);
  assert.equal(clipHasTelemetry({ hevc: true, samples: [] }), null);   // HEVC can't prove absence
});
