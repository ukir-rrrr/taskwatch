"use client";

import { Button, Drawer } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useMemo, useState } from "react";
import { prNumber, repoFromPrUrl } from "@/lib/activity";
import { classify, isActive, statusLabel, type StatusGroup } from "@/lib/devin-status";
import { fmtAcu, fmtDateTime, fmtDuration } from "@/lib/format";
import type { SessionRow } from "@/lib/types";
import s from "./ui.module.css";

interface Props {
  sessions: SessionRow[];
  now: number;
  header: React.ReactNode;
}

type Item = SessionRow & { group: StatusGroup; label: string; elapsed: number; waited: number };

const PR_STATE: Record<string, string> = { open: "オープン", merged: "マージ済み", closed: "クローズ" };

export function SessionsView({ sessions, now, header }: Props) {
  const items = useMemo<Item[]>(
    () =>
      sessions.map((x) => ({
        ...x,
        group: classify(x.status, x.status_detail),
        label: statusLabel(x.status, x.status_detail),
        elapsed: (isActive(x.status, x.status_detail) ? now : x.updated_at) - x.created_at,
        waited: now - x.updated_at,
      })),
    [sessions, now],
  );
  const by = (g: StatusGroup) => items.filter((x) => x.group === g);
  const attention = by("attention");
  const running = by("running").sort((a, b) => b.created_at - a.created_at);
  const failed = by("failed");
  const done = by("done");

  const isMobile = useMediaQuery("(max-width: 767px)");
  const [selectedId, setSelectedId] = useState<string | null>(attention[0]?.session_id ?? items[0]?.session_id ?? null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const selected = items.find((x) => x.session_id === selectedId) ?? null;

  const select = (id: string) => {
    setSelectedId(id);
    if (isMobile) setDrawerOpen(true);
  };

  return (
    <div className={s.page}>
      <div className={s.mainCol}>
        {header}
        <QuotaBand items={items} />
        <div className={s.scroll}>
          {items.length === 0 ? (
            <>
              <div className={s.groupHead}><span><b>セッション</b></span></div>
              <p className={s.empty}>
                まだデータがありません。<code>npm run collect</code> を実行すると、ここにセッションが表示されます。
              </p>
            </>
          ) : (
            <>
              <GroupHead title="要確認" count={attention.length} note="あなたの判断待ち" />
              <div className={s.reviews}>
                {attention.length === 0 && <p className={s.empty} style={{ margin: 0 }}>判断待ちのセッションはありません。</p>}
                {attention.map((x) => (
                  <ReviewCard key={x.session_id} item={x} selected={!isMobile && x.session_id === selectedId} onSelect={select} />
                ))}
              </div>

              <GroupHead title="実行中" count={running.length} style={{ paddingTop: 28 }} />
              <ListHead />
              <Rows items={running} selectedId={isMobile ? null : selectedId} onSelect={select} empty="実行中のセッションはありません。" />

              <GroupHead title="失敗・異常終了" count={failed.length} note="再実行するか確認" />
              <Rows items={failed} selectedId={isMobile ? null : selectedId} onSelect={select} empty="失敗したセッションはありません。" />

              <GroupHead title="完了・停止" count={done.length} note="新しい順" />
              <Rows items={done} selectedId={isMobile ? null : selectedId} onSelect={select} empty="完了したセッションはありません。" />
            </>
          )}
        </div>
      </div>

      <aside className={s.panel} aria-label="選択中のセッション">
        {selected ? <Detail item={selected} /> : <p className={s.pSec + " " + s.muted}>セッションを選ぶと詳細が表示されます。</p>}
      </aside>

      <Drawer
        opened={drawerOpen && !!isMobile}
        onClose={() => setDrawerOpen(false)}
        position="bottom"
        size="78%"
        padding={0}
        withCloseButton
        title={<span className={s.muted}>セッションの詳細</span>}
        styles={{ header: { borderBottom: "1px solid var(--rule)", minHeight: 0, padding: "10px 16px" } }}
      >
        {selected && <Detail item={selected} />}
      </Drawer>
    </div>
  );
}

function GroupHead({ title, count, note, style }: { title: string; count: number; note?: string; style?: React.CSSProperties }) {
  return (
    <div className={s.groupHead} style={style}>
      <span>
        <b>{title}</b>
        <span className={s.num}>{count}</span>
      </span>
      {note && <span>{note}</span>}
    </div>
  );
}

function ListHead() {
  return (
    <div className={`${s.listHead} ${s.cols}`} aria-hidden="true">
      <span />
      <span>タスク／いまの作業</span>
      <span className={s.hState}>状態</span>
      <span>ACU</span>
      <span>経過</span>
    </div>
  );
}

function QuotaBand({ items }: { items: Item[] }) {
  const total = items.reduce((sum, x) => sum + x.acus_consumed, 0);
  const latest = [...items].sort((a, b) => b.created_at - a.created_at)[0];
  const segments = [...items].filter((x) => x.acus_consumed > 0).sort((a, b) => b.acus_consumed - a.acus_consumed);

  return (
    <section className={s.quota} aria-label="エージェント別の消費量">
      <div className={s.q}>
        <span className={s.qName}>Devin</span>
        <div className={s.qBar} role="img" aria-label={`セッション別の消費ACUの内訳（合計 ${fmtAcu(total)} ACU）`}>
          {total > 0 &&
            segments.map((x) => (
              <i
                key={x.session_id}
                className={x.session_id === latest?.session_id ? s.latest : undefined}
                style={{ width: `calc(${(x.acus_consumed / total) * 100}% - 1px)` }}
              />
            ))}
        </div>
        <span className={`${s.qVal} ${s.num}`}>
          {fmtAcu(total)}
          <small>ACU 消費</small>
        </span>
        <span className={s.qNote}>
          {latest ? (
            <>
              取得した{items.length}件の合計。直近「{latest.title}」<span className={s.num}>{fmtAcu(latest.acus_consumed)}</span> ACU
            </>
          ) : (
            "まだ収集されていません"
          )}
        </span>
      </div>
      <div className={s.q}>
        <span className={s.qName}>Claude Code</span>
        <div className={`${s.qBar} ${s.est}`} aria-hidden="true" />
        <span className={`${s.qVal} ${s.num}`}>
          —<small>未連携</small>
        </span>
        <span className={s.qNote}>
          <span className={s.qTag}>次の段階</span>利用枠の推定は連携後に表示します
        </span>
      </div>
    </section>
  );
}

function ReviewCard({ item, selected, onSelect }: { item: Item; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <article
      className={s.ask}
      aria-selected={selected}
      onClick={() => onSelect(item.session_id)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && onSelect(item.session_id)}
      tabIndex={0}
    >
      <div>
        <div className={s.askTop}>
          <span className={s.badge}>要確認</span>
          <span className={s.askName}>{item.title}</span>
        </div>
        <div className={s.meta}>
          Devin<span className={s.sep} aria-hidden="true" />
          {item.label}
          <span className={s.sep} aria-hidden="true" />
          <span className={s.num}>{fmtDuration(item.elapsed)}</span>
          <span className={s.sep} aria-hidden="true" />
          <span className={s.num}>{fmtAcu(item.acus_consumed)} ACU</span>
        </div>
        <p className={s.askQ}>{item.current_activity}</p>
      </div>
      <div className={s.askActions}>
        <span className={`${s.wait} ${s.num}`}>最終更新 {fmtDuration(item.waited)}前</span>
        <Button
          component="a"
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          fullWidth
        >
          Devinで開く
        </Button>
      </div>
    </article>
  );
}

function Rows({ items, selectedId, onSelect, empty }: { items: Item[]; selectedId: string | null; onSelect: (id: string) => void; empty: string }) {
  if (items.length === 0) return <p className={s.empty}>{empty}</p>;
  return (
    <>
      {items.map((x) => (
        <button
          key={x.session_id}
          type="button"
          className={`${s.row} ${s.cols} ${x.group === "failed" ? s.isFailed : ""} ${x.group === "done" ? s.isDone : ""}`}
          aria-selected={x.session_id === selectedId}
          onClick={() => onSelect(x.session_id)}
        >
          <span className={`${s.dot} ${s[x.group]}`} aria-hidden="true" />
          <span className={s.rMain}>
            <span className={s.rTitle}>
              {x.group === "failed" && <span className={`${s.badge} ${s.line}`}>{x.label}</span>}
              <span>{x.title}</span>
            </span>
            <span className={s.rNow} style={{ display: "block" }}>{x.current_activity}</span>
          </span>
          <span className={s.rState}>{x.label}</span>
          <span className={`${s.rAcu} ${s.num}`}>
            {fmtAcu(x.acus_consumed)}
            <small>ACU</small>
          </span>
          <span className={`${s.rMin} ${s.num}`}>{fmtDuration(x.elapsed)}</span>
        </button>
      ))}
    </>
  );
}

function Detail({ item }: { item: Item }) {
  return (
    <>
      <div className={s.pHead}>
        <div className={s.pState}>
          <span className={`${s.dot} ${s[item.group]}`} aria-hidden="true" />
          {item.label}
        </div>
        <h2>{item.title}</h2>
        <div className={s.meta}>
          Devin<span className={s.sep} aria-hidden="true" />
          <span className={s.num}>{item.session_id}</span>
        </div>
      </div>
      <div className={s.pBody}>
        <section className={s.pSec}>
          <h3>いまの作業</h3>
          <p>{item.current_activity}</p>
          <Button component="a" href={item.url} target="_blank" rel="noopener noreferrer" fullWidth>
            Devinで開く
          </Button>
        </section>
        <section className={s.pSec}>
          <h3>詳細</h3>
          <dl className={`${s.facts} ${s.num}`}>
            <dt>状態</dt>
            <dd>
              <code>{item.status}</code>
              {item.status_detail && (
                <>
                  {" / "}
                  <code>{item.status_detail}</code>
                </>
              )}
            </dd>
            <dt>消費ACU</dt>
            <dd>{fmtAcu(item.acus_consumed)} ACU</dd>
            <dt>経過</dt>
            <dd>{fmtDuration(item.elapsed)}</dd>
            <dt>開始</dt>
            <dd>{fmtDateTime(item.created_at)}</dd>
            <dt>最終更新</dt>
            <dd>{fmtDateTime(item.updated_at)}</dd>
            <dt>初回検出</dt>
            <dd>{fmtDateTime(item.first_seen_at)}</dd>
          </dl>
        </section>
        <section className={s.pSec}>
          <h3>プルリクエスト</h3>
          {item.pr_urls.length === 0 ? (
            <p className={s.muted} style={{ margin: 0 }}>まだありません</p>
          ) : (
            <ul className={s.prList}>
              {item.pr_urls.map((url, i) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {repoFromPrUrl(url) ?? url} #{prNumber(url)}
                  </a>
                  <span>{PR_STATE[item.pr_states[i] ?? ""] ?? item.pr_states[i] ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
