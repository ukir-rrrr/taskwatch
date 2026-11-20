# Taskwatch — AIセッション監視アプリ

Devin のセッションを一覧で監視する個人用 Web アプリです。画面仕様は `design/` のモック（`taskwatch-v2.html` = スマホ版、`taskwatch-v2-pc.html` = PC版）を参照してください。

- 収集ワーカー（`npm run collect`）が Devin API v3 からセッション一覧を取得し、SQLite（`data/taskwatch.db`）に保存します
- 画面（Next.js）は SQLite だけを読みます。表示のたびに Devin API を叩くことはありません（30秒ごとに SQLite を読み直します）
- レポート画面（GitHub PR レポート）と Claude Code 連携は次の段階で対応予定です

## 必要なもの

- Node.js 20 以上

## 起動手順（ダミーモード）

`DEVIN_API_KEY` / `DEVIN_ORG_ID` が未設定なら、モックと同じダミーデータで動きます。開発・検証はこのモードで行ってください。

```bash
npm install
npm run collect   # ダミーデータを data/taskwatch.db に保存
npm run dev       # → http://localhost:3000
```

本番ビルドは `npm run build && npm start` です。

## 実データの収集（運用）

収集ワーカーは `DEVIN_API_KEY` / `DEVIN_ORG_ID` を**プロセスの環境変数からのみ**読みます。`.env` / `.env.local` は読み込みません。

実キーをリポジトリ内（`.env.local` など）に平文で置かないでください。リポジトリを読むツールやエージェントから見えてしまいます。キーはリポジトリ外のファイルに置き、収集ワーカーを起動するときだけ読み込みます。

```bash
# 1. リポジトリ外にキーのファイルを作る（パーミッション 600）
mkdir -p ~/.config/taskwatch && chmod 700 ~/.config/taskwatch
install -m 600 /dev/null ~/.config/taskwatch/env
#   ~/.config/taskwatch/env をエディタで開き、次の2行を書く
#   DEVIN_API_KEY=...
#   DEVIN_ORG_ID=org-...

# 2. 収集ワーカーの起動時だけ読み込む（サブシェル内なので、いまのシェルには残らない）
(set -a && . ~/.config/taskwatch/env && exec npm run collect)
#   定期的に収集し続ける場合（秒指定、最短15秒）
(set -a && . ~/.config/taskwatch/env && exec npm run collect -- --watch 60)

# 3. 画面はキー不要（SQLite だけを読む）
npm run dev
```

- 画面（`npm run dev` / `npm start`）にはキーを渡さないでください。画面は SQLite だけを読むので、キーは不要です
- `.env.example` は変数名の一覧です。値は入れないでください
- 画面は認証なしの個人用なので、`npm run dev` / `npm start` は `127.0.0.1` だけで待ち受けます。他の端末から見る場合は SSH ポート転送などを使ってください
- DB の場所を変える場合は、`TASKWATCH_DB_PATH` を収集ワーカーと画面の両方のプロセスに環境変数で渡してください

## 構成

| パス | 役割 |
| --- | --- |
| `scripts/collect.ts` | 収集ワーカー。Devin API（またはダミーデータ）→ SQLite |
| `lib/devin-api.ts` | `GET /v3/organizations/{org_id}/sessions?limit=50` の呼び出し |
| `lib/devin-status.ts` | `status` / `status_detail` から「要確認／実行中／失敗・異常終了／完了・停止」への分類（分類ロジックはこのファイルに集約） |
| `lib/activity.ts` | 「いま何をしているか」の一言（`current_activity`）を作る関数。将来 LLM 要約に差し替える前提で独立 |
| `lib/db.ts` / `lib/queries.ts` | SQLite のスキーマと読み出し |
| `lib/dummy-data.ts` | ダミーモード用データ（モックと同じタスク） |
| `app/` `components/` | 画面（Mantine）。390px のスマホ幅と 1440px の PC 幅に対応 |

### sessions テーブル

`session_id`, `title`, `status`, `status_detail`, `acus_consumed`, `pr_urls`（JSON）, `created_at`, `updated_at`（epoch秒）, `first_seen_at`, `needs_attention`, `current_activity` に加え、`pr_states`（JSON）, `url`（Devin のセッション URL）, `source`（`devin` / `dummy`）を保存します。

### 状態の分類

| 分類 | 条件 |
| --- | --- |
| 要確認 | `running` + `waiting_for_user` / `waiting_for_approval`、または `suspended` + 利用上限・クレジット不足などのブロック系 |
| 実行中 | `new` / `claimed` / `resuming`、`running` + `working` |
| 失敗・異常終了 | `error`、`suspended` + `error` |
| 完了・停止 | `exit`、`running` + `finished`、`suspended` + `inactivity` / `user_request` |

### 補足

- 組織の ACU 残量は API で取れない前提のため、残量帯は「取得したセッションの `acus_consumed` 合計」と直近セッションの消費を表示します
- `current_activity` は実データでは状態と PR から機械的に作ります。ダミーモードではモックの文言を「直近メッセージ」として渡しています
- 収集は最新 50 件のみです（ページ送りは未対応）
- ダミーモードのデータは `collect` のたびに作り直され、実データを収集するとダミーは削除されます
