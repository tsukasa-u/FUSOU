# スキーマバージョン管理とハッシュ検証の仕組み

## 1. 現在のテスト網羅性の評価

### ✅ 実装済みのテスト

- **`test-schema-namespace-fingerprint.mjs`**: スキーマの名前空間とフィンガープリント生成を検証
- **`test-error-handling.mjs`**: スキーマフィンガープリント不一致のエラー処理（コメントのみ）

### ❌ **不足しているテスト**

**重要**: 以下のケースが全くテストされていません：

1. **後方互換性のあるスキーマ変更**（許可されるべき）
   - フィールド追加（デフォルト値あり）
   - Unionタイプへの変更（null許可）
   - エイリアス追加

2. **後方互換性のないスキーマ変更**（拒否されるべき）
   - 必須フィールドの削除
   - フィールド型の変更（例: `long` → `string`）
   - Unionの順序変更

3. **複数バージョン混在読み取り**
   - v1とv2のデータを同時に読み取り
   - 異なるTABLE_VERSIONを持つブロックの処理

---

## 2. スキーマハッシュ検証の仕組み解説

### アーキテクチャ図

```
[クライアント]                    [サーバー]
     |                               |
     | 1. データ送信                  |
     | (スキーマ埋め込み)              |
     |------------------------------>|
     |                               | 2. ヘッダー解析
     |                               |    parseSchemaFingerprintFromHeader()
     |                               |
     |                               | 3. SHA-256計算
     |                               |    computeSchemaFingerprint()
     |                               |
     |                               | 4. 環境変数と比較
     |                               |    TABLE_FINGERPRINTS_JSON
     |                               |    {"v1": "abc123...", "v2": "def456..."}
     |                               |
     |                               | 5. 一致判定
     |                               |    validateHeaderTableVersion()
     |                               |
     |<------------------------------|
     |      OK / Error               |
```

### 詳細フロー

#### ステップ1: クライアント側（データ送信時）

```typescript
// kc_api や FUSOU-APP から送信されるデータ
const data = {
  table_name: "battle_result",
  table_version: "v1",  // ← テーブルバージョン指定
  data: { /* 実データ */ }
};

// サーバー（FUSOU-WEB）がAvroヘッダーに埋め込む
const schema = {
  type: "record",
  name: "BattleResult",
  namespace: "fusou.v1",  // ← ここにバージョン情報
  fields: [...]
};
```

#### ステップ2: サーバー側（アーカイブ時）

**cron.ts（アーカイブWorker）**

```typescript
// データをAvro OCF形式でR2に保存
const avroFile = await buildOCFWithSchema(
  schema,           // スキーマ全体がヘッダーに埋め込まれる
  records,
  'deflate',        // 圧縮コーデック
  'v1'              // スキーマバージョン（名前空間に反映）
);

// R2に保存
await R2.put(filePath, avroFile);

// D1にインデックス保存
await D1.prepare(`
  INSERT INTO block_indexes
    (dataset_id, table_name, table_version, file_id, ...)
  VALUES (?, ?, ?, ?, ...)
`).bind(userId, "battle_result", "v1", fileId, ...).run();
```

#### ステップ3: サーバー側（読み取り時の検証）

**reader.ts: validateHeaderTableVersion()**

```typescript
async function validateHeaderTableVersion(
  header: Uint8Array, // Avroファイルのヘッダー部分
  expectedVersion: string, // 期待されるバージョン（例: "v1"）
  allowedMap: Record<string, string>, // 許可されたハッシュマップ
): Promise<void> {
  // 1. ヘッダーからスキーマを抽出してハッシュ計算
  const { fingerprint, namespace } =
    await parseSchemaFingerprintFromHeader(header);
  //   fingerprint = "3a5f2bc...（SHA-256の64文字）"
  //   namespace = "fusou.v1"

  // 2. 名前空間チェック
  if (namespace && !namespace.includes(expectedVersion)) {
    throw new Error(`Schema namespace mismatch: expected v1, got ${namespace}`);
  }

  // 3. ハッシュ値チェック
  const expectedFp = allowedMap[expectedVersion];
  //   allowedMap = {"v1": "3a5f2bc...", "v2": "7d8e9ab..."}

  if (expectedFp && fingerprint && fingerprint !== expectedFp) {
    // ❌ ハッシュ不一致 = スキーマが改ざんされている or 互換性なし
    throw new Error(`Schema fingerprint mismatch for ${expectedVersion}`);
  }

  // ✅ OK: 検証通過
}
```

#### ステップ4: 環境変数の設定

**wrangler.toml または Cloudflare Dashboard**

```toml
[env.production.vars]
TABLE_FINGERPRINTS_JSON = '{"v1":"3a5f2bc71d8e...","v2":"7d8e9ab42f1c..."}'
```

この環境変数は以下のように取得されます：

```typescript
// reader.ts
function loadSchemaFingerprintMap(env: Env): Record<string, string> {
  if (!env.TABLE_FINGERPRINTS_JSON) return {};
  try {
    return JSON.parse(env.TABLE_FINGERPRINTS_JSON);
  } catch {
    return {};
  }
}
```

---

## 3. ハッシュ計算の実装

**avro-manual.ts: computeSchemaFingerprint()**

