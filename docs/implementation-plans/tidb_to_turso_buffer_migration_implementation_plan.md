# FUSOU-WORKFLOW TiDB -> Turso 移行 実装計画書（無料枠最適化版）

- 更新日: 2026-07-03
- 対象: FUSOU-WORKFLOW と関連ドキュメント
- 目的: TiDB のホットバッファ機能を Turso に移行し、D1 フォールバックを完全撤廃する
- 要求: 追加調査なしで別エージェントが実装を完遂できる粒度

---

## 0. 採択判断（最新公式情報ベース）

### 0.1 参照した最新公式情報（2026-07-03 取得）

1. Neon 公式 Pricing
   - https://neon.com/pricing
   - https://neon.com/docs/introduction/plans
2. Neon 公式 Cloudflare Workers / 接続方式
   - https://neon.com/docs/guides/cloudflare-workers
   - https://neon.com/docs/connect/choose-connection
3. Turso 公式 Pricing
   - https://turso.tech/pricing
4. Turso 公式 TypeScript Quickstart / Reference
   - https://docs.turso.tech/sdk/ts/quickstart
   - https://docs.turso.tech/sdk/ts/reference
5. Turso 公式 制約 / 課金挙動
   - https://docs.turso.tech/cloud/limitations
   - https://docs.turso.tech/help/usage-and-billing
   - https://docs.turso.tech/tursodb/concurrent-writes

### 0.2 無料枠比較（公式値の要約）

Neon Free（公式）:
- Compute: 100 CU-hours / project / month
- Storage: 0.5 GB / project
- Public egress: 5 GB / month
- 超過時: compute 停止、storage 増加系オペレーション失敗

Turso Free（公式）:
- Databases: 100
- Storage: 5 GB
- Monthly rows read: 500 Million
- Monthly rows written: 10 Million
- Monthly syncs: 3 GB
- 超過時: `BLOCKED` エラー

### 0.3 書き込み特性に関する公式情報

- Turso の公式資料では「デフォルトで同時書き込みは 1 writer」、MVCC で並行書き込み可能と説明
- 一方で Turso Cloud の limitations では `PRAGMA journal_mode` がサポートされない
- よって Cloud 上では、MVCC 有効化前提の設計に依存しない（単一 writer を前提に設計）

### 0.4 採択結論

採択: Turso

理由:
1. 無料枠の「実利用可能量」が本件のバッファ用途で最も大きい
   - storage が Neon Free の 10 倍（5 GB vs 0.5 GB）
2. Cloudflare Workers 向けの公式推奨パッケージが明確
   - `@tursodatabase/serverless`（fetch only）
3. D1 フォールバック撤廃を前提に、単一 DB 系へ整理しやすい

注意点:
- 単一 writer 前提を守る実装が必須
- rows written（10M/月）超過リスクを運用監視で管理する

---

## 1. 今回の設計方針（ユーザー要求反映）

### 1.1 必須方針

1. TiDB を Turso に置換
2. D1 フォールバックを完全削除
3. D1 は `archived_files` / `block_indexes` メタデータ用途のみ維持
4. バッファ read/write/cleanup は Turso のみ

### 1.2 禁止事項

1. `fetchBufferedDataWithFallback` のような複数 DB フォールバック分岐
2. hot buffer を D1 に退避するロジック
3. ランタイムで TiDB/Turso/D1 を自動切替する多分岐

---

## 2. 対象範囲

### 2.1 コード

- packages/FUSOU-WORKFLOW/src/db/tidb-client.ts（削除対象）
- packages/FUSOU-WORKFLOW/src/db/index.ts
- packages/FUSOU-WORKFLOW/src/buffer-consumer.ts
- packages/FUSOU-WORKFLOW/src/cron.ts
- packages/FUSOU-WORKFLOW/src/reader.ts
- packages/FUSOU-WORKFLOW/src/index.ts
- packages/FUSOU-WORKFLOW/package.json
- packages/FUSOU-WORKFLOW/wrangler.toml
- packages/FUSOU-WORKFLOW/scripts/migrate-buffer-tidb-to-turso.mjs（新規）
- packages/FUSOU-WORKFLOW/src/db/turso-client.ts（新規）

### 2.2 ドキュメント

- docs/sql/README.md
- docs/architecture/tidb_data_flow.md
- docs/operations/compaction_system.md
- docs/operations/workflow/AVRO_FLOW.md
- docs/operations/workflow/LOCAL_TESTING_GUIDE.md
- docs/implementation-plans/security_implementation_plan.md（TiDB 文言のみ）
- docs/sql/turso/schema.sql（新規）
- docs/sql/turso/migration_0001_create_buffer_tables.sql（新規）
- docs/architecture/turso_data_flow.md（新規）
- docs/operations/workflow/TURSO_CUTOVER_RUNBOOK.md（新規）

