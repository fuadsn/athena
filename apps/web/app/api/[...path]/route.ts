import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const allowed = /^(?:session|state|health|events|learning-runs(?:\/[a-zA-Z0-9_.:-]+)?|procedures\/[a-zA-Z0-9_.:-]+\/publish|requests(?:\/[a-zA-Z0-9_.:-]+(?:\/resume)?)?|plans\/[a-zA-Z0-9_.:-]+\/approval|authority\/assign|sources\/[a-zA-Z0-9_.:-]+|demo\/reset)$/;

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const route = path.join('/');
  if (!allowed.test(route)) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Unknown endpoint.' } }, { status: 404 });
  if (request.method !== 'GET') {
    const origin = request.headers.get('origin');
    if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Cross-origin changes are not permitted.' } }, { status: 403 });
  }
  try {
    const upstream = new URL(`/${route}`, process.env.RUNTIME_URL || 'http://127.0.0.1:4100');
    upstream.search = request.nextUrl.search;
    const headers = new Headers({ accept: 'application/json' });
    const cookie = request.headers.get('cookie');
    if (cookie) headers.set('cookie', cookie);
    if (request.method !== 'GET') {
      headers.set('content-type', 'application/json');
      headers.set('origin', request.nextUrl.origin);
    }
    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body: request.method === 'GET' ? undefined : await request.text(),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    const outgoing = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
    for (const cookie of response.headers.getSetCookie()) outgoing.append('set-cookie', cookie);
    return new NextResponse(await response.text(), { status: response.status, headers: outgoing });
  } catch {
    return NextResponse.json({ error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Athena could not reach the runtime. Check that the runtime and FalkorDB are running, then retry.' } }, { status: 503 });
  }
}
export const GET = proxy;
export const POST = proxy;
