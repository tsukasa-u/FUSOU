# 🔴 重大な問題：スキーマ検証の不在

## 現在の問題

### 1. クライアント送信時のスキーマ検証が存在しない

**battle_data.ts (line 98-102):**
```typescript
const schemaVersion = typeof body?.schema_version === "string"
  ? body.schema_version.trim()
  : typeof body?.schemaVersion === "string"
    ? body.schemaVersion.trim()
    : "v1";
```

**問題点:**
- クライアントが送信した `schema_version` をそのまま信頼している
- スキーマの内容（フィールド構成）を一切検証していない
- 悪意のあるクライアントが任意のバージョンを宣言できる

### 2. 実際の攻撃シナリオ

```javascript
// 攻撃者が送信
POST /upload
{
  "schema_version": "v2",  // ← 嘘のバージョンを宣言
  "table": "battle_result",
  "data": <v1形式のデータ>  // ← 実際はv1の古いスキーマ
}
```

**結果:**
1. サーバーは `schema_version: "v2"` として D1 に保存
2. 読み取り時、v2のフィンガープリント検証を試みる
3. **実際のデータはv1** → フィンガープリント不一致
4. データが読めなくなる or 破損データとして扱われる

### 3. より深刻な攻撃

```javascript
// 互換性のないスキーマで送信
POST /upload
{
  "schema_version": "v2",
  "table": "battle_result",
  "data": <フィールド型を変更したデータ>
  // 例: id を string から number に変更
}
```

**結果:**
- 既存のv2データと型が異なる
- マージ時にデータ破損
- アプリケーションクラッシュ

---

## 必要な対策

### 対策1: サーバー側でスキーマ検証を実装

**battle_data.tsに追加すべき処理:**

```typescript
import { parseSchemaFingerprintFromHeader, computeSchemaFingerprint } from '../../../FUSOU-WORKFLOW/dist/avro-manual.js';

// 環境変数から許可されたスキーマフィンガープリントを読み込み
const ALLOWED_SCHEMA_FINGERPRINTS = {
  v1: "3a5f2bc71d8e9ab...",  // 実際のv1スキーマのSHA-256
  v2: "7d8e9ab42f1c6d3...",  // 実際のv2スキーマのSHA-256
};

// アップロード時の検証
app.post("/upload", async (c) => {
  // ... 既存のコード ...
  
  // クライアントが送信したスキーマバージョン
  const declaredVersion = body.schema_version || "v1";
  
  // Avroヘッダーからスキーマを抽出
  const headerLen = getAvroHeaderLength(uploadedData);
  const header = uploadedData.subarray(0, headerLen);
  
  // スキーマのフィンガープリントを計算
  const { fingerprint, namespace } = await parseSchemaFingerprintFromHeader(header);
  
  // 1. 名前空間チェック
  if (!namespace || !namespace.includes(declaredVersion)) {
    return c.json({ 
      error: `Schema namespace mismatch: declared ${declaredVersion} but got ${namespace}` 
    }, 400);
  }
  
  // 2. フィンガープリント検証
  const expectedFingerprint = ALLOWED_SCHEMA_FINGERPRINTS[declaredVersion];
  if (!expectedFingerprint) {
    return c.json({ 
      error: `Unknown schema version: ${declaredVersion}` 
    }, 400);
  }
  
  if (fingerprint !== expectedFingerprint) {
    return c.json({ 
      error: `Schema fingerprint mismatch for ${declaredVersion}`,
      details: {
        expected: expectedFingerprint.substring(0, 16) + "...",
        got: fingerprint.substring(0, 16) + "..."
      }
    }, 400);
  }
  
  // ✅ 検証OK - 続行
});
```

### 対策2: 環境変数でスキーマを管理

**wrangler.toml:**
```toml
[env.production.vars]
SCHEMA_FINGERPRINTS_JSON = '{"v1":"3a5f2bc71d8e...","v2":"7d8e9ab42f1c..."}'
```

**スキーマ更新手順:**
1. 新しいスキーマv3を定義
2. SHA-256ハッシュを計算
3. 環境変数に追加
4. デプロイ
5. クライアントアップデート

### 対策3: スキーマレジストリの導入（将来的）

**推奨アーキテクチャ:**
```
[Schema Registry Service]
     ↓ (v1, v2, v3のスキーマとハッシュを管理)
     
[FUSOU-WEB /upload]
     ↓ (アップロード時にスキーマ検証)
     ✅ レジストリに問い合わせて検証
     
[FUSOU-WORKFLOW reader]
     ↓ (読み取り時にスキーマ検証)
     ✅ レジストリから期待されるハッシュを取得
```

---

## テストで明らかになった事実

### ✅ 実装済み
- スキーマフィンガープリント計算（`computeSchemaFingerprint`）
- 読み取り時のフィンガープリント検証（`validateHeaderSchemaVersion`）
- 後方互換性のある変更の処理
- 複数バージョン混在の読み取り

### ❌ 未実装（セキュリティホール）
- **アップロード時のスキーマ検証**
- クライアントが宣言したバージョンと実際のスキーマの一致確認
- 互換性のない変更の拒否

---

## 推奨される実装順序

### ステップ1: 即座に実装すべき（セキュリティ重要度：高）
1. `battle_data.ts` に `validateUploadedSchema()` 関数を追加
2. 環境変数 `SCHEMA_FINGERPRINTS_JSON` の設定
3. アップロード時の検証を有効化

### ステップ2: 中期的改善
1. スキーマレジストリの設計
2. スキーマバージョニングポリシーの文書化
3. クライアント側のスキーマ生成補助ツール

### ステップ3: 長期的改善
1. スキーマ進化のガイドライン（互換性ルール）
2. 自動テストでの互換性チェック
3. CI/CDでのスキーマ検証パイプライン

---

## まとめ

**現状:** クライアントの自己申告を信頼する脆弱な設計

**リスク:**
- データ破損
- 型不一致によるクラッシュ
- 悪意のあるデータ挿入

**対策:** サーバー側でスキーマハッシュを検証する実装が**必須**

この問題は**即座に対処すべきセキュリティ上の欠陥**です。
