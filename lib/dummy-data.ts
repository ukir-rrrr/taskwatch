import type { DevinSessionItem } from "./types";

/** ダミーモード用。design/ のモックと同じタスクを Devin API と同じ形で返す */
export type DummyItem = DevinSessionItem & { latest_message?: string };

/** ダミーセッションの session_id の接頭辞（reports のダミー行の判別にも使う） */
export const DUMMY_SESSION_PREFIX = "devin-dummy";

interface Seed {
  title: string;
  status: string;
  status_detail: string | null;
  /** 開始からの経過（分） */
  min: number;
  /** 完了・停止したセッションの所要（分）。未指定なら現在も継続中 */
  took?: number;
  acus: number;
  prs?: [string, string | null][];
  latest?: string;
}

const SEEDS: Seed[] = [
  // 要確認
  { title: "決済Webhookの再送処理を追加", status: "running", status_detail: "waiting_for_user", min: 38, acus: 4.2,
    latest: "再送の上限を5回から8回に変更してよいですか。" },
  { title: "Next.js 15 へのアップグレード", status: "running", status_detail: "waiting_for_user", min: 112, acus: 11.6,
    latest: "画像最適化の設定を新方式に置き換えました。プレビューで商品一覧の表示を確認してください。" },
  { title: "Sentry通知のノイズを削減", status: "running", status_detail: "waiting_for_approval", min: 21, acus: 1.8,
    latest: "発生頻度の低い12種類のエラーを通知対象から外します。" },
  // 失敗・異常終了
  { title: "決済画面のアクセシビリティ修正", status: "error", status_detail: null, min: 52, took: 52, acus: 6.3,
    latest: "E2Eテスト 3件が失敗したまま停止。カード番号欄のラベル変更が原因" },
  { title: "倉庫APIクライアントの型定義を生成", status: "suspended", status_detail: "error", min: 22, took: 17, acus: 2.1,
    latest: "応答が途絶えました。生成途中のファイルは未コミット" },
  // 実行中
  { title: "在庫同期バッチのタイムアウト対策", status: "running", status_detail: "working", min: 46, acus: 5.4,
    latest: "500件ずつ分けて同期する処理を実装中" },
  { title: "管理画面の権限チェックを共通化", status: "running", status_detail: "working", min: 33, acus: 3.9,
    latest: "注文管理画面に適用。残り6画面" },
  { title: "配送料計算のテストを追加", status: "running", status_detail: "working", min: 28, acus: 2.7,
    latest: "同梱時の料金パターンを追加中" },
  { title: "E2Eテストの不安定な失敗を調査", status: "running", status_detail: "working", min: 17, acus: 1.5,
    latest: "カート画面のテストを20回連続で実行中。3回失敗" },
  { title: "依存パッケージの脆弱性に対応", status: "claimed", status_detail: null, min: 1, acus: 0.1 },
  // 完了・停止
  { title: "注文CSVエクスポートの文字化けを修正", status: "exit", status_detail: null, min: 68, took: 24, acus: 3.1,
    prs: [["https://github.com/example/admin-web/pull/412", "open"]] },
  { title: "会員登録フォームの入力チェックを改善", status: "running", status_detail: "finished", min: 220, took: 41, acus: 5.8,
    prs: [["https://github.com/example/storefront/pull/1287", "open"]] },
  { title: "APIドキュメントの自動生成を追加", status: "exit", status_detail: null, min: 260, took: 15, acus: 1.6,
    prs: [["https://github.com/example/payments-api/pull/356", "merged"]] },
  { title: "ログイン履歴の画面に絞り込みを追加", status: "suspended", status_detail: "inactivity", min: 1320, took: 48, acus: 4.4 },
];

export function dummySessions(nowSec = Math.floor(Date.now() / 1000)): DummyItem[] {
  return SEEDS.map((s, i) => {
    const created = nowSec - s.min * 60;
    const updated = s.took != null ? created + s.took * 60 : nowSec - 60;
    return {
      session_id: `${DUMMY_SESSION_PREFIX}${String(i + 1).padStart(4, "0")}`,
      title: s.title,
      status: s.status,
      status_detail: s.status_detail,
      acus_consumed: s.acus,
      pull_requests: (s.prs ?? []).map(([pr_url, pr_state]) => ({ pr_url, pr_state })),
      created_at: created,
      updated_at: updated,
      url: "https://app.devin.ai/sessions",
      latest_message: s.latest,
    };
  });
}

/** ダミーモードで「生成済み」として入れるレポート（それ以外のオープンPRは pending のまま） */
export const DUMMY_REPORTS: Record<string, { summary: string; code_picks: string }> = {
  "https://github.com/example/admin-web/pull/412": {
    summary: `Excel で開くと日本語が化ける原因を、**BOM なしの UTF-8 出力**と特定して修正しました。

- 出力の先頭に BOM を付け、改行を CRLF に統一
- 1万件を超える注文でもメモリを使い切らないよう、逐次書き出しに変更
- Excel・Numbers・Google スプレッドシートで開けることをテストで確認

**確認してほしい点:** 備考欄が \`=\` などで始まる場合は先頭に \`'\` を付けて文字列扱いにしています（CSV インジェクション対策）。`,
    code_picks: `#### \`src/export/orderCsv.ts\`（L12–19）

\`\`\`ts
// Excel は BOM がないと Shift_JIS として読む
const BOM = "\\uFEFF";

export function* orderCsvRows(orders) {
  yield BOM + HEADER.join(",") + "\\r\\n";
  for (const o of orders) {
    yield toRow(o).join(",") + "\\r\\n";
  }
}
\`\`\`

文字コードを Shift_JIS に変えると絵文字や旧字の注文者名が欠けるため、UTF-8 のまま BOM で判別させました。

#### \`src/export/escape.ts\`（L3–8）

\`\`\`ts
export function cell(v: string) {
  const s = v.replace(/"/g, '""');
  // 先頭が = + - @ だと数式として実行される
  return /^[=+\\-@]/.test(s) ? \`"'\${s}"\` : \`"\${s}"\`;
}
\`\`\`
`,
  },
};
