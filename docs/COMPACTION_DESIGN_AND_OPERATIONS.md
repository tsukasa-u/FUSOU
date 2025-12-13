# FUSOU データセットコンパクション設計・実装・運用ドキュメント

最終更新: 2025-12-13 / ブランチ: `r2_parquet`

本ドキュメントは、Cloudflare Pages + WASM による Parquet コンパクションの設計、実装内容、運用方法、無料枠制限を踏まえたチューニング指針を詳細にまとめたものです。

---

## 1. 背景と目的

- FUSOU はユーザーのアップロードした各テーブルのデータを **raw 連結バイナリ**（各テーブルの Parquet 断片を連結）として R2 に保存します。
- 後段の分析や配信効率のため、テーブル単位で **最適化ファイル（optimized Parquet）** に再編成（コンパクション）します。
- コンパクションは **Cloudflare Pages Functions**（サーバレス環境）上で **WASM** を用いて実行し、Supabase メタデータを参照・更新します。

---

## 2. コンポーネント構成

### 2.1 FUSOU-WEB（Astro + Cloudflare Pages）

- `src/pages/api/compact.ts`:
  - API ハンドラー。
  - リクエスト検証、WASM 呼び出し、Supabase メタデータ更新（冪等性フラグ）を担当。
  - 無料枠リソース制限対策のガードレール（タイムアウト、サイズ上限等）を適用。

- `src/pages/api/compact/trigger.ts`:
  - 手動トリガー用エンドポイント。
  - 内部で `POST /api/compact` を呼び出すことで、統一されたフローを維持。

- `src/wasm/compactor/`:
  - Rust WASM 実装。
  - Supabase からメタデータ取得、R2 からの raw ファイルダウンロード、断片抽出、断片連結、R2 への最適化ファイルアップロード、旧ファイル削除などのロジック。
  - 無料枠制限に配慮した **テーブル単位の断片数/サイズ制限** を適用。

- `functions/_scheduled.ts`:
  - Cloudflare Pages の Scheduled Functions で定期実行。
  - Supabase の対象データセット一覧を取得し、低並列で順次 `POST /api/compact` を呼び出す。

### 2.2 Supabase（PostgreSQL + REST）

- テーブル例: `datasets`, `dataset_files`
- フラグ例:
  - `datasets.compaction_in_progress`（boolean）
  - `datasets.compaction_needed`（boolean）
  - `datasets.last_compacted_at`（timestamp）

### 2.3 Cloudflare R2

- S3 互換ストレージ。
- 保存構造例:
  - `raw/{dataset_id}/{uuid}.bin`（テーブル断片連結バイナリ）
  - `optimized/{dataset_id}/{table_name}-{uuid}.parquet`（最適化済みテーブルファイル）

---

## 3. 実装詳細

### 3.1 API ハンドラー（`src/pages/api/compact.ts`）

- リクエスト検証:
  - `dataset_id`（必須、string）
- 環境変数（必須）:
  - `PUBLIC_SUPABASE_URL`
  - `PUBLIC_SUPABASE_ANON_KEY`
  - `R2_PUBLIC_URL`
- ガードレール（推奨）:
  - `COMPACT_MAX_FRAGMENTS`（テーブルごとの断片数上限、デフォルト: 8）
  - `COMPACT_MAX_BYTES`（テーブルごとの合計サイズ上限、デフォルト: 25MB）
  - `COMPACT_REQ_TIMEOUT_MS`（WASM 実行のラップタイムアウト、デフォルト: 12,000ms）
- Supabase 冪等性更新フロー:
  1. 実行前に `compaction_in_progress=true`, `compaction_needed=false` を PATCH。
  2. 成功後に `compaction_in_progress=false`, `last_compacted_at=now`, `compaction_needed=false` を PATCH。
  3. 失敗時は best-effort で `compaction_in_progress=false`, `compaction_needed=true` を復帰。
- WASM 呼び出し:
  - `import('@/wasm/compactor/pkg/fusou_compactor_wasm.js')` から `compact_single_dataset()` を取得・実行。
  - タイムアウトを `AbortController` でラップ。

### 3.2 WASM 実装（`src/wasm/compactor/src/lib.rs`）

- 主関数: `compact_single_dataset(dataset_id, supabase_url, supabase_key, r2_url)`
- Supabase から `dataset_files` のメタデータ JSON を取得。
- `table_name` 単位にグループ化し、各グループをコンパクション。
- 断片抽出: raw バイナリから `start_byte`, `byte_length` を用いてスライス。
- マージ: MVP として断片連結（将来的に DataFusion によるスキーマ整合や重複排除へ拡張）。
- R2 へのアップロード: `optimized/{dataset}/{table}-{uuid}.parquet` に PUT。
- Supabase メタデータ更新: 新規ファイルを登録（API 側ハンドラーが datasets フラグを更新）。
- 旧 raw ファイル削除: 後方互換性とコスト削減のため削除。
- ガードレール:
  - `COMPACT_MAX_FRAGMENTS` と `COMPACT_MAX_BYTES` を環境（`js_sys::global()` 経由）から読み取り適用。
  - 断片数や合計サイズが閾値を超える前に処理を切り上げ、次回へ分割。

