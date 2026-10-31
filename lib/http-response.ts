/** RFC Retry-After delta-seconds or date; no implicit retry of a mutation. */
export function retryAfterSeconds(response: Pick<Response, 'headers' | 'status'>, now = Date.now()): number | null {
  if (response.status !== 429) return null;
  const value = response.headers.get('Retry-After');
  if (!value) return null;
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - now) / 1000);
  return Number.isFinite(seconds) ? Math.max(1, Math.min(seconds, 86400)) : null;
}
export function httpFailureMessage(response: Response, fallback: string, waiting: (seconds: number) => string): string {
  const seconds = retryAfterSeconds(response);
  return seconds === null ? fallback : `${fallback} ${waiting(seconds)}`;
}
