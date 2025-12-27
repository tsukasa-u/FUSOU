# Avro Smart Validation System

## 概要

**外部ファイルに依存しない、Rust内スキーマ比較による検証システム**

クライアントがアップロードしたAvro OCFファイルから抽出したスキーマと、Rustプログラム内で生成したスキーマを**動的に比較・マッチング**して、データの正確性を確保します。

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│ Client uploads Avro OCF                                    │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│ WASM: validate_avro_ocf_smart()                            │
│  1. Extract schema from OCF header                         │
│  2. Match against Rust schemas (kc-api-database)          │
│  3. Validate data conforms to matched schema              │
│  4. Return: version + table_name + validation result      │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────┬──────────────────────────────────┐
│ kc-api-database          │ avro-wasm                        │
│ ├─ schema_registry.rs    │ ├─ validator.rs                 │
│ ├─ schema_version.rs     │ ├─ schema_registry.rs           │
│ └─ models/*              │ └─ lib.rs                       │
│                          │                                  │
│ Rust実行時に複数バージョン│ Compiled-in schema set       │
│ のスキーマを生成         │ (v1 or v2)                     │
└──────────────────────────┴──────────────────────────────────┘
```

## 主要な実装

### 1. kc-api-database/schema_registry.rs

Rust側でモデルから動的に複数バージョンのスキーマを生成：

```rust
// 現在コンパイルされたバージョンのスキーマセットを取得
pub fn get_current_schema_set() -> SchemaSet {
    // schema_v1またはschema_v2フィーチャーに応じて
    // 異なるモデル構造から33種類のテーブルスキーマを生成
}

// クライアント送付スキーマとマッチング
pub fn find_matching_schema(canonical_schema: &str) -> Option<(String, String)> {
    // (version, table_name)を返す
}
```

### 2. avro-wasm/schema_registry.rs

WASM側でのスキーママッチング：

```rust
/// クライアントOCFヘッダースキーマをRust内スキーマと比較
#[wasm_bindgen]
pub fn match_client_schema(schema_json: &str) -> SchemaMatchResult {
    // ✅ クライアントスキーマ正規化
    // ✅ Rust内スキーマセットと照合
    // ✅ マッチしたバージョン・テーブル名を返す
}

/// 利用可能なテーブル一覧（バージョン別）
#[wasm_bindgen]
pub fn get_available_schemas() -> Vec<String> { ... }
```

### 3. avro-wasm/validator.rs

スマート検証エンジン：

```rust
/// ✅ OCFヘッダースキーマを自動抽出
/// ✅ Rust内スキーマとマッチング
/// ✅ 一致したスキーマでデータ検証
/// ✅ バージョン・テーブル情報を返す
#[wasm_bindgen]
pub fn validate_avro_ocf_smart(avro_data: &[u8]) -> ValidationResult {
    // 1. Extract schema from OCF
    // 2. match_client_schema()で比較
    // 3. Apache-avroでデータ検証
    // 4. Result { valid, record_count, schema_version, table_name, error }
}
```

## マルチバージョン対応

### コンパイル時フィーチャー制御

```toml
# avro-wasm/Cargo.toml
[features]
default = ["schema_v1"]
schema_v1 = ["kc-api-database/schema_v1"]  # v1モデルセット
schema_v2 = ["kc-api-database/schema_v2"]  # v2モデルセット
```

### ビルドコマンド

```bash
# v1サポート（デフォルト）
cargo build --features schema_v1

# v2サポート
cargo build --features schema_v2

# 複数バージョンをサポート →個別のWASM/バイナリが必要
```

### API切り替え時の流れ

```
時刻T1: v1のみサポート
  └─ WEB: schema_v1フィーチャーで構築

時刻T2: v1 → v2 移行開始（両方サポート）
  └─ WEB: schema_v2フィーチャーで構築（互換性あり）
  └─ 新しいクライアントはv2スキーマ送信
  └─ 旧クライアントはv1スキーマ送信

時刻T3: v1サポート終了
  └─ WEB: schema_v2のみ（軽量化）
```

**重要**: 両バージョンを同時サポートする場合は、**2つのWASMモジュール/サーバーを並列運用**する必要があります。

## 使用例

### FUSOU-WORKFLOWでの使用

```typescript
import { validateAvroOCFSmart } from '../../avro-wasm/index';

// クライアント送付データを自動判定
const result = await validateAvroOCFSmart(avroBytes);

if (result.valid) {
  console.log(`✅ Valid!`);
  console.log(`  Version: ${result.schemaVersion}`);     // "v1" or "v2"
  console.log(`  Table: ${result.tableName}`);           // "battle", "cells", etc.
  console.log(`  Records: ${result.recordCount}`);
} else {
  console.error(`❌ Failed: ${result.errorMessage}`);
}
```

### FUSOU-WEBでの使用（Cloudflare Workers）

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const avroBytes = await request.arrayBuffer();
    
    // スマート検証（スキーマ自動判定）
    const result = await validateAvroOCFSmart(
      new Uint8Array(avroBytes)
    );
    
    return Response.json(result);
  }
};
```

### スキーマ情報の取得

```typescript
// 現在のバージョンを取得
const version = getCurrentSchemaVersion(); // "v1" or "v2"

// 利用可能なテーブル一覧
const tables = getAvailableSchemas();
// ["battle", "cells", "env_info", "airbase", ...]

// 特定テーブルのスキーマJSON取得
const battleSchema = getSchemaJson("battle");
```

## バージョン間の差異

### 現状（v1/v2同一）

```
kc-api-database
├─ schema_v1 → 33テーブル（0.4）
└─ schema_v2 → 33テーブル（0.4）
  ※完全に同じスキーマ
```

### スキーマ差分が必要な場合

条件コンパイルで分岐：

```rust
// models/battle.rs
#[cfg(feature = "schema_v1")]
#[derive(AvroSchema, ...)]
pub struct Battle {
    pub field_a: i32,
    // v1フィールド
}

#[cfg(feature = "schema_v2")]
#[derive(AvroSchema, ...)]
pub struct Battle {
    pub field_a: i32,
    pub field_b: String,  // 新フィールド
}
```

するとWASMでも自動的にバージョン別スキーマが生成されます。

## テスト結果

```bash
$ cargo test --lib
running 7 tests
test schema_registry::tests::test_get_available_schemas ... ok
test schema_registry::tests::test_get_current_schema_version ... ok
test schema_registry::tests::test_get_schema_json_invalid_table ... ok
test schema_registry::tests::test_get_schema_json_valid_table ... ok
test validator::tests::test_magic_bytes_validation ... ok
test validator::tests::test_get_available_schemas ... ok
test validator::tests::test_get_current_version ... ok

test result: ok. 7 passed; 0 failed
```

## セキュリティ特性

| 項目 | 説明 |
|------|------|
| **スキーマ正規化** | クライアントスキーマをCanonical Avro形式に正規化して比較 |
| **バージョン検証** | クライアント送付スキーマが現バージョンと一致するか検証 |
| **データ完全性** | スキーマ一致後、Apache-avroでレコード単位の検証 |
| **外部ファイル不依存** | 真実のソースはRust内モデル（分散管理なし） |

## 関連ファイル

- [kc-api-database/src/schema_registry.rs](../../kc_api/crates/kc-api-database/src/schema_registry.rs)
- [kc-api-database/src/schema_version.rs](../../kc_api/crates/kc-api-database/src/schema_version.rs)
- [avro-wasm/src/schema_registry.rs](../avro-wasm/src/schema_registry.rs)
- [avro-wasm/src/validator.rs](../avro-wasm/src/validator.rs)
- [avro-wasm/Cargo.toml](../avro-wasm/Cargo.toml)

## 次のステップ

1. **WASM最適化**: `wasm-pack build --release`でサイズ最適化
2. **エラーメッセージ改善**: スキーマ不一致時の詳細情報
3. **複数バージョン並行サポート**: Blue-Green deploymentで実装
