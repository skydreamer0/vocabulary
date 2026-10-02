import postgres from 'postgres';

type Row = Record<string, unknown>;
type Runner = postgres.Sql | postgres.TransactionSql;

const globalForSql = globalThis as { __vocabularySql?: postgres.Sql };

function client(): postgres.Sql {
  if (!globalForSql.__vocabularySql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    globalForSql.__vocabularySql = postgres(url, {
      // Compatible with Neon PgBouncer transaction pooling.
      prepare: false,
      max: 3,
      idle_timeout: 20,
      // Timestamps are epoch-ms bigint columns; return them as numbers.
      types: { bigint: { to: 20, from: [20], parse: Number, serialize: (v: unknown) => String(v) } },
    });
  }
  return globalForSql.__vocabularySql;
}

class Statement {
  constructor(private text: string, private params: unknown[] = []) {}
  bind(...params: unknown[]) { return new Statement(this.text, params); }
  run(runner: Runner) {
    let i = 0;
    return runner.unsafe<Row[]>(this.text.replace(/\?/g, () => `$${++i}`), this.params as never[]);
  }
  async first<T = Row>(): Promise<T | null> { return ((await this.run(client()))[0] as T) ?? null; }
  async all<T = Row>(): Promise<{ results: T[] }> { return { results: [...(await this.run(client()))] as T[] }; }
  async exec(): Promise<void> { await this.run(client()); }
}

/** Minimal prepare/bind/first/all/batch surface; `?` placeholders become `$n`. */
export const db = {
  prepare: (text: string) => new Statement(text),
  /** Runs all statements in one transaction. */
  batch: (statements: Statement[]) =>
    client().begin(async (tx) => {
      const out: { results: Row[] }[] = [];
      for (const s of statements) out.push({ results: [...(await s.run(tx))] });
      return out;
    }),
};

export function database() { return db; }
