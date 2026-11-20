import { classify } from "./devin-status";

export interface ActivityInput {
  title: string | null;
  status: string;
  status_detail: string | null;
  pull_requests: { pr_url: string; pr_state: string | null }[];
  /** セッションの直近メッセージなど。渡されたときはこちらを優先する */
  latest_message?: string | null;
}

/**
 * 「いま何をしているか」の一言を作る。
 * MVP では状態と PR から機械的に組み立てる。将来は LLM 要約に差し替える前提で、
 * 呼び出し側（collect）はこの関数の戻り値をそのまま current_activity に保存するだけにしている。
 */
export function buildCurrentActivity(s: ActivityInput): string {
  if (s.latest_message?.trim()) return truncate(s.latest_message.trim(), 80);

  const pr = s.pull_requests.at(-1);
  const prNo = pr ? prNumber(pr.pr_url) : null;
  const prText = prNo ? `プルリクエスト #${prNo}` : "プルリクエスト";
  const d = s.status_detail;

  switch (classify(s.status, d)) {
    case "attention":
      if (d === "waiting_for_user") return "あなたの返信を待っています";
      if (d === "waiting_for_approval") return "操作の承認を待っています";
      return "利用上限などで停止中。Devin側での対応が必要です";
    case "running":
      if (s.status === "new" || s.status === "claimed") return "セッションを起動しています";
      if (s.status === "resuming") return "セッションを再開しています";
      return pr ? `${prText} を作成済み。作業を続けています` : "作業中";
    case "failed":
      return s.status === "suspended" ? "異常終了しました。ログを確認してください" : "エラーで停止しました";
    case "done":
      if (d === "inactivity") return "応答がないため一時停止しました";
      if (d === "user_request") return "手動で停止しました";
      if (!pr) return "プルリクエストなしで完了";
      if (pr.pr_state === "merged") return `${prText} はマージ済み`;
      if (pr.pr_state === "closed") return `${prText} はクローズ済み`;
      return `${prText} を作成して完了`;
  }
}

export function prNumber(url: string): string | null {
  return url.match(/\/pull\/(\d+)/)?.[1] ?? null;
}

export function repoFromPrUrl(url: string): string | null {
  return url.match(/github\.com\/([^/]+\/[^/]+)\/pull\//)?.[1] ?? null;
}

function truncate(s: string, n: number): string {
  const line = s.split("\n")[0];
  return line.length > n ? `${line.slice(0, n - 1)}…` : line;
}
