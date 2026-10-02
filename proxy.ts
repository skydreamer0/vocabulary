import { neonAuth } from '@/lib/auth/server';
import type { NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  return neonAuth().middleware({ loginUrl: '/login' })(request);
}

// API routes validate sessions themselves and return JSON 401 responses.
export const config = { matcher: ['/'] };
