import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createCipheriv, webcrypto } from 'node:crypto';
import { md5 } from '../js/md5.js';
import { decodeSei } from '../js/sei.js';
import { parseClip } from '../js/mp4.js';
import { groupFiles } from '../js/library.js';
import { isEncrypted, parseHeader, decrypt, pageIv } from '../js/tesla-crypto.js';

const varint = (n) => { const o = []; while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128); } o.push(n); return o; };
const f32 = (v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); return [...b]; };
const f64 = (v) => { const b = Buffer.alloc(8); b.writeDoubleLE(v); return [...b]; };
function seiPayload() {
  return Uint8Array.from([
    0x08, 2, 0x10, 1, 0x18, ...varint(300), 0x25, ...f32(12.5), 0x35, ...f32(-3), 0x38, 1, 0x50, 2,
    0x59, ...f64(40.5), 0x61, ...f64(-3.7),
  ]);
}
function seiNal(payload) {
  const esc = []; let z = 0;
  for (const b of payload) { if (z >= 2 && b <= 3) { esc.push(3); z = 0; } esc.push(b); z = b === 0 ? z + 1 : 0; }
  return Uint8Array.from([0x06, 0x05, 0xff, 0x42, 0x42, 0x69, ...esc, 0x80]);
}
const box = (type, ...kids) => { const body = Buffer.concat(kids.map((k) => Buffer.from(k))); const h = Buffer.alloc(8); h.writeUInt32BE(body.length + 8); h.write(type, 4); return Buffer.concat([h, body]); };
const u32 = (...v) => { const b = Buffer.alloc(4 * v.length); v.forEach((x, i) => b.writeUInt32BE(x, i * 4)); return b; };

function makeMp4(codec = 'avc1') {
  const nals = [seiNal(seiPayload()), [0x65, 1, 2, 3], [0x41, 9, 9], [0x41, 9, 9]];
  const mdatBody = Buffer.concat(nals.map((n) => Buffer.concat([u32(n.length), Buffer.from(n)])));
  const entry = Buffer.alloc(8 + 78); entry.write(codec, 4); entry.writeUInt32BE(entry.length, 0);
  entry.writeUInt16BE(1280, 8 + 24); entry.writeUInt16BE(960, 8 + 26);
  const stsd = box('stsd', u32(0, 1), entry);
  const stts = box('stts', u32(0, 1, 3, 1000));
  const mdhd = box('mdhd', u32(0, 0, 0, 30000, 0), Buffer.alloc(4));
  const moov = box('moov', box('trak', box('mdia', mdhd, box('minf', box('stbl', stsd, stts)))));
  return Buffer.concat([box('ftyp', Buffer.from('isom0000')), moov, box('mdat', mdatBody)]);
}

test('md5 matches node', () => {
  for (const s of ['', 'a', 'x'.repeat(55), 'x'.repeat(64), 'x'.repeat(1000)])
    assert.equal(Buffer.from(md5(Buffer.from(s))).toString('hex'), createHash('md5').update(s).digest('hex'));
});

test('SEI decode with emulation prevention', () => {
  const m = decodeSei(seiNal(seiPayload()));
  assert.equal(m.gear, 1); assert.equal(m.frameSeq, 300); assert.equal(m.speedMps, 12.5);
  assert.equal(m.steering, -3); assert.equal(m.blinkerLeft, true); assert.equal(m.autopilot, 2);
  assert.equal(m.lat, 40.5); assert.equal(m.lon, -3.7);
});

