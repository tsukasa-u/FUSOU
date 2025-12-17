# R2 Upload から処理完了までの フロー分析と検出された問題

最終更新: $(date)

## 1. 理想的なフロー（DesiredFlow）

```
┌─────────────────────────────────────────────────────────────────┐
│                    ユーザー: クライアント                          │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ FUSOU-WEB (Cloudflare Pages)                                    │
│ POST /battle-data/upload (または compact/upload)                  │
│                                                                  │
│  Step 1: R2 アップロード                                        │
│  ├─ bucket.put(key, buffer) → R2 に Parquet ファイル保存       │
│  ├─ 成功: key, size を取得                                    │
│  └─ 失敗: エラーレスポンス 500 返却                              │
│                                                                  │
│  Step 2: D1 メタデータ記録                                      │
│  ├─ INSERT battle_files (dataset_id, table, period_tag, ...)   │
│  ├─ 成功: uploaded_at を取得                                   │
│  └─ 失敗: エラーレスポンス 500 返却 (R2 は既存)                 │
│                                                                  │
│  Step 3: キューメッセージ送信 ★重要                             │
│  ├─ COMPACTION_QUEUE.send({                                    │
│  │    datasetId,      // 必須                                  │
│  │    triggeredAt,    // ISO8601 時刻文字列                    │
│  │    priority,       // 'realtime' | 'manual' | 'scheduled'  │
│  │    metricId,       // オプション                            │
│  │    table,          // オプション                            │
│  │    periodTag       // オプション                            │
│  │  })                                                         │
│  ├─ 成功: ユーザーに 200 OK 返却                               │
│  └─ 失敗: ログ記録のみ、200 OK返却（アップロード自体は成功）   │
│                                                                  │
│  Step 4: レスポンス返却                                        │
│  └─ { ok: true, key, size, uploaded_at }                       │
└────────────────────────┬────────────────────────────────────────┘
                         │ (非同期)
                         │ queue message
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Cloudflare Queues                                               │
│ Queue: dev-kc-compaction-queue                                  │
│                                                                  │
│ ポーリング: 30秒ごと（最大バッチ 10件）                        │
│                                                                  │
│ 失敗時: dev-kc-compaction-dlq へ移動（最大3リトライ）         │
└────────────────────────┬────────────────────────────────────────┘
                         │ (batched messages)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ FUSOU-WORKFLOW (Cloudflare Worker)                              │
│ Queue Consumer Handler: export const queue = { ... }            │
│                                                                  │
│  Step A: メッセージ抽出                                        │
│  ├─ message.body から CompactionQueueMessage を抽出             │
│  │  {                                                          │
│  │    datasetId,                                              │
│  │    triggeredAt,                                            │
│  │    priority,                                               │
│  │    metricId,                                               │
│  │    table,                                                  │
│  │    periodTag                                               │
│  │  }                                                         │
│  └─ 検証: datasetId が必須                                    │
│                                                                  │
│  Step B: ワークフロー作成・実行                                 │
│  └─ env.DATA_COMPACTION.create({                               │
│       params: {                                                │
│         datasetId,                                             │
│         bucketKey: datasetId,  // bucketKey=datasetId ???      │
│         metricId,                                              │
│         table,                                                 │
│         periodTag                                              │
│       }                                                        │
│     })                                                         │
│                                                                  │
│  Step C: メッセージ確認                                        │
│  ├─ 成功: message.ack() → メッセージ削除                      │
│  └─ 失敗: message.retry() → リトライ（最大3回）               │
└────────────────────────┬────────────────────────────────────────┘
                         │ (workflow dispatched)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ FUSOU-WORKFLOW: DataCompactionWorkflow                          │
│ 実行パラメータ: params (CompactionParams)                      │
│                                                                  │
│  Step 1: validate-dataset                                       │
│  ├─ Supabase: SELECT * FROM datasets WHERE id = datasetId      │
│  ├─ 確認項目:                                                  │
│  │  - compaction_needed フラグ                                 │
│  │  - compaction_in_progress フラグ                            │
│  └─ エラー: 例外発生 → ステップ失敗                            │
│                                                                  │
│  Step 2: list-fragments                                        │
│  ├─ D1: SELECT * FROM battle_files WHERE dataset_id = ...     │
│  ├─ フラグメント検査: オフセットメタデータ検証                  │
│  └─ エラー: フラグメント不足 → ステップ失敗                    │
│                                                                  │
│  Step 3: extract-schema, group, merge                          │
│  ├─ R2 からフラグメント読み込み                               │
│  ├─ Parquet スキーマ抽出                                       │
│  ├─ スキーマ別グループ化                                       │
│  ├─ フラグメント結合（stream merge）                           │
│  ├─ 結合結果を R2 に新規保存                                   │
│  └─ エラー: 処理失敗 → ステップ失敗                            │
│                                                                  │
│  Step 4: update-metadata                                       │
│  ├─ D1 更新:                                                   │
│  │  - battle_files テーブル: フラグメント削除マーク             │
│  │  - datasets テーブル: compaction_needed = false              │
│  │  - datasets テーブル: compaction_in_progress = false        │
│  ├─ Supabase: 処理完了フラグ設定                               │
│  └─ エラー: メタデータ更新失敗 → ワークフロー失敗              │
│                                                                  │
│  ワークフロー完了                                              │
│  └─ compaction_complete: true                                  │
└────────────────────────────────────────────────────────────────┘
                         │ (async result)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 処理結果                                                        │
├─ R2: 統合ファイル作成済み                                      │
├─ D1: メタデータ更新済み                                        │
├─ Supabase: 処理完了フラグ設定済み                              │
└─ 処理完了！                                                     │
└────────────────────────────────────────────────────────────────┘
```

