// Tolerant protobuf wire decoder (varint, fixed32, fixed64, length-delimited).
// Returns {fieldNumber: value}; floats/doubles are interpreted by the schema in sei.js.
// Never throws: on truncation/unsupported wire type it stops and keeps what it has.
// `wires`, if given, is filled with {fieldNumber: wireType} so callers can diagnose schema drift.
export function decodeWire(buf, wires) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = {};
  let p = 0;
  const varint = () => {
    let lo = 0, shift = 0, v = 0n;
    for (;;) {
      if (p >= buf.length) throw new Error('truncated varint');
      const b = buf[p++];
      if (shift < 53) lo += (b & 0x7f) * 2 ** shift; else v |= BigInt(b & 0x7f) << BigInt(shift);
      shift += 7;
      if (!(b & 0x80)) break;
    }
    return v ? Number(BigInt(lo) | v) : lo;
  };
  try {
    while (p < buf.length) {
      const tag = varint(), field = Math.floor(tag / 8), wt = tag % 8;
      if (field < 1) break;
      if (wt === 0) out[field] = varint();
      else if (wt === 5) { out[field] = dv.getFloat32(p, true); p += 4; }
      else if (wt === 1) { out[field] = dv.getFloat64(p, true); p += 8; }
      else if (wt === 2) { const n = varint(); if (p + n > buf.length) break; out[field] = buf.subarray(p, p + n); p += n; }
      else break; // groups / reserved wire types: cannot skip safely
      if (wires) wires[field] = wt;
    }
  } catch { /* truncated: keep partial result */ }
  return out;
}
