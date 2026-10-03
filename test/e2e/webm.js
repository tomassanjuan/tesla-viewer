// Real, decodable clips for playback tests (the TeslaCam fixtures are not decodable): records a canvas with
// MediaRecorder in the page, then patches the WebM Info with a Duration so the file is seekable with a finite length.
// The app names these .mp4; Chromium sniffs the container, and the app tolerates the missing MP4 telemetry.
const vint = (n) => { const b = Buffer.alloc(8); b[0] = 0x01; b.writeUIntBE(n, 2, 6); return b; };

export async function recordWebm(page, seconds = 12, size = [320, 240]) {
  const b64 = await page.evaluate(async ([sec, [w, h]]) => {
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h }), x = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 300000 }), parts = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    let n = 0; const iv = setInterval(() => { x.fillStyle = `hsl(${(n++ * 7) % 360},70%,45%)`; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.font = '40px sans-serif'; x.fillText((n / 30).toFixed(1), 20, 80); }, 1000 / 30);
    const stopped = new Promise((r) => (rec.onstop = r));
    rec.start(200); await new Promise((r) => setTimeout(r, sec * 1000)); rec.stop(); clearInterval(iv); await stopped;
    const buf = new Uint8Array(await new Blob(parts).arrayBuffer()); let s = '';
    for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192));
    return btoa(s);
  }, [seconds, size]);
  return withDuration(Buffer.from(b64, 'base64'), seconds * 1000);
}

function withDuration(buf, ms) {
  const at = buf.indexOf(Buffer.from([0x15, 0x49, 0xa9, 0x66]));
  if (at < 0) return buf;
  const len = 8 - Math.floor(Math.log2(buf[at + 4]));   // width of the size vint
  const bodyLen = Number(BigInt(`0x${buf.subarray(at + 4, at + 4 + len).toString('hex')}`) & ((1n << BigInt(7 * len)) - 1n));
  const dur = Buffer.alloc(11); dur.set([0x44, 0x89, 0x88]); dur.writeDoubleBE(ms, 3);
  const bodyAt = at + 4 + len;
  return Buffer.concat([buf.subarray(0, at + 4), vint(bodyLen + dur.length), buf.subarray(bodyAt, bodyAt + bodyLen), dur, buf.subarray(bodyAt + bodyLen)]);
}