---

## 2. 検出された問題と不整合

### ✓ 【既存設計確認】 bucketKey パラメータについて

**実装状況**: 
```typescript
// queue handler でワークフロー作成時:
const workflowInstance = await env.DATA_COMPACTION.create({
  params: {
    datasetId,
    bucketKey: datasetId,      // datasetId を指定
    metricId,
    table,
    periodTag,
  },
});
```

**設計について**:
- **重要**: ワークフロー内では `bucketKey` パラメータは **実際には使用されていない** ✓
- ワークフロー Step 2 (list-fragments):
  ```typescript
  // D1 から fragments を取得（datasetId で検索）
  SELECT key, size, etag, ... FROM battle_files
  WHERE dataset_id = ? AND "table" = ? AND period_tag = ?
  ```
- R2 ファイルアクセス時:
  ```typescript
  // D1 レコードに保存されている key を直接使用
  const fullFile = await this.env.BATTLE_DATA_BUCKET.get(frag.key);
  //                                                      ^^^^^^^^
  //                                       D1 レコードから取得した完全キー
  ```

**結論**:
- bucketKey は現在 **未使用パラメータ**
- 実際のキーは D1 テーブルの `key` カラムに保存されている
- だから、`${datasetId}/${tableId}` や `${datasetId}/${metricsId}` といった複合キーでも正しく処理される ✓

**ただし問題あり**:
- bucket key パラメータの役割が不明確
- 今後の保守性のために、この使途を文書化すべき
- または、未使用パラメータを削除すべき

---

### ★ 【重大バグ】 problem-1: battle_data/upload に メトリクスレコード がない

**場所**: FUSOU-WEB/src/server/routes/battle_data.ts

**現在の実装**:
```typescript
// battle_data/upload には Supabase へのメトリクス記録がない
// D1 に記録のみ
```

**比較**: compact/upload は Supabase に記録

```typescript
const metricsRecord = await withRetry(async () => {
  const { data, error } = await supabase
    .from('processing_metrics')
    .insert([{
      user_id: userId,
      dataset_id: resolvedDatasetId,
      operation: 'compaction',
      status: 'queued',
      triggered_at: new Date().toISOString(),
    }])
    .select('id')
    .single();
  // ...
  return data.id;
});

// その後、metricId をキューメッセージに含める
await env.COMPACTION_QUEUE.send({
  // ...
  metricId: metricsId,
});
```

**問題点**:
- battle_data/upload は metricId がないため、Supabase の processing_metrics テーブルに記録されない
- ワークフロー内で metricId の有無で異なる処理になる可能性
- 監視・ロギング機能が機能しない可能性

**修正必要**:
1. battle_data/upload で processing_metrics に記録
2. metricId を生成
3. キューメッセージに metricId を含める

**比較表**:

| エンドポイント | datasetId | triggeredAt | priority | metricId | table | periodTag |
|--|--|--|--|--|--|--|
| battle-data/upload | ✓ | ✓ (uploadedAt) | 'realtime' | ❌ | ✓ | ✓ |
| compact/upload | ✓ | ✓ (Date.now) | 'realtime' | ✓ | ✓ | ✓ |
| sanitize-state | ✓ | ✓ (Date.now) | 'manual' | ✓ | ❌ | ❌ |
| trigger-scheduled | ✓ | ✓ (Date.now) | 'scheduled' | ✓ | ❌ | ❌ |

