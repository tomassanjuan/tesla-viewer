// Per-camera playback health (pure logic, tested). One <video> per camera plays in lockstep with a master;
// this classifies each from cheap snapshots so a stalled/errored cam is recovered once, then flagged, instead of
// dragging the others (a frozen master makes every follower get re-seeked back to its frozen time, forever).

export const STALL_MS = 2000;      // no clock progress for this long while it should be playing = stalled
export const MAX_RECOVERIES = 1;   // re-seek + play attempts per segment before the cam is marked error

/** Fresh record for a cam at the start of a segment. */
export const newHealth = () => ({ time: NaN, at: null, tries: 0, error: false, state: 'paused' });

/**
 * Advance one cam's record. snap: { time, paused, ended, seeking, readyState, error, duration }.
 * want: this cam should be playing now. Mutates and returns h; h.state is one of
 * 'playing' | 'buffering' | 'stalled' | 'error' | 'paused' (intentionally not playing) | 'ended'.
 * h.action is 'recover' when the caller should re-seek to the master and resume (once per MAX_RECOVERIES).
 */
export function stepHealth(h, snap, now, want) {
  h.action = null;
  if (h.error || snap.error) { h.error = true; return (h.state = 'error'), h; }
  const moved = Math.abs(snap.time - h.time) > 0.01;
  h.time = snap.time;
  if (!want) { h.at = now; return (h.state = 'paused'), h; }
  if (snap.ended || (snap.duration > 0 && snap.time >= snap.duration - 0.1)) { h.at = now; return (h.state = 'ended'), h; }
  if (moved) { h.at = now; return (h.state = 'playing'), h; }
  h.at ??= now;
  if (now - h.at < STALL_MS) return (h.state = 'buffering'), h;
  if (h.tries < MAX_RECOVERIES) { h.tries++; h.at = now; h.action = 'recover'; return (h.state = 'stalled'), h; }
  h.error = true;
  return (h.state = 'error'), h;
}

/**
 * Pick the master (the clock everyone else follows): the first camera in `order` that is healthy, else one that is
 * merely buffering, else any not errored, else the first with a source. states: cam id -> state.
 */
export function pickMaster(order, states, has) {
  const c = order.filter(has), bad = (id, ...xs) => xs.includes(states[id]);
  return c.find((id) => !bad(id, 'stalled', 'error', 'buffering')) ?? c.find((id) => !bad(id, 'stalled', 'error')) ?? c.find((id) => !bad(id, 'error')) ?? c[0];
}
