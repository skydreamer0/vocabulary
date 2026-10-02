import { neonAuth } from '@/lib/auth/server';
import type { NextRequest } from 'next/server';

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: Context) {
  return neonAuth().handler().GET(request, context);
}

export async function POST(request: NextRequest, context: Context) {
  const origin = request.headers.get('origin');
  if ((origin && origin !== request.nextUrl.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
    return Response.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  }
  return neonAuth().handler().POST(request, context);
}
