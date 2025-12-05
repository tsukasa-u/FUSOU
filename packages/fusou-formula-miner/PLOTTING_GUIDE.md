# グラフ表示機能の使い方

## 概要
`fusou-formula-miner` に以下の機能を追加しました：
- **`/dump` コマンド**：現在のソルバー状態を JSON ファイルに出力
- **`plot_results.py`**：JSON から読み込んで、データセット・目標式・得られた式を比較可視化

## ワークフロー

### 1. ソルバー実行中に `/dump` コマンドを実行

TUI 内で以下を入力：
```
/dump
```

すると、カレントディレクトリに `fusou_dump_<TIMESTAMP>.json` が生成されます。
このファイルには以下の情報が含まれます：
- `best_formula`: ソルバーが見つけた最良の式
- `target_formula`: 目標となる式（合成データセットの場合）
- `best_error`: RMSE
- `selected_features`: 使用フィーチャー一覧
- `top_candidates`: トップ 5 の候補式と RMSE

### 2. Python スクリプトで可視化

```bash
# 基本的な使い方
python plot_results.py fusou_dump_<TIMESTAMP>.json

# 特定のフィーチャーのみを使用
python plot_results.py fusou_dump_<TIMESTAMP>.json --features x0 x1

# 出力をファイルに保存
python plot_results.py fusou_dump_<TIMESTAMP>.json --output result.png

# サンプル数を指定（デフォルト: 200）
python plot_results.py fusou_dump_<TIMESTAMP>.json --samples 500
```

## 対応するデータ次元

### 1 次元
- 単一フィーチャーの場合、X-Y 散布図で表示
- 目標式と得られた式の出力を重ね描き

### 2 次元
- X-Y 平面に 2 つのフィーチャーを取り、出力を色で表示
- 3 つのサブプロット：
  - 左：目標式の出力
  - 中央：得られた式の出力
  - 右：2 つの差分（|Target - Best|）

### 3 次元以上
- **PCA（主成分分析）** で 2 次元に射影
- 第 1, 2 主成分を軸として使用、説明分散比も表示
- 寄与度が見やすい形で可視化

## 例

### 合成データセット（DMG 計算の場合）

```bash
# 実行
python plot_results.py fusou_dump_1704912345.json

# 出力:
# Plotting with features: ['atk', 'def', 'luck']
# Best formula: max(atk - def, 1.0) * (1.0 + 0.5 * step(luck - 80.0))
# Target formula: dmg = max(atk - def, 1.0) * (1.0 + 0.5 * step(luck - 80.0))
```

3 次元なので PCA で 2 次元化され、目標式との差分が可視化されます。

### 1 次元の特徴エンジニアリング例

```bash
python plot_results.py fusou_dump_1704912345.json --features x0

# 単純な 1D 散布図が表示されます
```

## 技術詳細

### Python スクリプトの機能

1. **式パースと評価**
   - 数学関数をサポート: `sqrt`, `abs`, `max`, `min`, `sin`, `cos`, `exp`, `log`
   - カスタム関数: `step(x)` (ヘビサイド関数)
   - 安全性: `eval` 使用時に許可される関数・変数を厳密に制限

2. **データ生成**
   - ゲーム統計（`atk`, `def`, `hp`）: 1～100 の一様分布
   - `luck`: 0～100
   - 汎用フィーチャー（`x0`, `x1`, ...）: 0～10
   - その他：0～1

3. **多次元対応**
   - 1～2 次元: 直接プロット
   - 3 次元以上: scikit-learn の PCA で 2 次元に圧縮
   - 説明分散比を軸ラベルに表示

4. **エラーハンドリング**
   - 評価エラーは NaN に変換し、警告のみ出力
   - JSON 解析エラーは明確なエラーメッセージ

## トラブルシューティング

### Python 依存関係がない場合

```bash
pip install numpy matplotlib scikit-learn scipy
```

### `/dump` がサジェスチョンに出ない場合

TUI 内で `/d` と入力すると `/dump` が候補に出ます。

### グラフが表示されない場合

- GUI 環境がない場合、`--output` で PNG/PDF に保存してください
- SSH 接続時は `--output result.png` で保存して、ローカルでダウンロード

## まとめ

このワークフローにより：
✅ データセット（サンプル）と得られた式の関係を直感的に理解
✅ 目標式との差分を可視化
✅ 多次元データも PCA で効果的に表示
✅ 結果をファイル保存して後で検証可能
