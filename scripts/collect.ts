/**
 * 収集ワーカー: Devin API からセッション一覧を取得して SQLite に保存する。
 *   npm run collect             1回だけ収集
 *   npm run collect -- --watch 60   60秒ごとに収集し続ける
 * DEVIN_API_KEY / DEVIN_ORG_ID はプロセスの環境変数からのみ読む（.env ファイルは読まない）。
 * 未設定ならダミーデータを保存する。
 */
import type Database from "better-sqlite3";
import { buildCurrentActivity } from "../lib/activity";
import { DB_PATH, openDb } from "../lib/db";
import { fetchSession, fetchSessions, readCredentials, sessionUrl, type DevinCredentials } from "../lib/devin-api";
import { needsAttention } from "../lib/devin-status";
import { dummySessions, type DummyItem } from "../lib/dummy-data";
import type { DevinSessionItem } from "../lib/types";

async function collectOnce(): Promise<void> {
  const cred = readCredentials();
  const mode = cred ? "devin" : "dummy";
  const items: (DevinSessionItem & Partial<Pick<DummyItem, "latest_message">>)[] = cred
    ? await fetchSessions(cred, 50)
    : dummySessions();

  const db = openDb()!;
  const gone: string[] = [];
  if (cred) {
    const prevOrg = (db.prepare("SELECT value FROM meta WHERE key = 'org_id'").get() as { value: string } | undefined)?.value;
    // 組織を切り替えた直後は、前の組織のセッションを新しい組織で探さない
    if (prevOrg === cred.orgId) {
      const r = await refreshDropped(db, cred, items);
      items.push(...r.items);
      gone.push(...r.gone);
    }
  }
  const now = Math.floor(Date.now() / 1000);
  const upsert = db.prepare(`
    INSERT INTO sessions (session_id, title, status, status_detail, acus_consumed, pr_urls, pr_states, url,
      created_at, updated_at, first_seen_at, needs_attention, current_activity, source)
    VALUES (@session_id, @title, @status, @status_detail, @acus_consumed, @pr_urls, @pr_states, @url,
      @created_at, @updated_at, @first_seen_at, @needs_attention, @current_activity, @source)
    ON CONFLICT (session_id) DO UPDATE SET
      title = excluded.title, status = excluded.status, status_detail = excluded.status_detail,
      acus_consumed = excluded.acus_consumed, pr_urls = excluded.pr_urls, pr_states = excluded.pr_states,
      url = excluded.url, created_at = excluded.created_at, updated_at = excluded.updated_at,
      needs_attention = excluded.needs_attention, current_activity = excluded.current_activity,
      source = excluded.source
  `);
  const setMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");

  db.transaction(() => {
    // ダミーは毎回作り直す。実データ収集に切り替えたらダミーは消す
    db.prepare("DELETE FROM sessions WHERE source = 'dummy'").run();
    const del = db.prepare("DELETE FROM sessions WHERE session_id = ?");
    for (const id of gone) del.run(id);
    for (const it of items) {
      upsert.run({
        session_id: it.session_id,
        title: it.title?.trim() || "（無題のセッション）",
        status: it.status,
        status_detail: it.status_detail ?? null,
        acus_consumed: it.acus_consumed ?? 0,
        pr_urls: JSON.stringify(it.pull_requests.map((p) => p.pr_url)),
        pr_states: JSON.stringify(it.pull_requests.map((p) => p.pr_state)),
        url: sessionUrl(it),
        created_at: it.created_at,
        updated_at: it.updated_at,
        first_seen_at: now,
        needs_attention: needsAttention(it.status, it.status_detail ?? null) ? 1 : 0,
        current_activity: buildCurrentActivity(it),
        source: mode,
      });
    }
    setMeta.run("last_collected_at", String(now));
    setMeta.run("mode", mode);
    if (cred) setMeta.run("org_id", cred.orgId);
  })();
  db.close();

  const label = mode === "dummy" ? "ダミーモード（DEVIN_API_KEY / DEVIN_ORG_ID 未設定）" : "Devin API";
  console.log(`[collect] ${new Date().toLocaleString("ja-JP")} ${label}: ${items.length}件を保存 → ${DB_PATH}`);
}

/** 最新50件から外れた「進行中・要確認」のセッションを個別取得し、古い状態のまま残らないようにする */
async function refreshDropped(
  db: Database.Database,
  cred: DevinCredentials,
  fetched: DevinSessionItem[],
): Promise<{ items: DevinSessionItem[]; gone: string[] }> {
  const seen = new Set(fetched.map((it) => it.session_id));
  const stale = (
    db
      .prepare(
        "SELECT session_id FROM sessions WHERE source = 'devin' AND (needs_attention = 1 OR status IN ('new', 'claimed', 'running', 'resuming'))",
      )
      .all() as { session_id: string }[]
  ).filter((r) => !seen.has(r.session_id));
  const items: DevinSessionItem[] = [];
  const gone: string[] = [];
  for (const { session_id } of stale) {
    const it = await fetchSession(cred, session_id);
    if (it) items.push(it);
    else gone.push(session_id);
  }
  return { items, gone };
}

async function main(): Promise<void> {
  const i = process.argv.indexOf("--watch");
  const interval = i >= 0 ? Math.max(15, Number(process.argv[i + 1]) || 60) : 0;
  if (!interval) return collectOnce();
  for (;;) {
    await collectOnce().catch((e) => console.error(`[collect] 失敗: ${(e as Error).message}`));
    await new Promise((r) => setTimeout(r, interval * 1000));
  }
}

main().catch((e) => {
  console.error(`[collect] 失敗: ${(e as Error).message}`);
  process.exit(1);
});
