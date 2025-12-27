# Upload Loop Bug Fix - 異常アップロード繰り返し問題の修正

**日時**: 2025年12月17日  
**ブランチ**: r2_parquet  
**対象**: FUSOU-APP と fusou-upload パッケージ  

## 🔴 問題：port_table同期が無限ループする異常

ユーザーが報告した現象：
- `port_table` をストレージに同期する処理が一度トリガーされた後、**何度も繰り返し実行され続ける**
- Google Drive の認証エラーが発生すると、エラーリカバリが無限ループになる
- pending_store に大量の重複データが溜まる

## 🔍 根本原因分析

### 1️⃣ **Primary Issue: CloudTableStorageProvider.upload_bytes()**

ファイル: `packages/FUSOU-APP/src-tauri/src/storage/providers/cloud_table_provider.rs`  
行番号: 73-86

**問題のコード：**
```rust
let result = self.cloud.upload_file(...).await.map_err(|e| {
    if msg.contains("401") || msg.contains("403") || ... {
        tokio::spawn(async move {
            // ...
            retry.trigger_retry().await;  // ⚠️ 毎回呼ばれる
        });
    }
    StorageError::Operation(msg)
});
```

**何が悪いのか：**
- 認証エラーが発生するたびに **毎回** `retry.trigger_retry()` が呼ばれる
- 同じデータが何度も `pending_store` に登録される
- エラー条件が続く限り、無限にトリガーが発動

### 2️⃣ **Secondary Issue: Duplicate Detection なし**

- 同じ `port_table` データが複数の pending item として登録される
- `retry_service` の重複排除ロジックがない
- pending_store に数百個の同じファイルが溜まる可能性

### 3️⃣ **Tertiary Issue: スケジューラの定期トリガー**

ファイル: `packages/FUSOU-APP/src-tauri/src/scheduler/integrate_file.rs`

- Cron job が定期的に `integrate_port_table()` をトリガー
- 失敗時に毎回新しい retry が spawn される
- `acquire_port_table_guard()` で serial にはなるが、同じファイルが何度も登録される

---

## ✅ 修正内容

### **修正1：CloudTableStorageProvider での重複検出**

**ファイル**: `packages/FUSOU-APP/src-tauri/src/storage/providers/cloud_table_provider.rs`

**変更点:**
1. **Content Hash を計算** - アップロードするデータの SHA-256 ハッシュを生成
2. **既存 pending items をチェック** - 同じ content-hash を持つ item が既に pending_store に存在するかチェック
3. **重複スキップ** - 既に pending されているデータなら新規登録をスキップ
4. **headers に content-hash 記録** - メタデータに hash を保存して後のマッチング用に使用

```rust
// Create a hash of the data to detect duplicates
let data_hash = ... // SHA-256

// Check if already pending
let already_pending = pending_items.iter().any(|item| {
    item.headers.get("content-hash").map(|h| h == &hash).unwrap_or(false)
});

if already_pending {
    tracing::info!("upload already pending, skipping duplicate entry");
} else {
    // Save and trigger retry
}
```

**メリット:**
- 同じファイルが複数登録されない
- pending_store のサイズが制御される
- ネットワーク負荷が軽減される

---

### **修正2：UploadRetryService での重複検出強化**

**ファイル**: `packages/fusou-upload/src/retry_service.rs`

**変更点:**
1. **単一バッチ内での重複排除** - `trigger_retry()` の1実行内で同じ content-hash の item は1回だけ処理
2. **デバッグ情報追加** - already running 状態や重複検出時のログを追加
3. **試行回数をログに記録** - 現在の試行回数と最大試行数を明示

