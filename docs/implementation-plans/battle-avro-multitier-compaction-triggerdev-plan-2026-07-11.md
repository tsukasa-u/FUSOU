# バトルAvro多段コンパクション + Trigger.dev 実行基盤化 実装計画書

- 更新日: 2026-07-11
- 対象: FUSOU-WORKFLOW, FUSOU-WEB, docs, .github
- 目的:
  - hourly に加え、daily / weekly / period-close の多段コンパクションを実装
  - Avro -> Avro のまま dataset_id 境界を保持して再コンパクション
  - Cloudflare Worker のメモリ制約を回避するため、重処理を Trigger.dev 実行に移管
  - data_loader / FUSOU-WEB 表示系を tier 対応し、高速切替を実現

---

## 1. 重要な前提（今回の設計判断）

1. Cloudflare Worker は実行時間をギリギリ回避できても、メモリ上限は回避できない
2. よって「Trigger.dev は司令塔のみ」は不十分
3. 重処理（R2取得、Avro decode/merge、再出力）は Trigger.dev 側で実行する
4. Cloudflare 側は API / 認証 / 軽量メタデータ管理に限定する

この前提で、前回案を全面修正する。

---

## 2. 現状確認（実コード）

1. 現行 heavy 処理は `packages/FUSOU-WORKFLOW/src/cron.ts`
   - Turso buffer -> Avro merge -> R2 put -> D1 index 更新
2. data_loader は `packages/FUSOU-WEB/src/server/routes/data_loader.ts`
   - `block_indexes` を参照し、`download?block_id=` でヘッダ+ブロック再構成
3. battle 表示は `packages/FUSOU-WEB/src/server/routes/battle_data.ts`
   - `/global/records` で `block_indexes` + R2 range + decode
4. Trigger.dev は未導入

---

## 3. 新アーキテクチャ（責務分離の修正版）

## 3.1 役割

1. Trigger.dev
   - スケジュール
   - 実データ処理（heavy）
   - 冪等制御 / 再試行 / 進捗記録
2. Cloudflare (FUSOU-WORKFLOW/FUSOU-WEB)
   - 認証
   - メタデータ API
   - data_loader / 表示 API
   - 軽量な index 更新 API（必要時）
3. D1 / R2
   - D1: コンパクション実行ログ + block index
   - R2: Avro OCF 実体

## 3.2 データフロー

1. Trigger.dev task が D1 から対象 block を列挙
2. Trigger.dev task が R2 から block を範囲取得
3. Trigger.dev task が dataset_id ごとに Avro OCF 再構築
4. Trigger.dev task が新規 tier の Avro を R2 に保存
5. Trigger.dev task が D1 に archived_files / block_indexes / compaction_runs を反映

注記:

1. Cloudflare Worker で Avro merge を実行しない
2. Cloudflare 側 `scheduled()` は最終的に停止

---

## 4. Trigger.dev 実装設計（重処理実行）

## 4.1 新規パッケージ

- 追加: `packages/fusou-compaction-trigger`
- 依存候補:
  - `@trigger.dev/sdk`
  - `zod`
  - `apache-avro` もしくは既存 merge ロジック移植
  - `@aws-sdk/client-s3`（R2 S3互換）
  - D1アクセスは Cloudflare API 経由 or 軽量内部API 経由

## 4.2 タスク一覧

1. `compact-hourly`
   - cron: `5 * * * *`
2. `compact-daily`
   - cron: `20 0 * * *`
3. `compact-weekly`
   - cron: `40 0 * * 1`
4. `detect-period-rollover`
   - cron: `0 */6 * * *`（低頻度運用は `0 */12 * * *`）

## 4.3 period 検知

1. `detect-period-rollover` で最新 open period_tag を取得
2. 直前成功 run（tier=period）の対象 period と比較
3. 変化があれば、閉じた period_tag に対して `compact-period` を起動

## 4.4 Trigger.dev 側のメモリ対策（必須）

1. 1 run で全件一括ロードしない
2. table + period + time window + shard 単位で分割
3. R2 block は逐次取得・逐次マージ
4. 一時バッファはファイル/ストリーム優先
5. 大きい dataset はさらに chunk 化

---

## 5. DB拡張（必要十分、過剰防止）

## 5.1 新規テーブル（最小）

