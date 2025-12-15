// Cloud storage provider trait for extensibility

use std::future::Future;
use std::path::Path;
use std::pin::Pin;

use crate::storage::providers::GoogleDriveCloudStorageProvider;

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
    /// Create a provider instance by name
    pub fn create(provider_name: &str) -> Result<Box<dyn CloudStorageProvider>, String> {
        match provider_name.to_lowercase().as_str() {
            "google" => Ok(Box::new(GoogleDriveCloudStorageProvider::default())),
            "dropbox" => {
                // Future: DropboxProvider implements CloudStorageProvider
                Err("Dropbox provider not yet implemented".to_string())
            }
            "icloud" => {
                // Future: iCloudProvider implements CloudStorageProvider
                Err("iCloud provider not yet implemented".to_string())
            }
            "onedrive" => {
                // Future: OneDriveProvider implements CloudStorageProvider
                Err("OneDrive provider not yet implemented".to_string())
            }
            _ => Err(format!("Unknown provider: {}", provider_name)),
        }
    }
    
    /// List all supported providers
    pub fn supported_providers() -> Vec<&'static str> {
        // vec!["google", "dropbox", "icloud", "onedrive"]
        vec!["google"]
    }
}
