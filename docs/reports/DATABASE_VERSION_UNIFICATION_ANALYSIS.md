# DATABASE_TABLE_VERSION vs SCHEMA_VERSION: 深掘り分析と複数案提示

日付: 2025年12月25日  
分析対象: KanColle Avro スキーマバージョニング体系の統一化

## 1. 現状分析：用途の確認

### 1.1 DATABASE_TABLE_VERSION（既存・v0.4）

**定義:**
```
ファイル: /packages/kc_api/DATABASE_TABLE_VERSION
値: 0.4
```

**実装:**
```rust
// table.rs
pub const DATABASE_TABLE_VERSION: &str = include_str!("../../../DATABASE_TABLE_VERSION");

// models/env_info.rs
pub struct EnvInfo {
    pub version: String,  // ← DATABASE_TABLE_VERSION がここに入る
    pub uuid: EnvInfoId,
    pub user_env_unique: UserEnv,
    pub timestamp: i64,
}

impl EnvInfo {
    pub fn new_ret_uuid(...) {
        let new_data: EnvInfo = EnvInfo {
            version: DATABASE_TABLE_VERSION.to_string(),  // "0.4"
            ...
        };
    }
}
```

**用途:**
- KanColle ゲーム内データ構造（port_table）のバージョン管理
- EnvInfo オブジェクトに version フィールドとして記録
- ゲーム仕様が変わる度に更新（例：新しい艦娘属性追加時）

**保存対象:**
- port_table（バトルデータ）の一部として D1 に保存
- Avro スキーマの一部となる

**変更トリガー:**
- ゲーム側仕様変更に応じてファイル編集

---

### 1.2 SCHEMA_VERSION（新規導入・v1/v2）

**定義:**
```rust
// src/schema_version.rs
#[cfg(feature = "schema_v1")]
pub const SCHEMA_VERSION: &str = "v1";

#[cfg(feature = "schema_v2")]
pub const SCHEMA_VERSION: &str = "v2";
```

**用途:**
- Avro OCF（Object Container Format）アーカイブの互換性管理
- クライアント（FUSOU-APP）→ サーバー（FUSOU-WORKFLOW）のデータ送信で使用
- R2 にアップロードされるファイルの構造化

**保存対象:**
- D1 buffer_logs.schema_version フィールド
- R2 オブジェクトメタデータ
- R2 パス構造 `v1/{period}/{table}.avro`

**変更トリガー:**
- 運用判断で Cargo feature を切り替え
- コンパイル時に強制

---

## 2. 重要な発見：実は用途が重複している

### 問題認識
ユーザーの指摘通り、**「バージョン管理の目的は同じ」**です：

| 項目 | DATABASE_TABLE_VERSION | SCHEMA_VERSION |
|------|----------------------|-----------------|
| **目的** | KanColle データ構造の互換性管理 | Avro フォーマットの互換性管理 |
| **本質** | **データスキーマバージョン** | **データスキーマバージョン** |
| **実装** | ファイル値 + Avro に埋め込み | Feature flag + D1/R2 に記録 |
| **体系** | セマンティック（0.4） | Codename（v1/v2） |

### 具体例：破棄的変更時の流れ

```
ゲーム更新: 艦娘に新属性「消費燃料」が追加される
  ↓
DATABASE_TABLE_VERSION: 0.4 → 0.5
  ↓
Avro スキーマ変更（ship モデルに新フィールド追加）
  ↓
port_table の互換性が破壊される
  ↓
FUSOU-APP がアップロードする Avro データの形式が変わる
  ↓
サーバー側で処理方法を変える必要
  ↓
SCHEMA_VERSION: v1 → v2（?)
```

**問題:** 両者が異なるタイミング・方法で管理されている可能性がある

---

## 3. 複数の案を提示

### 案A: 「互換性を最大化する」- 両システムを統一

#### A-1. v0形式を採用（DATABASE_TABLE_VERSIONを統一）

**コンセプト:**
- DATABASE_TABLE_VERSION（0.4）をシングルソースオブトゥルース
- SCHEMA_VERSION は削除し、DATABASE_TABLE_VERSION の値を使用

**実装:**
```rust
// src/schema_version.rs を削除
// 代わりに table.rs から参照
pub use crate::table::DATABASE_TABLE_VERSION;
pub const SCHEMA_VERSION: &str = DATABASE_TABLE_VERSION;
```

```toml
# Cargo.toml (no features needed)
[dependencies]
kc-api-database = { workspace = true }
```

```toml
# FUSOU-APP/src-tauri/Cargo.toml
kc_api = { ..., features = [] }  # feature 不要
```

