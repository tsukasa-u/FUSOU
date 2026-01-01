---
title: fusou-datasets Installation
contributors: ["tsukasa-u"]
description: >-
  fusou-datasetsライブラリのインストール方法。pip、conda、ソースからのインストール手順と依存関係、動作確認方法を解説。
date: 2026-01-01
slug: guide/fusou_datasets/installation
tags: [guide, fusou_datasets, python, installation]
---

# fusou-datasets Installation

## 動作要件

| 項目   | 要件                  |
| ------ | --------------------- |
| Python | 3.8 以上              |
| OS     | Windows, macOS, Linux |
| メモリ | 4GB 以上推奨          |

## インストール方法

### pip（推奨）

```bash
pip install fusou-datasets
```

最新の開発版をインストールする場合:

```bash
pip install --upgrade fusou-datasets
```

### conda

```bash
conda install -c conda-forge fusou-datasets
```

### ソースからインストール

開発者向け、またはリポジトリから直接インストールする場合:

```bash
git clone https://github.com/tsukasa-u/FUSOU.git
cd FUSOU/packages/fusou-datasets/python
pip install -e .
```

> [!TIP] > `-e` オプションを使用すると、コードを編集した際に再インストール不要で変更が反映されます（editable install）。

## 依存関係

fusou-datasets は以下のライブラリに依存しています。インストール時に自動的にインストールされます。

| パッケージ | バージョン | 用途                |
| ---------- | ---------- | ------------------- |
| `pandas`   | ≥1.3.0     | データフレーム操作  |
| `requests` | ≥2.25.0    | HTTP 通信           |
| `fastavro` | ≥1.4.0     | Avro 形式の読み込み |
| `tqdm`     | ≥4.60.0    | プログレスバー表示  |

### オプションの依存関係

データ分析・可視化のために、以下のパッケージも併せてインストールすることを推奨します:

```bash
pip install matplotlib seaborn jupyter
```

## 動作確認

インストール後、以下のコマンドで正常にインストールされたか確認できます:

### Python から確認

```python
import fusou_datasets

# バージョン確認
print(fusou_datasets.__version__)
# 出力例: 1.0.0
```

### CLI から確認

```bash
fusou-datasets --version
# 出力例: fusou-datasets 1.0.0
```

### クライアント ID の確認

```bash
fusou-datasets --client-id
# 出力例: Client ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

> [!IMPORTANT]
> クライアント ID は初回実行時に自動生成され、`~/.fusou_loader/settings.json` に保存されます。これはデバイス認証に使用されます。

## Google Colab でのセットアップ

```python
# Colab の場合はセルで実行
!pip install fusou-datasets

# 確認
import fusou_datasets
print(fusou_datasets.__version__)
```

## トラブルシューティング

### pip install が失敗する場合

pip を最新版にアップデートしてから再試行:

```bash
pip install --upgrade pip
pip install fusou-datasets
```

### fastavro のビルドエラー

C コンパイラが必要な場合があります:

**Ubuntu/Debian:**

```bash
sudo apt-get install build-essential python3-dev
```

**macOS:**

```bash
xcode-select --install
```

**Windows:**
[Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) をインストール

## 次のステップ

- [認証設定](./authentication) - API キーとデバイス認証の設定
- [クイックスタート](./getting_started) - 初めての使い方
