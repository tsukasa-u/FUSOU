# fusou-formula: Mathematical Model Extraction Pipeline

ブラックボックスシステム（ゲーム）の入出力データから、背後にある決定論的な数理モデル（支配方程式）を自動的にリバースエンジニアリングするPythonパイプライン。

## セットアップ

### 前提条件

1. **Python 3.10+**
2. **Julia** (PySR のバックエンド): [juliaup](https://github.com/JuliaLang/juliaup) 経由でインストール推奨

```bash
# Windows
winget install julia -s msstore

# macOS / Linux
curl -fsSL https://install.julialang.org | sh
```

### インストール

```bash
cd packages/fusou-datasets/analysis
pip install -e ".[dev]"
```

初回の PySR 実行時に Julia パッケージが自動インストールされます（数分かかります）。

## 使い方

### CLI でパイプライン実行

```bash
# 砲撃ダメージ式の探索
python scripts/run_pipeline.py --target hougeki --output results/

# 既知公式との自動比較
python scripts/validate_known.py --results-dir results/
```

### 対話的探索 (Jupyter Notebook)

```bash
jupyter lab notebooks/
```

- `01_data_exploration.ipynb` — データ探索・前処理確認
- `02_hypothesis_testing.ipynb` — 仮説駆動の式探索
- `03_result_analysis.ipynb` — 結果分析・可視化

### FUSOU-WEB での表示

結果 JSON は `results/` ディレクトリに保存されます。FUSOU-WEB 開発サーバー (`pnpm dev`) を起動していれば、`/formulas` ページで即座に確認可能です。

本番へのパブリッシュ:

```bash
python scripts/publish_results.py --results-dir results/ --api-url https://dev.fusou.pages.dev
```

## パイプライン概要

| Phase | 名称               | 手法                           |
| ----- | ------------------ | ------------------------------ |
| 1     | 境界抽出           | 同一条件グルーピング → max/min |
| 2     | シンボリック回帰   | PySR (遺伝的プログラミング)    |
| 3     | レジームシフト検知 | pwlf / ruptures                |
| 4     | AST 変異           | sympy で floor/ceil ラッピング |
| 5     | パラメータ最適化   | Optuna (区間ベースペナルティ)  |

## ディレクトリ構成

```
analysis/
├── pyproject.toml
├── fusou_formula/          # メインパッケージ
│   ├── pipeline.py         # Pipeline 統括クラス
│   ├── phase1_boundary.py  # 決定論的境界抽出
│   ├── phase2_symbolic.py  # シンボリック回帰
│   ├── phase3_regime.py    # 変化点検知
│   ├── phase4_ast.py       # AST操作・不連続関数挿入
│   ├── phase5_optimize.py  # 勾配フリー最適化
│   ├── validators.py       # 検証ロジック
│   ├── data_loader.py      # fusou-datasets ラッパー
│   ├── exporter.py         # Web向けJSON出力
│   └── known_formulas/     # 既知公式定義
├── notebooks/              # 対話的探索
├── scripts/                # CLI自動実行
├── tests/                  # テスト
└── results/                # 出力 (gitignore)
```
