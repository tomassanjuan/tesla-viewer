import { decodeSei } from './sei.js';
import { hvcCLengthSize, scanHevc } from './hevc.js';

const ascii = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

/** All boxes named `name` in [start,end): handles largesize and size 0 (to end). */
function findBoxes(dv, start, end, name) {
  const out = [];
  for (let pos = start; pos + 8 <= end;) {
    let size = dv.getUint32(pos), hdr = 8;
    const type = ascii(dv, pos + 4);
    if (size === 1) { if (pos + 16 > end) break; size = Number(dv.getBigUint64(pos + 8)); hdr = 16; }
    else if (size === 0) size = end - pos;
    if (size < hdr) break;
    if (type === name) out.push({ start: pos + hdr, end: Math.min(pos + size, end) });
    pos += size;
  }
  return out;
}
const findBox = (dv, start, end, name) => findBoxes(dv, start, end, name)[0] ?? null;

/**
 * Parse a Tesla dashcam MP4 (ArrayBuffer): frame durations + per-frame SEI telemetry.
 * Returns { codec, width, height, duration, samples:[{t, ...telemetry}] }.
 * Telemetry is empty for clips without SEI (older firmware, parked, HEVC).
 */
export function parseClip(buffer) {
  const dv = new DataView(buffer), u8 = new Uint8Array(buffer);
  const moov = findBox(dv, 0, dv.byteLength, 'moov');
  const mdats = findBoxes(dv, 0, dv.byteLength, 'mdat');
  if (!moov || !mdats.length) throw new Error('Not an MP4 (no moov/mdat)');
  const mvhd = findBox(dv, moov.start, moov.end, 'mvhd');
  let created = null;
  if (mvhd) {
    const secs = dv.getUint8(mvhd.start) === 1 ? Number(dv.getBigUint64(mvhd.start + 4)) : dv.getUint32(mvhd.start + 4);
    if (secs) created = (secs - 2082844800) * 1000; // 1904 epoch -> unix ms
  }
  // prefer the video track (hdlr 'vide'); fall back to the first trak
  const traks = findBoxes(dv, moov.start, moov.end, 'trak');
  const isVide = (t) => { const h = findBox(dv, findBox(dv, t.start, t.end, 'mdia')?.start ?? 0, findBox(dv, t.start, t.end, 'mdia')?.end ?? 0, 'hdlr'); return h && ascii(dv, h.start + 8) === 'vide'; };
  const trak = traks.find(isVide) ?? traks[0];
  if (!trak) throw new Error('No track in moov');
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
    const r = scanHevc(dv, u8, mdats[0], hvcC ? hvcCLengthSize(u8, hvcC.start) : 4, durations);
    return { codec, hevc, width, height, created, duration: durations.reduce((a, b) => a + b, 0) || r.duration, samples: r.samples };
  }
  const samples = [];
  let pending = null, frame = 0, t = 0;
  for (const mdat of mdats) {   // ponytail: assumes NAL stream is contiguous per mdat; use stsz/stco if a camera interleaves tracks
    for (let cursor = mdat.start; cursor + 5 <= mdat.end;) {
      const len = dv.getUint32(cursor); cursor += 4;
      if (len < 1 || cursor + len > mdat.end) break;
      const type = u8[cursor] & 0x1f;
      if (type === 6) pending = decodeSei(u8.subarray(cursor, cursor + len)) || pending;
      else if (type === 5 || type === 1) {
        if (pending) samples.push({ t, ...pending });
        pending = null; t += durations[frame++] ?? 1 / 36;
      }
      cursor += len;
    }
  }
  return { codec, hevc, width, height, created, duration: t, samples };
}

export function isMp4(u8) {
  return u8.length > 12 && String.fromCharCode(u8[4], u8[5], u8[6], u8[7]) === 'ftyp';
}
