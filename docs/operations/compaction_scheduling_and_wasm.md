# FUSOU データセットコンパクション設計・運用ドキュメント

最終更新: 2025-12-13
ブランチ: `r2_parquet`

---

## 目的

- データセットの連結済み Parquet 断片をテーブル単位で統合（コンパクション）し、Cloudflare R2 のストレージと Supabase メタデータを最適化する。
- Cloudflare Pages/Workers の無料枠制限（CPU時間・メモリ）に配慮した安全な実行基盤を提供する。

---

## 全体アーキテクチャ

- `fusou-upload`（Rust, FUSOU-APP/Tauri 用）
  - ユーザーアップロードの受け取り、Avro→Parquet 変換（MVP）、複数テーブル断片の連結保存、R2 へのアップロード。
  - Supabase の `dataset_files` にメタデータを保存（`file_path`, `start_byte`, `byte_length`, `table_name` 等）。

- `FUSOU-WEB`（Astro + Cloudflare Pages）
  - API ハンドラ（`/src/pages/api/compact.ts`）から WASM 関数を呼び出し、オンデマンドでコンパクション実行。
  - 手動トリガー（`/src/pages/api/compact/trigger.ts`）からメイン API を呼び出し統一フローで実行。
  - 定期実行（`/functions/_scheduled.ts`）で Supabase を参照し、必要なデータセットのみバッチ的に実行。

- WebAssembly（`/src/wasm/compactor/`）
  - Supabase REST API 呼び出し、R2 からのダウンロード、断片抽出、連結、再アップロード、メタデータ更新、旧ファイル削除。
  - 無料枠の制限へ配慮したガードレール（断片数/サイズ上限）。

---

## スケジューリング（Cloudflare Pages Scheduled Functions）

ファイル: `packages/FUSOU-WEB/functions/_scheduled.ts`

- Supabase の `datasets` テーブルを参照し、`compaction_needed=true` のデータセットだけ最大 N 件（`MAX_DATASETS_PER_RUN`）を取得。
- 低並列（`CONCURRENCY=2`）で API `POST /api/compact` を呼び出し、250ms の小休止を挟みつつ順次処理。
- すべての制御値は環境変数で調整可能（`SCHEDULE_CONCURRENCY`, `MAX_DATASETS_PER_RUN`, `SCHEDULE_DELAY_MS`）。
- エラーはログ出力のみ（失敗時は API 側が `compaction_in_progress=false`, `compaction_needed=true` に戻すベストエフォート）。

Cron 設定（Cloudflare Pages 側）例:
- UTC 02:00 毎日（Pages 設定画面からスケジュールを追加）

---

## API 仕様（FUSOU-WEB）

### POST `/api/compact`
- 役割: WASM を呼び出して、指定データセットのテーブル別コンパクションを実行する。
- 入力: `{ "dataset_id": "<uuid>" }`
- 出力（成功）: `{ "status": "success", "message": "Compacted X tables" }`
- 出力（失敗）: `{ "status": "error", "message": "Compaction failed: ..." }`
- 前処理（冪等性）:
  - `datasets.compaction_in_progress=true`
  - `datasets.compaction_needed=false`
- 成功後の更新:
  - `datasets.compaction_in_progress=false`
  - `datasets.last_compacted_at=NOW`
  - `datasets.compaction_needed=false`
- 失敗時の戻し（ベストエフォート）:
  - `datasets.compaction_in_progress=false`
  - `datasets.compaction_needed=true`
 - ログ（JSON 構造化）:
   - 成功: `{ level: 'info', event: 'compact_completed', dataset_id, elapsed_ms }`
   - 失敗: `{ level: 'error', event: 'compact_failed', category, error }`

### GET `/api/compact/trigger`
- 役割: 手動で `POST /api/compact` を呼び出す（`dataset_id` 指定時）。
- パラメータ: `?dataset_id=<uuid>`（省略時はメッセージのみ返す）
- 出力: `202 Accepted`（トリガー受理）
 - 内部で `POST /api/compact` を呼び出すため、同一フローで実行される。

### GET `/api/compact/status`
- 役割: サービス稼働確認用（簡易ヘルスチェック）。

---

## WASM 実装（ガードレール）

ファイル: `packages/FUSOU-WEB/src/wasm/compactor/src/lib.rs`

- `compact_single_dataset(dataset_id, supabase_url, supabase_key, r2_url)`
  - Supabase から `dataset_files` を取得し、`table_name` ごとにグループ化。
  - 各テーブルで断片を抽出し、制限値に達するまで連結（MVP）。
  - R2 に `optimized/{dataset}/{table}-{uuid}.parquet` でアップロード。
  - Supabase の `dataset_files` を新規追加（`is_compacted=true`）、旧ファイルを削除。

- ガードレール（環境変数経由）:
  - `COMPACT_MAX_FRAGMENTS`（デフォルト 8）: 1 テーブルで取り扱う断片数の上限。
  - `COMPACT_MAX_BYTES`（デフォルト 25MB）: 1 テーブルで取り扱う合計バイト数の上限。
 - 動的調整:
   - 断片数が多い場合（例: 20 超）には、断片数上限を減らし、合計サイズ上限も半分程度に自動調整。

- 目的:
  - Cloudflare 無料枠の CPU時間・メモリ制限に収まるように、計算量とメモリ使用量を制限する。

---

## API 側のガード（無料枠対策）

ファイル: `packages/FUSOU-WEB/src/pages/api/compact.ts`

