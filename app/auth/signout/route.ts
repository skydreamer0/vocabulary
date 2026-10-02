import { NextResponse } from 'next/server';
import { neonAuth } from '@/lib/auth/server';

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
    return Response.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  }
  let complete = false;
  try { const { error } = await neonAuth().signOut(); complete = !error; } catch {}
  const response = NextResponse.redirect(new URL(complete ? '/login' : '/auth/signout-error', request.url), 303);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
