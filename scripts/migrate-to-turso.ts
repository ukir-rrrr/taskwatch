/**
 * ワンオフ移行: ローカル SQLite（TASKWATCH_DB_PATH、既定 data/taskwatch.db）の内容を Turso にコピーする。
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run migrate:turso
 * 接続先はプロセスの環境変数からのみ読む（.env ファイルは読まない）。
 * Turso 側は同じ DDL で初期化し、同じキーの行は上書きする（Turso にだけある行は残す）。
 * 全行を1つの書き込みトランザクションで反映するので、途中で失敗しても中途半端な状態にはならない。
 */
import { DB_PATH, openLibsqlDb, openLocalDb, readTursoConfig, type SqlValue, type Statement } from "../lib/db";

const SESSION_COLUMNS = [
  "session_id",
  "title",
  "status",
  "status_detail",
  "acus_consumed",
  "pr_urls",
  "pr_states",
  "url",
  "created_at",
  "updated_at",
  "first_seen_at",
  "needs_attention",
  "current_activity",
  "source",
] as const;

const REPORT_COLUMNS = [
  "pr_url",
  "session_id",
  "pr_title",
  "repo",
  "pr_state",
  "created_at",
  "summary",
  "code_picks",
  "status",
  "generated_at",
  "github_synced_at",
] as const;

async function main(): Promise<void> {
  const turso = readTursoConfig();
  if (!turso) throw new Error("TURSO_DATABASE_URL と TURSO_AUTH_TOKEN の両方を環境変数で指定してください");

  const local = await openLocalDb({ readonly: true });
  if (!local) throw new Error(`ローカル DB が見つかりません: ${DB_PATH}`);
  let sessions: Record<string, SqlValue>[];
  let meta: { key: string; value: string }[];
  let reports: Record<string, SqlValue>[] = [];
  try {
    sessions = await local.all<Record<string, SqlValue>>(`SELECT ${SESSION_COLUMNS.join(", ")} FROM sessions`);
    meta = await local.all<{ key: string; value: string }>("SELECT key, value FROM meta");
    // reports が無い古いローカル DB でも移行できるようにする
    if (await local.get("SELECT name FROM sqlite_master WHERE type='table' AND name='reports'")) {
      reports = await local.all<Record<string, SqlValue>>(`SELECT ${REPORT_COLUMNS.join(", ")} FROM reports`);
    }
  } finally {
    local.close();
  }

  const remote = await openLibsqlDb(turso);
  try {
    const insertSession = `INSERT OR REPLACE INTO sessions (${SESSION_COLUMNS.join(", ")}) VALUES (${SESSION_COLUMNS.map(() => "?").join(", ")})`;
    const insertReport = `INSERT INTO reports (${REPORT_COLUMNS.join(", ")}) VALUES (${REPORT_COLUMNS.map(() => "?").join(", ")})
      ON CONFLICT (pr_url) DO UPDATE SET ${REPORT_COLUMNS.filter((c) => c !== "pr_url").map((c) => `${c} = excluded.${c}`).join(", ")}`;
    const stmts: Statement[] = [
      ...sessions.map((row) => ({ sql: insertSession, args: SESSION_COLUMNS.map((c) => row[c] ?? null) })),
      ...meta.map((m) => ({ sql: "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", args: [m.key, m.value] })),
      // id は Turso 側で振り直し、pr_url（一意）で上書きする
      ...reports.map((row) => ({ sql: insertReport, args: REPORT_COLUMNS.map((c) => row[c] ?? null) })),
    ];
    await remote.batch(stmts);
    const count = await remote.get<{ n: number }>("SELECT COUNT(*) AS n FROM sessions");
    console.log(
      `[migrate] ${DB_PATH} → ${remote.label}: sessions ${sessions.length}件 / meta ${meta.length}件 / reports ${reports.length}件をコピー（Turso 側 sessions 合計 ${count?.n ?? "?"}件）`,
    );
  } finally {
    remote.close();
  }
}

main().catch((e) => {
  console.error(`[migrate] 失敗: ${(e as Error).message}`);
  process.exit(1);
});
