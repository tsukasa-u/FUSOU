use std::sync::Arc;
use std::collections::HashMap;

use kc_api::database::table::PORT_TABLE_NAMES;

use crate::storage::constants::{
    GOOGLE_DRIVE_AVRO_MIME_TYPE, GOOGLE_DRIVE_FOLDER_MIME_TYPE,
    GOOGLE_DRIVE_PROVIDER_NAME, GOOGLE_DRIVE_ROOT_FOLDER_ID,
    MASTER_DATA_FOLDER_NAME, PERIOD_ROOT_FOLDER_NAME,
    TRANSACTION_DATA_FOLDER_NAME,
};
use crate::storage::service::{StorageError, StorageFuture, StorageProvider};
use crate::storage::common::{
    get_all_get_data_tables, get_all_port_tables,
    generate_port_table_filename, generate_master_data_filename,
    integrate_by_table_name,
};
use crate::auth::auth_server;
use super::{GoogleDriveWrapper, create_client, check_or_create_folder, check_or_create_folders, check_or_create_folder_hierarchical, get_file_list_in_folder, get_file_content};

use fusou_upload::{PendingStore, UploadRetryService};

#[derive(Clone)]
pub struct GoogleDriveProvider {
    pending_store: Arc<PendingStore>,
    retry_service: Arc<UploadRetryService>,
}

impl GoogleDriveProvider {
    pub fn new(pending_store: Arc<PendingStore>, retry_service: Arc<UploadRetryService>) -> Self {
        Self { pending_store, retry_service }
    }

    async fn build_wrapper(&self) -> Result<GoogleDriveWrapper, StorageError> {
        match create_client().await {
            Some(hub) => Ok(GoogleDriveWrapper::new(hub, self.pending_store.clone(), self.retry_service.clone())),
            None => {
                let _ = auth_server::open_auth_page();
                Err(StorageError::ClientUnavailable)
            }
        }
    }

    async fn ensure_period_folder(
        &self,
        wrapper: &mut GoogleDriveWrapper,
        period_tag: &str,
    ) -> Result<String, StorageError> {
        let folder_name = vec![PERIOD_ROOT_FOLDER_NAME.to_string(), period_tag.to_string()];
        check_or_create_folder_hierarchical(
            &mut wrapper.hub,
            folder_name,
            Some(GOOGLE_DRIVE_ROOT_FOLDER_ID.to_string()),
        )
        .await
        .ok_or_else(|| StorageError::Operation("failed to prepare google drive folder".into()))
    }
}

impl StorageProvider for GoogleDriveProvider {
    fn name(&self) -> &'static str {
        GOOGLE_DRIVE_PROVIDER_NAME
    }

    fn write_get_data_table<'a>(
        &'a self,
        period_tag: &'a str,
        table: &'a crate::database::table::GetDataTableEncode,
    ) -> StorageFuture<'a, Result<(), StorageError>> {
        Box::pin(async move {
            let mut wrapper = self.build_wrapper().await?;
            let folder_id = self.ensure_period_folder(&mut wrapper, period_tag).await?;
            write_get_data_table(&mut wrapper, Some(folder_id), table.clone())
                .await
                .ok_or_else(|| StorageError::Operation("failed to write get data table".into()))?;
            Ok(())
        })
    }

    fn write_port_table<'a>(
        &'a self,
        period_tag: &'a str,
        table: &'a crate::database::table::PortTableEncode,
        maparea_id: i64,
        mapinfo_no: i64,
    ) -> StorageFuture<'a, Result<(), StorageError>> {
        Box::pin(async move {
            let mut wrapper = self.build_wrapper().await?;
            let folder_id = self.ensure_period_folder(&mut wrapper, period_tag).await?;
            write_port_table(
                &mut wrapper,
                Some(folder_id),
                table.clone(),
                maparea_id,
                mapinfo_no,
            )
            .await
            .ok_or_else(|| StorageError::Operation("failed to write port table".into()))?;
            Ok(())
        })
    }

    fn integrate_port_table<'a>(
        &'a self,
        period_tag: &'a str,
        page_size: i32,
    ) -> StorageFuture<'a, Result<(), StorageError>> {
        Box::pin(async move {
            let mut wrapper = self.build_wrapper().await?;
            let folder_id = self.ensure_period_folder(&mut wrapper, period_tag).await?;
            integrate_port_table(&mut wrapper, Some(folder_id), page_size)
                .await
                .ok_or_else(|| StorageError::Operation("failed to integrate port table".into()))?;
            Ok(())
        })
    }
}

async fn ensure_child_folders(
    wrapper: &mut GoogleDriveWrapper,
    parent_folder_id: &str,
    folder_names: &[String],
) -> Result<HashMap<String, String>, StorageError> {
    let names: Vec<String> = folder_names.to_vec();
    let folder_ids =
        check_or_create_folders(&mut wrapper.hub, names.clone(), Some(parent_folder_id.to_string()))
            .await
            .ok_or_else(|| {
                StorageError::Operation("failed to prepare google drive folders".into())
            })?;

    Ok(names.into_iter().zip(folder_ids.into_iter()).collect())
}

