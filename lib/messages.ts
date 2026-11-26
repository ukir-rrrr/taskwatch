/**
 * セッションの「Devin 本人発の最新メッセージ」を収集する。
 * messages API は時系列（古い順）のカーソル式なので、セッションごとに続きのカーソルを保存し、
 * 次回はそこから先（＝新しい分）だけを取得する。全履歴を毎回取り直すことはしない。
 */
import type { Db, Statement } from "./db";
import { DevinApiError } from "./devin-api";
import { isActive } from "./devin-status";
import type { DevinMessageItem, DevinMessagesPage } from "./types";

export const PREVIEW_LENGTH = 300;
/** 1回の収集で messages API を呼ぶ上限（全セッション合計） */
export const DEFAULT_REQUEST_BUDGET = 30;
/** 1回の収集で1セッションに使うページ数の上限（長いセッションは次回以降に続きを取る） */
export const MAX_PAGES_PER_SESSION = 5;

export interface MessageState {
  session_id: string;
  latest_message: string | null;
  latest_message_at: number | null;
  latest_event_id: string | null;
  /** 次回の取得で after に渡すカーソル（null = 先頭から） */
  cursor: string | null;
  /** 最後のページまで読み終えた時点のセッションの updated_at（null = 読み途中） */
  synced_updated_at: number | null;
}

export interface SessionLike {
  session_id: string;
  status: string;
  status_detail: string | null;
  updated_at: number;
}

export type FetchPage = (sessionId: string, after: string | null) => Promise<DevinMessagesPage | null>;

/** Devin の本文に埋め込まれる UI 用の印（添付やボタン）を落とし、先頭 n 文字に切り詰める */
export function toPreview(text: string, n = PREVIEW_LENGTH): string {
  const cleaned = text
    .replace(/\[OFFER_TEST_APP\][\s\S]*?\[\/OFFER_TEST_APP\]/g, "")
    .split("\n")
    .filter((line) => !/^ATTACHMENT:\s*\{/.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const chars = Array.from(cleaned);
  return chars.length > n ? `${chars.slice(0, n - 1).join("").trimEnd()}…` : cleaned;
}

/** ページ内で Devin 本人発（source === "devin"）の最新メッセージ。ユーザー発は無視する */
export function latestDevinMessage(items: DevinMessageItem[]): DevinMessageItem | null {
  let latest: DevinMessageItem | null = null;
  for (const it of items) {
    if (it.source !== "devin" || !toPreview(it.message)) continue;
    if (!latest || it.created_at >= latest.created_at) latest = it;
  }
  return latest;
}

/**
 * 今回 messages を取りに行くか。
 * - 未取得・読み途中: 取る
 * - 実行中／返信待ち: 毎回取る（カーソル以降の新しい分だけなので通常1回）
 * - 終了・停止: 最後まで読んだ後に updated_at が変わっていなければ取らない（最終メッセージは確定済み）
 */
export function needsFetch(s: SessionLike, prev: MessageState | undefined): boolean {
  if (!prev || prev.synced_updated_at == null) return true;
  if (isActive(s.status, s.status_detail)) return true;
  return prev.synced_updated_at !== s.updated_at;
}

const UPSERT = `
  INSERT INTO session_messages (session_id, latest_message, latest_message_at, latest_event_id, cursor, synced_updated_at, checked_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (session_id) DO UPDATE SET
    latest_message = excluded.latest_message, latest_message_at = excluded.latest_message_at,
    latest_event_id = excluded.latest_event_id, cursor = excluded.cursor,
    synced_updated_at = excluded.synced_updated_at, checked_at = excluded.checked_at
`;

export function upsertMessageState(m: MessageState, now: number): Statement {
  return {
    sql: UPSERT,
    args: [m.session_id, m.latest_message, m.latest_message_at, m.latest_event_id, m.cursor, m.synced_updated_at, now],
  };
}

export interface SyncResult {
  statements: Statement[];
  requests: number;
  sessions: number;
  /** 予算切れ・レート制限で今回取りに行けなかったセッション数 */
  deferred: number;
  errors: string[];
}

export async function syncLatestMessages(
  db: Db,
  sessions: SessionLike[],
  fetchPage: FetchPage,
  opts: { now: number; budget?: number; maxPagesPerSession?: number },
): Promise<SyncResult> {
  const budget = opts.budget ?? DEFAULT_REQUEST_BUDGET;
  const maxPages = opts.maxPagesPerSession ?? MAX_PAGES_PER_SESSION;
  const prevRows = await db.all<MessageState>(
    "SELECT session_id, latest_message, latest_message_at, latest_event_id, cursor, synced_updated_at FROM session_messages",
  );
  const prev = new Map(prevRows.map((r) => [r.session_id, r]));

  // 動いているセッションを先に、その中では新しい順
  const targets = sessions
    .filter((s) => needsFetch(s, prev.get(s.session_id)))
    .sort(
      (a, b) =>
        Number(isActive(b.status, b.status_detail)) - Number(isActive(a.status, a.status_detail)) ||
        b.updated_at - a.updated_at,
    );

  const result: SyncResult = { statements: [], requests: 0, sessions: 0, deferred: 0, errors: [] };
  let stopped = false;
  for (const s of targets) {
    if (stopped || result.requests >= budget) {
      result.deferred++;
      continue;
    }
    const before = prev.get(s.session_id);
    let cursor = before?.cursor ?? null;
    let latest: DevinMessageItem | null = null;
    let pages = 0;
    let caughtUp = false;
    let gone = false;
    try {
      while (pages < maxPages && result.requests < budget) {
        const page = await fetchPage(s.session_id, cursor);
        result.requests++;
        if (!page) {
          gone = true;
          break;
        }
        pages++;
        latest = latestDevinMessage(latest ? [latest, ...page.items] : page.items);
        if (page.has_next_page && page.end_cursor) {
          cursor = page.end_cursor;
          continue;
        }
        // 最終ページ。end_cursor が返らない場合は今回の after を残し、次回はこのページから読み直す
        if (page.end_cursor) cursor = page.end_cursor;
        caughtUp = true;
        break;
      }
    } catch (e) {
      result.errors.push(`${s.session_id}: ${(e as Error).message}`);
      if (e instanceof DevinApiError && e.status === 429) stopped = true;
    }
    if (gone || pages === 0) continue;
    result.sessions++;
    result.statements.push(
      upsertMessageState(
        {
          session_id: s.session_id,
          latest_message: latest ? toPreview(latest.message) : (before?.latest_message ?? null),
          latest_message_at: latest ? latest.created_at : (before?.latest_message_at ?? null),
          latest_event_id: latest ? latest.event_id : (before?.latest_event_id ?? null),
          cursor,
          synced_updated_at: caughtUp ? s.updated_at : null,
        },
        opts.now,
      ),
    );
  }
  return result;
}
