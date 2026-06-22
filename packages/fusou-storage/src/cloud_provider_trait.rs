// Cloud storage provider trait for extensibility

use std::future::Future;
use std::path::Path;
use std::pin::Pin;

#[cfg(feature = "gdrive")]
use crate::providers::GoogleDriveCloudStorageProvider;

pub const GOOGLE_PROVIDER_KEY: &str = "google";
pub const DROPBOX_PROVIDER_KEY: &str = "dropbox";
pub const ICLOUD_PROVIDER_KEY: &str = "icloud";
pub const ONEDRIVE_PROVIDER_KEY: &str = "onedrive";

/// Common interface for cloud storage providers (Google Drive, iCloud, Dropbox, etc.)
pub trait CloudStorageProvider: Send + Sync {
    /// Initialize the provider with refresh token
    fn initialize(
        &mut self,
        refresh_token: String,
    ) -> Pin<Box<dyn Future<Output = Result<(), Box<dyn std::error::Error>>> + Send + '_>>;
    
    /// Upload file to cloud storage
    fn upload_file(
        &self,
        local_path: &Path,
        remote_path: &str,
    ) -> Pin<Box<dyn Future<Output = Result<String, Box<dyn std::error::Error>>> + Send + '_>>;
    
    /// Download file from cloud storage
    fn download_file(
        &self,
        remote_path: &str,
        local_path: &Path,
    ) -> Pin<Box<dyn Future<Output = Result<(), Box<dyn std::error::Error>>> + Send + '_>>;
    
    /// List files in a directory
    fn list_files(
        &self,
        remote_path: &str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<String>, Box<dyn std::error::Error>>> + Send + '_>>;
    
    /// List folders (subdirectories) in a directory
    fn list_folders(
        &self,
        remote_path: &str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<String>, Box<dyn std::error::Error>>> + Send + '_>>;
    
    /// Delete file from cloud storage
    fn delete_file(
        &self,
        remote_path: &str,
    ) -> Pin<Box<dyn Future<Output = Result<(), Box<dyn std::error::Error>>> + Send + '_>>;
    
    /// Create folder in cloud storage
    fn create_folder(
        &self,
        remote_path: &str,
    ) -> Pin<Box<dyn Future<Output = Result<String, Box<dyn std::error::Error>>> + Send + '_>>;

    /// Check if a file exists in cloud storage
    fn file_exists(
        &self,
        remote_path: &str,
    ) -> Pin<Box<dyn Future<Output = Result<bool, Box<dyn std::error::Error>>> + Send + '_>>;
}

/// Factory for creating cloud storage providers
pub struct CloudProviderFactory;

impl CloudProviderFactory {
    pub fn canonicalize_provider_name(provider_name: &str) -> Option<&'static str> {
        let normalized = provider_name.trim().to_ascii_lowercase();
        match normalized.as_str() {
            GOOGLE_PROVIDER_KEY | "google_drive" | "gdrive" => Some(GOOGLE_PROVIDER_KEY),
            DROPBOX_PROVIDER_KEY => Some(DROPBOX_PROVIDER_KEY),
            ICLOUD_PROVIDER_KEY => Some(ICLOUD_PROVIDER_KEY),
            ONEDRIVE_PROVIDER_KEY => Some(ONEDRIVE_PROVIDER_KEY),
            _ => None,
        }
    }

    pub fn known_providers() -> Vec<&'static str> {
        vec![
            GOOGLE_PROVIDER_KEY,
            DROPBOX_PROVIDER_KEY,
            ICLOUD_PROVIDER_KEY,
            ONEDRIVE_PROVIDER_KEY,
        ]
    }

    /// Create a provider instance by name
    #[allow(unused_variables)]
    pub fn create(provider_name: &str) -> Result<Box<dyn CloudStorageProvider>, String> {
        let Some(canonical_provider) = Self::canonicalize_provider_name(provider_name) else {
            return Err(format!(
                "Unknown provider: {}. Known providers: {}",
                provider_name,
                Self::known_providers().join(", ")
            ));
        };

        match canonical_provider {
            #[cfg(feature = "gdrive")]
            GOOGLE_PROVIDER_KEY => Ok(Box::new(GoogleDriveCloudStorageProvider::default())),
            #[cfg(not(feature = "gdrive"))]
            GOOGLE_PROVIDER_KEY => {
                Err("Provider 'google' is disabled in this build (enable feature 'gdrive')."
                    .to_string())
            }
            _ => Err(format!(
                "Provider '{}' is recognized but not implemented in this build",
                canonical_provider
            )),
        }
    }
    
    /// List all supported providers
    pub fn supported_providers() -> Vec<&'static str> {
        vec![
            #[cfg(feature = "gdrive")]
            GOOGLE_PROVIDER_KEY,
        ]
    }
}
