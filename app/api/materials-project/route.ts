import { NextRequest, NextResponse } from 'next/server';
import { CrystalDatabaseError, searchCrystalDatabase, type CrystalDatabaseSource } from '@/lib/crystal-database';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    const result = await searchCrystalDatabase(request.nextUrl.searchParams.get('q'), {
      apiKey: process.env.MP_API_KEY,
      source: (request.nextUrl.searchParams.get('source') ?? 'auto') as CrystalDatabaseSource,
      limit: Number(request.nextUrl.searchParams.get('limit')) || 12,
      signal: request.signal,
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (failure) {
    const error = failure instanceof CrystalDatabaseError ? failure : new CrystalDatabaseError(502, 'CRYSTAL_DATABASE_UNAVAILABLE', 'Crystal lookup could not complete. Try an exact ID or import a CIF manually.');
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  }
}
