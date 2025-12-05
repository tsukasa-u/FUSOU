---
title: Formula Miner - シンボリック回帰による数式最適化
description: Formula Miner のシンボリック回帰エンジンとパラメータスイープ機能の包括的ガイド
contributors: ["github-copilot"]
date: 2025-12-05
slug: formula-miner/overview
tags: [formula-miner, symbolic-regression, genetic-algorithm]
---

## 概要

Formula Miner は、シンボリック回帰（Symbolic Regression）を用いて、データから数式を自動的に発見・最適化するツールです。遺伝的アルゴリズム（Genetic Algorithm, GA）をベースにした探索手法により、複雑な数理モデルを人間が理解可能な数式として表現します。

本ドキュメントでは、Formula Miner の理論的背景、実装の詳細、コマンド体系、パラメータスイープ機能までを包括的に解説します。

## シンボリック回帰とは

### 基本概念

シンボリック回帰は、数値データから「数式そのもの」を発見する機械学習手法です。通常の回帰（線形回帰、ニューラルネットワーク等）がパラメータのみを最適化するのに対し、シンボリック回帰は **数式の構造（関数の組み合わせ、演算子、変数の選択）** も同時に探索します。

#### 従来の回帰との違い

| 手法 | 最適化対象 | 解釈性 | 柔軟性 |
|------|----------|--------|--------|
| 線形回帰 | 係数のみ（構造は `y = a₁x₁ + a₂x₂ + ... + b` 固定） | 高い | 低い（線形関係のみ） |
| ニューラルネット | 重み・バイアス（構造はアーキテクチャで事前決定） | 低い（ブラックボックス） | 高い（任意の非線形関係） |
| **シンボリック回帰** | **式の構造 + パラメータ** | **極めて高い（数式として表現）** | **高い（任意の演算子・関数の組み合わせ）** |

#### 応用分野

- **物理法則の発見**: 観測データから運動方程式、保存則などを自動推定
- **エンジニアリング**: センサーデータから制御式を導出
- **ゲームバランス調整**: ダメージ計算式、経験値関数の最適化
- **金融モデリング**: 市場データからトレンド式を抽出
- **生物学**: 遺伝子発現パターンから制御ネットワークをモデル化

### Formula Miner の実装方針

Formula Miner は以下の設計思想に基づいています：

1. **遺伝的プログラミング（GP）ベース**: 式を木構造（抽象構文木, AST）として表現し、交叉・突然変異で探索
2. **多目的最適化**: 精度（RMSE）と式の複雑さ（パーシモニー）を同時に最適化
3. **スマート初期化**: データの線形性・べき乗則を分析し、効果的な初期集団を生成
4. **実用性重視**: オーバーフロー検出、無限大/NaN の処理、実行時間の管理

---

## 遺伝的アルゴリズムによる数式探索

### アルゴリズムの概要

Formula Miner は以下のステップで数式を探索します：

```
1. 初期化（Smart Initialization）
   ↓
2. 評価（Fitness Evaluation）
   - RMSE（平均二乗誤差の平方根）を計算
   - パーシモニー圧力を加算（複雑な式にペナルティ）
   ↓
3. 選択（Selection）
   - トーナメント選択で親を選出
   ↓
4. 交叉（Crossover）
   - 二つの親の部分木を交換
   ↓
5. 突然変異（Mutation）
   - 部分木の置換、定数の摂動、巻き上げ突然変異
   ↓
6. エリート保存（Elitism）
   - 最良個体を次世代に保持
   ↓
7. 終了判定
   - 目標誤差達成 or 世代数上限
   ↓（No）
8. 次世代へ → 2. に戻る
```

### 1. 初期化（Smart Initialization）

通常の GP ではランダムな式木を生成しますが、Formula Miner は **データの統計的性質を分析** して初期集団を生成します。

#### 線形パターン検出

各変数について単回帰分析を実施し、線形性が高い（R² > 0.7）変数を特定：

```rust
// 疑似コード
for each variable x_i {
    fit: y = a * x_i + b
    if R² > 0.7 {
        add_to_initial_population: a * x_i + b
    }
}
```

#### べき乗則パターン検出

対数空間での線形性を検証し、べき乗関係（`y = a * x^b`）を検出：

```rust
// 疑似コード
for each variable x_i {
    fit: log(y) = a * log(x_i) + b
    if R² > 0.7 {
        add_to_initial_population: exp(b) * x_i^a
    }
}
```

#### ランダム生成

