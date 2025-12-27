# KC-API Database Schema Extraction and Fingerprint Generation

このドキュメントでは、`kc-api-database` から Avro スキーマを抽出し、フィンガープリントを計算する完全なワークフローを説明します。

## 概要

1. **スキーマ抽出**: `kc-api-database` の Rust コードから Avro スキーマ（canonical JSON）を抽出
2. **フィンガープリント計算**: 各テーブルスキーマの SHA-256 フィンガープリントを計算
3. **環境変数用 JSON 生成**: `SCHEMA_FINGERPRINTS_JSON` に設定する形式で出力
4. **検証**: フィンガープリントの一貫性とバージョン間差分を確認

## ディレクトリ構成

```
FUSOU-WORKFLOW/
├── schemas/
│   ├── kc_api_v1.json          # v1 スキーマ定義（33テーブル）
│   ├── kc_api_v2.json          # v2 スキーマ定義（33テーブル）
│   └── fingerprints.json       # 全バージョンのフィンガープリント
├── scripts/
│   └── compute-kc-api-fingerprints.mjs  # フィンガープリント計算スクリプト
└── test/
    └── test-kc-api-fingerprints.mjs     # 検証テスト
```

## 使い方

### 1. スキーマの抽出

kc-api-database から schema_v1 および schema_v2 の全テーブルスキーマを抽出します。

```bash
# v1 スキーマを生成
pushd ../kc_api
cargo run -p kc-api-database --bin print_schema --features schema_v1 2>/dev/null > ../FUSOU-WORKFLOW/schemas/kc_api_v1.json

# v2 スキーマを生成
cargo run -p kc-api-database --bin print_schema --no-default-features --features schema_v2 2>/dev/null > ../FUSOU-WORKFLOW/schemas/kc_api_v2.json
popd
```

### 2. フィンガープリントの計算

抽出したスキーマから各テーブルのフィンガープリント（SHA-256）を計算します。

```bash
# フィンガープリント計算
node scripts/compute-kc-api-fingerprints.mjs schemas/kc_api_v1.json schemas/kc_api_v2.json > schemas/fingerprints.json
```

出力形式:
```json
{
  "v1": {
    "env_info": "2d556ba347faeaa44239817b4fd58a2cda7b7fdfbae2d7366584822097008e3f",
    "cells": "069ee0341eb65443eeb0d47f7db0534d5c6c7889caf0ed665dfb5d29e999b9c2",
    ...
  },
  "v2": {
    "env_info": "a26c44c208e274fce9edab731bab026f2ec5333dd0fd9ceba1f8ea66b7d53800",
    "cells": "f534b36478bfa1a33f843033c62a0ddb5b42dd318ba446987c77a6c2a4b73d98",
    ...
  }
}
```

### 3. 検証テストの実行

フィンガープリントが正しく計算されているか確認します。

```bash
node test/test-kc-api-fingerprints.mjs
```

このテストは以下を検証します:
- ✅ v1 スキーマの全33テーブルのフィンガープリント一貫性
- ✅ v2 スキーマの全33テーブルのフィンガープリント一貫性
- ✅ v1 と v2 で全テーブルのフィンガープリントが異なること（進化検証）

## 対象テーブル一覧（33テーブル）

### コアテーブル
- `env_info` - 環境情報とバージョン
- `cells` - マップセル情報

### 基地・航空機
- `airbase` - 基地航空隊
- `plane_info` - 航空機詳細

### 装備
- `own_slotitem`, `enemy_slotitem`, `friend_slotitem`

### 艦船
- `own_ship`, `enemy_ship`, `friend_ship`

### 艦隊
- `own_deck`, `support_deck`, `enemy_deck`, `friend_deck`

### 戦闘フェーズ
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
- `battle` - 戦闘統合データ

## Cloudflare Workers での使用

生成された `fingerprints.json` を環境変数 `SCHEMA_FINGERPRINTS_JSON` に設定します。

```bash
# wrangler.toml または Cloudflare ダッシュボードで設定
[vars]
SCHEMA_FINGERPRINTS_JSON = '{"v1": {...}, "v2": {...}}'
```

サーバー側では、アップロード時にヘッダーからスキーマを抽出し、フィンガープリントを検証します:

```typescript
import { validateHeaderSchemaVersion } from './reader.js';

// アップロード時の検証
const isValid = validateHeaderSchemaVersion(
  avroHeader,
  expectedVersion,
  JSON.parse(env.SCHEMA_FINGERPRINTS_JSON)
);

if (!isValid) {
  return new Response('Invalid schema version', { status: 400 });
}
```

## CI/CD 統合

スキーマ変更時の自動更新フロー:

1. `kc-api-database` の Cargo feature で `schema_v3` などを追加
2. CI で print_schema を実行して新バージョンのスキーマを抽出
3. フィンガープリント計算スクリプトを実行
4. 環境変数を自動更新（GitHub Actions secrets 等）
5. Workers へデプロイ

## トラブルシューティング

### スキーマ抽出時に警告が混入する

stderr をリダイレクトしてください:
```bash
cargo run ... 2>/dev/null > output.json
```

### フィンガープリントが一致しない

- スキーマ JSON が正しく抽出されているか確認
- namespace が `fusou.v1` / `fusou.v2` 形式になっているか確認
- WebCrypto の SHA-256 実装が一致しているか確認

### バージョン間で差分が出ない

`kc-api-database` の feature flag が正しく切り替わっているか確認:
```bash
cargo run --no-default-features --features schema_v2
```

## 参考資料

- [SCHEMA_VERSION_EXPLANATION.md](../docs/SCHEMA_VERSION_EXPLANATION.md) - スキーマバージョン管理の詳細
- [SCHEMA_VALIDATION_SECURITY_ISSUE.md](../docs/SCHEMA_VALIDATION_SECURITY_ISSUE.md) - セキュリティ検証の説明
- kc-api-database/src/bin/print_schema.rs - スキーマ抽出ツールのソースコード
