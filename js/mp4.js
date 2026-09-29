import { decodeSei } from './sei.js';
import { hvcCLengthSize, scanHevc } from './hevc.js';

const ascii = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

function findBox(dv, start, end, name) {
  for (let pos = start; pos + 8 <= end;) {
    let size = dv.getUint32(pos), hdr = 8;
    const type = ascii(dv, pos + 4);
    if (size === 1) { size = Number(dv.getBigUint64(pos + 8)); hdr = 16; }
    else if (size === 0) size = end - pos;
    if (size < hdr) break;
    if (type === name) return { start: pos + hdr, end: Math.min(pos + size, end) };
    pos += size;
  }
  return null;
}

/**
 * Parse a Tesla dashcam MP4 (ArrayBuffer): frame durations + per-frame SEI telemetry.
 * Returns { codec, width, height, duration, samples:[{t, ...telemetry}] }.
 * Telemetry is empty for clips without SEI (older firmware, parked, HEVC).
 */
export function parseClip(buffer) {
  const dv = new DataView(buffer), u8 = new Uint8Array(buffer);
  const moov = findBox(dv, 0, dv.byteLength, 'moov');
  const mdat = findBox(dv, 0, dv.byteLength, 'mdat');
  if (!moov || !mdat) throw new Error('Not an MP4 (no moov/mdat)');
  const mvhd = findBox(dv, moov.start, moov.end, 'mvhd');
  let created = null;
  if (mvhd) {
    const secs = dv.getUint8(mvhd.start) === 1 ? Number(dv.getBigUint64(mvhd.start + 4)) : dv.getUint32(mvhd.start + 4);
    if (secs) created = (secs - 2082844800) * 1000; // 1904 epoch -> unix ms
  }
  const trak = findBox(dv, moov.start, moov.end, 'trak');
  const mdia = findBox(dv, trak.start, trak.end, 'mdia');
  const mdhd = findBox(dv, mdia.start, mdia.end, 'mdhd');
  const timescale = dv.getUint32(mdhd.start + (dv.getUint8(mdhd.start) === 1 ? 20 : 12));
  const stbl = findBox(dv, findBox(dv, mdia.start, mdia.end, 'minf').start, mdia.end, 'stbl');
  const stsd = findBox(dv, stbl.start, stbl.end, 'stsd');
  const entry = stsd.start + 8;
  const codec = ascii(dv, entry + 4);
  const width = dv.getUint16(entry + 8 + 24), height = dv.getUint16(entry + 8 + 26);

  const stts = findBox(dv, stbl.start, stbl.end, 'stts');
  const n = dv.getUint32(stts.start + 4);
  const durations = [];
  for (let i = 0, p = stts.start + 8; i < n; i++, p += 8) {
    const c = dv.getUint32(p), d = dv.getUint32(p + 4);
    for (let j = 0; j < c; j++) durations.push(d / timescale);
  }

  const hevc = codec === 'hvc1' || codec === 'hev1';
  if (hevc) {
    const hvcC = findBox(dv, entry + 8 + 78, Math.min(entry + dv.getUint32(entry), stsd.end), 'hvcC');
    const r = scanHevc(dv, u8, mdat, hvcC ? hvcCLengthSize(u8, hvcC.start) : 4, durations);
    return { codec, hevc, width, height, created, duration: durations.reduce((a, b) => a + b, 0) || r.duration, samples: r.samples };
  }
  const samples = [];
  let cursor = mdat.start, pending = null, frame = 0, t = 0;
  while (cursor + 5 <= mdat.end) {
    const len = dv.getUint32(cursor); cursor += 4;
    if (len < 1 || cursor + len > dv.byteLength) break;
    const type = u8[cursor] & 0x1f;
    if (type === 6) pending = decodeSei(u8.subarray(cursor, cursor + len)) || pending;
    else if (type === 5 || type === 1) {
      if (pending) samples.push({ t, ...pending });
      pending = null; t += durations[frame++] ?? 1 / 36;
    }
    cursor += len;
  }
  return { codec, hevc, width, height, created, duration: t, samples };
}

export function isMp4(u8) {
  return u8.length > 12 && String.fromCharCode(u8[4], u8[5], u8[6], u8[7]) === 'ftyp';
}
