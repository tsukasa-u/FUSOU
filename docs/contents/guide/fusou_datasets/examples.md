---
title: fusou-datasets Examples
contributors: ["tsukasa-u"]
description: >-
  fusou-datasetsを使ったデータ分析の実践的なサンプルコード。pandas、matplotlibを使った艦種データの可視化、期間別比較分析の例。
date: 2026-01-01
slug: guide/fusou_datasets/examples
tags: [guide, fusou_datasets, python, examples, data_analysis]
---

# fusou-datasets Examples

実践的なデータ分析のサンプルコードを紹介します。

## 基本的な使い方

### テーブル一覧の確認

```python
import fusou_datasets

# 利用可能なテーブルを確認
tables = fusou_datasets.list_tables()
print("利用可能なテーブル:")
for table in tables:
    print(f"  - {table}")
```

### 期間タグの確認

```python
import fusou_datasets

# 期間タグを確認
info = fusou_datasets.list_period_tags()
print(f"最新期間: {info['latest']}")
print(f"利用可能な期間: {', '.join(info['period_tags'])}")
```

---

## データの読み込みと基本操作

### 艦種データの取得

```python
import fusou_datasets
import pandas as pd

# 艦種データを読み込み
df = fusou_datasets.load("ship_type")

# 基本情報を確認
print(f"レコード数: {len(df)}")
print(f"カラム: {df.columns.tolist()}")
print()
print("先頭5行:")
print(df.head())
```

### データの統計情報

```python
import fusou_datasets

df = fusou_datasets.load("ship_type")

# 数値カラムの統計
print(df.describe())

# データ型の確認
print(df.dtypes)
```

---

## pandas を使ったデータ操作

### フィルタリング

```python
import fusou_datasets

df = fusou_datasets.load("ship_type")

# 条件でフィルタリング（例: 特定の艦種）
# カラム名は実際のデータに合わせて変更してください
filtered = df[df['type_name'] == '駆逐艦']
print(filtered)
```

### グループ化と集計

```python
import fusou_datasets

df = fusou_datasets.load("ship_type")

# グループごとの集計
# カラム名は実際のデータに合わせて変更してください
grouped = df.groupby('category').size()
print(grouped)
```

### ソート

```python
import fusou_datasets

df = fusou_datasets.load("ship_type")

# 特定のカラムでソート
sorted_df = df.sort_values('id', ascending=True)
print(sorted_df.head(10))
```

---

## matplotlib を使った可視化

### 棒グラフ

```python
import fusou_datasets
import matplotlib.pyplot as plt

df = fusou_datasets.load("ship_type")

# 艦種ごとのカウント（例）
# 実際のカラム名に応じて変更してください
counts = df.groupby('type_name').size()

plt.figure(figsize=(12, 6))
counts.plot(kind='bar', color='steelblue')
plt.title('艦種別データ数', fontsize=14)
plt.xlabel('艦種')
plt.ylabel('データ数')
plt.xticks(rotation=45, ha='right')
plt.tight_layout()
plt.savefig('ship_type_distribution.png', dpi=150)
plt.show()
```

### 円グラフ

```python
import fusou_datasets
import matplotlib.pyplot as plt

df = fusou_datasets.load("ship_type")

# 上位N件を円グラフで表示
counts = df.groupby('type_name').size().sort_values(ascending=False).head(8)

plt.figure(figsize=(10, 10))
plt.pie(counts, labels=counts.index, autopct='%1.1f%%', startangle=90)
plt.title('艦種分布')
plt.savefig('ship_type_pie.png', dpi=150)
plt.show()
```

---

## 期間別データの比較分析

### 複数期間のデータ読み込み

```python
import fusou_datasets
import pandas as pd

# 期間タグを取得
info = fusou_datasets.list_period_tags()
print(f"利用可能な期間: {info['period_tags']}")

# 最新期間のデータ
df_latest = fusou_datasets.load("ship_type", period_tag="latest")
print(f"最新期間レコード数: {len(df_latest)}")

# 全期間のデータ（注意: データ量が大きくなる可能性があります）
df_all = fusou_datasets.load("ship_type", period_tag="all")
print(f"全期間レコード数: {len(df_all)}")
```

### 特定期間のデータ取得

