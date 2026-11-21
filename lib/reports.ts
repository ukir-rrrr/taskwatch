import { repoFromPrUrl } from "./activity";
import type { Db, Statement } from "./db";
import { DUMMY_REPORTS } from "./dummy-data";
import { fetchPrMeta, type PrMeta } from "./github";
import type { DevinSessionItem } from "./types";

const INSERT_REPORT = `
  INSERT INTO reports (pr_url, session_id, pr_title, repo, pr_state, created_at, summary, code_picks, status, generated_at,
    github_synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (pr_url) DO UPDATE SET pr_state = excluded.pr_state
`;
const UPDATE_PR_META = `
  UPDATE reports SET pr_title = ?, created_at = ?, github_synced_at = ? WHERE pr_url = ? AND status = 'pending'
`;

export interface ReportSync {
  statements: Statement[];
  /** GitHub から取得できた件数 / 試した件数 */
  fetched: number;
  attempted: number;
}

/**
 * PR が作成（オープン）された時点でレポート行を用意する。マージ判断の前に読めるようにするため。
 * - まだ無いオープン PR は pending で INSERT し、既にある行は（オープン以外になっても）pr_state を最新にする
 * - PR のタイトルと作成日時は GitHub API から取る。取れなければセッションのタイトルと検出時刻で登録し、
 *   pending の間は収集のたびに取り直す（取れた行は github_synced_at を入れて以後は取り直さない）
 * - ダミーモードでは GitHub API を呼ばない
 */
export async function syncReports(
  db: Db,
  items: DevinSessionItem[],
  now: number,
  mode: "devin" | "dummy",
  fetchMeta: typeof fetchPrMeta = fetchPrMeta,
): Promise<ReportSync> {
  const open = new Map<string, DevinSessionItem>();
  const statements: Statement[] = [];
  for (const it of items) {
    for (const pr of it.pull_requests) {
      const state = pr.pr_state?.toLowerCase() ?? null;
      if (state === "open") {
        if (!open.has(pr.pr_url)) open.set(pr.pr_url, it);
      } else if (state) {
        statements.push({ sql: "UPDATE reports SET pr_state = ? WHERE pr_url = ?", args: [state, pr.pr_url] });
      }
    }
  }

  const metas = new Map<string, PrMeta>();
  let attempted = 0;
  if (mode === "devin") {
    const known = new Set(
      (await db.all<{ pr_url: string }>("SELECT pr_url FROM reports WHERE github_synced_at IS NOT NULL OR status <> 'pending'")).map(
        (r) => r.pr_url,
      ),
    );
    const unsynced = (
      await db.all<{ pr_url: string }>("SELECT pr_url FROM reports WHERE status = 'pending' AND github_synced_at IS NULL")
    ).map((r) => r.pr_url);
    const targets = [...new Set([...[...open.keys()].filter((u) => !known.has(u)), ...unsynced])];
    for (const url of targets) {
      attempted++;
      const r = await fetchMeta(url);
      if (r.ok) {
        metas.set(url, r.meta);
        continue;
      }
      console.warn(`[collect] GitHub から PR 情報を取得できませんでした（${r.reason}）: ${url}`);
      if (r.rateLimited) {
        console.warn("[collect] GitHub API のレート制限に達したため、残りは次回の収集で取得します");
        break;
      }
    }
  }

  for (const [url, it] of open) {
    const sample = mode === "dummy" ? DUMMY_REPORTS[url] : undefined;
    const meta = metas.get(url);
    statements.push({
      sql: INSERT_REPORT,
      args: [
        url,
        it.session_id,
        meta?.title ?? (it.title?.trim() || "（無題のプルリクエスト）"),
        repoFromPrUrl(url) ?? "",
        "open",
        meta?.created_at ?? now,
        sample?.summary ?? null,
        sample?.code_picks ?? null,
        sample ? "generated" : "pending",
        sample ? now : null,
        meta ? now : null,
      ],
    });
  }
  // 既存の pending 行（INSERT が衝突した行を含む）を GitHub の値で直す
  for (const [url, meta] of metas) {
    statements.push({ sql: UPDATE_PR_META, args: [meta.title, meta.created_at, now, url] });
  }
  return { statements, fetched: metas.size, attempted };
}
