# Avro Smart Validation - 実装完了サマリー

## ユーザー指摘への対応

### ✅ 課題1：外部ファイルに依存しないスキーマ検証

**実装内容**:
- Rustプログラム内で`kc-api-database`から実行時にスキーマを生成
- クライアント送付OCFヘッダースキーマとRust内スキーマを**動的に比較**
- 一致したスキーマでデータを検証

**実現メカニズム**:
```
Client OCF → WASM抽出 → クライアントスキーマ(正規化)
                              ↓
                        Rust内スキーマセット
                        (schema_v1 or v2)
                              ↓
                        Canonical形式で比較 → Match!
                              ↓
                        Apache-avroで検証
```

**利点**:
- 外部JSONファイル不要
- スキーマの真実のソース = Rustモデル（一元管理）
- クライアント送付スキーマが改ざんされても検出可能

### ✅ 課題2：複数スキーマバージョン対応

**実装内容**:
- Cargoフィーチャーで`schema_v1`/`schema_v2`を制御
- avro-wasmで両バージョンを切り替え可能
- API切り替え時に旧バージョン・新バージョンを**並行サポート可能**

**ビルド方式**:
```bash
# v1サポート（現在）
cargo build --features schema_v1
# → WASM含む全成果物がv1スキーマを内包

# v2への移行（API切り替え時）
cargo build --features schema_v2
# → 新WASM/バイナリに切り替え

# 必要に応じてv1とv2を並行運用
# → LBでバージョン別に振り分け
```

**スキーマ差分が必要な場合**:
```rust
// kc-api-database/src/models/battle.rs
#[cfg(feature = "schema_v1")]
#[derive(AvroSchema)]
pub struct Battle { /* v1 fields */ }

#[cfg(feature = "schema_v2")]
#[derive(AvroSchema)]
pub struct Battle { /* v2 fields */ }
```

すると自動的にWASMにも反映されます。

## 実装ファイル一覧

### 1. kc-api-database側（真実のソース）

**[schema_registry.rs](../../packages/kc_api/crates/kc-api-database/src/schema_registry.rs)** - 新作成
- `get_current_schema_set()` → 33テーブルのスキーマセット
- `find_matching_schema()` → クライアントスキーマをマッチング
- `SchemaSet` / `TableSchema` → 構造体定義

**[schema_version.rs](../../packages/kc_api/crates/kc-api-database/src/schema_version.rs)** - 既存
- `SCHEMA_VERSION` → `#[cfg(feature)]`で"v1"/"v2"を切り替え
- `DATABASE_TABLE_VERSION` → "0.4"

### 2. avro-wasm側（WASM実装）

**[schema_registry.rs](../../packages/avro-wasm/src/schema_registry.rs)** - 全面書き替え
```rust
// クライアントスキーマをRust内スキーマと比較
match_client_schema(schema_json: &str) → SchemaMatchResult

// 利用可能なテーブル一覧（バージョン別）
get_available_schemas() → Vec<String>

// 現バージョンを取得
get_current_schema_version() → String
```

**[validator.rs](../../packages/avro-wasm/src/validator.rs)** - 拡張
```rust
// ✨ NEW: スマート検証（自動スキーマ判定）
validate_avro_ocf_smart(avro_data: &[u8]) → ValidationResult
  Returns: { valid, record_count, schema_version, table_name, error }

// 既存: 明示的スキーマでの検証
validate_avro_ocf(avro_data, schema_json)

// 既存: テーブル名指定での検証
validate_avro_ocf_by_table(avro_data, table_name)
```

**[Cargo.toml](../../packages/avro-wasm/Cargo.toml)** - 更新
```toml
[dependencies]
kc-api-database = { path = ".../kc-api-database", default-features = false }

[features]
default = ["schema_v1"]
schema_v1 = ["kc-api-database/schema_v1"]
schema_v2 = ["kc-api-database/schema_v2"]
```

### 3. ビルドスクリプト

**[build-wasm.sh](../../packages/avro-wasm/build-wasm.sh)** - 新作成
```bash
./build-wasm.sh v1      # v1スキーマでビルド
./build-wasm.sh v2      # v2スキーマでビルド
```

## テスト結果

