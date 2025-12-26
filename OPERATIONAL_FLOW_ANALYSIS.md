# 実運用フロー分析：本当に実装が必要なこと

## 現在の状態（2024年12月）

```
[Client: FUSOU-APP]
  ↓ Avro OCF binary
[Server: KC API]
  version = DATABASE_TABLE_VERSION = "0.4"
  ↓ Avro を encode
[R2 Storage]
  Path: v1/202412/battle.avro
  Content: Avro OCF (SCHEMA_VERSION: v1)
```

**現在の設定**:
- `DATABASE_TABLE_VERSION = "0.4"` (KanColle game data version)
- `SCHEMA_VERSION = "v1"` (Avro format version)
- `EnvInfo.version = "0.4"` (Avro data に埋め込まれる)

---

## 実運用シナリオ：ゲームアップデート 0.4 → 0.5

### タイムライン

**2025年1月15日: KanColle ゲーム更新 v0.5 リリース**
```
API レスポンス変更:
  - api_port: 新フィールド api_new_battle_system 追加
  - api_deck: フィールド削除は無し（後方互換）

実装チェック:
  ✅ KC API (Rust) の kc_api_interface 更新
  ✅ PortTable モデル更新
  ✅ DATABASE_TABLE_VERSION = "0.5" に更新
  ✅ EnvInfo.version = "0.5" に自動更新
```

### 実装後のデータフロー

```
[2025年1月15日以降]
[Client: FUSOU-APP v1.0]
  ↓ KanColle API から戦闘データ取得
  ↓ Avro encode (スキーマは？)
[Server: battle-data/upload]
  schema_version = ? (v1?v2?)
  ↓ 
[R2]
  path = ?/202501/battle.avro
  EnvInfo.version = "0.5"
```

---

## 問題：2つの選択肢があり、決定できない

### 選択肢 A：スキーマ互換性を保つ（v1 のまま）

```
対応内容:
  ✅ DATABASE_TABLE_VERSION = "0.5"
  ✅ PortTable に新フィールド追加（Optional）
  ✅ SCHEMA_VERSION = v1（変更なし）
  ✅ R2パス: v1/202501/battle.avro（変更なし）

Avroスキーマ:
  - 新フィールドは Optional → null 可能
  - 既存フィールドは変更なし
  - v1 reader で読める（新フィールドは null）

互換性マトリックス:
  ┌─────────────────────────┬────────┬────────┐
  │ 読み手\データ            │ 0.4-v1 │ 0.5-v1 │
  ├─────────────────────────┼────────┼────────┤
  │ 0.4 client (v1 reader)  │   ✅   │   ✅   │
  │ 0.5 client (v1 reader)  │   ✅   │   ✅   │
  └─────────────────────────┴────────┴────────┘

メリット:
  ✅ 複数バージョン共存可能
  ✅ v2 の実装を後延ばしできる
  ✅ クライアント側の修正不要

デメリット:
  ❌ 0.4 クライアントが 0.5 データを読むときフィールド無視される
  ❌ Avro オプショナルフィールドが増え続ける
```

### 選択肢 B：新しいスキーマバージョンを導入（v2 新規作成）

```
対応内容:
  ✅ DATABASE_TABLE_VERSION = "0.5"
  ✅ PortTable に新フィールド追加（Required）
  ✅ SCHEMA_VERSION = v2（新規）
  ✅ R2パス: v2/202501/battle.avro（新規）

Avroスキーマ:
  - 新フィールドは Required
  - 既存フィールドは変更なし
  - v2 reader で読める

互換性マトリックス:
  ┌─────────────────────────┬────────┬────────┐
  │ 読み手\データ            │ 0.4-v1 │ 0.5-v2 │
  ├─────────────────────────┼────────┼────────┤
  │ 0.4 client (v1 reader)  │   ✅   │   ❌   │
  │ 0.5 client (v2 reader)  │  ⚠️*   │   ✅   │
  └─────────────────────────┴────────┴────────┘
  * v1 reader で読む場合、新フィールド無視される

メリット:
  ✅ 0.5 データはスキーマ正確
  ✅ 各バージョンが独立

デメリット:
  ❌ 0.5 クライアントが 0.4 データを読むには v1 reader 必要
  ❌ クライアントで複数 reader 管理が必要
  ❌ v2 実装負荷
```

---

## 現在のコードで、この判断をできるか？

### 現状コード（schema_version.rs）
```rust
pub const DATABASE_TABLE_VERSION: &str = "0.4";

#[cfg(feature = "schema_v1")]
pub const SCHEMA_VERSION: &str = "v1";

#[cfg(feature = "schema_v2")]
pub const SCHEMA_VERSION: &str = "v2";
```

