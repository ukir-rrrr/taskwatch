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
});
