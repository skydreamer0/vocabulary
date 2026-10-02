import { neonAuth } from '@/lib/auth/server';
import { NextRequest, NextResponse } from 'next/server';
import { NEON_AUTH_SESSION_COOKIE_NAME } from '@neondatabase/auth/server';

export async function proxy(request: NextRequest) {
  if (!request.cookies.get(NEON_AUTH_SESSION_COOKIE_NAME)?.value) {
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
  // Keep upstream outages distinct from an expired session. The SDK's default
  // middleware treats every unsuccessful session response as a login redirect.
  try {
    const session = await neonAuth().handler().GET(
      new NextRequest(new URL('/api/auth/get-session', request.url), { headers: request.headers }),
      { params: Promise.resolve({ path: ['get-session'] }) },
    );
    if (!session.ok) {
      if (session.status !== 401) throw new Error('Session service unavailable');
      return NextResponse.redirect(new URL('/login', request.url));
    }
    const data = await session.json();
    const response = data?.user
      ? NextResponse.next()
      : NextResponse.redirect(new URL('/login', request.url));
    for (const cookie of session.headers.getSetCookie()) response.headers.append('Set-Cookie', cookie);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch {
    return new Response('登入服務暫時無法連線。登入狀態與資料不會因此清除，請稍後重新載入。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store', 'Retry-After': '30' },
    });
  }
}

// API routes validate sessions themselves and return JSON 401 responses.
export const config = { matcher: ['/'] };
