---
title: Query Engine Architecture (Internal)
contributors: ["Antigravity AI"]
description: >-
  fusou-datasets 自動結合クエリエンジンの内部構造、スキーマ生成、グラフ探索、マージ戦略に関する詳細な技術ドキュメント。
date: 2026-01-02
slug: guide/fusou_datasets/query_engine_architecture
tags: [guide, fusou_datasets, internal, architecture]
---

# Fusou Datasets Query Engine 内部構造と仕様

このドキュメントでは、`fusou-datasets` Python SDK に実装されている「自動結合エンジン (Auto-Join Query Engine)」の内部構造、アルゴリズム、およびデータハンドリングの詳細について解説します。

## 概要

`fusou-datasets` は、単なるデータローダーとしての機能に加え、複数のテーブルにまたがるデータを自動的に結合・整形して提供するクエリエンジン機能を備えています。
これにより、ユーザーは「どのテーブルとどのテーブルを結合するか」という複雑な結合ロジックを意識することなく、必要なデータ（カラム）を指定するだけで分析可能な `DataFrame` を取得できます。

## 1. データ構造とスキーマ管理

### Schema Generation

テーブル名やカラム名の定義は、Avro スキーマファイル (`kc_api_v1.json`) から自動生成されます。

- **Source**: `packages/FUSOU-WORKFLOW/schemas/kc_api_v1.json`
- **Generator**: `packages/FUSOU-WORKFLOW/scripts/gen_python_constants.py`
- **Output**: `packages/fusou-datasets/python/fusou_datasets/schema.py`

生成されるコードは、単なる文字列定数ではなく、`Column` クラスのインスタンスとして定義されます。

```python
class Column(str):
    def __new__(cls, value: str, table: str) -> "Column":
        obj = str.__new__(cls, value)
        obj.table = table  # メタデータとしてテーブル名を保持
        return obj

class Tables:
    class Battle:
        TABLE = "battle"
        TIMESTAMP = Column("timestamp", "battle")
```

これにより、`query([Tables.Battle.TIMESTAMP])` のようにカラムオブジェクトだけを渡されても、エンジン側で「これは `battle` テーブルのカラムである」と逆引きすることが可能になっています。

## 2. 関係性レジストリ (Relationship Registry)

テーブル間の結合関係は、グラフ構造（隣接リスト）として管理されています。この管理を担うのが `JoinGraph` クラスです。

- **Location**: `packages/fusou-datasets/python/fusou_datasets/query_engine.py` / `relationships.py`
- **Data Structure**: 無向グラフ（双方向リンク）

各エッジ（辺）は以下の情報を持ちます：

- 自分側の結合キーカラム
- 相手側の結合キーカラム

### 定義方法

デフォルトの関係性は `relationships.py` に定義されています。ユーザーは `register_relationship` 関数を用いて、実行時に動的に関係性を追加することも可能です。

```python
# (Table A, Col A) <---> (Table B, Col B)
graph.add(Tables.Battle.TABLE, "f_deck_id", Tables.OwnDeck.TABLE, "uuid")
```

## 3. パス探索アルゴリズム (Path Discovery)

ユーザーが複数のテーブルからカラムを指定した場合、エンジンはそれらのテーブルを繋ぐ「結合パス（Join Path）」を探索します。

### アルゴリズム: 幅優先探索 (BFS)

1.  要求されたカラムリストから、**使用するテーブルの集合** (`Target Tables`) を特定します。
2.  リストの最初のテーブルを **ベーステーブル (Base Table)** とします。
3.  ベーステーブルから、他のすべてのターゲットテーブルへの**最短パス**を、事前定義されたグラフ (`REGISTRY`) 上で幅優先探索 (BFS) により探索します。

結果として、以下のような結合ステップのリストが得られます。
`[ (Battle, f_deck_id) -> (OwnDeck, uuid), (OwnDeck, ship_ids) -> (OwnShip, uuid) ... ]`

## 4. マージ戦略 (Merge Strategy)

パスが特定されると、実際のデータロードとマージ処理が実行されます。

### Iterative Merge (反復的結合)

メモリ効率と実装の単純化のため、全テーブルを一度に結合するのではなく、ベーステーブルに対して順番に `pd.merge` を適用していく戦略（Iterative Expansion）を採用しています。

1.  **Base Table Loading**: まずベーステーブルを `load()` でメモリに読み込みます。これが初期の `main_df` となります。
2.  **Path Execution**:
    - 探索されたパス上のエッジを順に処理します。
    - まだマージされていないテーブルが出現した場合、そのテーブルを `load()` で読み込みます。
    - `pd.merge(main_df, new_df, how="inner")` を実行し、`main_df` を更新します。
3.  **Column Selection**:
    - マージに伴うカラム名の衝突（Collision）は、接尾辞 (`suffixes=("", f"_{table_name}")`) を付与することで回避します。
    - 最後に、ユーザーが要求したカラムのみを抽出して返します（※現在の実装ではデバッグ容易性のため全カラムを返す仕様の場合があります）。

### マージの種類

現在は **内部結合 (Inner Join)** のみがサポートされています。
これは、ログデータ分析において「紐付かないデータ（例：マスタに存在しない ID）」は分析対象外とすることが一般的であるためです。

## 5. 制約事項

- **1 対多の結合**: 仕様上は可能ですが、行数が爆発的に増加する可能性があります（例：戦闘ログ 1 行に対し、攻撃詳細ログが N 行結合される）。
- **メモリ使用量**: 結合は Pandas DataFrame 上で行われるため、全データがメモリに展開されます。巨大なデータセット同士の結合には注意が必要です。
- **循環参照**: グラフ探索は最短パスを返しますが、複雑な循環構造がある場合、意図しない結合ルートが選択される可能性があります。