1. `compaction_runs`
   - `id INTEGER PRIMARY KEY`
   - `run_key TEXT NOT NULL UNIQUE`
   - `tier TEXT NOT NULL` (`hourly|daily|weekly|period`)
   - `status TEXT NOT NULL` (`running|completed|failed|skipped`)
   - `period_tag TEXT NOT NULL`
   - `window_start_ms INTEGER NOT NULL`
   - `window_end_ms INTEGER NOT NULL`
   - `triggered_by TEXT NOT NULL` (`triggerdev|manual|backfill`)
   - `source_tier TEXT NOT NULL`
   - `created_at_ms INTEGER NOT NULL`
   - `completed_at_ms INTEGER`
   - `error_message TEXT`

理由:

1. 冪等 run_key が必須
2. 実行監査・再実行判定に必須

## 5.2 既存テーブル拡張

1. `archived_files`
   - `compaction_tier TEXT NOT NULL DEFAULT 'hourly'`
   - `window_start_ms INTEGER`
   - `window_end_ms INTEGER`
   - `source_tier TEXT`
2. `block_indexes`
   - `compaction_tier TEXT NOT NULL DEFAULT 'hourly'`
   - `window_start_ms INTEGER`
   - `window_end_ms INTEGER`
   - `source_file_count INTEGER NOT NULL DEFAULT 1`

理由:

1. tier 指定配信に必須
2. window 指定配信に必須
3. data lineage（どの tier 由来か）に必須

## 5.3 インデックス（最小）

1. `idx_block_tier_period_table`
   - `(compaction_tier, period_tag, table_name, table_version, start_timestamp)`
2. `idx_runs_status_created`
   - `(status, created_at_ms DESC)`

追加しないもの（初期）:

1. `compaction_run_items` テーブル
2. `compaction_control_state` テーブル
3. `archived_files` の tier/window 専用インデックス

---

## 6. API設計（Cloudflare側）

## 6.1 Trigger.dev から叩く内部API

FUSOU-WEB か FUSOU-WORKFLOW に以下を追加（internal token 必須）。

1. `POST /internal/compaction/list-source-blocks`
   - 入力: tier / table / period_tag / window / cursor
   - 出力: block list（id, file_path, start_byte, length, dataset_id, timestamps, table_version）
2. `POST /internal/compaction/register-output`
   - 入力: run metadata + file metadata + block indexes
   - 出力: success/failure
3. `POST /internal/compaction/mark-run`
   - 入力: run_key, status, error

注記:

1. 重処理はこの API の中で実行しない
2. あくまでメタデータ read/write 専用

## 6.2 data_loader 改修

対象: `packages/FUSOU-WEB/src/server/routes/data_loader.ts`

追加クエリ:

1. `tier` (`hourly|daily|weekly|period`)
2. `window`（tierごとの window key）

SQL条件:

1. `block_indexes.compaction_tier = ?`
2. 必要に応じ `window_start_ms/window_end_ms` 条件

互換:

1. tier未指定は `period` をデフォルト
2. `download?block_id=` は維持

## 6.3 battle_data 改修

対象: `packages/FUSOU-WEB/src/server/routes/battle_data.ts`

追加クエリ:

1. `tier`
2. `window`

方針:

1. まず block list を決定
2. block id 由来 ETag を生成
3. ETag hit 時は decode を省略

---

## 7. ローカルAvro表示（クラウド代替）

## 7.1 結論

1. 初期実装は DuckDB 不要
2. ブラウザ decode + 正規化で十分

## 7.2 実装方針

1. UI に datasource 切替（cloud/local）
2. local は File API で Avro を読む
3. decode 結果を既存 battle 表示モデルへ正規化
4. 描画コンポーネントは共通再利用

## 7.3 DuckDB が必要になる条件

1. ローカル巨大データに対する SQL 絞り込みを高頻度で要求
2. 複数Avro横断 JOIN/集約をクライアント内で行う
3. 分析UIで ad-hoc query を提供する

段階導入:

1. Phase A: decode + index in memory
2. Phase B: 不足時のみ duckdb-wasm

---

## 8. 見落とし防止チェック（プラットフォーム特性）

## 8.1 実行基盤

1. Trigger.dev もメモリ無限ではない
2. したがって shard/chunk 設計を必須化
3. 1 run あたり最大対象件数を制限

## 8.2 冪等性

1. `run_key` で二重実行防止
2. `register-output` は UPSERT 前提
3. 同一 run の再実行で重複 index を作らない

## 8.3 競合制御

1. 同 tier / 同 window の同時実行を禁止
2. 実行中 run がある場合は skip or queue

