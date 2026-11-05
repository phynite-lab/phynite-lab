/** Browser API protections. Native compute workers use the separate backend API. */
export class RequestSecurityError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code: string) {
    super(message);
    this.name = 'RequestSecurityError';
    this.status = status;
    this.code = code;
  }
}

export const MD_UPLOAD_PART_BYTES = 16 * 1024 ** 2;
export const SANDBOX_UPLOAD_BYTES = 64 * 1024 ** 2;
export const SANDBOX_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
// AI source uploads are forwarded as a stream to the authenticated object
// store.  Their exact declared size is checked by the attachment ticket and
// checksum on completion, so the generic JSON body guard must not reintroduce
// a small proxy limit here.
export const AI_ATTACHMENT_BODY_BYTES = Number.MAX_SAFE_INTEGER;

function uploadBodyType(request: Request, contentType: string): boolean {
  if (request.method === 'PUT' && /^\/api\/local\/projects\/imports\/[a-f0-9]{32}\/parts\/[0-9]+$/.test(new URL(request.url).pathname)) return contentType === 'application/octet-stream';
  if (request.method === 'PUT' && /^\/api\/ai\/conversations\/aic_[a-z0-9]+\/attachments\/aif_[a-z0-9]+\/content$/.test(new URL(request.url).pathname)) return contentType === 'application/octet-stream';
  if (new URL(request.url).pathname === '/api/local-artifacts' && ['POST','PUT'].includes(request.method)) return ['application/octet-stream','multipart/form-data'].includes(contentType);
  if (request.method !== 'POST') return false;
  const url = new URL(request.url);
  if (/^\/api\/md-upload\/[A-Za-z0-9_-]{1,96}$/.test(url.pathname)) {
    return url.searchParams.get('complete') !== '1' && contentType === 'application/octet-stream';
  }
  return /^\/api\/dev-sandbox\/blob\/[A-Za-z0-9_-]{1,96}$/.test(url.pathname)
    && ['application/octet-stream', 'multipart/form-data'].includes(contentType);
}

export function mutationFailure(request: Request): RequestSecurityError | null {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return null;
  if (request.method === 'POST' && new URL(request.url).pathname === '/api/payments/doku/notifications') {
    // This machine endpoint authenticates raw bytes with DOKU's HMAC. Browser
    // cookies and Origin do not authorize it and are not forwarded upstream.
    return request.body && request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json'
      ? new RequestSecurityError(415, 'JSON is required.', 'JSON_REQUIRED') : null;
  }
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if ((origin !== null && origin !== new URL(request.url).origin) || site === 'cross-site'
    || (!origin && request.headers.has('cookie') && site !== 'same-origin')) {
    return new RequestSecurityError(403, 'Use the Phynite website to make this request.', 'INVALID_ORIGIN');
  }
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? '';
  if (request.body && contentType !== 'application/json' && !uploadBodyType(request, contentType)) {
    return new RequestSecurityError(415, 'JSON is required.', 'JSON_REQUIRED');
  }
  return null;
}

export function requestBodyLimit(path: string): number {
  if (/^\/api\/ai\/conversations\/aic_[a-z0-9]+\/attachments\/aif_[a-z0-9]+\/content$/.test(path)) return AI_ATTACHMENT_BODY_BYTES;
  if (/^\/api\/local\/projects\/imports\/[a-f0-9]{32}\/parts\/[0-9]+$/.test(path)) return 4 * 1024 ** 2;
  if (/^\/api\/md-upload\/[A-Za-z0-9_-]{1,96}$/.test(path)) return MD_UPLOAD_PART_BYTES;
  if (/^\/api\/dev-sandbox\/blob\/[A-Za-z0-9_-]{1,96}$/.test(path)) return SANDBOX_UPLOAD_BYTES + SANDBOX_MULTIPART_OVERHEAD_BYTES;
  if (path === '/api/payments/doku/notifications') return 64_000;
  if (path === '/api/local-artifacts') return 64 * 1024 ** 2 + 64 * 1024;
  if (path === '/api/phynite/v1/local-workflow-import') return 68 * 1024 ** 2;
  if (path === '/api/contact') return 12_000;
  if (path === '/api/waitlist') return 2_000;
  if (path === '/api/invitation') return 512;
  if (path.startsWith('/api/analytics/')) return 1_024;
  if (path.startsWith('/api/auth/')) return 8_192;
  // Preserve existing 4.5 MB workspace snapshots and 8 MB MD manifests.
  return 10 * 1024 * 1024;
}

export function declaredBodyFailure(request: Request, maximum = requestBodyLimit(new URL(request.url).pathname)): RequestSecurityError | null {
  const declared = request.headers.get('content-length');
  return declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > maximum)
    ? new RequestSecurityError(413, 'Request body is too large or its length is invalid.', 'REQUEST_TOO_LARGE') : null;
}

export async function readBodyBytes(request: Request, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  const failure = declaredBodyFailure(request, maximum);
  if (failure) throw failure;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new RequestSecurityError(413, 'Request body is too large.', 'REQUEST_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export async function readJsonBody<T extends object>(request: Request, maximum = requestBodyLimit(new URL(request.url).pathname)): Promise<T> {
  const failure = mutationFailure(request);
  if (failure) throw failure;
  const bytes = await readBodyBytes(request, maximum);
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Not an object');
    return value as T;
  } catch {
    throw new RequestSecurityError(400, 'Request body must be a valid JSON object.', 'INVALID_JSON');
  }
}

export function publicRateGroup(path: string): 'auth' | 'form' | null {
  if (path.startsWith('/api/auth/') && !path.endsWith('/logout')) return 'auth';
  return ['/api/waitlist', '/api/contact', '/api/invitation'].includes(path) ? 'form' : null;
}

export function securityHeaders(production: boolean, path = ''): Record<string, string> {
  const privateAiSource = /^\/api\/ai\/conversations\/aic_[a-z0-9]+\/attachments\/aif_[a-z0-9]+\/content$/.test(path);
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': privateAiSource ? "sandbox; default-src 'none'; frame-ancestors 'none'" : production ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.amazonaws.com; font-src 'self'; connect-src 'self' https://*.amazonaws.com; worker-src 'self' blob:; media-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'" : "base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
    ...(production ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
  };
}