**問題点**:
- battle_data/upload: `metricId` を送っていない
  - 他のエンドポイントは `metricId` を送信
  - ワークフロー内で metricId がない場合の処理が不明確
  
- sanitize-state と trigger-scheduled: `table` を送っていない
  - battle_data/upload と compact/upload は送信
  - ワークフロー内でテーブル情報がない場合の動作が不明確

**期待される動作**:
- すべてのエンドポイントが同一の構造を送信
- またはワークフロー側が欠落フィールドを処理

**修正必要箇所**:
1. battle_data/upload: metricId を送信する必要があるか確認
2. sanitize-state と trigger-scheduled: table, periodTag を送信する必要があるか確認
3. ワークフロー側: 各フィールドの必須/オプション を明確化

---

### ★ 【論理バグ】 problem-3: battle_data/upload のキューメッセージに metricId がない

**場所**: FUSOU-WEB/src/server/routes/battle_data.ts, line ~135

```typescript
await env.runtime.COMPACTION_QUEUE.send({
  datasetId,
  table,
  periodTag,
  priority: "realtime",
  triggeredAt: uploadedAt,
  // ❌ metricId を送っていない
});
```

**比較**: compact/upload は metricId を送信

```typescript
const sendResult = await env.COMPACTION_QUEUE.send({
  datasetId: resolvedDatasetId,
  triggeredAt: new Date().toISOString(),
  priority: 'realtime',
  metricId: metricsId,        // ✓ メトリクスID を含む
  periodTag: periodTag,
  table: tableId,
});
```

**問題点**:
- ワークフロー内で `metricId` を処理metrics.upsert() に使用
- battle_data/upload には metricId がないため、メトリクス記録が漏れる可能性

**影響範囲**:
- パフォーマンス計測漏れ
- 処理監視の盲点

**修正方法**:
1. battle_data/upload で metricId を生成する
2. キューメッセージに含める

---

### ★ 【設計不明】 problem-4: bucketKey の決定ルール がエンドポイント間で異なる

**battle_data/upload**:
```typescript
const bucketKey = `${datasetId}/${tableId}`;
// R2 キー: dataset-123/table-456
```

**compact/upload**:
```typescript
const bucketKey = `${resolvedDatasetId}/${metricsId}`;
// R2 キー: dataset-123/metrics-789
```

**trigger-scheduled**:
```typescript
// キューメッセージに bucketKey を含めない
// ワークフロー内で bucketKey = datasetId に固定
```

**問題点**:
- エンドポイントごとに R2 キー構造が異なる
- ワークフロー側が単一の bucketKey = datasetId で処理
- **結果**: 複合キー（dataset + table/metrics）を単一キー (dataset) で検索 → 失敗

**期待される動作**:
1. R2 キー構造を統一する、または
2. ワークフロー側が複合キー構造に対応する

**現在の設計の推測**:
- battle_data/upload: 単一テーブルのみ → `dataset/table` 
- compact/upload: 複数メトリクス → `dataset/metrics-id`
- 統合処理: すべてのテーブル/メトリクス → `dataset/` 配下の全ファイル

**修正戦略**:
1. ワークフロー側で異なる bucketKey パターンに対応
2. または、R2 キー構造を統一

---

### ★ 【機能ギャップ】 problem-5: battle_data/upload から metricId がない

**現在**:
```typescript
// battle_data/upload には metrics テーブル操作がない
// ワークフロー内で metricId がないと、metrics.upsert() が実行されない可能性
```

**期待される動作**:
- battle_data/upload でも metrics テーブルにレコード記録
- metricId を生成してキューメッセージに含める

**比較**: compact/upload では正しく実装

```typescript
const metricsRecord = await withRetry(async () => {
  const { data, error } = await supabase
    .from('processing_metrics')
    .insert([{
      user_id: userId,
      dataset_id: resolvedDatasetId,
      operation: 'compaction',
      status: 'queued',
      triggered_at: new Date().toISOString(),
    }])
    .select('id')
    .single();
  // ...
  return data.id;
});

const metricsId = metricsRecord;
// ...
await env.COMPACTION_QUEUE.send({
  // ...
  metricId: metricsId,
});
```

---

### 【設計不明】 problem-6: DataCompactionWorkflow の bucketKey パラメータ

**定義**:
```typescript
interface CompactionParams {
  datasetId: string;
  bucketKey: string;        // ← これは何?
  table?: string;
  periodTag?: string;
  metricId?: string;
}
```

