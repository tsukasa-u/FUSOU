---
title: fusou-datasets Getting Started
contributors: ["antigravity-ai"]
description: >-
  fusou-datasets ライブラリを使って艦これ研究データを取得するための初心者向けクイックスタートガイド。3ステップで始める手順、データ分割、シナジーデータの活用法を紹介。
date: 2026-09-20
slug: guide/fusou_datasets/getting_started
tags: [guide, fusou_datasets, python, data_analysis]
---

# fusou-datasets Getting Started

fusou-datasets は、FUSOU プロジェクトが収集・公開する艦これ研究データセットに簡単にアクセスするための Python ライブラリです。

## 主な特徴

- **簡単なデータ取得**: 戦闘ログ、マス遷移、編成データを pandas DataFrame として直接ロード
- **3分割データセット**: `train`（学習・探索用 70%）、`validation`（公開検証用 20%）、`test`（ブラインド評価用 10%）により再現性と科学的妥当性を担保
- **ローカルキャッシュ**: Apache Parquet / JSON による高速なローカルキャッシュとオフライン対応
- **シナジー＆成長データ**: 装備特効・シナジーボーナスおよびレベル別成長曲線の標準サポート

## 3ステップで始める

### 1. インストール

```bash
pip install fusou-datasets
```

### 2. 初期設定（APIキー・キャッシュ）

```python
import fusou_datasets as fd

# セッション共通設定（キャッシュ先、期間、スキーマバージョン）
fd.configure(
    api_key="your_api_key",     # または環境変数 FUSOU_API_KEY
    cache_dir="./data/cache",   # ローカルキャッシュディレクトリ
    period_tag="latest",       # 最新期間データ
    table_version="0.6.0"      # スキーマバージョン
)
```

> [!TIP]> API キーは [FUSOU Web サイト](https://fusou.dev) のダッシュボードから取得できます。

### 3. データの取得と検証

```python
# 1. 戦闘マスデータの取得（train分割）
train_df = fd.load("cells", split="train")
print("Train records:", len(train_df))

# 2. 公開検証用データの取得（validation分割）
val_df = fd.load("cells", split="validation")
print("Validation records:", len(val_df))

# 3. 装備シナジーデータの取得
synergy = fd.load_synergy(period_tag="latest")
print(synergy.single_bonuses.head())
```

## Google Colab での実行

Google Colab では Google アカウント認証による Device Trust に対応しています。

```python
!pip install fusou-datasets

import fusou_datasets as fd
from google.colab import userdata

fd.configure(
    api_key=userdata.get('FUSOU_API_KEY'),
    cache_dir="/content/cache"
)

df = fd.load("cells", split="train")
df.head()
```

## 次のステップ

- [API リファレンス](./api_reference) - 全関数の仕様・引数・戻り値
- [認証とDevice Trust](./authentication) - APIキーおよび端末認証の詳細
- [検証サンプルコード](./examples) - 砲撃戦ダメージ、夜戦キャップ、命中回避の検証ノートブック
