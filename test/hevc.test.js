import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClip } from '../js/mp4.js';
import { fieldsSeen } from '../js/sei.js';
import { decodeWire } from '../js/protobuf.js';

const f32 = (v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); return [...b]; };
const f64 = (v) => { const b = Buffer.alloc(8); b.writeDoubleLE(v); return [...b]; };
const box = (type, ...kids) => { const body = Buffer.concat(kids.map((k) => Buffer.from(k))); const h = Buffer.alloc(8); h.writeUInt32BE(body.length + 8); h.write(type, 4); return Buffer.concat([h, body]); };
const u32 = (...v) => { const b = Buffer.alloc(4 * v.length); v.forEach((x, i) => b.writeUInt32BE(x, i * 4)); return b; };
const proto = (speed) => Uint8Array.from([0x08, 2, 0x10, 1, 0x25, ...f32(speed), 0x59, ...f64(40.5), 0xa0, 0x01, 7]); // unknown field 20
const esc = (payload) => { const o = []; let z = 0; for (const b of payload) { if (z >= 2 && b <= 3) { o.push(3); z = 0; } o.push(b); z = b === 0 ? z + 1 : 0; } return o; };

// HEVC SEI: header type 39/40, payload messages: user_data_unregistered(5) = UUID + [marker] + protobuf
function seiNal(type, pb, { marker = false } = {}) {
  const ud = [...Array(16).fill(0xab), ...(marker ? [0x42, 0x42, 0x69] : []), ...pb];
  const size = []; let n = ud.length; while (n >= 255) { size.push(255); n -= 255; } size.push(n);
  return [type << 1, 1, 5, ...size, ...esc(ud), 0x80];
}
const slice = (first, type = 1) => [type << 1, 1, first ? 0x80 : 0x00, 0xaa, 0xbb];

function makeHevc(lenSize, nals, created = 0) {
  const body = Buffer.concat(nals.map((n) => { const l = Buffer.alloc(lenSize); l.writeUIntBE(n.length, 0, lenSize); return Buffer.concat([l, Buffer.from(n)]); }));
  const hvcC = Buffer.alloc(23); hvcC[0] = 1; hvcC[21] = 0xfc | (lenSize - 1);
  const fields = Buffer.alloc(78); fields.writeUInt16BE(1448, 24); fields.writeUInt16BE(938, 26);
  const entry = box('hvc1', fields, box('hvcC', hvcC));
  const mvhd = box('mvhd', u32(0, created, 0, 30000, 0));
  const mdhd = box('mdhd', u32(0, 0, 0, 30000, 0), Buffer.alloc(4));
  const moov = box('moov', mvhd, box('trak', box('mdia', mdhd, box('minf', box('stbl', box('stsd', u32(0, 1), entry), box('stts', u32(0, 1, 4, 1000)))))));
  const b = Buffer.concat([box('ftyp', Buffer.from('isom0000')), moov, box('mdat', body)]);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
}

for (const lenSize of [4, 2]) {
  test(`HEVC telemetry + timing, length size ${lenSize}`, () => {
    const c = parseClip(makeHevc(lenSize, [
      [0x40, 1, 9], // VPS: ignored
      seiNal(39, proto(12.5)), slice(true, 19), slice(false, 19), // frame 0 (2 slices)
      slice(true), // frame 1: no telemetry
      seiNal(39, proto(20), { marker: true }), slice(true),
      slice(true), seiNal(40, proto(30)), // suffix SEI belongs to preceding frame 3
    ], 3660681600)); // 2020-01-01 in 1904 epoch
    assert.equal(c.hevc, true); assert.equal(c.width, 1448); assert.equal(c.height, 938);
    assert.ok(Math.abs(c.duration - 4 / 30) < 1e-9);
    assert.equal(c.created, Date.UTC(2020, 0, 1));
    assert.deepEqual(c.samples.map((s) => s.speedMps), [12.5, 20, 30]);
    assert.deepEqual(c.samples.map((s) => +s.t.toFixed(4)), [0, 0.0667, 0.1]);
    assert.equal(c.samples[0].gear, 1); assert.equal(c.samples[0].lat, 40.5);
    assert.deepEqual(c.samples[0].raw, { 20: 7 }); // unknown field preserved
  });
}

test('protobuf decoder tolerates junk and reports fields seen', () => {
  assert.deepEqual(decodeWire(Uint8Array.from([0x08, 5, 0x1b, 1, 2])), { 1: 5 }); // group wire type stops, no throw
  assert.deepEqual(decodeWire(Uint8Array.from([0x08, 5, 0x12, 9, 1])), { 1: 5 }); // truncated bytes field
  const r = fieldsSeen(Uint8Array.from([0x08, 1, 0xa0, 0x06, 4]));
  assert.deepEqual(r.unknown, [100]); assert.ok(r.missing.includes(2)); assert.equal(r.seen[0].name, 'version');
});
