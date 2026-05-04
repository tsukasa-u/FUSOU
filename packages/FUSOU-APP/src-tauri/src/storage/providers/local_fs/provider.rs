use std::path::{Path, PathBuf};
use std::collections::HashMap;
use std::sync::Arc;

use cap_std::fs::Dir;
use kc_api::database::table::PORT_TABLE_NAMES;
use tokio::fs;

use crate::storage::constants::LOCAL_STORAGE_PROVIDER_NAME;
use crate::storage::root_validator;
use crate::storage::service::{StorageError, StorageFuture, StorageProvider};
use crate::storage::common::{
    get_all_get_data_tables, get_all_port_tables,
    generate_port_table_filename, generate_master_data_filename,
    integrate_by_table_name,
    path_layout,
};
use fusou_upload::{PendingSaveOutcome, PendingStore, UploadContext, UploadRetryService};

#[derive(Clone)]
pub struct LocalFileSystemProvider {
    root: PathBuf,
    /// cap-std Dir handle rooted at `root`.  All write operations go through
    /// this handle, which uses openat internally and prevents symlink escapes
    /// and TOCTOU races at the kernel level.
    root_dir: Arc<Dir>,
    pending_store: Arc<PendingStore>,
    retry_service: Arc<UploadRetryService>,
}

impl LocalFileSystemProvider {
    pub fn try_new(
        output_directory: Option<String>,
        pending_store: Arc<PendingStore>,
        retry_service: Arc<UploadRetryService>,
    ) -> Result<Self, StorageError> {
        let root = root_validator::resolve_root(output_directory);
        let root_dir = Arc::new(root_validator::open_root_dir(&root).map_err(|e| {
            StorageError::Io(std::io::Error::other(e.to_string()))
        })?);
        Ok(Self {
            root,
            root_dir,
            pending_store,
            retry_service,
        })
    }

    /// Get the integration batch size for LocalFS
    /// LocalFS uses integration_batch_size from config (default 500)
    pub fn get_integration_batch_size(&self) -> i32 {
        configs::get_user_configs_for_app()
            .database
            .local
            .get_integration_batch_size()
    }

    async fn ensure_dir(path: &Path) -> Result<(), StorageError> {
        fs::create_dir_all(path).await?;
        Ok(())
    }

    fn queue_local_write_retry(&self, file_path: &Path, bytes: &[u8], _error_msg: &str) {
        let pending_save = self.pending_store.clone();
        let retry = self.retry_service.clone();
        let path = file_path.to_string_lossy().to_string();
        let relative_path = match file_path.strip_prefix(&self.root) {
            Ok(rel) => rel.to_string_lossy().to_string(),
            Err(_) => {
                tracing::warn!(
                    file_path = %file_path.display(),
                    root = %self.root.display(),
                    "local fs write failed outside configured root; skipping pending retry"
                );
                return;
            }
        };
        let data = bytes.to_vec();

        tokio::spawn(async move {
            let mut headers = HashMap::new();
            headers.insert("remote-path".to_string(), path.clone());

            let context = UploadContext::Custom(serde_json::json!({
                "operation": "localfs_write",
                "relative_path": relative_path,
            }));
            let context_str = serde_json::to_string(&context).unwrap_or_default();

            match pending_save.save_pending("localfs", &headers, &data, Some(context_str)) {
                Ok(PendingSaveOutcome::Created(_)) => {
                    tracing::warn!("local fs write failed; saved pending upload for retry");
                    retry.trigger_retry().await;
                }
                Ok(PendingSaveOutcome::Existing(meta)) => {
                    tracing::info!(pending_id = %meta.id, "matching pending localfs retry already exists");
                }
                Err(e) => {
                    tracing::warn!(error = %e, "failed to save pending localfs retry");
                }
            }
        });
    }
}

use kc_api::database::table::{GetDataTableEncode, PortTableEncode};

