import { NextResponse } from 'next/server';

function localOnly() {
  return NextResponse.json(
    { error: 'HPC cluster profiles are available only in the local Phynite workspace. Open the local application to manage SSH profiles.', code: 'HPC_LOCAL_ONLY' },
    { status: 404, headers: { 'Cache-Control': 'no-store' } },
  );
}

export const GET = localOnly;
export const PUT = localOnly;
export const DELETE = localOnly;
