# グラフ表示機能 - 完全ガイド

## 概要

`fusou-formula-miner` にデータセット・目標式・得られた式をグラフで比較表示する機能を追加しました。

**主な変更:**
- ✅ Rust: `/dump` コマンドを TUI に追加 → JSON で状態をエクスポート
- ✅ Python: `plot_results.py` スクリプト → JSON から読み込んでグラフ描画
- ✅ 多次元対応: 1～2 次元は直接プロット、3+ 次元は PCA で 2D 化

---

## 使用手順

### ステップ 1: Rust ビルド

```bash
cd /home/ogu-h/Documents/GitHub/FUSOU/packages/fusou-formula-miner
cargo build --release
```

### ステップ 2: TUI でソルバー実行

```bash
./target/release/formula_miner
```

TUI が起動し、ソルバーが実行されます。

### ステップ 3: `/dump` コマンドで JSON エクスポート

TUI 内のコマンド入力欄で以下を実行:
```
/dump
```

すると、カレントディレクトリに `fusou_dump_<TIMESTAMP>.json` ファイルが生成されます。

### ステップ 4: Python 依存パッケージをインストール

```bash
bash setup_plotting.sh
```

または手動で:
```bash
pip3 install numpy matplotlib scikit-learn scipy
```

### ステップ 5: グラフを生成

```bash
python3 plot_results.py fusou_dump_<TIMESTAMP>.json --output result.png
```

グラフが `result.png` に保存されます。

---

## コマンド例

### 例 1: 標準的な可視化

```bash
python3 plot_results.py fusou_dump_1704912345.json
```

- GUI がある場合: matplotlib ウィンドウで表示
- GUI がない場合: エラーが出るので `--output` で保存

### 例 2: ファイルに保存

```bash
python3 plot_results.py fusou_dump_1704912345.json --output comparison.png
```

PNG ファイルで保存（高 DPI で見やすく）

### 例 3: 特定のフィーチャーのみプロット

```bash
python3 plot_results.py fusou_dump_1704912345.json --features x0 x1 --output 2d.png
```

### 例 4: サンプル数を増やす（より滑らかなプロット）

```bash
python3 plot_results.py fusou_dump_1704912345.json --samples 1000 --output high_res.png
```

---

## グラフ出力の形式

### 1 次元データ
```
散布図（X: フィーチャー値, Y: 出力値）
- 青点: 目標式の出力
- オレンジ点: ソルバーが見つけた式の出力
```

### 2 次元データ
```
3 パネル表示:
[左] 目標式の出力（色: 出力値）
[中] ソルバーの式の出力（色: 出力値）
[右] 差分: |目標 - ソルバー|（色: 誤差）
```

### 3 次元以上（高次元）
```
PCA で 2 次元に圧縮:
[左] 目標式（PC1 × PC2）
[中] ソルバーの式（PC1 × PC2）
[右] 差分（PC1 × PC2）

軸ラベルには説明分散比が表示（例: PC1 (45.2%)）
```

---

## JSON ダンプの内容

`/dump` コマンドで生成される JSON ファイルの構造:

```json
{
  "worker_id": "uuid-string",
  "job_id": "uuid-or-null",
  "generation": 150,
  "best_error": 0.0234,
  "best_formula": "max(atk - def, 1.0) * (1.0 + 0.5 * step(luck - 80.0))",
  "target_formula": "dmg = max(atk - def, 1.0) * (1.0 + 0.5 * step(luck - 80.0))",
  "sample_count": 1000,
  "selected_features": ["atk", "def", "luck"],
  "max_generations": 200,
  "target_error": 0.001,
  "top_candidates": [
    {
      "rank": 1,
      "formula": "...",
      "rmse": 0.0234
    },
    ...
  ]
}
```

---

## トラブルシューティング

### Q: `/dump` がサジェスチョンに出ない

**A:** TUI 内で `/d` と入力すると、`/dump` が候補に出ます。

### Q: Python エラー: `ModuleNotFoundError: No module named 'numpy'`

**A:** 以下でパッケージをインストール:
```bash
bash setup_plotting.sh
```

### Q: グラフウィンドウが表示されない

**A:** SSH 接続やヘッドレス環境では `--output` で PNG/PDF に保存:
```bash
python3 plot_results.py fusou_dump_*.json --output result.png
```

### Q: 多次元データでグラフが読みづらい

**A:** `--samples` で調整:
```bash
python3 plot_results.py fusou_dump_*.json --samples 100 --output sparse.png  # 少ない
python3 plot_results.py fusou_dump_*.json --samples 500 --output dense.png   # 多い
```

### Q: 特定のフィーチャーだけを見たい

**A:** `--features` で指定:
```bash
python3 plot_results.py fusou_dump_*.json --features atk def --output attack_defense.png
```

---

## 実装詳細

### Rust 側（`src/mina.rs`）

- `/dump` コマンドハンドラを追加
- `serde_json` で JSON シリアライズ
- タイムスタンプ付きファイル名で自動保存

### Python 側（`plot_results.py`）

1. **式パースと評価**
   - 安全な `eval` 環境で数学式を計算
   - `numpy` の配列化で効率的に処理

2. **データ生成**
   - 特定のフィーチャー名を認識（`atk`, `def`, `luck` など）
   - 自動で適切な範囲でサンプルデータを生成

3. **多次元対応**
   - `scikit-learn` の PCA で 3+ 次元を 2D に圧縮
   - 説明分散比をラベルに表示

4. **可視化**
   - `matplotlib` で 3 パネル同時描画
   - 色で出力値や誤差を表現

---

## 技術仕様

| 項目 | 詳細 |
|-----|------|
| **式サポート** | `+`, `-`, `*`, `/`, `sqrt`, `abs`, `max`, `min`, `sin`, `cos`, `exp`, `log`, `step` |
| **変数** | `x0-x9`, `atk`, `def`, `luck`, `hp`, `y`, `dmg` など |
| **データ範囲** | ゲーム統計: 1-100、汎用: 0-10、luck: 0-100 |
| **PCA 次元** | 常に 2 次元（説明分散比表示） |
| **エラーハンドリング** | 評価失敗は NaN、警告出力のみ |

---

## まとめ

```
Rust TUI
    ↓
/dump コマンド
    ↓
JSON ファイル
    ↓
Python plot_results.py
    ↓
グラフ（PNG/PDF）
```

このワークフローで、データセットと式の関係を視覚的に理解できます。

---

## 参考資料

- `PLOTTING_IMPLEMENTATION.md`: 技術詳細
- `plot_results.py`: Python スクリプト（コマンドラインヘルプ: `python3 plot_results.py --help`）
- `test_plotting.py`: テストスクリプト（サンプル実行）
