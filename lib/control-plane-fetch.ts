export class ControlPlaneTimeoutError extends Error {
  readonly status = 504;
  readonly code = 'UPSTREAM_TIMEOUT';
  constructor() { super('The service took too long to respond. Check the job state before submitting again.'); this.name = 'ControlPlaneTimeoutError'; }
}

/** No automatic retries: a timed-out submission may already have been accepted. */
export async function controlPlaneFetch(url: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try { return await fetch(url, { ...init, signal }); }
  catch (error) {
    if (timeout.aborted && !init.signal?.aborted) throw new ControlPlaneTimeoutError();
    throw error;
  }
}

export async function controlPlaneJson<T>(response: Response): Promise<T> {
  try { return await response.json() as T; }
  catch (error) {
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) throw new ControlPlaneTimeoutError();
    throw new Error('The service returned an unreadable response. Check the current state before retrying.');
  }
}
