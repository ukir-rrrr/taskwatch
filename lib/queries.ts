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

/** 画面は常に SQLite から読む（Devin API は collect だけが叩く） */
export function loadSnapshot(): Snapshot {
  const db = openDb({ readonly: true });
  if (!db) return { sessions: [], lastCollectedAt: null, mode: null };
  try {
    const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
    if (!hasTable) return { sessions: [], lastCollectedAt: null, mode: null };
    const rows = db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all() as RawRow[];
    const meta = Object.fromEntries(
      (db.prepare("SELECT key, value FROM meta").all() as { key: string; value: string }[]).map((m) => [m.key, m.value]),
    );
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
