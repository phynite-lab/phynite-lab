/** Server-only local runtime selection. The hosted build never accepts this mode. */
export function localAppMode(): boolean {
  if (process.env.PHYNITE_BUILD_TARGET !== 'local' || process.env.PHYNITE_APP_MODE !== 'local') return false;
  const value = process.env.PHYNITE_LOCAL_API_URL;
  if (!value || !process.env.PHYNITE_LOCAL_SERVICE_TOKEN) throw new Error('Start the local application through phynite-lab.');
  const origin = new URL(value);
  if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)
    || !origin.port || origin.username || origin.password || !['', '/'].includes(origin.pathname) || origin.search || origin.hash) {
    throw new Error('The local control plane must use a loopback origin.');
  }
  return true;
}

export function localArtifactUrl(value: string, origin: string): URL | null {
  try {
    const url = new URL(value);
    if (url.origin !== new URL(origin).origin || url.pathname !== '/__local/artifacts' || url.username || url.password || url.hash
      || !/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(url.searchParams.get('ticket') ?? '')) return null;
    return url;
  } catch { return null; }
}