```typescript
export async function computeSchemaFingerprint(
  schemaJson: string,
): Promise<string> {
  // WebCrypto API（Cloudflare Workers対応）
  const encoder = new TextEncoder();
  const data = encoder.encode(schemaJson);

  // SHA-256ハッシュ計算
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  // Hex文字列に変換
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  // 結果例: "3a5f2bc71d8e9ab42f1c..."（64文字）
}
```

---

## 4. 実際の検証シナリオ

### ケース1: 正常な読み取り（v1データ）

```
1. クライアントがv1スキーマでデータ送信
2. サーバーがAvroヘッダーに "fusou.v1" を埋め込み
3. R2に保存、D1に table_version="v1" でインデックス
4. 読み取り時:
   - parseSchemaFingerprintFromHeader() → "3a5f2bc..."
   - 環境変数の {"v1": "3a5f2bc..."} と一致
   - ✅ 検証OK
```

### ケース2: スキーマ改ざん検出

```
1. 悪意のあるユーザーが古いスキーマファイルを改変
2. ヘッダーのスキーマが変更されている
3. 読み取り時:
   - computeSchemaFingerprint() → "999invalid..."
   - 環境変数の {"v1": "3a5f2bc..."} と不一致
   - ❌ Error: "Schema fingerprint mismatch for v1"
```

### ケース3: バージョン混在（未実装）

```
1. v1とv2のデータが混在
2. 現在の実装では:
   - effectiveTableVersion = params.table_version ?? coldIndexes[0]?.table_version
   - 最初のブロックのバージョンを全体に適用
   - ⚠️ 問題: v1とv2が混在していると正しく検証できない
```

---

## 5. 問題点と改善提案

### 🔴 現在の問題

1. **TABLE_VERSIONの互換性テストが存在しない**
   - 互換性のある変更（フィールド追加など）が許可されるかテストされていない
   - 互換性のない変更（型変更など）が拒否されるかテストされていない

2. **複数バージョン混在の処理が不明確**
   - reader.tsは最初のブロックのtable_versionを全体に適用
   - 異なるバージョンが混在する場合の動作が未定義

3. **環境変数の更新手順が不明確**
   - スキーマv2を追加する際、TABLE_FINGERPRINTS_JSONをどう更新するか
   - ロールバック時の対応が不明

### ✅ 推奨される追加テスト

#### テスト1: 後方互換性のあるスキーマ変更

```javascript
// test/test-schema-backward-compatible.mjs
async function testBackwardCompatible() {
  // v1スキーマ
  const schemaV1 = {
    type: "record",
    name: "Battle",
    namespace: "fusou.v1",
    fields: [
      { name: "id", type: "long" },
      { name: "result", type: "string" },
    ],
  };

  // v2スキーマ（フィールド追加、デフォルト値あり）
  const schemaV2 = {
    type: "record",
    name: "Battle",
    namespace: "fusou.v2",
    fields: [
      { name: "id", type: "long" },
      { name: "result", type: "string" },
      { name: "damage", type: "long", default: 0 }, // ← 追加
    ],
  };

  // v1データをv2スキーマで読めることを確認
  const v1Data = await buildOCF(schemaV1, [{ id: 1, result: "win" }]);
  const v2Reader = createReader(schemaV2);
  const records = v2Reader.parse(v1Data);

  assert(records[0].damage === 0, "Default value applied");
}
```

#### テスト2: 後方互換性のないスキーマ変更

```javascript
// test/test-schema-incompatible.mjs
async function testIncompatible() {
  const schemaV1 = {
    fields: [{ name: "id", type: "long" }],
  };

  // 型変更（互換性なし）
  const schemaV2 = {
    fields: [{ name: "id", type: "string" }], // ❌ long → string
  };

  const v1Data = await buildOCF(schemaV1, [{ id: 123 }]);
  const v2Reader = createReader(schemaV2);

  // エラーが発生することを確認
  await assert.rejects(() => v2Reader.parse(v1Data), /Type mismatch/);
}
```

#### テスト3: 複数バージョン混在読み取り

```javascript
// test/test-mixed-versions.mjs
async function testMixedVersions() {
  // v1とv2のブロックが混在
  const indexes = [
    { table_version: "v1", file_path: "v1.avro" },
    { table_version: "v2", file_path: "v2.avro" },
  ];

  // 読み取り時の動作を確認
  const records = await readColdData(indexes);

  // 期待される動作を定義
  // オプション1: エラーを投げる
  // オプション2: 両方を読んで結果をマージ
  // オプション3: 最新バージョンのみ読む
}
```

---

## 6. 運用時の手順

### スキーマv2を追加する場合

1. **新スキーマのハッシュを計算**

```bash
node -e "
const schema = {...};  // v2スキーマ
const hash = await computeSchemaFingerprint(JSON.stringify(schema));
console.log('v2 hash:', hash);
"
```

2. **環境変数を更新**

```bash
wrangler secret put TABLE_FINGERPRINTS_JSON
# 入力: {"v1":"3a5f...","v2":"7d8e..."}
```

3. **段階的ロールアウト**
   - まずv1とv2の両方を許可
   - クライアントを徐々にv2に移行
   - 十分な期間後、v1を削除

---

## まとめ

- **ハッシュ検証は実装済み**: SHA-256でスキーマの整合性を検証
- **テストが不足**: 互換性のある/ない変更のテストが存在しない
- **混在処理が未定義**: 複数バージョンの同時存在への対応が不明確
- **運用手順が未文書化**: スキーマバージョンアップ時の手順が不明

次のステップとして、上記の追加テストを実装することを強く推奨します。
