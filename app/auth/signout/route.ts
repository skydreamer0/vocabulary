import { NextResponse } from 'next/server';
import { neonAuth } from '@/lib/auth/server';

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
    return Response.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  }
  const { error } = await neonAuth().signOut();
  if (error) return Response.json({ error: '登出失敗，請再試一次。' }, { status: 502 });
  return NextResponse.redirect(new URL('/login', request.url), 303);
}
