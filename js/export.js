import { drawBlurs } from './blur.js';
import { t } from './i18n.js';
// Trim + export: records a canvas composite of the playing <video>s via MediaRecorder. Fully in-browser.
// ponytail: real-time recording (export takes as long as the range); WebCodecs faster-than-realtime muxing is a later upgrade.

/** Clamp/normalise a trim range to [0,total]; swaps if reversed. Returns null if shorter than minLen. */
export function clampRange(a, b, total, minLen = 0.1) {
  const s = Math.max(0, Math.min(total, Math.min(a, b))), e = Math.max(0, Math.min(total, Math.max(a, b)));
  return e - s < minLen ? null : { start: s, end: e };
}

/** Per-segment local ranges covered by [start,end]; segs are {start,dur}. */
export function segmentRanges(segs, start, end) {
  const out = [];
  segs.forEach((s, i) => {
    const from = Math.max(start, s.start), to = Math.min(end, s.start + s.dur);
    if (to > from) out.push({ i, from: from - s.start, to: to - s.start });
  });
  return out;
}

export function exportFilename(name, start, end, ext) {
  const t = (x) => `${Math.floor(x / 60)}m${String(Math.floor(x % 60)).padStart(2, '0')}s`;
  return `${String(name).replace(/[^\w.-]+/g, '_')}_${t(start)}-${t(end)}.${ext}`;
}

/** Pick best recorder mime (mp4 preferred, else webm); isSupported = MediaRecorder.isTypeSupported. */
export function pickMime(isSupported) {
  const m = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => isSupported(t));
  return m ? { mime: m, ext: m.startsWith('video/mp4') ? 'mp4' : 'webm' } : null;
}

/** [cam,x,y,w,h] per camera for a WxH canvas. focus => only the focus cam, full frame. */
export function layoutRects(cams, focusCam, focus, W, H) {
  if (focus || cams.length === 1) return [[focus ? focusCam : cams[0], 0, 0, W, H]];
  const n = cams.length, cols = n <= 4 ? 2 : 3, rows = Math.ceil(n / cols), w = W / cols, h = H / rows;
  return cams.map((c, i) => [c, (i % cols) * w, Math.floor(i / cols) * h, w, h]);
}

function drawFrame(x, api, opt, W, H) {
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  for (const [c, X, Y, w, h] of layoutRects(api.ev.cams, api.focusCam, opt.focus, W, H)) {
    const v = api.vids[c];
    if (!v?.videoWidth) continue;
    const k = Math.min(w / v.videoWidth, h / v.videoHeight), dw = v.videoWidth * k, dh = v.videoHeight * k;
    x.drawImage(v, X + (w - dw) / 2, Y + (h - dh) / 2, dw, dh);
    drawBlurs(x, c, { x: X + (w - dw) / 2, y: Y + (h - dh) / 2, w: dw, h: dh }, v, api.globalTime());
  }
  const m = opt.hud && api.sampleAt(api.globalTime());
  if (m) {
    const kmh = api.units() === 'kmh';
    const txt = `${Math.round(m.speedMps * (kmh ? 3.6 : 2.23694))} ${kmh ? 'km/h' : 'mph'}   ${t('STEER')} ${m.steering.toFixed(0)}°   ${t('THROTTLE')} ${(m.accel * 100).toFixed(0)}%${m.brake ? '   ' + t('BRAKE') : ''}${m.blinkerLeft ? '  ◀' : ''}${m.blinkerRight ? '  ▶' : ''}`;
    x.font = '600 24px system-ui,sans-serif';
    const tw = x.measureText(txt).width + 32;
    x.fillStyle = '#000b'; x.fillRect((W - tw) / 2, H - 56, tw, 40);
    x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.fillText(txt, (W - tw) / 2 + 16, H - 36);
  }
}

export async function exportRange(api, start, end, opt, onStatus = () => {}, onProgress = () => {}) {
  const pick = pickMime((t) => MediaRecorder.isTypeSupported(t));
  if (!pick) throw new Error(t('MediaRecorder has no mp4/webm support in this browser'));
  const W = 1280, H = 720, cv = Object.assign(document.createElement('canvas'), { width: W, height: H }), x = cv.getContext('2d');
  const speed = document.getElementById('speed'), oldSpeed = speed.value;
  speed.value = '1'; speed.onchange?.();
  const rec = new MediaRecorder(cv.captureStream(30), { mimeType: pick.mime, videoBitsPerSecond: 8e6 }), chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  api.pause(); await api.seekGlobal(start);
  await new Promise((r) => setTimeout(r, 200)); // let the seeked frame decode
  rec.start(500); api.play();
  const n = segmentRanges(api.ev.segs, start, end).length;
  try {
    await new Promise((res) => {
      const loop = () => {
        const tm = api.globalTime();
        drawFrame(x, api, opt, W, H);
        onProgress(Math.max(0, Math.min(1, (tm - start) / (end - start))));
        onStatus(t('Exporting {pct}% ({n} segment(s))', { pct: Math.round(((tm - start) / (end - start)) * 100), n }));
        if (tm >= end || !api.playing()) return res();
        requestAnimationFrame(loop);
      };
      loop();
    });
  } finally { api.pause(); rec.stop(); await done; speed.value = oldSpeed; speed.onchange?.(); }
  const blob = new Blob(chunks, { type: pick.mime.split(';')[0] });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: exportFilename(api.ev.e.name, start, end, pick.ext) });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 6e4);
  onStatus(t('Exported {name}', { name: a.download }));
}

/** Wire the bar buttons. api: {ev, focusCam (getters), vids, seekGlobal, globalTime, sampleAt, units, play, pause, playing}. */
export function initExport(api) {
  const $ = (id) => document.getElementById(id);
  let inT = null, outT = null;
  const show = () => {
    $('trimInfo').textContent = `in ${inT?.toFixed(1) ?? '–'}s · out ${outT?.toFixed(1) ?? '–'}s`;
    const w = $('seekwrap'), T = api.ev?.total || 1; // scrubber trim markers
    w.classList.toggle('has-in', inT != null); w.classList.toggle('has-out', outT != null);
    w.style.setProperty('--in', `${((inT ?? 0) / T) * 100}%`); w.style.setProperty('--out', `${((outT ?? T) / T) * 100}%`);
  };
  $('setIn').onclick = () => { if (api.ev) { inT = api.globalTime(); show(); } };
  $('setOut').onclick = () => { if (api.ev) { outT = api.globalTime(); show(); } };
  $('export').onclick = async () => {
    if (!api.ev) return;
    const r = clampRange(inT ?? 0, outT ?? api.ev.total, api.ev.total);
    if (!r) return ($('trimInfo').textContent = t('Range too short'));
    $('export').disabled = true;
    const task = api.busy?.begin('Exporting video', 1);
    try { await exportRange(api, r.start, r.end, { hud: $('expHud').checked, focus: $('expFocus').checked }, (s) => ($('trimInfo').textContent = s), (f) => task?.set(f)); }
    catch (e) { $('trimInfo').textContent = t('Export failed: {msg}', { msg: e.message }); }
    task?.end(); $('export').disabled = false;
  };
}
