import { publicBackendFetch, authErrorResponse } from '@/lib/auth-server';

export async function GET() {
  try {
    const upstream = await publicBackendFetch('/public/compute/catalog');
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': upstream.ok ? 'public, max-age=300' : 'no-store' },
    });
  } catch (error) { return authErrorResponse(error); }
}
