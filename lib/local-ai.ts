/** Server-only transport to the launcher-owned AI service. No provider token reaches the browser. */
import { localAppMode } from './local-runtime.ts';
import { AuthServiceError } from './auth-server.ts';

export async function localAiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!localAppMode()) throw new AuthServiceError(404, 'Local AI is available in the installed application.', 'LOCAL_AI_REQUIRED');
  const token = process.env.PHYNITE_LOCAL_AI_TOKEN, value = process.env.PHYNITE_LOCAL_AI_URL;
  if (!value || !token) throw new AuthServiceError(503, 'Restart Phynite Lab with the current launcher to connect AI.', 'LOCAL_AI_UNAVAILABLE');
  const origin = new URL(value);
  if (origin.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(origin.hostname) || !origin.port || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !/^\/[a-z0-9/-]+$/.test(path)) throw new AuthServiceError(503, 'The local AI transport needs a launcher restart.', 'LOCAL_AI_UNAVAILABLE');
  return fetch(origin.origin + path, { ...init, redirect: 'error', headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${token}` }, signal: init.signal ?? AbortSignal.timeout(5 * 60_000) });
}