---

## 3. 目標アーキテクチャ

```mermaid
flowchart TD
    A[Upload endpoint] --> B[Cloudflare Queue]
    B --> C[Buffer Consumer]
    C --> D[(Turso buffer_logs_active)]

    E[Cron hourly] --> F{processing rows exist?}
    F -- Yes --> G[Process existing processing first]
    F -- No --> H[Swap active <-> processing]
    H --> G

    G --> I[Avro merge + R2 upload]
    I --> J[(D1 archived_files + block_indexes)]
    J --> K[Drop & recreate processing table]

    L[/read] --> M[Hot query from active + processing]
    L --> N[Cold query D1 index -> R2 range]
    M --> O[merge + dedupe]
    N --> O
```

重要:
- D1 fallback は存在しない
- hot buffer の単一ソースは Turso

---

## 4. Turso スキーマ設計

配置:
- docs/sql/turso/schema.sql
- docs/sql/turso/migration_0001_create_buffer_tables.sql

### 4.1 DDL（SQLite/libSQL）

```sql
CREATE TABLE IF NOT EXISTS buffer_logs_active (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  period_tag TEXT NOT NULL DEFAULT 'latest',
  table_version TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  data BLOB NOT NULL,
  uploaded_by TEXT,
  trust_tag TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS buffer_logs_processing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  period_tag TEXT NOT NULL DEFAULT 'latest',
  table_version TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  data BLOB NOT NULL,
  uploaded_by TEXT,
  trust_tag TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_bla_ordering
  ON buffer_logs_active(table_version, table_name, period_tag, dataset_id, id);
CREATE INDEX IF NOT EXISTS idx_bla_hot
  ON buffer_logs_active(dataset_id, table_name, timestamp);

CREATE INDEX IF NOT EXISTS idx_blp_ordering
  ON buffer_logs_processing(table_version, table_name, period_tag, dataset_id, id);
CREATE INDEX IF NOT EXISTS idx_blp_hot
  ON buffer_logs_processing(dataset_id, table_name, timestamp);
```

### 4.2 swap（必須）

```sql
BEGIN IMMEDIATE;
ALTER TABLE buffer_logs_active RENAME TO buffer_logs_swap_tmp;
ALTER TABLE buffer_logs_processing RENAME TO buffer_logs_active;
ALTER TABLE buffer_logs_swap_tmp RENAME TO buffer_logs_processing;
COMMIT;
```

### 4.3 cleanup（DELETE 禁止）

Turso の rows written 課金効率と運用単純化のため、行単位 delete を使わない。

```sql
BEGIN IMMEDIATE;
DROP TABLE IF EXISTS buffer_logs_processing;
CREATE TABLE buffer_logs_processing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  period_tag TEXT NOT NULL DEFAULT 'latest',
  table_version TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  data BLOB NOT NULL,
  uploaded_by TEXT,
  trust_tag TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX idx_blp_ordering
  ON buffer_logs_processing(table_version, table_name, period_tag, dataset_id, id);
CREATE INDEX idx_blp_hot
  ON buffer_logs_processing(dataset_id, table_name, timestamp);
COMMIT;
```

---

## 5. API/クエリ仕様

### 5.1 hot read（reader 用）

```sql
SELECT id, dataset_id, table_name, period_tag, table_version, timestamp, data, uploaded_by, trust_tag
FROM buffer_logs_active
WHERE dataset_id = ? AND table_name = ?
  AND (? IS NULL OR table_version = ?)
  AND (? IS NULL OR timestamp >= ?)
  AND (? IS NULL OR timestamp <= ?)

UNION ALL

SELECT id, dataset_id, table_name, period_tag, table_version, timestamp, data, uploaded_by, trust_tag
FROM buffer_logs_processing
WHERE dataset_id = ? AND table_name = ?
  AND (? IS NULL OR table_version = ?)
  AND (? IS NULL OR timestamp >= ?)
  AND (? IS NULL OR timestamp <= ?)
ORDER BY timestamp ASC, id ASC;
```

### 5.2 snapshot fetch（cron 用）

```sql
SELECT id, dataset_id, table_name, period_tag, table_version, timestamp, data, uploaded_by, trust_tag
FROM buffer_logs_processing
ORDER BY table_version, table_name, period_tag, dataset_id, id ASC;
```

---

## 6. 実装フェーズ

## Phase 0: 基盤追加（Turso client）

実施:
1. `@tursodatabase/serverless` を追加
2. `src/db/turso-client.ts` 新規実装
   - `createTursoConnection()`
   - `bulkInsertActive()`
   - `countProcessingRows()`
   - `swapTables()`
   - `fetchProcessingRows()`
   - `resetProcessingTable()`
   - `fetchHotRows()`
