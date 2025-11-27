// Snapshot registry: components can register an async collector function.
// No globals are created on `window` — registry lives in this module scope.

type Collector = () => Promise<any> | any;

const collectors: Collector[] = [];

/**
 * Register a snapshot collector. Returns an unregister function.
 */
export function registerSnapshotCollector(fn: Collector): () => void {
  collectors.push(fn);
  return () => {
    const idx = collectors.indexOf(fn);
    if (idx !== -1) collectors.splice(idx, 1);
  };
}

/**
 * Attempt to collect a snapshot by invoking registered collectors in order.
 * Resolves to the first non-undefined value returned by a collector, or undefined.
 */
export async function collectSnapshot(timeoutMs = 5000): Promise<any | undefined> {
  // Try registered collectors first (module-local, not global)
  for (const c of collectors) {
    try {
      const res = await Promise.resolve().then(() => c());
      if (res !== undefined && res !== null) return res;
    } catch (e) {
      console.warn('snapshot collector threw', e);
    }
  }

  // If no collector provided a payload, return undefined (no global fallbacks).
  return undefined;
}

export function hasCollectors(): boolean {
  return collectors.length > 0;
}
