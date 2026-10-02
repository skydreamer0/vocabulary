import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

export const USERS = {
  alice: '10000000-0000-4000-8000-000000000001',
  bob: '10000000-0000-4000-8000-000000000002',
  outsider: '10000000-0000-4000-8000-000000000003',
};
export const migrationsURL = new URL('../../supabase/migrations/', import.meta.url);

export async function applyMigrations(exec) {
  const names = (await readdir(migrationsURL)).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  if (!names.length) throw new Error('No vocabulary SQL migrations found');
  for (const name of names) await exec(await readFile(new URL(name, migrationsURL), 'utf8'));
}

// This is deliberately only the Supabase Auth surface used by the real migration.
// The migration, its SQL functions, grants, and RLS policies are never mocked.
const bootstrap = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable set search_path = '' as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

export function validateTestDatabaseURL(connectionString) {
  const url = new URL(connectionString);
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres']);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !localHosts.has(url.hostname.toLowerCase())) {
    throw new Error('TEST_DATABASE_URL must target localhost, 127.0.0.1, ::1, or the CI service postgres; remote databases are refused');
  }
  // pg connection-string query parameters can override the URL host/database.
  // That would defeat both the local-host boundary and temporary DB isolation.
  const overrides = new Set(['host', 'hostaddr', 'hostname', 'port', 'database', 'dbname', 'user', 'password']);
  if ([...url.searchParams.keys()].some(key => overrides.has(key.toLowerCase()))) {
    throw new Error('TEST_DATABASE_URL must not override its host, database, or identity in query parameters');
  }
  return url;
}

export async function createTestDatabase() {
  const connectionString = process.env.TEST_DATABASE_URL;
  let db;
  let admin;
  let databaseName;
  let nativeURL;
  const createdRoles = [];
  if (connectionString) {
    // Never point these tests at a Supabase project. Native runs use a disposable
    // database on a local/CI PostgreSQL server whose login can CREATE DATABASE.
    const url = validateTestDatabaseURL(connectionString);
    const { Client } = await import('pg');
    const options = { connectionString, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 };
    admin = new Client(options);
    await admin.connect();
    databaseName = `vocab_test_${randomUUID().replaceAll('-', '')}`;
    try {
      for (const role of ['anon', 'authenticated']) {
        const { rows } = await admin.query('select rolsuper, rolbypassrls from pg_roles where rolname = $1', [role]);
        if (!rows.length) {
          await admin.query(`create role ${role} nologin nosuperuser nobypassrls`);
          createdRoles.push(role);
        } else if (rows[0].rolsuper || rows[0].rolbypassrls) {
          throw new Error(`${role} must not have SUPERUSER or BYPASSRLS privileges in the test server`);
        }
      }
      await admin.query(`create database "${databaseName}" template template0 encoding 'UTF8'`);
      url.pathname = `/${databaseName}`;
      nativeURL = url.toString();
      db = new Client({ ...options, connectionString: nativeURL });
      await db.connect();
    } catch (error) {
      if (db) await db.end().catch(() => {});
      if (databaseName) await admin.query(`drop database if exists "${databaseName}"`).catch(() => {});
      for (const role of createdRoles.reverse()) await admin.query(`drop role ${role}`).catch(() => {});
      await admin.end();
      throw error;
    }
  } else {
    db = new PGlite();
    await db.exec('create role anon nologin nosuperuser nobypassrls; create role authenticated nologin nosuperuser nobypassrls;');
  }
  const native = Boolean(connectionString);
  const query = (sql, values = []) => db.query(sql, values);
  const exec = sql => native ? db.query(sql) : db.exec(sql);
  const sessions = new Set();
  const close = async () => {
    for (const client of sessions) await client.end().catch(() => {});
    sessions.clear();
    if (native) {
      await db.end();
      try {
        await admin.query(`drop database "${databaseName}"`);
        for (const role of createdRoles.reverse()) await admin.query(`drop role ${role}`);
      } finally {
        await admin.end();
      }
    } else {
      await db.close();
    }
  };
  try {
    await exec(bootstrap);
    await applyMigrations(exec);
  } catch (error) {
    await close();
    throw error;
  }
  return {
    native,
    query,
    exec,
    close,
    async reset() {
      await exec('truncate public.vocab_reviews, public.vocab_words, public.vocab_members, vocab_private.rate_limits, auth.users cascade;');
      await query('insert into auth.users(id) values ($1), ($2), ($3)', Object.values(USERS));
      await query('insert into public.vocab_members(user_id) values ($1), ($2)', [USERS.alice, USERS.bob]);
    },
    async as(user, operation, role = 'authenticated') {
      await query('begin');
      try {
        await establishIdentity(db, user, role);
        const result = await operation(db);
        await query('commit');
        return result;
      } catch (error) {
        await query('rollback');
        throw error;
      }
    },
    async session(user, role = 'authenticated') {
      if (!native) throw new Error('PGlite has one connection; independent-session tests require TEST_DATABASE_URL');
      const { Client } = await import('pg');
      const client = new Client({ connectionString: nativeURL, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
      await client.connect();
      sessions.add(client);
      try {
        const { rows: [{ pid }] } = await client.query('select pg_backend_pid() as pid');
        await client.query('begin');
        await establishIdentity(client, user, role);
        return { client, pid, async close() {
          await client.query('rollback').catch(() => {});
          await client.end();
          sessions.delete(client);
        } };
      } catch (error) {
        await client.end();
        sessions.delete(client);
        throw error;
      }
    },
  };
}

async function establishIdentity(client, user, role) {
  if (!['authenticated', 'anon'].includes(role)) throw new Error('Unknown test role');
  await client.query(`set local role ${role}`);
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? '']);
  await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(user ? { sub: user, role } : { role })]);
}

const signatures = {
  vocab_is_member: [],
  vocab_import_words: ['jsonb'],
  vocab_edit_word: ['uuid', 'integer', 'text', 'text', 'text', 'text', 'boolean'],
  vocab_review_word: ['uuid', 'integer', 'uuid', 'text', 'text'],
  vocab_lookup_budget: [],
  vocab_enrich_word: ['uuid', 'text', 'jsonb', 'text', 'text'],
};

export async function rpc(client, name, args = [], schema = 'public') {
  const types = signatures[name];
  if (!types || args.length !== types.length || !['public', 'vocab_private'].includes(schema)) throw new Error('Unknown RPC signature');
  const placeholders = types.map((type, index) => `$${index + 1}::${type}`).join(',');
  const { rows } = await client.query(`select ${schema}.${name}(${placeholders}) as value`, args);
  return rows[0].value;
}