- タイムアウト: `COMPACT_REQ_TIMEOUT_MS`（デフォルト 12,000ms）で WASM 呼び出しを短時間で切る。
- エラー時のフラグ戻し: 失敗時に `compaction_in_progress=false`, `compaction_needed=true` を PATCH。
- 必須の環境変数が無い場合は 500 を返す。

---

## Supabase スキーマ（推奨項目）

`datasets` テーブルへの推奨カラム追加:

- `compaction_in_progress` BOOLEAN NOT NULL DEFAULT false
- `compaction_needed` BOOLEAN NOT NULL DEFAULT false
- `last_compacted_at` TIMESTAMP WITH TIME ZONE NULL

`dataset_files` は既存の構造（`dataset_id`, `table_name`, `file_path`, `start_byte`, `byte_length`, `is_compacted` 等）を利用。

RLS ポリシーは、WASM/API のサービスロール用キーで許可範囲を適切に設定。

---

## 環境変数一覧

必須:
- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `R2_PUBLIC_URL`

推奨（無料枠対策）:
- `COMPACT_MAX_FRAGMENTS`（例: 8〜10）
- `COMPACT_MAX_BYTES`（例: 26214400 = 25MB）
- `COMPACT_REQ_TIMEOUT_MS`（例: 12000）
- `API_BASE`（例: https://your-pages.example.com）
- `MAX_DATASETS_PER_RUN`（例: 10）
 - `SCHEDULE_CONCURRENCY`（例: 2）
 - `SCHEDULE_DELAY_MS`（例: 250）

---

## ビルド & 実行手順

### WASM ビルド
```bash
cd packages/FUSOU-WEB
npm install
npm run build:wasm
```

### ローカル開発
```bash
npm run dev
# 手動トリガー
curl -X POST http://localhost:3000/api/compact \
  -H "Content-Type: application/json" \
  -d '{"dataset_id":"<uuid>"}'
```

### 本番ビルド & デプロイ（Pages）
```bash
npm run build
# Cloudflare Pages のプロジェクトにリンク済みであること
# スケジュールは Pages 側の設定 UI から cron を追加
```

---

## 運用のポイント

- 処理が重いテーブルは分割して複数回に分ける（断片数・サイズ上限により自動分割）。
- 失敗時は `compaction_needed=true` に戻るため、次回スケジュールで再試行される。
- 大規模データが増えた場合は上限値を下げる/上げるなどチューニングする。
- 監視はログ中心（Pages のログ、Supabase の更新履歴）。必要なら外部監視に連携。

---

## 既知の制約と改善案

- Parquet の厳密なスキーママージは未実装（MVP は連結）。将来は DataFusion を用いたスキーマ整合・重複排除の導入を検討。
- WASM のストリーミング処理は簡略化されている。メモリピークを抑えるため、チャンク単位の逐次アップロードの導入を検討。
- R2 へのアップロード URL の署名（SigV4）運用を強化し、公開 URL の直接 PUT を避ける。
 - 署名エンドポイントの雛形（`/api/r2/sign`）を追加済み（現在はスタブ）。本番では SigV4 もしくは R2 バインドによる安全なプロキシに置換する。

---

## Supabase マイグレーションと RLS（追加）

マイグレーションファイルを `docs/sql/compaction/` に追加:
- `0001_add_compaction_flags.sql`: `public.datasets` に `compaction_in_progress`, `compaction_needed`, `last_compacted_at` を追加。
- `0002_compaction_rls_policies.sql`: RLS ポリシーの雛形。組織のロールに合わせて調整してください。

適用手順（検証環境で先に実施）:
```bash
psql "$SUPABASE_DB_URL" -f docs/sql/compaction/0001_add_compaction_flags.sql
psql "$SUPABASE_DB_URL" -f docs/sql/compaction/0002_compaction_rls_policies.sql
```

## R2 署名 API（追加）

- ファイル: `packages/FUSOU-WEB/src/pages/api/r2/sign.ts`
- 現在はスタブ応答を返す。Cloudflare Bindings または安全なプロキシ方式を選定後、SigV4 署名を実装。
- 環境変数: `R2_SIGN_EXPIRES`（署名の有効期限秒）

## サーバー側スキーママージ（追加）

- 新規 Rust クレート: `packages/kc_api/crates/compaction_merge`
- 関数 `merge_parquet_fragments(paths, output_path)` を足がかりに、DataFusion でスキーマ整合・出力書き出しを実装予定。
- 重い処理はサーバー側で実行、WASM はオーケストレーションのみに限定。

## 次のアクション（運用者）

- R2 署名のための Bindings/シークレット提供、またはプロキシ方式の選定。
- Parquet スキーマ契約と進化ルールの確定。
- Supabase マイグレーション適用（dev/stage）と RLS 検証。
- テスト用データセットを用意して DataFusion マージの検証。

---

## 変更履歴（本ブランチ）

- WASM パッケージを `FUSOU-WEB/src/wasm/compactor/` に統合。
- API エンドポイントを作成（`compact.ts`, `compact/trigger.ts`, `status`）。
- Cloudflare Pages の Scheduled Functions 追加（`functions/_scheduled.ts`）。
- 無料枠の制限を考慮したガードレール（断片数/サイズ、タイムアウト）を導入。
- Supabase の冪等フラグ更新ロジックを API に追加。

---

## 付録: 簡易 API テスト例

```bash
# 成功例
curl -X POST https://<your-pages>/api/compact \
  -H "Content-Type: application/json" \
  -d '{"dataset_id":"550e8400-e29b-41d4-a716-446655440000"}'

# 手動トリガー
curl "https://<your-pages>/api/compact/trigger?dataset_id=550e8400-e29b-41d4-a716-446655440000"

# ステータス
curl "https://<your-pages>/api/compact/status"
```
