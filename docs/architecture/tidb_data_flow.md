# TiDB データフロー詳細設計書

> 対象範囲: バトルデータ生成 → TiDB buffer_logs への書き込み / 読み込み / 削除 → R2 アーカイブ

---

## 1. 全体アーキテクチャ概観

```
[FUSOU-APP / ゲームプロキシ]
       │ Avro OCF バイナリ（テーブル別スライス）
       │ POST /battle-data/upload
       ▼
[FUSOU-WEB (Cloudflare Worker)]
  battle_data.ts
       │ バリデーション後 COMPACTION_QUEUE.send()
       ▼
[Cloudflare Queue: COMPACTION_QUEUE]
       │ キューメッセージ（base64 Avro + オフセット情報）
       ▼
[FUSOU-WORKFLOW (Queue Consumer)]
  buffer-consumer.ts
       │ INSERT INTO buffer_logs
       ├──────────────────────────◀─── 【TiDB 書き込み】
       │     (TiDB 障害時: D1 fallback)
       ▼
[TiDB Cloud Serverless: buffer_logs テーブル]
       │
       │（1時間ごと Cron）
       ▼
[FUSOU-WORKFLOW (Cron Worker)]
  cron.ts
       │ SELECT * FROM buffer_logs           ◀─── 【TiDB 読み込み（全件取得）】
       │ グルーピング（table_name × period_tag × dataset_id）
       │ Avro OCF マージ
       │ R2.put() → R2 にアーカイブ
       │ D1: archived_files, block_indexes 登録
       │ DELETE FROM buffer_logs WHERE id <= maxId ◀─── 【TiDB 削除】
       ▼
[Cloudflare R2: Avro OCF アーカイブ]
[Cloudflare D1: archived_files / block_indexes メタデータ]

       ▲ ホットデータ読み込み
       │ SELECT ... FROM buffer_logs WHERE ...  ◀─── 【TiDB 読み込み（条件付き）】
[FUSOU-WORKFLOW (HTTP Reader)]
  reader.ts
  /read エンドポイント
       │ ホット（TiDB buffer_logs）+ コールド（D1→R2 Range Request）をマージ
       ▼
[クライアント（FUSOU-WEB フロントエンド）]
```

---

## 2. フェーズ別詳細

### フェーズ A: バトルデータのアップロード（FUSOU-WEB）

**ファイル:** `packages/FUSOU-WEB/src/server/routes/battle_data.ts`

**トリガー:** FUSOU-APP（または FUSOU-PROXY 経由）が艦これのバトルログを取得し、Avro OCF 形式にシリアライズして HTTP POST 送信する。

**処理内容:**
1. **Stage 1（準備）:** クライアントが `dataset_id`, `table`, `kc_period_tag`, `table_version`, `file_size`, `content_hash`, `table_offsets` などのメタデータを送信。  
   サーバーは署名付きアップロードトークンを返す。
2. **Stage 2（実行）:** クライアントが Avro OCF バイナリ本体を送信（`X-Upload-Token` ヘッダー付き）。  
   サーバーは以下を行う:
   - `table_offsets` に従いバイナリを各テーブルスライスに分割
   - 各スライスの Avro ヘッダー（マジックバイト `0x4F 0x62 0x6A 0x01`）を軽量検証
   - `validateAvroOCFSmart()` でフルデコード検証（スキーマ整合性 / `table_version` 一致）
   - すべてのテーブルを **1 つのキューメッセージ**（バッチ形式）として `COMPACTION_QUEUE.send()` に送信

**キューメッセージ形式（バッチ）:**
```json
{
  "batched": true,
  "datasetId": "user-dataset-id",
  "periodTag": "2026-01",
  "tableVersion": "0.5",
  "triggeredAt": "2026-04-04T10:00:00.000Z",
  "userId": "user-id",
  "payload_base64": "<base64エンコードされた全テーブル連結バイナリ>",
  "table_offsets": [
    { "table_name": "battle", "start_byte": 0, "byte_length": 1234, "record_count": 10 },
    { "table_name": "map_start", "start_byte": 1234, "byte_length": 567 }
  ]
}
```

> **TiDB はこのフェーズに関与しない。** FUSOU-WEB は TiDB を直接参照しない。

---

### フェーズ B: バッファへの書き込み（FUSOU-WORKFLOW Queue Consumer）

