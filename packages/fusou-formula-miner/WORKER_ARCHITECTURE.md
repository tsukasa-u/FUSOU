# Formula Miner - 分離型アーキテクチャ移行ガイド

## 概要

本更新により、TUI（ターミナルユーザーインターフェース）と計算ワーカーを分離しました。

### 課題
- TUIで計算を実行するとブロッキングが発生し、UI応答性が低下
- ターミナルクローズで計算が強制終了される

### 解決策
- **ワーカーバイナリ化**: 計算をスタンドアロン実行可能なワーカー（`worker`）に分離
- **バックグラウンド実行**: TUIからサブプロセスとしてワーカーを起動
- **結果永続化**: JSON ファイルでの結果保存で、UI から非同期で結果を取得
- **グレースフルシャットダウン**: SIGINT/SIGTERM ハンドリングで安全に処理を中断

## アーキテクチャ

```
┌─────────────────────────────────┐
│   TUI (formula-miner binary)    │
│  - ユーザー入力受け付け          │
│  - UI 描画・状態管理             │
│  - ワーカープロセス起動・監視    │
└──────────────┬──────────────────┘
               │ spawn
               ↓
┌─────────────────────────────────┐
│  Worker (worker binary)          │
│  - Genetic Algorithm実行         │
│  - Feature Selection             │
│  - SIGINT/SIGTERM ハンドリング   │
│  - 結果JSON出力                  │
└──────────────┬──────────────────┘
               │ writes
               ↓
      worker_results/
      ├── result.json
      └── checkpoint.json (optional)
```

## ファイル構成

### 新規追加
- `src/bin/worker.rs` - スタンドアロンワーカーバイナリ
- `src/worker_mgmt.rs` - ワーカー管理（プロセス起動、結果ファイル I/O）

### 修正
- `src/state.rs` - ワーカープロセス ID、結果ディレクトリ等のフィールド追加
- `src/lib.rs` - `worker_mgmt` モジュール追加
- `Cargo.toml` - `ctrlc` 依存関係追加

## ワーカーバイナリの使用方法

### 直接実行
```bash
# 合成データを使用してローカルで実行
./target/release/worker <worker-uuid> <results-directory>

# 例
./target/release/worker 550e8400-e29b-41d4-a716-446655440000 ./my_results
```

### TUI からの起動（将来実装予定）
```rust
// TUI main.rs での使用例（疑似コード）
let worker_dir = PathBuf::from("./worker_results");
fs::create_dir_all(&worker_dir)?;

let child = std::process::Command::new("./target/release/worker")
    .arg(state.worker_id.to_string())
    .arg(&worker_dir)
    .spawn()?;

state.worker_process_id = child.id();
state.worker_results_dir = Some(worker_dir);
```

## 計算処理の流れ

1. **UI で計算開始を指示**
   - ワーカーディレクトリを作成
   - ワーカープロセスをスポーン

2. **ワーカープロセス実行**
   - ジョブデータ取得（サーバーまたは合成）
   - 前処理（フィーチャー選択）
   - Genetic Algorithm 実行
   - `result.json` に出力

3. **UI が定期的に結果をポーリング**
   - `result.json` の存在確認
   - 存在すれば、UI に反映
   - ワーカープロセスの終了を検出

4. **シャットダウン**
   - UI 終了時にワーカープロセスに SIGTERM 送信
   - ワーカーは SIGINT ハンドラで `checkpoint.json` を保存
   - 次回起動時に復帰可能

## 信号ハンドリング

### ワーカー（worker.rs）
```rust
ctrlc::set_handler(move || {
    eprintln!("\n[Worker] SIGINT received - initiating graceful shutdown");
    shutdown.store(true, AtomicOrdering::SeqCst);
});
```

- SIGINT (Ctrl+C) で `shutdown` フラグを立てる
- メインループが検出して最終状態を保存して終了

### UI（main.rs）（実装予定）
```rust
// TUI 終了時
if let Some(pid) = state.worker_process_id {
    nix::sys::signal::kill(
        nix::unistd::Pid::from_raw(pid as i32),
        nix::sys::signal::Signal::SIGTERM,
    ).ok();
}
```

## 結果ファイル フォーマット

`result.json`:
```json
{
  "worker_id": "550e8400-e29b-41d4-a716-446655440000",
  "job_id": "00000000-0000-0000-0000-000000000000",
  "expression": "(x1 + x2) * sin(x3)",
  "error": 0.00245,
  "generation": 5234,
  "features": ["x1", "x2", "x3"],
  "duration_ms": 123456,
  "timestamp": "2025-12-05T10:30:45.123456+09:00"
}
```

## テスト方法

### ワーカー単体テスト
```bash
cd packages/fusou-formula-miner

# ワーカーをビルド
cargo build --bin worker

# 実行
export RUST_LOG=debug
mkdir -p /tmp/worker_test
./target/debug/worker 550e8400-e29b-41d4-a716-446655440000 /tmp/worker_test

# 結果確認
cat /tmp/worker_test/result.json | jq .
```

### ワーカー シャットダウンテスト
```bash
# ターミナル 1: ワーカー実行
./target/debug/worker $(uuidgen) /tmp/worker_test

# ターミナル 2: 計算中に Ctrl+C
# ターミナル 1 を Ctrl+C で停止

# 確認: checkpoint.json が作成されているか
ls /tmp/worker_test/
```

## ロードマップ

### Phase 1 (完了)
- ✅ ワーカーバイナリ実装
- ✅ SIGINT ハンドリング
- ✅ 結果 JSON 出力

### Phase 2 (実装予定)
- TUI がワーカープロセス起動・監視
- 結果ファイルポーリング機構
- 計算途中での停止・再開機能

### Phase 3 (検討中)
- 複数ワーカーの並列実行
- 分散処理対応
- 永続化されたチェックポイントからの自動復帰

## トラブルシューティング

### ワーカーが起動しない
```
[Worker] Failed to connect: [error]. Using synthetic dataset.
```
→ サーバーが起動していない場合、合成データで自動フォールバック

### 計算が遅い
- ログレベルを上げているか確認: `RUST_LOG=info`
- 合成データの場合は 10,000 生成が最大世代数

### プロセスが残っている
```bash
# 残っているワーカープロセスを確認
ps aux | grep "worker"

# 強制終了
kill -9 <pid>
```

## 関連ファイル

- `src/bin/worker.rs` - ワーカー実装
- `src/worker_mgmt.rs` - プロセス・結果管理
- `src/state.rs` - 拡張された UI 状態
- `Cargo.toml` - 依存関係

---

**更新日**: 2025年12月5日  
**作者**: Automated Implementation
