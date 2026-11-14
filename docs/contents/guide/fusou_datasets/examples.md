---
title: fusou-datasets Examples
contributors: ["antigravity-ai"]
description: >-
  fusou-datasetsを使ったデータ分析の実践的なサンプルコード。pandas、matplotlibを使った艦種データの可視化、期間別比較分析の例。
date: 2026-11-15
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

# 艦種マスタデータを読み込み
df = fusou_datasets.load_master("mst_stypes")

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

df = fusou_datasets.load_master("mst_stypes")

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

df = fusou_datasets.load_master("mst_stypes")

# 条件でフィルタリング（例: 駆逐艦）
filtered = df[df['name'] == '駆逐艦']
print(filtered)
```

### ソート

```python
import fusou_datasets

df = fusou_datasets.load_master("mst_stypes")

# ソート順 (sortno) でソート
sorted_df = df.sort_values('sortno', ascending=True)
print(sorted_df[['id', 'sortno', 'name']].head(10))
```

---

## matplotlib を使った可視化

### 棒グラフ

```python
import fusou_datasets
import matplotlib.pyplot as plt

df_ships = fusou_datasets.load_master("mst_ships")
df_stypes = fusou_datasets.load_master("mst_stypes")

# 艦種ごとの艦船数集計（例: stype カラムでグルーピング）
counts = df_ships.groupby('stype').size()
stype_names = df_stypes.set_index('id')['name']
counts.index = counts.index.map(lambda s: stype_names.get(s, str(s)))

plt.figure(figsize=(12, 6))
counts.sort_values(ascending=False).plot(kind='bar', color='steelblue')
plt.title('艦種別艦船数', fontsize=14)
plt.xlabel('艦種')
plt.ylabel('艦船数')
plt.xticks(rotation=45, ha='right')
plt.tight_layout()
plt.savefig('mst_stypes_distribution.png', dpi=150)
plt.show()
```

### 円グラフ

```python
import fusou_datasets
import matplotlib.pyplot as plt

df_ships = fusou_datasets.load_master("mst_ships")
df_stypes = fusou_datasets.load_master("mst_stypes")

stype_names = df_stypes.set_index('id')['name']
counts = df_ships.groupby('stype').size().sort_values(ascending=False).head(8)
labels = [stype_names.get(s, str(s)) for s in counts.index]

plt.figure(figsize=(10, 10))
plt.pie(counts, labels=labels, autopct='%1.1f%%', startangle=90)
plt.title('上位艦種分布')
plt.savefig('mst_stypes_pie.png', dpi=150)
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
df_latest = fusou_datasets.load("mst_stypes", period_tag="latest")
print(f"最新期間レコード数: {len(df_latest)}")

# 全期間のデータ（注意: データ量が大きくなる可能性があります）
df_all = fusou_datasets.load("mst_stypes", period_tag="all")
print(f"全期間レコード数: {len(df_all)}")
```

### 特定期間のデータ取得

```python
import fusou_datasets

# 特定の期間タグを指定（list_period_tags() で取得したタグを指定）
info = fusou_datasets.list_period_tags()
target_tag = info['period_tags'][0]
df = fusou_datasets.load("mst_stypes", period_tag=target_tag)
print(f"{target_tag} のレコード数: {len(df)}")
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
        df = fusou_datasets.load("mst_stypes", period_tag=period, show_progress=False)
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
df_stypes = fusou_datasets.load_master("mst_stypes")
df_ships = fusou_datasets.load_master("mst_ships")

# 結合（艦船マスタの stype と艦種マスタの id）
merged = pd.merge(df_ships, df_stypes, left_on='stype', right_on='id', how='left', suffixes=('', '_stype'))
print(merged[['id', 'name', 'name_stype']].head())
```

---

## Jupyter Notebook での活用

### データフレームの対話的表示

```python
import fusou_datasets

df = fusou_datasets.load("mst_stypes")

# Jupyter では DataFrame がリッチに表示される
display(df.head(10))
```

### プログレスバーの制御

```python
import fusou_datasets

# Notebook ではプログレスバーがインラインで表示される
# 不要な場合は無効化
df = fusou_datasets.load("mst_stypes", show_progress=False)
```

---

## CSV への書き出し

```python
import fusou_datasets

df = fusou_datasets.load("mst_stypes")

# CSV として保存
df.to_csv("mst_stypes_data.csv", index=False, encoding='utf-8-sig')
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
df = load_data_safely("mst_stypes")
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
df_stypes = fusou_datasets.load_master("mst_stypes")
df_stypes.head()

# セル5: 可視化
df_ships = fusou_datasets.load_master("mst_ships")
stype_names = df_stypes.set_index('id')['name']
counts = df_ships.groupby('stype').size()
counts.index = counts.index.map(lambda s: stype_names.get(s, str(s)))

plt.figure(figsize=(12, 6))
counts.sort_values().plot(kind='barh')
plt.title('艦種別艦船数')
plt.xlabel('艦船数')
plt.tight_layout()
plt.show()
```

---

## 次のステップ

- [API リファレンス](./api_reference) - 全関数の詳細
- [トラブルシューティング](./troubleshooting) - 問題解決ガイド
