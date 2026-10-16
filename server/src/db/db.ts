import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Run a multi-statement SQL script (no parameters). */
  exec(sql: string): Promise<void>;
  /** Run fn on one connection inside BEGIN/COMMIT; ROLLBACK and rethrow on error. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface CreateDbOptions {
  databaseUrl: string | null;
  pgliteDir: string | null;
}

export async function createDb(opts: CreateDbOptions): Promise<Db> {
  if (opts.databaseUrl) {
    const pool = new pg.Pool({ connectionString: opts.databaseUrl });
    return {
      async query<T>(sql: string, params?: unknown[]) {
        const res = await pool.query(sql, params);
        return { rows: res.rows as T[] };
      },
      async exec(sql) {
        await pool.query(sql);
      },
      async transaction<T>(fn: (tx: Db) => Promise<T>) {
        const client = await pool.connect();
        const tx: Db = {
          async query<R>(sql: string, params?: unknown[]) {
            const res = await client.query(sql, params);
            return { rows: res.rows as R[] };
          },
          async exec(sql) {
            await client.query(sql);
          },
          transaction: (inner) => inner(tx),
          close: async () => {},
        };
        try {
          await client.query('BEGIN');
          const out = await fn(tx);
          await client.query('COMMIT');
          return out;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }
  // PGlite persists to a directory when given one, otherwise lives in memory.
  const lite = opts.pgliteDir ? new PGlite(opts.pgliteDir) : new PGlite();
  await lite.waitReady;
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const res = await lite.query<T>(sql, params);
      return { rows: res.rows };
    },
    async exec(sql) {
      await lite.exec(sql);
    },
    transaction: (fn) =>
      lite.transaction((t) => {
        const tx: Db = {
          async query<R>(sql: string, params?: unknown[]) {
            const res = await t.query<R>(sql, params);
            return { rows: res.rows };
          },
          async exec(sql) {
            await t.exec(sql);
          },
          transaction: (inner) => inner(tx),
          close: async () => {},
        };
        return fn(tx);
      }),
    close: () => lite.close(),
  };
}