### 3.3 スケジュール実行（`functions/_scheduled.ts`）

- `fetchPendingDatasets()`:
  - Supabase の `datasets` から `compaction_needed=true` のレコードを REST で取得。
  - 取得上限は `MAX_DATASETS_PER_RUN`（デフォルト: 10）。
- `triggerCompaction(datasetId)`:
  - `POST /api/compact` を呼び出し、1 データセット単位で実行。
- 実行設計:
  - `CONCURRENCY=2` の低並列でトリガー（無料枠の CPU/メモリを考慮）。
  - 連続呼び出しに 250ms の待機を挟み、負荷を平滑化。

---

## 4. 無料枠制限と対策

Cloudflare の無料枠は変更される可能性があるため、**最新の制限はダッシュボードと公式ドキュメント**をご参照ください。設計上の一般的な考慮事項と対策は以下の通りです。

- CPU時間（計算時間）:
  - 断片数・合計サイズの上限で計算量を抑制。
  - 連結のみの MVP として、圧縮/デコード/複雑な集約は避ける。
- 壁時計時間（タイムアウト）:
  - API 側で短いタイムアウト（`COMPACT_REQ_TIMEOUT_MS`）を設定。
  - I/O は短いタイムアウト＋リトライで外部待ちを削減。
- メモリ:
  - 1 テーブル当たりの断片数・合計サイズを制限。
  - 将来的にはストリーミング/チャンクアップロードの導入で常駐メモリを低減。
- 同時実行:
  - `CONCURRENCY=2` とし、過剰な同時処理を避ける。

---

## 5. 環境変数一覧

必須:
- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `R2_PUBLIC_URL`

推奨（ガードレール）:
- `COMPACT_MAX_FRAGMENTS`（例: 8〜10）
- `COMPACT_MAX_BYTES`（例: 26214400 = 25MB）
- `COMPACT_REQ_TIMEOUT_MS`（例: 12000）
- `API_BASE`（例: Cloudflare Pages の公開ベース URL）
- `MAX_DATASETS_PER_RUN`（例: 10）

---

## 6. 実行手順（ローカル/本番）

### 6.1 ローカルでの確認

WASM ビルド:
```bash
cd packages/FUSOU-WEB
npm install
npm run build:wasm
```

開発サーバー起動 & API テスト:
```bash
npm run dev
curl -X POST http://localhost:3000/api/compact -H "Content-Type: application/json" -d '{"dataset_id":"<uuid>"}'
curl "http://localhost:3000/api/compact/trigger?dataset_id=<uuid>"
```

### 6.2 本番デプロイ（Cloudflare Pages）

```bash
cd packages/FUSOU-WEB
npm run build
# Cloudflare Pages の CI/CD もしくは wrangler を使用
# wrangler publish（Workers を併用する場合）
```

Scheduled Functions は Pages プロジェクト設定で有効化し、`functions/_scheduled.ts` が反映されることを確認します。

---

## 7. データフロー

1. ユーザーアップロード（FUSOU-APP → `fusou-upload`）
   - raw 連結バイナリを R2 に保存
   - Supabase に `dataset_files` メタデータを登録
2. 定期/手動コンパクション（FUSOU-WEB）
   - API（または Scheduled）でテーブル別に断片抽出・連結
   - optimized Parquet を R2 に保存
   - Supabase メタデータと `datasets` フラグを更新
   - 旧 raw ファイルを削除

---

## 8. 拡張計画（ロードマップ）

- DataFusion SQL による本格的な Parquet マージ（スキーマ整合、重複排除）
- ストリーミング／チャンクアップロードによるメモリ削減
- 失敗時のリトライ戦略（指数バックオフ）
- メトリクス/ログ強化（処理時間、サイズ、成功率）
- Supabase 側の RLS と冪等性ロック強化（Advisory Lock 等）

---

## 9. トラブルシューティング

- WASM ビルド失敗:
  - `rustup target add wasm32-unknown-unknown`
  - `Cargo.toml` の `[lib] crate-type = ["cdylib"]` を確認
- API 404/500:
  - `src/pages/api/` 配下のファイルが正しい位置にあるか確認
  - `.env` の必須変数が設定されているか確認
- タイムアウト多発:
  - `COMPACT_MAX_FRAGMENTS` と `COMPACT_MAX_BYTES` を下げる
  - `COMPACT_REQ_TIMEOUT_MS` を短く、I/Oリトライを適宜調整
- メモリ不足（OOM）:
  - 合計サイズを小さくし、断片数も減らす
  - 将来的にストリーミング処理へ移行

---

## 10. 付録: 主要ファイルパス

- API: `packages/FUSOU-WEB/src/pages/api/compact.ts`
- 手動トリガー: `packages/FUSOU-WEB/src/pages/api/compact/trigger.ts`
- WASM: `packages/FUSOU-WEB/src/wasm/compactor/src/lib.rs`
- Scheduled: `packages/FUSOU-WEB/functions/_scheduled.ts`

---

本ドキュメントの内容に沿って、無料枠の制限に配慮した安全な運用が可能です。ご不明点や追加要件があれば、強化版の実装（DataFusion マージ、ストリーミング化、冪等性ロックの強化等）をご提案・実装します。