## 8.4 ネットワーク/ストレージ

1. R2 egress / API 回数を監視
2. list-source-blocks はページング対応
3. 失敗時は cursor から再開

## 8.5 セキュリティ

1. internal API は token 必須
2. token は Trigger.dev secret のみ
3. 監査ログに request body 全文を保存しない（PII/secret対策）

---

## 9. 実装ステップ

## Phase 0: 設計固定

1. Trigger.dev heavy 実行を正式採択
2. Cloudflare cron heavy 実行を廃止方針に変更

## Phase 1: DB migration

1. `packages/FUSOU-WEB/migrations/battle-index/0002_add_compaction_runs.sql`
2. `packages/FUSOU-WEB/migrations/battle-index/0003_add_tier_columns_to_archives.sql`
3. ローカル/リモート適用

## Phase 2: Internal API

1. `list-source-blocks`
2. `register-output`
3. `mark-run`

## Phase 3: Trigger.dev compactor

1. task 定義（hourly/daily/weekly/period-detect）
2. Avro merge pipeline 実装（chunk/shard）
3. 進捗/失敗再開実装

## Phase 4: data_loader / battle_data

1. tier/window クエリ導入
2. default tier=period
3. ETag 最適化

## Phase 5: 切替

1. Trigger.dev タスク有効化
2. Cloudflare の heavy cron 停止
3. 監視開始

---

## 10. 検証計画

## 10.1 正しさ

1. dataset_id ごとの件数一致（hourly vs daily, daily vs weekly）
2. period close 後に period tier が生成される
3. block boundary で Avro decode が壊れない

## 10.2 性能

1. Trigger.dev run の max RSS / 実行時間を計測
2. chunk size を調整し OOM 回避
3. API 応答の P50/P95 改善を確認

## 10.3 運用

1. 失敗 run の再開ができる
2. duplicate run でも index 重複がない
3. 6h/12h period 検知遅延が許容範囲

---

## 11. ロールバック

1. Trigger.dev タスク停止
2. 既存 hourly のみ一時復帰
3. API default tier を `hourly` へ切替可能にする（feature flag）
4. 追加カラムは残置（後方互換維持）

---

## 12. 最終結論

1. Cloudflare メモリ制約を回避するには、重処理を Trigger.dev 側へ移すのが必須
2. DB拡張は `compaction_runs` + tier/window 列で必要十分
3. period 検知は 6h（必要なら 12h）で運用可能
4. ローカルAvro表示の初期段階で DuckDB は不要
5. 設計の中心は「重処理移管 + chunk/shard + 冪等制御」である

---

## 13. 環境変数の設定場所（必須）

## 13.1 Trigger.dev 実行側（packages/fusou-compaction-trigger）

（現行ディレクトリ: `packages/fusou-compaction-trigger`）

必須:

1. `TRIGGER_PROJECT_REF`
2. `INTERNAL_COMPACTION_BASE_URL`
3. `INTERNAL_COMPACTION_TOKEN`
4. `R2_BUCKET`
5. `R2_S3_ENDPOINT`
6. `R2_ACCESS_KEY_ID`
7. `R2_SECRET_ACCESS_KEY`

任意:

1. なし

配置:

1. `packages/fusou-compaction-trigger/.env`（ローカル）
2. Trigger.dev dashboard の Environment Secrets（本番）

## 13.2 Cloudflare 側（FUSOU-WEB internal API）

必須:

1. `INTERNAL_COMPACTION_TOKEN`

配置:

1. ローカル開発: `astro dev` で読み込む `.env` / shell env（`getEnv` が参照）
2. Cloudflare Workers Secrets（本番）

備考:

1. このリポジトリは `.dev.vars` を前提にしていない
2. 秘密情報は平文でコミットしない
3. ローカルは `.env` を Git 管理外で運用する

## 13.3 dotenvx 運用（推奨）

1. `packages/fusou-compaction-trigger/.env.example` を元に `.env` を作成
2. ローカル実行時は `dotenvx run -- pnpm --filter fusou-compaction-trigger run trigger:dev`
3. 本番用は `.env.production` などを分離し、`dotenvx run --env-file=.env.production -- pnpm --filter fusou-compaction-trigger run trigger:deploy`

注意:

1. `INTERNAL_COMPACTION_TOKEN` は Trigger.dev 側と Cloudflare 側で同一値にする
2. secret は Git へコミットしない
