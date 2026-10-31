import { MD_UPLOAD_PART_BYTES, mutationFailure, readBodyBytes, RequestSecurityError } from './request-security.ts';

/** One bounded part is verified before forwarding it to its owner-scoped S3 ticket. */
export async function readMdUploadPart(request: Request, size: number, sha256: string): Promise<Uint8Array<ArrayBuffer>> {
  const failure = mutationFailure(request);
  if (failure) throw failure;
  if (!Number.isInteger(size) || size < 1 || size > MD_UPLOAD_PART_BYTES || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new RequestSecurityError(400, 'Invalid upload part size or checksum.', 'INVALID_UPLOAD_PART');
  }
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) !== size) throw new RequestSecurityError(400, 'Upload part length does not match its declared size.', 'UPLOAD_PART_SIZE_MISMATCH');
  const bytes = await readBodyBytes(request, size);
  if (bytes.byteLength !== size) throw new RequestSecurityError(400, 'Upload part is incomplete. Retry the same source.', 'UPLOAD_PART_SIZE_MISMATCH');
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== sha256) throw new RequestSecurityError(400, 'Upload part checksum does not match. Retry the same source.', 'UPLOAD_PART_CHECKSUM_MISMATCH');
  return bytes;
}
