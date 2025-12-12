# Multi-Cloud Provider Support Architecture

## 概要
FUSOU は複数のクラウドストレージプロバイダ（Google Drive, Dropbox, iCloud, OneDrive など）に対応できる拡張性のあるアーキテクチャを採用しています。

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
- ✅ `provider_name` で複数プロバイダを識別
- ✅ 1ユーザーが複数のクラウドサービスを同時利用可能
- ✅ 新しいプロバイダ追加時にスキーマ変更不要

### 2. Rust バックエンド

#### `fusou-auth/src/manager.rs`
```rust
pub async fn fetch_provider_token(&self, provider_name: &str) -> Result<Option<String>, AuthError>
```
- ✅ プロバイダ名をパラメータで受け取る
- ✅ 任意のプロバイダトークンを取得可能

#### `storage/cloud_provider_trait.rs`
```rust
use std::future::Future;
use std::pin::Pin;

pub trait CloudStorageProvider: Send + Sync {
    fn provider_name(&self) -> &str;
    
    fn initialize(&mut self, refresh_token: String) 
        -> Pin<Box<dyn Future<Output = Result<(), Box<dyn std::error::Error>>> + Send + '_>>;
    
    fn upload_file(&self, local_path: &Path, remote_path: &str) 
        -> Pin<Box<dyn Future<Output = Result<String, Box<dyn std::error::Error>>> + Send + '_>>;
    // ... 他のメソッド
}
```
- ✅ tokioネイティブの`Pin<Box<dyn Future>>`を使用（`async-trait`不要）
- ✅ 共通インターフェース定義
- ✅ 新しいプロバイダは trait を実装するだけ

#### `storage/providers/gdrive/client.rs`
```rust
pub static CLOUD_PROVIDER_TOKENS: Lazy<Mutex<HashMap<String, UserAccessTokenInfo>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn set_refresh_token(refresh_token: String, provider_name: String) -> Result<(), ()>
pub fn get_refresh_token(provider_name: &str) -> Option<UserAccessTokenInfo>
```
- ✅ HashMap で複数プロバイダのトークン管理
- ✅ プロバイダ名で識別

#### `lib.rs` - 起動時処理
```rust
let supported_providers = storage::CloudProviderFactory::supported_providers();

for provider in supported_providers {
    match auth_manager_for_startup.fetch_provider_token(provider).await {
        Ok(Some(token)) => {
            storage::providers::gdrive::set_refresh_token(token, provider.to_string())?;
        }
        // ...
    }
}
```
- ✅ 全プロバイダのトークンを自動取得
- ✅ 新しいプロバイダは `supported_providers()` に追加するだけ

## 新しいプロバイダの追加手順

### 1. Supabase にトークンを保存
```sql
INSERT INTO provider_tokens (user_id, provider_name, refresh_token, access_token)
VALUES (
  auth.uid(),
  'dropbox',  -- 新しいプロバイダ名
  '<refresh_token>',
  '<access_token>'
);
```

### 2. Rust でプロバイダ実装を作成
```rust
// src/storage/providers/dropbox/mod.rs
use std::future::Future;
use std::pin::Pin;

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
