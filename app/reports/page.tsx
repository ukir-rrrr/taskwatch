import { AppFrame, PageHeader } from "@/components/AppFrame";
import s from "@/components/ui.module.css";
import { loadSnapshot } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function ReportsPage() {
  const snapshot = loadSnapshot();
  return (
    <AppFrame active="reports" snapshot={snapshot}>
      <div className={`${s.page} ${s.single}`}>
        <div className={s.mainCol}>
          <PageHeader title="レポート" lastCollectedAt={snapshot.lastCollectedAt} />
          <div className={s.scroll}>
            <p className={s.lede}>エージェントが作成し、完了したプルリクエストの記録です。</p>
            <div className={s.reportEmpty}>
              <p>まだレポートがありません</p>
              <p>GitHub のプルリクエストと連携すると、完了したセッションの変更内容がここにまとまります。</p>
            </div>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}