async fn write_get_data_table(
    wrapper: &mut GoogleDriveWrapper,
    folder_id: Option<String>,
    table: crate::database::table::GetDataTableEncode,
) -> Option<String> {
    let mime_type = GOOGLE_DRIVE_AVRO_MIME_TYPE.to_string();
    let folder_name = MASTER_DATA_FOLDER_NAME.to_string();
    let master_folder_id = check_or_create_folder(&mut wrapper.hub, folder_name, folder_id.clone()).await?;

    for (table_name, bytes) in get_all_get_data_tables(&table) {
        let file_name = generate_master_data_filename(table_name);
        wrapper.create_or_replace_file(
            file_name,
            mime_type.clone(),
            bytes,
            Some(master_folder_id.clone()),
        )
        .await?;
    }

    Some(master_folder_id)
}

async fn write_port_table(
    wrapper: &mut GoogleDriveWrapper,
    folder_id: Option<String>,
    table: crate::database::table::PortTableEncode,
    maparea_id: i64,
    mapinfo_no: i64,
) -> Option<String> {
    let mime_type = GOOGLE_DRIVE_AVRO_MIME_TYPE.to_string();
    let folder_name = TRANSACTION_DATA_FOLDER_NAME.to_string();
    let transaction_folder_id = check_or_create_folder(&mut wrapper.hub, folder_name, folder_id.clone()).await?;

    // Create map-specific folder (e.g., "1-5" for maparea_id=1, mapinfo_no=5)
    let map_folder_name = format!("{}-{}", maparea_id, mapinfo_no);
    let map_folder_id =
        check_or_create_folder(&mut wrapper.hub, map_folder_name, Some(transaction_folder_id.clone())).await?;

    let file_name = generate_port_table_filename();
    let folder_names = PORT_TABLE_NAMES.clone();
    let folder_map = match ensure_child_folders(wrapper, &map_folder_id, &folder_names).await {
        Ok(map) => map,
        Err(err) => {
            tracing::error!("failed to prepare port table folders: {err}");
            return None;
        }
    };

    for (table_name, bytes) in get_all_port_tables(&table) {
        if bytes.is_empty() {
            tracing::warn!(
                "Skipping write of empty {} table for map {}-{}",
                table_name,
                maparea_id,
                mapinfo_no
            );
            continue;
        }
        let Some(folder_id) = folder_map.get(table_name) else {
            continue;
        };
        let file_id = wrapper.create_file(
            file_name.clone(),
            mime_type.clone(),
            bytes,
            Some(folder_id.clone()),
        )
        .await?;
        tracing::info!(
            "Saved {} table to Google Drive: file_id={} ({} bytes)",
            table_name,
            file_id,
            bytes.len()
        );
    }

    Some(transaction_folder_id)
}

async fn integrate_port_table(
    wrapper: &mut GoogleDriveWrapper,
    folder_id: Option<String>,
    page_size: i32,
) -> Option<String> {
    let mime_type = GOOGLE_DRIVE_AVRO_MIME_TYPE.to_string();
    let folder_mime_type = GOOGLE_DRIVE_FOLDER_MIME_TYPE.to_string();
    let folder_name = TRANSACTION_DATA_FOLDER_NAME.to_string();
    let transaction_folder_id = check_or_create_folder(&mut wrapper.hub, folder_name, folder_id.clone()).await?;

    // Get all map folders (e.g., "1-5", "2-3") in transaction_data
    let map_folder_ids = get_file_list_in_folder(
        &mut wrapper.hub,
        Some(transaction_folder_id.clone()),
        page_size,
        folder_mime_type.clone(),
    )
    .await?;

    // Process each map folder
    for map_folder_id in map_folder_ids {
        let file_name = generate_port_table_filename();
        let folder_names = PORT_TABLE_NAMES.clone();
        let folder_map = match ensure_child_folders(wrapper, &map_folder_id, &folder_names).await {
            Ok(map) => map,
            Err(err) => {
                tracing::error!("failed to prepare integration folders for map folder: {err}");
                continue;
            }
        };

        for table_name in folder_names {
            let Some(folder_id) = folder_map.get(&table_name) else {
                continue;
            };
            let file_id_list =
                get_file_list_in_folder(&mut wrapper.hub, Some(folder_id.clone()), page_size, mime_type.clone())
                    .await;
            let file_content_list = if let Some(file_id_list) = file_id_list.clone() {
                if file_id_list.is_empty() || file_id_list.len() == 1 {
                    continue;
                }
                let mut file_content_list = Vec::new();
                for file_id in file_id_list.iter() {
                    // Await each call sequentially to avoid multiple mutable borrows
                    if let Some(content) = get_file_content(&mut wrapper.hub, file_id.clone()).await {
                        file_content_list.push(content);
                    }
                }
                Some(file_content_list)
            } else {
                continue;
            };
            if let Some(file_content_list) = file_content_list {
                if file_content_list.is_empty() {
                    continue;
                }
                let integrated_content = integrate_by_table_name(&table_name, file_content_list);
                if let Ok(integrated_content) = integrated_content {
                    if integrated_content.is_empty() {
                        continue;
                    }
                    wrapper.create_file(
                        file_name.clone(),
                        mime_type.clone(),
                        integrated_content.as_slice(),
                        Some(folder_id.clone()),
                    )
                    .await?;
                    for file_id in file_id_list.unwrap().iter() {
                        wrapper.delete_file(file_id.clone()).await;
                    }
                } else {
                    continue;
                }
            } else {
                continue;
            }
        }
    }
    return Some(transaction_folder_id);
}
