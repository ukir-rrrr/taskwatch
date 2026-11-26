/**
 * 収集ワーカー: Devin API からセッション一覧を取得して DB（ローカル SQLite または Turso）に保存する。
 *   npm run collect             1回だけ収集
 *   npm run collect -- --watch 60   60秒ごとに収集し続ける
 * DEVIN_API_KEY / DEVIN_ORG_ID はプロセスの環境変数からのみ読む（.env ファイルは読まない）。
 * 未設定ならダミーデータを保存する。
 * TURSO_DATABASE_URL と TURSO_AUTH_TOKEN が両方あれば Turso（libSQL）に書き込む。
 * 各セッションの messages は前回の続き（新しい分）だけを取得し、Devin 本人発の最新メッセージを保存する。
 * 終了・停止したセッションは最後まで読んだ後は取り直さない（lib/messages.ts）。
 */
import { buildCurrentActivity } from "../lib/activity";
import { openDb, type Db, type Statement } from "../lib/db";
import {
  fetchMessagesPage,
  fetchSession,
  fetchSessions,
  readCredentials,
  sessionUrl,
  type DevinCredentials,
} from "../lib/devin-api";
import { needsAttention } from "../lib/devin-status";
import { dummySessions, type DummyItem } from "../lib/dummy-data";
import { syncLatestMessages, toPreview, upsertMessageState, type SyncResult } from "../lib/messages";
import type { DevinSessionItem } from "../lib/types";

async function collectOnce(): Promise<void> {
  const cred = readCredentials();
  const mode = cred ? "devin" : "dummy";
  const items: (DevinSessionItem & Partial<Pick<DummyItem, "latest_message">>)[] = cred
    ? await fetchSessions(cred, 50)
    : dummySessions();

  const db = (await openDb())!;
  const gone: string[] = [];
  if (cred) {
    const prevOrg = (await db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'org_id'"))?.value;
    // 組織を切り替えた直後は、前の組織のセッションを新しい組織で探さない
    if (prevOrg === cred.orgId) {
      const r = await refreshDropped(db, cred, items);
      items.push(...r.items);
      gone.push(...r.gone);
    }
  }
  const now = Math.floor(Date.now() / 1000);
  const messages: SyncResult = cred
    ? await syncLatestMessages(db, items, (id, after) => fetchMessagesPage(cred, id, after), { now })
    : dummyMessages(items, now);
  for (const e of messages.errors) console.warn(`[collect] messages 取得失敗 ${e}`);
  const UPSERT = `
    INSERT INTO sessions (session_id, title, status, status_detail, acus_consumed, pr_urls, pr_states, url,
      created_at, updated_at, first_seen_at, needs_attention, current_activity, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (session_id) DO UPDATE SET
      title = excluded.title, status = excluded.status, status_detail = excluded.status_detail,
      acus_consumed = excluded.acus_consumed, pr_urls = excluded.pr_urls, pr_states = excluded.pr_states,
      url = excluded.url, created_at = excluded.created_at, updated_at = excluded.updated_at,
      needs_attention = excluded.needs_attention, current_activity = excluded.current_activity,
      source = excluded.source
  `;
  const SET_META = "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value";

  // 1つの書き込みトランザクションで反映する
  const stmts: Statement[] = [
    // ダミーは毎回作り直す。実データ収集に切り替えたらダミーは消す
    { sql: "DELETE FROM session_messages WHERE session_id IN (SELECT session_id FROM sessions WHERE source = 'dummy')" },
    { sql: "DELETE FROM sessions WHERE source = 'dummy'" },
    ...gone.flatMap((id) => [
      { sql: "DELETE FROM session_messages WHERE session_id = ?", args: [id] },
      { sql: "DELETE FROM sessions WHERE session_id = ?", args: [id] },
    ]),
    ...items.map((it) => ({
      sql: UPSERT,
      args: [
        it.session_id,
        it.title?.trim() || "（無題のセッション）",
        it.status,
        it.status_detail ?? null,
        it.acus_consumed ?? 0,
        JSON.stringify(it.pull_requests.map((p) => p.pr_url)),
        JSON.stringify(it.pull_requests.map((p) => p.pr_state)),
        sessionUrl(it),
        it.created_at,
        it.updated_at,
        now,
        needsAttention(it.status, it.status_detail ?? null) ? 1 : 0,
        buildCurrentActivity(it),
        mode,
      ],
    })),
    ...messages.statements,
    { sql: SET_META, args: ["last_collected_at", String(now)] },
    { sql: SET_META, args: ["mode", mode] },
    ...(cred ? [{ sql: SET_META, args: ["org_id", cred.orgId] }] : []),
  ];
  await db.batch(stmts);
  db.close();

  const label = mode === "dummy" ? "ダミーモード（DEVIN_API_KEY / DEVIN_ORG_ID 未設定）" : "Devin API";
  const msg = cred
    ? `（messages ${messages.sessions}件を更新・API ${messages.requests}回${messages.deferred ? `・${messages.deferred}件は次回` : ""}）`
    : "";
  console.log(`[collect] ${new Date().toLocaleString("ja-JP")} ${label}: ${items.length}件を保存${msg} → ${db.label}`);
}

/** ダミーモード: モックの文言を Devin の最新メッセージとして保存する */
function dummyMessages(items: (DevinSessionItem & Partial<Pick<DummyItem, "latest_message">>)[], now: number): SyncResult {
  const statements = items
    .filter((it) => it.latest_message)
    .map((it) =>
      upsertMessageState(
        {
          session_id: it.session_id,
          latest_message: toPreview(it.latest_message!),
          // ダミーにはメッセージ単位の時刻が無いので、セッションの最終更新時刻を代わりに使う
          latest_message_at: it.updated_at,
          latest_event_id: null,
          cursor: null,
          synced_updated_at: it.updated_at,
        },
        now,
      ),
    );
  return { statements, requests: 0, sessions: statements.length, deferred: 0, errors: [] };
}

/**
 * 最新50件から外れた「進行中・要確認」のセッションと、messages を今の updated_at まで読み切れていないセッションを
 * 個別取得し、古い状態（途中経過のメッセージを含む）のまま残らないようにする
 */
async function refreshDropped(
  db: Db,
  cred: DevinCredentials,
  fetched: DevinSessionItem[],
): Promise<{ items: DevinSessionItem[]; gone: string[] }> {
  const seen = new Set(fetched.map((it) => it.session_id));
  const stale = (
    await db.all<{ session_id: string }>(
      `SELECT s.session_id FROM sessions s LEFT JOIN session_messages m ON m.session_id = s.session_id
       WHERE s.source = 'devin' AND (s.needs_attention = 1 OR s.status IN ('new', 'claimed', 'running', 'resuming')
         OR (m.session_id IS NOT NULL AND (m.synced_updated_at IS NULL OR m.synced_updated_at != s.updated_at)))`,
    )
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
