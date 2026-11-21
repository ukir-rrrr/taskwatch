import fs from "node:fs";
import path from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import type { Client } from "@libsql/client";

export const DB_PATH = path.resolve(process.env.TASKWATCH_DB_PATH ?? "data/taskwatch.db");

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id       TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  status           TEXT NOT NULL,
  status_detail    TEXT,
  acus_consumed    REAL NOT NULL DEFAULT 0,
  pr_urls          TEXT NOT NULL DEFAULT '[]',
  pr_states        TEXT NOT NULL DEFAULT '[]',
  url              TEXT NOT NULL DEFAULT '',
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  first_seen_at    INTEGER NOT NULL,
  needs_attention  INTEGER NOT NULL DEFAULT 0,
  current_activity TEXT NOT NULL DEFAULT '',
  source           TEXT NOT NULL DEFAULT 'devin'
);
CREATE INDEX IF NOT EXISTS sessions_updated_at ON sessions (updated_at DESC);
CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY,
  pr_url       TEXT NOT NULL UNIQUE,
  session_id   TEXT NOT NULL,
  pr_title     TEXT NOT NULL DEFAULT '',
  repo         TEXT NOT NULL DEFAULT '',
  pr_state     TEXT,
  created_at   INTEGER NOT NULL,
  summary      TEXT,
  code_picks   TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generated')),
  generated_at INTEGER
);
CREATE INDEX IF NOT EXISTS reports_created_at ON reports (created_at DESC);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export type SqlValue = string | number | bigint | null;
export interface Statement {
  sql: string;
  args?: SqlValue[];
}

/** ローカル SQLite と libSQL（Turso）の共通インターフェース。引数は位置指定（?）のみ */
export interface Db {
  readonly kind: "local" | "libsql";
  /** ログ表示用の接続先（トークンは含まない） */
  readonly label: string;
  all<T>(sql: string, args?: SqlValue[]): Promise<T[]>;
  get<T>(sql: string, args?: SqlValue[]): Promise<T | undefined>;
  run(sql: string, args?: SqlValue[]): Promise<void>;
  /** 書き込みトランザクションとしてまとめて実行する（全件成功か全件取り消し） */
  batch(statements: Statement[]): Promise<void>;
  close(): void;
}

export interface TursoConfig {
  url: string;
  authToken: string;
}

let warnedPartialTurso = false;

/** TURSO_DATABASE_URL と TURSO_AUTH_TOKEN の両方がプロセス環境変数にあるときだけ Turso を使う */
export function readTursoConfig(): TursoConfig | null {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (url && authToken) return { url, authToken };
  if ((url || authToken) && !warnedPartialTurso) {
    warnedPartialTurso = true;
    console.warn("[db] TURSO_DATABASE_URL と TURSO_AUTH_TOKEN の片方しか設定されていないため、ローカル SQLite を使います");
  }
  return null;
}

/**
 * 環境変数に応じて Turso（libSQL）またはローカル SQLite を開く。
 * readonly: 画面用。スキーマ作成をせず、ローカルでファイルが無ければ null を返す。
 */
export async function openDb(opts: { readonly?: boolean } = {}): Promise<Db | null> {
  const turso = readTursoConfig();
  return turso ? openLibsqlDb(turso, opts) : openLocalDb(opts);
}

export async function openLocalDb(opts: { readonly?: boolean; path?: string } = {}): Promise<Db | null> {
  const file = opts.path ?? DB_PATH;
  const { default: Database } = await import("better-sqlite3");
  let db: BetterSqlite3.Database;
  if (opts.readonly) {
    if (!fs.existsSync(file)) return null;
    db = new Database(file, { readonly: true, fileMustExist: true });
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new Database(file);
    db.pragma("journal_mode = WAL");
    db.exec(SCHEMA);
  }
  return {
    kind: "local",
    label: file,
    all: async <T>(sql: string, args: SqlValue[] = []) => db.prepare(sql).all(...args) as T[],
    get: async <T>(sql: string, args: SqlValue[] = []) => db.prepare(sql).get(...args) as T | undefined,
    run: async (sql, args = []) => {
      db.prepare(sql).run(...args);
    },
    batch: async (statements) => {
      const prepared = statements.map((s) => ({ stmt: db.prepare(s.sql), args: s.args ?? [] }));
      db.transaction(() => {
        for (const p of prepared) p.stmt.run(...p.args);
      })();
    },
    close: () => db.close(),
  };
}

export async function openLibsqlDb(config: TursoConfig, opts: { readonly?: boolean } = {}): Promise<Db> {
  const { createClient } = await import("@libsql/client");
  const client: Client = createClient({ url: config.url, authToken: config.authToken });
  try {
    if (!opts.readonly) await client.executeMultiple(SCHEMA);
  } catch (e) {
    client.close();
    throw e;
  }
  const toObjects = <T>(rs: { columns: string[]; rows: ArrayLike<unknown>[] }): T[] =>
    rs.rows.map((row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]])) as T);
  return {
    kind: "libsql",
    label: `libSQL ${redactUrl(config.url)}`,
    all: async <T>(sql: string, args: SqlValue[] = []) => toObjects<T>(await client.execute({ sql, args })),
    get: async <T>(sql: string, args: SqlValue[] = []) => toObjects<T>(await client.execute({ sql, args }))[0],
    run: async (sql, args = []) => {
      await client.execute({ sql, args });
    },
    batch: async (statements) => {
      await client.batch(
        statements.map((s) => ({ sql: s.sql, args: s.args ?? [] })),
        "write",
      );
    },
    close: () => client.close(),
  };
}

/** URL のクエリ（authToken などを含み得る）と認証情報を落としてホストまでを表示する */
function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return "(invalid url)";
  }
}