impl StorageProvider for LocalFileSystemProvider {
    fn name(&self) -> &'static str {
        LOCAL_STORAGE_PROVIDER_NAME
    }

    fn supports_integration(&self) -> bool {
        // Local FS integrates when user enabled local storage in config
        configs::get_user_configs_for_app().database.get_allow_data_to_local()
    }

    fn write_get_data_table<'a>(
        &'a self,
        period_tag: &'a str,
        table: &'a GetDataTableEncode,
    ) -> StorageFuture<'a, Result<(), StorageError>> {
        Box::pin(async move {
            let master_dir = path_layout::master_dir(&self.root, period_tag);
            Self::ensure_dir(&master_dir).await?;

            for (table_name, bytes) in get_all_get_data_tables(table) {
                let file_path = master_dir.join(generate_master_data_filename(table_name));
                let relative = match file_path.strip_prefix(&self.root) {
                    Ok(r) => r.to_string_lossy().to_string(),
                    Err(_) => {
                        tracing::error!("master data path outside root; skipping");
                        continue;
                    }
                };
                let dir = Arc::clone(&self.root_dir);
                let data = bytes.to_vec();
                if let Err(e) = root_validator::write_at_relative_async(dir, relative, data).await {
                    let io_err = std::io::Error::other(e.to_string());
                    self.queue_local_write_retry(&file_path, bytes, &io_err.to_string());
                    return Err(StorageError::Io(io_err));
                }
            }

            Ok(())
        })
    }

    fn write_port_table<'a>(
        &'a self,
        period_tag: &'a str,
        table: &'a PortTableEncode,
        maparea_id: i64,
        mapinfo_no: i64,
    ) -> StorageFuture<'a, Result<(), StorageError>> {
        Box::pin(async move {
            let map_dir = path_layout::map_dir(&self.root, period_tag, maparea_id, mapinfo_no);
            Self::ensure_dir(&map_dir).await?;

            let file_name = generate_port_table_filename();

            for (table_name, bytes) in get_all_port_tables(table) {
                if bytes.is_empty() {
                    tracing::warn!(
                        "Skipping write of empty {} table for map {}-{}",
                        table_name,
                        maparea_id,
                        mapinfo_no
                    );
                    continue;
                }
                let table_dir = path_layout::table_dir(&self.root, period_tag, maparea_id, mapinfo_no, table_name);
                Self::ensure_dir(&table_dir).await?;
                let file_path = table_dir.join(&file_name);
                let relative = match file_path.strip_prefix(&self.root) {
                    Ok(r) => r.to_string_lossy().to_string(),
                    Err(_) => {
                        tracing::error!("port table path outside root; skipping");
                        continue;
                    }
                };
                let dir = Arc::clone(&self.root_dir);
                let data = bytes.to_vec();
                let len = data.len();
                if let Err(e) = root_validator::write_at_relative_async(dir, relative, data).await {
                    let io_err = std::io::Error::other(e.to_string());
                    self.queue_local_write_retry(&file_path, bytes, &io_err.to_string());
                    return Err(StorageError::Io(io_err));
                }
                tracing::info!(
                    "Saved {} table to local FS: {} ({} bytes)",
                    table_name,
                    file_path.display(),
                    len
                );
            }

            Ok(())
        })
    }

    fn integrate_port_table<'a>(
        &'a self,
        period_tag: &'a str,
    ) -> StorageFuture<'a, Result<(), StorageError>> {
        Box::pin(async move {
            // LocalFS: use provider's batch size configuration
            let batch_size = self.get_integration_batch_size();

            let transaction_dir = path_layout::transaction_root_dir(&self.root, period_tag);

            // Check if transaction_dir exists
            if !transaction_dir.exists() {
                return Ok(());
            }

            // Get all map directories (e.g., "1-5", "2-3")
            let mut map_dirs = Vec::new();
            let mut entries = fs::read_dir(&transaction_dir).await?;
            while let Some(entry) = entries.next_entry().await? {
                let path = entry.path();
                if path.is_dir() {
                    map_dirs.push(path);
                }
            }

            // Process each map directory
            for map_dir in map_dirs {
                let file_name = generate_port_table_filename();

                // Resolve map ids from folder name for consistent logging
                let (maparea_id, mapinfo_no) = map_dir
                    .file_name()
                    .and_then(std::ffi::OsStr::to_str)
                    .and_then(path_layout::parse_map_ids)
                    .unwrap_or((0, 0));

                // Process each table type
                for table_name in PORT_TABLE_NAMES.iter() {
                    let table_dir = map_dir.join(table_name);
                    if !table_dir.exists() {
                        continue;
                    }
                    tracing::debug!(
                        "Scanning table {} in map {}-{} (dir: {:?})",
                        table_name,
                        maparea_id,
                        mapinfo_no,
                        table_dir
                    );

                    // Collect all files in this table directory
                    let mut file_paths = Vec::new();
                    let mut table_entries = fs::read_dir(&table_dir).await?;
                    while let Some(entry) = table_entries.next_entry().await? {
                        let path = entry.path();
                        if path.is_file()
                            && path.extension().and_then(|s| s.to_str()) == Some("avro")
                        {
                            file_paths.push(path);
                        }
                    }

                    // Need at least 2 files to integrate
                    if file_paths.len() < 2 {
                        continue;
                    }

                    // Limit files per integration batch (align with cloud provider)
                    let files_to_process: Vec<_> = file_paths
                        .into_iter()
                        .take(batch_size as usize)
                        .collect();

                    if files_to_process.len() < 2 {
                        continue;
                    }

                    tracing::info!(
                        "Integrating {} files for table {} in map {}-{}",
                        files_to_process.len(),
                        table_name,
                        maparea_id,
                        mapinfo_no
                    );

                    // Read selected file contents
                    let mut file_contents = Vec::new();
                    for file_path in &files_to_process {
                        let content = fs::read(file_path).await?;
                        file_contents.push(content);
                    }

                    // Integrate using common utility
                    match integrate_by_table_name(table_name, file_contents) {
                        Ok(content) if !content.is_empty() => {
                            // Write integrated file
                            let integrated_path = table_dir.join(&file_name);
                            let relative = match integrated_path.strip_prefix(&self.root) {
                                Ok(r) => r.to_string_lossy().to_string(),
                                Err(_) => {
                                    tracing::error!("integrated path outside root; skipping");
                                    continue;
                                }
                            };
                            let dir = Arc::clone(&self.root_dir);
                            root_validator::write_at_relative_async(dir, relative, content)
                                .await
                                .map_err(|e| StorageError::Io(std::io::Error::other(e.to_string())))?;

                            // Delete original files
                            for file_path in &files_to_process {
                                if let Err(e) = fs::remove_file(file_path).await {
                                    tracing::warn!("Failed to delete file {:?}: {}", file_path, e);
                                }
                            }
                        }
                        Ok(_) => {
                            // Empty content, skip
                        }
                        Err(e) => {
                            tracing::error!("Failed to integrate table {}: {:?}", table_name, e);
                        }
                    }
                }
            }

            Ok(())
        })
    }
}
