# 複数テーブル統合アップロード実装

## 概要

このドキュメントでは、複数のAvroテーブルを単一のParquetファイルにまとめてアップロードする「バッチアップロード」機能の実装について説明します。

## モチベーション

従来の実装では、各テーブルを個別のAvroファイルとしてアップロードしていました。この方法には以下の問題がありました：

1. **アップロード回数の増加**: テーブル数に比例してAPIコールが増加
2. **帯域幅の非効率性**: 小さなファイルを多数アップロードすることによるオーバーヘッド
3. **ストレージコスト**: 多数の小ファイルによる管理コスト
4. **データ形式の非効率性**: Avroは汎用的だが、分析クエリには最適化されていない

バッチアップロードでは、これらの問題を以下のように解決します：

- **統合アップロード**: 複数テーブルを1ファイルにまとめて1回のAPIコールで完了
- **Parquet形式**: 列指向ストレージで圧縮率が高く、分析クエリに最適
- **オフセット管理**: メタデータで各テーブルの位置を記録し、個別抽出可能

## アーキテクチャ

### コンポーネント構成

```
┌─────────────────────────────────────────────────────────────┐
│ FUSOU-APP (Tauri Desktop)                                   │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ CloudTableStorageProvider                             │  │
│  │ - write_get_data_table()  ← Master data upload       │  │
│  │ - write_port_table()      ← Transaction data upload  │  │
│  │ - upload_batch_tables()   ← NEW: Batch upload logic  │  │
│  └───────────────┬────────────────────────────────────────┘  │
│                  │                                           │
│                  ▼                                           │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ kc-api-database/batch_upload                          │  │
│  │ - BatchUploadBuilder: Avro → Parquet conversion      │  │
│  │ - Concatenation: Multi-table merging                 │  │
│  │ - Metadata: Offset tracking (TableMetadata)          │  │
│  └───────────────┬────────────────────────────────────────┘  │
│                  │                                           │
│                  ▼                                           │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ kc-api-database/avro_to_parquet                       │  │
│  │ - AvroToParquetConverter                              │  │
│  │ - DataFusion integration                              │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
           ┌─────────────────┐
           │ Google Drive API│
           │ (CloudStorage)  │
           └─────────────────┘
```

### データフロー

```
Input: HashMap<table_name, avro_bytes>
   │
   ▼
┌──────────────────────────────────────────────┐
│ Step 1: Avro → Parquet Conversion            │
│                                               │
│ For each table:                               │
│   - AvroToParquetConverter::convert()        │
│   - SNAPPY compression                        │
│   - Result: Vec<u8> (Parquet binary)         │
└───────────────┬──────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────┐
│ Step 2: Concatenation with Offset Tracking   │
│                                               │
│ Concatenated binary:                          │
│ ┌────────────┬────────────┬────────────┐     │
│ │ Table A    │ Table B    │ Table C    │     │
│ │ (Parquet)  │ (Parquet)  │ (Parquet)  │     │
│ └────────────┴────────────┴────────────┘     │
│                                               │
│ Metadata:                                     │
│ [                                             │
│   { table: "api_port", start: 0, length: 1024, format: "parquet" },     │
│   { table: "api_ship", start: 1024, length: 2048, format: "parquet" },  │
│   { table: "api_ndock", start: 3072, length: 512, format: "parquet" }   │
│ ]                                             │
└───────────────┬──────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────┐
│ Step 3: Upload to Cloud Storage               │
│                                               │
│ Files uploaded:                               │
│ 1. {timestamp}.parquet        ← Data file    │
│ 2. {timestamp}.metadata.json  ← Offset info  │
└───────────────────────────────────────────────┘
```

## 実装詳細

### 1. BatchUploadBuilder (kc-api-database)

**ファイル**: `packages/kc_api/crates/kc-api-database/src/batch_upload.rs`

#### 主要機能

```rust
pub struct BatchUploadBuilder {
    tables: Vec<TableData>,
    converter: AvroToParquetConverter,
}

impl BatchUploadBuilder {
    /// テーブルを追加
    pub fn add_table(&mut self, table_name: impl Into<String>, avro_data: Vec<u8>) -> &mut Self;
    
    /// バッチデータをビルド (Avro → Parquet + 結合)
    pub fn build(self) -> ConversionResult<BatchUploadData>;
}
```

#### BatchUploadData構造

```rust
pub struct BatchUploadData {
    /// 結合されたバイナリデータ (すべてのテーブル)
    pub data: Vec<u8>,
    /// 各テーブルのメタデータ (オフセット情報)
    pub metadata: Vec<TableMetadata>,
    /// 合計バイト数
    pub total_bytes: usize,
}

pub struct TableMetadata {
    pub table_name: String,
    pub start_byte: usize,
    pub byte_length: usize,
    pub format: String,  // "parquet"
}
```

### 2. CloudTableStorageProvider (FUSOU-APP)

**ファイル**: `packages/FUSOU-APP/src-tauri/src/storage/providers/cloud_table_provider.rs`

#### 新規メソッド

```rust
/// 複数テーブルを単一のParquetファイルとしてアップロード
async fn upload_batch_tables(
    &self,
    remote_path: &str,
    tables: HashMap<String, Vec<u8>>,
) -> Result<String, StorageError>;
```

#### write_port_table の更新

