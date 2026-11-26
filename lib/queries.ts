import "server-only";
import { openDb } from "./db";
import type { SessionRow } from "./types";

export interface Snapshot {
  sessions: SessionRow[];
  lastCollectedAt: number | null;
  mode: "devin" | "dummy" | null;
}

interface RawRow extends Omit<SessionRow, "pr_urls" | "pr_states" | "needs_attention"> {
  pr_urls: string;
  pr_states: string;
  needs_attention: number;
}

/** 画面は常に DB（ローカル SQLite または Turso）から読む（Devin API は collect だけが叩く） */
export async function loadSnapshot(): Promise<Snapshot> {
  const db = await openDb({ readonly: true });
  if (!db) return { sessions: [], lastCollectedAt: null, mode: null };
  try {
    const hasTable = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'");
    if (!hasTable) return { sessions: [], lastCollectedAt: null, mode: null };
    const meta = Object.fromEntries(
      (await db.all<{ key: string; value: string }>("SELECT key, value FROM meta")).map((m) => [m.key, m.value]),
    );
    // session_messages は後から足したテーブルなので、収集ワーカーが新しい版で動くまでは無い場合がある
    const hasMessages = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='session_messages'");
    const select = hasMessages
      ? `SELECT s.*, m.latest_message, m.latest_message_at FROM sessions s
         LEFT JOIN session_messages m ON m.session_id = s.session_id`
      : "SELECT s.*, NULL AS latest_message, NULL AS latest_message_at FROM sessions s";
    // 直近の収集モードの行だけを出す（ダミーに戻しても実データと混ざらない）
    const rows = await db.all<RawRow>(`${select} WHERE s.source = ? ORDER BY s.updated_at DESC`, [meta.mode ?? "devin"]);
    return {
      sessions: rows.map((r) => ({
        ...r,
        pr_urls: JSON.parse(r.pr_urls),
        pr_states: JSON.parse(r.pr_states),
        needs_attention: r.needs_attention === 1,
      })),
      lastCollectedAt: meta.last_collected_at ? Number(meta.last_collected_at) : null,
      mode: (meta.mode as Snapshot["mode"]) ?? null,
    };
  } finally {
    db.close();
  }
}
