import { stripEmulation, telemetryFromProto } from './sei.js';

/** hvcC payload start -> NAL length-prefix size (1..4). */
export const hvcCLengthSize = (u8, start) => (u8[start + 21] & 3) + 1;

/**
 * Decode an HEVC SEI NAL (2-byte header, type 39 prefix / 40 suffix) into telemetry or null.
 * Walks SEI messages; for user_data_unregistered (5) skips the 16-byte UUID and extracts Tesla's
 * protobuf, tolerating an optional 0x42..0x42 0x69 marker like the H.264 path.
 */
export function decodeSeiHevc(nal) {
  if (nal.length < 4) return null;
  const d = stripEmulation(nal.subarray(2));
  for (let p = 0; p + 2 <= d.length;) {
    let type = 0, size = 0;
    while (p < d.length && d[p] === 0xff) { type += 255; p++; }
    type += d[p++];
    while (p < d.length && d[p] === 0xff) { size += 255; p++; }
    size += d[p++];
    if (p + size > d.length) size = d.length - p; // truncated: use what is there
    if (type === 5 && size > 16) {
      let s = p + 16, q = s; const e = p + size;
      while (q < e && d[q] === 0x42) q++;
      if (q > s && q < e && d[q] === 0x69) s = q + 1;
      const m = telemetryFromProto(d.subarray(s, e), true);
      if (m) return m;
    }
    p += size;
  }
  return null;
}

/** Walk mdat NALs of an HEVC track: one timing sample per picture (first_slice_segment_in_pic_flag). */
export function scanHevc(dv, u8, range, lenSize, durations) {
  const samples = [];
  let cursor = range.start, pending = null, frame = 0, t = 0, curT = 0, curPushed = true;
  while (cursor + lenSize + 3 <= range.end) {
    let len = 0;
    for (let i = 0; i < lenSize; i++) len = len * 256 + u8[cursor + i];
    cursor += lenSize;
    if (len < 2 || cursor + len > dv.byteLength) break;
    const type = (u8[cursor] >> 1) & 0x3f;
    if (type === 39) pending = decodeSeiHevc(u8.subarray(cursor, cursor + len)) || pending;
    else if (type === 40 && !curPushed) {
      const m = decodeSeiHevc(u8.subarray(cursor, cursor + len));
      if (m) { samples.push({ t: curT, ...m }); curPushed = true; }
    } else if (type <= 21 && u8[cursor + 2] & 0x80) {
      curT = t; curPushed = !!pending;
      if (pending) samples.push({ t, ...pending });
      pending = null; t += durations[frame++] ?? 1 / 36;
    }
    cursor += len;
  }
  return { samples, duration: t };
}