**使用箇所**: ワークフロー内で使用されていない可能性

```typescript
async run(event: any, step: WorkflowStep) {
  const { datasetId, bucketKey, metricId, table, periodTag } = event.params;
  // bucketKey は受け取るが、コード内で使用されていない?
```

**問題点**:
- bucketKey の役割が不明確
- コード内で実際に使用されているか確認必要

---

## 3. コード品質の問題

### problem-7: エラーハンドリングの不整合

**battle_data/upload**:
```typescript
// R2 失敗 → 500 エラー返却 ✓
// D1 失敗 → 500 エラー返却 ✓
// キュー失敗 → ログのみ、200 OK 返却 ✓ (正しい)
```

**compact/upload**:
```typescript
// 各ステップで try-catch
// ただし、キュー失敗時の動作が詳細に記録 ✓
```

**trigger-scheduled**:
```typescript
// バッチ処理で promise.all で並列実行
// 個別失敗時の対応 ✓
```

**統一性**:
- 基本的にはできている
- ただし、ログレベルと詳細さが異なる

---

### problem-8: ログの詳細さと検証性

**battle_data/upload**:
```typescript
// キューメッセージ送信の前後で詳細ログ ✓
console.info("[battle_data] Enqueueing to COMPACTION_QUEUE", {...});
console.info("[battle_data] Successfully enqueued to COMPACTION_QUEUE");
```

**compact/upload**:
```typescript
console.debug(`[Upload API] Calling env.COMPACTION_QUEUE.send()...`);
const sendResult = await env.COMPACTION_QUEUE.send({...});
console.debug(`[Upload API] Queue send result:`, { sendResult });
```

**Sanitize-state**:
```typescript
console.debug(`[Sanitize State API] Calling env.COMPACTION_QUEUE.send()...`);
const sendResult = await env.COMPACTION_QUEUE.send({...});
console.debug(`[Sanitize State API] Queue send result:`, { sendResult });
```

**問題**:
- battle_data/upload は `info` レベル
- その他は `debug` レベル
- ログレベルが統一されていない

---

## 4. 検証すべき項目

### ワークフロー内の処理確認

- [ ] Step 1 (validate-dataset): compaction_needed, compaction_in_progress の確認
- [ ] Step 2 (list-fragments): フラグメント取得ロジック
- [ ] Step 3 (merge): Parquet マージ処理
- [ ] Step 4 (update-metadata): D1 / Supabase 更新ロジック
- [ ] エラー時: DLQ メッセージ処理

### D1 テーブルスキーマの確認

- [ ] battle_files テーブル: dataset_id, table, period_tag カラムの存在
- [ ] datasets テーブル: compaction_needed, compaction_in_progress フラグの存在
- [ ] 外部キー制約

### R2 キー構造の確認

- [ ] battle_data/upload: `${datasetId}/${tableId}` 形式で保存されるか
- [ ] compact/upload: `${datasetId}/${metricsId}` 形式で保存されるか
- [ ] ワークフロー側: どのキー構造に対応しているか

---

## 5. 修正計画

### 優先度1: 致命的バグ修正

#### 1-1. bucketKey 問題の解決
- [ ] ワークフロー側で正しい bucketKey を構築
- [ ] battle_data/upload: R2キー形式を明確化
- [ ] compact/upload: R2キー形式を明確化

#### 1-2. metricId 一貫性
- [ ] battle_data/upload に metrics テーブルレコード追加
- [ ] すべてのエンドポイントから metricId を送信

### 優先度2: 不整合の統一

#### 2-1. キューメッセージ構造の統一
- [ ] すべてのエンドポイントで同じフィールドを送信
- [ ] 必須フィールド明記: datasetId, triggeredAt
- [ ] オプションフィールド明記: metricId, table, periodTag, priority

#### 2-2. ログレベルの統一
- [ ] queue 送信: すべて `info` レベル
- [ ] エラー: すべて `error` レベル
- [ ] debug: デバッグ情報のみ

### 優先度3: 設計ドキュメント

#### 3-1. R2 キー構造の決定
- [ ] 統一キー構造を決定
- [ ] 複合キーは `datasetId/table/periodTag` か `datasetId/metricsId` か明確化

#### 3-2. CompactionQueueMessage インターフェース
- [ ] 必須フィールド明記
- [ ] オプションフィールド明記
- [ ] 例: 各エンドポイントからの送信例を記載

#### 3-3. DataCompactionWorkflow の パラメータ
- [ ] bucketKey の役割を明確化
- [ ] CompactionParams の定義を整理

