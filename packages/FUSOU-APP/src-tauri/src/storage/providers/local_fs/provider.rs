use std::path::{Path, PathBuf};

use kc_api::database::table::PORT_TABLE_NAMES;
use tokio::fs;

#[cfg(any(not(dev), check_release))]
use crate::storage::constants::STORAGE_ROOT_DIR_NAME;
use crate::storage::constants::{
    LOCAL_STORAGE_PROVIDER_NAME, MASTER_DATA_FOLDER_NAME,
    PERIOD_ROOT_FOLDER_NAME, STORAGE_SUB_DIR_NAME,
    TRANSACTION_DATA_FOLDER_NAME,
};
use crate::storage::service::{StorageError, StorageFuture, StorageProvider};
use crate::storage::common::{
    get_all_get_data_tables, get_all_port_tables,
    generate_port_table_filename, generate_master_data_filename,
    integrate_by_table_name,
};

#[derive(Debug, Clone)]
pub struct LocalFileSystemProvider {
    root: PathBuf,
}

impl LocalFileSystemProvider {
    pub fn try_new(output_directory: Option<String>) -> Result<Self, StorageError> {
        let root = output_directory
            .map(PathBuf::from)
            .unwrap_or_else(default_root_directory);
        Ok(Self { root })
    }

    fn period_directory(&self, period_tag: &str) -> PathBuf {
        self.root.join(PERIOD_ROOT_FOLDER_NAME).join(period_tag)
    }

    async fn ensure_dir(path: &Path) -> Result<(), StorageError> {
        fs::create_dir_all(path).await?;
        Ok(())
    }
}

fn default_root_directory() -> PathBuf {
    #[cfg(dev)]
    {
        // In dev, place DB at the same hierarchy as packages/FUSOU-PROXY-DATA
        // From src-tauri, two levels up is packages/
        return PathBuf::from("./../../")
            // .join(STORAGE_ROOT_DIR_NAME)
            .join(STORAGE_SUB_DIR_NAME);
    }

    #[cfg(any(not(dev), check_release))]
    {
        if let Some(doc_dir) = dirs::document_dir() {
            doc_dir
                .join(STORAGE_ROOT_DIR_NAME)
                .join(STORAGE_SUB_DIR_NAME)
        } else if let Ok(current_dir) = std::env::current_dir() {
            current_dir
                .join(STORAGE_ROOT_DIR_NAME)
                .join(STORAGE_SUB_DIR_NAME)
        } else {
            PathBuf::from(STORAGE_ROOT_DIR_NAME).join(STORAGE_SUB_DIR_NAME)
        }
    }
}

use kc_api::database::table::{GetDataTableEncode, PortTableEncode};

impl StorageProvider for LocalFileSystemProvider {
    fn name(&self) -> &'static str {
        LOCAL_STORAGE_PROVIDER_NAME
    }

    fn write_get_data_table<'a>(
        &'a self,
        period_tag: &'a str,
        table: &'a GetDataTableEncode,
    ) -> StorageFuture<'a, Result<(), StorageError>> {
        Box::pin(async move {
            let period_dir = self.period_directory(period_tag);
            let master_dir = period_dir.join(MASTER_DATA_FOLDER_NAME);
            Self::ensure_dir(&master_dir).await?;

            for (table_name, bytes) in get_all_get_data_tables(table) {
                let file_path = master_dir.join(generate_master_data_filename(table_name));
                fs::write(file_path, bytes).await?;
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
            let period_dir = self.period_directory(period_tag);
            let transaction_dir = period_dir.join(TRANSACTION_DATA_FOLDER_NAME);
            let map_dir = transaction_dir.join(format!("{}-{}", maparea_id, mapinfo_no));
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
                let table_dir = map_dir.join(table_name);
                Self::ensure_dir(&table_dir).await?;
                let file_path = table_dir.join(&file_name);
                fs::write(&file_path, bytes).await?;
                tracing::info!(
                    "Saved {} table to local FS: {} ({} bytes)",
                    table_name,
                    file_path.display(),
                    bytes.len()
                );
            }

            Ok(())
        })
    }

    fn integrate_port_table<'a>(
        &'a self,
        period_tag: &'a str,
        _page_size: i32,
    ) -> StorageFuture<'a, Result<(), StorageError>> {
        Box::pin(async move {
            let period_dir = self.period_directory(period_tag);
            let transaction_dir = period_dir.join(TRANSACTION_DATA_FOLDER_NAME);

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

                // Process each table type
                for table_name in PORT_TABLE_NAMES.iter() {
                    let table_dir = map_dir.join(table_name);
                    if !table_dir.exists() {
                        continue;
                    }

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

                    // Read all file contents
                    let mut file_contents = Vec::new();
                    for file_path in &file_paths {
                        let content = fs::read(file_path).await?;
                        file_contents.push(content);
                    }

                    // Integrate using common utility
                    match integrate_by_table_name(table_name, file_contents) {
                        Ok(content) if !content.is_empty() => {
                            // Write integrated file
                            let integrated_path = table_dir.join(&file_name);
                            fs::write(&integrated_path, content).await?;

                            // Delete original files
                            for file_path in &file_paths {
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