3. 書き込み競合用 retry 実装（busy/conflict を指数バックオフ）

完了条件:
- Turso 単独で最小 CRUD が通る

## Phase 1: DB 層置換（フォールバック削除）

実施:
1. `src/db/index.ts` を Turso 単一路線に変更
2. D1 fallback 関数と source 分岐（tidb/d1/both）を削除
3. `src/db/tidb-client.ts` を未使用化（最終で削除）

完了条件:
- runtime の hot buffer 処理で D1 fallback 分岐が 0

## Phase 2: consumer 置換

実施:
1. `buffer-consumer.ts` を Turso insert に変更
2. D1 fallback ログ文言を削除
3. 失敗時は queue retry のみ

完了条件:
- insert 失敗時に D1 へ退避しない

## Phase 3: cron 置換

実施:
1. `processing` 先行処理ルールを実装
2. 空時のみ swap
3. 成功時のみ `resetProcessingTable()`
4. 失敗時は processing を保持して次回再試行

完了条件:
- DELETE cleanup が存在しない
- swap 後失敗ケースで再 swap しない

## Phase 4: reader 置換

実施:
1. hot query を Turso active+processing UNION に置換
2. cold path（D1 index + R2 range）は維持

完了条件:
- `/read` 結果の互換性確認

## Phase 5: 削除と整理

実施:
1. `@tidbcloud/serverless` 依存削除
2. `src/db/tidb-client.ts` 削除
3. `wrangler.toml` から TiDB secret コメント除去

完了条件:
- TiDB 参照がコード上 0

---

## 7. 環境変数

必須:
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`

削除:
- `TIDB_KC_DB_URL`

明確化:
- `BATTLE_INDEX_DB` は metadata 用（archived_files / block_indexes）として残す
- `BATTLE_INDEX_DB` はフォールバック先ではない

---

## 8. カットオーバー手順（D1 fallback なし）

### 8.1 事前

1. Turso DB 作成
2. Turso schema 適用
3. staging で ingest/cron/read の通し検証

### 8.2 本番切替

1. Queue producer を一時停止（新規流入停止）
2. 既存 TiDB バッファ残を回収
   - 先に cron を実行して可能な限り R2 へアーカイブ
   - 残存行を移送スクリプトで Turso `buffer_logs_active` へ投入
3. Turso secret を設定して deploy
4. Queue producer 再開
5. smoke test

### 8.3 ロールバック

1. 一時的に TiDB 版リリースへ戻す（緊急時のみ）
2. Turso 側データは保持
3. 原因調査後に再切替

注記:
- ロールバック時も D1 fallback は使わない

---

## 9. 監視・無料枠運用

### 9.1 監視対象

1. rows_written（月累積）
2. rows_read（月累積）
3. total storage
4. busy/conflict retry 回数
5. cron 成功率

### 9.2 しきい値（推奨）

1. rows_written 80% 到達でアラート
2. rows_read 80% 到達でアラート
3. storage 80% 到達でアラート

### 9.3 クォータ超過時の挙動

- Turso 公式仕様により、超過クエリは `BLOCKED`
- アプリ側は retry 無限ループしない
- 明示的に障害通知し、手動復旧フローへ移行

---

## 10. 検証計画

### 10.1 静的検証

```bash
cd /home/ogu-h/Documents/GitHub/FUSOU
pnpm --filter fusou-workflow exec tsc --noEmit
pnpm --filter fusou-workflow run test
```

### 10.2 統合検証

1. ingest -> Turso active 増加
2. cron 実行 -> swap -> archive -> resetProcessingTable
3. `/read` で hot+cold マージ整合

### 10.3 失敗系検証

1. R2 upload 失敗
   - processing 保持、reset しない
2. 次回 cron
   - 既存 processing 優先処理
3. Turso busy/conflict
   - retry 後に回復する

### 10.4 D1 fallback 不在検証

1. Turso 停止/認証エラー時に D1 に書き込まれないこと
2. ログに fallback 文言が存在しないこと

---

## 11. 受け入れ基準

1. hot buffer の DB は Turso のみ
2. D1 fallback コードが削除済み
3. TiDB 依存が削除済み
4. cron が processing-first ルールを満たす
5. free-tier 監視アラート運用が定義済み
6. docs が Turso 前提に更新済み

---

## 12. 実装者向けチェックリスト

- [x] 採択判断は最新公式情報を明記
- [x] D1 fallback 廃止を要件化
- [x] 単一 writer 前提の対策を定義
- [x] 無料枠超過時の運用を定義
- [x] カットオーバーとロールバックを定義
- [x] 成功系/失敗系の検証を定義

この計画書の前提を変更する場合は、必ず先に本書を更新すること。