**問題: どちらを選ぶべきかルールがない**

次のような判断ロジックが必要：
```rust
// ❌ 存在しない
fn determine_schema_version(db_version: &str) -> &'static str {
  match db_version {
    "0.4" => "v1",
    "0.5" => {
      // どちらを選ぶ？
      // - 0.4→0.5 で Avro スキーマが互換か？
      // - 互換なら v1 のまま
      // - 非互換なら v2 必要
      // しかし判定ロジックが無い
    },
    _ => "v1",
  }
}
```

---

## 本当に実装が必要なこと（優先順位順）

### 🔴 優先度1（**今すぐ必要**）：Avro OCF パーサーが動かない

**問題：**
```typescript
// reader.ts で呼ばれているが throw される
export function parseDeflateAvroBlock(header: Uint8Array, block: Uint8Array): any[] {
  throw new Error('Not implemented');
}
```

**何が困るのか：**
- R2 から戦闘データを読めない
- reader.ts の merge クエリが失敗
- ユーザーが過去データを見られない

**実装すべきこと：**
```typescript
// parseDeflateAvroBlock: deflate 解凍 + Avro record パース
// parseNullAvroBlock: Avro record パース
// detectCompressionCodec: codec 判定
```

---

### 🟠 優先度2（**設計決定が必要**）：DATABASE_TABLE_VERSION 更新時の Avro スキーマ方針

**問題：**
- 0.4→0.5 時に「v1のまま」か「v2に移行」か決まっていない
- 判定ロジックが無い
- 将来 0.6, 0.7... への対応が不明確

**実装すべきこと：**
```rust
// schema_version.rs に追加
/// DATABASE_TABLE_VERSION と SCHEMA_VERSION の対応マップ
const VERSION_COMPATIBILITY_MAP: &[(&str, &str)] = &[
  // (DATABASE_TABLE_VERSION, SCHEMA_VERSION)
  ("0.4", "v1"),  // 現在
  ("0.5", "v1"),  // 互換性あり: v1 スキーマ拡張可能
  ("0.6", "v2"),  // 非互換: v2 で新規スキーマ
];

/// Avro スキーマ互換性定義
/// v1 スキーマで 0.4→0.5 の新フィールドを Optional で対応可能
/// 0.6 では必須フィールド追加が必要 → v2 で新規定義
```

---

### 🟡 優先度3（**API 設計**）：schema_version をパスに含める

**現状：**
```
POST /battle-data/upload
{
  "schema_version": "v1",
  "data": "..."
}
```

**改善：**
```
POST /v1/battle-data/upload
Content-Type: application/octet-stream
[Avro OCF binary]
```

**なぜ必要：**
1. RESTful 設計（バージョンは リソース識別子の一部）
2. ルーティングが簡単（`/v1/*` と `/v2/*` で分岐）
3. 将来 v3, v4 への拡張が楽

**実装すべきこと：**
- API ルートを `POST /:schema_version/battle-data/upload` に変更
- クライアント側でスキーマバージョンを決定 → パスに含める
- サーバー側でパスから schema_version 抽出

---

## 実装の流れ（ユースケース再現）

### Step 1: 現在（2024年12月）- v1 稼働

```
1. クライアント: Avro encode（schema_version=v1）
2. POST /v1/battle-data/upload
3. サーバー: DATABASE_TABLE_VERSION=0.4 で EnvInfo.version="0.4"
4. R2: v1/202412/battle.avro に保存
```

**実装状態：** ✅ データ送信, ❌ データ読取（parseDeflateAvroBlock 未実装）

---

### Step 2: ゲーム版 0.5 対応決定（2025年1月）

```
【判定】0.4→0.5 で Avro スキーマ互換性を評価
  - 新フィールド: api_new_battle_system (Optional)
  - 削除フィールド: なし
  → スキーマ互換性: あり
  → 判定: v1 のまま利用可能

【実装】
  ✅ PortTable に新フィールド追加（Option<T>）
  ✅ DATABASE_TABLE_VERSION = "0.5"
  ✅ SCHEMA_VERSION = v1（変更なし）
  ✅ VERSION_COMPATIBILITY_MAP に ("0.5", "v1") 追加
```

---

### Step 3: 本番運用（2025年1月以降）

