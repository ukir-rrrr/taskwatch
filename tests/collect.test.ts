/**
 * 収集ワーカー（scripts/collect.ts）を子プロセスで実行する結合テスト。
 * Devin API は helpers/mock-devin-api.ts で fetch ごと差し替えるので、実 API には接続しない。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { openLocalDb } from "../lib/db";

const root = path.join(import.meta.dirname, "..");
const mock = path.join(import.meta.dirname, "helpers", "mock-devin-api.ts");

describe("npm run collect（Devin API をモック）", () => {
  let dir: string;
  let dbPath: string;
  let log: string;

  const collect = (extraEnv: Record<string, string> = {}) => {
    fs.writeFileSync(log, "");
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TASKWATCH_DB_PATH: dbPath,
      MOCK_DEVIN_LOG: log,
      ...extraEnv,
    };
    execFileSync(process.execPath, ["--import", "tsx", "--import", mock, "scripts/collect.ts"], { cwd: root, env, stdio: "pipe" });
    return fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
  };
  const real = { DEVIN_API_KEY: "test-key", DEVIN_ORG_ID: "org-test" };
  const readRows = async () => {
    const db = (await openLocalDb({ path: dbPath, readonly: true }))!;
    try {
      return await db.all<{ session_id: string; latest_message: string | null; latest_message_at: number | null }>(
        `SELECT s.session_id, m.latest_message, m.latest_message_at FROM sessions s
         LEFT JOIN session_messages m ON m.session_id = s.session_id ORDER BY s.session_id`,
      );
    } finally {
      db.close();
    }
  };

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "taskwatch-collect-"));
    dbPath = path.join(dir, "t.db");
    log = path.join(dir, "requests.log");
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("ダミーモードでは API を呼ばず、モックの文言を最新メッセージとして保存する", async () => {
    assert.deepEqual(collect(), []);
    const rows = await readRows();
    const withMsg = rows.filter((r) => r.latest_message);
    assert.ok(withMsg.length > 0);
    assert.ok(withMsg.every((r) => typeof r.latest_message_at === "number"));
  });

  it("1回目: 一覧と各セッションの messages を取得し、ダミー行は消える", async () => {
    const reqs = collect(real);
    assert.deepEqual(reqs, [
      "/v3/organizations/org-test/sessions?first=50",
      "/v3/organizations/org-test/sessions/devin-run0001/messages?first=100",
      "/v3/organizations/org-test/sessions/devin-run0001/messages?first=100&after=cursor-run-1",
      "/v3/organizations/org-test/sessions/devin-exit0001/messages?first=100",
    ]);
    const rows = await readRows();
    assert.deepEqual(
      rows.map((r) => [r.session_id, r.latest_message, r.latest_message_at]),
      [
        ["devin-exit0001", "PRを作成しました: https://github.com/example/admin-web/pull/412\n\nBOM 付き UTF-8 で出力するよう修正しました。", 1795224900],
        ["devin-run0001", "500件ずつ分けて同期する処理を実装中です。", 1795231000],
      ],
    );
  });

  it("2回目: 実行中セッションだけをカーソルの続きから取得し、終了済みは取り直さない", async () => {
    const reqs = collect(real);
    assert.deepEqual(reqs, [
      "/v3/organizations/org-test/sessions?first=50",
      "/v3/organizations/org-test/sessions/devin-run0001/messages?first=100&after=cursor-run-1",
    ]);
  });

  it("一覧から外れたセッションも、messages を読み切れていなければ個別取得して最終メッセージを取る", async () => {
    // 実行中に途中経過だけ保存され、その後終了して一覧（最新50件）から外れた状態
    const old = { session_id: "devin-old0001", title: "古いセッション", status: "exit", status_detail: null, acus_consumed: 1,
      pull_requests: [], created_at: 1795100000, updated_at: 1795100900, url: "https://app.devin.ai/sessions/old0001" };
    const db = (await openLocalDb({ path: dbPath }))!;
    try {
      await db.batch([
        {
          sql: "INSERT INTO sessions (session_id, title, status, created_at, updated_at, first_seen_at, source) VALUES (?, ?, 'exit', ?, ?, ?, 'devin')",
          args: [old.session_id, old.title, old.created_at, old.updated_at, old.created_at],
        },
        {
          sql: "INSERT INTO session_messages (session_id, latest_message, latest_message_at, latest_event_id, cursor, synced_updated_at, checked_at) VALUES (?, '作業中です', ?, 'e-old-1', 'cursor-old-1', ?, ?)",
          args: [old.session_id, 1795100100, 1795100200, 1795100200],
        },
      ]);
    } finally {
      db.close();
    }
    const done = { items: [{ event_id: "e-old-2", created_at: 1795100800, message: "完了しました", source: "devin" }], end_cursor: null, has_next_page: false };
    const reqs = collect({
      ...real,
      MOCK_DEVIN_SESSIONS: JSON.stringify({ [old.session_id]: old }),
      MOCK_DEVIN_EXTRA: JSON.stringify({ "devin-old0001|cursor-old-1": done }),
    });
    assert.ok(reqs.includes("/v3/organizations/org-test/sessions/devin-old0001"));
    assert.ok(reqs.includes("/v3/organizations/org-test/sessions/devin-old0001/messages?first=100&after=cursor-old-1"));
    const row = (await readRows()).find((r) => r.session_id === old.session_id);
    assert.equal(row?.latest_message, "完了しました");

    // 読み切った後は個別取得しない
    assert.ok(!collect({ ...real, MOCK_DEVIN_SESSIONS: JSON.stringify({ [old.session_id]: old }) }).some((r) => r.includes("old0001")));
  });

  it("終了済みのセッションが個別取得で見つからなくても消さず、以後は取りに行かない", async () => {
    const id = "devin-old0002";
    const db = (await openLocalDb({ path: dbPath }))!;
    try {
      await db.batch([
        {
          sql: "INSERT INTO sessions (session_id, title, status, created_at, updated_at, first_seen_at, source) VALUES (?, '別組織', 'exit', 1795000000, 1795000900, 1795000000, 'devin')",
          args: [id],
        },
        {
          sql: "INSERT INTO session_messages (session_id, latest_message, latest_message_at, cursor, synced_updated_at, checked_at) VALUES (?, '作業中です', 1795000100, 'c', 1795000200, 1795000200)",
          args: [id],
        },
      ]);
    } finally {
      db.close();
    }
    assert.ok(collect(real).includes(`/v3/organizations/org-test/sessions/${id}`));
    assert.equal((await readRows()).find((r) => r.session_id === id)?.latest_message, "作業中です");
    assert.ok(!collect(real).some((r) => r.includes("old0002")));
  });

  it("個別取得が失敗しても収集全体は止めない", async () => {
    const db = (await openLocalDb({ path: dbPath }))!;
    try {
      await db.batch([
        {
          sql: "INSERT INTO sessions (session_id, title, status, created_at, updated_at, first_seen_at, source) VALUES ('devin-err0001', 'エラー', 'running', 1795000000, 1795000900, 1795000000, 'devin')",
        },
      ]);
    } finally {
      db.close();
    }
    const reqs = collect({ ...real, MOCK_DEVIN_SESSIONS: JSON.stringify({ "devin-err0001": 500 }) });
    assert.ok(reqs.includes("/v3/organizations/org-test/sessions/devin-err0001"));
    // 一覧のセッションの messages は取りに行き、エラーのセッションは消さずに残る
    assert.ok(reqs.some((r) => r.includes("devin-run0001/messages")));
    assert.ok((await readRows()).some((r) => r.session_id === "devin-err0001"));
  });
});