統計的パターンが検出されない場合や、多様性確保のため、残りはランダムに生成。

**効果**: 初期集団の質が高まり、収束速度が大幅に向上（典型的に 30-50% の世代数削減）。

### 2. 評価（Fitness Evaluation）

各個体（数式）の適応度は以下の式で計算されます：

```
Fitness = RMSE + λ * Size
```

- **RMSE（Root Mean Square Error）**: データセットに対する予測誤差
  ```
  RMSE = sqrt( (1/N) * Σ(y_pred - y_true)² )
  ```

- **Size**: 式木のノード数（演算子・変数・定数の総数）

- **λ**: パーシモニー圧力係数（デフォルト 0.02）

**パーシモニー圧力の役割**: 同程度の精度なら、より単純な式を選好。オッカムの剃刀の原理を実装。

#### 数値安定性の保証

Formula Miner は以下の工夫で数値エラーを防ぎます：

```rust
// 各ステップで有限性をチェック
if !prediction.is_finite() {
    return f64::MAX;  // この個体は淘汰対象
}
```

### 3. 選択（Tournament Selection）

トーナメント選択により、適応度の高い個体を親として選出します。

```
手順:
1. 集団からランダムに k 個体を選出（k = tournament_size）
2. その中で最も適応度が高い個体を親とする
3. 必要な数だけ繰り返す
```

**利点**:
- 実装が単純
- 選択圧を `tournament_size` で調整可能
- 計算量が O(population_size) で済む

### 4. 交叉（Crossover）

二つの親の部分木を交換し、新しい個体を生成します。

```
Parent1:  +                    Parent2:  *
         / \                             / \
        x   *          交叉点 →         y   -
           / \                             / \
          y   2                           z   1

Offspring: +
          / \
         x   -
            / \
           z   1
```

**交叉率（crossover_rate）**: 0.85 がデフォルト。高すぎると構造が不安定化。

### 5. 突然変異（Mutation）

個体に小さな変化を加え、探索の多様性を保ちます。

#### 突然変異の種類

1. **部分木置換（Subtree Mutation）**
   - ランダムなノードを新しい部分木に置き換え
   - 探索範囲を広げる効果

2. **定数摂動（Constant Perturbation）**
   - 定数ノードに小さなノイズを加える
   - 局所最適化の効果

3. **巻き上げ突然変異（Hoist Mutation）**
   - 部分木をその子孫で置き換える
   - 式を単純化する効果

**突然変異率（mutation_rate）**: 0.25 がデフォルト。低すぎると局所解に陥りやすく、高すぎるとランダム探索に近づく。

### 6. エリート保存（Elitism）

各世代の最良個体を無条件で次世代に残します。

```rust
// 疑似コード
elite_count = population_size / 8  // 典型的に 12.5%
next_generation[0..elite_count] = current_best[0..elite_count]
```

**効果**: 発見した良い解を失わないことを保証。単調増加性を担保。

---

## パラメータスイープ機能

### パラメータスイープとは

パラメータスイープは、**複数のハイパーパラメータ組み合わせを自動的に試行し、最適な設定を発見する** 手法です。

#### なぜ必要か？

遺伝的アルゴリズムの性能は、以下のパラメータに強く依存します：

- `population_size`: 集団サイズ
- `max_depth`: 式木の最大深さ
- `mutation_rate`: 突然変異率
- `crossover_rate`: 交叉率
- `tournament_size`: トーナメントサイズ
- `elite_count`: エリート個体数

これらを手動で調整するのは非常に時間がかかり、経験と勘に頼る部分が大きいです。パラメータスイープを使うことで、**系統的かつ網羅的に最適設定を探索** できます。

### スイープの仕組み

#### 基本フロー

```
1. パラメータ空間の定義
   - 各パラメータの範囲とステップ幅を指定
   
2. グリッド生成
   - 全組み合わせを列挙（例: 5×4×3 = 60 通り）
   
3. 各組み合わせで実行
   - パラメータを適用 → 数式最適化 → 性能記録
   
4. 統計的評価
   - 繰り返し実行（repeats）で平均・中央値・標準偏差を算出
   
5. 結果分析
   - 最良設定の特定
   - JSON/CSV で詳細ログ出力
```

#### 混合基数エンコーディング

Formula Miner は効率的にパラメータ組み合わせを管理するため、**混合基数（mixed-radix）エンコーディング** を使用します。

