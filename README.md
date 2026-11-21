# Taskwatch — AIセッション監視アプリ

Devin のセッションを一覧で監視する個人用 Web アプリです。画面仕様は `design/` のモック（`taskwatch-v2.html` = スマホ版、`taskwatch-v2-pc.html` = PC版）を参照してください。

- 収集ワーカー（`npm run collect`）が Devin API v3 からセッション一覧を取得し、SQLite（既定はローカルの `data/taskwatch.db`、[Turso モード](#turso-モードvercel-へのデプロイ)ではホスト型 SQLite）に保存します
- 画面（Next.js）は SQLite だけを読みます。表示のたびに Devin API を叩くことはありません（30秒ごとに SQLite を読み直します）
- レポート画面（GitHub PR レポート）と Claude Code 連携は次の段階で対応予定です

## 本番運用

| 項目 | 内容 |
| --- | --- |
| 本番URL | https://taskwatch-five.vercel.app （Vercel にデプロイ済み） |
| データベース | Turso（libSQL、東京リージョン）。接続情報は環境変数 `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` で渡す |
| デプロイ | GitHub 連携の自動デプロイは未設定。更新時は Vercel CLI で再デプロイする（`vercel --prod`） |
| 収集ワーカー | VM 上で5分おきに実行され、Turso に書き込む |

- `main` に push・マージしても本番には反映されません。更新を反映するときは、リポジトリのルートで `vercel --prod` を実行してください
- 設定手順の詳細は [Turso モード（Vercel へのデプロイ）](#turso-モードvercel-へのデプロイ) を参照してください

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

## Turso モード（Vercel へのデプロイ）

画面を Vercel に置く場合は、DB をホスト型 SQLite の [Turso](https://turso.tech/)（libSQL）にします。収集ワーカーはこれまで通り手元の VM で動かし、同じ Turso の DB に書き込みます。

| 環境変数 | 内容 |
| --- | --- |
| `TURSO_DATABASE_URL` | Turso の DB URL（例: `libsql://taskwatch-<組織名>.turso.io`） |
| `TURSO_AUTH_TOKEN` | Turso の認証トークン |

- **両方**がプロセスの環境変数に設定されているときだけ Turso に接続します。片方だけ・未設定ならローカルの SQLite（`data/taskwatch.db` / `TASKWATCH_DB_PATH`）を使います（片方だけのときは警告を出します）
- `.env` / `.env.local` は読み込みません。値はリポジトリ外に置いてください
- スキーマはローカルと同じです。収集ワーカーの初回実行時に同じ DDL で作成されます（画面はテーブルを作りません。テーブルが無い間は空表示）

### 1. Turso の DB とトークンを作る

```bash
turso db create taskwatch
turso db show taskwatch --url                         # → TURSO_DATABASE_URL
turso db tokens create taskwatch                      # 収集ワーカー用（読み書き）
turso db tokens create taskwatch --read-only          # 画面（Vercel）用（読み取り専用）
```

画面は読み取りしかしないので、Vercel には読み取り専用トークンを渡すことをおすすめします。

### 2. 既存のローカル DB を Turso にコピーする（任意・1回だけ）

`data/taskwatch.db`（または `TASKWATCH_DB_PATH`）の sessions / meta を Turso にコピーします。同じキーの行は**ローカルの値で丸ごと上書き**し（`INSERT OR REPLACE`）、全件を1つのトランザクションで書き込みます。

1. 動いている収集ワーカー（`--watch`）を止める
2. `~/.config/taskwatch/env` に `TURSO_DATABASE_URL` と `TURSO_AUTH_TOKEN`（読み書きトークン）を追記する（書き方は手順3と同じ）
3. 移行を実行する（収集ワーカーの再起動は、移行が終わってから手順3で行う）

```bash
(set -a && . ~/.config/taskwatch/env && exec npm run migrate:turso)
```

> [!WARNING]
> 移行は、収集ワーカーを Turso に向ける**前**に1回だけ実行してください。
> - 収集ワーカーが Turso に書き込み始めた後に移行を実行すると、Turso 側の新しいセッション行と `meta`（`mode` / `last_collected_at` / `org_id`）が、ローカルの古い値で上書きされます
> - ローカル向けの収集ワーカーは、移行の前に止めてください。動かしたままだと、移行の後にローカルにだけ書き込まれた分は Turso に反映されません
> - Turso に切り替えた後は、ローカル DB は使われません。移行をやり直す必要はありません（次の収集で Turso 側が最新の状態になります）

### 3. 収集ワーカー（VM）を Turso に向ける

`~/.config/taskwatch/env`（パーミッション 600、リポジトリ外）に Devin のキーと並べて書きます。

```bash
#   DEVIN_API_KEY=...
#   DEVIN_ORG_ID=org-...
#   TURSO_DATABASE_URL=libsql://taskwatch-<組織名>.turso.io
#   TURSO_AUTH_TOKEN=...（読み書きトークン）
(set -a && . ~/.config/taskwatch/env && exec npm run collect -- --watch 60)
```

### 4. Vercel にデプロイする

1. Vercel で GitHub リポジトリ `ukir-rrrr/taskwatch` をインポートする（Framework: Next.js、ビルドコマンド等は既定のまま）
2. Project Settings → Environment Variables に次を設定する（Production / Preview など使う環境すべて）
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`（読み取り専用トークン）
3. デプロイ（環境変数を後から変えた場合は再デプロイ）

CLI の場合:

```bash
vercel link
vercel env add TURSO_DATABASE_URL production
vercel env add TURSO_AUTH_TOKEN production
vercel --prod
```

- Vercel には `DEVIN_API_KEY` / `DEVIN_ORG_ID` を設定しないでください。画面は DB だけを読みます
- 画面には認証がありません。Vercel に公開する場合は Vercel の Deployment Protection（Vercel Authentication など）で閲覧を制限してください

## 構成

| パス | 役割 |
| --- | --- |
| `scripts/collect.ts` | 収集ワーカー。Devin API（またはダミーデータ）→ SQLite / Turso |
| `scripts/migrate-to-turso.ts` | ローカル SQLite → Turso のワンオフコピー（`npm run migrate:turso`） |
| `lib/devin-api.ts` | `GET /v3/organizations/{org_id}/sessions?limit=50` の呼び出し |
| `lib/devin-status.ts` | `status` / `status_detail` から「要確認／実行中／失敗・異常終了／完了・停止」への分類（分類ロジックはこのファイルに集約） |
| `lib/activity.ts` | 「いま何をしているか」の一言（`current_activity`）を作る関数。将来 LLM 要約に差し替える前提で独立 |
| `lib/db.ts` / `lib/queries.ts` | スキーマと DB 接続（ローカル SQLite / Turso の切り替え）、読み出し |
| `lib/dummy-data.ts` | ダミーモード用データ（モックと同じタスク） |
| `app/reports/page.tsx` | レポート画面。`reports` テーブルを新しい順に表示（`summary` / `code_picks` はマークダウン） |
| `app/` `components/` | 画面（Mantine）。390px のスマホ幅と 1440px の PC 幅に対応 |

### sessions テーブル

`session_id`, `title`, `status`, `status_detail`, `acus_consumed`, `pr_urls`（JSON）, `created_at`, `updated_at`（epoch秒）, `first_seen_at`, `needs_attention`, `current_activity` に加え、`pr_states`（JSON）, `url`（Devin のセッション URL）, `source`（`devin` / `dummy`）を保存します。

### reports テーブル（PRレポート）

レポートは PR がマージされた後ではなく、**PR が作成（オープン）された時点**で読めるようにします（マージ判断の材料にするため）。

- `id`, `pr_url`（一意）, `session_id`, `pr_title`, `repo`（`owner/repo`）, `pr_state`, `created_at`（epoch秒）, `summary` / `code_picks`（マークダウン）, `status`（`pending` / `generated`）, `generated_at`, `github_synced_at`（GitHub から PR 情報を取れた時刻）
- `collect` はセッションの `pull_requests` のうちオープンの PR を `status=pending` で登録します（`pr_url` で冪等。既存行は `pr_state` を最新に更新）
- `pr_title` / `created_at` は GitHub API（`GET /repos/{owner}/{repo}/pulls/{number}`、認証なし）から取った PR のタイトルと作成日時です。プライベートリポジトリやレート制限（未認証は 1 時間 60 回）で取れないときは、セッションのタイトルと検出時刻で登録し、`pending` の間は収集のたびに取り直します（取れた行は以後取り直しません）。ダミーモードでは GitHub API を呼びません
- `summary` / `code_picks` を書き込んで `status=generated` にする生成処理は別途（未実装）。画面では `pending` の行は「生成中」と表示します
- ダミーモードでは PR #412 を生成済みのサンプル、#1287 を生成中として登録します。実データを収集するとダミーのレポートは削除されます

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
