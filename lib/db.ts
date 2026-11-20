import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export const DB_PATH = path.resolve(process.env.TASKWATCH_DB_PATH ?? "data/taskwatch.db");

const SCHEMA = `
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
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(opts: { readonly?: boolean } = {}): Database.Database | null {
  if (opts.readonly) {
    if (!fs.existsSync(DB_PATH)) return null;
    return new Database(DB_PATH, { readonly: true, fileMustExist: true });
  }
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}