```rust
// 例: mutation_rate (5 values), max_depth (4 values), pop_size (3 values)
// 合計 5×4×3 = 60 通り

index = 0:  mutation_rate[0], max_depth[0], pop_size[0]
index = 1:  mutation_rate[1], max_depth[0], pop_size[0]
...
index = 59: mutation_rate[4], max_depth[3], pop_size[2]

// デコード式（疑似コード）
for (i, param) in params.enumerate() {
    base = param.value_count
    param_index = index % base
    index = index / base
    param.value = param.min + param_index * param.step
}
```

### 繰り返し評価と統計的集約

#### 確率的アルゴリズムの課題

遺伝的アルゴリズムは確率的なため、**同じパラメータでも実行ごとに結果が異なります**。単発の結果だけで判断すると、たまたま運が良かった/悪かった設定を誤認識する恐れがあります。

#### 解決策: 繰り返し実行

Formula Miner は `repeats=N` オプションで同一パラメータを N 回実行し、以下を記録します：

- **平均誤差（mean_error）**: 典型的な性能を表す
- **中央値誤差（median_error）**: 外れ値に頑健な指標
- **標準偏差（stddev_error）**: 安定性の指標（小さいほど再現性が高い）

```
例: repeats=5 で mutation_rate=0.3 を試行

Run 1: RMSE = 0.045
Run 2: RMSE = 0.038
Run 3: RMSE = 0.042
Run 4: RMSE = 0.051
Run 5: RMSE = 0.040

→ mean   = 0.0432
→ median = 0.042
→ stddev = 0.0048
```

**推奨設定**: 初期探索は `repeats=1`、有望な範囲の精査は `repeats=3〜5`。

### ローカル補正（Refinement）

#### 動機

粗いグリッド探索で良い領域を見つけた後、その周辺をより細かく調べたい場合があります。手動で再設定するのは煩雑なため、**自動的に局所探索を行う** 機能を実装しました。

#### 仕組み

```
1. メインスイープ完了
   ↓
2. 目標誤差未達成 & 補正回数残あり？
   → Yes: 補正モードへ
   ↓
3. 補正範囲の決定
   - 中心: トップ K 件の平均（デフォルト K=3）
   - 幅: 元のステップ × refinement_factor（デフォルト 0.5）
   ↓
4. 補正グリッド生成
   - 例: center ± step/2 の範囲を step/2 刻みで探索
   ↓
5. 補正スイープ実行
   ↓
6. 補正回数をインクリメント
   ↓
7. まだ目標未達 & 回数残あり？
   → Yes: 3. に戻る（さらに細かく）
   → No: 終了
```

#### トップ K 平均の利点

単一の最良結果を中心にすると、外れ値（たまたま良かった実行）に引きずられるリスクがあります。上位 K 件の平均を取ることで、**ロバストな中心推定** が可能です。

```rust
// 疑似コード
top_k_results = sort_by_error(detailed_results).take(k)
center = mean(top_k_results.map(|r| r.parameters))
```

**デフォルト設定**: `refinement_top_k = 3`（上位 3 件の平均）

### 実行時間推定（ETA）

長時間実行するスイープでは、**残り時間の見積もり** があると便利です。Formula Miner は過去の実行履歴から ETA を計算します。

```rust
// 疑似コード
avg_duration = mean(historical_run_durations)
remaining_runs = (total_iterations - current_iteration) * repeats_per_setting
                 + (repeats_per_setting - current_repeat)
                 + refinement_iterations
eta_seconds = avg_duration * remaining_runs
```

**表示例**: `ETA ~ 15m32s`

**注意**: 初期は履歴が少ないため不安定。数回実行後に安定します。

---

## コマンドリファレンス

### 起動方法

```bash
cd /path/to/fusou-formula-miner
cargo run
```

TUI（Terminal User Interface）が起動し、コマンド入力待ちになります。

### 基本コマンド

#### `/help` - ヘルプ表示

```
/help
```

利用可能なコマンド一覧を表示。

```
/help <command>
```

特定コマンドの詳細ヘルプを表示。

**例**:
```
/help sweep
/help set
```

#### `/version` - バージョン情報

```
/version
```

パッケージ名とバージョンを表示。

#### `/quit` - 終了

```
/quit
```

アプリケーションを終了。

### パラメータ設定

#### `/set` - ランタイムパラメータの変更

```
/set <parameter> <value>
```

実行時パラメータを変更します。変更は即座に反映され、次回の `/start` で使用されます。

**設定可能なパラメータ**:

