use std::path::Path;
use std::pin::Pin;
use std::future::Future;

use google_drive3::{hyper_rustls, hyper_util, DriveHub};

use crate::storage::cloud_provider_trait::CloudStorageProvider;
use crate::storage::constants::{GOOGLE_DRIVE_ROOT_FOLDER_ID};

use super::api::{check_folder, check_or_create_folder, delete_file_raw, get_file_content};
use super::client::{create_auth, DriveClient, set_refresh_token, get_refresh_token};

/// Minimal Google Drive adapter that satisfies CloudStorageProvider.
#[derive(Default, Clone)]
pub struct GoogleDriveCloudStorageProvider;

impl GoogleDriveCloudStorageProvider {
    fn split_path(&self, remote_path: &str) -> Result<(Vec<String>, String), String> {
        let trimmed = remote_path.trim_matches('/');
        if trimmed.is_empty() {
            return Err("remote_path is empty".into());
        }
        let mut parts: Vec<String> = trimmed
            .split('/')
            .filter(|p| !p.is_empty())
            .map(|p| p.to_string())
            .collect();
        let file_name = parts.pop().ok_or_else(|| "remote_path is empty".to_string())?;
        Ok((parts, file_name))
    }

    async fn build_client(&self) -> Result<DriveClient, Box<dyn std::error::Error>> {
        let auth = create_auth().await.ok_or_else(|| "google auth not initialized".to_string())?;

        let client = hyper_util::client::legacy::Client::builder(hyper_util::rt::TokioExecutor::new())
            .build(
                hyper_rustls::HttpsConnectorBuilder::new()
                    .with_native_roots()
                    .unwrap()
                    .https_or_http()
                    .enable_http1()
                    .build(),
            );

        Ok(DriveHub::new(client, auth))
    }

    async fn resolve_folder(
        &self,
        hub: &mut DriveClient,
        folders: &[String],
        create: bool,
    ) -> Result<Option<String>, String> {
        let mut current: Option<String> = Some(GOOGLE_DRIVE_ROOT_FOLDER_ID.to_string());
        for name in folders {
            let next = if create {
                check_or_create_folder(hub, name.clone(), current.clone()).await
            } else {
                check_folder(hub, name.clone(), current.clone()).await
            };

            match next {
                Some(id) => current = Some(id),
                None => return Ok(None),
            }
        }
        Ok(current)
    }

    async fn resolve_file_id(
        &self,
        hub: &mut DriveClient,
        remote_path: &str,
    ) -> Result<Option<String>, String> {
        let (folders, file_name) = self.split_path(remote_path)?;
        let parent = match self.resolve_folder(hub, &folders, false).await? {
            Some(id) => id,
            None => return Ok(None),
        };
        let query = format!(
            "mimeType!='application/vnd.google-apps.folder' and name='{file_name}' and trashed = false and '{parent}' in parents"
        );

        let result = hub
            .files()
            .list()
            .q(&query)
            .param("fields", "files(id)")
            .page_size(1)
            .doit()
            .await
            .map_err(|e| format!("failed to find file: {e:?}"))?;

        let files = result.1.files.unwrap_or_default();
        Ok(files.get(0).and_then(|f| f.id.clone()))
    }
}

impl CloudStorageProvider for GoogleDriveCloudStorageProvider {
    fn provider_name(&self) -> &str {
        "google"
    }

