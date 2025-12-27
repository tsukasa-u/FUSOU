# Avro Schema Registry Integration

## Overview

kc-api-databaseのCargoフィーチャー（`schema_v1`/`schema_v2`）を使って、Avroスキーマを自動生成し、FUSOU-WEB/WORKFLOWで使用できるようにしました。

## スキーマバージョンについて

### 現状の動作

kc-api-databaseのCargoフィーチャーは以下のように定義されています：

```toml
[features]
default = ["graphviz", "schema_v1"]
schema_v1 = []
schema_v2 = []
breaking_schema = []
```

これらのフィーチャーは、**スキーマ自体を変更するのではなく**、`SCHEMA_VERSION`定数を設定してR2ストレージのパス管理に使用されます。

- `schema_v1` → `SCHEMA_VERSION = "v1"`
- `schema_v2` → `SCHEMA_VERSION = "v2"`

**重要**: 現時点では、v1とv2のAvroスキーマは完全に同一です。将来的にスキーマ変更が必要な場合、条件コンパイル（`#[cfg(feature)]`）で分岐させる必要があります。

## 生成されたファイル

### 1. スキーマ生成スクリプト

**場所**: [packages/kc_api/scripts/generate-schemas.sh](../kc_api/scripts/generate-schemas.sh)

実行方法：
```bash
cd packages/kc_api
./scripts/generate-schemas.sh
```

出力：
- `packages/kc_api/generated-schemas/schema_v1.json`
- `packages/kc_api/generated-schemas/schema_v2.json`

### 2. Schema Registry (FUSOU-WORKFLOW)

**場所**: [packages/FUSOU-WORKFLOW/src/schema-registry.ts](FUSOU-WORKFLOW/src/schema-registry.ts)

機能：
```typescript
// テーブルの正規スキーマを取得
getCanonicalSchema(version: 'v1' | 'v2', tableName: string): string | null

// 利用可能なテーブル一覧
getAvailableTables(version: 'v1' | 'v2'): string[]

// データベーステーブルバージョン
getTableVersion(version: 'v1' | 'v2'): string | null
```

### 3. Schema Registry (FUSOU-WEB)

**場所**: [packages/FUSOU-WEB/src/server/utils/schema-registry.ts](FUSOU-WEB/src/server/utils/schema-registry.ts)

Cloudflare Workers環境で動作する軽量版です。

### 4. 更新されたValidator

**場所**: [packages/FUSOU-WORKFLOW/src/avro-validator.ts](FUSOU-WORKFLOW/src/avro-validator.ts)

新しいAPI：
```typescript
await validateAvroOCF(avroBytes, {
  // オプション1: 正規スキーマを使用（推奨）
  schemaVersion: 'v1',
  tableName: 'battle',
  
  // オプション2: 明示的なスキーマ
  explicitSchema: schemaJson,
  
  // オプション3: OCFヘッダースキーマを信頼（セキュリティ上非推奨）
  trustOCFSchema: true,
});
```

## 利用可能なテーブル

現在33個のテーブルが利用可能：

- `env_info`, `cells`
- `airbase`, `plane_info`
- `own_slotitem`, `enemy_slotitem`, `friend_slotitem`
- `own_ship`, `enemy_ship`, `friend_ship`
- `own_deck`, `support_deck`, `enemy_deck`, `friend_deck`
- `airbase_airattack`, `airbase_airattack_list`
- `airbase_assult`, `carrierbase_assault`
- `closing_raigeki`
- `friendly_support_hourai`, `friendly_support_hourai_list`
- `hougeki`, `hougeki_list`
- `midnight_hougeki`, `midnight_hougeki_list`
- `opening_airattack`, `opening_airattack_list`
- `opening_raigeki`
- `opening_taisen`, `opening_taisen_list`
- `support_airattack`, `support_hourai`
- `battle`

## 使用例

### FUSOU-WORKFLOWでの使用

```typescript
import { validateAvroOCF } from './src/avro-validator';

// 正規スキーマで検証（推奨）
const result = await validateAvroOCF(avroBytes, {
  schemaVersion: 'v1',
  tableName: 'battle',
});

if (result.valid) {
  console.log('Valid! Record count:', result.recordCount);
} else {
  console.error('Validation failed:', result.error);
}
```

### FUSOU-WEBでの使用

```typescript
import { validateAvroOCF } from './server/utils/avro-validator';
import { getCanonicalSchema } from './server/utils/schema-registry';

// Cloudflare Workerで実行
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const avroBytes = await request.arrayBuffer();
    
    const result = await validateAvroOCF(new Uint8Array(avroBytes), {
      schemaVersion: 'v1',
      tableName: 'battle',
    });
    
    return Response.json(result);
  }
};
```

## テスト結果

```bash
$ node test/test-schema-registry-simple.mjs
=== Schema Registry Test ===

Test 1: Load schema v1
  Table version: 0.4
  Schema count: 33
  ✓ Loaded successfully

Test 2: Load schema v2
  Table version: 0.4
  Schema count: 33
  ✓ Loaded successfully

Test 3: Find battle table schema
  Schema name: Battle
  Schema type: record
  Field count: 40
  ✓ Battle schema found

Test 5: Compare v1 and v2
  Same schema count: true
  Same table version: true
  ✓ Comparison complete

All tests passed!
```

## セキュリティ上の推奨事項

1. **正規スキーマを使用**: `schemaVersion` + `tableName` で検証
2. **OCFヘッダーは信頼しない**: `trustOCFSchema: true` は避ける
3. **スキーマフィンガープリント検証**: 将来的に実装推奨

## 今後の拡張

1. **スキーマフィンガープリント検証**: OCFヘッダーと正規スキーマの一致確認
2. **バージョン別スキーマ**: v1/v2で異なるスキーマが必要な場合、条件コンパイルで分岐
3. **スキーマ進化の追跡**: breaking_schema featureを活用したメジャーバージョン管理

## 関連ファイル

- [kc_api/scripts/generate-schemas.sh](../kc_api/scripts/generate-schemas.sh)
- [kc_api/crates/kc-api-database/src/bin/print_schema.rs](../kc_api/crates/kc-api-database/src/bin/print_schema.rs)
- [kc_api/crates/kc-api-database/src/schema_version.rs](../kc_api/crates/kc-api-database/src/schema_version.rs)
- [FUSOU-WORKFLOW/src/schema-registry.ts](FUSOU-WORKFLOW/src/schema-registry.ts)
- [FUSOU-WORKFLOW/src/avro-validator.ts](FUSOU-WORKFLOW/src/avro-validator.ts)
- [FUSOU-WEB/src/server/utils/schema-registry.ts](FUSOU-WEB/src/server/utils/schema-registry.ts)
