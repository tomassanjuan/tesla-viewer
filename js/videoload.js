/**
 * Resolves when <video> v has metadata: 'ok' | 'error' (element error) | 'timeout' | 'aborted' (signal).
 * Always settles and always removes its listeners, so a caller's busy task can never be left hanging.
 */
export function waitLoaded(v, { signal, ms = 8000 } = {}) {
  return new Promise((res) => {
    let timer;
    const done = (r) => {
      clearTimeout(timer); v.removeEventListener('loadedmetadata', ok); v.removeEventListener('error', err); signal?.removeEventListener('abort', ab);
      res(r);
    };
    const ok = () => done('ok'), err = () => done('error'), ab = () => done('aborted');
    if (signal?.aborted) return res('aborted');
    v.addEventListener('loadedmetadata', ok); v.addEventListener('error', err); signal?.addEventListener('abort', ab);
    timer = setTimeout(() => done('timeout'), ms);
  });
}
