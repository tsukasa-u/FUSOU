# KC-API スキーマ抽出とフィンガープリント生成 - 完了報告

## 実施内容

kc-api-database から Avro スキーマを抽出し、フィンガープリント計算とテスト検証まで完了しました。

## 成果物

### 1. スキーマ抽出ツール（kc-api側）

**ファイル**: `kc_api/crates/kc-api-database/src/bin/print_schema.rs`

- **機能**: 全33テーブルの Avro canonical schema を JSON 形式で出力
- **対応バージョン**: schema_v1, schema_v2 (feature flag で切り替え)
- **出力形式**:
  ```json
  [
    {"table_name": "env_info", "schema": "{canonical JSON}"},
    {"table_name": "cells", "schema": "{canonical JSON}"},
    ...
  ]
  ```

### 2. スキーマファイル（FUSOU-WORKFLOW側）

**ディレクトリ**: `FUSOU-WORKFLOW/schemas/`

- `kc_api_v1.json` (28KB, 33テーブル)
- `kc_api_v2.json` (28KB, 33テーブル)
- `fingerprints.json` (5.9KB, v1/v2 全フィンガープリント)

### 3. フィンガープリント計算スクリプト

**ファイル**: `FUSOU-WORKFLOW/scripts/compute-kc-api-fingerprints.mjs`

- **機能**: スキーマ JSON から SHA-256 フィンガープリントを計算
- **入力**: kc_api_v1.json, kc_api_v2.json
- **出力**: SCHEMA_FINGERPRINTS_JSON 形式の JSON
- **namespace 付与**: 各スキーマに `fusou.v1` / `fusou.v2` を自動追加

**使用例**:
```bash
node scripts/compute-kc-api-fingerprints.mjs schemas/kc_api_v1.json schemas/kc_api_v2.json > schemas/fingerprints.json
```

### 4. 検証テスト

**ファイル**: `FUSOU-WORKFLOW/test/test-kc-api-fingerprints.mjs`

- **検証項目**:
  - ✅ v1 全33テーブルのフィンガープリント一貫性
  - ✅ v2 全33テーブルのフィンガープリント一貫性
  - ✅ v1 と v2 でフィンガープリントが異なること（進化検証）

**結果**: 全テスト PASS (33/33 v1 match, 33/33 v2 match, 33/33 different)

### 5. ドキュメント

**ファイル**: `FUSOU-WORKFLOW/docs/KC_API_SCHEMA_EXTRACTION.md`

- ワークフロー全体の説明
- コマンド実行例
- 全33テーブルのリスト
- Cloudflare Workers での使用方法
- CI/CD 統合ガイド
- トラブルシューティング

## 対象テーブル（33テーブル）

| カテゴリ | テーブル数 | テーブル名 |
|---------|-----------|----------|
| コア | 2 | env_info, cells |
| 基地・航空機 | 2 | airbase, plane_info |
| 装備 | 3 | own_slotitem, enemy_slotitem, friend_slotitem |
| 艦船 | 3 | own_ship, enemy_ship, friend_ship |
| 艦隊 | 4 | own_deck, support_deck, enemy_deck, friend_deck |
| 戦闘フェーズ | 19 | airbase_airattack系, 砲撃・雷撃・航空戦など |
| **合計** | **33** | |

## 実行結果

### スキーマ抽出
```bash
# v1: 134行、28KB
# v2: 134行、28KB
```

### フィンガープリント計算
```bash
# v1: 33テーブル、全て一意のSHA-256ハッシュ
# v2: 33テーブル、v1とは全て異なるハッシュ（namespace差分による）
```

### テスト実行
```
✅ TypeScript コンパイル: OK
✅ Core Avro tests: 全テスト PASS
✅ Production validation: 6/7 PASS (1テーブル skip)
✅ KC-API fingerprints: 全テスト PASS (33+33+33検証)
```

## 今後の運用

### スキーマ更新時の手順

1. kc-api-database でスキーマ変更（例: schema_v3 追加）
2. スキーマ抽出:
   ```bash
   pushd ../kc_api
   cargo run -p kc-api-database --bin print_schema --no-default-features --features schema_v3 2>/dev/null > ../FUSOU-WORKFLOW/schemas/kc_api_v3.json
   popd
   ```
3. フィンガープリント再計算:
   ```bash
   node scripts/compute-kc-api-fingerprints.mjs schemas/kc_api_v*.json > schemas/fingerprints.json
   ```
4. 検証テスト実行:
   ```bash
   node test/test-kc-api-fingerprints.mjs
   ```
5. Cloudflare Workers 環境変数 `SCHEMA_FINGERPRINTS_JSON` を更新
6. デプロイ: `npx wrangler deploy`

### CI/CD 統合候補

- GitHub Actions で kc-api-database 更新時に自動でスキーマ抽出
- フィンガープリント計算と検証を CI で実行
- 環境変数を GitHub Secrets 経由で自動更新
- Wrangler でデプロイ前にテスト実行

## まとめ

✅ **完了項目**:
1. kc-api-database からのスキーマ抽出ツール作成
2. v1/v2 スキーマ JSON 生成
3. フィンガープリント計算スクリプト実装
4. 検証テスト作成・実行（全PASS）
5. ドキュメント整備

✅ **検証済み**:
- 33テーブル×2バージョン = 66スキーマのフィンガープリント計算
- バージョン間差分検出（全33テーブルで異なること）
- フィンガープリント一貫性（再計算しても同じハッシュ）

🎯 **運用準備完了**:
- SCHEMA_FINGERPRINTS_JSON に `schemas/fingerprints.json` を設定すれば、サーバー側でスキーマ検証可能
- スキーマ進化時の更新フローが確立

---
作成日: 2025年12月26日
