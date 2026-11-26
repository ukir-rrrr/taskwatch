import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { openLocalDb, type Db } from "../lib/db";
import { DevinApiError, fetchMessagesPage } from "../lib/devin-api";
import { latestDevinMessage, needsFetch, syncLatestMessages, toPreview, type FetchPage } from "../lib/messages";
import type { DevinMessagesPage } from "../lib/types";

const fixtures: Record<string, DevinMessagesPage> = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "fixtures", "messages.json"), "utf8"),
);
const RUNNING = { session_id: "devin-run0001", status: "running", status_detail: "working", updated_at: 1795231500 };
const EXITED = { session_id: "devin-exit0001", status: "exit", status_detail: null, updated_at: 1795225000 };

/** フィクスチャから返す fetchPage。呼ばれた (id, after) を記録する */
function fixtureFetch(extra: Record<string, DevinMessagesPage> = {}) {
  const calls: string[] = [];
  const pages = { ...fixtures, ...extra };
  const fn: FetchPage = async (id, after) => {
    const key = `${id}|${after ?? ""}`;
    calls.push(key);
    return pages[key] ?? { items: [], end_cursor: null, has_next_page: false };
  };
  return { fn, calls };
}

describe("toPreview", () => {
  it("UI 用の印を落として前後の空白を詰める", () => {
    assert.equal(
      toPreview('完了しました。\n\nATTACHMENT:{"url":"x"}\n[OFFER_TEST_APP]テスト[/OFFER_TEST_APP]'),
      "完了しました。",
    );
  });
  it("300字を超える本文は300字（末尾…込み）に切り詰める", () => {
    const p = toPreview("あ".repeat(500));
    assert.equal(Array.from(p).length, 300);
    assert.ok(p.endsWith("…"));
    assert.equal(toPreview("短い本文"), "短い本文");
  });
});

describe("latestDevinMessage", () => {
  it("source=devin の最新を返し、それより新しいユーザー発は無視する", () => {
    const page = fixtures["devin-run0001|cursor-run-1"];
    assert.equal(latestDevinMessage(page.items)?.event_id, "event-r3");
    assert.equal(latestDevinMessage(fixtures["devin-run0001|"].items)?.event_id, "event-r2");
  });
  it("Devin 発が無ければ null", () => {
    assert.equal(latestDevinMessage([{ event_id: "e", created_at: 1, message: "hi", source: "user" }]), null);
  });
});

describe("needsFetch", () => {
  const synced = (synced_updated_at: number | null) => ({
    session_id: "x", latest_message: "m", latest_message_at: 1, latest_event_id: "e", cursor: "c", synced_updated_at,
  });
  it("未取得・読み途中は取る", () => {
    assert.equal(needsFetch(EXITED, undefined), true);
    assert.equal(needsFetch(EXITED, synced(null)), true);
  });
  it("実行中・返信待ちは毎回取る", () => {
    assert.equal(needsFetch(RUNNING, synced(RUNNING.updated_at)), true);
    assert.equal(needsFetch({ ...RUNNING, status_detail: "waiting_for_user" }, synced(RUNNING.updated_at)), true);
  });
  it("終了済みは updated_at が変わらない限り取らない", () => {
    assert.equal(needsFetch(EXITED, synced(EXITED.updated_at)), false);
    assert.equal(needsFetch({ ...EXITED, updated_at: EXITED.updated_at + 60 }, synced(EXITED.updated_at)), true);
  });
});

describe("fetchMessagesPage（fetch をモック）", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const cred = { apiKey: "test-key", orgId: "org-test" };

  it("最新分だけを after 付きで要求し、レスポンスをそのまま返す", async () => {
    let seen: { url: string; auth: string | null } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen = { url, auth: new Headers(init.headers).get("Authorization") };
      return new Response(JSON.stringify(fixtures["devin-run0001|cursor-run-1"]), { status: 200 });
    }) as typeof fetch;
    const page = await fetchMessagesPage(cred, "run0001", "cursor-run-1");
    assert.deepEqual(seen, {
      url: "https://api.devin.ai/v3/organizations/org-test/sessions/devin-run0001/messages?first=100&after=cursor-run-1",
      auth: "Bearer test-key",
    });
    assert.equal(page?.items.length, 2);
    assert.equal(page?.has_next_page, false);
    assert.equal(page?.end_cursor, null);
  });

  it("404 は null、429 は status 付きのエラー", async () => {
    globalThis.fetch = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    assert.equal(await fetchMessagesPage(cred, "devin-x", null), null);
    globalThis.fetch = (async () => new Response("slow down", { status: 429, statusText: "Too Many Requests" })) as unknown as typeof fetch;
    await assert.rejects(fetchMessagesPage(cred, "devin-x", null), (e) => e instanceof DevinApiError && e.status === 429);
  });
});

