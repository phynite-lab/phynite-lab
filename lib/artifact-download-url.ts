/** Only the supported S3 REST endpoints may be used by the download proxy. */
export function artifactDownloadUrl(value: string, development = false): URL | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.username || url.password || url.hash) return null;
  if (development && url.origin === 'http://127.0.0.1:8792' && url.pathname === '/__local/artifacts' && /^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(url.searchParams.get('ticket') ?? '')) return url;
  if (url.protocol !== 'https:' || (url.port && url.port !== '443')) return null;
  const s3 = /^(?:[a-z0-9][a-z0-9.-]*\.)?s3(?:[.-][a-z]{2}(?:-[a-z]+)+-\d)?\.amazonaws\.com$/;
  if (!s3.test(url.hostname)) return null;
  return url.searchParams.get('X-Amz-Signature') || url.searchParams.get('Signature') ? url : null;
}