---

## 6. 直近の修正プラン

### フェーズ1: 情報収集（現在実施中）

- [x] battle_data/upload の実装確認
- [x] compact/upload の実装確認
- [x] trigger-scheduled の実装確認
- [x] ワークフロー queue handler の実装確認
- [x] キューメッセージ構造の比較
- [ ] D1 テーブルスキーマの確認
- [ ] ワークフロー内の bucketKey 使用状況確認
- [ ] R2 キー形式の実装確認

### フェーズ2: バグ修正

1. bucketKey 問題の解決
2. battle_data/upload の metricId 追加
3. キューメッセージ構造の統一

### フェーズ3: テスト

1. 各エンドポイントからのアップロード実行
2. キューメッセージ送信確認
3. ワークフロー実行確認
4. 最終結果の検証

---

## 付録: 現在の実装状況サマリー

### 送信元エンドポイント

| エンドポイント | R2キー | メトリクス記録 | キュー送信 | 状態 |
|--|--|--|--|--|
| POST /battle-data/upload | ✓ 複合キー（dataset/table/...） | ❌ 未実装 | ✓（2024年11月25日追加） | ⚠️ 不完全（metricId未送信） |
| POST /compact/upload | ✓ 複合キー（dataset/metricsId） | ✓ | ✓ | ✓ ほぼ完全 |
| POST /sanitize-state | N/A（D1全体処理） | ✓ | ✓ | ✓ 完全 |
| POST /trigger-scheduled | N/A（バッチ処理） | ✓ | ✓ | ✓ 完全 |

### ワークフロー処理

| ステップ | 実装 | 状態 |
|--|--|--|
| queue handler (メッセージ受信) | ✓ | ✓ 完全 |
| ワークフロー作成・実行 | ✓ | ✓ 完全（bucketKey は実際に使用されていない） |
| Step 1: validate-dataset | ✓ | ✓ 完全 |
| Step 2: list-fragments | ✓ datasetId で検索、D1 から key を取得 | ✓ 完全 |
| Step 3: merge | ✓ D1 key でアクセス | ✓ 完全 |
| Step 4: update-metadata | ✓ | ⚠️ metricId 未設定時の動作確認必要 |
| DLQ handler | ✓ | ✓ 完全 |

---

## 重要な発見

### ✓ R2 キー管理の設計は **正しい**

**なぜうまくいくのか**:
1. battle_data/upload が R2 に保存時、複合キー生成:
   ```
   battle_data/{datasetId}/{table}/{timestamp}-{uuid}.parquet
   ```

2. D1 のbattle_files テーブルに記録:
   ```
   key = 'battle_data/dataset-123/battles/20241125120000-abc-123.parquet'
   dataset_id = 'dataset-123'
   table = 'battles'
   period_tag = '2024-11-25'
   ```

3. ワークフロー Step 2 で D1 からキーを取得:
   ```typescript
   const fragments = SELECT key FROM battle_files WHERE dataset_id = ?
   // key = 'battle_data/dataset-123/battles/20241125120000-abc-123.parquet'
   ```

4. Step 3 で D1 key を直接 R2 アクセスに使用:
   ```typescript
   const fullFile = await this.env.BATTLE_DATA_BUCKET.get(frag.key);
   ```

**結論**: bucketKey パラメータは **レガシーコード**で、実際には不要。削除可能。

---

## 確定した修正項目

### 【優先度A - 緊急】

1. **battle_data/upload に processing_metrics 記録を追加**
   - Supabase の processing_metrics テーブルに INSERT
   - metricId を取得
   - キューメッセージに metricId を含める
   - ワークフロー側で metricId ベースの記録が正しく動作するようにする

### 【優先度B - 重要】

2. **ワークフロー Step 4 内の metricId 処理を検証**
   - metricId がない場合（battle_data/upload 現在）の処理を確認
   - metrics テーブル更新で metricId が必須か確認

3. **ログレベルの統一**
   - すべてのエンドポイントで queue 送信を `info` レベルに統一

### 【優先度C - 将来】

4. **bucketKey パラメータの削除またはドキュメント化**
   - 現在未使用
   - 削除するか、用途を明確化する

---

## 次のステップ（優先順序）

1. [x] フロー全体の設計確認
2. [x] R2キー管理メカニズムの検証
3. [ ] **battle_data/upload に processing_metrics 記録追加** ← 次にこれを実装
4. [ ] ワークフロー Step 4 の metricId 処理確認
5. [ ] E2E テスト実行
