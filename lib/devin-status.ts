/**
 * Devin セッションの状態分類。status / status_detail の解釈はこのファイルだけで行う。
 *
 * status:        new | claimed | running | exit | error | suspended | resuming
 * status_detail: running のとき  working | waiting_for_user | waiting_for_approval | finished
 *                suspended のとき inactivity | user_request | *_limit_exceeded | out_of_* | ... | error
 */

export type StatusGroup = "attention" | "running" | "failed" | "done";

export const GROUP_LABEL: Record<StatusGroup, string> = {
  attention: "要確認",
  running: "実行中",
  failed: "失敗・異常終了",
  done: "完了・停止",
};

export const GROUP_ORDER: StatusGroup[] = ["attention", "running", "failed", "done"];

/** 課金・上限などでブロックされ、ユーザーの対応が必要な停止理由 */
const BLOCKED_DETAILS = new Set([
  "usage_limit_exceeded",
  "out_of_credits",
  "out_of_quota",
  "no_quota_allocation",
  "payment_declined",
  "org_usage_limit_exceeded",
  "user_usage_limit_exceeded",
  "total_session_limit_exceeded",
  "contract_expired",
]);

const DETAIL_LABEL: Record<string, string> = {
  working: "作業中",
  waiting_for_user: "返信待ち",
  waiting_for_approval: "承認待ち",
  finished: "完了",
  inactivity: "無操作で停止",
  user_request: "手動で停止",
  usage_limit_exceeded: "利用上限",
  out_of_credits: "クレジット不足",
  out_of_quota: "割り当て超過",
  no_quota_allocation: "割り当てなし",
  payment_declined: "支払いエラー",
  org_usage_limit_exceeded: "組織の上限",
  user_usage_limit_exceeded: "ユーザーの上限",
  total_session_limit_exceeded: "セッション数の上限",
  contract_expired: "契約期限切れ",
  error: "異常終了",
};

const STATUS_LABEL: Record<string, string> = {
  new: "起動待ち",
  claimed: "起動中",
  running: "実行中",
  resuming: "再開中",
  exit: "完了",
  error: "失敗",
  suspended: "停止",
};

export function classify(status: string, statusDetail: string | null): StatusGroup {
  const d = statusDetail ?? "";
  switch (status) {
    case "new":
    case "claimed":
    case "resuming":
      return "running";
    case "running":
      if (d === "waiting_for_user" || d === "waiting_for_approval") return "attention";
      if (d === "finished") return "done";
      return "running";
    case "exit":
      return "done";
    case "error":
      return "failed";
    case "suspended":
      if (d === "error") return "failed";
      if (BLOCKED_DETAILS.has(d)) return "attention";
      return "done";
    default:
      return "running";
  }
}

export function needsAttention(status: string, statusDetail: string | null): boolean {
  return classify(status, statusDetail) === "attention";
}

/** 一覧に出す短い状態名（例: 「返信待ち」「失敗」「無操作で停止」） */
export function statusLabel(status: string, statusDetail: string | null): string {
  if (status === "error") return "失敗";
  if (status === "running" || status === "suspended") {
    if (statusDetail && DETAIL_LABEL[statusDetail]) return DETAIL_LABEL[statusDetail];
  }
  return STATUS_LABEL[status] ?? status;
}

/** 経過時間を「いま」まで数えるか（＝まだ動いている／待っている） */
export function isActive(status: string, statusDetail: string | null): boolean {
  const g = classify(status, statusDetail);
  return g === "running" || (g === "attention" && status === "running");
}
