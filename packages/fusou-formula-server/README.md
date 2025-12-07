# FUSOU Formula Server

サーバー側でデータ前処理とフィーチャー選択を行い、軽量化されたデータをWorkerに配信するWebサーバー。

## 機能

### 1. データ前処理
- **JSON読み込み**: ネストされたJSON構造（Struct型）を自動展開
- **クリーニング**: 
  - 数値型以外の列を削除
  - 欠損値を0.0で埋める
  - 分散が0の列（定数列）を削除

### 2. フィーチャー選択
- **相関分析**: Pearson相関係数を計算
- **閾値フィルタリング**: 相関絶対値が0.1未満の列を削除
- **Top-K保証**: 最低でも3つのフィーチャーを残す

### 3. API エンドポイント

#### GET `/`
ヘルスチェック

```bash
curl http://localhost:3030/
```

#### GET `/job`
決定木で自動分割されたジョブを1件取得（簡易キューから先頭を返す）

```bash
curl http://localhost:3030/job
```

**レスポンス例:**
```json
{
  "leaf_key": "leaf_300000",             // 予測値を量子化したグループキー
  "predicted_value": 300.0,              // 決定木leafの予測値
  "job": {
    "feature_names": ["atk", "def", "luck"],
    "correlations": {
      "atk": 0.99,
      "def": -0.42,
      "luck": 0.15
    },
    "targets": [150.0, 350.0, ...],       // グループ内ターゲット
    "data": [
      [100.0, 50.0, 5.0],
      [200.0, 50.0, 5.0],
      ...
    ],
    "target_stats": {
      "mean": 257.0,
      "std": 82.46,
      "min": 150.0,
      "max": 380.0
    }
  }
}
```

## ビルドと実行

```bash
# ビルド
cargo build --release

# 実行（決定木で分割しつつジョブを配布）
cargo run --release

# または
RUST_LOG=fusou_formula_server=debug cargo run
```

サーバーは `http://0.0.0.0:3030` で起動します。


### モックデータで2グループに分かれる例

モックデータは以下のルールを含みます：

- `HP < 500` のとき: `Damage = Atk * 2.0`
- `HP >= 500` のとき: `Damage = Atk * 1.0 + 100`


決定木の設定（`max_depth=3`, `min_samples_leaf=50`）により、このような分岐を自動で検出し、
/job を呼ぶと「leafごと」のジョブがキューから1件ずつ返されます。複数回叩くと順番に別の leaf ジョブが取得できます。

## テストデータ

モックデータには以下の構造を使用しています：


```json
[
  {
    "attacker": {"atk": 100, "luck": 5},
    "defender": {"def": 50},
    "map_id": 1,
    "damage": 150
  },
  ...
]
```

Struct型（`attacker`, `defender`）は自動的に展開され、最終的に以下のカラムが得られます：

- `atk` (攻撃力)
- `luck` (運)
- `def` (防御力)
- `map_id` (マップID)
- `damage` (ターゲット: ダメージ値)

## 技術スタック

- **Web Framework**: `axum` 0.7
- **Runtime**: `tokio` 1.35
- **Data Processing**: `polars` 0.36 (Lazy API, JSON parsing)
- **Logging**: `tracing` + `tracing-subscriber`
