// Synthetic benchmark for reading an event's telemetry: node scripts/bench-telemetry.mjs [segments=11] [mbPerClip=8]
// Compares the previous strategy (whole file -> parseClip, cameras and segments serial) with parseClipBlob + 3 segments in flight.
import { mkdtempSync, writeFileSync, rmSync, openAsBlob } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeClip, CAMS6 } from '../test/e2e/fixtures.js';
import { parseClip, parseClipBlob } from '../js/mp4.js';

const segs = +process.argv[2] || 11, mb = +process.argv[3] || 8;
const frames = 2160, pad = Math.max(0, Math.round(mb * 1e6 / frames) - 60);
const dir = mkdtempSync(join(tmpdir(), 'bench-'));
const mk = (sei) => { // makeClip has tiny slices; pad them so the file reaches the requested size
  const c = makeClip({ sei, frames }); return pad ? padClip(c, pad) : c;
};
function padClip(buf, n) { // rebuild mdat with n filler bytes per slice (keeps NAL framing)
  const i = buf.indexOf(Buffer.from('mdat')) - 4, body = buf.subarray(i + 8), out = [];
  for (let p = 0; p + 4 <= body.length;) {
    const len = body.readUInt32BE(p), nal = Buffer.from(body.subarray(p + 4, p + 4 + len));
    p += 4 + len; const t = nal[0] & 31, extra = t === 6 ? 0 : n, l = nal.length + extra, h = Buffer.alloc(4); h.writeUInt32BE(l);
    out.push(h, nal, Buffer.alloc(extra, 7));
  }
  const b = Buffer.concat(out), h = Buffer.alloc(8); h.writeUInt32BE(b.length + 8); h.write('mdat', 4);
  return Buffer.concat([buf.subarray(0, i), h, b]);
}
const scenarios = {
  'front has telemetry': (c) => c === 'front',
  'no telemetry anywhere': () => false,
};
const now = () => performance.now();
async function run(name, hasTel) {
  const files = [];
  const tel = mk(true), none = mk(false);
  for (let s = 0; s < segs; s++) files.push(CAMS6.map((c, k) => {
    const p = join(dir, `${s}-${c}.mp4`); writeFileSync(p, hasTel(c) ? tel : none); return p;
  }));
  const blobs = await Promise.all(files.map((row) => Promise.all(row.map((p) => openAsBlob(p)))));
  const each = async (parse, row) => { for (const b of row) { const p = await parse(b); if (p.samples.length) return p; } return null; };
  let t = now();
  for (const row of blobs) await each(async (b) => parseClip(await b.arrayBuffer()), row);
  const before = now() - t;
  t = now(); let next = 0;
  await Promise.all([0, 1, 2].map(async () => { while (next < blobs.length) await each(parseClipBlob, blobs[next++]); }));
  const after = now() - t;
  console.log(`${name.padEnd(24)} ${segs} segs x 6 cams x ${(tel.length / 1e6).toFixed(1)} MB   before ${before.toFixed(0)} ms   after ${after.toFixed(0)} ms   (${(before / after).toFixed(1)}x)`);
}
try { for (const [n, f] of Object.entries(scenarios)) await run(n, f); } finally { rmSync(dir, { recursive: true, force: true }); }
