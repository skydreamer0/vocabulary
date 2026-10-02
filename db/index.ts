import { env } from 'cloudflare:workers';
export function database(): D1Database {
  if (!env.DB) throw new Error('D1 binding unavailable');
  return env.DB;
}