test('parseClip returns per-frame telemetry and timing', () => {
  const b = makeMp4(); const c = parseClip(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  assert.equal(c.width, 1280); assert.equal(c.height, 960);
  assert.ok(Math.abs(c.duration - 0.1) < 1e-9);
  assert.equal(c.samples.length, 1); assert.equal(c.samples[0].speedMps, 12.5);
});

test('parseClip flags HEVC without throwing or decoding telemetry', () => {
  const b = makeMp4('hvc1'); const c = parseClip(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  assert.equal(c.hevc, true); assert.equal(c.codec, 'hvc1'); assert.equal(c.samples.length, 0);
  assert.ok(Math.abs(c.duration - 0.1) < 1e-9);
});

const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
test('parseClip: moov after mdat, multiple mdat, largesize mdat', () => {
  const m = makeMp4();
  const iMoov = m.indexOf(Buffer.from('moov')) - 4, iMdat = m.indexOf(Buffer.from('mdat')) - 4;
  const ftyp = m.subarray(0, iMoov), moov = m.subarray(iMoov, iMdat), body = m.subarray(iMdat + 8);
  const big = Buffer.concat([u32(1), Buffer.from('mdat'), Buffer.alloc(8), body]); big.writeBigUInt64BE(BigInt(big.length), 8);
  let c = parseClip(ab(Buffer.concat([ftyp, big, moov])));
  assert.equal(c.samples.length, 1); assert.equal(c.samples[0].speedMps, 12.5);
  const cut = 4 + seiNal(seiPayload()).length + 8;   // after SEI + IDR
  c = parseClip(ab(Buffer.concat([ftyp, moov, box('mdat', body.subarray(0, cut)), box('mdat', body.subarray(cut))])));
  assert.equal(c.samples.length, 1); assert.ok(Math.abs(c.duration - 0.1) < 1e-9);
});

test('groupFiles builds events and sorted segments', () => {
  const f = (path) => ({ path, file: path });
  const ev = groupFiles([
    f('TeslaCam/SentryClips/2026-06-01_10-00-00/2026-06-01_10-01-00-front.mp4'),
    f('TeslaCam/SentryClips/2026-06-01_10-00-00/2026-06-01_10-00-00-front.mp4'),
    f('TeslaCam/SentryClips/2026-06-01_10-00-00/2026-06-01_10-00-00-back.mp4'),
    f('TeslaCam/RecentClips/2026-06-02_09-00-00-left_pillar.mp4'), f('x/event.json')]);
  assert.equal(ev.length, 2);
  const s = ev.find((e) => e.name === '2026-06-01_10-00-00');
  assert.deepEqual(s.segments.map((x) => x.ts), ['2026-06-01_10-00-00', '2026-06-01_10-01-00']);
  assert.deepEqual(Object.keys(s.segments[0].cams).sort(), ['back', 'front']);
});

test('decrypt roundtrip with the documented scheme', async () => {
  const plain = Buffer.from(makeMp4()); const key = Buffer.from('0123456789abcdef');
  const pages = Math.ceil(plain.length / 4096);
  const file = Buffer.alloc(0x2000 + pages * 4096);
  Buffer.from('00112233445566778899aabbccddeeff', 'hex').copy(file, 4);
  file.writeBigUInt64BE(BigInt(plain.length), 0); file.writeUInt32BE(4096, 0x14); // note: size and id overlap at bytes 4-7 in the documented layout
  file.writeUInt32BE(1, 0x1000); file[0x1004] = 4; file.write('5YJ3E1EA7KF000000', 0x1045);
  const root = createHash('md5').update(key).digest();
  for (let p = 0; p < pages; p++) {
    const blk = Buffer.alloc(4096); plain.copy(blk, 0, p * 4096, (p + 1) * 4096);
    const iv = createHash('md5').update(Buffer.concat([root, Buffer.from(String(p)), Buffer.alloc(32 - 16 - String(p).length)])).digest();
    assert.deepEqual(Buffer.from(pageIv(root, p)), iv);
    const c = createCipheriv('aes-128-cbc', key, iv).setAutoPadding(false);
    Buffer.concat([c.update(blk), c.final()]).copy(file, 0x2000 + p * 4096);
  }
  const u8 = new Uint8Array(file);
  assert.ok(isEncrypted(u8));
  assert.equal(parseHeader(u8).id.length, 36);
  const out = await decrypt(u8, new Uint8Array(key), webcrypto.subtle);
  assert.deepEqual(Buffer.from(out), plain);
});

test('categories and event-type filtering', async () => {
  const { categoryOf, eventType, filterEvents, countBy } = await import('../js/library.js');
  const f = (path) => ({ path, file: path });
  const evs = groupFiles([
    f('TeslaCam/SentryClips/2026-06-01_10-00-00/2026-06-01_10-00-00-front.mp4'),
    f('TeslaCam/SentryClips/2026-06-01_11-00-00/2026-06-01_11-00-00-front.mp4'),
    f('TeslaCam/SavedClips/2026-06-02_10-00-00/2026-06-02_10-00-00-front.mp4'),
    f('TeslaCam/RecentClips/2026-06-03_09-00-00-front.mp4'),
    f('misc/2026-06-04_09-00-00-front.mp4')]);
  assert.equal(categoryOf('a/SentryClips/x'), 'sentry');
  assert.deepEqual(countBy(evs, (e) => e.category), { sentry: 2, saved: 1, recent: 1, loose: 1 });
  assert.equal(filterEvents(evs, { category: 'sentry' }).length, 2);
  // event.json reason refines the type; folder is the fallback
  evs.find((e) => e.name === '2026-06-01_10-00-00').reason = 'sentry_aware_object_detection';
  evs.find((e) => e.name === '2026-06-02_10-00-00').reason = 'user_interaction_honk';
  assert.equal(eventType({ reason: 'user_interaction_dashcam_icon_tap' }), 'saved');
  assert.equal(filterEvents(evs, { type: 'honk' }).length, 1);
  assert.equal(filterEvents(evs, { type: 'person' }).length, 1);
  assert.equal(eventType({ reason: 'sentry_accelerometer_motion' }), 'motion');
  assert.equal(eventType({ reason: 'something_new' }), 'raw:something_new');
  assert.equal(eventType({ reason: 'vehicle_auto_emergency_braking' }), 'emergency_braking');
  assert.equal(eventType({ reason: 'sentry_collision_detected' }), 'collision');
  assert.equal(eventType({ reason: 'user_interaction_honk' }), 'honk');
  assert.equal(filterEvents(evs, { category: 'saved', type: 'person' }).length, 0);
  assert.equal(eventType(evs.find((e) => e.category === 'recent')), null);
});

test('event.json reasons map to their own type with counts; unknown reasons keep raw text', async () => {
  const { eventType, countBy, filterEvents, formatEventInfo } = await import('../js/library.js');
  const samples = [
    { reason: 'vehicle_auto_emergency_braking', city: 'Oslo' },
    { reason: 'sentry_aware_object_detection' },
    { reason: 'user_interaction_dashcam_icon_tap' },
    { reason: 'user_interaction_honk' },
    { reason: 'sentry_collision_detected' },
    { reason: 'brand_new_reason' },
    { reason: 'brand_new_reason' },
  ].map((j) => ({ ...j, category: 'sentry' }));
  assert.deepEqual(countBy(samples, eventType), { emergency_braking: 1, person: 1, saved: 1, honk: 1, collision: 1, 'raw:brand_new_reason': 2 });
  assert.equal(filterEvents(samples, { type: 'raw:brand_new_reason' }).length, 2);
  assert.equal(formatEventInfo({ reason: 'vehicle_auto_emergency_braking' }).reason, 'Emergency braking');
});

test('groupEvents by day / city; formatEventInfo city', async () => {
  const { groupEvents, formatEventInfo } = await import('../js/library.js');
  const e = (ts, city) => ({ segments: [{ ts }], city });
  const evs = [e('2026-06-01_10-00-00', 'Oslo'), e('2026-06-01_12-00-00'), e('2026-06-02_10-00-00', 'Bergen'), e('2026-06-02_11-00-00', 'Oslo')];
  assert.equal(groupEvents(evs, 'none').length, 1);
  assert.deepEqual(groupEvents(evs, 'day').map((g) => [g.key, g.events.length]), [['2026-06-01', 2], ['2026-06-02', 2]]);
  assert.deepEqual(groupEvents(evs, 'city').map((g) => [g.key, g.events.length]), [['Bergen', 1], ['Oslo', 2], ['', 1]]);
  assert.equal(formatEventInfo({ city: ' Oslo ', street: 'X' }).city, 'Oslo');
});

test('hasSei: probes head for a Tesla SEI before the first slice', async () => {
  const { hasSei } = await import('../js/mp4.js');
  const box = (type, payload) => { const b = new Uint8Array(8 + payload.length); new DataView(b.buffer).setUint32(0, b.length); b.set([...type].map((c) => c.charCodeAt(0)), 4); b.set(payload, 8); return b; };
  const nal = (bytes) => { const n = new Uint8Array(4 + bytes.length); new DataView(n.buffer).setUint32(0, bytes.length); n.set(bytes, 4); return n; };
  const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
  const sei = nal([6, 5, 0x99, 0x42, 0x42, 0x69, 0x08, 0x96, 0x01, 0x80]);   // field 1 varint = 150
  const slice = nal([0x65, 0, 0, 0, 0]);
  assert.equal(hasSei(cat(box('ftyp', new Uint8Array(4)), box('mdat', cat(sei, slice))).buffer), true);
  assert.equal(hasSei(cat(box('ftyp', new Uint8Array(4)), box('mdat', slice)).buffer), false);
  assert.equal(hasSei(cat(box('ftyp', new Uint8Array(4))).buffer), null);
});

test('probeSei: finds mdat behind a large moov by reading box headers only', async () => {
  const { probeSei } = await import('../js/mp4.js');
  const box = (type, payload) => { const b = new Uint8Array(8 + payload.length); new DataView(b.buffer).setUint32(0, b.length); b.set([...type].map((c) => c.charCodeAt(0)), 4); b.set(payload, 8); return b; };
  const nal = (bytes) => { const n = new Uint8Array(4 + bytes.length); new DataView(n.buffer).setUint32(0, bytes.length); n.set(bytes, 4); return n; };
  const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
  const sei = nal([6, 5, 0x99, 0x42, 0x42, 0x69, 0x08, 0x96, 0x01, 0x80]), slice = nal([0x65, 0, 0, 0, 0]);
  const mk = (mdat) => new Blob([cat(box('ftyp', new Uint8Array(4)), box('moov', new Uint8Array(400000)), box('mdat', mdat))]);
  assert.equal(await probeSei(mk(cat(sei, slice))), true);
  assert.equal(await probeSei(mk(slice)), false);
  assert.equal(await probeSei(new Blob([box('ftyp', new Uint8Array(4))])), null);
});

test('sortEvents and groupEvents: month / type / kind / cams / length', async () => {
  const { groupEvents, sortEvents } = await import('../js/library.js');
  const mk = (ts, n, o = {}) => ({ start: new Date(ts.replace('_', 'T').replace(/-(\d\d)-(\d\d)$/, ':$1:$2')), segments: Array.from({ length: n }, () => ({ ts, cams: { front: 1, back: 1, ...(o.cams ?? {}) } })), kind: 'event', ...o });
  const a = mk('2026-05-01_10-00-00', 1, { reason: 'sentry_aware_object_detection' });
  const b = mk('2026-06-02_10-00-00', 12, { kind: 'trip', cams: { left_pillar: 1 } });
  const c = mk('2026-06-03_10-00-00', 6, { reason: 'vehicle_auto_emergency_braking' });
  const d = mk('2026-06-03_09-00-00', 3, { reason: 'weird_thing' });
  const evs = [a, b, c, d];
  const ids = (l) => l.map((e) => evs.indexOf(e));
  assert.deepEqual(ids(sortEvents(evs, 'newest')), [2, 3, 1, 0]);
  assert.deepEqual(ids(sortEvents(evs, 'oldest')), [0, 1, 3, 2]);
  assert.deepEqual(ids(sortEvents(evs, 'longest')), [1, 2, 3, 0]);
  assert.deepEqual(ids(sortEvents(evs, 'shortest')), [0, 3, 2, 1]);
  assert.deepEqual(ids(sortEvents(evs, 'cams')), [1, 2, 3, 0]);
  assert.equal(evs[0], a, 'input not mutated');
  const g = (by) => groupEvents(sortEvents(evs), by).map((x) => [x.key, x.events.length]);
  assert.deepEqual(g('month'), [['2026-06', 3], ['2026-05', 1]]);
  assert.deepEqual(g('type'), [['emergency_braking', 1], ['person', 1], ['raw:weird_thing', 1], ['', 1]]);
  assert.deepEqual(g('kind'), [['trip', 1], ['event', 3]]);
  assert.deepEqual(g('cams'), [['3', 1], ['2', 3]]);
  assert.deepEqual(g('length'), [['10+', 1], ['5-10', 1], ['2-5', 1], ['<2', 1]]);
  assert.equal(groupEvents(evs, 'bogus').length, 1);
});
