---
title: fusou-datasets API Reference
contributors: ["tsukasa-u"]
description: >-
  fusou-datasetsライブラリの完全APIリファレンス。全関数、パラメータ、戻り値、例外クラス、CLIコマンドの詳細仕様。
date: 2026-01-01
slug: guide/fusou_datasets/api_reference
tags: [guide, fusou_datasets, python, api, reference]
---

# fusou-datasets API Reference

fusou-datasets v1.0.0 の完全 API リファレンスです。

## 関数一覧

| 関数                 | 説明                              |
| -------------------- | --------------------------------- |
| `configure()`        | API キーと URL を設定             |
| `save_api_key()`     | API キーをローカルに永続保存      |
| `list_tables()`      | 利用可能なテーブル一覧を取得      |
| `list_period_tags()` | 期間タグ一覧を取得                |
| `load()`             | データを DataFrame として読み込み |
| `get_client_id()`    | クライアント ID を取得            |

---

## configure

```python
fusou_datasets.configure(
    api_key: Optional[str] = None,
    api_url: Optional[str] = None
) -> None
```

API 認証情報を設定します。

### パラメータ

| パラメータ | 型              | 説明                                                                            |
| ---------- | --------------- | ------------------------------------------------------------------------------- |
| `api_key`  | `str`, optional | FUSOU API キー                                                                  |
| `api_url`  | `str`, optional | API エンドポイント URL（デフォルト: `https://fusou.pages.dev/api/data-loader`） |

### 使用例

```python
import fusou_datasets

# API キーのみ設定
fusou_datasets.configure(api_key="your_api_key")

# カスタム URL も設定
fusou_datasets.configure(
    api_key="your_api_key",
    api_url="https://custom.example.com/api/data-loader"
)
```

---

## save_api_key

```python
fusou_datasets.save_api_key(api_key: str) -> None
```

API キーを設定ファイルに永続保存します。

### パラメータ

| パラメータ | 型    | 説明              |
| ---------- | ----- | ----------------- |
| `api_key`  | `str` | 保存する API キー |

### 保存先

`~/.fusou_loader/settings.json`

### 使用例

```python
import fusou_datasets

fusou_datasets.save_api_key("your_api_key")
# 次回以降、自動的にこのキーが使用されます
```

---

## list_tables

```python
fusou_datasets.list_tables() -> List[str]
```

利用可能なテーブル名の一覧を取得します。

### 戻り値

| 型          | 説明               |
| ----------- | ------------------ |
| `List[str]` | テーブル名のリスト |

### 例外

| 例外                    | 条件                                           |
| ----------------------- | ---------------------------------------------- |
| `AuthenticationError`   | API キーが無効または未設定                     |
| `DeviceUnverifiedError` | デバイス認証が必要（自動的に認証フローが開始） |
| `FusouDatasetsError`    | その他のエラー                                 |

### 使用例

```python
import fusou_datasets

tables = fusou_datasets.list_tables()
print(tables)
# 出力例: ['ship_type', 'ship_master', 'equipment', ...]

# テーブル一覧を整形表示
for i, table in enumerate(tables, 1):
    print(f"{i}. {table}")
```

---

## list_period_tags

```python
fusou_datasets.list_period_tags() -> Dict[str, Any]
```

利用可能な期間タグと最新タグを取得します。

### 戻り値

| 型               | 説明                                                   |
| ---------------- | ------------------------------------------------------ |
| `Dict[str, Any]` | `period_tags`（リスト）と `latest`（文字列）を含む辞書 |

### 戻り値の構造

```python
{
    "period_tags": ["2024-10", "2024-11", "2024-12", ...],
    "latest": "2024-12"
}
```

### 使用例

```python
import fusou_datasets

info = fusou_datasets.list_period_tags()

# 最新の期間タグ
print(f"最新: {info['latest']}")
# 出力例: 最新: 2024-12

# 利用可能な全期間
print(f"期間タグ: {info['period_tags']}")
# 出力例: 期間タグ: ['2024-10', '2024-11', '2024-12']
```

---

## load

```python
fusou_datasets.load(
    table: str,
    period_tag: str = "latest",
    limit: int = 100,
    show_progress: bool = True
) -> pd.DataFrame
```

指定したテーブルのデータを pandas DataFrame として読み込みます。

### パラメータ

| パラメータ      | 型     | デフォルト | 説明                                              |
| --------------- | ------ | ---------- | ------------------------------------------------- |
| `table`         | `str`  | 必須       | テーブル名（`list_tables()` で確認）              |
| `period_tag`    | `str`  | `"latest"` | 期間タグ（`"latest"`, `"all"`, または特定のタグ） |
| `limit`         | `int`  | `100`      | 読み込む最大ファイル数                            |
| `show_progress` | `bool` | `True`     | プログレスバーを表示するか                        |

