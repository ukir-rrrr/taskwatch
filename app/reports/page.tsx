import { AppFrame, PageHeader } from "@/components/AppFrame";
import { Markdown } from "@/components/Markdown";
import s from "@/components/ui.module.css";
import { prNumber } from "@/lib/activity";
import { fmtDateTime } from "@/lib/format";
import { loadReports, loadSnapshot } from "@/lib/queries";
import type { ReportRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const PR_STATE: Record<string, string> = { open: "オープン", merged: "マージ済み", closed: "クローズ" };

export default async function ReportsPage() {
  const snapshot = await loadSnapshot();
  const reports = await loadReports(snapshot.mode);
  return (
    <AppFrame active="reports" snapshot={snapshot}>
      <div className={`${s.page} ${s.single}`}>
        <div className={s.mainCol}>
          <PageHeader title="レポート" lastCollectedAt={snapshot.lastCollectedAt} />
          <div className={s.scroll}>
            <p className={s.lede}>エージェントが作成したプルリクエストの記録です。マージ前の確認にお使いください。</p>
            {reports.length === 0 ? (
              <div className={s.reportEmpty}>
                <p>まだレポートがありません</p>
                <p>GitHub のプルリクエストと連携すると、完了したセッションの変更内容がここにまとまります。</p>
              </div>
            ) : (
              <div className={s.reportList}>
                {reports.map((r) => (
                  <ReportCard key={r.pr_url} report={r} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

function ReportCard({ report: r }: { report: ReportRow }) {
  const pending = r.status !== "generated";
  const no = prNumber(r.pr_url);
  const sessionUrl = r.session_url || `https://app.devin.ai/sessions/${r.session_id.replace(/^devin-/, "")}`;
  return (
    <article className={`${s.report} ${pending ? s.isPending : ""}`} aria-busy={pending || undefined}>
      <header className={s.reportHead}>
        <div className={s.askTop}>
          {pending && <span className={`${s.badge} ${s.line}`}>生成中</span>}
          <h2 className={s.reportTitle}>{r.pr_title}</h2>
        </div>
        <div className={`${s.meta} ${s.num}`}>
          {r.repo || "—"}
          {no && ` #${no}`}
          <span className={s.sep} aria-hidden="true" />
          {PR_STATE[r.pr_state ?? ""] ?? r.pr_state ?? "—"}
          <span className={s.sep} aria-hidden="true" />
          {fmtDateTime(r.created_at)} 作成
        </div>
        <div className={s.reportLinks}>
          <a href={r.pr_url} target="_blank" rel="noopener noreferrer">
            プルリクエストを開く
          </a>
          <a href={sessionUrl} target="_blank" rel="noopener noreferrer">
            セッションを開く
          </a>
        </div>
      </header>
      {pending ? (
        <p className={s.reportPending}>レポートを生成中です。生成が終わると、変更の概要とコードの抜粋がここに表示されます。</p>
      ) : (
        <>
          <section className={s.reportSec}>
            <h3>概要</h3>
            {r.summary?.trim() ? <Markdown>{r.summary}</Markdown> : <p className={s.muted}>概要はありません</p>}
          </section>
          <section className={s.reportSec}>
            <h3>コードの抜粋</h3>
            {r.code_picks?.trim() ? <Markdown>{r.code_picks}</Markdown> : <p className={s.muted}>抜粋はありません</p>}
          </section>
        </>
      )}
    </article>
  );
}
