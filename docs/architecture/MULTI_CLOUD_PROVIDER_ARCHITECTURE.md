# Multi-Cloud Provider Architecture（設計・拡張予定）

## 概要
FUSOU は複数のクラウドストレージプロバイダ（Google Drive, Dropbox, iCloud, OneDrive など）に対応できる拡張性のあるアーキテクチャを採用しています。

**現在の状況**: Google Drive のみ実装済み。その他プロバイダは trait インターフェース設計済みで、実装待ちです。

## アーキテクチャ

### 1. Supabase テーブル構造

```sql
create table public.provider_tokens (
  user_id uuid not null,
  provider_name text not null,           -- 'google', 'dropbox', 'icloud', 'onedrive', etc.
  access_token text not null,
  refresh_token text not null,
  expires_at timestamp with time zone null,
  constraint provider_tokens_pkey primary key (user_id, provider_name),
  constraint fk_user foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;
```

**拡張性：**
- ✅ `provider_name` で複数プロバイダを識別（スキーマ変更不要）
- ✅ 1ユーザーが複数のクラウドサービスを同時利用可能
- ⏳ 新しいプロバイダ追加時は trait 実装 + factory 登録のみ

### 2. Rust バックエンド（共通インターフェース）

#### `storage/cloud_provider_trait.rs`
```rust
pub trait CloudStorageProvider: Send + Sync {
    fn provider_name(&self) -> &str;
    
    fn initialize(&mut self, refresh_token: String) 
        -> Pin<Box<dyn Future<Output = Result<(), Box<dyn std::error::Error>>> + Send + '_>>;
    
    fn upload_file(&self, local_path: &Path, remote_path: &str) 
        -> Pin<Box<dyn Future<Output = Result<String, Box<dyn std::error::Error>>> + Send + '_>>;
    
    fn download_file(&self, remote_path: &str, local_path: &Path)
        -> Pin<Box<dyn Future<Output = Result<(), Box<dyn std::error::Error>>> + Send + '_>>;
    
    fn create_folder(&self, remote_path: &str)
        -> Pin<Box<dyn Future<Output = Result<String, Box<dyn std::error::Error>>> + Send + '_>>;
    
    fn list_files(&self, remote_path: &str)
        -> Pin<Box<dyn Future<Output = Result<Vec<FileInfo>, Box<dyn std::error::Error>>> + Send + '_>>;
}
```
- ✅ tokio ネイティブの `Pin<Box<dyn Future>>` を使用（`async-trait` 不要）
- ✅ 共通インターフェース定義で新プロバイダ追加が容易

#### `storage/providers/gdrive/` - Google Drive 実装（現在のみ）
```rust
pub struct GoogleDriveProvider { /* ... */ }

impl CloudStorageProvider for GoogleDriveProvider { /* ... */ }
```
- ✅ Google Drive API v3 統合（実装完了）
- ✅ トークンリフレッシュ対応

#### `storage/cloud_provider_trait.rs` - Factory パターン
```rust
pub struct CloudProviderFactory;

impl CloudProviderFactory {
    pub fn create(provider_name: &str) -> Result<Box<dyn CloudStorageProvider>, String> {
        match provider_name {
            "google" => Ok(Box::new(GoogleDriveProvider::new())),
            "dropbox" => Err("Dropbox provider not yet implemented".to_string()),
            "icloud" => Err("iCloud provider not yet implemented".to_string()),
            "onedrive" => Err("OneDrive provider not yet implemented".to_string()),
            _ => Err(format!("Unknown provider: {}", provider_name)),
        }
    }
    
    pub fn supported_providers() -> Vec<&'static str> {
        vec!["google"] // TODO: dropbox, icloud, onedrive を追加
    }
}

pub struct DropboxProvider {
    refresh_token: Option<String>,
    client: DropboxClient,
}

impl CloudStorageProvider for DropboxProvider {
    fn provider_name(&self) -> &str {
        "dropbox"
    }
    
    fn initialize(&mut self, refresh_token: String) 
        -> Pin<Box<dyn Future<Output = Result<(), Box<dyn std::error::Error>>> + Send + '_>> 
    {
        Box::pin(async move {
            self.refresh_token = Some(refresh_token);
            // Dropbox 認証初期化
            Ok(())
        })
    }
    
    fn upload_file(&self, local_path: &Path, remote_path: &str) 
        -> Pin<Box<dyn Future<Output = Result<String, Box<dyn std::error::Error>>> + Send + '_>> 
    {
        Box::pin(async move {
            // Dropbox API でアップロード
            Ok("file_id".to_string())
        })
    }
    
    // ... 他のメソッド実装
}
```

### 3. Factory に登録
```rust
// src/storage/cloud_provider_trait.rs
impl CloudProviderFactory {
    pub fn create(provider_name: &str) -> Result<Box<dyn CloudStorageProvider>, String> {
        match provider_name.to_lowercase().as_str() {
            "google" => Ok(Box::new(GoogleDriveProvider::new())),
            "dropbox" => Ok(Box::new(DropboxProvider::new())),  // 追加
            "icloud" => Ok(Box::new(ICloudProvider::new())),
            // ...
        }
    }
    
    pub fn supported_providers() -> Vec<&'static str> {
        vec!["google", "dropbox", "icloud", "onedrive"]  // 追加
    }
}
```

### 4. 完了！
- ✅ 起動時に自動的にトークン取得
- ✅ アップロード時に自動的に使用
- ✅ 他のコード変更不要

## メリット

### 拡張性
- 🔹 新しいプロバイダ追加が容易（trait 実装のみ）
- 🔹 Supabase テーブル構造変更不要
- 🔹 既存コードへの影響最小限

### 保守性
- 🔹 共通インターフェースで統一
- 🔹 プロバイダ固有のロジックは隔離
- 🔹 テストが容易

### スケーラビリティ
- 🔹 複数プロバイダ同時利用可能
- 🔹 ユーザーごとに異なるプロバイダ選択可能
- 🔹 プロバイダごとに異なる設定可能

## 現在のサポート状況

| プロバイダ | 実装状況 | トークン管理 | アップロード | ダウンロード |
|-----------|---------|------------|------------|------------|
| Google Drive | ✅ 実装済み | ✅ | ✅ | ✅ |
| Dropbox | 🔨 準備済み | ✅ | ⏳ | ⏳ |
| iCloud | 🔨 準備済み | ✅ | ⏳ | ⏳ |
| OneDrive | 🔨 準備済み | ✅ | ⏳ | ⏳ |

**凡例：**
- ✅ 実装完了
- 🔨 インターフェース準備済み
- ⏳ 今後実装予定