| パラメータ | 型 | デフォルト | 説明 |
|----------|-----|----------|------|
| `population_size` | usize | データ依存 | 集団サイズ（24×変数数、48-256 にクランプ） |
| `max_depth` | usize | データ依存 | 式木の最大深さ（変数数+2、最大 8） |
| `mutation_rate` | f64 | 0.25 + 1/変数数 | 突然変異率（0.0-1.0） |
| `crossover_rate` | f64 | 0.85 | 交叉率（0.0-1.0） |
| `tournament_size` | usize | 6 | トーナメント選択のサイズ（2 以上） |
| `elite_count` | usize | pop/8 | エリート保存数 |
| `use_nsga2` | bool | false | NSGA-II 多目的最適化を使用（true/false） |
| `tarpeian_probability` | f64 | 0.0 | Tarpeian 法の確率（0.0-1.0） |
| `hoist_mutation_rate` | f64 | 0.0 | 巻き上げ突然変異率（0.0-1.0） |
| `constant_optimization_interval` | usize | 0 | 定数最適化の間隔（0=無効） |
| `max_generations` | u64 | 1 | 最大世代数 |

**使用例**:
```
/set mutation_rate 0.3
/set max_generations 10000
/set population_size 128
/set use_nsga2 true
```

**Tips**:
- `max_generations` を大きくすると精度向上しますが、時間もかかります
- `mutation_rate` を高めると探索範囲が広がりますが、収束が遅くなります
- `use_nsga2 true` で精度と複雑さのパレートフロンティアを探索できます

### 数式最適化の実行

#### `/start-formula` - 数式最適化の開始

```
/start-formula
```

現在のパラメータで数式最適化を開始します。データセットは自動的に読み込まれ（オンラインモードではサーバーから取得、オフラインモードでは合成データを使用）、特徴量選択→最適化が実行されます。

**実行フロー**:
1. データセット読み込み
2. 相関ベースの特徴量選択（`correlation_threshold` 以上の特徴を保持）
3. スマート初期化
4. 遺伝的アルゴリズム実行
5. 最良式の表示

**停止条件**:
- 目標誤差（`target_error`）達成
- 最大世代数（`max_generations`）到達
- ユーザーが `/stop` を実行

#### `/start` - エイリアス

```
/start
```

`/start-formula` と同じ（後方互換性のため残存）。

#### `/stop` - 実行中の最適化を停止

```
/stop
```

現在実行中の最適化またはスイープを停止します。停止シグナルを送信し、現在の世代が終了次第、処理を中断します。

### パラメータスイープ

#### `/sweep` - パラメータスイープの設定

```
/sweep [preset|custom_ranges] [options]
```

パラメータスイープを設定します。

**プリセット**:

1. **`default`** - デフォルト設定
   ```
   /sweep default
   ```
   - `mutation_rate`: 0.1 〜 0.5 (ステップ 0.1) → 5 値
   - `max_depth`: 3 〜 8 (ステップ 1) → 6 値
   - `population_size`: 32 〜 256 (ステップ 32) → 8 値
   - **合計**: 5×6×8 = 240 組み合わせ

2. **`all`** - 全パラメータ
   ```
   /sweep all
   ```
   - `population_size`: 32 〜 256 (ステップ 64) → 4 値
   - `max_depth`: 3 〜 8 (ステップ 2) → 3 値
   - `mutation_rate`: 0.1 〜 0.5 (ステップ 0.15) → 3 値
   - `crossover_rate`: 0.6 〜 0.9 (ステップ 0.1) → 4 値
   - `tournament_size`: 2 〜 8 (ステップ 2) → 4 値
   - `elite_count`: 1 〜 16 (ステップ 5) → 4 値
   - **合計**: 4×3×3×4×4×4 = 2304 組み合わせ

**カスタム範囲**:

```
/sweep <param1>=<min>:<max>:<step> [param2=...] [options]
```

**例**:
```
/sweep mutation_rate=0.1:0.5:0.1 max_depth=3:8:1
/sweep population_size=48:128:16 mutation_rate=0.2:0.4:0.05 crossover_rate=0.7:0.9:0.1
```

**オプション**:

| オプション | 型 | デフォルト | 説明 |
|----------|-----|----------|------|
| `repeats=N` | usize | 1 | 各パラメータ設定を N 回繰り返し |
| `refinements=M` | usize | 0 | ローカル補正の最大回数 |
| `refinement_factor=F` | f64 | 0.5 | 補正時のステップ縮小率 |