**メリット:**
- ✅ シングルソース管理：DATABASE_TABLE_VERSION 一つだけ
- ✅ 自動同期：ゲーム更新で 0.5 に上げるだけで全体が追従
- ✅ 統一体系：セマンティック版（0.4, 0.5, ...）で統一
- ✅ シンプル：feature flag 不要

**デメリット:**
- ❌ Avro スキーマ変更と feature の紐付けができない
- ❌ 将来、アーカイブ形式だけを変更したい場合に対応できない
- ❌ 既に SCHEMA_VERSION を他の箇所で使っているなら大量変更必要

**適用シナリオ:**
- ゲーム仕様変更 = 必ずアーカイブ形式も変わる場合（現在の実装）
- feature flag が不要な場合

---

#### A-2. v1形式に統一（SCHEMA_VERSIONを統一）

**コンセプト:**
- SCHEMA_VERSION（v0, v1, v2...）をシングルソース
- DATABASE_TABLE_VERSION は廃止し、Avro スキーマバージョンで管理

**実装:**
```rust
// src/schema_version.rs を拡張
#[cfg(feature = "schema_v0")]
pub const SCHEMA_VERSION: &str = "v0";
pub const DATABASE_TABLE_VERSION: &str = "v0";

#[cfg(feature = "schema_v1")]
pub const SCHEMA_VERSION: &str = "v1";
pub const DATABASE_TABLE_VERSION: &str = "v1";
```

```rust
// models/env_info.rs
pub fn new_ret_uuid(...) {
    let new_data: EnvInfo = EnvInfo {
        version: SCHEMA_VERSION.to_string(),  // "v0" or "v1"
        ...
    };
}
```

```toml
# Cargo.toml
[features]
default = ["schema_v0"]
schema_v0 = []
schema_v1 = []
```

**メリット:**
- ✅ Feature flag で版管理
- ✅ コンパイル時エラーで互換性チェック
- ✅ セマンティック版より扱いやすい
- ✅ 既にコード実装済みなので変更最小限

**デメリット:**
- ❌ 従来の "0.4" 形式から "v0" への移行が必要
- ❌ DATABASE_TABLE_VERSION ファイルが不要になる
- ❌ 既存ログとの互換性確認が必要
- ❌ Codename 方式（v0, v1, v2）は従来と異なる体系

**適用シナリオ:**
- 既存スキーマバージョンをクリーンアップしたい
- Codename 体系（v0→v1→v2）で進化させたい

---

### 案B: 「互換性を両立させる」- 2つのバージョンを並行管理

#### B-1. 階層化（推奨）

**コンセプト:**
- DATABASE_TABLE_VERSION：ゲームデータ構造の版（0.4, 0.5, ...）
- SCHEMA_VERSION：アーカイブ形式の版（v1, v2, ...）
- 両者は独立だが、相関関係を D1 に記録

**実装:**
```rust
// src/schema_version.rs（現在の実装のまま）
#[cfg(feature = "schema_v1")]
pub const SCHEMA_VERSION: &str = "v1";

#[cfg(feature = "schema_v2")]
pub const SCHEMA_VERSION: &str = "v2";

// 新規：VERSION_MAPPING を追加
pub struct VersionInfo {
    pub schema_version: &'static str,      // "v1", "v2"
    pub compatible_from: &'static str,     // "0.4", "0.5"
    pub compatible_until: Option<&'static str>,  // "0.4" or None
}

pub const VERSION_COMPATIBILITY: &[VersionInfo] = &[
    VersionInfo {
        schema_version: "v1",
        compatible_from: "0.4",
        compatible_until: None,  // 今後ゲーム版が進むと...
    },
    // 将来：v2 は 0.5 以上に対応
    // VersionInfo {
    //     schema_version: "v2",
    //     compatible_from: "0.5",
    //     compatible_until: None,
    // },
];
```

```sql
-- D1 buffer_logs テーブルに追加
ALTER TABLE buffer_logs ADD COLUMN database_table_version TEXT DEFAULT '0.4';

-- 例：ゲーム仕様が 0.5 になった時
-- database_table_version = '0.5', schema_version = 'v1' ならサーバーが v1 パーサー + 0.5 スキーマで処理
```

```typescript
// FUSOU-WORKFLOW/src/buffer-consumer.ts
interface BufferLogRecord {
    dataset_id: string;
    table_name: string;
    period_tag: string;
    schema_version: string;        // "v1", "v2"
    database_table_version: string;  // "0.4", "0.5"（ゲーム構造版）
    timestamp: number;
    data: ArrayBuffer;
}
```

**メリット:**
- ✅ 両者を完全に分離管理（互いに影響なし）
- ✅ ゲーム更新と Avro 形式変更が独立
- ✅ 段階的移行が可能
- ✅ 将来の柔軟性が高い

