/**
 * テスト用: globalThis.fetch を差し替え、Devin API の応答を tests/fixtures から返す。実 API には一切つながない。
 * MOCK_DEVIN_LOG にファイルパスを渡すと、受けたリクエストの URL を1行ずつ追記する。
 * MOCK_DEVIN_EXTRA に JSON（messages.json と同じ形）を渡すと、フィクスチャに追加・上書きする。
 */
import fs from "node:fs";
import path from "node:path";

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "fixtures");
const sessions = JSON.parse(fs.readFileSync(path.join(dir, "sessions.json"), "utf8"));
const messages: Record<string, unknown> = {
  ...JSON.parse(fs.readFileSync(path.join(dir, "messages.json"), "utf8")),
  ...(process.env.MOCK_DEVIN_EXTRA ? JSON.parse(process.env.MOCK_DEVIN_EXTRA) : {}),
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (process.env.MOCK_DEVIN_LOG) fs.appendFileSync(process.env.MOCK_DEVIN_LOG, `${url.pathname}${url.search}\n`);
  if (url.host !== "api.devin.ai") throw new Error(`unexpected request: ${url.href}`);
  if (/^\/v3\/organizations\/[^/]+\/sessions$/.test(url.pathname)) return json(sessions);
  const m = url.pathname.match(/^\/v3\/organizations\/[^/]+\/sessions\/([^/]+)\/messages$/);
  if (m) {
    const page = messages[`${decodeURIComponent(m[1])}|${url.searchParams.get("after") ?? ""}`];
    // カーソルの先に新しいメッセージが無いときは空ページ（end_cursor なし）
    return json(page ?? { items: [], end_cursor: null, has_next_page: false, total: null });
  }
  return json({ status: 404, title: "Not Found" }, 404);
}) as typeof fetch;
