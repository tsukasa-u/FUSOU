---
title: fusou-datasets API Reference
contributors: ["antigravity-ai"]
description: >-
  fusou-datasets ライブラリの完全APIリファレンス。全関数、パラメータ、戻り値、3分割split、シナジー、成長データ、クエリビルダーの詳細仕様。
date: 2026-09-20
slug: guide/fusou_datasets/api_reference
tags: [guide, fusou_datasets, python, api, reference]
---

# fusou-datasets API Reference

fusou-datasets Python SDK の完全 API リファレンスです。

## 関数・クラス一覧

| 関数 / クラス | 説明 |
| ------------- | ---- |
| `configure()` | APIキー、URL、キャッシュ、デフォルトバージョン/期間の設定 |
| `get_config()` | 現在の設定内容を取得 |
| `save_api_key()` | APIキーをローカル設定ファイルに永続保存 |
| `list_tables()` | 利用可能なテーブル一覧を取得 |
| `list_period_tags()` | 利用可能なピリオドタグ（期間）一覧を取得 |
| `load()` | データセットを pandas DataFrame として読み込み（3分割split対応） |
| `load_synergy()` | 装備シナジーボーナスデータを取得（ローカルキャッシュ対応） |
| `SynergyData` | シナジーボーナス・クロスシナジーの構造化表現クラス |
| `load_growth_snapshot()` | 艦娘パラメータ成長推移（素ステータス・キャップ値）を取得 |
| `load_speed_observation()` | 速力観測データを取得 |
| `load_master()` | マスタデータテーブル（mst_*）を取得 |
| `VerificationDataset` | 仮説検証用のフルーエントクエリビルダー |
| `DatasetQuery` | Django風フィルタ、Arrow C Stream 対応クエリオブジェクト |
| `get_client_id()` | デバイス信頼認証用のクライアントIDを取得 |
| `clear_cache()` | ローカルキャッシュをクリア |

---

## configure

```python
fusou_datasets.configure(
    api_key: Optional[str] = None,
    api_url: Optional[str] = None,
    cache_dir: Optional[str] = None,
    period_tag: Optional[str] = None,
    table_version: Optional[str] = None,
) -> None
```

セッション全体の共通設定（APIキー、キャッシュ、デフォルト期間・テーブルバージョン）を構成します。

### パラメータ

| パラメータ | 型 | 説明 |
| ---------- | -- | ---- |
| `api_key` | `str`, optional | FUSOU APIキー |
| `api_url` | `str`, optional | APIエンドポイントURL（デフォルト: `https://fusou.dev/api/data-loader`） |
| `cache_dir` | `str`, optional | ローカルキャッシュディレクトリ（指定でParquet/JSONキャッシュが有効化） |
| `period_tag` | `str`, optional | デフォルトピリオドタグ（例: `'latest'`, `'2026-09'`） |
| `table_version` | `str`, optional | デフォルトスキーマテーブルバージョン（例: `'0.6.0'`） |

### 使用例

```python
import fusou_datasets as fd

fd.configure(
    period_tag="2026-09",
    table_version="0.6.0",
    cache_dir="./data/cache",
    api_key="your_api_key"
)
```

---

## get_config

```python
fusou_datasets.get_config() -> Dict[str, Any]
```

現在の設定辞書（`api_key`, `api_url`, `cache_dir`, `period_tag`, `table_version`）のコピーを返します。

---

## load

```python
fusou_datasets.load(
    table: str,
    period_tag: Optional[str] = None,
    limit: int = 100,
    show_progress: bool = True,
    force_download: bool = False,
    offline: bool = False,
    scope: str = "all",
    split: str = "train",
    table_version: Optional[str] = None
) -> pd.DataFrame
```

テーブルデータをダウンロードまたはローカルキャッシュから読み込み、`pd.DataFrame` として返します。

### パラメータ

| パラメータ | 型 | デフォルト | 説明 |
| ---------- | -- | ---------- | ---- |
| `table` | `str` | 必須 | テーブル名（`list_tables()` で確認可能） |
| `period_tag` | `str`, optional | `configure` 値 / `'latest'` | 期間タグ（例: `'2026-09'`, `'latest'`, `'all'`） |
| `split` | `str` | `'train'` | データ分割種別（`'train'`, `'validation'`, `'test'`） |
| `table_version` | `str`, optional | `configure` 値 | スキーマバージョン（例: `'0.6.0'`） |
| `cache_dir` | `str`, optional | `configure` 値 | キャッシュディレクトリ |
| `offline` | `bool` | `False` | サーバー通信を行わずキャッシュからのみ読み込み |
| `force_download` | `bool` | `False` | キャッシュが存在してもサーバーから再取得 |
| `scope` | `str` | `'all'` | `'all'`（全体データ）または `'own'`（自身の投稿データのみ） |
| `limit` | `int` | `100` | 読み込む最大ファイル数 |
| `show_progress` | `bool` | `True` | プログレスバーの表示 |

### 3分割 split の仕様

- **`train` (70%)**: パラメータ推定・仮説構築・探索的データ分析用。
- **`validation` (20%)**: 構築した仮説の公開検証（fusou-web検証ページなど）用。サーバー側で監査ログ（`dataset_access_log`）が記録されます。
- **`test` (10%)**: 未知データに対するブラインド評価用。一般APIキーからのアクセスはサーバー側で `403 Forbidden` となります。

---

## load_synergy

```python
fusou_datasets.load_synergy(
    period_tag: Optional[str] = None,
    offline: bool = False,
    force_download: bool = False
) -> SynergyData
```

指定したピリオドタグの装備シナジーボーナスデータを取得します。

### パラメータ

| パラメータ | 型 | デフォルト | 説明 |
| ---------- | -- | ---------- | ---- |
| `period_tag` | `str`, optional | `configure` 値 / `'latest'` | 期間タグ |
| `offline` | `bool` | `False` | キャッシュからのみ読み込み |
| `force_download` | `bool` | `False` | キャッシュを無視してサーバーから再取得 |

### 戻り値: `SynergyData`

- **`.single_bonuses` (`pd.DataFrame`)**: 単体装備ボーナス（`ship_id` × `item_id` → 各種ステータス上昇値）。
- **`.cross_synergies` (`pd.DataFrame`)**: 複数装備シナジー（`ship_id` × `item_id_1` × `item_id_2` → 各種ステータス上昇値）。
- **`.meta` (`dict`)**: バッチハッシュ、テーブルバージョン、生成日時などのメタ情報。
- **`.query(ship_id=None, item_id=None)`**: 指定した艦娘IDまたは装備IDでボーナスをフィルタ。
- **`.to_parquet(output_dir)`**: 単体ボーナスと複合シナジーを Parquet ファイルとして高速保存。

---

## load_growth_snapshot

```python
fusou_datasets.load_growth_snapshot(
    period_tag: Optional[str] = None,
    table_version: Optional[str] = None,
    offline: bool = False,
    force_download: bool = False
) -> pd.DataFrame
```

レベル別の艦娘パラメータ成長推移（素ステータス推移 `bounds` および最大値 `caps`）を取得します。

---

## VerificationDataset / DatasetQuery

仮説検証用のフルーエントクエリビルダーです。

```python
import fusou_datasets as fd

ds = fd.VerificationDataset("cells", split="validation")

query = (
    ds.filter(maparea_id=45, mapinfo_no__in=[1, 2])
      .select("maparea_id", "mapinfo_no", "cell_id")
      .limit(1000)
)

# pandas DataFrame として取得
df = query.to_dataframe()

# Apache Arrow C Data Stream インターフェース
stream = query.__arrow_c_stream__()
```