**デメリット:**
- ❌ バージョン管理が複雑（2つ追跡）
- ❌ D1 スキーマに新フィールド追加必要
- ❌ 互換性マトリックスをメンテナンス必要

**適用シナリオ:**
- アーカイブ形式とゲームデータが独立に進化する可能性
- 将来 v2 で Avro スキーマ変更する予定
- 旧 v1 データとの両立が必要

---

#### B-2. マッピング表（複雑さの緩和）

**コンセプト:**
- バージョン対応表を JSON で定義
- ランタイムで検証・ロギング

**実装:**
```rust
// src/version_mapping.rs
pub struct VersionMap {
    pub schema_version: &'static str,
    pub game_version_min: &'static str,
    pub game_version_max: Option<&'static str>,
}

pub const VERSION_MAP: &[VersionMap] = &[
    VersionMap {
        schema_version: "v1",
        game_version_min: "0.4",
        game_version_max: None,
    },
];

pub fn is_compatible(schema_v: &str, game_v: &str) -> bool {
    VERSION_MAP.iter().any(|m| {
        m.schema_version == schema_v &&
        game_v >= m.game_version_min &&
        m.game_version_max.map_or(true, |max| game_v <= max)
    })
}
```

```typescript
// FUSOU-WORKFLOW/src/cron.ts
const versionCheck = checkVersionCompatibility(
    record.schema_version,
    record.database_table_version
);
if (!versionCheck.compatible) {
    logger.warn(
        `Version mismatch: schema_v${record.schema_version} does not support game v${record.database_table_version}`,
        { record }
    );
}
```

**メリット:**
- ✅ 互換性チェックが明示的
- ✅ ログで検出可能
- ✅ 将来の破棄的変更に対応

**デメリット:**
- ❌ メンテナンスコスト増加
- ❌ テストケースが増加

---

### 案C: 「妥協的アプローチ」- ハイブリッド

#### C-1. 当面は現状維持、将来への準備

**コンセプト:**
- 現在：DATABASE_TABLE_VERSION（0.4）と SCHEMA_VERSION（v1）を並行運用
- 将来：ゲーム版が変わったら（例：0.5）、その時点で統一を判断

**実装:**
```rust
// 現在のままで、ドキュメントを充実させる
pub const SCHEMA_VERSION: &str = "v1";

// README に関連付けを記載
// "SCHEMA_VERSION v1 は DATABASE_TABLE_VERSION 0.4 に対応"
// "0.5 になったら、v1 をそのまま使用するか、v2 を新規作成するか判断"
```

**メリット:**
- ✅ コード変更ゼロ
- ✅ 将来の判断を先延ばしできる
- ✅ データが溜まってから最適化可能

**デメリット:**
- ❌ 技術的負債が残る
- ❌ ドキュメント同期が重要
- ❌ 後から統一は困難（旧データ対応必要）

---

#### C-2. 名前変更による明示化

**コンセプト:**
- SCHEMA_VERSION を DATA_FORMAT_VERSION に改名
- 「Avro フォーマットの版」を明確化
- DATABASE_TABLE_VERSION（ゲーム構造版）との区別を明確化

**実装:**
```rust
// src/data_format_version.rs（schema_version.rs から改名）
pub const DATA_FORMAT_VERSION: &str = "v1";
pub const CORRESPONDING_DATABASE_VERSION: &str = "0.4";
```

```typescript
// 送信時
{
    dataset_id: "...",
    data_format_version: "v1",      // ← 明確
    database_version: "0.4",         // ← 明確
    ...
}
```

**メリット:**
- ✅ 両者の区別が命名で明確
- ✅ ドキュメント化が容易
- ✅ 将来の統合時に戻しやすい

**デメリット:**
- ❌ リネーム作業が必要
- ❌ 既存コードの大量変更

---

## 4. 推奨案の選択マトリックス

### 優先度別推奨：

| シナリオ | 推奨案 | 理由 |
|--------|------|------|
| **現在すぐ実装** | **B-1 階層化** | 最も将来対応が柔軟で、複雑度は許容範囲 |
| **最小コスト** | **C-1 現状維持** | コード変更ゼロ、ドキュメント整備で対応 |
| **将来シンプル** | **A-2 v1統一** | 長期的には最も保守性高い |
| **既存尊重** | **A-1 v0統一** | 従来の 0.4 体系を保持したい場合 |
| **最高の明示性** | **C-2 改名** | 名前で一発で区別つく |

---

## 5. 各案の実装難易度と工数

