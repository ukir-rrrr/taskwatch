/** Devin API v3 `GET /organizations/{org_id}/sessions` の items[] のうち、Taskwatch が使う項目 */
export interface DevinSessionItem {
  session_id: string;
  title: string | null;
  status: string;
  status_detail: string | null;
  acus_consumed: number;
  pull_requests: { pr_url: string; pr_state: string | null }[];
  created_at: number;
  updated_at: number;
  url?: string;
}

export interface SessionRow {
  session_id: string;
  title: string;
  status: string;
  status_detail: string | null;
  acus_consumed: number;
  pr_urls: string[];
  pr_states: (string | null)[];
  url: string;
  created_at: number;
  updated_at: number;
  first_seen_at: number;
  needs_attention: boolean;
  current_activity: string;
  source: "devin" | "dummy";
}
