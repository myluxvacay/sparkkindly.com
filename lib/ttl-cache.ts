// Cache an async call's result (or rejection) for ttlMs, sharing one in-flight call between concurrent callers.
// Used to stop a public endpoint from turning every request into a dependency call.
export function memoizeFor<T>(ttlMs: number, fn: () => Promise<T>, now: () => number = Date.now): () => Promise<T> {
  let hit: { at: number; promise: Promise<T> } | undefined;
  return () => {
    const t = now();
    if (!hit || t - hit.at >= ttlMs) hit = { at: t, promise: fn() };
    return hit.promise;
  };
}