**変更前** (個別アップロード):
```rust
for (table_name, bytes) in get_all_port_tables(table) {
    let table_dir = format!("{map_folder}/{table_name}");
    self.ensure_folder(&table_dir).await?;
    let remote_path = format!("{table_dir}/{file_name}");
    self.upload_bytes(&remote_path, bytes).await?;
}
```

**変更後** (バッチアップロード):
```rust
// 空でないテーブルをHashMapに収集
let mut tables = HashMap::new();
for (table_name, bytes) in get_all_port_tables(table) {
    if !bytes.is_empty() {
        tables.insert(table_name.to_string(), bytes.to_vec());
    }
}

// 単一ファイルとしてアップロード
let batch_path = format!("{map_folder}/{file_name}.parquet");
let metadata_json = self.upload_batch_tables(batch_path.as_str(), tables).await?;

// メタデータも保存
let metadata_path = format!("{map_folder}/{file_name}.metadata.json");
self.upload_bytes(&metadata_path, metadata_json.as_bytes()).await?;
```

## ファイル構造

### アップロード後のフォルダ構造

#### Master Data (get_data tables)
```
periods/
  {period_tag}/
    master/
      {timestamp}.parquet          ← すべてのマスターテーブル結合
      {timestamp}.metadata.json    ← テーブルオフセット情報
```

#### Transaction Data (port tables)
```
periods/
  {period_tag}/
    transaction/
      {maparea_id}-{mapinfo_no}/
        {timestamp}.parquet          ← すべてのポートテーブル結合
        {timestamp}.metadata.json    ← テーブルオフセット情報
```

### メタデータJSON形式

```json
[
  {
    "table_name": "api_port",
    "start_byte": 0,
    "byte_length": 1024,
    "format": "parquet"
  },
  {
    "table_name": "api_ship",
    "start_byte": 1024,
    "byte_length": 2048,
    "format": "parquet"
  },
  {
    "table_name": "api_ndock",
    "start_byte": 3072,
    "byte_length": 512,
    "format": "parquet"
  }
]
```

## テーブル抽出

後でクラウドから特定のテーブルを抽出する際は、メタデータを使用します：

```rust
use kc_api::database::batch_upload::{extract_table, metadata_from_json};

// 1. メタデータJSONを取得
let metadata_json = download_metadata_from_cloud(metadata_path).await?;
let metadata = metadata_from_json(&metadata_json)?;

// 2. 結合ファイルをダウンロード
let concatenated_data = download_batch_file(batch_path).await?;

// 3. 特定のテーブルを抽出
let api_port_metadata = metadata.iter()
    .find(|m| m.table_name == "api_port")
    .ok_or("Table not found")?;

let api_port_parquet = extract_table(&concatenated_data, api_port_metadata)?;

// 4. Parquetデータを使用
let df = read_parquet_to_dataframe(&api_port_parquet)?;
```

## パフォーマンス比較

### 従来の方式 (個別Avroアップロード)

仮定: 10テーブル、各テーブル平均100KB

- **アップロード回数**: 10回
- **APIコール**: 10回
- **合計データサイズ**: 1MB (非圧縮)
- **ネットワークオーバーヘッド**: 10 × HTTPヘッダー

### 新方式 (バッチParquetアップロード)

- **アップロード回数**: 2回 (データ + メタデータ)
- **APIコール**: 2回
- **合計データサイズ**: 約500KB (Parquet SNAPPY圧縮)
- **ネットワークオーバーヘッド**: 2 × HTTPヘッダー

**改善率**:
- アップロード回数: **80%削減** (10 → 2)
- データサイズ: **50%削減** (1MB → 500KB)
- APIコール: **80%削減** (10 → 2)

## 依存関係

### 新規追加された依存

**Workspace** (`packages/kc_api/Cargo.toml`):
```toml
[workspace.dependencies]
tokio = { version = "1", features = ["rt", "rt-multi-thread"] }
```

**kc-api-database** (`packages/kc_api/crates/kc-api-database/Cargo.toml`):
```toml
[dependencies]
serde_json = { workspace = true }
tokio = { workspace = true }
```

## テスト

### ユニットテスト

`kc-api-database/src/batch_upload.rs` に含まれるテスト:

```rust
#[test]
fn test_batch_builder_empty();
#[test]
fn test_metadata_serialization();
#[test]
fn test_extract_table();
#[test]
fn test_extract_table_invalid_offset();
```

### 実行方法

```bash
cd packages/kc_api
cargo test -p kc-api-database batch_upload
```

## 今後の拡張

### 1. データ整合性検証
- チェックサム追加 (SHA256ハッシュ)
- メタデータにハッシュを含めて検証

### 2. 圧縮オプション
- ZSTD圧縮のサポート
- 圧縮レベルの設定可能化

### 3. 並列処理
- 複数テーブルの変換を並列化 (tokio::spawn)

### 4. エラーリカバリ
- 部分的失敗時のリトライ
- 失敗したテーブルのみ再アップロード

## まとめ

バッチアップロード機能により、以下のメリットが得られます：

✅ **効率性**: APIコール数とデータサイズの大幅削減  
✅ **拡張性**: Parquet形式による分析クエリの高速化  
✅ **管理性**: メタデータによる柔軟なテーブル抽出  
✅ **コスト削減**: ストレージと帯域幅の最適化

この実装により、FUSOUアプリケーションのクラウドストレージ連携が大幅に改善されました。