**例**:
```
/sweep default repeats=3
/sweep mutation_rate=0.1:0.5:0.1 repeats=5 refinements=2 refinement_factor=0.5
/sweep all repeats=2 refinements=1 refinement_factor=0.3
```

**Tips**:
- 初期探索は `repeats=1` で広く浅く試す
- 有望な範囲が見えたら `repeats=3〜5` で精査
- `refinements` を設定すると、メインスイープ後に自動で局所探索
- `refinement_factor=0.5` は「ステップを半分にする」という意味

#### `/start-sweep` - パラメータスイープの実行

```
/start-sweep
```

`/sweep` で設定したパラメータスイープを実行します。

**実行フロー**:
1. 各パラメータ組み合わせについて
   - `repeats` 回繰り返し実行
   - 各実行の RMSE、実行時間、世代ごとの履歴を記録
2. 繰り返し完了後、平均・中央値・標準偏差を計算
3. 結果を JSON・CSV に保存
4. 次の組み合わせへ自動移行
5. 全組み合わせ完了後
   - 目標誤差未達成 & `refinements` > 0 なら補正モードへ
   - 補正完了 or 目標達成で終了

**出力ファイル**:
- `sweep_results_<timestamp>.json`: 詳細結果（パラメータ、統計量、履歴）
- `sweep_results_<timestamp>.csv`: 表形式サマリー

**停止方法**:
```
/stop
```

### データ出力

#### `/dump` - 現在の状態をエクスポート

```
/dump
```

現在のソルバー状態を JSON ファイルにエクスポートします。

**出力ファイル**: `fusou_dump_<timestamp>.json`

**含まれる情報**:
- `worker_id`: ワーカー ID
- `job_id`: ジョブ ID（オンラインモードのみ）
- `generation`: 現在の世代
- `best_error`: 最良誤差
- `best_formula`: 最良数式
- `target_formula`: 目標数式（合成データの場合）
- `sample_count`: サンプル数
- `selected_features`: 選択された特徴量
- `top_candidates`: 上位 5 候補式

**使用例**:
```
/dump
```

#### `/export-params` - パラメータをエクスポート

```
/export-params
```

現在の GA パラメータ設定を JSON ファイルに保存します。

**出力ファイル**: `parameters_<timestamp>.json`

**用途**:
- 良い設定を保存して後で再利用
- 設定を共有
- バージョン管理

#### `/import-params` - パラメータをインポート

```
/import-params <filepath>
```

JSON ファイルからパラメータ設定を読み込みます。

**例**:
```
/import-params parameters_1234567890.json
```

### ログ操作

#### `/best` - 最良式の表示

```
/best
```

現在の最良数式をログに出力します。

#### `/clear` - ログのクリア

```
/clear
```

ログパネルをクリアします。

#### `/copylogs` - ログをコピー

```
/copylogs
```

ログをファイルに書き出し、可能であればクリップボードにコピーします。

**出力ファイル**: `fusou_logs_<timestamp>.log`

**対応クリップボードツール**:
- `wl-copy` (Wayland)
- `xclip` (X11)
- `xsel` (X11)

### UI 操作

#### パネルの切り替え

- **左矢印キー (`←`)**: Best Solution パネルにフォーカス
- **右矢印キー (`→`)**: Logs パネルにフォーカス

#### スクロール

- **上矢印キー (`↑`)**: フォーカス中のパネルを上スクロール
- **下矢印キー (`↓`)**: フォーカス中のパネルを下スクロール
- **マウスホイール**: スクロール

#### コマンド入力

- **文字入力**: コマンドバッファに追加
- **Backspace**: 最後の文字を削除
- **Tab**: コマンド補完（最初の提案を適用）
- **Enter**: コマンド実行
- **Esc**: 入力をクリア

---

## 実践ガイド

### 初めての数式最適化

**ステップ 1: 起動**
```bash
cargo run
```

**ステップ 2: パラメータ確認**

デフォルト設定で十分な場合が多いですが、確認したい場合は右側の Config パネルを見ます。

**ステップ 3: 実行**
```
/start-formula
```

**ステップ 4: 結果確認**

- Best Solution パネルに最良式と RMSE が表示されます
- Top Candidates に上位 5 件が表示されます
- Logs にプロセスの詳細が記録されます

**ステップ 5: エクスポート（オプション）**
```
/dump
```

### パラメータチューニング

**シナリオ**: 精度を向上させたい

