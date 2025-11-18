use std::path::{Path, PathBuf};

use chrono::{TimeZone, Utc};
use chrono_tz::Asia::Tokyo;
use kc_api::database::table::{
    GetDataTableEncode, GetDataTableEnum, PortTableEncode, PortTableEnum, GET_DATA_TABLE_NAMES,
    PORT_TABLE_NAMES,
};
use tokio::fs;
use uuid::Uuid;

use super::constants::{
    AVRO_FILE_EXTENSION, LOCAL_STORAGE_PROVIDER_NAME, MASTER_DATA_FOLDER_NAME,
    PERIOD_ROOT_FOLDER_NAME, PORT_TABLE_FILE_NAME_SEPARATOR, STORAGE_ROOT_DIR_NAME,
    STORAGE_SUB_DIR_NAME, TRANSACTION_DATA_FOLDER_NAME,
};
use super::service::{StorageError, StorageFuture, StorageProvider};

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

    fn resolve_get_data_bytes<'a>(
        table: &'a GetDataTableEncode,
        table_name: &str,
    ) -> Option<&'a [u8]> {
        let variant = table_name.parse::<GetDataTableEnum>().ok()?;
        let bytes = match variant {
            GetDataTableEnum::MstShip => &table.mst_ship,
            GetDataTableEnum::MstSlotItem => &table.mst_slot_item,
            GetDataTableEnum::MstEquipExslotShip => &table.mst_equip_exslot_ship,
            GetDataTableEnum::MstEquipExslot => &table.mst_equip_exslot,
            GetDataTableEnum::MstEquipLimitExslot => &table.mst_equip_limit_exslot,
            GetDataTableEnum::MstSlotItemEquipType => &table.mst_slot_item_equip_type,
            GetDataTableEnum::MstEquipShip => &table.mst_equip_ship,
            GetDataTableEnum::MstStype => &table.mst_stype,
            GetDataTableEnum::MstUseItem => &table.mst_use_item,
            GetDataTableEnum::MstMapArea => &table.mst_map_area,
            GetDataTableEnum::MstMapInfo => &table.mst_map_info,
            GetDataTableEnum::MstShipGraph => &table.mst_ship_graph,
            GetDataTableEnum::MstShipUpgrade => &table.mst_ship_upgrade,
        };
        Some(bytes.as_slice())
    }

    fn resolve_port_table_bytes<'a>(
        table: &'a PortTableEncode,
        table_name: &str,
    ) -> Option<&'a [u8]> {
        let variant = table_name.parse::<PortTableEnum>().ok()?;
        let bytes = match variant {
            PortTableEnum::EnvInfo => &table.env_info,
            PortTableEnum::Cells => &table.cells,
            PortTableEnum::AirBase => &table.airbase,
            PortTableEnum::PlaneInfo => &table.plane_info,
            PortTableEnum::OwnSlotItem => &table.own_slotitem,
            PortTableEnum::EnemySlotItem => &table.enemy_slotitem,
            PortTableEnum::FriendSlotItem => &table.friend_slotitem,
            PortTableEnum::OwnShip => &table.own_ship,
            PortTableEnum::EnemyShip => &table.enemy_ship,
            PortTableEnum::FriendShip => &table.friend_ship,
            PortTableEnum::OwnDeck => &table.own_deck,
            PortTableEnum::SupportDeck => &table.support_deck,
            PortTableEnum::EnemyDeck => &table.enemy_deck,
            PortTableEnum::FriendDeck => &table.friend_deck,
            PortTableEnum::AirBaseAirAttack => &table.airbase_airattack,
            PortTableEnum::AirBaseAirAttackList => &table.airbase_airattack_list,
            PortTableEnum::AirBaseAssult => &table.airbase_assult,
            PortTableEnum::CarrierBaseAssault => &table.carrierbase_assault,
            PortTableEnum::ClosingRaigeki => &table.closing_raigeki,
            PortTableEnum::FriendlySupportHourai => &table.friendly_support_hourai,
            PortTableEnum::FriendlySupportHouraiList => &table.friendly_support_hourai_list,
            PortTableEnum::Hougeki => &table.hougeki,
            PortTableEnum::HougekiList => &table.hougeki_list,
            PortTableEnum::MidnightHougeki => &table.midnight_hougeki,
            PortTableEnum::MidnightHougekiList => &table.midnight_hougeki_list,
            PortTableEnum::OpeningAirAttack => &table.opening_airattack,
            PortTableEnum::OpeningAirAttackList => &table.opening_airattack_list,
            PortTableEnum::OpeningRaigeki => &table.opening_raigeki,
            PortTableEnum::OpeningTaisen => &table.opening_taisen,
            PortTableEnum::OpeningTaisenList => &table.opening_taisen_list,
            PortTableEnum::SupportAirattack => &table.support_airattack,
            PortTableEnum::SupportHourai => &table.support_hourai,
            PortTableEnum::Battle => &table.battle,
        };
        Some(bytes.as_slice())
    }
}

fn default_root_directory() -> PathBuf {
    #[cfg(dev)]
    {
        // In dev, place DB at the same hierarchy as packages/FUSOU-PROXY-DATA
        // From src-tauri, two levels up is packages/
        return PathBuf::from("./../../")
            .join(STORAGE_ROOT_DIR_NAME)
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

            for table_name in GET_DATA_TABLE_NAMES.iter() {
                if let Some(bytes) = Self::resolve_get_data_bytes(table, table_name) {
                    let file_path = master_dir.join(format!("{table_name}{AVRO_FILE_EXTENSION}"));
                    fs::write(file_path, bytes).await?;
                }
            }

            Ok(())
        })
    }

    fn write_port_table<'a>(
        &'a self,
        period_tag: &'a str,
        table: &'a PortTableEncode,
    ) -> StorageFuture<'a, Result<(), StorageError>> {
        Box::pin(async move {
            let period_dir = self.period_directory(period_tag);
            let transaction_dir = period_dir.join(TRANSACTION_DATA_FOLDER_NAME);
            Self::ensure_dir(&transaction_dir).await?;

            let utc = Utc::now().naive_utc();
            let jst = Tokyo.from_utc_datetime(&utc);
            let file_name = format!(
                "{}{}{}{}",
                jst.timestamp(),
                PORT_TABLE_FILE_NAME_SEPARATOR,
                Uuid::new_v4(),
                AVRO_FILE_EXTENSION
            );

            for table_name in PORT_TABLE_NAMES.iter() {
                if let Some(bytes) = Self::resolve_port_table_bytes(table, table_name) {
                    let table_dir = transaction_dir.join(table_name);
                    Self::ensure_dir(&table_dir).await?;
                    let file_path = table_dir.join(&file_name);
                    fs::write(file_path, bytes).await?;
                }
            }

            Ok(())
        })
    }

    fn integrate_port_table<'a>(
        &'a self,
        _period_tag: &'a str,
        _page_size: i32,
    ) -> StorageFuture<'a, Result<(), StorageError>> {
        Box::pin(async { Ok(()) })
    }
}
