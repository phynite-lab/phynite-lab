/** Development fixtures and fake identities are not part of the public app. */
export function devSandboxMode(): boolean { return false; }
export function devSandboxRole(): 'user' | 'admin' { throw new Error('Development identities are not available in the local application.'); }
export function resetDevSandbox(): never { throw new Error('Development identities are not available in the local application.'); }
export async function handleDevSandboxApi(request: Request, segments: string[]): Promise<Response> { void request; void segments; return Response.json({ error: 'Not found.', code: 'NOT_FOUND' }, { status: 404 }); }
export async function storeDevSandboxBlob(request: Request, id: string): Promise<Response> { void request; void id; return Response.json({ error: 'Not found.', code: 'NOT_FOUND' }, { status: 404 }); }
