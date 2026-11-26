import type { DevinMessagesPage, DevinSessionItem } from "./types";

const BASE_URL = "https://api.devin.ai/v3";

export interface DevinCredentials {
  apiKey: string;
  orgId: string;
}

export function readCredentials(): DevinCredentials | null {
  const apiKey = process.env.DEVIN_API_KEY?.trim();
  const orgId = process.env.DEVIN_ORG_ID?.trim();
  return apiKey && orgId ? { apiKey, orgId } : null;
}

export async function fetchSessions(cred: DevinCredentials, limit = 50): Promise<DevinSessionItem[]> {
  const url = `${BASE_URL}/organizations/${encodeURIComponent(cred.orgId)}/sessions?first=${limit}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${cred.apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Devin API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { items?: DevinSessionItem[] };
  return json.items ?? [];
}

export class DevinApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function devinId(sessionId: string): string {
  return sessionId.startsWith("devin-") ? sessionId : `devin-${sessionId}`;
}

/**
 * セッションのメッセージを1ページ取得する。API は時系列（古い順）で、after に前回のカーソルを渡すと続きから返す。
 * 見つからない（404/410）ときは null。
 */
export async function fetchMessagesPage(
  cred: DevinCredentials,
  sessionId: string,
  after: string | null,
  first = 100,
): Promise<DevinMessagesPage | null> {
  const qs = new URLSearchParams({ first: String(first) });
  if (after) qs.set("after", after);
  const url = `${BASE_URL}/organizations/${encodeURIComponent(cred.orgId)}/sessions/${encodeURIComponent(devinId(sessionId))}/messages?${qs}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${cred.apiKey}`, Accept: "application/json" },
  });
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new DevinApiError(res.status, `Devin API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as Partial<DevinMessagesPage>;
  return {
    items: json.items ?? [],
    end_cursor: json.end_cursor ?? null,
    has_next_page: json.has_next_page ?? false,
    total: json.total ?? null,
  };
}

/** 一覧から外れたセッションの最新状態を個別に取得する（見つからなければ null） */
export async function fetchSession(cred: DevinCredentials, sessionId: string): Promise<DevinSessionItem | null> {
  const url = `${BASE_URL}/organizations/${encodeURIComponent(cred.orgId)}/sessions/${encodeURIComponent(devinId(sessionId))}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${cred.apiKey}`, Accept: "application/json" },
  });
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new DevinApiError(res.status, `Devin API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as DevinSessionItem;
}

export function sessionUrl(item: DevinSessionItem): string {
  if (item.url) return item.url;
  return `https://app.devin.ai/sessions/${item.session_id.replace(/^devin-/, "")}`;
}
