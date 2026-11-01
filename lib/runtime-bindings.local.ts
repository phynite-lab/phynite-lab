/** Node-only bindings. Never loads a Worker module or sends local analytics. */
export function localRateLimiter(limit: number, periodSeconds: number, now = Date.now) {
  const windows = new Map<string, { started: number; requests: number }>();
  return {
    async limit({ key }: { key: string }): Promise<{ success: boolean }> {
      const time = now();
      if (windows.size > 10000) for (const [id, window] of windows) {
        if (time - window.started >= periodSeconds * 1000) windows.delete(id);
      }
      const previous = windows.get(key);
      if (!previous || time - previous.started >= periodSeconds * 1000) {
        if (windows.size >= 10000 && !windows.has(key)) return { success: false };
        windows.set(key, { started: time, requests: 1 });
        return { success: true };
      }
      previous.requests += 1;
      return { success: previous.requests <= limit };
    },
  };
}

export const env = Object.freeze({
  PHYNITE_AUTH_RATE_LIMIT: localRateLimiter(20, 60),
  PHYNITE_PUBLIC_RATE_LIMIT: localRateLimiter(15, 60),
});

export function waitUntil(promise: Promise<unknown>): void {
  void promise.catch(() => console.warn('Local background operation failed.'));
}
