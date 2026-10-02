import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import postgres from 'postgres';

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL_UNPOOLED for migrations');
if (new URL(url).hostname.includes('-pooler')) throw new Error('Use the direct connection for migrations');
const sql = postgres(url, { max: 1, prepare: false });
try {
  await sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(846271930)`;
    await tx`create schema if not exists vocabulary_migrations`;
    await tx`create table if not exists vocabulary_migrations.applied (name text primary key, checksum text not null, applied_at timestamptz not null default now())`;
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const name of (await readdir(dir)).filter(name => name.endsWith('.sql')).sort()) {
      const source = await readFile(new URL(name, dir), 'utf8');
      const checksum = createHash('sha256').update(source).digest('hex');
      const [existing] = await tx`select checksum from vocabulary_migrations.applied where name = ${name}`;
      if (existing) {
        if (existing.checksum !== checksum) throw new Error(`Migration changed after applying: ${name}`);
        continue;
      }
      await tx.unsafe(source);
      await tx`insert into vocabulary_migrations.applied (name, checksum) values (${name}, ${checksum})`;
      console.log(`Applied ${name}`);
    }
  });
  console.log('Database migrations complete');
} finally {
  await sql.end();
}
