/** Share reads within an auth epoch; an auth change always obtains a fresh response. */
let epoch = 0;
let pending: Promise<Response> | null = null;
export function invalidateSessionRequest() { epoch++; pending = null; }
export async function requestSession(): Promise<Response> {
  for (;;) {
    const revision = epoch;
    if (!pending) {
      const request = fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' });
      pending = request;
      void request.finally(() => { if (pending === request) pending = null; }).catch(() => undefined);
    }
    try {
      const response = await pending;
      if (revision === epoch) return response.clone();
    } catch (error) { if (revision === epoch) throw error; }
  }
}
