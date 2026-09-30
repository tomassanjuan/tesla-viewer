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

/** Everything the moov box says: codec, size, creation time, frame durations (no mdat access). */
function parseMoov(dv, u8, moov) {
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
  let lenSize = 4;
  if (hevc) {
    const hvcC = findBox(dv, entry + 8 + 78, Math.min(entry + dv.getUint32(entry), stsd.end), 'hvcC');
    if (hvcC) lenSize = hvcCLengthSize(u8, hvcC.start);
  }
  return { codec, hevc, width, height, created, durations, lenSize };
}

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
  const { codec, hevc, width, height, created, durations, lenSize } = parseMoov(dv, u8, moov);
  if (hevc) {
    const r = scanHevc(dv, u8, mdats[0], lenSize, durations);
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

/**
 * Cheap telemetry probe (H.264 only) that reads a few bytes per box/NAL instead of whole files: hops top-level boxes
 * to mdat (moov may come first and be large), then hops length-prefixed NALs (slices are skipped, not read) looking for
 * a Tesla SEI. If the hop budget runs out without one, four 64 KB windows spread across the mdat are searched too, so
 * "no telemetry" is never concluded from the first frames alone. Returns true/false, or null when it can't tell
 * (HEVC, truncated, no mdat).
 */
export async function probeSei(blob, maxNals = 64) {
  const head = async (pos, n) => new DataView(await blob.slice(pos, pos + n).arrayBuffer());
  let pos = 0;
  for (let i = 0; ; i++) {
    const h = await head(pos, 16);
    if (i > 16 || h.byteLength < 8) return null;
    let size = h.getUint32(0);
    if (ascii(h, 4) === 'mdat') { pos += 8; break; }
    if (size === 1 && h.byteLength >= 16) size = Number(h.getBigUint64(8));
    if (size < 8) return null;
    pos += size;
  }
  const start = pos;
  for (let i = 0; i < maxNals; i++) {
    const h = await head(pos, 5);
    if (h.byteLength < 5) return false;   // end of file: scanned everything
    const len = h.getUint32(0), type = h.getUint8(4) & 0x1f;
    if (len < 1 || pos + 4 + len > blob.size) return null;
    if (type === 6 && decodeSei(new Uint8Array(await blob.slice(pos + 4, pos + 4 + len).arrayBuffer()))) return true;
    pos += 4 + len;
  }
  // budget spent: sample windows across the rest of the file (SEI precedes every frame, so any window should hit one)
  const span = blob.size - pos, W = 65536;
  if (span <= 0) return false;
  for (const at of [pos + span * 0.25, pos + span * 0.5, pos + span * 0.75, blob.size - W]) {
    const from = Math.max(start, Math.floor(at));
    if (windowHasSei(new Uint8Array(await blob.slice(from, from + W).arrayBuffer()))) return true;
  }
  return false;
}

/** True if a byte window (not aligned to NAL boundaries) contains a complete Tesla SEI NAL: 4-byte length, 06 05 <size> 42.. 69 <protobuf>. */
export function windowHasSei(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  for (let i = 4; i + 4 < u8.length; i++) {
    if (u8[i] !== 0x06 || u8[i + 1] !== 0x05 || u8[i + 3] !== 0x42) continue;
    const len = dv.getUint32(i - 4);
    if (len >= 8 && len <= 4096 && i + len <= u8.length && decodeSei(u8.subarray(i, i + len))) return true;
  }
  return false;
}

/** Top-level box headers of a Blob without reading payloads: [{ type, start, size }] (stops at the first mdat and moov, or `max` boxes). */
async function topBoxes(blob, max = 16) {
  const out = [];
  for (let pos = 0; out.length < max && pos + 8 <= blob.size;) {
    const h = new DataView(await blob.slice(pos, pos + 16).arrayBuffer());
    if (h.byteLength < 8) break;
    let size = h.getUint32(0);
    if (size === 1 && h.byteLength >= 16) size = Number(h.getBigUint64(8));
    else if (size === 0) size = blob.size - pos;
    if (size < 8) break;
    out.push({ type: ascii(h, 4), start: pos, size });
    pos += size;
  }
  return out;
}

/**
 * parseClip for a Blob/File, reading only what is needed. The moov (and a 64 KB slice of mdat) is enough to
 * prove an H.264 clip has no Tesla SEI before its first frame, so such clips never have their mdat read.
 * Anything unusual (HEVC, SEI present, odd layout, errors) falls back to the full parseClip.
 */
export async function parseClipBlob(blob) {
  try {
    const boxes = await topBoxes(blob);
    const moov = boxes.find((b) => b.type === 'moov'), mdat = boxes.find((b) => b.type === 'mdat');
    if (moov && mdat && moov.size < 2 ** 32) {
      const buf = await blob.slice(moov.start, moov.start + moov.size).arrayBuffer();
      const m = parseMoov(new DataView(buf), new Uint8Array(buf), { start: 8, end: buf.byteLength });
      if (!m.hevc && await probeSei(blob) === false) {
        return { codec: m.codec, hevc: false, width: m.width, height: m.height, created: m.created, duration: m.durations.reduce((a, b) => a + b, 0), samples: [] };
      }
    }
  } catch { /* fall through to the full parse */ }
  return parseClip(await blob.arrayBuffer());
}
