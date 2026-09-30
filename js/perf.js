// Playback performance helpers: pure logic (tested) plus a small on-page readout and low-load toggle.

/** True when at least 1000/hz ms passed since `last`. */
export const due = (now, last, hz) => now - last >= 1000 / hz;

/**
 * Pick at most one camera to re-seek: the worst offender beyond `tol` seconds.
 * Correcting one per call avoids 5 simultaneous seeks stalling every decoder.
 * cams: [{ id, time, paused, seeking }] ; masterTime in seconds. Returns cam id or null.
 */
export function pickDriftFix(cams, masterTime, tol = 0.35) {
  let worst = null, max = tol;
  for (const c of cams) {
    if (c.paused || c.seeking) continue;
    const d = Math.abs(c.time - masterTime);
    if (d > max) { max = d; worst = c.id; }
  }
  return worst;
}

/** Low-load: only the focused tile plays; others stay paused. */
export const shouldPlay = (cam, focusCam, lowLoad) => !lowLoad || cam === focusCam;

/** Dropped-frame % from two getVideoPlaybackQuality() snapshots. */
export function dropRate(prev, cur) {
  const total = cur.totalVideoFrames - prev.totalVideoFrames;
  return total > 0 ? ((cur.droppedVideoFrames - prev.droppedVideoFrames) / total) * 100 : 0;
}

/** MediaCapabilities check for a clip's codec; resolves {supported, smooth, powerEfficient} or null. */
export async function decodeInfo(codec, width, height, fps = 36) {
  try {
    const contentType = /hev|hvc|265/i.test(codec || '') ? 'video/mp4; codecs="hvc1.1.6.L153.B0"' : 'video/mp4; codecs="avc1.640028"';
    return await navigator.mediaCapabilities.decodingInfo({ type: 'file', video: { contentType, width: width || 1280, height: height || 960, bitrate: 4e6, framerate: fps } });
  } catch { return null; }
}

/** Builds the readout + low-load toggle. api: { vids, getLowLoad, setLowLoad, codec } */
export function initPerf(api) {
  const stage = document.getElementById('extras-stage') ?? document.body;
  document.head.append(Object.assign(document.createElement('style'), { textContent:
    '.perf-out{position:fixed;left:8px;bottom:8px;z-index:20;font:11px/1.4 ui-monospace,monospace;background:#000a;color:#fff;padding:4px 8px;border-radius:6px;pointer-events:none;white-space:pre}.perf-out[hidden]{display:none}' }));
  const lite = document.getElementById('lowLoad'), btn = document.getElementById('perfBtn');
  lite.onclick = () => { const on = lite.getAttribute('aria-pressed') !== 'true'; lite.setAttribute('aria-pressed', String(on)); api.setLowLoad(on); };
  const out = Object.assign(document.createElement('div'), { className: 'perf-out', hidden: true });
  stage.append(out);
  let prev = {}, hw = '', timer = 0;
  const tick = async () => {
    const lines = [];
    for (const [id, v] of Object.entries(api.vids)) {
      if (!v.src || !v.getVideoPlaybackQuality) continue;
      const q = v.getVideoPlaybackQuality(), p = prev[id] ?? { totalVideoFrames: 0, droppedVideoFrames: 0 };
      lines.push(`${id.padEnd(15)} drop ${dropRate(p, q).toFixed(0).padStart(3)}%  (${q.droppedVideoFrames}/${q.totalVideoFrames})`);
      prev[id] = { totalVideoFrames: q.totalVideoFrames, droppedVideoFrames: q.droppedVideoFrames };
    }
    out.textContent = `${hw}\n${lines.join('\n')}`;
  };
  btn.onclick = async () => {
    out.hidden = !out.hidden; btn.setAttribute('aria-pressed', String(!out.hidden));
    clearInterval(timer);
    if (out.hidden) return;
    const c = await decodeInfo(api.codec());
    hw = c ? `decode: ${c.supported ? 'ok' : 'unsupported'}, ${c.powerEfficient ? 'hardware (power efficient)' : 'likely software'}, ${c.smooth ? 'smooth' : 'not smooth'}` : 'decode: unknown';
    tick(); timer = setInterval(tick, 1000);
  };
}