```
/set max_generations 20000
/set mutation_rate 0.3
/start-formula
```

**シナリオ**: より複雑な式を許容したい

```
/set max_depth 10
/start-formula
```

**シナリオ**: 探索範囲を広げたい

```
/set population_size 256
/set mutation_rate 0.4
/start-formula
```

### パラメータスイープの実践例

#### 例 1: 基本的な探索

```
/sweep default
/start-sweep
```

240 組み合わせを 1 回ずつ試行。所要時間: データサイズと `max_generations` に依存（典型的に数時間）。

#### 例 2: 信頼性を重視

```
/sweep default repeats=3
/start-sweep
```

各組み合わせを 3 回実行して平均を取る。所要時間: 3 倍。

#### 例 3: 段階的探索

**第 1 段階: 粗探索**
```
/sweep mutation_rate=0.1:0.5:0.2 max_depth=3:8:2 population_size=48:192:48
/start-sweep
```

3×3×4 = 36 組み合わせで高速スクリーニング。

**第 2 段階: 精密探索**

粗探索の結果から有望な範囲（例: `mutation_rate` 0.2-0.4 が良かった）を特定し、細かく調べる：

```
/sweep mutation_rate=0.2:0.4:0.05 max_depth=4:6:1 population_size=96:144:16 repeats=5
/start-sweep
```

5×3×4 = 60 組み合わせ × 5 repeats = 300 実行。

#### 例 4: 自動補正付き

```
/sweep default refinements=2 refinement_factor=0.5 repeats=2
/start-sweep
```

1. メインスイープ: 240 組み合わせ × 2 repeats = 480 実行
2. 補正 1 回目: 最良付近を細かく探索（自動）
3. 補正 2 回目: さらに細かく（自動）

### 結果の分析

#### JSON ファイルの構造

```json
{
  "total_iterations": 240,
  "current_iteration": 240,
  "parameters_swept": ["mutation_rate", "max_depth", "population_size"],
  "best_error": 0.0123,
  "best_parameters": { ... },
  "refinement_enabled": true,
  "max_refinements": 2,
  "refinement_factor": 0.5,
  "refinement_top_k": 3,
  "all_results": [
    {
      "parameters": {
        "population_size": 48,
        "max_depth": 3,
        "mutation_rate": 0.1,
        ...
      },
      "mean_error": 0.0456,
      "median_error": 0.0450,
      "stddev_error": 0.0023,
      "run_durations": [12.3, 11.8, 12.5],
      "histories": [
        [ {"generation": 0, "best_error": 1.234}, ... ],
        [ ... ],
        [ ... ]
      ]
    },
    ...
  ]
}
```

#### CSV ファイルの活用

CSV ファイルは表計算ソフト（Excel、Google Sheets）や Python（pandas）で簡単に分析できます。

**Python での読み込み例**:
```python
import pandas as pd
import json

# CSV 読み込み
df = pd.read_csv('sweep_results_<timestamp>.csv')

# パラメータ列を JSON としてパース
df['params'] = df['parameters'].apply(json.loads)

# 平均誤差でソート
df_sorted = df.sort_values('mean_error')

# 上位 10 件を表示
print(df_sorted.head(10))

# 散布図: mutation_rate vs mean_error
df['mutation_rate'] = df['params'].apply(lambda p: p['mutation_rate'])
df.plot.scatter(x='mutation_rate', y='mean_error')
```

---

## 高度なトピック

### NSGA-II 多目的最適化

通常の GA は「精度のみ」を最大化しますが、NSGA-II は **精度と複雑さの両方** を同時に最適化します。

#### 使い方

```
/set use_nsga2 true
/start-formula
```

#### 出力

パレートフロンティア（Pareto Frontier）上の複数の解が出力されます：

```
#1: 0.001234 | (atk - def) * 1.5
#2: 0.002345 | (atk - def) * (1.0 + 0.1 * luck)
#3: 0.003456 | max(atk - def, 1.0) * (1.0 + 0.5 * step(luck - 80.0))
```

- #1: 最も単純だが精度は低い
- #3: 最も精度が高いが複雑
- #2: バランスが良い

**選択基準**:
- 解釈性重視 → #1 または #2
- 精度重視 → #3

### Tarpeian 法

Tarpeian 法は、**極端に複雑な個体を強制的に淘汰** する手法です。

#### 動機

通常の GP では「複雑だが精度が高い」個体が生き残りやすく、式が肥大化する傾向（bloat）があります。

