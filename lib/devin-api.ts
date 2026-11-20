import type { DevinSessionItem } from "./types";

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
  const url = `${BASE_URL}/organizations/${encodeURIComponent(cred.orgId)}/sessions?limit=${limit}`;
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

export function sessionUrl(item: DevinSessionItem): string {
  if (item.url) return item.url;
  return `https://app.devin.ai/sessions/${item.session_id.replace(/^devin-/, "")}`;
}
