import { createNeonAuth } from '@neondatabase/auth/next/server';
import { NEON_AUTH_SESSION_COOKIE_NAME } from '@neondatabase/auth/server';
import { cookies } from 'next/headers';

let instance: ReturnType<typeof createNeonAuth> | undefined;

export function neonAuth() {
  if (!instance) {
    const baseUrl = process.env.NEON_AUTH_BASE_URL;
    const secret = process.env.NEON_AUTH_COOKIE_SECRET;
    if (!baseUrl || !secret) throw new Error('Neon Auth is not configured');
    instance = createNeonAuth({ baseUrl, cookies: { secret, sessionDataTtl: 60 } });
  }
  return instance;
}

export type AppUser = { userId: string; email: string };

/** Validate the session through Neon's signed session cache/server, never a user-id header. */
export async function getUser(): Promise<AppUser | null> {
  // Missing credentials are anonymous even when the provider is unreachable.
  if (!(await cookies()).get(NEON_AUTH_SESSION_COOKIE_NAME)?.value) return null;
  const { data, error } = await neonAuth().getSession();
  if (error) throw new Error('Unable to verify sign-in session');
  return data?.user ? { userId: data.user.id, email: data.user.email } : null;
}
