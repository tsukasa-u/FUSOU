# Schema Version Management Analysis

## 概要
FUSOUプロジェクトに導入した`schema_version`フィーチャーフラグシステムと、既存のバージョン管理との関係を分析します。

## 現在のバージョン管理システム

### 1. DATABASE_TABLE_VERSION (kc-api-database)
**ファイル:** `/packages/kc_api/DATABASE_TABLE_VERSION`
**値:** `0.4`
**用途:** Avro スキーマのバージョン管理
**使用箇所:** 
- `models/env_info.rs` 内の `EnvInfo` 構造体
- KanColle データ構造のAvroスキーマ定義

**目的:**
- ゲーム内データ構造（port_table, cell情報など）の進化に対応
- データバージョン管理: "0.4" はゲーム更新に応じて変更
- EnvInfoのversionフィールドに記録され、D1に保存される

**例:**
```rust
pub fn new_ret_uuid(...) -> EnvInfoId {
    let new_data: EnvInfo = EnvInfo {
        version: DATABASE_TABLE_VERSION.to_string(),  // "0.4"
        uuid: new_uuid,
        user_env_unique: data.0,
        timestamp: data.1,
    };
}
```

### 2. SCHEMA_VERSION (新規導入)
**ファイル:** `/packages/kc_api/crates/kc-api-database/src/schema_version.rs`
**値:** `"v1"` (feature: schema_v1) または `"v2"` (feature: schema_v2)
**用途:** アーカイブスキーマのバージョン管理
**使用箇所:**
- FUSOU-WORKFLOW/src/cron.ts - R2アーカイブパス生成
- FUSOU-WORKFLOW/src/buffer-consumer.ts - D1バッファ保存
- FUSOU-APP/src-tauri - クライアント側データ送信

**目的:**
- Avro OCFブロック構造の互換性管理
- ファイル分割戦略の変更対応
- R2ストレージ内でのデータ整理: `{schema_version}/{period_tag}/{table_name}-{index}.avro`

**制御方法:** Cargo feature flags
- `schema_v1`: デフォルト、現在の運用スキーム
- `schema_v2`: 将来の互換性破棄変更用（未実装）

## バージョン管理の関係図

```
KanColle Game Update
        ↓
DATABASE_TABLE_VERSION (0.4, 0.5, ...)
        ↓
EnvInfo { version: "0.4", ... }
        ↓
D1 port_table, env_info
        
        (別スタック)

SCHEMA_VERSION Feature Change
        ↓
schema_v1 / schema_v2
        ↓
R2 Path: v1/period/table.avro or v2/period/table.avro
        ↓
Avro OCF Block Structure
```

## 競合分析: NO CONFLICT ✓

### 1. スコープの違い
| 項目 | DATABASE_TABLE_VERSION | SCHEMA_VERSION |
|------|----------------------|-----------------|
| **制御** | ゲーム更新に応じて | 運用判断で |
| **影響範囲** | KanColleデータ構造 | アーカイブ形式 |
| **変更頻度** | 低（ゲーム更新時） | 非常に低（互換性破棄時） |
| **保存場所** | D1 port_table/env_info | D1 buffer_logs, R2 metadata |

### 2. 依存関係の独立性
```
CLIENT                        WORKFLOW
  ↓                              ↓
FUSOU-APP                   FUSOU-WORKFLOW
  ↓                              ↓
kc_api::database::SCHEMA_VERSION
  ↓
build_battle_data_handshake() → { schema_version: "v1", ... }
  ↓
SERVER
  ↓
Queue Message + D1 buffer_logs
  ↓
Cron Worker
  ↓
D1 fetchBufferedData (SELECT schema_version)
  ↓
groupByDataset (schema_version::table_name::period_tag)
  ↓
R2: v1/{period}/{table}-{index}.avro
  ↓
EnvInfo { version: DATABASE_TABLE_VERSION, ... }  ← 独立した別フィールド
```

### 3. 具体例：将来のv2への移行シナリオ

**Scenario: Avro Schemaを変更する必要がある場合**

```
Step 1: kc-api-database/Cargo.toml に schema_v2 feature を追加
Step 2: schema_version.rs に v2 実装を追加
Step 3: FUSOU-APP の Cargo.toml で features = ["schema_v2"] に変更
Step 4: デプロイ時、新規データは v2/{period}/{table}.avro で保存
Step 5: 古いv1データはそのまま v1/{period}/{table}.avro に残存
Step 6: 読取時は schema_version フィールドで自動判別

→ DATABASE_TABLE_VERSION は独立して継続（競合なし）
```

## Feature管理アーキテクチャ

```
FUSOU-APP/src-tauri/Cargo.toml
    ↓
    kc_api = { features = ["schema_v1"] }
    ↓
kc_api/crates/kc-api/Cargo.toml
    ↓
    [features]
    schema_v1 = ["kc-api-database/schema_v1"]
    schema_v2 = ["kc-api-database/schema_v2"]
    ↓
kc_api/crates/kc-api-database/Cargo.toml
    ↓
    pub const SCHEMA_VERSION: &str = "v1" (if schema_v1)
                                    = "v2" (if schema_v2)
```

### メリット
1. **コンパイル時チェック:** 未指定時にコンパイルエラー
2. **一元管理:** 全パッケージが統一のバージョンを使用
3. **自動伝播:** feature変更時、全バイナリが再コンパイル
4. **明示的:** ドキュメント化不要の自己説明的コード

## 推奨事項

### 現在の構成（推奨）
```
FUSOU-WORKFLOW: kc-api (default features で schema_v1)
FUSOU-APP: kc-api { features = ["schema_v1"] }
kc_api/crates/kc-api: default = ["schema_v1"]
```

### 将来の移行計画（v2導入時）
```
Step 1: schema_v2 feature を実装
Step 2: 段階的に FUSOU-APP → FUSOU-WORKFLOW の順で features 変更
Step 3: 古いv1データは自動的に互換性が保証される
```

### DATABASE_TABLE_VERSIONとの共存方法
- **変更しない:** DATABASE_TABLE_VERSIONはゲーム更新に任せる
- **並行管理:** SCHEMA_VERSIONはアーカイブ形式専用
- **記録:** D1 buffer_logs に両方のバージョンを記録（将来の監査用）

**将来の改善例（任意）**
```sql
ALTER TABLE buffer_logs ADD COLUMN avro_schema_version TEXT DEFAULT 'v1';
-- database_table_version は別途 port_table/env_info に含まれる
```

## テスト方針

### v1でのテスト（現在）
```bash
cargo build --features "schema_v1"  # ✓ 成功
cargo build --features "schema_v2"  # 実装待ち
cargo build                          # ✗ エラー：feature指定が必須
```

### v2導入時のテスト
```bash
# 旧バージョンデータの読取テスト
- R2の v1/{period}/{table}.avro を読める
- D1の schema_version='v1' レコードを処理できる

# 新バージョンデータの生成テスト
- R2に v2/{period}/{table}.avro が生成される
- D1に schema_version='v2' が保存される
```

## 結論

✅ **競合なし** - 両バージョン管理システムは独立しており、相互に干渉しません
✅ **拡張性高** - v2導入時、既存アーキテクチャをそのまま活用できます
✅ **保守性高** - feature flagで明示的に版を制御でき、暗黙的な互換性問題が発生しません