```bash
$ cd packages/avro-wasm
$ cargo test --lib

running 7 tests

test schema_registry::tests::test_get_available_schemas ... ok
test schema_registry::tests::test_get_current_schema_version ... ok  
test schema_registry::tests::test_get_schema_json_invalid_table ... ok
test schema_registry::tests::test_get_schema_json_valid_table ... ok
test validator::tests::test_get_available_schemas ... ok
test validator::tests::test_get_current_version ... ok
test validator::tests::test_magic_bytes_validation ... ok

test result: ok. 7 passed; 0 failed
```

**kc-api-database側**:
```bash
$ cargo test schema_registry

running 3 tests
test schema_registry::tests::test_get_current_schema_set ... ok
test schema_registry::tests::test_schema_canonical_form ... ok
test schema_registry::tests::test_find_battle_schema ... ok

test result: ok. 3 passed; 0 failed
```

## 使用フロー

### クライアント → FUSOU-WEB（Cloudflare Workers）

```typescript
// worker.ts
export default {
  async fetch(request: Request, env: Env) {
    const avroBytes = await request.arrayBuffer();
    
    // ✨ スマート検証：スキーマ自動判定
    const result = await validateAvroOCFSmart(
      new Uint8Array(avroBytes)
    );
    
    if (result.valid) {
      // ✅ 検証成功
      console.log(`Version: ${result.schemaVersion}`);  // "v1" or "v2"
      console.log(`Table: ${result.tableName}`);        // "battle", etc.
      
      // R2に保存
      await env.BUCKET.put(
        `${result.schemaVersion}/${result.tableName}/data.avro`,
        avroBytes
      );
      
      return Response.json({ ok: true });
    } else {
      // ❌ 検証失敗
      return Response.json(
        { error: result.errorMessage },
        { status: 400 }
      );
    }
  }
};
```

### FUSOU-WORKFLOW（Node.js環境）

```typescript
import { validateAvroOCFSmart } from './src/avro-validator';

const result = await validateAvroOCFSmart(avroBytes);

if (result.valid) {
  // バージョンとテーブル情報を使用
  await db.saveMetadata({
    schemaVersion: result.schemaVersion,
    tableName: result.tableName,
    recordCount: result.recordCount,
  });
} else {
  throw new Error(result.error);
}
```

## API切り替え時の運用

```
T1 (現在): v1サポート
  └─ WASM/バイナリ: schema_v1フィーチャー
  └─ クライアント: すべてv1スキーマ送信

T2 (v1→v2移行開始): v1+v2対応
  方法A: ローカル環境で検証
    - 2つのWASMモジュール運用（v1, v2）
    - LBでバージョン判定して振り分け
    
  方法B: 段階的置き換え
    - schema_v1でビルド → 新v2スキーマ追加
    - #[cfg]で分岐させ両方内包
    - WASM内で両方検証可能に

T3 (v1廃止予定日): v2のみ
  └─ WASM/バイナリ: schema_v2フィーチャーに切り替え
  └─ クライアント: すべてv2スキーマに統一
```

## セキュリティ考慮

| 項目 | 対策 |
|------|------|
| スキーマ改ざん防止 | Canonical形式での正規化比較 |
| バージョン不一致検出 | クライアント送付スキーマが現バージョンと一致するか検証 |
| データ破損検出 | Apache-avroでレコード単位の完全性チェック |
| 真実のソース一元化 | スキーマはRust内モデルのみ（外部ファイル不使用） |

## 今後の拡張

1. **スキーマフィンガープリント**: OCFヘッダーにスキーマハッシュを埋め込み
2. **複数バージョン同時内包**: WASMサイズが許す限り両バージョン対応
3. **自動スキーマ進化検出**: 破壊的変更（breaking change）の自動検出
4. **スキーマメタデータ**: テーブル説明、フィールド説明をWASM内に含める

## ドキュメント

- [AVRO_SMART_VALIDATION.md](../AVRO_SMART_VALIDATION.md) - 詳細設計
- [AVRO_SCHEMA_REGISTRY.md](../AVRO_SCHEMA_REGISTRY.md) - 外部JSON方式（旧）

---

**重要ポイント**:
- ✅ 外部ファイル依存なし（Rust内で完全処理）
- ✅ 複数バージョン対応（フィーチャーで切り替え）
- ✅ クライアントスキーマとRust内スキーマを動的比較
- ✅ テスト全パス（7/7）