    fn initialize(
        &mut self,
        refresh_token: String,
    ) -> Pin<Box<dyn Future<Output = Result<(), Box<dyn std::error::Error>>> + Send + '_>> {
        Box::pin(async move {
            set_refresh_token(refresh_token, "google".to_string())
                .map_err(|_| -> Box<dyn std::error::Error> { "failed to store refresh token".into() })?;
            // Attempt to build client to validate token
            self.build_client().await.map(|_| ())
        })
    }

    fn is_authenticated(&self) -> bool {
        get_refresh_token("google").is_some()
    }

    fn upload_file(
        &self,
        local_path: &Path,
        remote_path: &str,
    ) -> Pin<Box<dyn Future<Output = Result<String, Box<dyn std::error::Error>>> + Send + '_>> {
        let local_path_buf = local_path.to_path_buf();
        let remote_path_owned = remote_path.to_string();
        Box::pin(async move {
            let (folders, file_name) = self.split_path(&remote_path_owned)?;
            let mut hub = self.build_client().await?;

            let bytes = tokio::fs::read(local_path_buf).await?;
            let parent = self
                .resolve_folder(&mut hub, &folders, true)
                .await?
                .ok_or_else(|| "failed to prepare parent folder".to_string())?;

            let file_id = super::api::create_or_replace_file_raw(
                &mut hub,
                file_name,
                "application/octet-stream".to_string(),
                &bytes,
                Some(parent),
            )
            .await
            .map_err(|e| format!("failed to upload to google drive: {e:?}"))?;

            Ok(file_id)
        })
    }

    fn download_file(
        &self,
        remote_path: &str,
        local_path: &Path,
    ) -> Pin<Box<dyn Future<Output = Result<(), Box<dyn std::error::Error>>> + Send + '_>> {
        let remote_path_owned = remote_path.to_string();
        let local_path_buf = local_path.to_path_buf();
        Box::pin(async move {
            let mut hub = self.build_client().await?;
            let file_id = self
                .resolve_file_id(&mut hub, &remote_path_owned)
                .await?
                .ok_or_else(|| "file not found".to_string())?;

            let content = get_file_content(&mut hub, file_id)
                .await
                .ok_or_else(|| "failed to download file".to_string())?;

            if let Some(parent) = local_path_buf.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            tokio::fs::write(local_path_buf, content).await?;
            Ok(())
        })
    }

    fn list_files(
        &self,
        remote_path: &str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<String>, Box<dyn std::error::Error>>> + Send + '_>> {
        let remote_path_owned = remote_path.to_string();
        Box::pin(async move {
            let mut hub = self.build_client().await?;

            let trimmed = remote_path_owned.trim_matches('/');
            let folders: Vec<String> = if trimmed.is_empty() {
                Vec::new()
            } else {
                trimmed.split('/').filter(|p| !p.is_empty()).map(|p| p.to_string()).collect()
            };

            let folder_id = match self.resolve_folder(&mut hub, &folders, false).await? {
                Some(id) => id,
                None => return Ok(Vec::new()),
            };

            let query = format!(
                "mimeType!='application/vnd.google-apps.folder' and {trash_filter} and '{folder_id}' in parents",
                trash_filter = crate::storage::constants::GOOGLE_DRIVE_TRASHED_FILTER
            );

            let result = hub
                .files()
                .list()
                .q(&query)
                .param("fields", "files(id,name)")
                .page_size(100)
                .doit()
                .await
                .map_err(|e| format!("failed to list files: {e:?}"))?;

            let files = result
                .1
                .files
                .unwrap_or_default()
                .into_iter()
                .filter_map(|f| f.name)
                .collect();

            Ok(files)
        })
    }

    fn list_folders(
        &self,
        remote_path: &str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<String>, Box<dyn std::error::Error>>> + Send + '_>> {
        let remote_path_owned = remote_path.to_string();
        Box::pin(async move {
            let mut hub = self.build_client().await?;

            let trimmed = remote_path_owned.trim_matches('/');
            let folders: Vec<String> = if trimmed.is_empty() {
                Vec::new()
            } else {
                trimmed.split('/').filter(|p| !p.is_empty()).map(|p| p.to_string()).collect()
            };

            let folder_id = match self.resolve_folder(&mut hub, &folders, false).await? {
                Some(id) => id,
                None => return Ok(Vec::new()),
            };

            let query = format!(
                "mimeType='application/vnd.google-apps.folder' and {trash_filter} and '{folder_id}' in parents",
                trash_filter = crate::storage::constants::GOOGLE_DRIVE_TRASHED_FILTER
            );

            let result = hub
                .files()
                .list()
                .q(&query)
                .param("fields", "files(id,name)")
                .page_size(100)
                .doit()
                .await
                .map_err(|e| format!("failed to list folders: {e:?}"))?;

            let folder_names = result
                .1
                .files
                .unwrap_or_default()
                .into_iter()
                .filter_map(|f| f.name)
                .collect();

            Ok(folder_names)
        })
    }

    fn delete_file(
        &self,
        remote_path: &str,
    ) -> Pin<Box<dyn Future<Output = Result<(), Box<dyn std::error::Error>>> + Send + '_>> {
        let remote_path_owned = remote_path.to_string();
        Box::pin(async move {
            let mut hub = self.build_client().await?;
            let file_id = self
                .resolve_file_id(&mut hub, &remote_path_owned)
                .await?
                .ok_or_else(|| "file not found".to_string())?;

            delete_file_raw(&mut hub, file_id)
                .await
                .map_err(|e| -> Box<dyn std::error::Error> { format!("failed to delete: {e:?}").into() })?;
            Ok(())
        })
    }

    fn create_folder(
        &self,
        remote_path: &str,
    ) -> Pin<Box<dyn Future<Output = Result<String, Box<dyn std::error::Error>>> + Send + '_>> {
        let remote_path_owned = remote_path.to_string();
        Box::pin(async move {
            let trimmed = remote_path_owned.trim_matches('/');
            let folders: Vec<String> = trimmed
                .split('/')
                .filter(|p| !p.is_empty())
                .map(|p| p.to_string())
                .collect();

            if folders.is_empty() {
                return Ok(GOOGLE_DRIVE_ROOT_FOLDER_ID.to_string());
            }

            let mut hub = self.build_client().await?;
            let folder_id = self
                .resolve_folder(&mut hub, &folders, true)
                .await?
                .ok_or_else(|| "failed to create folder".to_string())?;

            Ok(folder_id)
        })
    }

    fn file_exists(
        &self,
        remote_path: &str,
    ) -> Pin<Box<dyn Future<Output = Result<bool, Box<dyn std::error::Error>>> + Send + '_>> {
        let remote_path_owned = remote_path.to_string();
        Box::pin(async move {
            let mut hub = match self.build_client().await {
                Ok(h) => h,
                Err(e) => {
                    tracing::error!("failed to build Google Drive client for file_exists: {e:?}");
                    return Err(e);
                }
            };

            match self.resolve_file_id(&mut hub, &remote_path_owned).await {
                Ok(Some(_)) => Ok(true),
                Ok(None) => Ok(false),
                Err(e) => {
                    tracing::debug!("error checking file existence in Google Drive: {e}");
                    Err(e.into())
                }
            }
        })
    }
}
