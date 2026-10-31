import {NextRequest,NextResponse} from 'next/server';
import {localDevelopmentApi,accessTokenFrom,backendFetch,backendApiUrl,authErrorResponse} from '@/lib/auth-server';
import {mutationFailure,readBodyBytes} from '@/lib/request-security';
import {localAppMode} from '@/lib/local-runtime';
async function proxy(request:NextRequest) {
  try {
    if(!localAppMode()&&!localDevelopmentApi())return NextResponse.json({error:'API route was not found.',code:'NOT_FOUND'},{status:404});
    const failure=mutationFailure(request);if(failure)throw failure;
    const token=accessTokenFrom(request);if(!token)return NextResponse.json({error:'Sign in to continue.'},{status:401});
    const identity=await backendFetch('/v1/me',token);if(!identity.ok)return NextResponse.json({error:'Sign in to continue.'},{status:401});
    const ticket=request.nextUrl.searchParams.get('ticket');if(!ticket||!/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(ticket))return NextResponse.json({error:'Invalid artifact ticket.'},{status:400});
    const url=new URL('/__local/artifacts',backendApiUrl());url.searchParams.set('ticket',ticket);
    const headers=new Headers();for(const key of ['content-type','content-length','range','x-amz-checksum-sha256']){const value=request.headers.get(key);if(value)headers.set(key,value);}
    const streaming=request.method==='PUT';
    const body=request.method==='GET'?undefined:streaming?request.body:await readBodyBytes(request,64*1024**2+64*1024);
    if(streaming&&!body)throw new Error('Artifact upload body is missing.');
    const init: RequestInit & { duplex?: 'half' }={method:request.method,headers,body,redirect:'manual'};
    if(streaming)init.duplex='half';
    const upstream=await fetch(url.toString(),init);
    if(upstream.status>=300&&upstream.status<400)return NextResponse.json({error:'Artifact redirects are not allowed.'},{status:502});
    const output=new Headers({'Cache-Control':'no-store'});for(const key of ['content-type','content-length','content-range']){const value=upstream.headers.get(key);if(value)output.set(key,value);}
    return new NextResponse(upstream.body,{status:upstream.status,headers:output});
  }catch(error){return authErrorResponse(error);}
}
export const GET=proxy;
export const POST=proxy;
export const PUT=proxy;
