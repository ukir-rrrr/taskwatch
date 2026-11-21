/** GitHub の公開 API（認証なし）から PR のタイトルと作成日時を取る。未認証は 1 時間あたり 60 回まで */
const API = "https://api.github.com";

export interface PrMeta {
  title: string;
  /** epoch秒 */
  created_at: number;
}

export function parsePrUrl(url: string): { owner: string; repo: string; number: number } | null {
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#]|$)/);
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
}

export type PrMetaResult = { ok: true; meta: PrMeta } | { ok: false; rateLimited: boolean; reason: string };

export async function fetchPrMeta(prUrl: string): Promise<PrMetaResult> {
  const p = parsePrUrl(prUrl);
  if (!p) return { ok: false, rateLimited: false, reason: "GitHub の PR URL ではありません" };
  try {
    const res = await fetch(`${API}/repos/${encodeURIComponent(p.owner)}/${encodeURIComponent(p.repo)}/pulls/${p.number}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "taskwatch", "X-GitHub-Api-Version": "2022-11-28" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const rateLimited = res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0");
      return { ok: false, rateLimited, reason: `HTTP ${res.status}` };
    }
    const json = (await res.json()) as { title?: unknown; created_at?: unknown };
    const created = typeof json.created_at === "string" ? Date.parse(json.created_at) : NaN;
    if (typeof json.title !== "string" || !json.title.trim() || Number.isNaN(created)) {
      return { ok: false, rateLimited: false, reason: "応答に title / created_at がありません" };
    }
    return { ok: true, meta: { title: json.title.trim(), created_at: Math.floor(created / 1000) } };
  } catch (e) {
    return { ok: false, rateLimited: false, reason: (e as Error).message };
  }
}
