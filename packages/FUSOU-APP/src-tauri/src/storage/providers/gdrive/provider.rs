use chrono::{TimeZone, Utc};
use chrono_tz::Asia::Tokyo;
use uuid::Uuid;
use std::sync::Arc;
use std::collections::HashMap;

use kc_api::database::models::airbase::{AirBase, PlaneInfo};
use kc_api::database::models::battle::{
    AirBaseAirAttack, AirBaseAirAttackList, AirBaseAssult, Battle, CarrierBaseAssault,
    ClosingRaigeki, FriendlySupportHourai, FriendlySupportHouraiList, Hougeki, HougekiList,
    MidnightHougeki, MidnightHougekiList, OpeningAirAttack, OpeningAirAttackList, OpeningRaigeki,
    OpeningTaisen, OpeningTaisenList, SupportAirattack, SupportHourai,
};
use kc_api::database::models::cell::Cells;
use kc_api::database::models::deck::{EnemyDeck, FriendDeck, OwnDeck, SupportDeck};
use kc_api::database::models::ship::{EnemyShip, FriendShip, OwnShip};
use kc_api::database::models::slotitem::{EnemySlotItem, FriendSlotItem, OwnSlotItem};
use kc_api::database::table::{
    GetDataTableEnum, PortTableEnum, GET_DATA_TABLE_NAMES, PORT_TABLE_NAMES,
};
use kc_api::database::{integrate::integrate, models::env_info::EnvInfo};

