import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        // Server Components cannot set cookies; proxy.ts refreshes the session instead.
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch {}
      },
    },
  });
}

export type AppUser = { userId: string; email: string };

/** Verified against the Supabase Auth server, never read from client-supplied headers. */
export async function getUser(): Promise<AppUser | null> {
  const { data } = await (await supabaseServer()).auth.getUser();
  return data.user ? { userId: data.user.id, email: data.user.email ?? '' } : null;
}