**ファイル:** `packages/FUSOU-WORKFLOW/src/buffer-consumer.ts`  
**経由:** `packages/FUSOU-WORKFLOW/src/db/index.ts` → `packages/FUSOU-WORKFLOW/src/db/tidb-client.ts`

**トリガー:** Cloudflare Queue が `COMPACTION_QUEUE` のメッセージを Consumer Worker に配信する（準リアルタイム）。

**処理内容:**
1. キューメッセージを受信
2. バッチメッセージを解析し、`table_offsets` を使ってテーブルごとに Avro バイナリを切り出す
3. 各スライスを軽量ヘッダー検証（多層防御）
4. `insertBufferLogsWithFallback(env, records)` を呼び出してバッファに保存

---

#### 【TiDB 書き込み】`INSERT INTO buffer_logs`

**実行関数:** `insertBufferLog()` in `tidb-client.ts`

**発火条件:** キューメッセージ受信時（バトルデータアップロードの都度）

**SQL:**
```sql
INSERT INTO buffer_logs
  (dataset_id, table_name, period_tag, table_version, timestamp, data, uploaded_by)
VALUES
  (?, ?, ?, ?, ?, ?, ?)
```

**挿入する値:**

| カラム | 内容 | 例 |
|---|---|---|
| `dataset_id` | ユーザーのデータセット識別子 | `"abc123"` |
| `table_name` | 艦これのテーブル名 | `"battle"`, `"map_start"` |
| `period_tag` | 期間タグ（月次） | `"2026-01"` |
| `table_version` | スキーマバージョン | `"0.5"` |
| `timestamp` | アップロード時刻（Unix ms） | `1743753600000` |
| `data` | Avro OCF バイナリ（LONGBLOB） | `<binary>` |
| `uploaded_by` | アップロードユーザーの ID | `"user-id"` |

**1 アップロードにつき N レコード**（N = アップロードに含まれるテーブル数）が挿入される。

**フォールバック挙動:**
- TiDB の接続エラー / レート制限（HTTP 429 または RU 枯渇）が発生した場合、自動的に **Cloudflare D1** の `buffer_logs` テーブルへのバルク INSERT に切り替わる。
- D1 バルク INSERT は 100 件ずつチャンクして発行（D1 クエリサイズ上限対策）。
- **両方とも失敗した場合:** `batch.retryAll()` でキュー全体をリトライ（Cloudflare Queue の再配信）。

---

### フェーズ C: アーカイブ（FUSOU-WORKFLOW Cron）

**ファイル:** `packages/FUSOU-WORKFLOW/src/cron.ts`  
**経由:** `packages/FUSOU-WORKFLOW/src/db/index.ts`

**トリガー:** Cloudflare Cron Trigger（毎時 0 分、`wrangler.toml` で設定）

---

#### 【TiDB 読み込み（全件取得）】`SELECT * FROM buffer_logs`

**発火条件:** 毎時 Cron 起動時

**関数:** `fetchBufferedDataWithFallback(env)` → `fetchBufferedData(conn)`

**SQL:**
```sql
SELECT id, dataset_id, table_name, period_tag, table_version, timestamp, data, uploaded_by
FROM buffer_logs
ORDER BY table_version, table_name, period_tag, dataset_id, id ASC
```

**目的:** 未アーカイブの全 Avro OCF バイナリを取得し、メモリ上でグルーピング・マージする。

**フォールバック挙動:**
- TiDB でエラー（接続障害 / レート制限）が発生した場合、D1 の `buffer_logs` から同等クエリを発行。
- 取得元（`"tidb"` or `"d1"`）を変数 `fetchSource` に記録し、後続の削除処理でどちらを削除するかを決定する。

**Cron 処理フロー（取得後）:**
1. `groupByDataset()`: 取得した行を `table_version :: table_name :: period_tag → dataset_id → rows[]` でグルーピング
2. `mergeAvroOCF() / mergeAvroOCFWithBoundaries()`: 各データセット内の複数 Avro OCF ファイルを 1 つの有効な Avro OCF に結合
3. 複数データセットを最大 128 MB のファイルチャンクにまとめる
4. `R2.put(filePath, combined)`: アーカイブを R2 にアップロード