```python
import fusou_datasets

# 特定の期間タグを指定
df = fusou_datasets.load("ship_type", period_tag="2024-12")
print(f"2024-12 のレコード数: {len(df)}")
```

### 期間ごとの比較

```python
import fusou_datasets
import pandas as pd
import matplotlib.pyplot as plt

# 期間タグを取得
info = fusou_datasets.list_period_tags()
periods = info['period_tags'][-3:]  # 直近3期間

results = []
for period in periods:
    try:
        df = fusou_datasets.load("ship_type", period_tag=period, show_progress=False)
        results.append({
            'period': period,
            'count': len(df)
        })
    except Exception as e:
        print(f"期間 {period} の取得に失敗: {e}")

# 結果をDataFrameに
comparison_df = pd.DataFrame(results)
print(comparison_df)

# 可視化
plt.figure(figsize=(10, 6))
plt.bar(comparison_df['period'], comparison_df['count'], color='steelblue')
plt.title('期間別データ数の推移')
plt.xlabel('期間')
plt.ylabel('レコード数')
plt.xticks(rotation=45)
plt.tight_layout()
plt.savefig('period_comparison.png', dpi=150)
plt.show()
```

---

## 複数テーブルの結合

```python
import fusou_datasets
import pandas as pd

# 複数テーブルを読み込み
df_ship_type = fusou_datasets.load("ship_type")
# df_ship_master = fusou_datasets.load("ship_master")  # 実際のテーブル名を使用

# 結合（共通キーがある場合）
# merged = pd.merge(df_ship_type, df_ship_master, on='id', how='left')
# print(merged.head())
```

---

## Jupyter Notebook での活用

### データフレームの対話的表示

```python
import fusou_datasets

df = fusou_datasets.load("ship_type")

# Jupyter では DataFrame がリッチに表示される
display(df.head(10))
```

### プログレスバーの制御

```python
import fusou_datasets

# Notebook ではプログレスバーがインラインで表示される
# 不要な場合は無効化
df = fusou_datasets.load("ship_type", show_progress=False)
```

---

## CSV への書き出し

```python
import fusou_datasets

df = fusou_datasets.load("ship_type")

# CSV として保存
df.to_csv("ship_type_data.csv", index=False, encoding='utf-8-sig')
print("CSV ファイルを保存しました")
```

---

## エラー処理を含む堅牢なコード

```python
import fusou_datasets
from fusou_datasets import (
    AuthenticationError,
    DatasetNotFoundError,
    FusouDatasetsError
)

def load_data_safely(table_name, period_tag="latest"):
    """エラー処理を含むデータ読み込み関数"""
    try:
        df = fusou_datasets.load(table_name, period_tag=period_tag)
        print(f"✓ {table_name} を読み込みました（{len(df)} レコード）")
        return df
    except AuthenticationError as e:
        print(f"✗ 認証エラー: {e}")
        print("  → API キーを確認してください")
        return None
    except DatasetNotFoundError as e:
        print(f"✗ データが見つかりません: {e}")
        print("  → テーブル名や期間タグを確認してください")
        return None
    except FusouDatasetsError as e:
        print(f"✗ エラー: {e}")
        return None

# 使用例
df = load_data_safely("ship_type")
if df is not None:
    print(df.head())
```

---

## Google Colab 用完全サンプル

```python
# セル1: セットアップ
!pip install fusou-datasets matplotlib

# セル2: インポートと設定
import fusou_datasets
import pandas as pd
import matplotlib.pyplot as plt

# Secrets から API キーを読み込む場合
from google.colab import userdata
fusou_datasets.configure(api_key=userdata.get('FUSOU_API_KEY'))

# セル3: テーブル一覧
tables = fusou_datasets.list_tables()
print("📋 利用可能なテーブル:")
for t in tables:
    print(f"  • {t}")

# セル4: データ読み込み
df = fusou_datasets.load("ship_type")
df.head()

# セル5: 可視化
plt.figure(figsize=(12, 6))
df.groupby('type_name').size().sort_values().plot(kind='barh')
plt.title('艦種別データ数')
plt.xlabel('データ数')
plt.tight_layout()
plt.show()
```

---

## 次のステップ

- [API リファレンス](./api_reference) - 全関数の詳細
- [トラブルシューティング](./troubleshooting) - 問題解決ガイド