describe("syncLatestMessages（ローカル SQLite）", () => {
  let dir: string;
  let db: Db;
  const now = 1795232000;
  const rows = () =>
    db.all<Record<string, unknown>>("SELECT * FROM session_messages ORDER BY session_id");
  const sync = async (sessions: typeof RUNNING[] | (typeof RUNNING | typeof EXITED)[], fn: FetchPage, budget?: number) => {
    const r = await syncLatestMessages(db, sessions, fn, { now, budget });
    await db.batch(r.statements);
    return r;
  };

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "taskwatch-test-"));
    db = (await openLocalDb({ path: path.join(dir, "t.db") }))!;
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("初回はページを最後まで読み、Devin 発の最新メッセージとカーソルを保存する", async () => {
    const { fn, calls } = fixtureFetch();
    const r = await sync([RUNNING, EXITED], fn);
    assert.deepEqual(calls, ["devin-run0001|", "devin-run0001|cursor-run-1", "devin-exit0001|"]);
    assert.equal(r.requests, 3);
    const [exit, run] = await rows();
    assert.equal(run.latest_message, "500件ずつ分けて同期する処理を実装中です。");
    assert.equal(run.latest_message_at, 1795231000);
    assert.equal(run.latest_event_id, "event-r3");
    // 最終ページで end_cursor が無いときは、そのページを取った after を残す
    assert.equal(run.cursor, "cursor-run-1");
    assert.equal(run.synced_updated_at, RUNNING.updated_at);
    assert.equal(exit.latest_message, "PRを作成しました: https://github.com/example/admin-web/pull/412\n\nBOM 付き UTF-8 で出力するよう修正しました。");
    assert.equal(exit.cursor, "cursor-exit-1");
  });

  it("2回目以降: 実行中は保存したカーソルから1回だけ、終了済みは取り直さない", async () => {
    await sync([RUNNING, EXITED], fixtureFetch().fn);
    const newer: DevinMessagesPage = {
      items: [
        ...fixtures["devin-run0001|cursor-run-1"].items,
        { event_id: "event-r5", created_at: 1795231900, message: "ログ出力を追加しました。テストを実行中です。", source: "devin" },
      ],
      end_cursor: null,
      has_next_page: false,
    };
    const { fn, calls } = fixtureFetch({ "devin-run0001|cursor-run-1": newer });
    const r = await sync([{ ...RUNNING, updated_at: 1795231950 }, EXITED], fn);
    assert.deepEqual(calls, ["devin-run0001|cursor-run-1"]);
    assert.equal(r.requests, 1);
    const run = (await rows())[1];
    assert.equal(run.latest_message, "ログ出力を追加しました。テストを実行中です。");
    assert.equal(run.latest_message_at, 1795231900);
  });

  it("新しい Devin 発が無いページでは、前回の最新メッセージを残す", async () => {
    await sync([RUNNING], fixtureFetch().fn);
    const onlyUser: DevinMessagesPage = {
      items: [{ event_id: "event-u", created_at: 1795231950, message: "まだですか", source: "user" }],
      end_cursor: null,
      has_next_page: false,
    };
    await sync([RUNNING], fixtureFetch({ "devin-run0001|cursor-run-1": onlyUser }).fn);
    const [run] = await rows();
    assert.equal(run.latest_event_id, "event-r3");
  });

  it("終了済みでも updated_at が変わったら（再開など）続きから取り直す", async () => {
    await sync([EXITED], fixtureFetch().fn);
    const { fn, calls } = fixtureFetch();
    await sync([{ ...EXITED, updated_at: EXITED.updated_at + 600 }], fn);
    assert.deepEqual(calls, ["devin-exit0001|cursor-exit-1"]);
    const [exit] = await rows();
    // 新しいメッセージが無くても最終メッセージは保持する
    assert.equal(exit.latest_event_id, "event-e2");
    assert.equal(exit.synced_updated_at, EXITED.updated_at + 600);
  });

  it("呼び出し回数の上限で打ち切り、読み途中のセッションは次回カーソルから再開する", async () => {
    const first = fixtureFetch();
    const r = await sync([RUNNING, EXITED], first.fn, 1);
    assert.equal(r.requests, 1);
    assert.equal(r.deferred, 1);
    let [run] = await rows();
    assert.equal(run.cursor, "cursor-run-1");
    assert.equal(run.synced_updated_at, null);
    assert.equal(run.latest_event_id, "event-r2");

    const second = fixtureFetch();
    await sync([RUNNING, EXITED], second.fn);
    // 一度も取っていない終了済みセッションが先
    assert.deepEqual(second.calls, ["devin-exit0001|", "devin-run0001|cursor-run-1"]);
    [, run] = await rows();
    assert.equal(run.latest_event_id, "event-r3");
  });

  it("予算が足りなくても、最後に取ってから長いセッションを先に取るので取り残しが出ない", async () => {
    const calls: string[] = [];
    const fn: FetchPage = async (id) => {
      calls.push(id);
      return { items: [], end_cursor: null, has_next_page: false };
    };
    const a = { ...RUNNING, session_id: "devin-a", updated_at: RUNNING.updated_at + 10 };
    const b = { ...RUNNING, session_id: "devin-b" };
    for (let i = 0; i < 4; i++) {
      const r = await syncLatestMessages(db, [a, b], fn, { now: now + i * 60, budget: 1 });
      await db.batch(r.statements);
    }
    assert.deepEqual(calls, ["devin-a", "devin-b", "devin-a", "devin-b"]);
  });

  it("429 を受けたらその回の取得をやめ、ほかのセッションは次回に回す", async () => {
    let n = 0;
    const fn: FetchPage = async () => {
      n++;
      throw new DevinApiError(429, "Devin API 429");
    };
    const r = await sync([RUNNING, EXITED], fn);
    assert.equal(n, 1);
    assert.equal(r.errors.length, 1);
    assert.equal(r.deferred, 1);
    assert.equal((await rows()).length, 0);
  });

  it("セッションが見つからない（404）ときは何も保存しない", async () => {
    const r = await sync([RUNNING], async () => null);
    assert.equal(r.statements.length, 0);
  });
});