use crate::storage::constants::{
    AVRO_FILE_EXTENSION, GOOGLE_DRIVE_AVRO_MIME_TYPE, GOOGLE_DRIVE_FOLDER_MIME_TYPE,
    GOOGLE_DRIVE_PROVIDER_NAME, GOOGLE_DRIVE_ROOT_FOLDER_ID,
    MASTER_DATA_FOLDER_NAME, PERIOD_ROOT_FOLDER_NAME, PORT_TABLE_FILE_NAME_SEPARATOR,
    TRANSACTION_DATA_FOLDER_NAME,
};
use crate::storage::service::{StorageError, StorageFuture, StorageProvider};
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

    for table_names in GET_DATA_TABLE_NAMES.clone() {
        let table_name = table_names.clone().parse::<GetDataTableEnum>();
        if let Ok(table_name) = table_name {
            let content: Vec<u8> = match table_name {
                GetDataTableEnum::MstShip => table.mst_ship.clone(),
                GetDataTableEnum::MstSlotItem => table.mst_slot_item.clone(),
                GetDataTableEnum::MstEquipExslotShip => table.mst_equip_exslot_ship.clone(),
                GetDataTableEnum::MstEquipExslot => table.mst_equip_exslot.clone(),
                GetDataTableEnum::MstEquipLimitExslot => table.mst_equip_limit_exslot.clone(),
                GetDataTableEnum::MstSlotItemEquipType => table.mst_slot_item_equip_type.clone(),
                GetDataTableEnum::MstEquipShip => table.mst_equip_ship.clone(),
                GetDataTableEnum::MstStype => table.mst_stype.clone(),
                GetDataTableEnum::MstUseItem => table.mst_use_item.clone(),
                GetDataTableEnum::MstMapArea => table.mst_map_area.clone(),
                GetDataTableEnum::MstMapInfo => table.mst_map_info.clone(),
                GetDataTableEnum::MstShipGraph => table.mst_ship_graph.clone(),
                GetDataTableEnum::MstShipUpgrade => table.mst_ship_upgrade.clone(),
            };
            let file_name = format!("{table_names}{AVRO_FILE_EXTENSION}");
            wrapper.create_or_replace_file(
                file_name,
                mime_type.clone(),
                content.as_slice(),
                Some(master_folder_id.clone()),
            )
            .await?;
        }
    }

    return Some(master_folder_id);
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

    let utc = Utc::now().naive_utc();
    let jst = Tokyo.from_utc_datetime(&utc);
    let file_name = format!(
        "{}{}{}{}",
        jst.timestamp(),
        PORT_TABLE_FILE_NAME_SEPARATOR,
        Uuid::new_v4(),
        AVRO_FILE_EXTENSION
    );
    let folder_names = PORT_TABLE_NAMES.clone();
    let folder_map = match ensure_child_folders(wrapper, &map_folder_id, &folder_names).await {
        Ok(map) => map,
        Err(err) => {
            tracing::error!("failed to prepare port table folders: {err}");
            return None;
        }
    };

    for table_name_str in folder_names {
        let table_name = table_name_str.parse::<PortTableEnum>();
        if let Ok(table_name) = table_name {
            let content: Vec<u8> = match table_name {
                PortTableEnum::EnvInfo => table.env_info.clone(),
                PortTableEnum::Cells => table.cells.clone(),
                PortTableEnum::AirBase => table.airbase.clone(),
                PortTableEnum::PlaneInfo => table.plane_info.clone(),
                PortTableEnum::OwnSlotItem => table.own_slotitem.clone(),
                PortTableEnum::EnemySlotItem => table.enemy_slotitem.clone(),
                PortTableEnum::FriendSlotItem => table.friend_slotitem.clone(),
                PortTableEnum::OwnShip => table.own_ship.clone(),
                PortTableEnum::EnemyShip => table.enemy_ship.clone(),
                PortTableEnum::FriendShip => table.friend_ship.clone(),
                PortTableEnum::OwnDeck => table.own_deck.clone(),
                PortTableEnum::SupportDeck => table.support_deck.clone(),
                PortTableEnum::EnemyDeck => table.enemy_deck.clone(),
                PortTableEnum::FriendDeck => table.friend_deck.clone(),
                PortTableEnum::AirBaseAirAttack => table.airbase_airattack.clone(),
                PortTableEnum::AirBaseAirAttackList => table.airbase_airattack_list.clone(),
                PortTableEnum::AirBaseAssult => table.airbase_assult.clone(),
                PortTableEnum::CarrierBaseAssault => table.carrierbase_assault.clone(),
                PortTableEnum::ClosingRaigeki => table.closing_raigeki.clone(),
                PortTableEnum::FriendlySupportHourai => table.friendly_support_hourai.clone(),
                PortTableEnum::FriendlySupportHouraiList => {
                    table.friendly_support_hourai_list.clone()
                }
                PortTableEnum::Hougeki => table.hougeki.clone(),
                PortTableEnum::HougekiList => table.hougeki_list.clone(),
                PortTableEnum::MidnightHougeki => table.midnight_hougeki.clone(),
                PortTableEnum::MidnightHougekiList => table.midnight_hougeki_list.clone(),
                PortTableEnum::OpeningAirAttack => table.opening_airattack.clone(),
                PortTableEnum::OpeningAirAttackList => table.opening_airattack_list.clone(),
                PortTableEnum::OpeningRaigeki => table.opening_raigeki.clone(),
                PortTableEnum::OpeningTaisen => table.opening_taisen.clone(),
                PortTableEnum::OpeningTaisenList => table.opening_taisen_list.clone(),
                PortTableEnum::SupportAirattack => table.support_airattack.clone(),
                PortTableEnum::SupportHourai => table.support_hourai.clone(),
                PortTableEnum::Battle => table.battle.clone(),
            };
            if content.is_empty() {
                tracing::warn!(
                    "Skipping write of empty {} table for map {}-{}",
                    table_name_str,
                    maparea_id,
                    mapinfo_no
                );
                continue;
            }
            let Some(folder_id) = folder_map.get(&table_name_str) else {
                continue;
            };
            let file_id = wrapper.create_file(
                file_name.clone(),
                mime_type.clone(),
                content.as_slice(),
                Some(folder_id.clone()),
            )
            .await?;
            tracing::info!(
                "Saved {} table to Google Drive: file_id={} ({} bytes)",
                table_name_str,
                file_id,
                content.len()
            );
        }
    }

    return Some(transaction_folder_id);
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
        let utc = Utc::now().naive_utc();
        let jst = Tokyo.from_utc_datetime(&utc);
        let file_name = format!(
            "{}{}{}{}",
            jst.timestamp(),
            PORT_TABLE_FILE_NAME_SEPARATOR,
            Uuid::new_v4(),
            AVRO_FILE_EXTENSION
        );
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
                let integrated_content = if let Ok(table_name) =
                    table_name.clone().parse::<PortTableEnum>()
                {
                    match table_name {
                        PortTableEnum::EnvInfo => integrate::<EnvInfo>(file_content_list),
                        PortTableEnum::Cells => integrate::<Cells>(file_content_list),
                        PortTableEnum::AirBase => integrate::<AirBase>(file_content_list),
                        PortTableEnum::PlaneInfo => integrate::<PlaneInfo>(file_content_list),
                        PortTableEnum::OwnSlotItem => integrate::<OwnSlotItem>(file_content_list),
                        PortTableEnum::EnemySlotItem => {
                            integrate::<EnemySlotItem>(file_content_list)
                        }
                        PortTableEnum::FriendSlotItem => {
                            integrate::<FriendSlotItem>(file_content_list)
                        }
                        PortTableEnum::OwnShip => integrate::<OwnShip>(file_content_list),
                        PortTableEnum::EnemyShip => integrate::<EnemyShip>(file_content_list),
                        PortTableEnum::FriendShip => integrate::<FriendShip>(file_content_list),
                        PortTableEnum::OwnDeck => integrate::<OwnDeck>(file_content_list),
                        PortTableEnum::SupportDeck => integrate::<SupportDeck>(file_content_list),
                        PortTableEnum::EnemyDeck => integrate::<EnemyDeck>(file_content_list),
                        PortTableEnum::FriendDeck => integrate::<FriendDeck>(file_content_list),
                        PortTableEnum::AirBaseAirAttack => {
                            integrate::<AirBaseAirAttack>(file_content_list)
                        }
                        PortTableEnum::AirBaseAirAttackList => {
                            integrate::<AirBaseAirAttackList>(file_content_list)
                        }
                        PortTableEnum::AirBaseAssult => {
                            integrate::<AirBaseAssult>(file_content_list)
                        }
                        PortTableEnum::CarrierBaseAssault => {
                            integrate::<CarrierBaseAssault>(file_content_list)
                        }
                        PortTableEnum::ClosingRaigeki => {
                            integrate::<ClosingRaigeki>(file_content_list)
                        }
                        PortTableEnum::FriendlySupportHourai => {
                            integrate::<FriendlySupportHourai>(file_content_list)
                        }
                        PortTableEnum::FriendlySupportHouraiList => {
                            integrate::<FriendlySupportHouraiList>(file_content_list)
                        }
                        PortTableEnum::Hougeki => integrate::<Hougeki>(file_content_list),
                        PortTableEnum::HougekiList => integrate::<HougekiList>(file_content_list),
                        PortTableEnum::MidnightHougeki => {
                            integrate::<MidnightHougeki>(file_content_list)
                        }
                        PortTableEnum::MidnightHougekiList => {
                            integrate::<MidnightHougekiList>(file_content_list)
                        }
                        PortTableEnum::OpeningAirAttack => {
                            integrate::<OpeningAirAttack>(file_content_list)
                        }
                        PortTableEnum::OpeningAirAttackList => {
                            integrate::<OpeningAirAttackList>(file_content_list)
                        }
                        PortTableEnum::OpeningRaigeki => {
                            integrate::<OpeningRaigeki>(file_content_list)
                        }
                        PortTableEnum::OpeningTaisen => {
                            integrate::<OpeningTaisen>(file_content_list)
                        }
                        PortTableEnum::OpeningTaisenList => {
                            integrate::<OpeningTaisenList>(file_content_list)
                        }
                        PortTableEnum::SupportAirattack => {
                            integrate::<SupportAirattack>(file_content_list)
                        }
                        PortTableEnum::SupportHourai => {
                            integrate::<SupportHourai>(file_content_list)
                        }
                        PortTableEnum::Battle => integrate::<Battle>(file_content_list),
                    }
                } else {
                    Ok(Vec::new())
                };
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