```rust
pub async fn trigger_retry(&self) {
    // ... (既存の is_running チェック)
    
    let mut processed_hashes = std::collections::HashSet::new();
    
    for mut meta in pending_items {
        // Skip if we already retried this content hash in this batch
        if let Some(hash) = meta.headers.get("content-hash") {
            if processed_hashes.contains(hash) {
                tracing::info!("Skipping duplicate retry for content-hash {}", hash);
                continue;
            }
            processed_hashes.insert(hash.clone());
        }
        // ... retry logic
    }
}
```

**メリット:**
- 同じファイルが1バッチで複数回リトライされない
- pending item の処理順が保証される
- ログから重複検出が可視化される

---

### **修正3：スケジューラに並行実行 safeguard を追加**

**ファイル**: `packages/FUSOU-APP/src-tauri/src/storage/integrate.rs`

**変更点:**
1. **グローバル atomic flag** - `INTEGRATION_IN_PROGRESS` フラグで並行実行を防止
2. **スケジューラ重複防止** - Cron job が複数並行で実行されるのを回避
3. **Timeout 追加** - 統合処理が1時間以上かかったら強制終了

```rust
static INTEGRATION_IN_PROGRESS: Lazy<Arc<AtomicBool>> = ...;

pub fn integrate_port_table(...) {
    if INTEGRATION_IN_PROGRESS.compare_exchange(false, true, ...).is_err() {
        tracing::info!("Integration already in progress, skipping");
        return;
    }
    
    // ... work ...
    
    // Timeout: 1 hour max
    match tokio::time::timeout(Duration::from_secs(3600), ...).await {
        Ok(_) => { /* success */ },
        Err(_) => { /* timeout */ }
    }
    
    INTEGRATION_IN_PROGRESS.store(false, Ordering::SeqCst);
}
```

**メリット:**
- Cron job による重複トリガーが完全に排除される
- メモリリークの防止（無限ループ防止）
- Hung process の自動回復

---

## 📊 修正前後の比較

| 状況 | 修正前 | 修正後 |
|------|--------|--------|
| **認証エラー発生時** | trigger_retry() が毎回呼ばれる | 1回のみ、既存pending がチェックされる |
| **pending_store サイズ** | 数百個の重複 item | 1ファイル＝1 item |
| **スケジューラ重複** | 複数 job が並行実行可能 | 1つだけ実行、他はスキップ |
| **ログ記述量** | 多量（冗長） | 適正（デバッグ情報追加） |
| **リトライ回数** | 無限（制限なし） | MAX_ATTEMPTS 回まで |

---

## 🧪 テスト方法

1. **認証エラーをシミュレート**
   ```bash
   # Google Drive API の認証情報を削除または無効化
   # port_table アップロードをトリガー
   ```

2. **pending_store の状態確認**
   ```bash
   ls -la ~/.fusou/pending/  # pending item を確認
   # 修正後：同じコンテンツハッシュで複数 item がないことを確認
   ```

3. **ログ確認**
   ```bash
   # FUSOU-APP のログで以下が記録されることを確認：
   # - "upload already pending for file (hash=...)"
   # - "Skipping duplicate retry for content-hash ..."
   # - "Integration already in progress, skipping this trigger"
   ```

---

## 📝 影響範囲

- **FUSOU-APP**: storage/integrate.rs, storage/providers/cloud_table_provider.rs
- **fusou-upload**: retry_service.rs
- **変更なし**: battle_data upload, R2 upload path, D1 schema

## ⚠️ 後续対応

1. **ログモニタリング** - 本番環境で「duplicate retry」メッセージを監視
2. **pending_store クリーンアップ** - 既存の重複 pending item を削除
3. **設定値の見直し** - `retry.get_max_attempts()` と TTL を確認

---

## 📚 参考資料

- [UploadRetryService 実装](../packages/fusou-upload/src/retry_service.rs)
- [CloudTableStorageProvider 実装](../packages/FUSOU-APP/src-tauri/src/storage/providers/cloud_table_provider.rs)
- [スケジューラ実装](../packages/FUSOU-APP/src-tauri/src/scheduler/integrate_file.rs)
