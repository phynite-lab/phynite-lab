import { artifactDownloadUrl } from './artifact-download-url.ts';
import { PhyniteApiError } from './phynite-api.ts';

/** Keep authenticated API downloads on their route and legacy S3 links on the proxy. */
export async function downloadMdCloudFile(url: string, options: {
  signal?: AbortSignal;
  fetch?: typeof fetch;
} = {}): Promise<Blob> {
  const sameOrigin = url.startsWith('/api/') && !url.includes('\\');
  if (!sameOrigin && !artifactDownloadUrl(url,true)) {
    throw new Error('The cloud file download address is invalid. Refresh the project and try again.');
  }
  const response = await (options.fetch ?? fetch)(
    sameOrigin ? url : `/api/md-cloud-download?url=${encodeURIComponent(url)}`,
    { credentials: 'same-origin', cache: 'no-store', signal: options.signal },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; code?: string } | null;
    const missing = response.status === 404;
    const unavailableRoute = missing && payload?.code === 'NOT_FOUND';
    const message = unavailableRoute
      ? 'Cloud file downloads are unavailable on this server. Contact support to update the MD download service.'
      : payload?.error || (missing
        ? 'This trajectory source is missing from cloud storage. Re-import the file or remove this entry.'
        : `The cloud file could not be downloaded (status ${response.status}). Please retry.`);
    throw new PhyniteApiError(response.status, message, payload?.code ?? 'MD_DOWNLOAD_FAILED');
  }
  return response.blob();
}