#### 仕組み

```rust
if expr.size() > average_size * 1.5 {
    if random() < tarpeian_probability {
        fitness = f64::MAX  // 強制的に最悪評価
    }
}
```

#### 使い方

```
/set tarpeian_probability 0.3
/start-formula
```

**推奨値**: 0.2 〜 0.5

### 巻き上げ突然変異

巻き上げ突然変異は、**部分木をその子孫で置き換える** 突然変異です。

#### 効果

式を単純化し、bloat を防ぐ。

#### 例

```
Before:  +
        / \
       *   2
      / \
     x   y

After:   *
        / \
       x   y
```

部分木 `(x * y) + 2` が `(x * y)` に置き換わりました。

#### 使い方

```
/set hoist_mutation_rate 0.1
/start-formula
```

**推奨値**: 0.05 〜 0.15

### 定数最適化

遺伝的プログラミングで生成された式には、定数ノード（例: `1.23`, `-0.56`）が含まれます。これらの定数を **数値最適化（勾配降下法、準ニュートン法など）** で微調整することで、精度を向上できます。

#### 使い方

```
/set constant_optimization_interval 100
/start-formula
```

**意味**: 100 世代ごとに、上位個体の定数を最適化。

**トレードオフ**:
- 精度向上
- 計算コストの増加（典型的に 10-20% のオーバーヘッド）

**推奨値**:
- `0`: 無効（デフォルト、高速）
- `50〜200`: 精度重視

---

## トラブルシューティング

### Q1: 最適化が収束しない

**原因**:
- `max_generations` が小さすぎる
- `mutation_rate` が高すぎる
- データが複雑すぎる

**対策**:
```
/set max_generations 20000
/set mutation_rate 0.2
/start-formula
```

### Q2: 式が複雑すぎる

**原因**:
- パーシモニー圧力が不足
- `max_depth` が大きすぎる

**対策**:
```
/set max_depth 6
/set use_nsga2 true
/start-formula
```

または Tarpeian 法を有効化：
```
/set tarpeian_probability 0.3
```

### Q3: 精度が頭打ち

**原因**:
- 局所解に陥っている
- `population_size` や `mutation_rate` が小さすぎる

**対策**:
```
/set population_size 256
/set mutation_rate 0.35
/set max_generations 30000
/start-formula
```

### Q4: スイープが途中で止まる

**原因**:
- エラーによる中断（ログを確認）
- `/stop` を実行した

**対策**:
- ログで最後のエラーメッセージを確認
- 再度 `/start-sweep` で残りを継続（自動的に続きから開始）

### Q5: 出力ファイルが見つからない

**原因**:
- カレントディレクトリに出力されている

**確認方法**:
```bash
ls -lh *.json *.csv *.log
```

**出力先変更**（今後の実装候補）:
現在はカレントディレクトリ固定。将来的には設定ファイルで指定可能にする予定。

---

## パフォーマンスチューニング

### 実行時間の目安

以下は典型的なケースでの目安です（Intel Core i7、8 コア）：

| 設定 | 世代数 | 集団サイズ | 変数数 | 所要時間/実行 |
|-----|-------|----------|--------|------------|
| 軽量 | 1000 | 48 | 3 | 5 秒 |
| 標準 | 5000 | 128 | 5 | 30 秒 |
| 重量 | 20000 | 256 | 10 | 3 分 |

**スイープの所要時間**:
```
total_time = combinations × repeats × time_per_run
```

例: `default` + `repeats=3`
```
240 組み合わせ × 3 repeats × 30 秒 = 6 時間
```

### 高速化のヒント

1. **並列実行**（今後の実装候補）
   - 現在は逐次実行のみ
   - 複数プロセスで並列化すれば線形に高速化

2. **早期終了**
   - `target_error` を適切に設定すれば、目標達成次第終了
   ```
   /set target_error 0.01
   ```

3. **段階的スイープ**
   - 粗い探索 → 精密探索の 2 段階で効率化

4. **GPU 実装**（今後の実装候補）
   - 評価関数の並列化で大幅高速化の可能性

---

## ベストプラクティス

### 1. データ準備

- **欠損値の処理**: 事前に除去または補完
- **外れ値の確認**: 極端な値はロバスト性を損なう
- **正規化**: 変数の範囲が大きく異なる場合は正規化を推奨（特に定数最適化を使う場合）

### 2. パラメータ設定の指針

