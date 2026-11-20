import Link from "next/link";
import { fmtDateTime } from "@/lib/format";
import type { Snapshot } from "@/lib/queries";
import { AutoRefresh } from "./AutoRefresh";
import { ReportsIcon, SessionsIcon } from "./icons";
import s from "./ui.module.css";

interface Props {
  active: "sessions" | "reports";
  snapshot: Snapshot;
  children: React.ReactNode;
}

export function AppFrame({ active, snapshot, children }: Props) {
  const attention = snapshot.sessions.filter((x) => x.needs_attention).length;
  const total = snapshot.sessions.length;
  const modeLabel =
    snapshot.mode === "dummy" ? "ダミーデータで表示中" : snapshot.mode === "devin" ? "Devin API から収集" : "未収集";

  return (
    <div className={s.app}>
      <AutoRefresh />
      <aside className={s.side} aria-label="ナビゲーション">
        <div className={s.brand}>
          <span className={s.brandMark} aria-hidden="true" />
          Taskwatch
        </div>
        <nav className={s.switch} aria-label="表示の切り替え">
          <Link href="/" className={s.switchItem} aria-current={active === "sessions" ? "page" : undefined}>
            <SessionsIcon />
            セッション
            {attention > 0 && <span className={`${s.cnt} ${s.num}`} aria-label={`要確認 ${attention}件`}>{attention}</span>}
          </Link>
          <Link href="/reports" className={s.switchItem} aria-current={active === "reports" ? "page" : undefined}>
            <ReportsIcon />
            レポート
          </Link>
        </nav>
        <div className={s.navGroup}>
          <div className={s.navHead}>
            <span>エージェント</span>
            <span>件数</span>
          </div>
          <div className={s.navItem}>
            <span>Devin</span>
            <span className={`${s.c} ${s.num}`}>
              {attention > 0 && <b aria-label={`要確認 ${attention}件`}>{attention}</b>}
              {total}
            </span>
          </div>
          <div className={s.navItem}>
            <span>Claude Code</span>
            <span className={s.c}>未連携</span>
          </div>
        </div>
        <div className={s.sideFoot}>
          <strong>{modeLabel}</strong>
          {snapshot.lastCollectedAt ? (
            <span className={s.num}>{fmtDateTime(snapshot.lastCollectedAt)} 収集</span>
          ) : (
            <span>npm run collect で収集</span>
          )}
        </div>
      </aside>

      <div className={s.content}>{children}</div>

      <nav className={s.tabbar} aria-label="画面の切り替え">
        <Link href="/" className={s.tab} aria-current={active === "sessions" ? "page" : undefined}>
          <SessionsIcon strokeWidth={1.5} />
          セッション
          {attention > 0 && <span className={`${s.cnt} ${s.num}`} aria-label={`要確認 ${attention}件`}>{attention}</span>}
        </Link>
        <Link href="/reports" className={s.tab} aria-current={active === "reports" ? "page" : undefined}>
          <ReportsIcon strokeWidth={1.5} />
          レポート
        </Link>
      </nav>
    </div>
  );
}

export function PageHeader({ title, lastCollectedAt }: { title: string; lastCollectedAt: number | null }) {
  return (
    <header className={s.topbar}>
      <h1>
        <span className={s.brandMark} aria-hidden="true" />
        {title}
      </h1>
      <span className={`${s.when} ${s.num}`}>
        {lastCollectedAt ? `${fmtDateTime(lastCollectedAt).split(" ").at(-1)} 更新` : "未収集"}
      </span>
    </header>
  );
}