| 案 | コード変更量 | D1 スキーマ変更 | テスト工数 | 後戻り難易度 |
|----|-----------|------------|--------|---------|
| A-1 | 中（削除） | なし | 低 | 困難 |
| A-2 | 中（リネーム） | なし | 中 | 困難 |
| B-1 | 小（追加） | あり | 中 | 容易 |
| B-2 | 小（追加） | あり | 高 | 容易 |
| C-1 | なし | なし | なし | N/A |
| C-2 | 大（リネーム） | なし | 低 | 中 |

---

## 6. 最優先推奨案の詳細実装計画

### **案B-1: 階層化（統一性と柔軟性のバランス）**

#### 段階1：D1 スキーマ拡張（即実施）

```sql
ALTER TABLE buffer_logs ADD COLUMN database_table_version TEXT DEFAULT '0.4';
CREATE INDEX idx_buffer_versions ON buffer_logs (schema_version, database_table_version);
```

#### 段階2：コード更新（最小限）

```rust
// src/version_compat.rs（新規）
pub struct VersionInfo {
    pub schema_version: &'static str,
    pub game_version_min: &'static str,
}

pub const CURRENT_COMPATIBILITY: &[VersionInfo] = &[
    VersionInfo {
        schema_version: "v1",
        game_version_min: "0.4",
    },
];
```

```typescript
// buffer-consumer.ts
interface BufferLogRecord {
    ...
    database_table_version: string = DATABASE_TABLE_VERSION;  // "0.4"
}
```

#### 段階3：ドキュメント整備

```markdown
# Version Management Guide

## Versions

- **SCHEMA_VERSION (v1/v2/...)**: Avro フォーマット版（Cargo feature で制御）
- **DATABASE_TABLE_VERSION (0.4/0.5/...)**: ゲーム構造版（ファイルで管理）

## Compatibility Matrix

| Schema | Compatible From | Notes |
|--------|-----------------|-------|
| v1     | 0.4+            | Current, supports 0.4 and beyond |
| v2     | 0.5+            | Future |

## Migration Flow

ゲーム仕様が 0.5 に更新される場合：
1. DATABASE_TABLE_VERSION: 0.4 → 0.5 に変更
2. SCHEMA_VERSION v1 が 0.5 に対応するか判定
3. 非対応なら、新規に SCHEMA_VERSION v2 を実装
```

---

## 7. 今後の進化シナリオ

### シナリオ1：ゲーム 0.5 更新（互換）

```
ゲーム更新：艦娘に新属性追加（後方互換）
  ↓
DATABASE_TABLE_VERSION: 0.4 → 0.5
  ↓
SCHEMA_VERSION v1 で対応可能
  ↓
Avro スキーマに新フィールド追加（optional）
  ↓
v1 のまま運用継続
```

### シナリオ2：ゲーム 0.5 更新（破棄的）

```
ゲーム更新：艦娘の既存フィールドを削除（破棄的変更）
  ↓
DATABASE_TABLE_VERSION: 0.4 → 0.5
  ↓
SCHEMA_VERSION v1 では対応不可
  ↓
新規に SCHEMA_VERSION v2 実装
  ↓
feature 切り替え：schema_v1 → schema_v2
  ↓
旧 v1 データと新 v2 データが R2 に混在
  ↓
読取時に自動判別
```

### シナリオ3：Avro フォーマット最適化（ゲーム無関係）

```
パフォーマンス改善：Avro OCF のブロック化戦略を変更
  ↓
ゲームデータ自体は変わらない
  ↓
SCHEMA_VERSION: v1 → v2 に更新
  ↓
DATABASE_TABLE_VERSION: 0.4 のままで v2 使用
  ↓
新フォーマットが 0.4 ゲームデータに対応
```

---

## 結論：推奨実装ロードマップ

### 当面（今週）：案C-1 現状維持 + ドキュメント充実
- コード変更ゼロ
- ドキュメント：`VERSION_COMPATIBILITY.md` 作成
- 関連付け明記：「SCHEMA_VERSION v1 は DATABASE_TABLE_VERSION 0.4 に対応」

### 中期（1-2ヶ月後）：案 B-1 段階的導入
- D1 に `database_table_version` カラム追加
- FUSOU-WORKFLOW で両バージョン記録開始
- ドキュメント：互換性マトリックス更新

### 長期（半年以上）：段階2・3 の追加実装
- ゲーム 0.5 対応が決まったら、その時点で v2 実装判定
- 必要に応じて案 B-2（互換性チェック機能）導入

---

## 最終判断基準：何を重視するか？

| 重視項目 | 推奨案 |
|---------|------|
| **短期での実装速度** | C-1 |
| **長期の保守性** | B-1 |
| **従来体系の継続** | A-1 |
| **最新ベストプラクティス** | A-2 |
| **柔軟性とコスト均衡** | **B-1（推奨）** |