### period_tag の値

| 値          | 説明                 |
| ----------- | -------------------- |
| `"latest"`  | 最新の期間のみ       |
| `"all"`     | 全期間を結合         |
| `"2024-12"` | 特定の期間タグ（例） |

### 戻り値

| 型             | 説明               |
| -------------- | ------------------ |
| `pd.DataFrame` | 読み込まれたデータ |

### 例外

| 例外                   | 条件                       |
| ---------------------- | -------------------------- |
| `ValueError`           | テーブル名が空             |
| `DatasetNotFoundError` | 指定したデータが存在しない |
| `AuthenticationError`  | 認証エラー                 |
| `FusouDatasetsError`   | その他のエラー             |

### 使用例

```python
import fusou_datasets

# 最新期間のデータを取得
df = fusou_datasets.load("ship_type")
print(df.head())

# 特定期間のデータを取得
df = fusou_datasets.load("ship_type", period_tag="2024-12")

# 全期間のデータを結合して取得
df = fusou_datasets.load("ship_type", period_tag="all")

# プログレスバーなしで読み込み
df = fusou_datasets.load("ship_type", show_progress=False)

# ファイル数を制限
df = fusou_datasets.load("ship_type", limit=10)
```

---

## get_client_id

```python
fusou_datasets.get_client_id() -> str
```

現在のデバイスのクライアント ID を取得します。

### 戻り値

| 型    | 説明                       |
| ----- | -------------------------- |
| `str` | UUID 形式のクライアント ID |

### 使用例

```python
import fusou_datasets

client_id = fusou_datasets.get_client_id()
print(client_id)
# 出力例: 550e8400-e29b-41d4-a716-446655440000
```

---

## 例外クラス

### FusouDatasetsError

すべての fusou-datasets 例外の基底クラス。

```python
class FusouDatasetsError(Exception):
    """Base exception."""
    pass
```

### AuthenticationError

API キーが無効または未設定の場合に発生。

```python
class AuthenticationError(FusouDatasetsError):
    """Invalid or missing API key."""
    pass
```

### DeviceUnverifiedError

デバイス認証が必要な場合に発生。通常は自動的に認証フローが開始されます。

```python
class DeviceUnverifiedError(FusouDatasetsError):
    """Device requires verification."""
    pass
```

### DatasetNotFoundError

指定したデータセットが見つからない場合に発生。

```python
class DatasetNotFoundError(FusouDatasetsError):
    """Dataset not found."""
    pass
```

### VerificationError

デバイス認証に失敗した場合に発生。

```python
class VerificationError(FusouDatasetsError):
    """Verification failed."""
    pass
```

### 例外処理の例

```python
import fusou_datasets
from fusou_datasets import (
    FusouDatasetsError,
    AuthenticationError,
    DatasetNotFoundError
)

try:
    df = fusou_datasets.load("unknown_table")
except AuthenticationError as e:
    print(f"認証エラー: {e}")
except DatasetNotFoundError as e:
    print(f"データが見つかりません: {e}")
except FusouDatasetsError as e:
    print(f"予期しないエラー: {e}")
```

---

## CLI コマンド

fusou-datasets は CLI からも操作できます。

### バージョン確認

```bash
fusou-datasets --version
# 出力: fusou-datasets 1.0.0
```

### クライアント ID 表示

```bash
fusou-datasets --client-id
# 出力: Client ID: 550e8400-e29b-41d4-a716-446655440000
```

### テーブル一覧

```bash
fusou-datasets --tables
# 出力:
# ship_type
# ship_master
# equipment
# ...
```

### 期間タグ一覧

```bash
fusou-datasets --period-tags
# 出力: Latest: 2024-12
```

---

## 定数

| 定数               | 値                                          | 説明                               |
| ------------------ | ------------------------------------------- | ---------------------------------- |
| `__version__`      | `"1.0.0"`                                   | ライブラリバージョン               |
| `DEFAULT_API_URL`  | `"https://fusou.pages.dev/api/data-loader"` | デフォルト API URL                 |
| `REQUEST_TIMEOUT`  | `30`                                        | 通常リクエストのタイムアウト（秒） |
| `DOWNLOAD_TIMEOUT` | `300`                                       | ダウンロードのタイムアウト（秒）   |

---

## 次のステップ

- [サンプルコード](./examples) - 実践的なデータ分析例
- [トラブルシューティング](./troubleshooting) - 問題解決ガイド
