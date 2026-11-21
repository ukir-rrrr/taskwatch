/**
 * 収集ワーカー: Devin API からセッション一覧を取得して DB（ローカル SQLite または Turso）に保存する。
 *   npm run collect             1回だけ収集
 *   npm run collect -- --watch 60   60秒ごとに収集し続ける
 * DEVIN_API_KEY / DEVIN_ORG_ID はプロセスの環境変数からのみ読む（.env ファイルは読まない）。
 * 未設定ならダミーデータを保存する。
 * TURSO_DATABASE_URL と TURSO_AUTH_TOKEN が両方あれば Turso（libSQL）に書き込む。
 * オープン状態の PR は reports に status=pending で登録する（pr_url で冪等。既存行は pr_state だけ更新）。
 */
import { buildCurrentActivity, repoFromPrUrl } from "../lib/activity";
import { openDb, type Db, type Statement } from "../lib/db";
import { fetchSession, fetchSessions, readCredentials, sessionUrl, type DevinCredentials } from "../lib/devin-api";
import { needsAttention } from "../lib/devin-status";
import { DUMMY_REPORTS, DUMMY_SESSION_PREFIX, dummySessions, type DummyItem } from "../lib/dummy-data";
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
    { sql: "DELETE FROM sessions WHERE source = 'dummy'" },
    ...gone.map((id) => ({ sql: "DELETE FROM sessions WHERE session_id = ?", args: [id] })),
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
    // 実データ収集に切り替えたらダミーのレポートも消す
    ...(cred ? [{ sql: "DELETE FROM reports WHERE session_id LIKE ?", args: [`${DUMMY_SESSION_PREFIX}%`] }] : []),
    ...reportStatements(items, now, mode),
    { sql: SET_META, args: ["last_collected_at", String(now)] },
    { sql: SET_META, args: ["mode", mode] },
    ...(cred ? [{ sql: SET_META, args: ["org_id", cred.orgId] }] : []),
  ];
  await db.batch(stmts);
  db.close();

  const label = mode === "dummy" ? "ダミーモード（DEVIN_API_KEY / DEVIN_ORG_ID 未設定）" : "Devin API";
  console.log(`[collect] ${new Date().toLocaleString("ja-JP")} ${label}: ${items.length}件を保存 → ${db.label}`);
}

const INSERT_REPORT = `
  INSERT INTO reports (pr_url, session_id, pr_title, repo, pr_state, created_at, summary, code_picks, status, generated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (pr_url) DO UPDATE SET pr_state = excluded.pr_state
`;

/**
 * PR が作成（オープン）された時点でレポート行を用意する。マージ判断の前に読めるようにするため。
 * まだ無いオープン PR は pending で INSERT し、既にある行は（オープン以外になっても）pr_state を最新にする。
 */
function reportStatements(items: DevinSessionItem[], now: number, mode: "devin" | "dummy"): Statement[] {
  const stmts: Statement[] = [];
  for (const it of items) {
    for (const pr of it.pull_requests) {
      const state = pr.pr_state?.toLowerCase() ?? null;
      if (state !== "open") {
        if (state) stmts.push({ sql: "UPDATE reports SET pr_state = ? WHERE pr_url = ?", args: [state, pr.pr_url] });
        continue;
      }
      const sample = mode === "dummy" ? DUMMY_REPORTS[pr.pr_url] : undefined;
      stmts.push({
        sql: INSERT_REPORT,
        args: [
          pr.pr_url,
          it.session_id,
          it.title?.trim() || "（無題のプルリクエスト）",
          repoFromPrUrl(pr.pr_url) ?? "",
          state,
          now,
          sample?.summary ?? null,
          sample?.code_picks ?? null,
          sample ? "generated" : "pending",
          sample ? now : null,
        ],
      });
    }
  }
  return stmts;
}

/** 最新50件から外れた「進行中・要確認」のセッションを個別取得し、古い状態のまま残らないようにする */
async function refreshDropped(
  db: Db,
  cred: DevinCredentials,
  fetched: DevinSessionItem[],
): Promise<{ items: DevinSessionItem[]; gone: string[] }> {
  const seen = new Set(fetched.map((it) => it.session_id));
  const stale = (
    await db.all<{ session_id: string }>(
      "SELECT session_id FROM sessions WHERE source = 'devin' AND (needs_attention = 1 OR status IN ('new', 'claimed', 'running', 'resuming'))",
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
