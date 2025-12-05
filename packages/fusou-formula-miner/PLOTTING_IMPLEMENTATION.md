# グラフ表示機能 - 実装サマリー

## 追加機能

### 1. Rust 側: `/dump` コマンド

**ファイル**: `src/mina.rs`

- TUI で `/dump` コマンドを実行すると、現在のソルバー状態を JSON ファイルに出力
- 出力ファイル: `fusou_dump_<TIMESTAMP>.json`
- JSON に含まれる情報:
  - `worker_id`: ワーカーID
  - `job_id`: ジョブID（利用可能な場合）
  - `generation`: 現在の世代数
  - `best_error`: 最高精度（RMSE）
  - `best_formula`: ソルバーが見つけた最良の式
  - `target_formula`: 目標となる式（合成データの場合）
  - `sample_count`: データセットのサンプル数
  - `selected_features`: 使用フィーチャー一覧
  - `max_generations`: 最大世代数
  - `target_error`: 目標誤差
  - `top_candidates`: トップ 5 の候補式と RMSE

### 2. Python 側: `plot_results.py`

**ファイル**: `plot_results.py`

JSON ダンプを読み込んで、データセット上での式の評価を可視化します。

#### 主な機能

1. **式パースと評価**
   - Python の `eval` で安全に式を計算
   - サポート関数: `sqrt`, `abs`, `max`, `min`, `sin`, `cos`, `exp`, `log`, `step`
   - 変数自動検出: `atk`, `def`, `luck`, `x0`, `x1`, ... など

2. **データ生成**
   - 自動でサンプルデータを生成
   - ゲーム統計（`atk`, `def`, `hp`）: 1～100
   - `luck`: 0～100
   - 汎用フィーチャー: 0～10

3. **多次元対応**
   - **1 次元**: X-Y 散布図
   - **2 次元**: 3 パネル（目標式、得られた式、差分）の色付き散布図
   - **3 次元以上**: PCA で 2 次元に圧縮、説明分散比を表示

#### 使用方法

```bash
# 基本的な使い方
python3 plot_results.py fusou_dump_<TIMESTAMP>.json

# 出力をファイルに保存
python3 plot_results.py fusou_dump_<TIMESTAMP>.json --output result.png

# 特定のフィーチャーのみを使用
python3 plot_results.py fusou_dump_<TIMESTAMP>.json --features x0 x1

# サンプル数を変更（デフォルト: 200）
python3 plot_results.py fusou_dump_<TIMESTAMP>.json --samples 500
```

### 3. セットアップスクリプト: `setup_plotting.sh`

**ファイル**: `setup_plotting.sh`

Python 依存パッケージをインストール:
```bash
bash setup_plotting.sh
```

必要なパッケージ:
- `numpy`: 数値計算
- `matplotlib`: グラフ描画
- `scikit-learn`: PCA
- `scipy`: 統計関数

## ワークフロー例

### 例 1: 合成データセット（DMG 計算）

```
1. TUI 内で solver を実行
2. 最良の式が見つかったら、TUI で `/dump` を実行
   → fusou_dump_1704912345.json が生成される

3. ターミナルで以下を実行:
   python3 plot_results.py fusou_dump_1704912345.json --output dmg_comparison.png

4. グラフが生成される:
   - 左パネル: 目標式（max(atk - def, 1.0) * (1.0 + 0.5 * step(luck - 80))）の出力
   - 中央パネル: ソルバーが見つけた式の出力
   - 右パネル: 2 つの差分

5. 結果を PNG で保存できる
   → dmg_comparison.png を画像ビューアで確認
```

### 例 2: 高次元データ（4+ フィーチャー）

```
1. /dump で JSON を生成
2. python3 plot_results.py fusou_dump_*.json --output high_dim.png
   → 自動的に PCA で 2 次元化
   → 各軸の説明分散比がラベルに表示
```

### 例 3: 1 次元特徴エンジニアリング

```
1. /dump で JSON を生成
2. python3 plot_results.py fusou_dump_*.json --features x0 --output 1d_plot.png
   → シンプルな X-Y 散布図が表示
```

## ファイル一覧

| ファイル | 説明 |
|---------|------|
| `src/mina.rs` | `/dump` コマンドの実装（JSON 出力） |
| `plot_results.py` | Python 可視化スクリプト |
| `setup_plotting.sh` | 依存パッケージインストールスクリプト |
| `test_plotting.py` | テストスクリプト（サンプルダンプを生成） |
| `PLOTTING_GUIDE.md` | ユーザー向けガイド |
| `PLOTTING_IMPLEMENTATION.md` | このドキュメント |

## 技術的詳細

### 式評価の安全性

```python
# eval に許可される関数・変数のみに限定
allowed_names = {
    'sqrt': np.sqrt,
    'abs': np.abs,
    'max': np.maximum,
    'step': lambda x: np.where(x >= 0, 1.0, 0.0),
    ...
}
ns = {**allowed_names, **values_dict}
eval(formula_safe, {"__builtins__": {}}, ns)  # 制限された環境で実行
```

### PCA 投影

```python
# 3 次元以上の場合、scikit-learn の PCA で 2 次元化
pca = PCA(n_components=2)
data_2d = pca.fit_transform(data_array)
# 軸ラベルに説明分散比を表示: PC1 (45.2%), PC2 (32.1%)
```

### エラーハンドリング

- 評価失敗時は `np.nan` に変換、警告のみ出力
- JSON 解析エラーは明確なメッセージ
- ファイルが見つからない場合もエラーハンドリング

## 今後の拡張案

1. **インタラクティブプロット**: matplotlib の `ipywidgets` で TUI 内から直接表示
2. **統計分析**: R² スコア、RMSE の自動計算・表示
3. **アニメーション**: 世代ごとの式の進化を動画で表示
4. **複数式の比較**: 複数の dump ファイルを同時にプロット

## まとめ

このグラフ表示機能により：
- ✅ データセットと得られた式の関係を視覚的に理解
- ✅ 目標式との差分を定量的に比較
- ✅ 多次元データも PCA で効果的に表示
- ✅ 結果をファイルに保存して後で検証
- ✅ Python の標準ライブラリのみで実装（可搬性が高い）
