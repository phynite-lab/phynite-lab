import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'HPC probes run only in the local Phynite workspace. Open the local application to test this profile.', code: 'HPC_LOCAL_ONLY' },
    { status: 404, headers: { 'Cache-Control': 'no-store' } },
  );
}