**R2 ファイルパス形式:**
```
{table_version}/{period_tag}/{run_timestamp}/{table_name}-{fileIndex}.avro
例: 0.5/2026-01/1743753600000/battle-001.avro
```

5. D1 に `archived_files`（ファイルメタデータ）と `block_indexes`（データセット別バイト位置）を登録

---

#### 【TiDB 削除】`DELETE FROM buffer_logs WHERE id <= maxId`

**発火条件:** R2 アーカイブ **成功後**（`archiveSuccess === true` の場合のみ）

**関数:** `cleanupBufferWithFallback(env, maxId, fetchSource)` → `cleanupBuffer(conn, maxId)`

**SQL:**
```sql
DELETE FROM buffer_logs WHERE id <= ?
```

**`maxId`:** 今回のアーカイブで読み込んだ最大の `id`（`Math.max(...rows.map(r => r.id))`）

**削除ロジックの安全設計:**
- `archiveSuccess` フラグが `true` になった場合のみ削除を実行。R2 アップロード失敗 / D1 メタデータ登録失敗時は削除をスキップし、次回 Cron でリトライ。
- `preferredSource` が `"tidb"` の場合（= TiDB からデータを取得した場合）は TiDB の `buffer_logs` を削除。`"d1"` の場合は D1 の `buffer_logs` を削除。
- TiDB 削除で失敗した場合は **D1 にフォールバックして削除**（クロス削除）。

---

### フェーズ D: ホットデータの読み込み（FUSOU-WORKFLOW Reader）

**ファイル:** `packages/FUSOU-WORKFLOW/src/reader.ts`  
**エンドポイント:** `GET /read?dataset_id=...&table_name=...&from=...&to=...`

**トリガー:** クライアント（FUSOU-WEB フロントエンド）からのリクエスト

---

#### 【TiDB 読み込み（条件付き）】`SELECT ... FROM buffer_logs WHERE ...`

**発火条件:** `/read` エンドポイントへのリクエスト時

**関数:** `fetchHotDataWithFallback(env, params)` → `fetchHotData(conn, params)`

**SQL（パラメータに応じて動的生成）:**
```sql
SELECT id, dataset_id, table_name, period_tag, table_version, timestamp, data, uploaded_by
FROM buffer_logs
WHERE dataset_id = ?
  AND table_name = ?
  [AND table_version = ?]   -- table_version 指定時
  [AND timestamp >= ?]       -- from 指定時
  [AND timestamp <= ?]       -- to 指定時
ORDER BY timestamp ASC
```

**目的:** まだ R2 にアーカイブされていない直近のデータ（ホットデータ）を取得し、JSON にデシリアライズする。

**フォールバック挙動のポイント:**
- `TIDB_KC_DB_URL` が設定されている場合、**必ず TiDB に問い合わせる**。
- TiDB が設定されているのに D1 にフォールバックすると、存在するはずのデータが見つからない（TiDB に書き込まれたデータは D1 にはない）ため、D1 へのフォールバックは **TiDB クエリでエラーが発生した場合のみ**。
- `TIDB_KC_DB_URL` が設定されていない場合は D1 を直接参照。

**ホット + コールドのマージ:**
クライアントの時間範囲クエリに応じて以下を並行取得し、統合して返す:
1. **ホット:** TiDB `buffer_logs` からの Avro OCF バイナリ → デシリアライズして JSON レコードに変換
2. **コールド:** D1 `block_indexes` → R2 Range Request (`Range: bytes={start_byte}-{end_byte}`) → Avro OCF パース

---

## 3. TiDB テーブル定義

**テーブル名:** `buffer_logs`  
**DDL ファイル:** `docs/sql/tidb/schema.sql`

```sql
CREATE TABLE IF NOT EXISTS buffer_logs (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  dataset_id    VARCHAR(255) NOT NULL,
  table_name    VARCHAR(255) NOT NULL,
  period_tag    VARCHAR(50)  NOT NULL DEFAULT 'latest',
  table_version VARCHAR(20)  NOT NULL,
  timestamp     BIGINT       NOT NULL,
  data          LONGBLOB     NOT NULL,  -- Avro OCF バイナリ本体
  uploaded_by   VARCHAR(255),
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_buffer_dataset_table (dataset_id, table_name),
  INDEX idx_buffer_timestamp     (timestamp),
  INDEX idx_buffer_period        (period_tag)
);
```

