# キュー消費問題 - 診断チェックリスト

現在の状態: キューにメッセージが蓄積され、消費されていない

## 実施した修正

✅ `packages/FUSOU-WORKFLOW/src/index.ts` に詳細デバッグログを追加

追加内容:
- Queue Router ハンドラーにログ追加（バッチ受信検出）
- Queue Consumer にバッチ開始/終了ログを追加
- 各メッセージ処理のライフサイクルログを追加
- エラースタックトレースのログ出力を追加
- タイムスタンプをすべてのログに含める

## 次のステップ: 問題の原因特定

### 優先度 1: Cloudflare Dashboard で確認すべき項目

**1. FUSOU-WORKFLOWが消費者として登録されているか**

```
Cloudflare Dashboard
  → Queues
    → dev-kc-compaction-queue
      → Consumers タブ
```

期待結果: 「fusou-workflow」が表示されている

問題の可能性:
- ❌ 何も表示されていない → **FUSOU-WORKFLOW がデプロイされていない**
- ❌ 表示されていても「no recent activity」 → **キューをポーリングできていない**

---

**2. キューにメッセージがあるか**

```
Cloudflare Dashboard
  → Queues
    → dev-kc-compaction-queue
      → Recent Messages タブ
```

期待結果: メッセージが見える

問題の可能性:
- ❌ メッセージがない → **FUSOU-WEB が送信していない**
- ✅ メッセージがある → 消費が滞っている（Step 3へ）

---

**3. FUSOU-WORKFLOWのログを確認**

```
Cloudflare Dashboard
  → Workers
    → fusou-workflow
      → Logs タブ
```

フィルター: 最近1時間

ログがあるか:
- ✅ `[Queue Router] Received batch` → 消費は開始している（Step 4へ）
- ❌ ログがない → ワーカーがアクティブでない（再デプロイが必要）

---

### 優先度 2: 考えられる原因と対策

| 症状 | 考えられる原因 | 対策 |
|-----|--------------|------|
| Consumers タブに fusou-workflow が表示されない | デプロイ不完全 | `cd packages/FUSOU-WORKFLOW && npm run deploy` |
| Recent Messages にメッセージがない | Pages が送信していない | 次項を参照 |
| ログに `[Queue Router] Received batch` が表示されない | バッチ処理がトリガーされていない | wrangler.toml の `max_batch_timeout` を確認。30秒待つか、メッセージ数が10に達するのを待つ |
| ログに `[Queue Consumer] Workflow dispatched` があるが処理が進まない | Workflow エンジンの問題 | DATA_COMPACTION バインディングを確認 |
| `Missing required field: datasetId` エラー | Pages 側でメッセージ形式が不正 | battle_data.ts と compact.ts を確認 |

---

### 優先度 3: FUSOU-WEB 側の確認

ログレベルを上げて確認:

```
Cloudflare Dashboard
  → Pages
    → FUSOU-WEB (プロジェクト名)
      → Deployments → 最新 → Functions Invocations
```

ログを探す:
- `[battle-data] Successfully enqueued to COMPACTION_QUEUE` → ✅ 送信成功
- `[battle-data] FAILED to enqueue to COMPACTION_QUEUE` → ❌ 送信失敗（エラー内容を確認）
- ログがない → エンドポイントが呼ばれていない

---

## デプロイメント手順

詳細ログを有効にするため、以下を実行:

```bash
# FUSOU-WORKFLOW を再デプロイ
cd /home/ogu-h/Documents/GitHub/FUSOU/packages/FUSOU-WORKFLOW
npm run deploy

# デプロイが完了するまで待機（約1-2分）
# その後、テストデータを送信
```

---

## テスト方法

### 1. キューが消費されているか確認

```bash
# Terminal で tail を開いて FUSOU-WORKFLOW のログを監視
cd /home/ogu-h/Documents/GitHub/FUSOU/packages/FUSOU-WORKFLOW
npm run tail
```

このターミナルを開いたまま次に進む。

### 2. テストメッセージを送信

別の Terminal で FUSOU-WEB にテストアップロード:

```bash
# battle-data エンドポイントをテスト
# または compact エンドポイントをテスト
```

### 3. ログで確認

tail ターミナルに以下が表示されるか:

```
[Queue Router] Received batch
[Queue Consumer] ===== BATCH START =====
[Queue Consumer] Processing message
[Queue Consumer] Workflow dispatched successfully
[Queue Consumer] ===== BATCH END =====
```

これらが表示される → **キュー消費は正常に動作している**

これらが表示されない → **Step 1-3 を再確認**

---

## 最も可能性の高い原因 TOP 3

1. **FUSOU-WORKFLOW が Cloudflare にデプロイされていない**
   - 症状: Consumers リストに表示されない
   - 対策: `npm run deploy`

2. **max_batch_timeout による遅延**
   - 症状: メッセージがあるが、30秒以内に10個に達していない
   - 対策: テストで10個以上のメッセージを送信するか、30秒待つ

3. **Workflow dispatch エラー（DATA_COMPACTION バインディングの問題）**
   - 症状: ログに `[Queue Consumer] Workflow dispatched` がない
   - 対策: wrangler.toml の以下を確認
     ```toml
     [[workflows]]
     name = "data-compaction-workflow"
     binding = "DATA_COMPACTION"
     class_name = "DataCompactionWorkflow"
     ```

---

## 参考資料

- [QUEUE_CONSUMER_DEBUG.md](./QUEUE_CONSUMER_DEBUG.md) - 詳細デバッグガイド
- [QUEUE_CONSUMER_MIGRATION.md](./QUEUE_CONSUMER_MIGRATION.md) - アーキテクチャ
- wrangler.toml: `packages/FUSOU-WORKFLOW/wrangler.toml` (L30-42)