| 目的 | 推奨設定 |
|-----|---------|
| 高速プロトタイピング | `max_generations=1000`, `population_size=48` |
| バランス型 | `max_generations=5000`, `population_size=128` |
| 高精度追求 | `max_generations=20000`, `population_size=256`, `repeats=5` |
| 解釈性重視 | `use_nsga2=true`, `max_depth=6`, `tarpeian_probability=0.3` |

### 3. スイープの戦略

**初心者向け**:
```
/sweep default
/start-sweep
```

**中級者向け**:
```
# 第 1 段階: 粗探索
/sweep mutation_rate=0.1:0.5:0.2 max_depth=3:8:2
/start-sweep

# 第 2 段階: 精密探索（結果を見て範囲を決定）
/sweep mutation_rate=0.2:0.4:0.05 max_depth=4:6:1 repeats=3
/start-sweep
```

**上級者向け**:
```
# 自動補正付き高精度スイープ
/sweep default refinements=3 refinement_factor=0.4 repeats=5
/start-sweep
```

### 4. 結果の検証

- **ホールドアウト検証**: 訓練データと別のデータで評価
- **交差検証**: 複数の分割で平均性能を確認
- **物理的妥当性**: 得られた式がドメイン知識と矛盾しないか確認

---

## 参考文献・関連リソース

### シンボリック回帰の基礎

- Koza, J. R. (1992). *Genetic Programming: On the Programming of Computers by Means of Natural Selection*. MIT Press.
- Poli, R., Langdon, W. B., & McPhee, N. F. (2008). *A Field Guide to Genetic Programming*. Lulu.com. (Free online: http://www.gp-field-guide.org.uk/)

### 多目的最適化

- Deb, K., et al. (2002). "A fast and elitist multiobjective genetic algorithm: NSGA-II." *IEEE Transactions on Evolutionary Computation*, 6(2), 182-197.

### Bloat 対策

- Poli, R., & Langdon, W. B. (1997). "Genetic programming with one-point crossover." In *Soft Computing in Engineering Design and Manufacturing*, pp. 180-189.
- Luke, S., & Panait, L. (2002). "A survey and comparison of tree generation algorithms." In *Genetic and Evolutionary Computation Conference*, pp. 81-88.

### 実装例・ツール

- **gplearn** (Python): https://github.com/trevorstephens/gplearn
- **PySR** (Python): https://github.com/MilesCranmer/PySR
- **Eureqa** (商用): https://www.nutonian.com/products/eureqa/

---

## 用語集

| 用語 | 説明 |
|-----|------|
| **シンボリック回帰（Symbolic Regression）** | データから数式を発見する機械学習手法 |
| **遺伝的アルゴリズム（Genetic Algorithm, GA）** | 生物進化を模倣した最適化手法 |
| **遺伝的プログラミング（Genetic Programming, GP）** | プログラム（式）を進化させる GA の一種 |
| **抽象構文木（Abstract Syntax Tree, AST）** | 式を木構造で表現したもの |
| **適応度（Fitness）** | 個体の良さを表す指標（通常は誤差の逆数） |
| **交叉（Crossover）** | 二つの親から子を生成する操作 |
| **突然変異（Mutation）** | 個体にランダムな変化を加える操作 |
| **エリート保存（Elitism）** | 最良個体を無条件で次世代に残す戦略 |
| **トーナメント選択（Tournament Selection）** | 複数個体から最良を選ぶ選択手法 |
| **パーシモニー圧力（Parsimony Pressure）** | 複雑さにペナルティを与える機構 |
| **Bloat** | 式が肥大化する現象 |
| **NSGA-II** | 多目的最適化アルゴリズムの一種 |
| **Tarpeian 法** | 極端に大きい個体を淘汰する手法 |
| **RMSE（Root Mean Square Error）** | 平均二乗誤差の平方根 |

---

## まとめ

Formula Miner は、遺伝的プログラミングに基づく高性能なシンボリック回帰エンジンです。本ドキュメントで解説した機能を活用することで、以下が可能になります：

1. **データ駆動の数式発見**: 複雑な現象を解釈可能な数式で表現
2. **自動パラメータチューニング**: パラメータスイープによる最適設定の発見
3. **ロバストな性能評価**: 繰り返し実行と統計的集約による信頼性の高い評価
4. **効率的な探索**: ローカル補正による段階的な精密化

本ツールを活用し、データから新たな知見を引き出してください。質問やフィードバックは GitHub Issues でお待ちしています。