```
1. 0.4 クライアント: v1 schema で encode → /v1/battle-data/upload
2. 0.5 クライアント: v1 schema で encode → /v1/battle-data/upload
3. サーバー: DATABASE_TABLE_VERSION に応じて EnvInfo.version = "0.5"
4. R2: 
   - v1/202412/battle.avro (0.4 クライアントが送信)
   - v1/202501/battle.avro (0.4/0.5 両方のクライアント送信)
```

**互換性：** 0.5 クライアントも v1 reader で読める（新フィールド無視）

---

### Step 4: 将来（0.6 が非互換の場合）

```
【判定】0.5→0.6 で Avro スキーマ非互換
  - 新フィールド: api_complex_battle (複雑な構造、Required)
  - 既存フィールド変更: なし
  → スキーマ互換性: なし（Required フィールド）
  → 判定: v2 必要

【実装】
  ✅ PortTable を 2つ定義
    #[cfg(feature = "schema_v1")]
    pub struct PortTable { /* 0.4, 0.5 用 */ }
    
    #[cfg(feature = "schema_v2")]
    pub struct PortTable { /* 0.6+ 用 */ }
    
  ✅ SCHEMA_VERSION = v2（新規）
  ✅ VERSION_COMPATIBILITY_MAP に ("0.6", "v2") 追加
```

---

## 実装チェックリスト

### 🔴 今すぐ（2024年12月）

- [ ] **Avro OCF パーサー実装**（優先度1）
  - [ ] `parseDeflateAvroBlock()` - deflate 解凍 + record パース
  - [ ] `parseNullAvroBlock()` - record パース
  - [ ] `detectCompressionCodec()` - codec 判定
  - テスト: reader.ts で R2 データを実際に読める

- [ ] **API パス再設計**（優先度3）
  - [ ] エンドポイント: `/v1/battle-data/upload` に変更
  - [ ] クライアント側: パスに schema_version を含める
  - テスト: 複数バージョンを同時に受け付けられる

### 🟠 近い将来（2025年1月）

- [ ] **スキーマ互換性マップ作成**（優先度2）
  - [ ] `VERSION_COMPATIBILITY_MAP` 定義
  - [ ] DATABASE_TABLE_VERSION ごとの Avro スキーマバージョンを記述
  - [ ] Avro スキーマ後方互換性ルールを文書化

- [ ] **0.5 対応準備**
  - [ ] KC API インターフェース更新
  - [ ] PortTable 新フィールド追加
  - [ ] データベース version フィールド更新テスト

### 🟡 将来（0.6+ 対応時）

- [ ] **v2 スキーマ定義**（必要になったら）
  - [ ] 非互換フィールド追加
  - [ ] `#[cfg(feature = "schema_v2")]` で条件付きコンパイル
  - [ ] v2 reader/writer 実装

---

## 結論：本当に必要な実装

| 項目 | 必要か | いつ | なぜ |
|------|--------|------|------|
| **Avro OCF パーサー** | ✅ 必須 | 今すぐ | 0.4 データを読めない |
| **API パス再設計** | ✅ 必須 | 今すぐ | 複数バージョン対応の基盤 |
| **スキーマ互換性マップ** | ✅ 必須 | 1月まで | 0.5 対応時に判定ロジック必要 |
| **v2 スキーマ実装** | ❌ 不要 | 0.6必要時 | 今は v1 で十分 |
| **複数スキーマ定義** | ⚠️ 準備 | 0.6必要時 | 条件付きコンパイル準備 |

---

## 実装例：必要な変更

### 1. schema_version.rs に互換性マップ追加
```rust
pub const DATABASE_TABLE_VERSION: &str = "0.5";  // 更新

// スキーマバージョン判定ロジック
pub fn schema_version_for_database(db_version: &str) -> &'static str {
  match db_version {
    "0.4" | "0.5" => "v1",  // 互換性あり
    "0.6" => "v2",           // 非互換
    _ => "v1",               // デフォルト
  }
}
```

### 2. API パス変更
```rust
// Old: POST /battle-data/upload { schema_version: "v1" }
// New: POST /v1/battle-data/upload

// ハンドラが schema_version をパスから抽出
#[post("/v{version}/battle-data/upload")]
async fn upload_battle_data(
  version: String,
  body: bytes::Bytes,
) -> Result<Response> {
  assert_eq!(version, "1");  // schema_version=v1
  // ...
}
```

### 3. Avro OCF パーサー実装
```typescript
export async function parseDeflateAvroBlock(
  header: Uint8Array,
  compressedBlock: Uint8Array
): Promise<any[]> {
  // 1. deflate 解凍
  const decompressed = decompressDeflate(compressedBlock);
  
  // 2. Avro record パース
  return parseAvroRecords(header, decompressed);
}
```

