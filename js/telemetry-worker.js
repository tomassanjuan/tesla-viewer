// Parses clips off the main thread. In: { id, blob }. Out: { id, clip } or { id, error }.
import { parseClipBlob } from './mp4.js';
self.onmessage = async ({ data: { id, blob } }) => {
  try { self.postMessage({ id, clip: await parseClipBlob(blob) }); }
  catch (e) { self.postMessage({ id, error: String(e?.message ?? e) }); }
};