> D1 の `buffer_logs` は同一スキーマを SQLite で実装。型は `BLOB`（MySQL の `LONGBLOB` 相当）。

**マイグレーション履歴:**
- `migration_0001_rename_schema_version.sql`: カラム名 `schema_version` → `table_version` に変更（2026-02-17 適用）

---

## 4. TiDB 操作サマリー

| 操作 | SQL | 発火タイミング | フォールバック | ソースファイル |
|---|---|---|---|---|
| **書き込み** | `INSERT INTO buffer_logs (...)` | バトルデータ受信時（キュー Consumer） | → D1 bulkInsert | `tidb-client.ts: insertBufferLog()` |
| **読み込み（全件）** | `SELECT * FROM buffer_logs ORDER BY ...` | 毎時 Cron 起動時 | → D1 SELECT | `tidb-client.ts: fetchBufferedData()` |
| **読み込み（条件付き）** | `SELECT ... WHERE dataset_id=? AND table_name=?` | `/read` エンドポイント呼び出し時 | → D1 SELECT（TiDB障害時のみ） | `tidb-client.ts: fetchHotData()` |
| **削除** | `DELETE FROM buffer_logs WHERE id <= ?` | Cron による R2 アーカイブ**成功後** | → D1 DELETE | `tidb-client.ts: cleanupBuffer()` |

---

## 5. TiDB ← → D1 フォールバック判定ロジック

```
TIDB_KC_DB_URL が設定されている？
├─ YES → TiDB に接続・実行
│         ├─ 成功 → TiDB の結果を使用
│         └─ 失敗（接続エラー / タイムアウト / rate limit）
│               ├─ rate limit (HTTP 429 or RU 枯渇) → WARN ログ + D1 fallback
│               └─ その他エラー → ERROR ログ + D1 fallback
└─ NO  → D1 を直接使用

【ホットデータ読み込みの特例】
TiDB 設定あり + TiDB 成功 → TiDB のみ参照
TiDB 設定あり + TiDB 失敗 → D1 fallback（データ不整合リスクあり、ログ警告）
TiDB 設定なし             → D1 のみ参照
  ※ 「設定はあるが未クエリ」でのフォールバックは行わない（データが TiDB にしかないため）
```

**レート制限の検出条件:**  
`isRateLimitError()` が以下のいずれかを検出した場合:
- HTTP ステータス `429`
- エラーメッセージが正規表現にマッチ: `too many requests`, `rate.?limit`, `throttl`, `quota.?exceed`, `request.?units?.?exhaust`, `ru.?limit`

**再試行ポリシー（通常エラー）:**  
`executeWithRetry()` が最大 3 回、指数バックオフ（100ms → 200ms → 400ms）でリトライ。リトライ対象は `LOCK_WRITE_CONFLICT`, `connection`, `timeout`。

---

## 6. 環境変数・設定

| 名前 | 設定場所 | 内容 |
|---|---|---|
| `TIDB_KC_DB_URL` | `wrangler secret put TIDB_KC_DB_URL` | TiDB 接続 URL（`mysql://user:pass@host:4000/db`）。未設定の場合は D1 のみ使用 |
| `BATTLE_INDEX_DB` | `wrangler.toml` の `[[d1_databases]]` | D1 データベースバインディング（フォールバック + メタデータ） |
| `BATTLE_DATA_BUCKET` | `wrangler.toml` の `[[r2_buckets]]` | R2 バケットバインディング（アーカイブ保存先） |
| `COMPACTION_QUEUE` | `wrangler.toml` の `[[queues.consumers]]` | Cloudflare Queue バインディング |

---

## 7. データライフサイクル

```
バトルデータ受信
  → TiDB INSERT（バッファ）
    → [~1時間後] Cron: TiDB SELECT（全件取得）
      → R2 アーカイブ作成
        → D1 メタデータ登録（archived_files, block_indexes）
          → TiDB DELETE（バッファクリーンアップ）

ホットデータ（アーカイブ前）: TiDB buffer_logs
コールドデータ（アーカイブ後）: R2（実体）+ D1（インデックス）
```

**「ホット」と「コールド」の境界:**  
Cron の実行周期（毎時）が境界となる。直近 ~1 時間以内に受信したデータは TiDB（ホット）、それ以前は R2（コールド）に存在する。
